'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { PhoneLink, PAGE } = require('../apps/mgu_ai_terminal/link');
const config = require('../apps/mgu_ai_terminal/config');
const { draw } = require('../apps/mgu_ai_terminal/view');

// A real server on loopback; "addresses" stands in for the head unit's hotspot address.
async function fixture(extra) {
    const calls = [];
    let clock = 1000;
    const link = new PhoneLink(Object.assign({
        port: 0, now: () => clock, addresses: () => ['127.0.0.1'],
        handlers: {
            state: () => ({ configured: true, status: 'Ready', busy: false, lines: ['> hi'], approval: null }),
            setup: fields => calls.push(['setup', fields]),
            ask: text => { if (text === 'bad') throw new Error('Request blocked'); calls.push(['ask', text]); },
            stop: () => calls.push(['stop']),
            reset: () => calls.push(['reset'])
        }
    }, extra || {}));
    await link.start();
    const request = (method, url, body, headers) => new Promise((resolve, reject) => {
        const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
        const req = http.request({ host: '127.0.0.1', port: link.port, method, path: url,
            headers: Object.assign(data === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, headers || {}) }, res => {
            let text = '';
            res.on('data', c => { text += c; });
            res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { json = null; } resolve({ status: res.statusCode, json, text, headers: res.headers }); });
        });
        req.on('error', reject);
        req.end(data);
    });
    return { link, calls, request, advance(ms) { clock += ms; } };
}

