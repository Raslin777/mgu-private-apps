'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
if (!/^v8\./.test(process.version)) {
    const exe = path.join(__dirname, '..', '.cache', 'node8.exe');
    const result = require('child_process').spawnSync(exe, [__filename], { stdio: 'inherit' });
    if (result.error) console.error(result.error.message);
    process.exit(result.error ? 1 : result.status);
}
const app = path.join(__dirname, '..', 'apps', 'hud_blindspot');
for (const file of fs.readdirSync(app).filter(f => /\.js$/.test(f)))
    new vm.Script('(function(require,module,exports){' + fs.readFileSync(path.join(app, file), 'utf8') + '\n})', { filename: file });
const { WarningState, selectSomeip } = require(path.join(app, 'warnings'));
const { icon, layout } = require(path.join(app, 'artwork'));
let now = 0;
const state = new WarningState(() => now);
state.update({ qualifierLaneChangeWarning: 9, statusLaneChangeWarning: { statusLaneChangeWarningLeft: 1, statusLaneChangeWarningRight: 0 } });
assert.equal(state.snapshot().left, 1);
now = 2100; assert.equal(state.snapshot().valid, false);
const assisted = new WarningState(() => now);
assisted.updateView({ statusLaneChangeWarning: { qualifierLaneChangeWarning: 9,
    statusLaneChangeWarningLeft: 0, statusLaneChangeWarningRight: 2 } });
assert.equal(selectSomeip(state.snapshot(), assisted.snapshot()).source, 'SOME/IP Assisted View');
assert.equal(assisted.snapshot().right, 2);
assert.equal(icon('left', false).length, 64 * 64 * 4);
assert.equal(layout('map:1088x480,hud:800x480', {}).width, 800);
const position = require(path.join(app, 'position'));
const saved = position.change({}, 'left', 1, -1, false);
assert.equal(layout('hud:800x480', { positions: saved }).left, 160);
assert.equal(layout('hud:800x480', { positions: saved }).right, 616);
assert.equal(typeof require(path.join(app, 'cluster_render_client')).ClusterRender, 'function');
async function readCheck() {
    const { MirrorReader, decodeD347, selectSource } = require(path.join(app, 'uds'));
    const log = { info() {}, warn() {} };
    let calls = 0;
    const reader = new MirrorReader({ async proxy() { return { shutdown() {} }; }, async on() {},
        async onAvailable(p, fn) { fn(true); }, async call(p, method, args) {
            calls++; assert.equal(method, 'sendTasuRequest'); assert.equal(args.serviceID, 0x22);
            assert.deepEqual(Array.from(args.udsData), [0xd3, 0x47]);
            reader.receive({ errorCode: 'NO_ERROR', udsResponse: Buffer.from([0xf0, 0xf2, 0x71, 1, 0xf, 0xb, 0x40, 0, 5, 0x62, 0xd3, 0x47, 4, 0]) });
            return 'NO_ERROR';
        } }, log, function () {});
    await reader.start(); reader.tick(false); assert.equal(calls, 0);
    reader.tick(true); assert.equal(reader.snapshot().left, 2);
    assert.equal(selectSource(reader.snapshot(), { valid: false }, 'auto').source, 'UDS D347');
    assert.equal(selectSource(reader.snapshot(), { valid: false }, 'someip').source, 'SOME/IP');
    const probeModule = require(path.join(app, 'probe'));
    assert.ok(/NOT OFFERED/.test(probeModule.describe('x', { stage: 'subscribed', offered: false, events: 0 })));
    assert.equal(selectSource(reader.snapshot(), { valid: false }, 'uds').source, 'UDS D347');
    assert.equal(decodeD347([0x62, 0xd3, 0x47, 0x0d, 0]).valid, false);
    await Promise.resolve(); reader.stop();
    console.log('Node ' + process.version + ': all app modules compile; positions, D347 reader/decoder, warning expiry and artwork execute');
}
readCheck().catch(error => { console.error(error); process.exitCode = 1; });
