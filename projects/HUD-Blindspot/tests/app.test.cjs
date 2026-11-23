'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const app = path.join(__dirname, '..', 'apps', 'hud_blindspot');
const spec = JSON.parse(fs.readFileSync(path.join(app, 'app.json')));
const { FIELD, MIRROR_EVENT, VIEW_IFACE, VIEW_EVENT } = require('../apps/hud_blindspot/warnings');
const quiet = { info() {}, warn() {} };

test('boot/background operation works with no RHMI screen; enable persists and shutdown releases all resources', async () => {
    let implementation, timer, cleared = false, proxyClosed = false;
    const clients = [], handlers = {}, buttons = {};
    const settings = { values: Object.fromEntries(spec.settings.map(s => [s.key, s.default])), listeners: [],
        get(k) { return this.values[k]; }, set(k, v) { this.values[k] = v; this.listeners.forEach(fn => fn(k, v)); },
        onChange(fn) { this.listeners.push(fn); } };
    settings.values.source = 'someip';
    class Renderer extends EventEmitter {
        constructor() { super(); clients.push(this); this.ready = true; this.targets = 'hud:800x480'; this.layers = new Map(); this.next = 1; }
        connect() { this.emit('ready'); } close() { this.closed = true; this.layers.clear(); }
        image(o) { const ref = this.next++; this.layers.set(ref, o); return ref; }
        pixels() {} set(ref, o) { Object.assign(this.layers.get(ref), o); } drop(ref) { this.layers.delete(ref); }
    }
    const fakeProcess = new EventEmitter();
    vm.runInNewContext(fs.readFileSync(path.join(app, 'main.js'), 'utf8'), {
        require(name) {
            if (name === './kit/mgu') return { run(config) { implementation = config; } };
            if (name === './cluster_render_client') return { ClusterRender: Renderer };
            return require(path.join(app, name));
        }, process: fakeProcess, Date, setInterval(fn) { timer = fn; return 1; }, clearInterval() { cleared = true; }
    });
    const platform = new EventEmitter();
    const bg = await implementation.background({ app: platform, settings, log: quiet, signals: {
        async proxy() { return { shutdown() { proxyClosed = true; } }; },
        async onAvailable(p, fn) { fn(true); }, async on(p, name, fn) { handlers[name] = fn; }
    } });
    assert.equal(clients.length, 0); assert.equal(bg.model().enabled, false);
    handlers[FIELD]({ qualifierLaneChangeWarning: 9,
        statusLaneChangeWarning: { statusLaneChangeWarningLeft: 1, statusLaneChangeWarningRight: 0 } });
    handlers[MIRROR_EVENT]({ requestExteriorMirrorDisplayWarningLeftHand: 1 });
    settings.set('enabled', true); timer();
    assert.equal(clients.length, 1); assert.equal(clients[0].layers.size, 2);
    assert.equal(bg.model().warning.left, 1);
    // Foreground is only controls/display; it does not own the warning timer.
    let draws = 0; const opened = [], labels = {};
    await implementation.start({ background: bg, settings, log: quiet,
        ui: { onClick(id, fn) { buttons[id] = fn; }, image() { draws++; },
            async open(name) { opened.push(name); }, async text(name, value) { labels[name] = value; } },
        canvas() { return { clear() {}, text() {}, roundRect() {} }; }, loop(state, fps, fn) { fn(); } });
    for (const [id] of spec.screens[0].buttons) assert.equal(typeof buttons[id], 'function');
    buttons.BTN_SIZE(); buttons.BTN_OPACITY(); buttons.BTN_HEIGHT(); assert.equal(draws, 1);
    assert.equal(settings.get('size'), 'medium'); assert.equal(settings.get('opacity'), '85'); assert.equal(settings.get('height'), '60');
    await buttons.BTN_POSITION(); assert.equal(opened[0], 'POSITION'); assert.match(labels.POS_TARGET, /Move: Both/);
    for (const item of spec.screens.find(s => s.name === 'POSITION').items) assert.equal(typeof buttons[item[1]], 'function');
    await buttons.POS_RIGHT(); await buttons.POS_UP();
    const both = settings.get('positions'); assert.ok(both.left.x > 0 && both.right.x > 0);
    assert.ok(both.left.y < 0 && both.right.y < 0);
    await buttons.POS_TARGET(); assert.equal(settings.get('positionTarget'), 'left');
    await buttons.POS_RESET(); assert.deepEqual(settings.get('positions').left, { x: 0, y: 0 });
    assert.deepEqual(settings.get('positions').right, both.right);
    await buttons.POS_DOWN(); assert.ok(settings.get('positions').left.y > 0);
    await buttons.POS_LEFT(); assert.ok(settings.get('positions').left.x < 0);
    await buttons.POS_BACK(); assert.equal(opened[1], 'MAIN');
    buttons.BTN_DISABLE(); assert.equal(clients[0].closed, true); assert.equal(bg.model().enabled, false);
    platform.emit('shutdown'); await Promise.resolve(); await Promise.resolve();
    assert.equal(cleared, true); assert.equal(proxyClosed, true);
    const count = clients.length; buttons.BTN_ENABLE(); timer(); assert.equal(clients.length, count);
});

