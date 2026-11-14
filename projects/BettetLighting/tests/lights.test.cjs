'use strict';
// The light driver against a simulated car (tests/sim.cjs): what is sent, when, and what the lights then show.
// The car's answer times here are assumptions (200 ms a write is the app kit author's figure for the head unit's
// gateway, 3 s a status read stands for its "a few seconds"); nothing here was timed on a car.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rig, look, G20 } = require('./sim.cjs');
const L = require('../apps/better_lighting/lights');
const S = require('../apps/better_lighting/scenes');

const hex = (d) => d.map((x) => ('0' + x.toString(16)).slice(-2)).join('');
const starts = (car) => car.writes().map((w) => w.t);

test('the only requests ever sent: the two status reads and the two colour writes, to the body controller', async () => {
    const r = rig();
    r.lights.show(look('solid')); r.lights.find();
    await r.clock.run(9000);
    r.lights.show(look('breathing', { lower: { rgb: [0, 0, 254], bright: 60 } }));
    await r.clock.run(6000);
    r.lights.show(look('wave')); await r.clock.run(6000);
    r.lights.flash([254, 254, 254], 1200); await r.clock.run(2000);
    r.lights.show(look('rainbow')); await r.clock.run(4000);
    r.lights.carColour(); await r.clock.run(3000);
    assert.ok(r.car.log.length > 60);
    r.car.log.forEach((q) => {
        assert.equal(q.target, 0x40);
        if (q.sid === 0x22) assert.match(hex(q.data), /^(da5f|e3d1)$/);
        else { assert.equal(q.sid, 0x2e); assert.match(hex(q.data), /^(da5e|e3d1)[0-9a-f]{14}$/); }
    });
    assert.deepEqual(r.car.bad, [], 'every write within the fields\' ranges (no FF colour, brightness to 100, 1 to 254 s)');
    assert.equal(r.car.overlaps, 0, 'never a second request before the answer to the first');
});

test('a colour with nothing known about the car: two writes at once, no read first', async () => {
    const r = rig();
    r.lights.show(look('solid'));
    await r.clock.run(450);
    assert.deepEqual(r.car.log.map((q) => hex(q.data)), ['da5e000150fe00003c', 'e3d1000150fe00003c']);
    assert.ok(r.car.everyLight([254, 0, 0], 80), 'all 19 lights red 420 ms after the tap');
    assert.equal(r.car.reads().length, 0);
    assert.equal(r.lights.state, 'ours');
});

test('first run: the lights are read once, after the colour is out, and kept', async () => {
    const r = rig();
    r.lights.show(look('solid'));
    const done = r.lights.find();
    await r.clock.run(8000);
    const kinds = r.car.log.map((q) => q.sid.toString(16) + (q.sid === 0x22 ? '' : ':' + q.data[2]));
    assert.deepEqual(kinds, ['2e:0', '2e:0', '22', '22', '2e:0', '2e:0'], 'colour, the two reads, the colour a second time');
    assert.equal((await done).length, 19);
    assert.equal(r.store.get().lights.length, 19);
    assert.deepEqual(r.store.get().buses, ['present', 'present']);
    // the next start: the lights known at once, no read
    const again = rig({ found: true });
    again.lights.show(look('solid', { lower: { rgb: [0, 0, 254], bright: 50 } }));
    await again.clock.run(5000);
    assert.equal(again.lights.lights.length, 19);
    assert.equal(again.car.reads().length, 0);
    again.car.all().forEach((l, i) => {
        const part = again.lights.lights.find((x) => x.bus === (i < 7 ? 0 : 1) && x.nad === (i < 7 ? i : i - 7) + 1).part;
        assert.equal(l.rgb.join(), part === 'upper' ? '254,0,0' : '0,0,254');
    });
});

