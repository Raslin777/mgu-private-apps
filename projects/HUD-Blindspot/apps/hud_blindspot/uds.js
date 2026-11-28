'use strict';
const IFACE = 'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu';
const INSTANCE = 'SystemFunctionsInternalTasuInst1';
const POLL_MS = 250, BACKOFF_MS = 2000;
// Waits copied from the transport that has returned BDC replies on the owner's
// car (External Lights): 4 s for the reply once the head unit has accepted the
// request, 10 s overall and after a "response pending", 8 s for the call itself.
const REPLY_MS = 4000, HARD_MS = 10000, CALL_MS = 8000;
// How long one D347 value counts. The diagnostic channel is shared with other
// apps, so a value has to outlive one refused or slow read.
const SAMPLE_MS = 3000;
// A negative reply does not name the identifier it refuses, and every app gets
// every reply: one refusal may belong to another app's read on the BDC. Reads
// pause only after this many "not supported / not allowed" replies in a row,
// and are tried again after BLOCK_RETRY_MS.
const REFUSALS_TO_BLOCK = 3, BLOCK_RETRY_MS = 30000;
const REFUSAL = [0x11, 0x12, 0x31, 0x33, 0x7e, 0x7f];
const hex =data => Array.prototype.map.call(data || [], b => ('0' + b.toString(16)).slice(-2)).join(' ').toUpperCase();
function bytes(value) {
    if (value && value.data && !Buffer.isBuffer(value)) return bytes(value.data);
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || Array.isArray(value) ||
        (value && typeof value === 'object' && typeof value.length === 'number')) return Array.prototype.slice.call(value, 0, 4096);
    return [];
}
// The BDC answers with two status bytes, left then right. Bytes the transport
// may append after them are ignored.
function decodeD347(reply) {
    if (!reply || reply.length < 5 || reply[0] !== 0x62 || reply[1] !== 0xd3 || reply[2] !== 0x47)
        return { valid: false, active: false, left: 0, right: 0, reason: 'Unexpected D347 reply length/format' };
    const left = reply[3], right = reply[4];
    let reason = '';
    if (left === 0x0d || right === 0x0d) reason = 'Mirror display fault (0D)';
    else if (left === 0xff || right === 0xff) reason = 'Mirror signal invalid (FF)';
    else if ([0, 1, 2, 3, 4].indexOf(left) < 0 || [0, 1, 2, 3, 4].indexOf(right) < 0) reason = 'Unknown mirror status value';
    return { valid: !reason, active: !reason, left: reason ? 0 : left === 0 ? 0 : left === 1 ? 1 : 2,
        right: reason ? 0 : right === 0 ? 0 : right === 1 ? 1 : 2,
        leftRaw: left, rightRaw: right, reason: reason };
}
const NRC = { 0x11: 'Service unsupported', 0x12: 'Subfunction unsupported', 0x13: 'Incorrect length/format',
    0x21: 'Controller busy', 0x22: 'Conditions not correct', 0x31: 'D347 unavailable/out of range',
    0x33: 'Read access denied', 0x7e: 'Unavailable in session', 0x7f: 'Service unavailable in session' };

