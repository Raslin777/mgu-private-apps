'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

test('a late close after spawn error cannot release another command lock', () => {
    const children = [];
    const fakeFs = {
        existsSync: () => false,
        statSync: () => ({ uid: 0, mode: 0o600 }),
        readFileSync: () => 't'.repeat(64), appendFileSync() {}
    };
    const context = {
        module: { exports: {} }, process: { env: {}, kill() {} }, console,
        setTimeout: () => 1, clearTimeout() {},
        require(name) {
            if (name === 'fs') return fakeFs;
            if (name === './safety') return require('../apps/mgu_ai_terminal/safety');
            if (name === 'child_process') return { spawn() {
                const child = Object.assign(new EventEmitter(), { pid: 123, stdout: new EventEmitter(), stderr: new EventEmitter() });
                children.push(child); return child;
            } };
            return require(name);
        }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../native/mgu-ai-root/helper.js'), 'utf8'), context);
    function send() {
        const socket = Object.assign(new EventEmitter(), {
            setEncoding() {}, setTimeout() {}, end(text) { this.reply = JSON.parse(text); }
        });
        context.module.exports.handle(socket);
        socket.emit('data', JSON.stringify({ token: 't'.repeat(64), command: 'id' }) + '\n');
        return socket;
    }
    const first = send();
    children[0].emit('error', new Error('spawn failed'));
    assert.equal(first.reply.code, 127);
    const second = send();
    children[0].emit('close', 127, null);
    const third = send();
    assert.equal(children.length, 2);
    assert.match(third.reply.error, /another root command/);
    children[1].emit('close', 0, null);
    assert.equal(second.reply.code, 0);
    send();
    assert.equal(children.length, 3);
});