test('a still colour: written once more 0.7 s later, then only at its renewal', async () => {
    const r = rig({ found: true });
    r.car.drop = { bus: 1, nad: 0 };           // bus 2 answers the first write but its lights do not take it
    r.lights.show(look('solid'));
    await r.clock.run(500);
    assert.ok(!r.car.everyLight([254, 0, 0]), 'bus 2 missed it');
    await r.clock.run(1200);
    assert.ok(r.car.everyLight([254, 0, 0], 80), 'the second write reached it');
    assert.equal(r.car.writes().length, 4);
    await r.clock.run(35000);
    assert.equal(r.car.writes().length, 4, 'nothing more before the renewal');
    await r.clock.run(120000);
    assert.equal(r.car.expired, 0, 'renewed before the 60 s hold ran out, every time');
    assert.ok(r.car.writes().length <= 4 + 2 * 4, 'two writes each 40 s');
    assert.equal(r.car.reads().length, 0, 'no read-back');
});

test('pacing: one at a time, 20 ms after each answer, never more than 10 writes a second', async () => {
    // a car that answers in 5 ms (far quicker than the head unit's gateway is expected to)
    const fast = rig({ found: true, writeMs: 5 });
    fast.lights.show(look('rainbow'));
    await fast.clock.run(10000);
    const t = starts(fast.car);
    assert.ok(t.length >= 95 && t.length <= 101, t.length + ' writes in 10 s');
    for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= L.MIN_WRITE_MS);
    assert.equal(fast.car.overlaps, 0);
    // a car that answers in 200 ms: the answer is awaited, then the rest
    const slow = rig({ found: true });
    slow.lights.show(look('rainbow'));
    await slow.clock.run(10000);
    const w = slow.car.writes();
    for (let i = 1; i < w.length; i++) assert.ok(w[i].t - w[i - 1].done >= L.GAP_MS);
    assert.ok(w.length >= 44 && w.length <= 46, w.length + ' writes in 10 s at 200 ms + 20 ms each');
    assert.equal(slow.lights.rtt, 200);
});

['breathing', 'pulse', 'rainbow'].forEach((kind) => {
    test(kind + ': one write for each bus a step, each carrying the colour of the moment it is sent', async () => {
        const r = rig({ found: true });
        const scene = look(kind);
        r.lights.show(scene);
        await r.clock.run(20000);
        const w = r.car.writes();
        assert.ok(w.length >= 60, w.length + ' writes in 20 s');
        w.forEach((q, i) => {
            assert.equal(q.data[2], 0, 'to every light of the bus');
            assert.equal(q.data[8], L.MOVE_HOLD_S);
            const want = S.lightAt(scene, { part: 'upper', y: 0.5 }, q.t);
            assert.equal(q.data[4], want.bright, 'brightness of write ' + i);
            assert.deepEqual(q.data.slice(5, 8), want.rgb.map((x) => Math.min(254, x)));
        });
        // both buses are written in turn (a bus is left out only where its colour has not changed)
        const buses = w.map((q) => q.data[0]);
        assert.ok(buses.filter((b) => b === 0xda).length > w.length * 0.35 && buses.filter((b) => b === 0xe3).length > w.length * 0.35);
        assert.equal(r.car.expired, 0, 'no light fell back to the car\'s colour in between');
        assert.equal(r.car.reads().length, 0);
        assert.ok(r.lights.fps > 1.5 && r.lights.fps <= 3, r.lights.fps + ' frames a second at 200 ms a write');
    });
});

