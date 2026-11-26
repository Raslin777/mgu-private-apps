'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const app = path.join(__dirname, '..', 'apps', 'road_sight');
const spec = JSON.parse(fs.readFileSync(path.join(app, 'app.json')));
const services = require('../apps/road_sight/services');
const { Collector } = require('../apps/road_sight/collector');
const { flatten, oneLine } = require('../apps/road_sight/flatten');
const view = require('../apps/road_sight/view');
const quiet = { info() {}, warn() {} };

function fakeSignals(options) {
    const opts = options || {};
    const handlers = {}, calls = [], closed = [];
    return { handlers, calls, closed,
        async proxy(iface, instance) {
            calls.push(['proxy', iface, instance]);
            if (opts.refuse && opts.refuse.indexOf(iface) >= 0) throw new Error('not permitted');
            return { iface, shutdown() { closed.push(iface); } };
        },
        async onAvailable(p, fn) { fn(opts.offered ? opts.offered.indexOf(p.iface) >= 0 : true); },
        async on(p, name, fn) {
            calls.push(['on', p.iface, name]);
            if (opts.badMember === name) throw new Error('no such event');
            handlers[p.iface + '|' + name] = fn;
        } };
}

test('manifest declares exactly the generated services, read-only', () => {
    assert.deepEqual(Object.keys(spec.signals).sort(), services.map(s => s.iface).sort());
    for (const s of services) {
        const block = spec.signals[s.iface];
        assert.equal(block._instances, s.instance);
        assert.ok(block._optional, s.iface + ' must be optional so the app runs without it');
        assert.deepEqual((block._broadcasts || []).slice().sort(), s.events.slice().sort());
        for (const f of s.fields) assert.equal(block[f], 's', s.iface + '.' + f + ' is subscribe-only');
        // nothing writable and no method may ever be declared
        assert.equal(block._methods, undefined);
        for (const [key, value] of Object.entries(block)) if (key[0] !== '_') assert.equal(value, 's');
    }
    assert.ok(services.length >= 20);
    assert.ok(services.some(s => s.evidence === 'A') && services.some(s => s.evidence === 'B'));
});

test('collector subscribes to every member, counts events and keeps the latest value', async () => {
    const signals = fakeSignals();
    let now = 1000;
    const logged = [];
    const collector = new Collector(signals, services, { info(m) { logged.push(m); }, warn() {} }, { now: () => now });
    await collector.start();
    const total = services.reduce((n, s) => n + s.events.length + s.fields.length, 0);
    assert.equal(Object.keys(signals.handlers).length, total);
    assert.equal(signals.calls.filter(c => c[0] === 'proxy').length, services.length);
    const s = services[0], key = s.iface + '|' + s.events[0];
    signals.handlers[key]({ range: 40 }); now += 200; signals.handlers[key]({ range: 41 }); now += 200; signals.handlers[key]({ range: 42 });
    const snap = collector.snapshot()[0];
    const member = snap.members.find(m => m.name === s.events[0]);
    assert.equal(member.count, 3); assert.deepEqual(member.value, { range: 42 }); assert.equal(member.age, 0);
    assert.ok(Math.abs(member.rate - 5) < 0.01, 'two gaps of 200 ms are 5 events a second');
    assert.equal(snap.total, 3); assert.equal(snap.seen, 1); assert.equal(snap.state, 'subscribed');
    assert.equal(logged.filter(m => /first/.test(m)).length, 1, 'the first value is logged once');
    now += 60000;
    assert.equal(collector.snapshot()[0].members.find(m => m.name === s.events[0]).rate, 0, 'rate falls to zero when events stop');
    assert.equal(collector.logAll(), 1);
    collector.stop(); await Promise.resolve();
    assert.equal(signals.closed.length, services.length);
    signals.handlers[key]({ range: 99 });
    assert.equal(collector.snapshot()[0].total, 3, 'nothing is counted after stop');
});

test('a refused service or a missing event does not stop the others', async () => {
    const refused = services[1].iface;
    const bad = services[0].events[0];
    const signals = fakeSignals({ refuse: [refused], badMember: bad, offered: [services[2].iface] });
    const collector = new Collector(signals, services, quiet, { logFirst: () => false });
    await collector.start();
    const snap = collector.snapshot();
    assert.equal(snap[1].state, 'refused'); assert.match(snap[1].error, /not permitted/);
    assert.equal(snap[0].state, services[0].events.length + services[0].fields.length > 1 ? 'partly subscribed' : 'refused');
    assert.match(snap[0].members.find(m => m.name === bad).error, /no such event/);
    assert.equal(snap[2].state, 'subscribed'); assert.equal(snap[2].available, true);
    assert.equal(snap[3].available, false);
    assert.equal(view.status(snap[1])[0], 'refused');
    assert.equal(view.status(snap[2])[0], 'offered, silent');
    assert.equal(view.status(snap[3])[0], 'not offered');
});

