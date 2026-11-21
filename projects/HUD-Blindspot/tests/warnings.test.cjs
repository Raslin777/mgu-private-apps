'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WarningState, selectSomeip, MAX_AGE_MS, FIELD, MIRROR_EVENT, VIEW_IFACE, VIEW_EVENT } = require('../apps/hud_blindspot/warnings');
const { WarningSource } = require('../apps/hud_blindspot/source');
const quiet = { info() {}, warn() {} };
const data = (left, right, qualifier = 9) => ({ qualifierLaneChangeWarning: qualifier,
    statusLaneChangeWarning: { statusLaneChangeWarningLeft: left, statusLaneChangeWarningRight: right } });

test('Assisted View decodes only nested lane-change warning states, never adjacent warnings or object IDs', () => {
    let now = 0; const state = new WarningState(() => now);
    for (const left of [0, 1, 2, 3]) for (const right of [0, 1, 2, 3]) {
        state.updateView({ statusLaneChangeWarning: { qualifierLaneChangeWarning: 9,
            statusLaneChangeWarningLeft: left, statusLaneChangeWarningRight: right, objectId1LaneChangeWarningLeft: 99 },
            statusLaneDepartureWarning: { directionLaneDepartureWarning: 3 },
            statusSideCollisionWarning: { directionSideCollisionWarning: 3 } });
        assert.equal(state.snapshot().left, left); assert.equal(state.snapshot().right, right);
    }
    state.updateView({ [VIEW_EVENT]: { statusLaneChangeWarning: { qualifierLaneChangeWarning: 'FUNCTION_ACTIVE_REDUCED',
        statusLaneChangeWarningLeft: 'WARNING_LEFT', statusLaneChangeWarningRight: 'NO_WARNING_RIGHT' } } });
    assert.equal(state.snapshot().left, 1);
    state.updateView({ qualifierLaneChangeWarning: 9, statusLaneChangeWarning: {
        statusLaneChangeWarningLeft: 1, statusLaneChangeWarningRight: 1 } });
    assert.equal(state.snapshot().valid, false); // Qualifier belongs inside this event's struct.
    state.updateView({ statusLaneDepartureWarning: { directionLaneDepartureWarning: 3 } });
    assert.equal(state.snapshot().valid, false);
    state.updateView({ statusLaneChangeWarning: { qualifierLaneChangeWarning: 6,
        statusLaneChangeWarningLeft: 1, statusLaneChangeWarningRight: 1 } });
    assert.equal(state.snapshot().valid, false); assert.equal(state.snapshot().authoritative, true);
    now = MAX_AGE_MS + 1; assert.equal(state.snapshot().authoritative, false);
});

test('fresh primary clear/standby/fault states take priority over Assisted View; missing or stale primary permits it', () => {
    let now = 0; const primary = new WarningState(() => now), secondary = new WarningState(() => now);
    secondary.updateView({ statusLaneChangeWarning: { qualifierLaneChangeWarning: 9,
        statusLaneChangeWarningLeft: 2, statusLaneChangeWarningRight: 1 } });
    assert.equal(selectSomeip(primary.snapshot(), secondary.snapshot()).source, 'SOME/IP Assisted View');
    for (const qualifier of [1, 3, 9, 11, 6, 14, 15]) {
        primary.update(data(0, 0, qualifier));
        const chosen = selectSomeip(primary.snapshot(), secondary.snapshot());
        assert.equal(chosen.source, 'SOME/IP'); assert.equal(chosen.left, 0);
    }
    now = 2001; secondary.updateView({ statusLaneChangeWarning: { qualifierLaneChangeWarning: 9,
        statusLaneChangeWarningLeft: 2, statusLaneChangeWarningRight: 0 } });
    assert.equal(selectSomeip(primary.snapshot(), secondary.snapshot()).left, 2);
    secondary.availability(false); assert.equal(selectSomeip(primary.snapshot(), secondary.snapshot()).valid, false);
});