const schemaPath = process.env.HUD_BLINDSPOT_SCHEMA;
test('declared fields, event outputs, enum values and access modes match the local HU schema',
    { skip: !schemaPath && 'set HUD_BLINDSPOT_SCHEMA to the owner-supplied SOME/IP schema' }, () => {
        const schema = JSON.parse(fs.readFileSync(schemaPath));
        const name = 'de.bmw.dass.driverassistanceapplications.LateralCollisionAvoidance';
        const iface = schema.interfaces[name];
        assert.equal(schema.instanceIDs[name]['1'], 1);
        assert.ok(iface.fields[FIELD].notifier); assert.equal(iface.fields[FIELD].getter, undefined);
        assert.equal(spec.signals[name][FIELD], 's'); assert.deepEqual(spec.signals[name]._broadcasts, [MIRROR_EVENT]);
        const outputs = iface.events[MIRROR_EVENT].outputs.map(v => v.name);
        assert.ok(outputs.includes('requestExteriorMirrorDisplayWarningLeftHand'));
        assert.ok(outputs.includes('requestExteriorMirrorDisplayWarningRightHand'));
        const struct = schema.datatypes[iface.fields[FIELD].dataRef];
        const warningType = struct.members.find(m => m.name === 'statusLaneChangeWarning').dataRef;
        const sides = schema.datatypes[warningType];
        const left = schema.datatypes[sides.members.find(m => m.name === 'statusLaneChangeWarningLeft').dataRef].items;
        assert.deepEqual(left, { ACUTE_WARNING_LEFT: 2, ACUTE_WARNING_LEFT_AND_STEERING: 3, NO_WARNING_LEFT: 0, WARNING_LEFT: 1 });
        const qualifierType = struct.members.find(m => m.name === 'qualifierLaneChangeWarning').dataRef;
        assert.equal(schema.datatypes[qualifierType].items.FUNCTION_ACTIVE, 9);
        assert.equal(schema.datatypes[qualifierType].items.FUNCTION_ACTIVE_REDUCED, 11);
        const tasu = 'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu';
        assert.equal(spec.signals[tasu]._instances, 'SystemFunctionsInternalTasuInst1');
        assert.deepEqual(spec.signals[tasu]._methods, ['sendTasuRequest']);
        assert.deepEqual(spec.signals[tasu]._broadcasts, ['sendTasuResponse']);
        assert.ok(schema.interfaces[tasu].methods.sendTasuRequest);
        const view = schema.interfaces[VIEW_IFACE];
        assert.equal(view.serviceId, 0x3043); assert.equal(schema.instanceIDs[VIEW_IFACE]['1'], 1);
        assert.deepEqual(spec.signals[VIEW_IFACE]._broadcasts, [VIEW_EVENT]);
        const warningRef = view.events[VIEW_EVENT].outputs.find(v => v.name === 'statusLaneChangeWarning').dataRef;
        const warning = schema.datatypes[warningRef];
        for (const [member, expected] of [
            ['qualifierLaneChangeWarning', { FUNCTION_ACTIVE: 9, FUNCTION_ACTIVE_REDUCED: 11, FUNCTION_AVAILABLE: 1,
                FUNCTION_AVAILABLE_REDUCED: 3, FUNCTION_NOT_AVAILABLE: 14, FUNCTION_NOT_AVAILABLE_ERROR: 6, INVALID: 15 }],
            ['statusLaneChangeWarningLeft', left],
            ['statusLaneChangeWarningRight', { ACUTE_WARNING_RIGHT: 2, FUNCTION_ACTIVE_ACUTE_WARNING_RIGHT_AND_STEERING: 3,
                NO_WARNING_RIGHT: 0, WARNING_RIGHT: 1 }]]) {
            assert.deepEqual(schema.datatypes[warning.members.find(m => m.name === member).dataRef].items, expected);
        }
        assert.equal(Object.keys(spec.signals).length, 3);
    });

