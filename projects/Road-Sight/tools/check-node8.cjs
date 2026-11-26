'use strict';
// Runs the app's modules under the head unit's Node version (8.16.x) with a fake signal source.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
if (!/^v8\./.test(process.version)) {
    const candidates = [path.join(__dirname, '..', '.cache', 'node8.exe'),
        path.join(__dirname, '..', '..', 'HUD-Blindspot', '.cache', 'node8.exe')];
    const exe = candidates.filter(p => fs.existsSync(p))[0];
    if (!exe) { console.error('No Node 8 binary found (looked in .cache and ../HUD-Blindspot/.cache)'); process.exit(1); }
    const result = require('child_process').spawnSync(exe, [__filename], { stdio: 'inherit' });
    if (result.error) console.error(result.error.message);
    process.exit(result.error ? 1 : result.status);
}
const app = path.join(__dirname, '..', 'apps', 'road_sight');
for (const file of fs.readdirSync(app).filter(f => /\.js$/.test(f)))
    new vm.Script('(function(require,module,exports){' + fs.readFileSync(path.join(app, file), 'utf8') + '\n})', { filename: file });
const services = require(path.join(app, 'services'));
const { Collector } = require(path.join(app, 'collector'));
const { flatten, oneLine } = require(path.join(app, 'flatten'));
const view = require(path.join(app, 'view'));
async function run() {
    const handlers = {}, log = { info() {}, warn() {} };
    const signals = { async proxy(iface) { return { iface: iface, shutdown() {} }; },
        async onAvailable(p, fn) { fn(true); },
        async on(p, name, fn) { handlers[p.iface + '|' + name] = fn; } };
    const collector = new Collector(signals, services, log);
    await collector.start();
    const total = services.reduce((n, s) => n + s.events.length + s.fields.length, 0);
    assert.strictEqual(Object.keys(handlers).length, total);
    const first = services[0];
    handlers[first.iface + '|' + first.events[0]]({ range: 40, coefficients: [1, 2, 3, 4], raw: Buffer.from([1, 2, 255]) });
    const snap = collector.snapshot();
    assert.strictEqual(snap[0].total, 1);
    assert.ok(flatten(snap[0].members.filter(m => m.count)[0].value).length >= 3);
    assert.ok(oneLine({ a: Buffer.from([1]) }, 100).indexOf('hex:01') > 0);
    const calls = [];
    const cv = { clear() {}, text(t) { calls.push(String(t)); }, roundRect() {} };
    const list = view.pages(snap, false);
    for (let page = 0; page < list.length; page++) view.draw(cv, { snapshot: snap, liveOnly: false, page: page, scroll: 0 });
    assert.ok(calls.some(t => t.indexOf('ROAD SIGHT') === 0));
    collector.stop();
    console.log('Node ' + process.version + ': all modules compile; ' + services.length + ' services, ' + total +
        ' subscriptions, ' + list.length + ' pages drawn');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
