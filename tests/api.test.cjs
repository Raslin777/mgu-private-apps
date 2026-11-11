'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { call, providers, HOSTS } = require('../apps/mgu_ai_terminal/api');
const { TOOLS } = require('../apps/mgu_ai_terminal/tools');

const config = { anthropicKey: 'ant-key-000000', anthropicModel: 'claude-opus-5-5', openaiKey: 'oai-key-000000', openaiModel: 'test-model' };

test('provider deadline covers a request that never gets a socket', async () => {
    let destroyed = false;
    const request = () => Object.assign(new EventEmitter(), {
        setTimeout() {}, end() {}, destroy() { destroyed = true; }
    });
    await assert.rejects(call({ host: HOSTS.anthropic, path: '/', headers: {}, body: {} },
        { timeoutMs: 5, request }).promise, /timed out/);
    assert.equal(destroyed, true);
});

// A fake https.request that replies from a queue and records what was sent.
function fakeHttps(replies, seen) {
    return (settings, onResponse) => {
        const req = new EventEmitter();
        req.setTimeout = () => {};
        req.destroy = error => { req.destroyed = true; if (error) req.emit('error', error); };
        req.end = data => {
            seen.push({ settings, body: JSON.parse(data.toString('utf8')) });
            const reply = replies.shift();
            setImmediate(() => {
                if (req.destroyed) return;
                if (reply.error) { req.emit('error', new Error(reply.error)); return; }
                const res = new EventEmitter();
                res.statusCode = reply.status;
                onResponse(res);
                res.emit('data', Buffer.from(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)));
                res.emit('end');
            });
        };
        return req;
    };
}

test('Claude request: headers, model, strict tools, fallback and unchanged history', () => {
    const history = [providers.anthropic.user('hi')];
    const r = providers.anthropic.build(config, 'SYSTEM', TOOLS, history);
    assert.equal(r.host, 'api.anthropic.com');
    assert.equal(r.path, '/v1/messages');
    assert.equal(r.headers['x-api-key'], 'ant-key-000000');
    assert.equal(r.headers['anthropic-version'], '2026-10-21');
    assert.equal(r.body.model, 'claude-opus-5-5');
    assert.equal(r.body.fallbacks, 'default');
    assert.equal(r.body.system, 'SYSTEM');
    assert.equal(r.body.messages, history);
    assert.equal(r.body.tools.length, 3);
    r.body.tools.forEach(t => { assert.equal(t.strict, true); assert.equal(t.input_schema.additionalProperties, false); });
    assert.equal('thinking' in r.body, false);
    assert.equal('temperature' in r.body, false);
});
test('Claude reply: content is kept whole, tool calls and stop reasons are mapped', () => {
    const content = [
        { type: 'thinking', thinking: '', signature: 's' },
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'tu1', name: 'run_command', input: { command: 'ls', as_root: false, reason: 'list' } }
    ];
    const out = providers.anthropic.parse(200, { content, stop_reason: 'tool_use' });
    assert.equal(out.entry.content, content);
    assert.equal(out.text, 'Checking.');
    assert.deepEqual(out.calls, [{ id: 'tu1', name: 'run_command', input: content[2].input }]);
    assert.equal(out.stop, 'tools');
    assert.equal(providers.anthropic.parse(200, { content: [], stop_reason: 'refusal' }).stop, 'refusal');
    assert.equal(providers.anthropic.parse(200, { content: [], stop_reason: 'max_tokens' }).stop, 'max');
    assert.deepEqual(providers.anthropic.results([{ id: 'tu1', content: 'ok' }, { id: 'tu2', content: 'no', error: true }]), [{
        role: 'user', content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'ok' },
            { type: 'tool_result', tool_use_id: 'tu2', content: 'no', is_error: true }]
    }]);
});
test('OpenAI request and reply: bearer key, function tools, argument parsing', () => {
    const r = providers.openai.build(config, 'SYSTEM', TOOLS, [providers.openai.user('hi')]);
    assert.equal(r.host, 'api.openai.com');
    assert.equal(r.headers.authorization, 'Bearer oai-key-000000');
    assert.equal(r.body.model, 'test-model');
    assert.deepEqual(r.body.messages[0], { role: 'system', content: 'SYSTEM' });
    assert.equal(r.body.tools[0].type, 'function');
    const calls = [
        { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
        { id: 'c2', type: 'function', function: { name: 'read_file', arguments: '{broken' } }
    ];
    const out = providers.openai.parse(200, { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: calls } }] });
    assert.equal(out.stop, 'tools');
    assert.deepEqual(out.calls[0], { id: 'c1', name: 'read_file', input: { path: 'a.txt' }, invalid: false });
    assert.equal(out.calls[1].invalid, true);
    assert.deepEqual(out.entry.tool_calls, calls);
    assert.deepEqual(providers.openai.results([{ id: 'c1', content: 'x' }]), [{ role: 'tool', tool_call_id: 'c1', content: 'x' }]);
    assert.equal(providers.openai.parse(200, { choices: [{ finish_reason: 'length', message: { content: 'a' } }] }).stop, 'max');
});
test('provider errors become short messages without echoing the key', () => {
    assert.throws(() => providers.anthropic.parse(401, { error: { message: 'invalid x-api-key ant-key-000000' } }), /rejected the API key$/);
    assert.throws(() => providers.openai.parse(429, {}), /rate limit/);
    assert.throws(() => providers.anthropic.parse(400, { error: { message: 'bad field' } }), /error 400: bad field/);
});
test('only the two provider hosts can be contacted', async () => {
    const seen = [];
    const handle = call({ host: 'evil.example', path: '/', headers: {}, body: {} }, { request: fakeHttps([], seen) });
    await assert.rejects(handle.promise, /not an allowed provider/);
    assert.equal(seen.length, 0);
});
test('rate limits and server errors are retried; client errors are not', async () => {
    let seen = [];
    let r = await call({ host: HOSTS.anthropic, path: '/v1/messages', headers: {}, body: { a: 1 } },
        { backoffMs: 0, request: fakeHttps([{ status: 529, body: {} }, { error: 'reset' }, { status: 200, body: { ok: true } }], seen) }).promise;
    assert.equal(seen.length, 3);
    assert.deepEqual(r, { status: 200, body: { ok: true } });
    assert.equal(seen[0].settings.method, 'POST');
    assert.equal(seen[0].settings.port, 443);
    seen = [];
    r = await call({ host: HOSTS.openai, path: '/v1/chat/completions', headers: {}, body: {} },
        { backoffMs: 0, request: fakeHttps([{ status: 400, body: { error: { message: 'no' } } }], seen) }).promise;
    assert.equal(seen.length, 1);
    assert.equal(r.status, 400);
});
test('an unreadable 200 reply is an error, and abort stops the request', async () => {
    await assert.rejects(call({ host: HOSTS.anthropic, path: '/', headers: {}, body: {} },
        { backoffMs: 0, request: fakeHttps([{ status: 200, body: '<html>' }], []) }).promise, /unreadable/);
    const handle = call({ host: HOSTS.anthropic, path: '/', headers: {}, body: {} },
        { request: fakeHttps([{ status: 200, body: {} }], []) });
    handle.abort();
    await assert.rejects(handle.promise, /Stopped/);
});
