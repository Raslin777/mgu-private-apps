'use strict';
// The request bytes, the shows, and the player against a simulated car (tests/sim.cjs). The car's answer time
// (200 ms a request) is an assumption taken from the app kit author's figure for the head unit's gateway;
// nothing here was sent to or timed on a car.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rig, TABLE } = require('./sim.cjs');
const L = require('../apps/external_lights/lamps');
const Shows = require('../apps/external_lights/shows');
const P = require('../apps/external_lights/player');
const { headline } = require('../apps/external_lights/view');

const hex = (d) => d.map((x) => ('0' + x.toString(16)).slice(-2)).join('');

test('request: 2E D542, the lamp function in two bytes, the time in 10 ms in two bytes', () => {
    assert.deepEqual(L.onFrame('high', 500), [0xd5, 0x42, 0x00, 0x05, 0x00, 0x32]);
    assert.deepEqual(L.onFrame('hazard', 3000), [0xd5, 0x42, 0x00, 0x12, 0x01, 0x2c]);
    assert.deepEqual(L.offFrame('brake'), [0xd5, 0x42, 0x00, 0x0c, 0x00, 0x00]);
    assert.deepEqual(L.onFrame('drl', 1).slice(4), [0, 1], 'never "off" by rounding down');
    assert.deepEqual(L.onFrame('drl', 600000).slice(4), [0x03, 0xe8], 'at most 10 s a request');
    assert.throws(() => L.onFrame('ambient', 100));
    assert.equal(L.BDC, 0x40);
});

test('lamps: values of the description\'s table; interior, ambient, emergency stop signal and OVT left out', () => {
    L.LAMPS.forEach((l) => assert.ok(TABLE.includes(l.id), l.key));
    assert.equal(new Set(L.LAMPS.map((l) => l.id)).size, L.LAMPS.length);
    [0x13, 0x14, 0x0d, 0x19, 0x02].forEach((id) => assert.ok(!L.LAMPS.some((l) => l.id === id), 'left out: ' + id));
    assert.deepEqual(L.LAMPS.filter((l) => l.glare).map((l) => l.key), ['high', 'fogR']);
});

test('shows: known lamps, events a step apart inside the period, no glare unless asked for', () => {
    Shows.keys().forEach((key) => {
        const s = Shows.show(key, {});
        assert.ok(s.events.length >= 2 && s.period >= 600, key);
        s.events.forEach((e, i) => {
            assert.ok(L.lamp(e.lamp), key + ' ' + e.lamp);
            assert.ok(!L.lamp(e.lamp).glare, key + ' has ' + e.lamp + ' without being asked');
            assert.ok(e.ms >= 100 && e.ms <= 1000);
            if (i) assert.ok(e.t - s.events[i - 1].t >= Shows.STEP_MS, key + ' events too close');
        });
        assert.ok(s.period - s.events[s.events.length - 1].t >= Shows.STEP_MS, key + ' wraps too close');
    });
    assert.ok(Shows.show('chase', { glare: true }).events.some((e) => e.lamp === 'high'));
    assert.equal(Shows.next(Shows.keys()[Shows.keys().length - 1]), Shows.keys()[0]);
});

test('a show on the car: each event one request at its moment, the lamps on for their time and off by themselves', async () => {
    const r = rig();
    const show = Shows.show('ends', {});
    assert.equal(r.player.play(show), true);
    await r.clock.run(250);
    assert.deepEqual(r.car.lit(), [0x04], 'daytime lights on 200 ms after the start');
    await r.clock.run(500);
    assert.deepEqual(r.car.lit(), [], 'and off by themselves 500 ms later');
    await r.clock.run(200);
    assert.deepEqual(r.car.lit(), [0x0c], 'then the brake lights');
    await r.clock.run(10000 - 950);
    const w = r.car.writes();
    w.forEach((q, i) => {
        assert.equal(hex(q.data), i % 2 ? 'd542000c0032' : 'd54200040032');
        assert.equal(q.t, Math.floor(i / 2) * 1400 + (i % 2) * 700, 'event ' + i + ' at its moment');
    });
    assert.equal(w.length, 15);
    assert.equal(r.player.skipped, 0);
    assert.equal(r.player.rtt, 200);
});

test('the only request ever sent is 2E D542 to the body controller, well formed, one at a time', async () => {
    const r = rig();
    for (const key of Shows.keys()) {
        r.player.play(Shows.show(key, { glare: true }));
        await r.clock.run(7000);
    }
    r.player.stop('Stopped'); await r.clock.run(2000);
    r.player.flash('reverse', 1000); await r.clock.run(2000);
    assert.ok(r.car.log.length > 60);
    r.car.log.forEach((q) => { assert.equal(q.target, 0x40); assert.equal(q.sid, 0x2e); assert.match(hex(q.data), /^d54200[0-9a-f]{2}[0-9a-f]{4}$/); });
    assert.deepEqual(r.car.bad, []);
    assert.equal(r.car.overlaps, 0);
    assert.ok(r.car.longest <= 1000, 'no lamp asked on for longer than a second');
});

