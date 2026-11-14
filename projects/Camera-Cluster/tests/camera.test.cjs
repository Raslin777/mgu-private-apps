'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Camera, VIEWS, TRIES, applied, parking } = require('../apps/camera_cluster/camera');
const icam = require('../apps/camera_cluster/icam');

// A camera unit that does what `behaviour` says, and timers run by hand.
function rig(behaviour) {
    const b = Object.assign({ attach: 'ok', grant: true }, behaviour);
    const calls = [];
    const unit = { state: { application: 'IDLE', mode: 0, perspective: 0 } };
    const io = {
        attach() {
            calls.push('attach');
            if (b.attach === 'slow') return new Promise((resolve) => { unit.finishAttach = () => resolve(41); });
            return b.attach === 'ok' ? Promise.resolve(41) : Promise.reject(new Error('no camera service'));
        },
        change(cookie, view) {
            calls.push('change ' + cookie + ' ' + view);
            if (b.grant) unit.state = { application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: view };
            return Promise.resolve();
        },
        state() { calls.push('state'); return Promise.resolve(unit.state); },
        info() { return Promise.resolve(b.info === undefined ? { imageWidth: 1280, imageHeight: 720, framesPerSecond: 30 } : b.info); },
        detach(cookie) { calls.push('detach ' + cookie); unit.state = { application: 'IDLE', mode: 0, perspective: 0 }; return Promise.resolve(); }
    };
    const timers = new Map();
    let id = 0;
    const camera = new Camera({ io, setTimer: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimer: (t) => timers.delete(t) });
    // Runs the one pending timer and waits for everything it started.
    const tick = async () => {
        assert.equal(timers.size, 1, 'exactly one timer should be pending');
        const key = timers.keys().next().value, t = timers.get(key);
        timers.delete(key);
        await t.fn();
    };
    return { camera, calls, unit, timers, tick };
}

test('front: attach, ask for view 1, on once the camera unit confirms it', async () => {
    const r = rig();
    await r.camera.select(VIEWS.front);
    assert.equal(r.camera.state, 'asking');
    assert.deepEqual(r.calls, ['attach', 'change 41 1']);
    await r.tick();
    assert.equal(r.camera.state, 'on');
    assert.equal(r.camera.status().text, 'Front camera view is on');
    assert.equal(r.camera.status().stream, '1280 x 720, 30 a second');
});

test('a camera service that reports no size leaves the size empty', async () => {
    const r = rig({ info: { imageWidth: 0, imageHeight: 0 } });
    await r.camera.select(VIEWS.rear);
    await r.tick();
    assert.equal(r.camera.state, 'on');
    assert.equal(r.camera.status().stream, '');
});

test('rear is view 2 and reuses the attachment when switching', async () => {
    const r = rig();
    await r.camera.select(VIEWS.front);
    await r.tick();
    await r.camera.select(VIEWS.rear);
    await r.tick();
    assert.equal(r.camera.state, 'on');
    assert.deepEqual(r.calls.filter((c) => !c.startsWith('state')), ['attach', 'change 41 1', 'change 41 2']);
    assert.equal(r.unit.state.perspective, 2);
});

test('off gives the cameras back', async () => {
    const r = rig();
    await r.camera.select(VIEWS.front);
    await r.tick();
    await r.camera.select(VIEWS.off);
    assert.equal(r.camera.state, 'off');
    assert.equal(r.calls[r.calls.length - 1], 'detach 41');
    assert.equal(r.timers.size, 0);
});

test('a view that is never given is refused after ' + TRIES + ' asks, with the unit\'s state', async () => {
    const r = rig({ grant: false });
    await r.camera.select(VIEWS.front);
    for (let i = 0; i < TRIES; i++) await r.tick();
    assert.equal(r.camera.state, 'refused');
    assert.match(r.camera.text, /IDLE\/0\/0/);
    assert.equal(r.calls.filter((c) => c.startsWith('change')).length, TRIES);
    assert.equal(r.timers.size, 0);
});

test('no camera service: refused with the reason, nothing left attached', async () => {
    const r = rig({ attach: 'fail' });
    await r.camera.select(VIEWS.rear);
    for (let i = 0; i < TRIES - 1; i++) await r.tick();
    assert.equal(r.camera.state, 'refused');
    assert.match(r.camera.text, /no camera service/);
    assert.equal(r.camera.cookie, null);
});

test('a parking view pauses instead of fighting, and the view is asked again after it', async () => {
    const r = rig();
    await r.camera.select(VIEWS.front);
    await r.tick();
    r.unit.state = { application: 'RFK', mode: 1, perspective: 3 };       // the car shows its reversing camera
    await r.tick();
    assert.equal(r.camera.state, 'paused');
    const asks = r.calls.filter((c) => c.startsWith('change')).length;
    await r.tick();
    assert.equal(r.calls.filter((c) => c.startsWith('change')).length, asks, 'no request while the parking view is up');
    r.unit.state = { application: 'IDLE', mode: 0, perspective: 0 };
    await r.tick();
    assert.equal(r.camera.state, 'asking');
    await r.tick();
    assert.equal(r.camera.state, 'on');
});

test('switching off while the attach is under way still releases, and never asks for the view', async () => {
    const r = rig({ attach: 'slow' });
    const asking = r.camera.select(VIEWS.front);
    while (!r.calls.includes('attach')) await new Promise((resolve) => setImmediate(resolve));
    const off = r.camera.select(VIEWS.off);
    r.unit.finishAttach();
    await Promise.all([asking, off]);
    assert.equal(r.camera.state, 'off');
    assert.equal(r.camera.cookie, null);
    assert.deepEqual(r.calls, ['attach', 'detach 41']);
    assert.equal(r.timers.size, 0);
});

test('switching off before anything was sent sends nothing', async () => {
    const r = rig();
    const asking = r.camera.select(VIEWS.front);
    const off = r.camera.select(VIEWS.off);
    await Promise.all([asking, off]);
    assert.equal(r.camera.state, 'off');
    assert.deepEqual(r.calls, []);
});

test('state readers', () => {
    assert.equal(applied({ application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: 1 }, 1), true);
    assert.equal(applied({ application: 51, mode: 50, perspective: 2 }, 2), true);
    assert.equal(applied({ application: 'DR_ACTIVE', perspective: 5 }, 1), false);
    assert.equal(applied(null, 1), false);
    assert.equal(parking({ application: 'TOPREARVIEW' }), true);
    assert.equal(parking({ application: 'DR_ACTIVE' }), false);
});

test('icam: names first, numbers when the proxy refuses names', async () => {
    const sent = [];
    const proxy = { getValue: (field) => Promise.resolve({ field }) };
    const signals = {
        proxy: () => Promise.resolve(proxy),
        call(p, method, args) {
            sent.push([method, args]);
            if (method === 'changeState' && typeof args.desiredState.application === 'string') return Promise.reject(new Error('bad enum'));
            return Promise.resolve(method === 'clientAttach' ? { cookie: 9 } : {});
        }
    };
    const io = icam.create(signals);
    assert.equal(await io.attach(), 9);
    await io.change(9, 2);
    assert.deepEqual(sent[1], ['changeState', { cookie: 9, desiredState: { application: 'DR_ACTIVE', mode: 'MODE_MOSAIK', perspective: 2 } }]);
    assert.deepEqual(sent[2], ['changeState', { cookie: 9, desiredState: { application: 51, mode: 50, perspective: 2 } }]);
    assert.deepEqual(await io.state(), { field: 'currentState' });
    await io.detach(9);
    assert.deepEqual(sent[3], ['clientDetach', { cookie: 9 }]);
});
