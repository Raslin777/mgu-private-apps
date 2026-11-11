'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Agent } = require('../apps/mgu_ai_terminal/agent');

const settings = { provider: 'anthropic', anthropicKey: 'ant-key-000000', anthropicModel: 'claude-opus-5-5', maxSteps: 4 };
const text = t => ({ status: 200, body: { stop_reason: 'end_turn', content: [{ type: 'text', text: t }] } });
const tool = (id, name, input) => ({ status: 200, body: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
const command = (id, cmd, root) => tool(id, 'run_command', { command: cmd, as_root: !!root, reason: 'test' });
const tick = () => new Promise(resolve => setImmediate(resolve));

// replies: a queue of provider replies, or a function returning a pending promise.
function fixture(replies, extra) {
    const requests = [], ran = [], files = {};
    let clock = 10000;
    const tools = {
        root: true,
        rootAvailable() { return this.root; },
        readFile(p) { if (!(p in files)) throw new Error('No such file'); return files[p]; },
        writeFile(p, c) { files[p] = c; return c.length; },
        run(cmd, root) { ran.push({ cmd, root }); return { promise: Promise.resolve({ code: 0, output: 'out:' + cmd }), abort() {} }; }
    };
    const agent = new Agent(Object.assign({
        config: settings, tools, minReviewMs: 1500, now: () => clock, secrets: ['ant-key-000000'], protectedPaths: ['/data/config.json'],
        call(request) {
            requests.push(JSON.parse(JSON.stringify(request.body)));
            const next = replies.shift();
            if (typeof next === 'function') return next();
            return { promise: next instanceof Error ? Promise.reject(next) : Promise.resolve(next), abort() {} };
        }
    }, extra || {}));
    return { agent, requests, ran, files, tools, advance(ms) { clock += ms; } };
}
const lastResults = requests => requests[requests.length - 1].messages.slice(-1)[0].content;

test('Stop immediately after approval prevents the command from starting', async () => {
    const f = fixture([command('t1', 'ls')]);
    const turn = f.agent.ask('List files');
    await tick();
    f.advance(2000);
    f.agent.decide(f.agent.approvals[0].id, true);
    f.agent.stop();
    await turn;
    assert.equal(f.ran.length, 0);
    assert.equal(f.agent.status, 'Stopped');
});

test('Stop during a tool batch prevents later file writes', async () => {
    const f = fixture([{ status: 200, body: { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 'a', name: 'write_file', input: { path: 'first', content: 'one' } },
        { type: 'tool_use', id: 'b', name: 'write_file', input: { path: 'second', content: 'two' } }
    ] } }]);
    const stopAfterWrite = () => {
        if (f.agent.lines.some(l => l.startsWith('Wrote first'))) {
            f.agent.removeListener('change', stopAfterWrite); f.agent.stop();
        }
    };
    f.agent.on('change', stopAfterWrite);
    await f.agent.ask('Write two files');
    assert.deepEqual(f.files, { first: 'one' });
    assert.equal(f.agent.status, 'Stopped');
    assert.equal(f.requests.length, 1);
});

