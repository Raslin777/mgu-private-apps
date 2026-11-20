'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { Overlay } = require('../apps/hud_blindspot/overlay');
const { icon, layout } = require('../apps/hud_blindspot/artwork');
const log = { info() {}, warn() {} };
class Client extends EventEmitter {
    constructor() { super(); this.ready = false; this.targets = 'map:1088x480,hud:800x480'; this.layers = new Map(); this.calls = []; this.next = 1; }
    connect() { this.calls.push(['connect']); }
    close() { this.closed = true; this.layers.clear(); }
    image(opts) { const ref = this.next++; this.layers.set(ref, opts); this.calls.push(['image', opts]); return ref; }
    pixels(ref, rect, pixels) { assert.equal(pixels.length, 64 * 64 * 4); this.calls.push(['pixels', ref]); }
    set(ref, opts) { Object.assign(this.layers.get(ref), opts); this.calls.push(['set', ref, opts]); }
    drop(ref) { this.layers.delete(ref); this.calls.push(['drop', ref]); }
}
const settings = { enabled: true, size: 'small', opacity: '65', height: '50' };
const warning = (left, right) => ({ valid: true, active: true, left, right });
function fixture() {
    let count = 0; const client = new Client(); const overlay = new Overlay(() => { count++; return client; }, log);
    overlay.update(warning(0, 0), settings, 0); client.ready = true; client.emit('ready');
    return { client, overlay, count: () => count };
}
test('disabled never connects; enabling creates only small transparent HUD overlays without exclusivity or contention', () => {
    let calls = 0; const off = new Overlay(() => { calls++; return new Client(); }, log);
    off.update(warning(1, 1), { enabled: false }, 0); assert.equal(calls, 0);
    const f = fixture(); f.overlay.update(warning(1, 1), settings, 0);
    assert.equal(f.client.layers.size, 2);
    const layers = [...f.client.layers.values()];
    for (const l of layers) {
        assert.equal(l.target, 'hud'); assert.equal(l.klass, 'overlay'); assert.equal(l.exclusive, false);
        assert.equal(l.contend, false); assert.equal(l.prewarm, false); assert.equal(l.opacity, 0.65);
        assert.equal(l.w, 40); assert.equal(l.h, 40); assert.equal(l.visible, true);
    }
    assert.ok(layers[0].x < 200 && layers[1].x > 550);
    f.overlay.update(warning(1, 1), { enabled: false }, 0);
    assert.equal(f.client.layers.size, 0); assert.equal(f.client.closed, true); assert.equal(f.overlay.client, null);
});
test('clear sides keep faint outlines, steady warnings upload nothing and urgent warnings blink filled/outline at 2 Hz', () => {
    const f = fixture(); f.overlay.update(warning(1, 2), settings, 0);
    const before = f.client.calls.length; f.overlay.update(warning(1, 2), settings, 100);
    assert.equal(f.client.calls.length, before);
    f.overlay.update(warning(1, 2), settings, 250);
    assert.equal(f.client.layers.get(f.overlay.layers.left).visible, true);
    assert.equal(f.client.layers.get(f.overlay.layers.right).visible, true);
    assert.equal(f.client.layers.get(f.overlay.layers.right).opacity, 0.65 * 0.22);
    f.overlay.update(warning(0, 2), settings, 500); assert.equal(f.client.layers.size, 2);
    assert.equal(f.client.layers.get(f.overlay.layers.right).opacity, 0.65);
    assert.equal(f.client.layers.get(f.overlay.layers.left).opacity, 0.65 * 0.22);
    f.overlay.update(warning(0, 0), settings, 500); assert.equal(f.client.layers.size, 2);
    assert.ok([...f.client.layers.values()].every(l => l.opacity === 0.65 * 0.22));
});
test('stale data removes fills; unsupported HUD, disconnect and mapping guard clear cached layers', () => {
    const f = fixture(); f.overlay.update(warning(1, 0), settings, 0);
    f.overlay.update({ valid: false, active: false, left: 1, right: 2 }, settings, 0); assert.equal(f.client.layers.size, 2);
    assert.ok([...f.client.layers.values()].every(l => l.opacity === 0.65 * 0.22));
    f.overlay.update(warning(1, 0), settings, 0); f.client.ready = false; f.client.emit('disconnected');
    assert.equal(f.client.layers.size, 0); assert.deepEqual(f.overlay.layers, {});
    f.client.ready = true; f.client.emit('ready');
    f.overlay.update({ valid: false }, settings, 0); assert.equal(f.client.layers.size, 2);
    assert.ok([...f.client.layers.values()].every(l => l.opacity === 0.65 * 0.22));
    f.client.targets = 'map:1088x480'; f.overlay.update(warning(1, 0), settings, 0);
    assert.match(f.overlay.target, /not supported/); assert.equal(f.client.layers.size, 0);
    f.client.targets = 'hud:800x480'; f.overlay.update(warning(1, 0), settings, 0);
    f.client.emit('target', 'hud', 'disabled', '', '', false, true);
    f.overlay.update(warning(1, 0), settings, 0);
    assert.equal(f.client.layers.size, 0); assert.match(f.overlay.target, /guard/);
    assert.ok(!f.client.calls.some(c => /guard.reset/.test(String(c))));
});
test('artwork has fully transparent edges, mirrored geometry and no opaque background', () => {
    const left = icon('left', false), right = icon('right', false); let ink = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const at = (y * 64 + x) * 4, mirrored = (y * 64 + 63 - x) * 4;
        assert.equal(left[at + 3], right[mirrored + 3]);
        if (left[at + 3]) ink++;
        if (!x || !y || x === 63 || y === 63) assert.equal(left[at + 3], 0);
    }
    assert.ok(ink > 300 && ink < 1500);
    const active = icon('left', true);
    assert.ok(active.filter((v, i) => i % 4 === 3 && v > 0).length > ink);
    assert.equal(layout('hud:353x203', {}).size, 24);
    assert.equal(layout('map:800x480', {}), null);
    assert.equal(layout('hud:8000x480', {}), null);
});
module.exports = { Client };
