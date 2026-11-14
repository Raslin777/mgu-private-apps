'use strict';
// Execute under a verified Node 8 binary (the head unit runs Node 8.16.2):
//   node tools/check-node8.cjs      (starts itself again under .cache/node8.exe)
// Compiles every file the app ships (main.js needs the app kit and BMW's SDK to run, so it is only compiled),
// then drives the player end to end against the simulated car of the tests: every show, a lamp test, the screen,
// driving off, and Stop.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
if (!/^v8\./.test(process.version)) {
    const bin = path.join(__dirname, '..', '.cache', 'node8.exe');
    const run = require('child_process').spawnSync(bin, [__filename], { stdio: 'inherit' });
    if (run.error) console.error('No Node 8 binary at ' + bin + ' (copy node8.exe from a sibling project\'s .cache)');
    process.exit(run.error ? 1 : run.status);
}
const sim = require(path.join(__dirname, '..', 'tests', 'sim.cjs'));
const Shows = require(path.join(sim.APP, 'shows'));
const view = require(path.join(sim.APP, 'view'));
const LAMPS = require(path.join(sim.APP, 'lamps')).LAMPS;

async function check() {
    const files = fs.readdirSync(sim.APP).filter(function (f) { return /\.js$/.test(f); });
    assert.deepEqual(files.sort(), ['lamps.js', 'main.js', 'player.js', 'shows.js', 'view.js']);
    files.forEach(function (f) {
        new vm.Script('(function (exports, require, module, __filename, __dirname) {' + fs.readFileSync(path.join(sim.APP, f), 'utf8') + '\n})', { filename: f });
    });

    const r = sim.rig();
    const keys = Shows.keys();
    for (let i = 0; i < keys.length; i++) {
        const from = r.car.writes().length;
        assert.equal(r.player.play(Shows.show(keys[i], { glare: false })), true);
        await r.clock.run(6000);
        assert.ok(r.car.writes().length - from >= 8, keys[i] + ': ' + (r.car.writes().length - from) + ' requests in 6 s');
    }
    const texts = [];
    const cv = { clear: function () {}, roundRect: function () {}, text: function (s) { texts.push(s); } };
    const top = view.draw(cv, { bg: '#000', text: '#fff', dim: '#888', warn: '#fa0' }, {
        lit: LAMPS.filter(function (l) { return r.player.isLit(l.key); }).map(function (l) { return l.key; }),
        show: 'Strobe', state: r.player.state, reason: r.player.reason, lamp: 'Low beam', moving: false, speed: 0,
        rtt: r.player.rtt, writes: r.player.writes, skipped: r.player.skipped, refused: [], link: true });
    assert.equal(top.text, 'Playing: Strobe');
    assert.ok(texts.some(function (s) { return s.indexOf(r.player.rtt + ' ms a request, ' + r.player.writes + ' sent') === 0; }), texts.join(' / '));

    r.state.moving = true;
    await r.clock.run(2000);
    assert.equal(r.player.state, 'idle');
    assert.equal(r.player.reason, 'The car is moving');
    assert.deepEqual(r.car.lit(), []);
    r.state.moving = false;
    assert.equal(r.player.flash('brake', 1000), true);
    await r.clock.run(300);
    assert.deepEqual(r.car.lit(), [0x0c]);
    r.player.stop('Stopped');
    await r.clock.run(1000);
    assert.deepEqual(r.car.lit(), []);
    assert.equal(r.car.overlaps, 0);
    assert.deepEqual(r.car.bad, []);
    console.log('Node ' + process.version + ': ' + files.length + ' files compile; ' + keys.length + ' shows, a lamp test, the screen, driving off and Stop passed ('
        + r.car.writes().length + ' requests on the simulated car)');
}
check().then(function () { process.exit(0); }, function (error) { console.error(error); process.exit(1); });