test('a plain question makes one request and runs nothing', async () => {
    const f = fixture([text('It is Linux.')]);
    await f.agent.ask('What OS is this?');
    assert.equal(f.requests.length, 1);
    assert.equal(f.ran.length, 0);
    assert.equal(f.agent.busy, false);
    assert.equal(f.agent.status, 'Ready — Claude');
    assert.deepEqual(f.agent.lines, ['> What OS is this?', 'AI: It is Linux.']);
    assert.equal(f.agent.history.length, 2);
});
test('a blocked request never reaches the provider', async () => {
    const f = fixture([]);
    await assert.rejects(f.agent.ask('flash the DME'), /blocked/);
    await assert.rejects(f.agent.ask('   '), /blocked/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.agent.history.length, 0);
    assert.equal(f.agent.busy, false);
});
test('a command waits for approval and runs only after the owner approves', async () => {
    const f = fixture([command('t1', 'ls -la'), text('Done.')]);
    const turn = f.agent.ask('List files');
    await tick();
    assert.equal(f.agent.approvals.length, 1);
    assert.equal(f.agent.approvals[0].command, 'ls -la');
    assert.equal(f.agent.approvals[0].root, false);
    assert.equal(f.agent.status, 'Action needs approval');
    assert.equal(f.ran.length, 0);
    f.advance(2000);
    f.agent.decide(f.agent.approvals[0].id, true);
    await turn;
    assert.deepEqual(f.ran, [{ cmd: 'ls -la', root: false }]);
    assert.deepEqual(lastResults(f.requests), [{ type: 'tool_result', tool_use_id: 't1', content: 'exit: 0\nout:ls -la' }]);
    assert.ok(f.agent.lines.includes('$ ls -la'));
});
test('approval pressed the instant a command appears is refused; deny is immediate', async () => {
    const f = fixture([command('t1', 'ls'), text('ok')]);
    const turn = f.agent.ask('List files');
    await tick();
    const id = f.agent.approvals[0].id;
    assert.throws(() => f.agent.decide(id, true), /Read the command/);
    assert.equal(f.agent.approvals.length, 1);
    assert.equal(f.ran.length, 0);
    f.agent.decide(id, false);
    await turn;
    assert.equal(f.ran.length, 0);
    assert.equal(lastResults(f.requests)[0].is_error, true);
    assert.match(lastResults(f.requests)[0].content, /declined/);
    assert.throws(() => f.agent.decide(id, true), /no longer pending/);
});
test('a denied-by-policy command is never offered for approval', async () => {
    const f = fixture([command('t1', 'rm -rf /etc', true), text('Understood.')]);
    await f.agent.ask('Clean up');
    assert.equal(f.ran.length, 0);
    assert.match(lastResults(f.requests)[0].content, /Blocked by the head-unit safety policy/);
    assert.ok(f.agent.lines.some(l => l.indexOf('BLOCKED') === 0));
});
test('root commands are marked, and refused when root access is not set up', async () => {
    let f = fixture([command('t1', 'systemctl restart foo', true), text('ok')]);
    let turn = f.agent.ask('Restart foo');
    await tick();
    assert.equal(f.agent.approvals[0].root, true);
    assert.deepEqual(f.agent.approvals[0].flags, ['RUNS AS ROOT', 'CHANGES A SERVICE']);
    f.advance(2000);
    f.agent.decide(f.agent.approvals[0].id, true);
    await turn;
    assert.deepEqual(f.ran, [{ cmd: 'systemctl restart foo', root: true }]);
    assert.ok(f.agent.lines.includes('# systemctl restart foo'));

    f = fixture([command('t1', 'id', true), text('ok')]);
    f.tools.root = false;
    await f.agent.ask('Who am I');
    assert.equal(f.ran.length, 0);
    assert.match(lastResults(f.requests)[0].content, /not set up/);
});
test('workspace files are read and written without approval; bad tool input is rejected', async () => {
    const f = fixture([
        tool('t1', 'write_file', { path: 'a.txt', content: 'hello' }),
        tool('t2', 'read_file', { path: 'a.txt' }),
        tool('t3', 'read_file', { path: 'missing.txt' }),
        tool('t4', 'run_command', { command: 'ls' }),
        text('never reached')
    ]);
    await f.agent.ask('Make a file');
    assert.equal(f.files['a.txt'], 'hello');
    assert.equal(f.requests[2].messages.slice(-1)[0].content[0].content, 'hello');
    assert.equal(f.requests[3].messages.slice(-1)[0].content[0].is_error, true);
    assert.equal(f.agent.status, 'Paused at step limit');
    assert.match(f.agent.history.slice(-1)[0].content[0].content, /as_root must be a boolean/);
    assert.equal(f.ran.length, 0);
});
test('Stop during a provider request discards the turn and runs nothing', async () => {
    let abort = 0;
    const f = fixture([() => ({ promise: new Promise((resolve, reject) => { abort = () => reject(new Error('Stopped')); }), abort() { abort(); } })]);
    const turn = f.agent.ask('Do something');
    await tick();
    f.agent.stop();
    await turn;
    assert.equal(f.agent.status, 'Stopped');
    assert.equal(f.agent.busy, false);
    assert.equal(f.agent.history.length, 0);
});
test('Stop while a command waits for approval cancels it', async () => {
    const f = fixture([command('t1', 'ls'), text('unused')]);
    const turn = f.agent.ask('List files');
    await tick();
    f.agent.stop();
    await turn;
    assert.equal(f.ran.length, 0);
    assert.equal(f.agent.approvals.length, 0);
    assert.equal(f.agent.status, 'Stopped');
    assert.equal(f.agent.history.length, 0);
    assert.equal(f.requests.length, 1);
});
test('refusals, cut-off replies and provider failures end the turn cleanly', async () => {
    const f = fixture([
        { status: 200, body: { stop_reason: 'refusal', content: [] } },
        { status: 200, body: { stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 'x', name: 'run_command', input: {} }] } },
        { status: 401, body: { error: { message: 'bad key ant-key-000000' } } },
        new Error('socket hang up near ant-key-000000')
    ]);
    await f.agent.ask('one');
    assert.ok(f.agent.lines.includes('ERROR: The model declined this request'));
    await f.agent.ask('two');
    assert.ok(f.agent.lines.includes('ERROR: The reply was cut off; ask for a smaller task'));
    await f.agent.ask('three');
    assert.ok(f.agent.lines.includes('ERROR: Claude rejected the API key'));
    await f.agent.ask('four');
    assert.ok(f.agent.lines.includes('ERROR: socket hang up near [redacted]'));
    assert.equal(f.agent.history.length, 0);
    assert.equal(f.ran.length, 0);
    assert.equal(f.agent.busy, false);
});
test('secrets in command output are redacted before the model or screen sees them', async () => {
    const f = fixture([command('t1', 'env'), text('ok')]);
    f.tools.run = () => ({ promise: Promise.resolve({ code: 0, output: 'KEY=ant-key-000000' }), abort() {} });
    const turn = f.agent.ask('Show env');
    await tick();
    f.advance(2000);
    f.agent.decide(f.agent.approvals[0].id, true);
    await turn;
    assert.equal(lastResults(f.requests)[0].content, 'exit: 0\nKEY=[redacted]');
    assert.equal(f.agent.lines.join('\n').indexOf('ant-key-000000'), -1);
});
test('requests cannot overlap, and switching provider starts a fresh conversation', async () => {
    const f = fixture([command('t1', 'ls'), text('ok')]);
    const turn = f.agent.ask('List files');
    await tick();
    await assert.rejects(f.agent.ask('second'), /already running/);
    assert.throws(() => f.agent.setConfig(settings, []), /Stop the current request/);
    f.agent.stop();
    await turn;
    f.agent.setConfig({ provider: 'openai', openaiKey: 'oai-key-000000', openaiModel: 'm', maxSteps: 4 }, []);
    assert.equal(f.agent.provider.name, 'openai');
    assert.equal(f.agent.history.length, 0);
    assert.equal(f.agent.status, 'Ready — OpenAI');
});
