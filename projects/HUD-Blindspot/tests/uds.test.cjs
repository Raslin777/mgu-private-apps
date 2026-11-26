'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MirrorReader, decodeD347, selectSource, POLL_MS, BACKOFF_MS, IFACE, INSTANCE } = require('../apps/hud_blindspot/uds');
const { draw } = require('../apps/hud_blindspot/view');
const quiet = { info() {}, warn() {} };
const positive = (left, right) => [0x62, 0xd3, 0x47, left, right];
const raw = (reply, ecu = 0x40, source = 0xf2) => ({ errorCode: 'NO_ERROR',
    udsResponse: Buffer.from([0xf0, source, 0x71, 1, 0xf, 0xb, ecu, 0, reply.length].concat(reply)) });
const flush = () => new Promise(resolve => setImmediate(resolve));
async function fixture(options) {
    const state = { now: 0, calls: [], handlers: {}, shutdown: 0, verdict: 'NO_ERROR' };
    const signals = {
        async proxy(iface, instance) { assert.equal(iface, IFACE); assert.equal(instance, INSTANCE);
            return { shutdown() { state.shutdown++; } }; },
        async on(p, name, fn) { state.handlers[name] = fn; },
        async onAvailable(p, fn) { state.available = fn; fn(true); },
        call(p, method, args) { state.calls.push({ method, args }); return state.reply ? state.reply(args) : state.verdict; }
    };
    const reader = new MirrorReader(signals, quiet, () => {}, Object.assign({ now: () => state.now, deadlineMs: 100 }, options));
    await reader.start(); return { reader, state, signals };
}
test('D347 decoder distinguishes all four active states from display faults and invalid bytes', () => {
    for (const left of [0, 1, 2, 3, 4]) for (const right of [0, 1, 2, 3, 4]) {
        const d = decodeD347(positive(left, right)); assert.equal(d.valid, true);
        assert.equal(d.left, left === 0 ? 0 : left === 1 ? 1 : 2);
        assert.equal(d.right, right === 0 ? 0 : right === 1 ? 1 : 2);
    }
    for (const bad of [5, 13, 15, 255]) {
        const d = decodeD347(positive(bad, 1)); assert.equal(d.valid, false); assert.equal(d.left, 0); assert.equal(d.right, 0);
    }
    for (const reply of [null, [], [0x7f, 0x22, 0x22], [0x62, 0xd3, 0x47, 1], [...positive(1, 1), 0], [0x62, 0xd5, 0x42, 1, 1]])
        assert.equal(decodeD347(reply).valid, false);
});
test('the reader sends only fixed F2 -> BDC 40 / 22 D347 and never overlaps or polls faster than 250 ms', async t => {
    const f = await fixture(); t.after(() => f.reader.stop());
    f.reader.tick(false); assert.equal(f.state.calls.length, 0);
    f.reader.tick(true); f.reader.tick(true); assert.equal(f.state.calls.length, 1);
    const c = f.state.calls[0]; assert.equal(c.method, 'sendTasuRequest');
    assert.deepEqual({ source: c.args.sourceAddress, target: c.args.targetAddress, sid: c.args.serviceID,
        sub: c.args.subroutineID, len: c.args.udsDataLength, data: [...c.args.udsData], deadlock: c.args.deadlockTime },
        { source: 0xf2, target: 0x40, sid: 0x22, sub: 0, len: 2, data: [0xd3, 0x47], deadlock: 0 });
    f.reader.receive(raw(positive(1, 4))); await flush();
    assert.equal(f.reader.snapshot().left, 1); assert.equal(f.reader.snapshot().right, 2);
    assert.equal(f.reader.trace.rx, '62 D3 47 01 04'); assert.match(f.reader.trace.rawTasu, /F0 F2 71/);
    f.state.now = POLL_MS - 1; f.reader.tick(true); assert.equal(f.state.calls.length, 1);
    f.state.now++; f.reader.tick(true); assert.equal(f.state.calls.length, 2);
    f.reader.receive(raw(positive(0, 0))); assert.equal(f.reader.snapshot().valid, true); assert.equal(f.reader.snapshot().left, 0);
    f.reader.tick(false); assert.equal(f.reader.snapshot().valid, false);
});
test('a wrong ECU or DID cannot authorize a warning, and other BDC traffic neither answers nor cancels the read', async t => {
    const f = await fixture(); t.after(() => f.reader.stop());
    f.reader.tick(true); f.reader.receive(raw(positive(1, 1), 0x43));
    assert.equal(f.reader.snapshot().valid, false); assert.ok(f.reader.active);
    // Another app reading a different identifier on the BDC: ignored, our read keeps waiting.
    f.reader.receive(raw([0x62, 0xd5, 0x42, 1])); f.reader.receive(raw([0x6e, 0xd5, 0x42]));
    assert.ok(f.reader.active); assert.equal(f.reader.snapshot().valid, false); assert.equal(f.state.calls.length, 1);
    f.reader.receive(raw(positive(1, 0))); assert.equal(f.reader.active, null);
    assert.equal(f.reader.snapshot().valid, true); assert.equal(f.reader.snapshot().left, 1);
    assert.equal(f.reader.stats.answered, 1); assert.equal(f.reader.stats.missed, 0);
});
test('the reply wait matches the transport that works on the car, and a slow answer is still used', async t => {
    const { REPLY_MS, HARD_MS, CALL_MS } = require('../apps/hud_blindspot/uds');
    assert.ok(REPLY_MS >= 4000 && HARD_MS >= 10000 && CALL_MS >= 8000);
    const f = await fixture({ deadlineMs: 0 }); t.after(() => f.reader.stop());        // production waits
    assert.equal(f.reader.replyMs, REPLY_MS); assert.equal(f.reader.hardMs, HARD_MS);
    f.reader.tick(true); await flush();
    f.state.now = 2600;                                                             // later than the old 1.5 s limit
    f.reader.receive(raw(positive(0, 2)));
    assert.equal(f.reader.snapshot().valid, true); assert.equal(f.reader.snapshot().right, 2);
    assert.equal(f.reader.stats.lastMs, 2600); assert.equal(f.reader.trace.ms, 2600);
    assert.equal(f.reader.trace.verdict, 'NO_ERROR');
});
test('an answer that arrives after its read was given up on is used and counted as late', async t => {
    const f = await fixture({ deadlineMs: 10 }); t.after(() => f.reader.stop());
    f.reader.tick(true); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(f.reader.active, null); assert.equal(f.reader.stats.missed, 1); assert.equal(f.reader.snapshot().valid, false);
    f.reader.receive(raw(positive(4, 0)));
    assert.equal(f.reader.stats.late, 1); assert.equal(f.reader.snapshot().valid, true); assert.equal(f.reader.snapshot().left, 2);
    assert.equal(f.reader.trace.origin, 'ecu (late)');
    f.reader.receive(raw([0x7f, 0x22, 0x31])); assert.equal(f.reader.blocked, false, 'a stray negative reply with no read waiting changes nothing');
});
test('negative UDS and outer TASU errors stay distinct; unsupported/access-denied reads latch until re-enabled', async t => {
    for (const code of [0x11, 0x31, 0x33]) {
        const f = await fixture(); t.after(() => f.reader.stop()); f.reader.tick(true);
        f.reader.receive(raw([0x7f, 0x22, code])); await flush();
        assert.equal(f.reader.snapshot().valid, false); assert.equal(f.reader.blocked, true);
        assert.equal(f.reader.trace.origin, 'ecu'); assert.match(f.reader.trace.rx, /^7F 22/);
        f.state.now = 99999; f.reader.tick(true); assert.equal(f.state.calls.length, 1);
        f.reader.tick(false); f.reader.tick(true); assert.equal(f.state.calls.length, 2);
    }
    const f = await fixture(); t.after(() => f.reader.stop()); f.reader.tick(true);
    f.reader.receive({ errorCode: 'NO_ERROR', udsResponse: Buffer.from([0xf0, 0xf2, 0x7f, 0, 0x22]) });
    assert.equal(f.reader.trace.origin, 'tasu'); assert.equal(f.reader.trace.rx, '');
    assert.match(f.reader.reason, /TASU rejected/); assert.equal(f.reader.snapshot().valid, false);
});
test('timeouts and pending replies clear active fills and retain received bytes with a hard deadline', async t => {
    const f = await fixture({ deadlineMs: 10 }); t.after(() => f.reader.stop());
    f.reader.tick(true); f.reader.receive(raw([0x7f, 0x22, 0x78]));
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(f.reader.active, null); assert.equal(f.reader.snapshot().valid, false);
    assert.equal(f.reader.trace.rx, '7F 22 78'); assert.equal(f.reader.trace.origin, 'timeout');
    assert.match(f.reader.trace.rawTasu, /7F 22 78$/);
});
test('a stalled method cannot overlap a later read; late rejection and shutdown leave no live waiter', async t => {
    const f = await fixture({ deadlineMs: 10 }); t.after(() => f.reader.stop()); let reject;
    f.state.reply = () => new Promise((resolve, r) => { reject = r; });
    f.reader.tick(true); await new Promise(resolve => setTimeout(resolve, 25));
    f.state.now = 99999; f.reader.tick(true); assert.equal(f.state.calls.length, 1);
    reject(new Error('late method failure')); await flush(); assert.equal(f.reader.sending, false);
    f.reader.tick(true); assert.equal(f.state.calls.length, 2);
    f.reader.stop(); assert.equal(f.reader.active, null); await flush(); assert.equal(f.state.shutdown, 1);
    reject(new Error('stopped method')); await flush();
});
test('provider loss and disabling discard late replies; stale snapshots never remain valid', async t => {
    const f = await fixture(); t.after(() => f.reader.stop()); f.reader.tick(true);
    f.reader.receive(raw(positive(1, 1))); f.state.now = 2001; assert.equal(f.reader.snapshot().valid, false);
    f.state.available(false); assert.equal(f.reader.sample, null); f.state.available(true);
    f.reader.tick(false); f.reader.receive(raw(positive(1, 1))); assert.equal(f.reader.snapshot().valid, false);
    await flush(); f.reader.tick(true); f.reader.receive(raw(positive(2, 0))); assert.equal(f.reader.snapshot().left, 2);
    f.state.available(false); assert.equal(f.reader.snapshot().valid, false);
});
test('Auto never uses diagnostics; D347 is used only when chosen explicitly', () => {
    const signal = { valid: true, active: true, left: 1, right: 0 };
    const uds = { source: 'UDS D347', authoritative: true, valid: true, active: true, left: 0, right: 1 };
    assert.equal(selectSource(uds, signal, 'auto').source, 'SOME/IP');
    assert.equal(selectSource(uds, signal, 'someip').source, 'SOME/IP');
    const missing = selectSource(uds, { valid: false, reason: 'Warning signal unavailable' }, 'auto');
    assert.equal(missing.source, 'SOME/IP'); assert.equal(missing.valid, false);
    assert.equal(missing.reason, 'Warning signal unavailable'); assert.equal(missing.fallbackReason, undefined);
    assert.equal(selectSource(uds, { valid: false }, 'auto').reason, 'No warning data');
    const primaryFault = { valid: false, authoritative: true, active: false, left: 0, right: 0, reason: 'Blind-spot system unavailable' };
    assert.equal(selectSource(uds, primaryFault, 'auto').valid, false);
    assert.equal(selectSource(uds, primaryFault, 'uds').source, 'UDS D347');
    const absent = { source: 'UDS D347', valid: false, authoritative: false, reason: 'No answer' };
    assert.equal(selectSource(absent, signal, 'uds').valid, false);
});
test('the app screen shows UDS TX, decoded RX and raw TASU bytes without putting them on the HUD', () => {
    const drawn = [];
    const trace = { tx: '22 D3 47', rx: '62 D3 47 01 04', rawTasu: 'F0 F2 71 01 0F 0B 40 00 05 62 D3 47 01 04', origin: 'ecu' };
    draw({ clear() {}, roundRect() {}, text(s, x, y) { drawn.push({ s, y }); } },
        { enabled: true, warning: { source: 'UDS D347', valid: true, active: true, left: 1, right: 2, age: 0 },
            overlay: { link: 'Connected' }, diagnostic: { trace } });
    assert.ok(drawn.some(x => x.s.includes('22 D3 47') && x.s.includes('62 D3 47 01 04')));
    assert.ok(drawn.some(x => x.s.includes(trace.rawTasu)));
    assert.ok(drawn.every(x => x.y < 520));
});

