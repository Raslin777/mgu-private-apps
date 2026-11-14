'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { Feed } = require('../apps/camera_cluster/feed');

let serial = 0;
function address() {
    serial++;
    return process.platform === 'win32' ? '\\\\.\\pipe\\camera-cluster-test-' + process.pid + '-' + serial
        : path.join(os.tmpdir(), 'camera-cluster-test-' + process.pid + '-' + serial + '.sock');
}
const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(fn(), 'timed out'); };

// The feed tool's side of the socket: records commands, answers with a status.
async function tool() {
    const received = [], sockets = [];
    const server = net.createServer((socket) => {
        sockets.push(socket);
        socket.on('error', () => {});
        socket.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach((line) => {
            const m = JSON.parse(line);
            received.push(m);
            socket.write('{"ev":"log","line":"x"}\n' + JSON.stringify({
                ev: 'status', state: m.on === '1' ? 'showing' : 'off', target: 'map', reason: m.on === '1' ? '' : 'turned off', cluster: m.on === '1' ? 1 : 0
            }) + '\n');
        }));
    });
    const file = address();
    await new Promise((resolve) => server.listen(file, resolve));
    return { file, received, sockets, close: () => { sockets.forEach((s) => s.destroy()); return new Promise((r) => server.close(r)); } };
}

test('says what is wanted on connect and reads the status back', async () => {
    const t = await tool();
    const feed = new Feed({ path: t.file });
    feed.start();
    await until(() => feed.status().link === 'connected' && t.received.length === 1);
    assert.deepEqual(t.received[0], { cmd: 'cluster', on: '0' });
    feed.show(true);
    await until(() => feed.status().state === 'showing');
    assert.deepEqual(t.received[1], { cmd: 'cluster', on: '1' });
    assert.equal(feed.status().cluster, true);
    feed.show(true);                                  // no change: nothing sent
    feed.show(false);
    await until(() => feed.status().state === 'off');
    assert.equal(t.received.length, 3);
    assert.equal(feed.status().reason, 'turned off');
    feed.stop();
    await t.close();
});

test('stop takes the picture off before leaving', async () => {
    const t = await tool();
    const feed = new Feed({ path: t.file });
    feed.start();
    feed.show(true);
    await until(() => feed.status().state === 'showing');
    feed.stop();
    await until(() => t.received.length === 2);
    assert.deepEqual(t.received[1], { cmd: 'cluster', on: '0' });
    assert.equal(feed.status().link, 'not started');
    await t.close();
});

test('tool not installed: says so and keeps trying without piling up timers', async () => {
    const timers = [];
    const feed = new Feed({ path: address(), setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
    feed.start();
    await until(() => timers.length === 1);
    assert.equal(feed.status().link, 'feed tool not installed');
    assert.equal(timers[0].ms, 500);
    timers.shift().fn();
    await until(() => timers.length === 1);
    assert.equal(timers[0].ms, 1000);
    feed.stop();
});

test('reconnects after the tool restarts and repeats the wish', async () => {
    const t = await tool();
    const timers = [];
    const feed = new Feed({ path: t.file, setTimer: (fn, ms) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
    feed.start();
    feed.show(true);
    await until(() => feed.status().state === 'showing');
    t.sockets[0].destroy();
    await until(() => timers.length === 1);
    assert.equal(feed.status().link, 'feed tool not answering');
    assert.equal(feed.status().state, '');
    timers.shift()();
    await until(() => t.received.length === 2 && feed.status().state === 'showing');
    assert.deepEqual(t.received[1], { cmd: 'cluster', on: '1' });
    feed.stop();
    await t.close();
});

test('ignores lines that are not JSON objects and oversized garbage', async () => {
    const feed = new Feed({ connect: () => { throw new Error('unused'); } });
    feed._data(Buffer.from('not json\n[1,2]\n{"ev":"status","state":"starting","reason":"the stock map holds the slot","cluster":1}\n'));
    assert.equal(feed.status().state, 'starting');
    feed._data(Buffer.alloc(20000, 0x61));
    assert.equal(feed.buffer, '');
});
