'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const app = path.join(__dirname, '..', 'apps', 'hud_blindspot');
const spec = JSON.parse(fs.readFileSync(path.join(app, 'app.json')));
const { FIELD, MIRROR_EVENT } = require('../apps/hud_blindspot/warnings');
const quiet = { info() {}, warn() {} };

test('boot/background operation works with no RHMI screen; enable persists and shutdown releases all resources', async () => {
    let implementation, timer, cleared = false, proxyClosed = false;
    const clients = [], handlers = {}, buttons = {};
    const settings = { values: Object.fromEntries(spec.settings.map(s => [s.key, s.default])), listeners: [],
        get(k) { return this.values[k]; }, set(k, v) { this.values[k] = v; this.listeners.forEach(fn => fn(k, v)); },
        onChange(fn) { this.listeners.push(fn); } };
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
        assert.equal(Object.keys(spec.signals).length, 1);
    });

test('manifest has saved enable/disable, background start and no diagnostic/setter permissions', () => {
    assert.equal(spec.autostart, true); assert.equal(spec.settings.find(s => s.key === 'enabled').default, false);
    assert.equal(spec.screens.filter(s => s.kind === 'canvas').length, 1);
    const text = JSON.stringify(spec.signals);
    assert.ok(!/sendTasu|_methods|"[rw]+"/.test(text));
    for (const file of fs.readdirSync(app).filter(f => /\.js$/.test(f) && f !== 'cluster_render_client.js')) {
        const code = fs.readFileSync(path.join(app, file), 'utf8');
        assert.ok(!/signals\.(set|call)\(|sendTasuRequest|child_process|execSync/.test(code), file);
    }
});
