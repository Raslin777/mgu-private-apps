'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { Canvas } = require(path.join(root, '.cache', 'idrive-kit', 'kit', 'runtime', 'canvas'));
const { icon, layout } = require('../apps/hud_blindspot/artwork');
const { draw } = require('../apps/hud_blindspot/view');
const dir = path.join(root, 'preview'); fs.mkdirSync(dir, { recursive: true });
for (const preview of [{ name: 'hud-both', active: ['left', 'right'] },
    { name: 'hud-clear', active: [] }, { name: 'hud-left', active: ['left'] }]) {
const cv = new Canvas(800, 480); cv.clear('#111c26');
const shape = layout('hud:800x480', {});
for (const side of ['left', 'right']) {
    const active = preview.active.indexOf(side) >= 0;
    const out = icon(side, active, shape.size);
    // Composite translucent artwork onto a demonstration background. This is
    // only a placement preview, not a captured HUD or a claim about its brightness.
    for (let y = 0; y < shape.size; y++) for (let x = 0; x < shape.size; x++) {
        const at = (y * shape.size + x) * 4, to = ((shape[side + 'Y'] + y) * cv.w + shape[side] + x) * 4;
        const a = out[at + 3] / 255 * shape.opacity * (active ? 1 : 0.22);
        for (let c = 0; c < 3; c++) cv.d[to + c] = Math.round(out[at + c] * a + cv.d[to + c] * (1 - a));
    }
}
fs.writeFileSync(path.join(dir, preview.name + '.png'), cv.png());
}
const screen = new Canvas(1600, 520);
draw(screen, { enabled: true, size: 'small', opacity: '65', height: '50',
    warning: { source: 'SOME/IP', valid: true, active: true, left: 1, right: 0, age: 120, mirror: { left: 1, right: 0 } },
    someip: { available: true, age: 120, sample: { qualifier: 9, left: 1, right: 0 }, mirror: { left: 1, right: 0 } },
    assisted: { available: true, age: 160, sample: { qualifier: 9, left: 1, right: 0 } },
    diagnostic: { trace: { tx: '22 D3 47', rx: '62 D3 47 01 00', origin: 'ecu', rawTasu: 'F0 F2 71 01 0F 0B 40 00 05 62 D3 47 01 00' } },
    overlay: { link: 'Connected', target: 'shown' } });
fs.writeFileSync(path.join(dir, 'app.png'), screen.png());
console.log('Simulated previews: ' + dir);
