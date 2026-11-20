'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { Canvas } = require(path.join(root, '.cache', 'idrive-kit', 'kit', 'runtime', 'canvas'));
const { icon, layout } = require('../apps/hud_blindspot/artwork');
const { draw } = require('../apps/hud_blindspot/view');
const dir = path.join(root, 'preview'); fs.mkdirSync(dir, { recursive: true });
const cv = new Canvas(800, 480); cv.clear('#111c26');
const shape = layout('hud:800x480', {});
for (const side of ['left', 'right']) {
    const out = icon(side, false, shape.size);
    // Composite translucent artwork onto a demonstration background. This is
    // only a placement preview, not a captured HUD or a claim about its brightness.
    for (let y = 0; y < shape.size; y++) for (let x = 0; x < shape.size; x++) {
        const at = (y * shape.size + x) * 4, to = ((shape.y + y) * cv.w + shape[side] + x) * 4;
        const a = out[at + 3] / 255 * shape.opacity;
        for (let c = 0; c < 3; c++) cv.d[to + c] = Math.round(out[at + c] * a + cv.d[to + c] * (1 - a));
    }
}
fs.writeFileSync(path.join(dir, 'hud-both.png'), cv.png());
const screen = new Canvas(1600, 520);
draw(screen, { enabled: true, size: 'small', opacity: '65', height: '50',
    warning: { valid: true, active: true, left: 1, right: 0, age: 120, mirror: { left: 1, right: 0 } },
    overlay: { link: 'Connected', target: 'shown' } });
fs.writeFileSync(path.join(dir, 'app.png'), screen.png());
console.log('Simulated previews: ' + dir);
