'use strict';
// Execute under a verified Node 8 binary (the head unit runs Node 8.16.2).
// Loads every module the app ships except main.js (which needs the app kit and
// BMW's SDK) and drives one selection end to end: feed link over a real Unix
// socket or named pipe, camera request against a simulated camera unit, screen.
const assert = require('assert');
const net = require('net');
const os = require('os');
const path = require('path');
const app = path.join(__dirname, '..', 'apps', 'camera_cluster');
const cameras = require(path.join(app, 'camera'));
const icam = require(path.join(app, 'icam'));
const Feed = require(path.join(app, 'feed')).Feed;
const view = require(path.join(app, 'view'));

function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function check() {
    // A simulated camera unit behind the app kit's signals interface.
    const calls = [];
    let current = { application: 'SIGNAL_UNFILLED', mode: 0, perspective: 255 };
    const proxy = { getValue: function () { return Promise.resolve(current); } };
    const signals = {
        proxy: function (iface, instance) { calls.push(iface + '#' + instance); return Promise.resolve(proxy); },
        call: function (p, method, args) {
            calls.push(method);
            if (method === 'clientAttach') return Promise.resolve({ cookie: 7 });
            if (method === 'changeState') { current = { application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: args.desiredState.perspective }; }
            if (method === 'clientDetach') { current = { application: 'IDLE', mode: 0, perspective: 0 }; }
            return Promise.resolve({});
        }
    };

    // A simulated feed tool.
    const sockPath = process.platform === 'win32' ? '\\\\.\\pipe\\camera-cluster-node8-' + process.pid
        : path.join(os.tmpdir(), 'camera-cluster-node8-' + process.pid + '.sock');
    const received = [];
    const server = net.createServer(function (socket) {
        socket.on('data', function (d) {
            d.toString().split('\n').filter(Boolean).forEach(function (line) {
                const m = JSON.parse(line);
                received.push(m);
                socket.write(JSON.stringify({ ev: 'status', state: m.on === '1' ? 'showing' : 'off', reason: '', cluster: m.on === '1' ? 1 : 0 }) + '\n');
            });
        });
        socket.on('error', function () {});
    });
    await new Promise(function (resolve) { server.listen(sockPath, resolve); });

    const feed = new Feed({ path: sockPath });
    const timers = [];
    const camera = new cameras.Camera({
        io: icam.create(signals),
        setTimer: function (fn) { timers.push(fn); return timers.length; },
        clearTimer: function () {}
    });
    camera.on('change', function () { feed.show(camera.want !== 0 && camera.state === 'on'); });

    feed.start();
    await camera.select(cameras.VIEWS.rear);
    assert.equal(camera.state, 'asking');
    await timers.pop()();                       // the state check
    assert.equal(camera.state, 'on');
    await wait(100);
    assert.deepEqual(received[received.length - 1], { cmd: 'cluster', on: '1' });
    assert.equal(feed.status().state, 'showing');

    const texts = [];
    const top = view.draw({ clear: function () {}, fillRect: function () {}, text: function (t) { texts.push(t); } },
        { camera: camera.status(), feed: feed.status() });
    assert.equal(top.text, 'Rear camera is on the cluster.');

    feed.show(false);
    await camera.select(cameras.VIEWS.off);
    assert.equal(camera.state, 'off');
    await wait(100);
    assert.deepEqual(received[received.length - 1], { cmd: 'cluster', on: '0' });
    assert.deepEqual(calls, ['de.bmw.infotainment.video.cameraproxy.ICAM2Proxy#1', 'clientAttach', 'changeState', 'clientDetach']);
    feed.stop();
    server.close();
    console.log('Node ' + process.version + ': camera request, feed link and screen checks passed');
}
check().then(function () { process.exit(0); }, function (error) { console.error(error); process.exit(1); });