test('flatten names every value, summarises lists and prints bytes as hex', () => {
    const rows = flatten({ timestamp: { seconds: 5, nanoseconds: 7 }, type: 'SPEED_LIMIT', quality: 0.123456,
        signs: [{ id: 1, value: 50 }, { id: 0, value: 0 }, { id: 0, value: 0 }], raw: Buffer.from([0, 255, 16]) });
    const map = new Map(rows);
    assert.equal(map.get('timestamp.seconds'), '5'); assert.equal(map.get('type'), 'SPEED_LIMIT');
    assert.equal(map.get('quality'), '0.1235'); assert.equal(map.get('signs'), 'list of 3, 1 filled');
    assert.equal(map.get('signs[0].value'), '50'); assert.equal(map.get('raw'), '00ff10');
    assert.deepEqual(flatten(7), [['value', '7']]);
    assert.ok(flatten(new Array(2000).fill({ a: 1 })).length <= 400);
    const circular = {}; circular.self = circular;
    assert.equal(typeof oneLine(circular, 50), 'string');
    assert.ok(oneLine({ a: 'x'.repeat(500) }, 80).length <= 83);
    assert.equal(oneLine({ a: Buffer.from([1, 255]) }, 80), '{"a":"hex:01ff"}');
});

test('pages: overview first, one page per service, live-only filters, long values split into parts', async () => {
    const signals = fakeSignals();
    const collector = new Collector(signals, services, quiet, { logFirst: () => false });
    await collector.start();
    const s = services.find(x => x.name === 'DAADataServer');
    const big = {}; for (let i = 0; i < 120; i++) big['field' + i] = i;
    signals.handlers[s.iface + '|' + s.events[0]](big);
    const snap = collector.snapshot();
    const all = view.pages(snap, false), live = view.pages(snap, true);
    const overview = all.filter(p => p.kind === 'overview').length;
    assert.equal(all.length, overview + services.length); assert.equal(live.length, overview + 1);
    const texts = [];
    const cv = { clear() {}, text(t) { texts.push(String(t)); }, roundRect() {} };
    for (let page = 0; page < all.length; page++) view.draw(cv, { snapshot: snap, liveOnly: false, page, scroll: 0 });
    for (const svc of services) assert.ok(texts.some(t => t === svc.name.slice(0, 40) || t === svc.name.slice(0, 44)), svc.name);
    texts.length = 0;
    const at = view.draw(cv, { snapshot: snap, liveOnly: true, page: 99, scroll: 1 });
    assert.equal(at.index, live.length - 1, 'an out-of-range page is clamped');
    assert.ok(texts.some(t => /part 2\//.test(t)), 'More lines moves to the next part');
    assert.ok(texts.some(t => t === 'field40' || t === 'field45'));
});

test('main: background collects without a screen; buttons page, filter and log; shutdown closes everything', async () => {
    let implementation;
    const signals = fakeSignals();
    const fakeProcess = new EventEmitter();
    vm.runInNewContext(fs.readFileSync(path.join(app, 'main.js'), 'utf8'), {
        require(name) {
            if (name === './kit/mgu') return { run(config) { implementation = config; } };
            return require(path.join(app, name));
        }, process: fakeProcess, Date, Promise, Math, Object, String, JSON
    });
    const settings = { values: Object.fromEntries(spec.settings.map(s => [s.key, s.default])),
        get(k) { return this.values[k]; }, set(k, v) { this.values[k] = v; } };
    const platform = new EventEmitter(), logged = [];
    const log = { info(m) { logged.push(m); }, warn(m) { logged.push(m); } };
    const bg = await implementation.background({ app: platform, settings, log, signals });
    await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
    for (let i = 0; i < 200 && Object.keys(signals.handlers).length < 88; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(bg.snapshot().length, services.length);
    const s = services[0];
    signals.handlers[s.iface + '|' + s.events[0]]({ a: 1 });
    const buttons = {}; let frame, draws = 0;
    await implementation.start({ background: bg, settings, log,
        ui: { onClick(id, fn) { buttons[id] = fn; }, image() { draws++; } },
        canvas() { return { clear() {}, text() {}, roundRect() {} }; }, loop(state, fps, fn) { frame = fn; fn(); } });
    for (const [id] of spec.screens[0].buttons) assert.equal(typeof buttons[id], 'function', id);
    buttons.BTN_NEXT(); frame(); buttons.BTN_PREV(); buttons.BTN_PREV(); frame(); buttons.BTN_MORE(); frame();
    buttons.BTN_LIVE(); assert.equal(settings.get('liveOnly'), true); frame();
    buttons.BTN_OVERVIEW(); frame(); assert.ok(draws >= 5);
    buttons.BTN_LOG(); assert.ok(logged.some(m => /snapshot: 1 members with data/.test(m)));
    platform.emit('shutdown'); await Promise.resolve();
    assert.equal(signals.closed.length, services.length);
});
