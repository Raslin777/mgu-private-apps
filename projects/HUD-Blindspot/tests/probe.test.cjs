'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Probe, CHECKS, describe, verdict, stageOf } = require('../apps/hud_blindspot/probe');
const { WarningSource } = require('../apps/hud_blindspot/source');
const { WarningState } = require('../apps/hud_blindspot/warnings');
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', 'hud_blindspot', 'app.json')));
const quiet = { info() {}, warn() {} };
function fake(options) {
    const opts = options || {}, handlers = {}, closed = [];
    return { handlers, closed,
        async proxy(iface) {
            if ((opts.missing || []).indexOf(iface) >= 0) throw new Error('no SOME/IP config for ' + iface + ' (add it to app.json "signals")');
            if ((opts.refused || []).indexOf(iface) >= 0) throw new Error('access denied');
            return { iface, shutdown() { closed.push(iface); } };
        },
        async onAvailable(p, fn) { fn((opts.offered || []).indexOf(p.iface) >= 0); },
        async on(p, name, fn) { handlers[p.iface + '|' + name] = fn; } };
}
const none = { stage: 'subscribed', offered: false, events: 0, error: '' };

test('every check is declared read-only and optional in the manifest', () => {
    for (const c of CHECKS) {
        const block = spec.signals[c.iface];
        assert.ok(block && block._optional, c.iface);
        assert.ok((block._broadcasts || []).indexOf(c.member) >= 0 || block[c.member] === 's', c.member);
        assert.equal(block._methods, undefined);
    }
});

test('the probe reports the stage each subscription reached and counts events', async () => {
    const signals = fake({ missing: [CHECKS[1].iface], refused: [CHECKS[2].iface], offered: [CHECKS[0].iface] });
    const probe = new Probe(signals, quiet);
    await probe.start();
    signals.handlers[CHECKS[0].iface + '|' + CHECKS[0].member]({});
    const st = probe.status();
    assert.deepEqual(st.map(s => s.stage), ['subscribed', 'no definition', 'refused', 'subscribed']);
    assert.equal(st[0].events, 1); assert.equal(st[0].offered, true); assert.equal(st[3].offered, false);
    assert.match(describe(st[0].label, st[0]), /RECEIVING, 1 updates/);
    assert.match(describe(st[1].label, st[1]), /no definition/);
    assert.match(describe(st[2].label, st[2]), /refused: access denied/);
    assert.match(describe(st[3].label, st[3]), /NOT OFFERED/);
    probe.stop(); await Promise.resolve();
    assert.equal(signals.closed.length, 2);
    signals.handlers[CHECKS[0].iface + '|' + CHECKS[0].member]({});
    assert.equal(probe.status()[0].events, 1, 'nothing is counted after stop');
});

test('the conclusion separates the cases that look the same on the main page', () => {
    const bdc = { origin: 'bdc', stage: 'subscribed', offered: true, events: 40 };
    const assist = { origin: 'assist', stage: 'subscribed', offered: false, events: 0 };
    assert.match(verdict([Object.assign({}, none, { events: 3 }), none], [bdc, assist]), /arriving over SOME\/IP/);
    assert.match(verdict([Object.assign({}, none, { stage: 'no definition' }), none], [bdc, assist]), /reinstall/);
    assert.match(verdict([Object.assign({}, none, { stage: 'refused' }), none], [bdc, assist]), /refused/);
    assert.match(verdict([Object.assign({}, none, { offered: true }), none], [bdc, assist]), /offers the blind-spot service/);
    // The owner's symptom: nothing offered. Which of the three it is depends on the other services.
    assert.match(verdict([none, none], [bdc, assist]), /nothing from the assistance computer is offered/);
    assert.match(verdict([none, none], [bdc, Object.assign({}, assist, { offered: true })]), /does not offer the blind-spot service/);
    assert.match(verdict([none, none], [Object.assign({}, bdc, { offered: false, events: 0 }), assist]), /No car service is offered/);
    assert.match(verdict([none, none], [bdc, assist], { valid: true }), /Using the mirror status read instead/);
    assert.equal(stageOf(new Error('someip native module not available')), 'no SOME/IP on this host');
});

test('a warning source remembers why it failed instead of only showing unavailable', async () => {
    const iface = 'de.bmw.dass.driverassistanceapplications.LateralCollisionAvoidance';
    const missing = new WarningSource(fake({ missing: [iface] }), new WarningState(), quiet, () => {});
    await missing.start();
    assert.equal(missing.status().stage, 'no definition'); assert.match(missing.status().error, /no SOME\/IP config/);
    const notOffered = new WarningSource(fake(), new WarningState(), quiet, () => {});
    await notOffered.start();
    assert.deepEqual(notOffered.status(), { stage: 'subscribed', offered: false, events: 0, error: '' });
});
