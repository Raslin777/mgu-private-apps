'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { Session } = require('../apps/external_lights/session');
const Vehicle = require('../apps/external_lights/vehicle');
const { rig, quiet } = require('./sim.cjs');
const Shows = require('../apps/external_lights/shows');

function fixture(replies) {
    const diag = Object.assign(new EventEmitter(), { p: {}, available: true });
    const sent = [];
    diag.physical = async (target, sid, data, timeout, accept, opts) => {
        sent.push({ target, sid, data, opts });
        return replies.shift();
    };
    let time = 0;
    return { diag, sent, session: new Session(diag, quiet, { allowed: () => null, now: () => time }), time(t) { time = t; } };
}
const ready = () => [[0x62, 0xf1, 0x50, 1], [0x62, 0xd5, 0x42, 1], [0x50, 3]];

test('NRC 22 identifies the failed request without claiming a speed lock', async () => {
    for (const [sid, data, step] of [
        [0x22, [0xf1,0x50], 'BDC identity read'],
        [0x22, [0xd5,0x42], 'D542 capability read'],
        [0x10, [3], 'Extended session setup'],
        [0x2e, [0xd5,0x42,0,6,0,10], 'Lamp command: Indicator left'],
        [0x3e, [0], 'Session keepalive']
    ]) {
        const f = fixture([[0x7f,sid,0x22]]);
        await assert.rejects(f.session.request(sid,data), e => {
            assert.equal(e.message, 'Conditions not correct (NRC 22)');
            assert.equal(e.detail.phase, step);
            assert.equal(e.detail.nrc, 0x22);
            assert.equal(e.detail.ecu, '40');
            assert.match(e.detail.reply, /^7f /);
            return true;
        });
        assert.equal(f.session.lastFailure.phase, step);
    }
});
test('cleanup refusal preserves the original lamp refusal and both raw responses', async () => {
    const f = fixture(ready().concat([[0x7f,0x2e,0x22],[0x7f,0x10,0x22]]));
    await f.session.open();
    await assert.rejects(f.session.write([0xd5,0x42,0,6,0,10]));
    await f.session.close();
    assert.equal(f.session.lastFailure.reply, '7f 2e 22');
    assert.equal(f.session.cleanupFailure.reply, '7f 10 22');
    assert.equal(f.session.cleanupFailed, true);
});
test('timeouts and unrelated/malformed replies are not mislabeled NRC 22', async () => {
    for (const response of [null, [0x7f,0x22], [0x7f,0x2e,0x22]]) {
        const f = fixture([response]);
        await assert.rejects(f.session.request(0x10,[3]));
        assert.equal(f.session.lastFailure.nrc, null);
        assert.doesNotMatch(f.session.lastFailure.message, /NRC 22/);
    }
});
test('the screen shows phase, ECU and TX/RX, including a separate cleanup failure', () => {
    const { draw } = require('../apps/external_lights/view');
    const texts = [];
    draw({ clear() {}, roundRect() {}, text(s,x,y) { texts.push({ s,x,y }); } },
        { bg:'#000', text:'#fff', dim:'#888', warn:'#f00' }, {
            state:'idle', reason:'Conditions not correct (NRC 22)', show:'test', link:true,
            failure:{ phase:'Extended session setup', ecu:'40', request:'10 03', reply:'7f 10 22' },
            cleanupFailure:{ message:'Conditions not correct (NRC 22)' }
        });
    assert.ok(texts.some(t => t.s === 'Failed step: Extended session setup'));
    assert.ok(texts.some(t => t.s === 'ECU 40 TX: 10 03'));
    assert.ok(texts.some(t => t.s === 'RX: 7F 10 22'));
    assert.ok(texts.some(t => t.s.startsWith('Cleanup:')));
    assert.ok(texts.every(t => t.y < 520));
});