test('the status page reports primary SOME/IP independently of the selected diagnostic source', () => {
    const lines = [], cv = { clear() {}, roundRect() {}, text(s) { lines.push(s); } };
    const model = { enabled: true, warning: { source: 'UDS D347', valid: true, active: true,
        left: 1, right: 0, mirror: { left: 4, right: 4 }, age: 10 }, overlay: { link: 'Connected' } };
    draw(cv, model);
    assert.ok(lines.some(s => s.includes('mirror raw L -- R --')));
    lines.length = 0;
    model.someip = { available: true, age: 50, sample: { qualifier: 9, left: 0, right: 2 }, mirror: { left: 15, right: 3 } };
    draw(cv, model);
    assert.ok(lines.some(s => s.includes('Provider available | updates 0 | Q 9 L 0 R 2 | age 50 ms | mirror raw L 15 R 3')));
});

const prg = process.env.HUD_BLINDSPOT_PRG;
test('the actual ISTA definition backs the requested DID, left/right byte order and decoder values',
    { skip: !prg && 'set HUD_BLINDSPOT_PRG to bdc_g11.prg' }, () => {
        const fs = require('node:fs');
        const rawBytes = fs.readFileSync(prg);
        const decoded = Buffer.from(rawBytes.map(b => b ^ 0xf7));
        assert.ok(decoded.includes(Buffer.from('AUSSENSPIEGEL_HC2\0' + '0xD347\0', 'latin1')));
        function table(name) {
            let at = 0;
            const needle = Buffer.from(name + '\0', 'latin1');
            while ((at = decoded.indexOf(needle, at)) >= 0) {
                const tail = decoded.subarray(at + name.length + 1, at + 64);
                if (tail.every(b => b === 0)) {
                    const start = decoded.readUInt32LE(at + 64), cols = decoded.readUInt32LE(at + 72), rows = decoded.readUInt32LE(at + 76);
                    if (start < decoded.length && cols > 0 && cols < 20 && rows < 100) {
                        const values = decoded.subarray(start).toString('latin1').split('\0').slice(0, cols * (rows + 1));
                        return Array.from({ length: rows + 1 }, (_, i) => values.slice(i * cols, (i + 1) * cols));
                    }
                }
                at += name.length;
            }
            throw new Error('Missing ' + name);
        }
        const response = table('RES_0XD347_D');
        assert.equal(response.length, 3);
        assert.equal(response[1][0], 'STAT_SPIEGEL_HC2_LINKS_NR'); assert.equal(response[2][0], 'STAT_SPIEGEL_HC2_RECHTS_NR');
        assert.equal(response[1][3], 'signed char'); assert.equal(response[2][3], 'signed char');
        const values = table('TAB_SPIEGEL_HC2').slice(1).map(row => Number.parseInt(row[0], 16));
        assert.deepEqual(values, [0, 1, 2, 3, 4, 13, 255]);
        for (const v of values) assert.equal(decodeD347(positive(v, 0)).valid, v <= 4);
    });
