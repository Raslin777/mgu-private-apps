'use strict';
// Execute under a verified Node 8 binary (the head unit runs Node 8.16.2).
// Loads every module the app and the root helper ship and drives one full
// agent turn. No provider or network requests.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const app = path.join(__dirname, '..', 'apps', 'mgu_ai_terminal');
const safety = require(path.join(app, 'safety'));
const config = require(path.join(app, 'config'));
const api = require(path.join(app, 'api'));
const toolkit = require(path.join(app, 'tools'));
const Agent = require(path.join(app, 'agent')).Agent;
const view = require(path.join(app, 'view'));
require(path.join(app, 'speller'));

// The helper requires ./safety beside it, as it is installed on the head unit.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'aiterm-node8-'));
['helper.js'].forEach(function (name) {
    fs.writeFileSync(path.join(stage, name), fs.readFileSync(path.join(__dirname, '..', 'native', 'mgu-ai-root', name)));
});
fs.writeFileSync(path.join(stage, 'safety.js'), fs.readFileSync(path.join(app, 'safety.js')));
const helper = require(path.join(stage, 'helper.js'));

async function check() {
    assert.equal(safety.checkCommand('rm -rf /').action, 'deny');
    assert.equal(safety.checkCommand('ls').action, 'ask');
    assert.equal(safety.checkPrompt('flash the DME').ok, false);
    assert.equal(helper.authorised('wrong'), false);
    assert.equal(typeof api.call, 'function');
    assert.throws(function () { config.load(stage); }, /Not set up/);

    const workspace = path.join(stage, 'workspace');
    fs.mkdirSync(workspace);
    const tools = new toolkit.Tools(workspace);
    tools.run = function (command) { return { promise: Promise.resolve({ code: 0, output: 'ran ' + command }), abort: function () {} }; };
    const replies = [
        { status: 200, body: { stop_reason: 'tool_use', content: [
            { type: 'tool_use', id: 'a', name: 'write_file', input: { path: 'hello.sh', content: 'echo hi\n' } },
            { type: 'tool_use', id: 'b', name: 'run_command', input: { command: 'sh hello.sh', as_root: false, reason: 'run it' } }] } },
        { status: 200, body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] } }
    ];
    let clock = 0;
    const agent = new Agent({
        config: { provider: 'anthropic', anthropicKey: 'k'.repeat(16), anthropicModel: 'claude-opus-5-5', maxSteps: 4 },
        tools: tools, now: function () { return clock; },
        call: function () { return { promise: Promise.resolve(replies.shift()), abort: function () {} }; }
    });
    const turn = agent.ask('Create and run hello.sh');
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
    assert.equal(agent.approvals.length, 1);
    assert.equal(fs.readFileSync(path.join(workspace, 'hello.sh'), 'utf8'), 'echo hi\n');
    const texts = [];
    view.draw({ clear: function () {}, fillRect: function () {}, text: function (t) { texts.push(t); } }, agent, 0);
    assert.ok(texts.indexOf('sh hello.sh') >= 0);
    clock = 5000;
    agent.decide(agent.approvals[0].id, true);
    await turn;
    assert.equal(agent.status, 'Ready — Claude');
    assert.ok(agent.lines.indexOf('AI: Done.') >= 0);
    console.log('Node ' + process.version + ': safety, config, API, tools, agent, view and root helper checks passed');
}
check().catch(function (error) { console.error(error); process.exitCode = 1; });