class MirrorReader {
    constructor(signals, log, change, options) {
        const opts = options || {};
        this.signals = signals; this.log = log; this.change = change;
        this.now = opts.now || Date.now;
        // deadlineMs (tests): one short wait for both the reply and the overall limit.
        this.replyMs = opts.deadlineMs || REPLY_MS; this.hardMs = opts.hardMs || opts.deadlineMs || HARD_MS;
        this.stats = { sent: 0, answered: 0, refused: 0, missed: 0, late: 0, lastMs: null, maxMs: 0 };
        this.p = null; this.available = false; this.stopped = false; this.enabled = false;
        this.active = null; this.sending = false; this.blocked = false; this.nextAt = 0;
        this.refusals = 0; this.blockedUntil = 0; this.failing = false;
        this.sample = null; this.trace = null; this.lastLog = ''; this.reason = 'Waiting for diagnostic link';
    }
    async start() {
        let p;
        try {
            p = await this.signals.proxy(IFACE, INSTANCE);
            if (this.stopped) { if (p.shutdown) await p.shutdown(); return; }
            this.p = p;
            await this.signals.on(p, 'sendTasuResponse', value => this.receive(value), this.log);
            if (this.stopped) return;
            await this.signals.onAvailable(p, on => {
                if (this.stopped) return;
                this.available = on === true;
                if (!this.available) {
                    this.sample = null; this.reason = 'Diagnostic link unavailable';
                    if (this.active) this.active.finish(null, this.reason, 'tasu');
                } else if (!this.sample && !this.blocked) { this.reason = 'Waiting for D347 read'; this.failing = false; }
                this.change();
            });
        } catch (e) {
            this.available = false; this.sample = null; this.reason = 'Diagnostic link unavailable';
            this.log.warn('mirror read setup: ' + String(e.message || e));
            if (p && p.shutdown) await Promise.resolve(p.shutdown()).catch(() => {});
            this.p = null; this.change();
        }
    }
    tick(enabled) {
        if (this.stopped) return;
        if (!enabled) {
            if (this.enabled) {
                this.enabled = false; this.blocked = false; this.sample = null; this.nextAt = 0;
                this.refusals = 0; this.blockedUntil = 0; this.failing = false;
                if (this.active) this.active.finish(null, 'Mirror reads disabled', 'cancelled');
                this.reason = 'Mirror reads disabled';
            }
            return;
        }
        this.enabled = true;
        // A pause after repeated refusals ends by itself. One more refusal pauses again.
        if (this.blocked && this.now() >= this.blockedUntil) { this.blocked = false; this.refusals = REFUSALS_TO_BLOCK - 1; }
        if (!this.p || !this.available || this.active || this.sending || this.blocked || this.now() < this.nextAt) return;
        this.read();
    }
    read() {
        if (this.stopped || !this.enabled || !this.available || !this.p || this.active || this.sending || this.blocked) return;
        // The only method request in this module is the definition-backed read.
        // No SID, DID, target or source is accepted from settings or the UI.
        const exchange = { tx: '22 D3 47', rx: '', rawTasu: '', origin: '', at: this.now() };
        this.trace = exchange;
        if (!this.failing) this.reason = 'Reading D347 mirror status';
        let done = false;
        const pending = { exchange: exchange, timer: null, hard: null, finish: (reply, error, origin) => {
            if (done) return; done = true;
            clearTimeout(pending.timer); clearTimeout(pending.hard);
            exchange.ms = Math.max(0, this.now() - exchange.at);
            const positive = !error && !!reply && reply[0] === 0x62;
            if (reply) { this.stats.lastMs = exchange.ms; this.stats.maxMs = Math.max(this.stats.maxMs, exchange.ms); }
            if (positive) this.stats.answered++;
            else if (origin === 'timeout') this.stats.missed++;
            else if (reply || origin === 'tasu') this.stats.refused++;
            if (this.active === pending) this.active = null;
            if (this.stopped || !this.enabled) return;
            if (reply) exchange.rx = hex(reply);
            exchange.origin = origin || 'ecu';
            exchange.error = error || '';
            this.trace = exchange;
            if (positive) {
                const decoded = decodeD347(reply);
                this.sample = Object.assign({ at: this.now() }, decoded);
                this.reason = decoded.reason; this.failing = false; this.refusals = 0;
                this.nextAt = this.now() + POLL_MS;
            } else {
                // The last value is kept and ages out by itself (SAMPLE_MS), so one
                // refused or lost read does not blank the indicators.
                this.reason = error || 'No D347 answer'; this.failing = true;
                this.nextAt = this.now() + BACKOFF_MS;
                if (reply && reply[0] === 0x7f && REFUSAL.indexOf(reply[2]) >= 0 && ++this.refusals >= REFUSALS_TO_BLOCK) {
                    this.blocked = true; this.blockedUntil = this.now() + BLOCK_RETRY_MS;
                    this.reason += '; reads paused ' + Math.round(BLOCK_RETRY_MS / 1000) + ' s';
                }
            }
            const key = exchange.rx + '|' + exchange.origin + '|' + exchange.error;
            if (key !== this.lastLog) { this.lastLog = key; this.log.info('blind-spot D347: ' + JSON.stringify(exchange)); }
            this.change();
        } };
        // A transport reject or error seen while waiting is named in the timeout text.
        pending.timeout = text => pending.finish(null, text + (exchange.transport ? ' (transport ' + exchange.transport + ')' : ''), 'timeout');
        this.active = pending; this.stats.sent++;
        pending.hard = setTimeout(() => pending.timeout('No D347 answer in ' + this.hardMs + ' ms'), this.hardMs);
        this.sending = true;
        let sending;
        try {
            sending = this.signals.call(this.p, 'sendTasuRequest', {
                sourceAddress: 0xf2, targetAddress: 0x40, serviceID: 0x22, subroutineID: 0,
                udsDataLength: 2, udsData: Buffer.from([0xd3, 0x47]), deadlockTime: 0
            }, CALL_MS);
        } catch (e) { sending = Promise.reject(e); }
        Promise.resolve(sending).then(result => {
            this.sending = false;
            const value = result && typeof result === 'object' ? result.TasuErrorEnum : result;
            exchange.verdict = value === undefined ? 'NO_ERROR' : String(value);
            if (value !== undefined && ['NO_ERROR', 'REQUEST_PENDING', '0', '1'].indexOf(String(value)) < 0)
                pending.finish(null, 'TASU refused read: ' + String(value), 'tasu');
            // The reply wait starts once the head unit has taken the request.
            else if (!done) pending.timer = setTimeout(() => pending.timeout('No D347 answer in ' + this.replyMs + ' ms'), this.replyMs);
        }, error => { this.sending = false; pending.finish(null, 'TASU read failed: ' + String(error.message || error), 'tasu'); });
    }
    receive(value) {
        if (this.stopped || !this.enabled) return;
        const raw = bytes(value && value.udsResponse !== undefined ? value.udsResponse : value);
        // Every app receives every reply. Only byte 6 (the unit that answered)
        // and the reply itself identify a frame: the rest of the 9-byte header
        // has not been seen on this car, so nothing is filtered on it.
        const pending = this.active;
        const capture = () => { if (pending) pending.exchange.rawTasu = hex(raw.slice(0, 64)); };
        // A transport error event or reject does not say whose request it is for,
        // and every app receives it. It is noted in the trace and the read keeps
        // waiting, as the proven transport does: the reply timer decides.
        const code = value && value.errorCode;
        if (code !== undefined && code !== 0 && code !== 'NO_ERROR') {
            if (pending) pending.exchange.transport = 'error ' + String(code).slice(0, 48);
            return;
        }
        if (raw.length >= 5 && raw[2] === 0x7f) {
            capture(); if (pending) pending.exchange.transport = 'reject, code ' + hex([raw[4]]);
            return;
        }
        if (raw.length < 10 || raw[6] !== 0x40) return;
        const reply = raw.slice(9);
        const match = reply[0] === 0x62 && reply[1] === 0xd3 && reply[2] === 0x47;
        const negative = reply.length >= 3 && reply[0] === 0x7f && reply[1] === 0x22;
        // Another app's BDC traffic is not our answer and not a reason to give up
        // on ours: ignore it and keep waiting, as the proven transport does.
        if (!match && !negative) return;
        if (!pending) {
            // A D347 answer after its request was given up on is still the
            // mirror status. Use it, and count it: it means the wait is too short.
            if (match) {
                this.stats.late++;
                this.sample = Object.assign({ at: this.now() }, decodeD347(reply));
                // It also shows the BDC does answer D347: earlier refusals no longer count.
                this.reason = this.sample.reason; this.failing = false; this.refusals = 0; this.blocked = false;
                this.trace = { tx: '22 D3 47', rx: hex(reply), rawTasu: hex(raw.slice(0, 64)), origin: 'ecu (late)', at: this.now(), error: '' };
                this.log.info('blind-spot D347 late answer: ' + this.trace.rx);
                this.change();
            }
            return;
        }
        capture(); pending.exchange.rx = hex(reply);
        if (negative && reply[2] === 0x78) {      // "response pending": the unit asks for more time
            clearTimeout(pending.timer);
            pending.timer = setTimeout(() => pending.timeout('No D347 answer after response pending'), this.hardMs);
            return;
        }
        if (negative) pending.finish(reply, (NRC[reply[2]] || 'Read rejected') + ' (NRC ' + hex([reply[2]]) + ')', 'ecu');
        else pending.finish(reply, null, 'ecu');
    }
    snapshot() {
        const sample = this.sample;
        const age = sample ? this.now() - sample.at : null;
        const fresh = sample && age >= 0 && age <= SAMPLE_MS && this.available && this.enabled && !this.stopped;
        const valid = !!fresh && sample.valid;
        return { source: 'UDS D347', authoritative: !!fresh, valid: valid, active: valid,
            left: valid ? sample.left : 0, right: valid ? sample.right : 0,
            reason: fresh ? sample.reason : sample && !this.failing ? 'Mirror read stale' : this.reason,
            age: age == null ? null : Math.max(0, age), sample: sample,
            mirror: sample ? { left: sample.leftRaw, right: sample.rightRaw, at: sample.at } : null };
    }
    stop() {
        this.enabled = false; this.stopped = true; this.sample = null; this.available = false;
        if (this.active) this.active.finish(null, 'Stopped', 'cancelled');
        const p = this.p; this.p = null;
        if (p && p.shutdown) Promise.resolve().then(() => p.shutdown()).catch(() => {});
    }
}
// Auto uses SOME/IP when it delivers a valid warning state. When it does not
// (on the owner's car no unit offers the service to the head unit), Auto uses
// the body controller's mirror status read (D347). "SOME/IP only" never does.
function useDiagnostics(mode, someip) {
    return mode === 'uds' || (mode !== 'someip' && !(someip && someip.valid));
}
function selectSource(uds, someip, mode) {
    const signal = Object.assign({ source: 'SOME/IP', authoritative: false }, someip);
    if (mode === 'uds') return uds;
    if (signal.valid || mode === 'someip') return Object.assign({}, signal, { reason: signal.reason || (signal.valid ? '' : 'No warning data') });
    if (uds && uds.valid) return Object.assign({}, uds, { fallbackReason: signal.reason || 'No SOME/IP data' });
    const why = signal.reason || 'No warning data';
    return Object.assign({}, signal, { reason: uds && uds.reason ? why + ' | mirror read: ' + uds.reason : why });
}
module.exports = { MirrorReader, decodeD347, selectSource, useDiagnostics, IFACE, INSTANCE, POLL_MS, BACKOFF_MS, REPLY_MS, HARD_MS, CALL_MS,
    SAMPLE_MS, REFUSALS_TO_BLOCK, BLOCK_RETRY_MS };
