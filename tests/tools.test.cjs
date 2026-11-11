'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Tools, validate, clip } = require('../apps/mgu_ai_terminal/tools');
const config = require('../apps/mgu_ai_terminal/config');

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'aiterm-')); }

test('root requires opt-in, and explicit false overrides an existing token', () => {
    const base = { provider: 'anthropic', anthropicKey: 'ant-key-000000' };
    assert.equal(config.validate(base).allowRoot, false);
    assert.equal(config.validate({ ...base, allowRoot: true }).allowRoot, true);
    assert.equal(config.validate({ ...base, rootToken: 'r'.repeat(64) }).allowRoot, true);
    assert.equal(config.validate({ ...base, rootToken: 'r'.repeat(64), allowRoot: false }).allowRoot, false);
});

test('dangling symlinks cannot redirect writes outside the workspace', () => {
    const base = temp(), workspace = path.join(base, 'workspace');
    fs.mkdirSync(workspace);
    const outside = path.join(base, 'outside.txt');
    let relative = 'link.txt';
    try { fs.symlinkSync(outside, path.join(workspace, relative), 'file'); }
    catch (e) {
        if (process.platform !== 'win32' || e.code !== 'EPERM') throw e;
        // Junctions exercise the same dangling-link case without Windows symlink privilege.
        fs.symlinkSync(path.join(base, 'absent-directory'), path.join(workspace, 'link'), 'junction');
        relative = 'link/escaped.txt';
    }
    assert.throws(() => new Tools(workspace).writeFile(relative, 'escaped'), /Symlinks/);
    assert.equal(fs.existsSync(outside), false);
    assert.equal(fs.existsSync(path.join(base, 'absent-directory')), false);
});

test('writing a hard-linked workspace file leaves the external file intact', () => {
    const base = temp(), workspace = path.join(base, 'workspace');
    fs.mkdirSync(workspace);
    const outside = path.join(base, 'outside.txt');
    fs.writeFileSync(outside, 'original');
    fs.linkSync(outside, path.join(workspace, 'link.txt'));
    new Tools(workspace).writeFile('link.txt', 'new');
    assert.equal(fs.readFileSync(outside, 'utf8'), 'original');
    assert.equal(fs.readFileSync(path.join(workspace, 'link.txt'), 'utf8'), 'new');
});

test('local Stop kills the process group and settles without a close event', async () => {
    const killed = [];
    let options;
    const spawn = (file, args, opts) => {
        options = opts;
        return Object.assign(new EventEmitter(), { pid: 23456, stdout: new EventEmitter(), stderr: new EventEmitter() });
    };
    const handle = new Tools(temp(), { spawn, kill: (pid, signal) => killed.push([pid, signal]) }).run('sleep 60', false);
    handle.abort();
    await assert.rejects(handle.promise, /Stopped/);
    assert.equal(options.detached, true);
    assert.deepEqual(killed, [[-23456, 'SIGKILL']]);
});

test('command timeout kills its process group', async () => {
    const killed = [];
    const spawn = () => Object.assign(new EventEmitter(), { pid: 23456, stdout: new EventEmitter(), stderr: new EventEmitter() });
    const result = await new Tools(temp(), { spawn, timeoutMs: 5, kill: pid => killed.push(pid) }).run('sleep 60', false).promise;
    assert.equal(result.code, 'timeout');
    assert.deepEqual(killed, [-23456]);
});

test('root client abort settles even if the socket never emits close', async () => {
    let destroyed = false;
    const socket = Object.assign(new EventEmitter(), { setEncoding() {}, destroy() { destroyed = true; } });
    const handle = new Tools(temp(), { connect: () => socket }).runRoot('id');
    handle.abort();
    await assert.rejects(handle.promise, /Stopped/);
    assert.equal(destroyed, true);
});

