'use strict';
const { MAX_AGE_MS } = require('./warnings');
const IFACE = 'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu';
const INSTANCE = 'SystemFunctionsInternalTasuInst1';
const POLL_MS = 250, BACKOFF_MS = 2000;
const hex = data => Array.prototype.map.call(data || [], b => ('0' + b.toString(16)).slice(-2)).join(' ').toUpperCase();
function bytes(value) {
    if (value && value.data && !Buffer.isBuffer(value)) return bytes(value.data);
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || Array.isArray(value) ||
        (value && typeof value === 'object' && typeof value.length === 'number')) return Array.prototype.slice.call(value, 0, 4096);
    return [];
}
function decodeD347(reply) {
    if (!reply || reply.length !== 5 || reply[0] !== 0x62 || reply[1] !== 0xd3 || reply[2] !== 0x47)
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
        this.now = opts.now || Date.now; this.deadlineMs = opts.deadlineMs || 1500;
        this.p = null; this.available = false; this.stopped = false; this.enabled = false;
        this.active = null; this.sending = false; this.blocked = false; this.nextAt = 0; this.quietUntil = 0;
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
                } else if (!this.sample && !this.blocked) this.reason = 'Waiting for D347 read';
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
                if (this.active) this.active.finish(null, 'Mirror reads disabled', 'cancelled');
                this.reason = 'Mirror reads disabled';
            }
            return;
        }
        this.enabled = true;
        if (!this.p || !this.available || this.active || this.sending || this.blocked || this.now() < this.nextAt) return;
        if (this.now() < this.quietUntil) { this.reason = 'Other BDC diagnostics active; waiting'; return; }
        this.read();
    }
    read() {
        if (this.stopped || !this.enabled || !this.available || !this.p || this.active || this.sending || this.blocked) return;
        // The only method request in this module is the definition-backed read.
        // No SID, DID, target or source is accepted from settings or the UI.
        const exchange = { tx: '22 D3 47', rx: '', rawTasu: '', origin: '', at: this.now() };
        this.trace = exchange; this.reason = 'Reading D347 mirror status';
        let done = false;
        const pending = { exchange: exchange, timer: null, finish: (reply, error, origin) => {
            if (done) return; done = true;
            clearTimeout(pending.timer);
            if (this.active === pending) this.active = null;
            if (this.stopped || !this.enabled) return;
            if (reply) exchange.rx = hex(reply);
            exchange.origin = origin || 'ecu';
            exchange.error = error || '';
            this.trace = exchange;
            if (!error && reply && reply[0] === 0x62) {
                const decoded = decodeD347(reply);
                this.sample = Object.assign({ at: this.now() }, decoded);
                this.reason = decoded.reason;
                this.nextAt = this.now() + POLL_MS;
            } else {
                this.sample = null; this.reason = error || 'No D347 answer';
                this.nextAt = this.now() + BACKOFF_MS;
                if (reply && reply[0] === 0x7f && [0x11, 0x12, 0x31, 0x33, 0x7e, 0x7f].indexOf(reply[2]) >= 0)
                    this.blocked = true;
            }
            const key = exchange.rx + '|' + exchange.origin + '|' + exchange.error;
            if (key !== this.lastLog) { this.lastLog = key; this.log.info('blind-spot D347: ' + JSON.stringify(exchange)); }
            this.change();
        } };
        this.active = pending;
        pending.timer = setTimeout(() => pending.finish(null, 'D347 read timed out', 'timeout'), this.deadlineMs);
        this.sending = true;
        let sending;
        try {
            sending = this.signals.call(this.p, 'sendTasuRequest', {
                sourceAddress: 0xf2, targetAddress: 0x40, serviceID: 0x22, subroutineID: 0,
                udsDataLength: 2, udsData: Buffer.from([0xd3, 0x47]), deadlockTime: 0
            }, 1200);
        } catch (e) { sending = Promise.reject(e); }
        Promise.resolve(sending).then(result => {
            this.sending = false;
            const value = result && typeof result === 'object' ? result.TasuErrorEnum : result;
            if (value !== undefined && ['NO_ERROR', 'REQUEST_PENDING', '0', '1'].indexOf(String(value)) < 0)
                pending.finish(null, 'TASU refused read: ' + String(value), 'tasu');
        }, error => { this.sending = false; pending.finish(null, 'TASU read failed: ' + String(error.message || error), 'tasu'); });
    }
    receive(value) {
        if (this.stopped || !this.enabled) return;
        const raw = bytes(value && value.udsResponse !== undefined ? value.udsResponse : value);
        // Native frames beginning F0 echo the tester in byte 1. Every app may
        // receive the broadcast; an explicitly different tester isn't our reply.
        if (raw[0] === 0xf0 && raw[1] !== 0xf2) return;
        const pending = this.active;
        const capture = () => { if (pending) pending.exchange.rawTasu = hex(raw.slice(0, 64)); };
        const code = value && value.errorCode;
        if (code !== undefined && code !== 0 && code !== 'NO_ERROR') {
            capture(); if (pending) pending.finish(null, 'TASU response error: ' + String(code), 'tasu'); return;
        }
        if (raw.length >= 5 && raw[2] === 0x7f) {
            capture(); if (pending) pending.finish(null, 'TASU rejected read (code ' + hex([raw[4]]) + ')', 'tasu'); return;
        }
        if (raw.length < 10 || raw[6] !== 0x40) return;
        const reply = raw.slice(9);
        const match = reply[0] === 0x62 && reply[1] === 0xd3 && reply[2] === 0x47;
        const negative = reply.length >= 3 && reply[0] === 0x7f && reply[1] === 0x22;
        if (!match && !negative) {
            // Read-only does not mean independent of other diagnostic clients.
            // Yield while another BDC request/session is visible on the link.
            this.quietUntil = this.now() + BACKOFF_MS; this.sample = null;
            this.reason = 'Other BDC diagnostics active; waiting';
            if (pending) pending.finish(null, this.reason, 'shared-link');
            else this.change();
            return;
        }
        if (!pending) return;
        capture(); pending.exchange.rx = hex(reply);
        if (negative && reply[2] === 0x78) return; // Still bounded by the original hard deadline.
        if (negative) pending.finish(reply, (NRC[reply[2]] || 'Read rejected') + ' (NRC ' + hex([reply[2]]) + ')', 'ecu');
        else pending.finish(reply, null, 'ecu');
    }
    snapshot() {
        const sample = this.sample;
        const age = sample ? this.now() - sample.at : null;
        const fresh = sample && age >= 0 && age <= MAX_AGE_MS && this.available && this.enabled && !this.stopped;
        const valid = !!fresh && sample.valid;
        return { source: 'UDS D347', authoritative: !!fresh, valid: valid, active: valid,
            left: valid ? sample.left : 0, right: valid ? sample.right : 0,
            reason: fresh ? sample.reason : sample ? 'Mirror read stale' : this.reason,
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
function selectSource(uds, someip, mode) {
    const signal = Object.assign({ source: 'SOME/IP', authoritative: false }, someip);
    if (mode === 'someip') return signal;
    if (mode === 'uds') return uds;
    // A fresh primary notification includes explicit unavailable/fault states.
    // Do not replace those states with a reassuring secondary sample.
    if (signal.authoritative || signal.valid) return signal;
    if (uds.authoritative || uds.valid) return Object.assign({}, uds, { fallbackReason: signal.reason });
    return Object.assign({}, signal, { fallbackReason: uds.reason,
        reason: signal.reason || uds.reason || 'No warning data' });
}
module.exports = { MirrorReader, decodeD347, selectSource, IFACE, INSTANCE, POLL_MS, BACKOFF_MS };