test('pacing: 20 ms after each answer, never more than 10 requests a second, even on a car that answers at once', async () => {
    const r = rig({ writeMs: 5 });
    // a show denser than any of the app's own: an event every 30 ms
    const events = [];
    for (let i = 0; i < 20; i++) events.push({ t: i * 30, lamp: i % 2 ? 'brake' : 'drl', ms: 100 });
    r.player.play({ key: 'dense', name: 'dense', period: 600, events });
    await r.clock.run(10000);
    const w = r.car.writes();
    assert.ok(w.length <= 101, w.length + ' requests in 10 s');
    for (let i = 1; i < w.length; i++) { assert.ok(w[i].t - w[i - 1].t >= P.MIN_WRITE_MS); assert.ok(w[i].t - w[i - 1].done >= P.GAP_MS); }
    assert.ok(r.player.skipped > 100, 'what did not fit was left out, not queued');
});

test('a slow link: events that are too late are left out and the show keeps its time', async () => {
    const r = rig({ writeMs: 450 });
    r.player.play(Shows.show('strobe', {}));          // an event every 300 ms
    await r.clock.run(12000);
    const w = r.car.writes();
    assert.ok(r.player.skipped > 5);
    w.forEach((q) => assert.ok(q.t % 300 <= P.LATE_MS, 'sent at ' + q.t + ', within ' + P.LATE_MS + ' ms of an event\'s moment'));
});

test('only while the car stands: no start while moving, and driving off ends the show and switches its lamps off', async () => {
    const r = rig();
    r.state.moving = true;
    assert.equal(r.player.play(Shows.show('chase', {})), false);
    assert.equal(r.player.flash('drl', 1000), false);
    await r.clock.run(3000);
    assert.equal(r.car.log.length, 0);
    assert.equal(headline({ moving: true, state: 'idle', show: 'x' }).text, 'Only while the car stands');
    r.state.moving = false;
    // a lamp with a long time, so that it is still on when the car drives off
    r.player.play({ key: 'long', name: 'long', period: 4000, events: [{ t: 0, lamp: 'low', ms: 3000 }, { t: 400, lamp: 'brake', ms: 3000 }] });
    await r.clock.run(1000);
    assert.deepEqual(r.car.lit(), [0x03, 0x0c]);
    r.state.moving = true;
    await r.clock.run(4000);
    assert.deepEqual(r.car.lit(), []);
    assert.deepEqual(r.car.writes().slice(-2).map((q) => hex(q.data)), ['d54200030000', 'd542000c0000']);
    assert.equal(r.player.state, 'idle');
    assert.equal(r.player.reason, 'The car is moving');
    const n = r.car.log.length;
    await r.clock.run(20000);
    assert.equal(r.car.log.length, n, 'and nothing more is sent');
});

test('Stop switches off what is still on; a show ends by itself when its time is up', async () => {
    const r = rig({ maxMs: 5000 });
    r.player.play(Shows.show('heart', {}));
    await r.clock.run(350);
    r.player.stop('Stopped');
    await r.clock.run(1500);
    assert.equal(r.player.state, 'idle');
    assert.deepEqual(r.car.lit(), []);
    const before = r.car.log.length;
    r.player.play(Shows.show('ends', {}));
    await r.clock.run(20000);
    assert.equal(r.player.state, 'idle');
    assert.equal(r.player.reason, 'Time is up');
    assert.ok(r.car.log.slice(before).every((q) => q.t <= 1850 + 5000 + 500), 'nothing sent after the five seconds');
});

test('a lamp this car does not have is tried once and left out; a car with none of a show\'s lamps ends it', async () => {
    const r = rig({ missing: [0x04] });
    r.player.play(Shows.show('ends', {}));
    await r.clock.run(6000);
    assert.deepEqual(r.player.refused, ['drl']);
    assert.equal(r.car.writes().filter((q) => q.data[3] === 0x04).length, 1);
    assert.ok(r.car.writes().filter((q) => q.data[3] === 0x0c).length >= 4, 'the rest of the show goes on');
    const none = rig({ missing: [0x04, 0x0c] });
    none.player.play(Shows.show('ends', {}));
    await none.clock.run(6000);
    assert.equal(none.player.state, 'idle');
    assert.equal(none.player.reason, 'The car has none of these lamps');
    assert.equal(none.car.log.length, 2);
});

test('refused or unanswered: the show ends, nothing is repeated', async () => {
    const refused = rig();
    refused.car.refuse = 0x7f;
    refused.player.play(Shows.show('chase', {}));
    await refused.clock.run(10000);
    assert.equal(refused.car.log.length, 1);
    assert.equal(refused.player.reason, 'Refused: not allowed in this diagnostic session');
    const locked = rig();
    locked.car.refuse = 0x33;
    locked.player.flash('drl', 500); await locked.clock.run(3000);
    assert.match(locked.player.reason, /security unlock/);
    const silent = rig();
    silent.car.silent = true;
    silent.player.play(Shows.show('ends', {}));
    await silent.clock.run(60000);
    assert.equal(silent.car.log.length, P.FAILS);
    assert.equal(silent.player.reason, 'No answer from the body controller');
    assert.equal(silent.player.state, 'idle');
});

test('one lamp for a test: one request, on for a second, nothing after', async () => {
    const r = rig();
    assert.equal(r.player.flash('fogF', 1000), true);
    await r.clock.run(300);
    assert.deepEqual(r.car.lit(), [0x08]);
    assert.ok(r.player.isLit('fogF'));
    await r.clock.run(5000);
    assert.deepEqual(r.car.lit(), []);
    assert.equal(r.car.log.length, 1);
    assert.equal(r.player.state, 'idle');
    assert.equal(r.player.flash('nothing', 1000), false);
});