test('breathe and pulse reach their top and bottom on the car; the rainbow goes all the way round', async () => {
    const seen = async (scene, ms) => {
        const r = rig({ found: true });
        r.lights.show(scene); await r.clock.run(ms);
        return r.car.writes();
    };
    const b = (await seen(look('breathing'), 8000)).map((q) => q.data[4]);
    assert.ok(Math.min.apply(null, b) <= 14 && Math.max.apply(null, b) >= 78, 'breathe ' + Math.min.apply(null, b) + '..' + Math.max.apply(null, b));
    const p = (await seen(look('pulse'), 8000)).map((q) => q.data[4]);
    assert.ok(Math.min.apply(null, p) <= 12 && Math.max.apply(null, p) >= 70, 'pulse ' + Math.min.apply(null, p) + '..' + Math.max.apply(null, p));
    const hues = (await seen(look('rainbow'), 12500)).map((q) => S.hueOf(q.data.slice(5, 8)));
    [0, 60, 120, 180, 240, 300].forEach((h) => assert.ok(hues.some((x) => Math.abs(x - h) < 15), 'near hue ' + h));
    const pal = (await seen(look('rainbow', { palette: [[254, 0, 0], [0, 0, 254]] }), 6500)).map((q) => q.data.slice(5, 8));
    pal.forEach((c) => assert.equal(c[1], 0, 'between red and blue there is no green'));
    assert.ok(pal.some((c) => c[2] > 200) && pal.some((c) => c[0] > 200));
});

test('a look whose lights differ: one write for the colour most lights of a bus want, then one for each other light', async () => {
    const r = rig({ found: true });
    r.lights.show(look('solid', { lower: { rgb: [0, 0, 254], bright: 50 } }));
    await r.clock.run(2400);
    // G20: bus 1 has 5 lower and 2 upper lights, bus 2 has 7 lower and 5 upper
    assert.deepEqual(r.car.writes().map((q) => q.data[2] === 0 ? 'all' : 'one').join(' '),
        'all one one all one one one one one');
    // moving, the same nine a step: about 2 s a step at 200 ms a write
    r.lights.show(look('breathing', { lower: { rgb: [0, 0, 254], bright: 50 } }));
    await r.clock.run(12000);
    assert.equal(r.lights.perFrame, 9);
    assert.equal(r.car.expired, 0);
});

test('taps in quick succession: nothing queues up, the last colour is on the car two writes later', async () => {
    const r = rig({ found: true });
    const colours = [[254, 0, 0], [254, 100, 0], [254, 254, 0], [0, 254, 0], [0, 0, 254]];
    for (let i = 0; i < colours.length; i++) {
        r.lights.show(look('solid', { upper: { rgb: colours[i], bright: 80 }, lower: { rgb: colours[i], bright: 80 } }));
        await r.clock.run(60);                  // five taps in 0.3 s
    }
    await r.clock.run(600);
    assert.ok(r.car.everyLight([0, 0, 254], 80), 'blue everywhere 0.6 s after the last tap');
    assert.ok(r.car.writes().length <= 5, r.car.writes().length + ' writes for five taps');
});

test('original colour: each bus given back with one write, and once more', async () => {
    const r = rig({ found: true });
    r.lights.show(look('solid')); await r.clock.run(2000);
    r.lights.carColour(); await r.clock.run(3000);
    assert.deepEqual(r.car.writes().slice(-4).map((q) => hex(q.data)),
        ['da5e00000000000000', 'e3d100000000000000', 'da5e00000000000000', 'e3d100000000000000']);
    assert.ok(r.car.all().every((l) => l === null));
    assert.equal(r.lights.state, 'car');
    const n = r.car.log.length;
    await r.clock.run(120000);
    assert.equal(r.car.log.length, n, 'then nothing is sent at all');
});

test('a car with one bus: the second is tried twice, then left alone', async () => {
    const r = rig({ buses: [G20[0], null] });
    r.lights.show(look('pulse'));
    await r.clock.run(5000);
    assert.equal(r.car.writes().filter((q) => q.data[0] === 0xe3).length, 2);
    assert.deepEqual(r.lights.bus, ['unknown', 'absent']);
    assert.equal(r.lights.state, 'ours');
    assert.ok(r.car.all().every((l) => l && l.rgb.join() === '254,0,0'));
});

test('no answer (the car asleep): four tries, then a 10 s pause, and on again when it answers', async () => {
    const r = rig({ found: true });
    r.car.silent = true;
    r.lights.show(look('solid'));
    await r.clock.run(60000);
    const w = r.car.writes().length;
    assert.ok(w >= 12 && w <= 20, w + ' tries in a minute (4 each 16 s)');
    assert.match(r.lights.error, /no answer/);
    r.car.silent = false;
    await r.clock.run(20000);
    assert.ok(r.car.everyLight([254, 0, 0], 80));
    assert.equal(r.lights.error, null);
});

