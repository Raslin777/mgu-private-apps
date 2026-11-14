'use strict';
// Execute under a verified Node 8 binary (the head unit runs Node 8.16.2):
//   .cache/node8.exe tools/check-node8.cjs
// Compiles every file the app ships (main.js and cabin.js need the app kit and BMW's SDK to run, so they are only
// compiled), then drives the light driver and the look control end to end against the simulated car of the tests:
// a colour, breathe, pulse, rainbow, a driving mode's look, and back to the car's colour.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
// started with another Node (npm run check:node8): run this file again under the Node 8 binary
if (!/^v8\./.test(process.version)) {
    const bin = path.join(__dirname, '..', '.cache', 'node8.exe');
    const run = require('child_process').spawnSync(bin, [__filename], { stdio: 'inherit' });
    if (run.error) console.error('No Node 8 binary at ' + bin + ' (copy node8.exe from a sibling project\'s .cache)');
    process.exit(run.error ? 1 : run.status);
}
const sim = require(path.join(__dirname, '..', 'tests', 'sim.cjs'));
const S = require(path.join(sim.APP, 'scenes'));
const Control = require(path.join(sim.APP, 'control')).Control;
require(path.join(sim.APP, 'ambient'));

async function check() {
    const files = fs.readdirSync(sim.APP).filter(function (f) { return /\.js$/.test(f); });
    assert.deepEqual(files.sort(), ['ambient.js', 'cabin.js', 'control.js', 'lights.js', 'lin.js', 'main.js', 'scenes.js']);
    files.forEach(function (f) {
        const source = fs.readFileSync(path.join(sim.APP, f), 'utf8');
        new vm.Script('(function (exports, require, module, __filename, __dirname) {' + source + '\n})', { filename: f });
    });

    const r = sim.rig();
    const values = { on: false };
    const settings = { get: function (k) { return values[k]; }, set: function (k, v) { values[k] = v; } };
    const control = new Control({ settings: settings, lights: r.lights, ambient: null, log: sim.quiet });
    const red = { rgb: [254, 0, 0], bright: 80 };

    control.setLook({ kind: 'solid', upper: red, lower: red });
    r.lights.find();
    await r.clock.run(9000);
    assert.ok(r.car.everyLight([254, 0, 0], 80), 'a colour on every light');
    assert.equal(r.car.log[0].sid, 0x2e, 'the colour before the status read');
    assert.equal(r.lights.lights.length, 19);
    assert.equal(r.store.get().lights.length, 19);

    const kinds = ['breathing', 'pulse', 'rainbow'];
    for (let i = 0; i < kinds.length; i++) {
        const from = r.car.writes().length;
        control.setLook({ kind: kinds[i] });
        await r.clock.run(10000);
        const w = r.car.writes().slice(from);
        assert.ok(w.length >= 35 && w.length <= 46, kinds[i] + ': ' + w.length + ' writes in 10 s');
        w.forEach(function (q) { assert.equal(q.data[2], 0); assert.equal(q.data[8], 5); });
        const bright = w.map(function (q) { return q.data[4]; }), hues = w.map(function (q) { return Math.round(S.hueOf(q.data.slice(5, 8))); });
        if (kinds[i] === 'rainbow') assert.ok(Math.max.apply(null, hues) - Math.min.apply(null, hues) > 200, 'the hue moves');
        else assert.ok(Math.max.apply(null, bright) - Math.min.apply(null, bright) > 55, 'the brightness moves');
    }
    control.setModeLook('sport', { kind: 'solid', upper: { rgb: [0, 0, 254], bright: 60 }, lower: { rgb: [0, 0, 254], bright: 60 }, speed: 2 });
    control.mode('comfort'); control.mode('sport');
    await r.clock.run(2000);
    assert.ok(r.car.everyLight([0, 0, 254], 60), 'the Sport look');
    control.setModeLook('sport', null);
    control.carColour();
    await r.clock.run(3000);
    assert.ok(r.car.all().every(function (l) { return l === null; }), 'the car\'s own colour back');
    assert.equal(r.car.overlaps, 0);
    assert.deepEqual(r.car.bad, []);
    assert.equal(r.car.expired, 0);
    assert.equal(r.car.reads().length, 2);
    r.lights.stop();
    console.log('Node ' + process.version + ': ' + files.length + ' files compile; colour, breathe, pulse, rainbow, driving mode and give-back checks passed ('
        + r.car.writes().length + ' writes, ' + r.car.reads().length + ' reads on the simulated car)');
}
check().then(function () { process.exit(0); }, function (error) { console.error(error); process.exit(1); });
