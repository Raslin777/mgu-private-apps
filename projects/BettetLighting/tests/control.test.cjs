'use strict';
// Which look is on (control.js): the driver's, a driving mode's, the car's; the rainbow through the favourites.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'better-lighting-'));
process.env.MGU_AMBIENT_FLASH = path.join(dir, 'flash.json');
const { Control, DEFAULT_LOOK } = require('../apps/better_lighting/control');

function make(initial) {
    const values = Object.assign({}, initial), shown = [];
    const settings = { get: (k) => values[k], set: (k, v) => { values[k] = v; } };
    const lights = { scene: null, show(s) { this.scene = s; shown.push(s); }, carColour() { this.scene = null; shown.push(null); }, dim(f) { this.dimmed = f; }, flash(rgb, ms) { this.flashed = [rgb, ms]; } };
    const control = new Control({ settings, lights, ambient: null, log: { info() {}, warn() {} } });
    return { control, lights, shown, values };
}
const fav = (rgb) => ({ kind: 'solid', upper: { rgb, bright: 80 }, lower: { rgb, bright: 80 }, speed: 2 });

test('picking an animation puts it on; original colour gives the lights back', () => {
    const c = make();
    c.control.setLook({ kind: 'pulse' });
    assert.equal(c.shown.length, 1);
    assert.equal(c.lights.scene.kind, 'pulse');
    assert.deepEqual(c.lights.scene.upper, DEFAULT_LOOK.upper);
    c.control.setLook({ kind: 'pulse' });
    assert.equal(c.shown.length, 1, 'the same look again is not sent again');
    c.control.carColour();
    assert.equal(c.lights.scene, null);
    assert.equal(c.values.on, false);
});

test('rainbow through the colours of the favourites: two or more saved, else every colour', () => {
    const c = make({ favs: [fav([254, 0, 0])] });
    c.control.setLook({ kind: 'rainbow', colours: 'saved' });
    assert.equal(c.lights.scene.palette, null);
    c.control.setLook({ upper: { rgb: [0, 0, 254], bright: 80 }, lower: { rgb: [0, 0, 254], bright: 80 } });
    c.control.saveFav();
    assert.deepEqual(c.lights.scene.palette, [[254, 0, 0], [0, 0, 254]], 'the new favourite joins the rainbow at once');
    c.control.setLook({ colours: 'all' });
    assert.equal(c.lights.scene.palette, undefined);
});

test('the look of a driving mode wins over the driver\'s own; Sport picked flashes first', () => {
    const c = make({ on: true, sportPulse: true, mode_sport: Object.assign(fav([254, 0, 0]), { kind: 'breathing' }) });
    c.control.apply();
    assert.equal(c.lights.scene.kind, 'solid');
    c.control.mode('comfort'); c.control.mode('sport');
    assert.equal(c.lights.scene.kind, 'sportpulse');
    assert.equal(c.lights.scene.then.kind, 'breathing');
    c.control.night(true);
    assert.equal(c.lights.dimmed, 0.5);
});