test('manifest has saved controls, background start and only the read adapter can call the diagnostic method', () => {
    assert.equal(spec.autostart, true); assert.equal(spec.settings.find(s => s.key === 'enabled').default, false);
    assert.equal(spec.screens.filter(s => s.kind === 'canvas').length, 1);
    assert.equal(spec.settings.find(s => s.key === 'source').default, 'auto');
    assert.ok(Object.values(spec.signals).every(signal => signal._optional));
    for (const file of fs.readdirSync(app).filter(f => /\.js$/.test(f) && f !== 'cluster_render_client.js')) {
        const code = fs.readFileSync(path.join(app, file), 'utf8');
        assert.ok(!/signals\.set\(|child_process|execSync/.test(code), file);
        if (file !== 'uds.js') assert.ok(!/signals\.call\(|sendTasuRequest/.test(code), file);
    }
});

test('with D347 test mode chosen, the background uses the real D347 reader and releases it when disabled', async t => {
    let implementation; const handlers = {}, calls = [], appEvents = new EventEmitter();
    t.after(() => appEvents.emit('shutdown'));
    const values = Object.fromEntries(spec.settings.map(s => [s.key, s.default])); values.enabled = true; values.source = 'uds';
    const listeners = [];
    const settings = { get: k => values[k], onChange: fn => listeners.push(fn),
        set(k, v) { values[k] = v; listeners.forEach(fn => fn(k, v)); } };
    class Renderer extends EventEmitter {
        constructor() { super(); this.ready = true; this.targets = 'hud:800x480'; this.ref = 0; }
        connect() {} close() {} image() { return ++this.ref; } pixels() {} set() {} drop() {}
    }
    vm.runInNewContext(fs.readFileSync(path.join(app, 'main.js'), 'utf8'), {
        require(name) {
            if (name === './kit/mgu') return { run(config) { implementation = config; } };
            if (name === './cluster_render_client') return { ClusterRender: Renderer };
            return require(path.join(app, name));
        }, process: new EventEmitter(), Date, setInterval() { return 1; }, clearInterval() {}
    });
    const model = await implementation.background({ app: appEvents, settings, log: quiet, signals: {
        async proxy(iface) {
            if (iface.endsWith('LateralCollisionAvoidance')) throw new Error('interface not on this HU');
            return { shutdown() {} };
        },
        async on(p, name, fn) { handlers[name] = fn; }, async onAvailable(p, fn) { fn(true); },
        async call(p, name, args) {
            calls.push(args);
            setImmediate(() => handlers.sendTasuResponse({ errorCode: 'NO_ERROR',
                udsResponse: Buffer.from([0xf0, 0xf2, 0x71, 1, 0xf, 0xb, 0x40, 0, 5, 0x62, 0xd3, 0x47, 4, 0]) }));
            return 'NO_ERROR';
        }
    } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1); assert.equal(calls[0].serviceID, 0x22);
    assert.equal(model.model().warning.source, 'UDS D347');
    assert.equal(model.model().warning.left, 2); assert.equal(model.model().warning.right, 0);
    assert.equal(model.model().diagnostic.trace.rx, '62 D3 47 04 00');
    settings.set('enabled', false); assert.equal(model.model().warning.valid, false);
});

test('Auto holds the SOME/IP field value, never polls diagnostics, and D347 runs only in its test mode', async t => {
    let implementation, timer, now = 0; const handlers = {}, calls = [], events = new EventEmitter();
    t.after(() => events.emit('shutdown'));
    const values = Object.fromEntries(spec.settings.map(s => [s.key, s.default])), listeners = [];
    const settings = { get: k => values[k], onChange: fn => listeners.push(fn),
        set(k, v) { values[k] = v; listeners.forEach(fn => fn()); } };
    const warnings = require('../apps/hud_blindspot/warnings');
    class State extends warnings.WarningState { constructor(_, maxAge) { super(() => now, maxAge); } }
    class Renderer extends EventEmitter {
        constructor() { super(); this.ready = true; this.targets = 'hud:800x480'; this.ref = 0; }
        connect() {} close() {} image() { return ++this.ref; } pixels() {} set() {} drop() {}
    }
    vm.runInNewContext(fs.readFileSync(path.join(app, 'main.js'), 'utf8'), {
        require(name) {
            if (name === './kit/mgu') return { run(config) { implementation = config; } };
            if (name === './cluster_render_client') return { ClusterRender: Renderer };
            if (name === './warnings') return Object.assign({}, warnings, { WarningState: State });
            return require(path.join(app, name));
        }, process: new EventEmitter(), Date, setInterval(fn) { timer = fn; return 1; }, clearInterval() {}
    });
    const bg = await implementation.background({ app: events, settings, log: quiet, signals: {
        async proxy() { return { shutdown() {} }; }, async onAvailable(p, fn) { fn(true); },
        async on(p, name, fn) { handlers[name] = fn; },
        async call(p, name, args) {
            calls.push(args);
            setImmediate(() => handlers.sendTasuResponse({ errorCode: 'NO_ERROR',
                udsResponse: Buffer.from([0xf0, 0xf2, 0x71, 1, 0xf, 0xb, 0x40, 0, 5, 0x62, 0xd3, 0x47, 0, 1]) }));
            return 'NO_ERROR';
        }
    } });
    const emit = (left, qualifier = 9) => handlers[FIELD]({ qualifierLaneChangeWarning: qualifier,
        statusLaneChangeWarning: { statusLaneChangeWarningLeft: left, statusLaneChangeWarningRight: 0 } });
    emit(1); settings.set('enabled', true); timer();
    assert.equal(calls.length, 0); assert.equal(bg.model().warning.source, 'SOME/IP'); assert.equal(bg.model().warning.left, 1);
    // A field is state: with no further notification the warning is still the warning a minute later.
    now = 60000; timer();
    assert.equal(calls.length, 0); assert.equal(bg.model().warning.source, 'SOME/IP');
    assert.equal(bg.model().warning.valid, true); assert.equal(bg.model().warning.left, 1);
    assert.equal(bg.model().someip.held, true); assert.equal(bg.model().someip.updates, 1);
    emit(0); timer(); assert.equal(bg.model().warning.left, 0); assert.equal(bg.model().warning.valid, true);
    emit(0, 6); timer(); assert.equal(bg.model().warning.valid, false); assert.equal(calls.length, 0);
    assert.equal(bg.model().warning.source, 'SOME/IP'); assert.equal(bg.model().someip.sample.qualifier, 6);
    // The Assisted View event still expires.
    handlers[VIEW_EVENT]({ statusLaneChangeWarning: { qualifierLaneChangeWarning: 9,
        statusLaneChangeWarningLeft: 0, statusLaneChangeWarningRight: 2 } });
    assert.equal(bg.model().assisted.valid, true); now += 2001; assert.equal(bg.model().assisted.valid, false);
    // Only the explicit test mode sends a diagnostic request.
    settings.set('source', 'uds'); timer(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1); assert.equal(bg.model().warning.source, 'UDS D347');
    settings.set('source', 'auto'); now += 5000; timer(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1); assert.equal(bg.model().warning.source, 'SOME/IP');
});
