'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const L = require('../apps/external_lights/lamps');

test('the screen and lamp buttons remain usable when all selectable lamps were refused', async () => {
    let implementation, displayed, flashes = 0;
    const handlers = {};
    class Player {
        constructor() { this.refused = L.LAMPS.map(l => l.key); this.state = 'idle'; }
        isLit() { return false; }
        flash() { flashes++; }
    }
    const modules = {
        './kit/mgu': { run(value) { implementation = value; } },
        './kit/diag': { Diag: class { async init() { return this; } } },
        './kit/parked': { watch() { return { moving: () => false, speed: () => 0 }; } },
        './lamps': L, './shows': require('../apps/external_lights/shows'), './player': { Player },
        './view': { draw(cv, theme, state) { displayed = state; } }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../apps/external_lights/main'), 'utf8'), { require: name => modules[name] });
    await implementation.start({
        ui: { onClick(name, fn) { handlers[name] = fn; }, image() {} },
        settings: { get() { return false; } }, log: { warn(message) { throw new Error(message); } },
        loop(name, fps, fn) { fn(); }, canvas() { return {}; }, theme() { return {}; }
    });
    handlers.BTN_LAMP(); handlers.BTN_FLASH();
    assert.equal(flashes, 0);
    assert.equal(displayed.lamp, 'No available lamps');
});
