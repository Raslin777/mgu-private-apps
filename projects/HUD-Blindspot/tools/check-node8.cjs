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
const { WarningState } = require(path.join(app, 'warnings'));
const { icon, layout } = require(path.join(app, 'artwork'));
let now = 0;
const state = new WarningState(() => now);
state.update({ qualifierLaneChangeWarning: 9, statusLaneChangeWarning: { statusLaneChangeWarningLeft: 1, statusLaneChangeWarningRight: 0 } });
assert.equal(state.snapshot().left, 1);
now = 2100; assert.equal(state.snapshot().valid, false);
assert.equal(icon('left', false).length, 64 * 64 * 4);
assert.equal(layout('map:1088x480,hud:800x480', {}).width, 800);
assert.equal(typeof require(path.join(app, 'cluster_render_client')).ClusterRender, 'function');
console.log('Node ' + process.version + ': all app modules compile; warning expiry, artwork and renderer client execute');
