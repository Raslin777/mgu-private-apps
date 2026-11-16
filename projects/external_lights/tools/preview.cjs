'use strict';
// Runs the built app on the PC with the app kit's stub head unit (no car, no SDK), presses each button once and
// saves the screen after each: a check that main.js runs. Build first (python tools/build.py). The stub has no
// diagnostic link, so nothing is sent anywhere and the screen says so.
//   node tools/preview.cjs [outDir]
const fs = require('node:fs');
const path = require('node:path');
const kit = path.join(__dirname, '..', '.cache', 'idrive-kit');
const stage = path.join(kit, 'dist', 'external_lights');
if (!fs.existsSync(stage)) { console.error('Build first: python tools/build.py'); process.exit(1); }
const { headUnit } = require(path.join(kit, 'kit', 'tools', 'hu-stub'));
const out = path.resolve(process.argv[2] || 'preview');
fs.mkdirSync(out, { recursive: true });

let name = 'open';
const hu = headUnit(stage, {
    dataDir: out, fresh: true, sets: {},
    image: async (component, cv) => { fs.writeFileSync(path.join(out, name + '.png'), Buffer.isBuffer(cv) ? cv : cv.png()); },
});
hu.start();
setTimeout(async () => {
    const actions = [['show','BTN_SHOW'],['lamp','BTN_LAMP'],['flash','BTN_FLASH'],['start','BTN_START'],['stop','BTN_STOP'],
        ['tests','BTN_TESTS'],['test_source','BTN_SHOW'],['test_read','BTN_START'],['test_write','BTN_FLASH'],
        ['test_earlier','BTN_LAMP'],['test_later','BTN_STOP'],['test_back','BTN_TESTS'],['test_reopen','BTN_TESTS'],['test_back_again','BTN_TESTS']];
    for (const action of actions) {
        const b = action[1];
        if (!hu.handlers[b]) { console.error('no handler for ' + b); process.exit(1); }
        name = action[0];
        await hu.handlers[b]({ row: 0 });
        await new Promise((r) => setTimeout(r, 300));
        await hu.loopFn();
    }
    console.log('Preview images (open, ' + actions.map(a => a[0]).join(', ') + '): ' + out);
    process.exit(0);
}, 1500);