test('read-only identity/capability preflight precedes session, keepalive and default cleanup; no retries', async () => {
    const f = fixture(ready().concat([[0x7e, 0], [0x50, 1]]));
    await f.session.open(); f.time(2500); assert.equal(f.session.due(), true);
    await f.session.keep(); await f.session.close();
    assert.deepEqual(f.sent.map(r => [r.sid].concat(r.data)), [[0x22,0xf1,0x50],[0x22,0xd5,0x42],[0x10,3],[0x3e,0],[0x10,1]]);
    assert.ok(f.sent.every(r => r.target === 0x40 && r.opts.maxRetries === 0));
    assert.equal(f.session.audit.length, 5);
});
test('unavailable link, empty identity, refused capability and refused session never authorize lamp writes', async () => {
    for (const replies of [[], [[0x62,0xf1,0x50]], [[0x62,0xf1,0x50,1],[0x7f,0x22,0x31]], ready().slice(0,2).concat([[0x7f,0x10,0x22]])]) {
        const f = fixture(replies); await assert.rejects(f.session.open());
        await assert.rejects(f.session.write([0xd5,0x42,0,6,0,10]));
        assert.ok(!f.sent.some(r => r.sid === 0x2e));
    }
    const f = fixture([]); f.diag.available = false;
    await assert.rejects(f.session.open(), /unavailable/); assert.equal(f.sent.length, 0);
});
test('detected ambient-light traffic blocks further work, while cleanup remains available', async () => {
    const f = fixture(ready().concat([[0x50,1]])); await f.session.open();
    f.diag.emit('frame', { ecu: 0x40, uds: [0x6e,0xda,0x5e] });
    await assert.rejects(f.session.write([0xd5,0x42,0,6,0,10]), /Better Lighting/);
    await f.session.close(); assert.equal(f.sent.length, 4);
});
test('lost session reply still triggers cleanup, and failed cleanup is recorded', async () => {
    const f = fixture(ready().slice(0,2).concat([null,null]));
    await assert.rejects(f.session.open()); await f.session.close();
    assert.equal(f.session.cleanupFailed, true);
    assert.equal(f.sent.filter(r => r.sid === 0x10).length, 2);
});
test('malformed, brake and guessed headlight operations cannot reach TASU', async () => {
    const f = fixture([]);
    for (const [sid, bytes] of [[0x2f,[0xe3,0xb5,3,1]], [0x2e,[0xd5,0x42,0,0x0c,0,10]], [0x2e,[0xd6,0xdc,0,5,1]], [0x2e,[0xd5,0x42,0,6,NaN,1]]]) {
        await assert.rejects(f.session.request(sid,bytes));
    }
    assert.equal(f.sent.length, 0);
});
test('production session workflow runs with a moving-vehicle warning and cleans up without overlapping requests', async () => {
    const r = rig({ session: true }); r.state.moving = true;
    assert.equal(r.player.play(Shows.show('sides')), true);
    await r.clock.run(3500); assert.ok(r.car.writes().length > 0);
    r.player.stop('Stopped'); await r.clock.run(3500);
    assert.equal(r.player.state, 'idle'); assert.equal(r.car.overlaps, 0);
    assert.deepEqual(r.car.log.slice(-1).map(r => [r.sid].concat(r.data)), [[0x10,1]]);
});
test('Stop during preflight prevents activation and handles an already accepted extended session', async () => {
    for (const at of [100,450]) {
        const r = rig({ session: true }); r.player.play(Shows.show('sides'));
        await r.clock.run(at); r.player.stop('Stopped'); await r.clock.run(5000);
        assert.equal(r.car.writes().length, 0); assert.equal(r.player.state, 'idle');
        assert.equal(r.car.overlaps, 0);
    }
});
test('quiet gaps keep the session alive on the same serialized request loop', async () => {
    const r = rig({ session: true });
    r.player.play({ name: 'gap', period: 8000, events: [{ t: 0, lamp: 'turnL', ms: 100 }, { t: 6000, lamp: 'turnR', ms: 100 }] });
    await r.clock.run(5500);
    assert.ok(r.car.log.some(q => q.sid === 0x3e));
    r.player.stop('Stopped'); await r.clock.run(3000); assert.equal(r.car.overlaps, 0);
});
test('a lost lamp reply is not replayed, and cleanup follows before a default-session request', async () => {
    const r = rig({ session: true });
    const physical = r.car.physical.bind(r.car);
    r.car.physical = async (ecu,sid,data,...rest) => {
        const reply = await physical(ecu,sid,data,...rest);
        return sid === 0x2e && data[5] !== 0 ? null : reply;
    };
    r.player.flash('turnL',1000); await r.clock.run(6000);
    const writes = r.car.writes();
    assert.equal(writes.filter(q => q.data[5] !== 0).length, 1);
    assert.ok(writes.some(q => q.data[4] === 0 && q.data[5] === 0));
    assert.equal(r.car.overlaps, 0); assert.equal(r.player.state, 'idle');
});
test('speed and Park telemetry produce warnings without a permissive bench fallback', async () => {
    const handlers = {}; let now = 0;
    const v = Vehicle.watch({ signals: { async watch(iface, instance, h) { Object.assign(handlers,h); return {}; } } }, quiet, () => now);
    assert.match(v.reason(), /speed/);
    handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: 640 });
    assert.match(v.reason(), /moving/);
    handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: 0 });
    handlers.statusGearboxDrive({ statusActualStageDrive: 'P' }); assert.equal(v.reason(), null);
    now = 1600; assert.match(v.reason(), /stale/);
    handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: 65535 }); assert.equal(v.speed(), null);
});
