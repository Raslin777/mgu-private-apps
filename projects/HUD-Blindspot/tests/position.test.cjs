'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { layout } = require('../apps/hud_blindspot/artwork');
const Position = require('../apps/hud_blindspot/position');
const { Overlay } = require('../apps/hud_blindspot/overlay');
test('positions move independently or together in two-percent steps and reset only the selected side', () => {
    let settings = {};
    const start = layout('hud:800x480', settings);
    settings.positions = Position.change(settings, 'left', 1, -1, false);
    const moved = layout('hud:800x480', settings);
    assert.equal(moved.left, start.left + 16); assert.ok(moved.leftY < start.leftY);
    assert.equal(moved.right, start.right); assert.equal(moved.rightY, start.rightY);
    settings.positions = Position.change(settings, 'both', -1, 1, false);
    const together = layout('hud:800x480', settings);
    assert.equal(together.left, start.left); assert.equal(together.right, start.right - 16);
    const right = settings.positions.right;
    settings.positions = Position.change(settings, 'left', 0, 0, true);
    assert.deepEqual(settings.positions.left, { x: 0, y: 0 }); assert.deepEqual(settings.positions.right, right);
    settings.positions = Position.change(settings, 'both', 0, 0, true);
    assert.deepEqual(settings.positions, { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } });
});
test('repeated movement stays inside each HUD half and its viewport, with no accumulated hidden offset', () => {
    for (const size of ['small', 'medium', 'large']) {
        const settings = { size };
        for (let i = 0; i < 200; i++) settings.positions = Position.change(settings, 'both', 1, 1, false);
        const edge = layout('hud:800x480', settings);
        assert.ok(edge.left + edge.size <= 396); assert.ok(edge.right + edge.size <= 680);
        assert.ok(edge.leftY + edge.size <= 360 && edge.rightY + edge.size <= 360);
        settings.positions = Position.change(settings, 'both', -1, -1, false);
        const back = layout('hud:800x480', settings);
        assert.equal(back.left, edge.left - 16); assert.equal(back.right, edge.right - 16);
        assert.ok(back.leftY < edge.leftY);
        for (let i = 0; i < 200; i++) settings.positions = Position.change(settings, 'both', -1, -1, false);
        const other = layout('hud:800x480', settings);
        assert.ok(other.left >= 120 && other.right >= 404);
        assert.ok(other.leftY >= 120 && other.rightY >= 120);
    }
});
test('old installations retain their placement, saved offsets survive reload and invalid data stays bounded', () => {
    const initial = layout('hud:800x480', {});
    assert.equal(initial.left, 144); assert.equal(initial.right, 616); assert.equal(initial.leftY, 220);
    let settings = { positions: Position.change({}, 'right', -1, 1, false) };
    const expected = layout('hud:800x480', settings);
    assert.deepEqual(layout('hud:800x480', JSON.parse(JSON.stringify(settings))), expected);
    settings = { positions: { left: { x: Infinity, y: '500' }, right: { x: 9999, y: -9999 } } };
    const bounded = layout('hud:800x480', settings);
    assert.equal(bounded.left, initial.left); assert.equal(bounded.leftY, initial.leftY);
    assert.ok(bounded.right + bounded.size <= 680); assert.ok(bounded.rightY >= 120);
    assert.equal(Position.change({}, 'both', 1, 0, false, 'map:800x480'), null);
});
test('the real overlay uses independent saved y positions as well as x positions', () => {
    const EventEmitter = require('node:events');
    class Client extends EventEmitter {
        constructor() { super(); this.ready = true; this.targets = 'hud:800x480'; this.options = []; }
        connect() {} image(opts) { this.options.push(opts); return this.options.length; }
        pixels() {} set() {} drop() {} close() {}
    }
    const client = new Client(), overlay = new Overlay(() => client, { warn() {} });
    const settings = { enabled: true, positions: { left: { x: 2, y: -4 }, right: { x: -2, y: 6 } } };
    overlay.update({ valid: true, active: true, left: 1, right: 1 }, settings, 0);
    const positions = layout('hud:800x480', settings);
    assert.equal(client.options[0].x, positions.left); assert.equal(client.options[0].y, positions.leftY);
    assert.equal(client.options[1].x, positions.right); assert.equal(client.options[1].y, positions.rightY);
    assert.notEqual(client.options[0].y, client.options[1].y);
});
