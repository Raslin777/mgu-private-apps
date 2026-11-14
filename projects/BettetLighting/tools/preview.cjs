'use strict';
// Draws the built app's four tabs on the PC with the app kit's stub head unit (no car, no SDK): a check that the
// screen code runs and a look at the layout. Build first (python tools/build.py). The stub has no diagnostic
// link, so the pictures show the app as on a car whose body controller does not answer.
//   node tools/preview.cjs [outDir] [found | unknown | upper]
// found (default): a G20's 19 lights kept from an earlier run; unknown: the lights not read yet; upper: a car
// with one bus of upper lights only. The file names start with that word.
const fs = require('node:fs');
const path = require('node:path');
const kit = path.join(__dirname, '..', '.cache', 'idrive-kit');
const stage = path.join(kit, 'dist', 'better_lighting');
if (!fs.existsSync(stage)) { console.error('Build first: python tools/build.py'); process.exit(1); }
const { headUnit } = require(path.join(kit, 'kit', 'tools', 'hu-stub'));
const { found } = require('../tests/sim.cjs');
const out = path.resolve(process.argv[2] || 'preview');
fs.mkdirSync(out, { recursive: true });

const fav = (rgb) => ({ kind: 'solid', upper: { rgb, bright: 80 }, lower: { rgb, bright: 80 }, speed: 2 });
const variant = process.argv[3] || 'found';
const upperOnly = () => { const f = found(); return { lights: f.lights.filter((l) => l[0] === 1 && [0x15, 0x17, 0x13, 0x05, 0x09].indexOf(l[2]) >= 0), buses: ['absent', 'present'] }; };
const kept = variant === 'unknown' ? null : variant === 'upper' ? upperOnly() : found();
let name = variant + '-start';
const hu = headUnit(stage, {
    dataDir: out, fresh: true,
    sets: { on: true, lightsFound: kept, favs: [fav([254, 0, 0]), fav([0, 0, 254])],
        look: Object.assign(fav([254, 60, 0]), { kind: 'rainbow', colours: 'saved' }) },
    image: async (component, cv) => { fs.writeFileSync(path.join(out, name + '.png'), Buffer.isBuffer(cv) ? cv : cv.png()); },
});
hu.start();
setTimeout(async () => {
    const tabs = ['colour', 'animations', 'driving-modes', 'favourites'];
    for (let i = 0; i < tabs.length; i++) {
        name = variant + '-' + tabs[i];
        await hu.display.onTab(i);
        await new Promise((r) => setTimeout(r, 200));
    }
    console.log('Preview images (' + tabs.join(', ') + '): ' + out);
    process.exit(0);
}, 1500);