test('the page loads without a code, but nothing else works until the phone is paired', async () => {
    const f = await fixture();
    try {
        const page = await f.request('GET', '/');
        assert.equal(page.status, 200);
        assert.match(page.headers['content-type'], /text\/html/);
        assert.match(page.headers['content-security-policy'], /default-src 'none'/);
        assert.equal(page.headers['cache-control'], 'no-store');
        assert.equal(page.text, PAGE);
        assert.equal((await f.request('GET', '/api/state')).status, 401);
        assert.equal((await f.request('POST', '/api/ask', { text: 'ls' })).status, 401);
        assert.equal((await f.request('POST', '/api/setup', { provider: 'anthropic' })).status, 401);
        assert.equal((await f.request('POST', '/api/ask', { text: 'ls' }, { 'x-link-token': 'guess' })).status, 401);
        assert.equal(f.calls.length, 0);
    } finally { f.link.stop(); }
});
test('the code on the car screen pairs one phone; the code is then replaced', async () => {
    const f = await fixture();
    try {
        const code = f.link.code;
        assert.match(code, /^[0-9]{6}$/);
        assert.equal(f.link.info().url, 'http://127.0.0.1:' + f.link.port + '/#' + code);
        assert.equal(f.link.paired, false);
        const paired = await f.request('POST', '/api/pair', { code });
        assert.equal(paired.status, 200);
        assert.match(paired.json.token, /^[0-9a-f]{64}$/);
        assert.equal(f.link.paired, true);
        assert.notEqual(f.link.code, code);
        assert.equal((await f.request('POST', '/api/pair', { code })).status, 403);
        const auth = { 'x-link-token': paired.json.token };
        const state = await f.request('GET', '/api/state', undefined, auth);
        assert.deepEqual(state.json, { configured: true, status: 'Ready', busy: false, lines: ['> hi'], approval: null });
        assert.equal((await f.request('POST', '/api/ask', { text: 'list files' }, auth)).status, 200);
        assert.equal((await f.request('POST', '/api/stop', {}, auth)).status, 200);
        assert.equal((await f.request('POST', '/api/new', {}, auth)).status, 200);
        assert.equal((await f.request('POST', '/api/setup', { provider: 'openai' }, auth)).status, 200);
        assert.deepEqual(f.calls, [['ask', 'list files'], ['stop'], ['reset'], ['setup', { provider: 'openai' }]]);
        const refused = await f.request('POST', '/api/ask', { text: 'bad' }, auth);
        assert.equal(refused.status, 400);
        assert.equal(refused.json.error, 'Request blocked');
        // A second phone pairing takes over; the first phone's token stops working.
        const second = await f.request('POST', '/api/pair', { code: f.link.code });
        assert.equal(second.status, 200);
        assert.equal((await f.request('GET', '/api/state', undefined, auth)).status, 401);
    } finally { f.link.stop(); }
});
test('five wrong codes lock pairing and change the code', async () => {
    const f = await fixture();
    try {
        const code = f.link.code;
        const wrong = code === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i++) assert.equal((await f.request('POST', '/api/pair', { code: wrong })).status, 403);
        assert.notEqual(f.link.code, code);
        assert.equal((await f.request('POST', '/api/pair', { code: f.link.code })).status, 429);
        f.advance(31000);
        assert.equal((await f.request('POST', '/api/pair', { code: f.link.code })).status, 200);
    } finally { f.link.stop(); }
});
test('requests must be JSON, small, and addressed to the head unit by IP', async () => {
    const f = await fixture();
    try {
        const token = (await f.request('POST', '/api/pair', { code: f.link.code })).json.token;
        const auth = { 'x-link-token': token };
        assert.equal((await f.request('POST', '/api/ask', 'text=ls', Object.assign({ 'content-type': 'application/x-www-form-urlencoded' }, auth))).status, 415);
        assert.equal((await f.request('POST', '/api/ask', '{broken', auth)).status, 400);
        assert.equal((await f.request('POST', '/api/ask', '[1]', auth)).status, 400);
        assert.equal((await f.request('POST', '/api/ask', { text: 'x'.repeat(20000) }, auth)).status, 413);
        assert.equal((await f.request('GET', '/', undefined, { host: 'evil.example:' + f.link.port })).status, 403);
        assert.equal((await f.request('POST', '/api/pair', { code: f.link.code }, { host: 'evil.example' })).status, 403);
        assert.equal((await f.request('GET', '/other')).status, 404);
        assert.equal((await f.request('POST', '/api/unknown', {}, auth)).status, 404);
        assert.equal((await f.request('DELETE', '/api/state', undefined, auth)).status, 404);
        assert.equal(f.calls.length, 0);
    } finally { f.link.stop(); }
});
test('turning the link off forgets the paired phone', async () => {
    const f = await fixture();
    const token = (await f.request('POST', '/api/pair', { code: f.link.code })).json.token;
    f.link.stop();
    assert.equal(f.link.running, false);
    assert.equal(f.link.paired, false);
    await f.link.start();
    try {
        assert.equal((await f.request('GET', '/api/state', undefined, { 'x-link-token': token })).status, 401);
    } finally { f.link.stop(); }
});
test('the page never contains a key, and shows only what the state handler gives it', () => {
    assert.equal(/sk-|PRIVATE KEY|rootToken/.test(PAGE), false);
    assert.match(PAGE, /Approve or deny on the car screen/);
});
test('settings from the phone: keys are saved once and kept when left out', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiterm-link-'));
    assert.throws(() => config.update(dir, { provider: 'anthropic' }), /No Anthropic API key/);
    assert.equal(fs.existsSync(config.file(dir)), false);
    assert.throws(() => config.update(dir, { provider: 'other' }), /Choose Claude or OpenAI/);
    assert.throws(() => config.update(dir, { provider: 'anthropic', anthropicKey: 'x y' }), /does not look right/);
    let saved = config.update(dir, { provider: 'anthropic', anthropicKey: 'ant-key-000000', allowRoot: true });
    assert.equal(saved.provider, 'anthropic');
    assert.equal(saved.allowRoot, true);
    assert.equal(config.load(dir).anthropicKey, 'ant-key-000000');
    assert.throws(() => config.update(dir, { provider: 'openai' }), /No OpenAI API key/);
    assert.equal(config.load(dir).provider, 'anthropic');
    saved = config.update(dir, { provider: 'openai', openaiKey: 'oai-key-000000', openaiModel: 'some-model', allowRoot: false });
    assert.equal(saved.provider, 'openai');
    assert.equal(saved.anthropicKey, 'ant-key-000000');
    assert.equal(saved.allowRoot, false);
    assert.throws(() => config.update(dir, { provider: 'openai', openaiModel: 'bad model!' }), /model id/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(config.file(dir)).mode & 0o777, 0o600);
});
test('the pairing screen shows the QR code, address and code; an approval still takes over', () => {
    const texts = [];
    let fills = 0;
    const cv = { clear() {}, fillRect() { fills++; }, text(t) { texts.push(String(t)); } };
    const link = { url: 'http://172.16.222.97:8377/#123456', shown: 'http://172.16.222.97:8377/', code: '123456', others: [] };
    draw(cv, { status: 'Not set up', lines: ['x'], approvals: [], configured: false }, 0, link);
    assert.ok(fills > 100);
    assert.ok(texts.includes('http://172.16.222.97:8377/'));
    assert.ok(texts.includes('123456'));
    assert.ok(texts.includes('Set up with your phone'));
    texts.length = 0;
    draw(cv, { status: '', lines: [], configured: true, approvals: [{ id: 1, command: 'ls', root: false, reason: 'r', flags: [] }] }, 0, link);
    assert.ok(texts.includes('ls'));
    assert.equal(texts.includes('123456'), false);
    texts.length = 0;
    draw(cv, { status: '', lines: [], approvals: [] }, 0, { url: null, shown: null, code: '1', others: [] });
    assert.ok(texts.includes('Phone link needs a network'));
});