test('a refusal (conditions not correct) pauses the writing too', async () => {
    const r = rig({ found: true });
    r.car.refuse = 0x22;
    r.lights.show(look('rainbow'));
    await r.clock.run(30000);
    assert.ok(r.car.writes().length <= 12);
    assert.match(r.lights.error, /refused \(22\)/);
    assert.deepEqual(r.lights.bus, ['present', 'present'], 'a bus known to be there is not given up');
});

test('a flash lies over everything for its time, then the look is back; night dims', async () => {
    const r = rig({ found: true });
    r.lights.show(look('solid')); await r.clock.run(2000);
    r.lights.flash([0, 254, 0], 1200); await r.clock.run(500);
    assert.ok(r.car.everyLight([0, 254, 0], 100));
    await r.clock.run(1500);
    assert.ok(r.car.everyLight([254, 0, 0], 80));
    r.lights.dim(0.5); await r.clock.run(600);
    assert.ok(r.car.everyLight([254, 0, 0], 40));
});

test('a status read while an animation runs: the lights hold their colour through it', async () => {
    const r = rig({ found: true });
    r.lights.show(look('rainbow')); await r.clock.run(3000);
    r.lights.find(); await r.clock.run(10000);
    assert.equal(r.car.reads().length, 2);
    assert.equal(r.car.expired, 0, 'the 5 s hold was made 60 s before the 6 s of reading');
    const after = r.car.writes().filter((q) => q.t > 3000 + 6500);
    assert.ok(after.length > 10, 'and the animation goes on');
});

test('once-only scenes end in their look; a sport pulse over the car\'s colour gives the lights back', async () => {
    const r = rig({ found: true });
    r.lights.show(Object.assign(look('sportpulse'), { then: null }));
    await r.clock.run(1000);
    assert.ok(r.car.everyLight([254, 0, 0], 100));
    await r.clock.run(4000);
    assert.ok(r.car.all().every((l) => l === null));
    r.lights.show(Object.assign(look('welcome', { upper: { rgb: [0, 254, 0], bright: 80 }, lower: { rgb: [0, 254, 0], bright: 80 } }), { then: look('solid') }));
    await r.clock.run(6000);
    assert.ok(r.car.everyLight([254, 0, 0], 80));
});

test('what the screen is told of the car: each bus, and whether upper and lower lights are both there', async () => {
    const fresh = rig();
    assert.deepEqual(fresh.lights.buses().map((b) => b.state + ':' + b.count), ['unknown:0', 'unknown:0']);
    assert.equal(fresh.lights.known, false); assert.equal(fresh.lights.split, false);
    fresh.lights.find(); await fresh.clock.run(8000);
    assert.deepEqual(fresh.lights.buses(), [{ n: 1, state: 'present', count: 7, upper: 2, lower: 5 }, { n: 2, state: 'present', count: 12, upper: 5, lower: 7 }]);
    assert.equal(fresh.lights.known, true); assert.equal(fresh.lights.split, true);
    // a car with bus 1 only, and only lower lights on it
    const one = rig({ buses: [[0x01, 0x03, 0x07], null] });
    one.lights.find(); await one.clock.run(8000);
    assert.deepEqual(one.lights.buses().map((b) => b.state + ':' + b.count), ['present:3', 'absent:0']);
    assert.equal(one.lights.split, false);
    assert.deepEqual(one.store.get().buses, ['present', 'absent']);
    // a bus that answers its read with no lights on it is left alone too
    const empty = rig({ buses: [G20[0], []] });
    empty.lights.find(); empty.lights.show(look('pulse')); await empty.clock.run(12000);
    assert.equal(empty.lights.buses()[1].state, 'absent');
    assert.equal(empty.car.writes().filter((q) => q.t > 7000 && q.data[0] === 0xe3).length, 0, 'no more writes to the empty bus');
});
