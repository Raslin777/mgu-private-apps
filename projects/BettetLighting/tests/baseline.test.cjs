'use strict';
// The app kit's own light driver (apps/ambient_config/lights.js at the pinned commit, unchanged) and this
// project's, on the same simulated car with the same assumed answer times: 200 ms a write (the kit author's figure
// for the head unit's gateway) and 3 s a status read (the kit: "the BDC answers after a few seconds").
// These are simulated figures: they show where the kit's time goes, not what a car will measure.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rig, look } = require('./sim.cjs');

const KIT = path.join(__dirname, '..', '.cache', 'idrive-kit', 'apps', 'ambient_config');
const skip = !fs.existsSync(path.join(KIT, 'lights.js')) && 'the pinned app kit is not in .cache (python tools/build.py clones it)';

/** The kit's Lights class with its timers on the simulated clock (it calls setTimeout itself). */
function kitRig(o) {
    const holder = {};
    const source = fs.readFileSync(path.join(KIT, 'lights.js'), 'utf8');
    const load = new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', source);
    class KitLights {
        constructor(opts) {
            const mod = { exports: {} };
            load((name) => require(name[0] === '.' ? path.join(KIT, name) : name), mod, mod.exports, opts.setTimer, opts.clearTimer);
            return new mod.exports.Lights({ diag: opts.diag, log: opts.log, now: opts.now });
        }
    }
    return Object.assign(holder, rig(Object.assign({ Lights: KitLights }, o)));
}
const red = look('solid'), blue = look('solid', { upper: { rgb: [0, 0, 254], bright: 80 }, lower: { rgb: [0, 0, 254], bright: 80 } });
/** Runs until every light shows rgb; the simulated time that took, in ms. */
async function until(r, rgb, limit) {
    const from = r.clock.now();
    while (!r.car.everyLight(rgb) && r.clock.now() - from < limit) await r.clock.run(20);
    return r.clock.now() - from;
}

test('start to first colour: the kit reads both buses first, this driver writes first', { skip }, async () => {
    const kit = kitRig();
    kit.lights.find(); kit.lights.show(red);                 // as the kit's main.js and control.js do at start
    const kitMs = await until(kit, [254, 0, 0], 30000);
    const ours = rig();
    ours.lights.show(red); ours.lights.find();
    const ourMs = await until(ours, [254, 0, 0], 30000);
    console.log('  simulated start to first colour: kit ' + kitMs + ' ms, this driver ' + ourMs + ' ms');
    assert.ok(kitMs >= 6000 && kitMs <= 7000, 'kit ' + kitMs);
    assert.ok(ourMs <= 440, 'ours ' + ourMs);
});

test('a second colour 2 s after the first: the kit is in its read-back, this driver is free', { skip }, async () => {
    const kit = kitRig();
    kit.lights.find(); await kit.clock.run(7000);       // the kit's start: both buses read
    kit.lights.show(red); await kit.clock.run(2000);
    kit.lights.show(blue);
    const kitMs = await until(kit, [0, 0, 254], 30000);
    const ours = rig({ found: true });
    ours.lights.show(red); await ours.clock.run(2000);
    ours.lights.show(blue);
    const ourMs = await until(ours, [0, 0, 254], 30000);
    console.log('  simulated second colour: kit ' + kitMs + ' ms, this driver ' + ourMs + ' ms; status reads: kit '
        + kit.car.reads().length + ', this driver ' + ours.car.reads().length);
    assert.ok(kitMs >= 3000, 'kit ' + kitMs);
    assert.ok(ourMs <= 660, 'ours ' + ourMs);
    assert.equal(ours.car.reads().length, 0);
});

test('a one-colour animation: the same two writes a step in both; what is left is the answer time', { skip }, async () => {
    const kit = kitRig();
    kit.lights.find(); await kit.clock.run(7000);
    kit.lights.show(look('breathing')); await kit.clock.run(20000);
    const ours = rig({ found: true });
    ours.lights.show(look('breathing')); await ours.clock.run(20000);
    const k = kit.car.writes().length, o = ours.car.writes().length;
    console.log('  simulated breathe, 20 s: kit ' + k + ' writes, this driver ' + o + ' (it rests 20 ms after each answer)');
    assert.ok(k >= 80 && k <= 105, 'kit ' + k);
    assert.ok(o >= 75 && o <= k, 'ours ' + o);
});