test('Assisted View source subscribes to its declared event only and clears data on provider loss/shutdown', async () => {
    const handlers = {}; let available, closed = false;
    const state = new WarningState(() => 0);
    const source = new WarningSource({ async proxy(iface, instance) {
        assert.equal(iface, VIEW_IFACE); assert.equal(instance, '1'); return { shutdown() { closed = true; } };
    }, async onAvailable(p, fn) { available = fn; fn(true); }, async on(p, name, fn) { handlers[name] = fn; } },
    state, quiet, () => {}, { iface: VIEW_IFACE, event: VIEW_EVENT, mirror: false, update: raw => state.updateView(raw) });
    await source.start(); assert.deepEqual(Object.keys(handlers), [VIEW_EVENT]);
    const notification = { statusLaneChangeWarning: { qualifierLaneChangeWarning: 9,
        statusLaneChangeWarningLeft: 1, statusLaneChangeWarningRight: 0 } };
    handlers[VIEW_EVENT](notification); assert.equal(state.snapshot().left, 1);
    available(false); handlers[VIEW_EVENT](notification); assert.equal(state.snapshot().valid, false);
    available(true); assert.equal(state.snapshot().valid, false);
    handlers[VIEW_EVENT](notification); assert.equal(state.snapshot().valid, true);
    source.stop(); handlers[VIEW_EVENT](notification); await Promise.resolve(); await Promise.resolve();
    assert.equal(state.snapshot().valid, false); assert.equal(closed, true);
});
test('each side independently follows the documented warning enums, with urgent levels preserved', () => {
    const state = new WarningState(() => 0);
    assert.equal(state.snapshot().valid, false);
    for (const left of [0, 1, 2, 3]) for (const right of [0, 1, 2, 3]) {
        state.update(data(left, right));
        const s = state.snapshot(); assert.equal(s.valid, true); assert.equal(s.left, left); assert.equal(s.right, right);
    }
    state.update(data('ACUTE_WARNING_LEFT_AND_STEERING', 'FUNCTION_ACTIVE_ACUTE_WARNING_RIGHT_AND_STEERING', 'FUNCTION_ACTIVE_REDUCED'));
    assert.equal(state.snapshot().left, 3); assert.equal(state.snapshot().right, 3);
});
test('standby, invalid, unavailable, malformed and unknown values never authorize a warning', () => {
    const state = new WarningState(() => 0);
    for (const qualifier of [6, 14, 15, 0, 255, null, true, '9']) {
        state.update(data(1, 1, qualifier)); assert.equal(state.snapshot().valid, false);
        assert.equal(state.snapshot().left, 0); assert.equal(state.snapshot().right, 0);
    }
    for (const invalid of [undefined, null, 4, 15, true, '1', 'UNKNOWN']) {
        state.update(data(invalid, 1)); assert.equal(state.snapshot().valid, false);
    }
    for (const qualifier of [1, 3]) {
        state.update(data(0, 0, qualifier)); assert.equal(state.snapshot().valid, true); assert.equal(state.snapshot().active, false);
        state.update(data(1, 0, qualifier)); assert.equal(state.snapshot().valid, false);
    }
    state.update(data(1, 0)); state.update({}); assert.equal(state.snapshot().valid, false);
});
test('stale samples, time moving backwards and provider loss remove warnings until a fresh typed event', () => {
    let now = 100;
    const state = new WarningState(() => now); state.update(data(1, 2));
    assert.equal(state.snapshot().authoritative, true);
    now += MAX_AGE_MS + 1; assert.match(state.snapshot().reason, /stale/);
    assert.equal(state.snapshot().authoritative, false);
    state.update(data(1, 2)); assert.equal(state.snapshot().valid, true);
    now--; assert.equal(state.snapshot().valid, false);
    assert.equal(state.snapshot().authoritative, false);
    state.availability(false); state.availability(true);
    assert.equal(state.snapshot().valid, false); assert.equal(state.sample, null);
    assert.equal(state.snapshot().authoritative, false);
    state.update({ [FIELD]: data(0, 1) }); assert.equal(state.snapshot().right, 1);
});
test('raw mirror values are diagnostic evidence only, including defaults and nonzero values', () => {
    const state = new WarningState(() => 0);
    for (const raw of [0, 1, 2, 15, 255]) {
        state.updateMirror({ requestExteriorMirrorDisplayWarningLeftHand: raw, requestExteriorMirrorDisplayWarningRightHand: raw });
        assert.equal(state.snapshot().valid, false); assert.equal(state.snapshot().left, 0);
        assert.equal(state.snapshot().mirror.left, raw);
    }
});
test('source only subscribes, ignores notifications after provider loss and shuts its proxy down', async () => {
    const handlers = {}; let available, shutdown = 0, changes = 0;
    const signals = { async proxy(iface, instance) { assert.equal(instance, '1'); return { shutdown() { shutdown++; } }; },
        async onAvailable(p, fn) { available = fn; fn(true); }, async on(p, name, fn) { handlers[name] = fn; } };
    const state = new WarningState(() => 0);
    const source = new WarningSource(signals, state, quiet, () => changes++);
    await source.start(); assert.deepEqual(Object.keys(handlers), [FIELD, MIRROR_EVENT]);
    handlers[FIELD](data(1, 0)); assert.equal(state.snapshot().left, 1);
    available(false); handlers[FIELD](data(1, 1)); assert.equal(state.snapshot().valid, false);
    available(true); assert.equal(state.snapshot().valid, false);
    handlers[FIELD](data(0, 1)); assert.equal(state.snapshot().right, 1);
    source.stop(); handlers[FIELD](data(1, 1)); await Promise.resolve(); await Promise.resolve();
    assert.equal(shutdown, 1); assert.equal(state.snapshot().valid, false); assert.ok(changes > 0);
});
test('optional mirror subscription failure leaves typed warnings usable; a failed primary subscription stays unavailable', async () => {
    for (const missing of [FIELD, MIRROR_EVENT]) {
        const state = new WarningState(() => 0); let handler, closed = false;
        const source = new WarningSource({ async proxy() { return { shutdown() { closed = true; } }; },
            async onAvailable(p, fn) { fn(true); }, async on(p, name, fn) {
                if (name === missing) throw new Error('missing'); handler = fn;
            } }, state, quiet, () => {});
        await source.start();
        if (missing === FIELD) { assert.equal(state.available, false); assert.equal(closed, true); }
        else { handler(data(1, 0)); assert.equal(state.snapshot().left, 1); }
        source.stop();
    }
});
