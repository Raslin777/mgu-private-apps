'use strict';
const { BDC, LAMPS, MAX_MS } = require('./lamps');
const KEEP_MS = 2000;
const hex = bytes => bytes ? Array.prototype.map.call(bytes, b => ('0' + b.toString(16)).slice(-2)).join(' ') : 'no reply';
class Session {
    constructor(diag, log, options) {
        const o = options || {};
        this.diag = diag; this.log = log; this.now = o.now || Date.now;
        this.allowed = o.allowed || (() => 'No vehicle interlock');
        this.entered = false; this.attempted = false; this.last = 0; this.conflictUntil = 0;
        this.audit = []; this.cleanupFailed = false;
        if (typeof diag.on === 'function') diag.on('frame', f => {
            const u = f.uds || [];
            // Other BDC DIDs include Better Lighting's ambient reads/writes.
            if (f.ecu === BDC && (u[0] === 0x62 || u[0] === 0x6e) &&
                !((u[1] === 0xd5 && u[2] === 0x42) || (u[0] === 0x62 && u[1] === 0xf1 && u[2] === 0x50))) {
                this.conflictUntil = this.now() + 5000;
            }
        });
    }
    reason() {
        if (this.cancelled) return 'Stopped';
        if (!this.diag.p || this.diag.available !== true) return 'Diagnostic link unavailable';
        if (this.now() < this.conflictUntil) return 'Other BDC activity: stop Better Lighting and other diagnostic apps';
        return this.allowed();
    }
    async request(sid, data, cleanup) {
        const bytes = Array.isArray(data) && data.every(b => Number.isInteger(b) && b >= 0 && b <= 255);
        const permitted = bytes && (
            (sid === 0x22 && data.length === 2 && ((data[0] === 0xf1 && data[1] === 0x50) || (data[0] === 0xd5 && data[1] === 0x42))) ||
            (sid === 0x10 && data.length === 1 && (data[0] === 1 || data[0] === 3)) ||
            (sid === 0x3e && data.length === 1 && data[0] === 0) ||
            (sid === 0x2e && data.length === 6 && data[0] === 0xd5 && data[1] === 0x42 && data[2] === 0 &&
                LAMPS.some(l => !l.experimental && l.id === data[3]) && data[4] * 256 + data[5] <= MAX_MS / 10));
        if (!permitted) throw new Error('Request outside the verified BDC workflow');
        if (cleanup && !(sid === 0x10 && data[0] === 1) && !(sid === 0x2e && data[4] === 0 && data[5] === 0)) throw new Error('Invalid cleanup request');
        if (!cleanup) { const why = this.reason(); if (why) throw new Error(why); }
        const start = this.now();
        const accept = u => (u[0] === sid + 0x40 && data.slice(0, sid === 0x22 || sid === 0x2e ? 2 : 1).every((b, i) => u[i + 1] === b)) || (u[0] === 0x7f && u[1] === sid);
        let reply = null, error = null;
        try { reply = await this.diag.physical(BDC, sid, data, 1000, accept,
            { maxRetries: 0, callTimeoutMs: 1200, pendingTimeoutMs: 1000, hardTimeoutMs: 2000 }); }
        catch (e) { error = String(e.message || e); }
        this.last = this.now();
        const record = { request: hex([sid].concat(data)), reply: hex(reply), ms: this.last - start, error: error, cleanup: !!cleanup };
        this.audit.push(record); if (this.audit.length > 100) this.audit.shift();
        this.log.info('external lights: ' + JSON.stringify(record));
        if (!reply || !accept(reply) || reply[0] === 0x7f) {
            throw new Error(error || (!reply ? 'No answer from the body controller' : 'Refused: NRC ' + hex([reply[2]])));
        }
        return reply;
    }
    async open() {
        this.cleanupFailed = false;
        const id = await this.request(0x22, [0xf1, 0x50]);
        if (id.length <= 3) throw new Error('BDC identification was empty');
        const functions = await this.request(0x22, [0xd5, 0x42]);
        if (functions.length <= 3) throw new Error('D542 read capability was not confirmed');
        // Even a lost session reply may mean it entered: cleanup must still be attempted.
        this.attempted = true;
        await this.request(0x10, [0x03]);
        this.entered = true;
    }
    due() { return this.entered && this.now() - this.last >= KEEP_MS; }
    async keep() { await this.request(0x3e, [0x00]); }
    async write(frame, cleanup) {
        if (!this.entered && !cleanup) throw new Error('Diagnostic session is not ready');
        return this.request(0x2e, frame, cleanup);
    }
    async close() {
        if (!this.attempted) return;
        this.entered = false;
        try { await this.request(0x10, [0x01], true); }
        catch (e) { this.cleanupFailed = true; this.log.warn('Default session cleanup failed: ' + e.message); }
        this.attempted = false;
    }
}
module.exports = { Session, KEEP_MS };