test('a silent root helper has a bounded deadline', async () => {
    let destroyed = false;
    const socket = Object.assign(new EventEmitter(), { setEncoding() {}, destroy() { destroyed = true; } });
    await assert.rejects(new Tools(temp(), { timeoutMs: 5, connect: () => socket }).runRoot('id').promise, /timed out/);
    assert.equal(destroyed, true);
});

test('tool input is validated against the declared fields', () => {
    assert.equal(validate('run_command', { command: 'ls', as_root: false, reason: 'r' }), null);
    assert.match(validate('run_command', { command: 'ls', reason: 'r' }), /as_root/);
    assert.match(validate('run_command', { command: 'ls', as_root: 'yes', reason: 'r' }), /boolean/);
    assert.match(validate('read_file', { path: 'a', extra: 1 }), /Unexpected field/);
    assert.match(validate('delete_everything', {}), /Unknown tool/);
    assert.match(validate('read_file', null), /object/);
});
test('files stay inside the workspace', () => {
    const base = temp();
    const workspace = path.join(base, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(base, 'config.json'), 'secret');
    const tools = new Tools(workspace);
    assert.equal(tools.writeFile('sub/dir/a.txt', 'hello'), 5);
    assert.equal(tools.readFile('sub/dir/a.txt'), 'hello');
    assert.throws(() => tools.readFile('../config.json'), /outside the workspace/);
    assert.throws(() => tools.writeFile('../x.txt', 'x'), /outside the workspace/);
    assert.throws(() => tools.readFile(path.join(base, 'config.json')), /outside the workspace/);
    assert.throws(() => tools.readFile(''), /Invalid path/);
    assert.throws(() => tools.writeFile('big.txt', 'x'.repeat(256 * 1024 + 1)), /larger than/);
    assert.throws(() => tools.readFile('sub'), /Not a file/);
});
test('a large file is cut with an explicit note, never silently', () => {
    const workspace = temp();
    fs.writeFileSync(path.join(workspace, 'big.log'), 'a'.repeat(70000));
    const text = new Tools(workspace).readFile('big.log');
    assert.match(text, /File is 70000 bytes; only the first 65536 are shown/);
    assert.match(clip('x'.repeat(100), 20), /80 characters left out/);
});
test('a local command runs in the workspace with a minimal environment', async () => {
    const calls = [];
    const spawn = (file, args, options) => {
        calls.push({ file, args, options });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        setImmediate(() => { child.stdout.emit('data', Buffer.from('hi\n')); child.stderr.emit('data', Buffer.from('warn\n')); child.emit('close', 3, null); });
        return child;
    };
    const workspace = temp();
    const result = await new Tools(workspace, { spawn }).run('echo hi', false).promise;
    assert.deepEqual(result, { code: 3, output: 'hi\nwarn\n' });
    assert.equal(calls[0].file, '/bin/sh');
    assert.deepEqual(calls[0].args, ['-c', 'echo hi']);
    assert.equal(calls[0].options.cwd, workspace);
    assert.deepEqual(Object.keys(calls[0].options.env).sort(), ['HOME', 'LANG', 'PATH']);
});
test('a root command goes to the helper with the token; refusals surface as errors', async () => {
    const written = [];
    const connect = reply => target => {
        const socket = new EventEmitter();
        socket.setEncoding = () => {};
        socket.destroy = () => {};
        socket.write = data => { written.push({ target, data }); setImmediate(() => { socket.emit('data', reply); socket.emit('close'); }); };
        setImmediate(() => socket.emit('connect'));
        return socket;
    };
    const options = { rootSocket: '/run/mgu-ai-root/root.sock', rootToken: 'token-0123456789' };
    let tools = new Tools(temp(), Object.assign({ connect: connect('{"ok":true,"code":0,"output":"root\\n"}\n') }, options));
    assert.deepEqual(await tools.runRoot('id').promise, { code: 0, output: 'root\n' });
    assert.equal(written[0].target, '/run/mgu-ai-root/root.sock');
    assert.deepEqual(JSON.parse(written[0].data), { token: 'token-0123456789', command: 'id', timeoutMs: 120000 });
    tools = new Tools(temp(), Object.assign({ connect: connect('{"ok":false,"error":"unauthorised"}\n') }, options));
    await assert.rejects(tools.runRoot('id').promise, /refused: unauthorised/);
    tools = new Tools(temp(), Object.assign({ connect: connect('') }, options));
    await assert.rejects(tools.runRoot('id').promise, /gave no answer/);
    assert.equal(new Tools(temp(), { rootSocket: '/nonexistent/sock', rootToken: 't' }).rootAvailable(), false);
    assert.equal(new Tools(temp(), {}).rootAvailable(), false);
});
test('with the bundled key, root commands go over SSH to this head unit only', async () => {
    const calls = [];
    const spawn = (file, args) => {
        calls.push({ file, args });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        setImmediate(() => { child.stdout.emit('data', Buffer.from('0\n')); child.emit('close', 0, null); });
        return child;
    };
    const dir = temp();
    const keyFile = path.join(dir, 'root_key');
    const sshPath = path.join(dir, 'ssh');
    fs.writeFileSync(keyFile, 'key');
    fs.writeFileSync(sshPath, '');
    const tools = new Tools(dir, { spawn, rootKeyFile: keyFile, sshPath });
    assert.equal(tools.rootMethod(), 'ssh');
    assert.deepEqual(await tools.run('id -u', true).promise, { code: 0, output: '0\n' });
    assert.equal(calls[0].file, sshPath);
    const args = calls[0].args;
    assert.deepEqual(args.slice(0, 2), ['-i', keyFile]);
    assert.deepEqual(args.slice(-3), ['root@127.0.0.1', '--', 'id -u']);
    assert.ok(args.includes('BatchMode=yes') && args.includes('IdentitiesOnly=yes'));
    // No SSH client on the head unit: root is simply unavailable.
    assert.equal(new Tools(dir, { rootKeyFile: keyFile, sshPath: path.join(dir, 'missing') }).rootAvailable(), false);
    // A provisioned helper is preferred over the key.
    const socket = path.join(dir, 'sock');
    fs.writeFileSync(socket, '');
    assert.equal(new Tools(dir, { rootKeyFile: keyFile, sshPath, rootSocket: socket, rootToken: 't' }).rootMethod(), 'helper');
});
test('config: provider keys are required, defaults applied, provider can be switched', () => {
    const dir = temp();
    assert.throws(() => config.load(dir), /Not set up/);
    const write = value => fs.writeFileSync(config.file(dir), JSON.stringify(value), { mode: 0o600 });
    write({ provider: 'anthropic', anthropicKey: 'ant-key-000000' });
    let loaded = config.load(dir);
    assert.equal(loaded.anthropicModel, 'claude-opus-5-5');
    assert.equal(loaded.maxSteps, 12);
    assert.equal(loaded.rootToken, null);
    assert.throws(() => config.setProvider(dir, 'openai'), /No OpenAI API key/);
    assert.equal(config.load(dir).provider, 'anthropic');
    write({ provider: 'openai', openaiKey: 'oai-key-000000' });
    assert.throws(() => config.load(dir), /Set openaiModel/);
    write({ provider: 'anthropic', anthropicKey: 'ant-key-000000', openaiKey: 'oai-key-000000', openaiModel: 'm', rootToken: 'r'.repeat(64) });
    loaded = config.setProvider(dir, 'openai');
    assert.equal(loaded.provider, 'openai');
    assert.equal(config.load(dir).provider, 'openai');
    assert.deepEqual(config.secrets(loaded), ['ant-key-000000', 'oai-key-000000', 'r'.repeat(64)]);
    write({ provider: 'other' });
    assert.throws(() => config.load(dir), /provider must be/);
    fs.writeFileSync(config.file(dir), '{nope');
    assert.throws(() => config.load(dir), /not valid JSON/);
});
