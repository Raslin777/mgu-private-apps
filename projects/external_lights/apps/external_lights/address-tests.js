'use strict';
const { Session, NRC } = require('./session');
const SOURCES = [0xf2,0xf1,0xf4,0xf5];
const hex = bytes => Array.prototype.map.call(bytes || [], b => ('0' + b.toString(16)).slice(-2)).join(' ').toUpperCase();
const address = n => hex([n]);

class AddressTests {
    constructor(diag, log, idleReason, stationaryReason, timing) {
        this.diag = diag; this.log = log; this.idleReason = idleReason; this.stationaryReason = stationaryReason;
        this.wait = timing && timing.wait || (ms => new Promise(resolve => setTimeout(resolve,ms)));
        this.now = timing && timing.now || Date.now;
        this.busy = false; this.cancelled = false; this.history = []; this.offset = 0;
        this.status = 'Choose an address, then Read test or Write test';
        const self = this;
        const link = { get p() { return diag.p; }, get available() { return diag.available; },
            physical: (ecu,sid,data,timeout,accept,opts) => self.request(sid,data,timeout,accept,opts) };
        if (typeof diag.on === 'function') link.on = diag.on.bind(diag);
        this.session = new Session(link,log,{ allowed: () => this.cancelled ? 'Address test stopped' : this.stationaryReason() });
    }
    stop() { if (this.busy) { this.cancelled = true; this.session.cancelled = true; this.status = 'Stopping address test'; } }
    scroll(delta) { this.offset = Math.max(0, this.offset + delta); }
    async request(sid,data,timeout,accept,opts) {
        const row = { source: address(this.source), tx: hex([sid].concat(data)), rx: 'Waiting', raw: [], origin: '' };
        this.history.push(row); this.history = this.history.slice(-40); this.offset = 0;
        let error = null;
        try {
            const reply = await this.diag.physical(0x40,sid,data,timeout,accept,
                Object.assign({},opts,{ testSource: this.source, testAllowed: () => this.stationaryReason() }));
            row.rx = reply ? hex(reply) : 'No response';
            row.origin = reply ? 'ECU' : 'Timeout';
            return reply;
        } catch (e) {
            error = e; row.rx = 'No UDS reply'; row.origin = 'TASU'; row.error = String(e.message || e); throw e;
        } finally {
            const exchange = this.diag.lastExchange;
            if (exchange && exchange.source === this.source && exchange.request.toUpperCase() === row.tx)
                row.raw = exchange.rawTasu.slice();
            if (!row.raw.length && error && error.rawTasu) row.raw = [error.rawTasu];
            this.log.info('external lights address test: ' + JSON.stringify(row));
        }
    }
    async run(kind,source) {
        if (this.busy) return false;
        if ((kind !== 'read' && kind !== 'write') || SOURCES.indexOf(source) < 0) {
            this.status = 'Invalid address test'; return false;
        }
        const reason = this.idleReason() || (kind === 'write' ? this.stationaryReason() : null);
        if (reason) { this.status = 'Test blocked: ' + reason; return false; }
        this.busy = true; this.cancelled = false; this.session.cancelled = false; this.source = source;
        this.offset = 0; this.status = (kind === 'read' ? 'Reading D542' : 'Preparing left indicator test') + ' from ' + address(source);
        let attemptedLamp = false, ok = false;
        try {
            if (kind === 'read') {
                const reply = await this.request(0x22,[0xd5,0x42],1000,
                    u => (u.length >= 3 && u[0] === 0x62 && u[1] === 0xd5 && u[2] === 0x42) || (u.length >= 3 && u[0] === 0x7f && u[1] === 0x22),
                    { maxRetries:0,callTimeoutMs:1200,pendingTimeoutMs:1000,hardTimeoutMs:2000 });
                if (!reply) throw new Error('No response');
                if (reply[0] === 0x7f) throw new Error((NRC[reply[2]] || 'Request rejected') + ' (NRC ' + address(reply[2]) + ')');
                if (reply.length <= 3) throw new Error('D542 read returned no data');
                this.status = 'D542 read answered; lamp-write permission is not confirmed'; ok = true;
            } else {
                await this.session.open();
                if (this.cancelled) throw new Error('Address test stopped');
                const blocked = this.session.reason(); if (blocked) throw new Error(blocked);
                attemptedLamp = true;
                await this.session.write([0xd5,0x42,0,6,0,50]);
                this.status = 'Lamp write accepted; check the left indicator physically'; ok = true;
                const until = this.now() + 500;
                while (this.now() < until) {
                    const blockedNow = this.cancelled ? 'Address test stopped' : this.stationaryReason();
                    if (blockedNow) throw new Error(blockedNow);
                    await this.wait(Math.min(40,until-this.now()));
                }
            }
        } catch (e) { this.status = String(e.message || e); ok = false; }
        finally {
            if (kind === 'write') {
                if (attemptedLamp) {
                    try { await this.session.write([0xd5,0x42,0,6,0,0],true); }
                    catch (e) { this.status += '; lamp-off failed: ' + String(e.message || e); ok = false; }
                }
                await this.session.close();
                if (this.session.cleanupFailed) { this.status += '; default-session cleanup failed'; ok = false; }
            }
            if (this.cancelled) { this.status = 'Address test stopped; ' + this.status; ok = false; }
            this.busy = false;
        }
        return ok;
    }
}

function lines(test) {
    const out = [];
    test.history.forEach(row => {
        out.push('Source ' + row.source + ' -> BDC 40   TX: ' + row.tx);
        out.push((row.origin || 'Reply') + ' RX: ' + row.rx);
        if (row.error) out.push(row.error);
        row.raw.forEach(raw => out.push('TASU bytes: ' + raw.toUpperCase()));
    });
    return out.reduce((all,line) => {
        for (let at=0;at<line.length;at+=115) all.push(line.slice(at,at+115));
        return all;
    },[]);
}
function draw(cv,theme,test,source,telemetry) {
    cv.clear(theme.bg);
    cv.text('Diagnostic address tests — requested source ' + address(source),44,46,30,theme.text,{font:'bold'});
    cv.text('Read: D542 data. Write: left indicator for 0.5 s; Park and speed checks are off.',44,84,22,theme.dim);
    const status = test.status.length > 200 ? test.status.slice(0,197) + '...' : test.status;
    for(let at=0;at<status.length;at+=100) cv.text(status.slice(at,at+100),44,120+Math.floor(at/100)*24,22,theme.warn);
    if (telemetry) cv.text(telemetry,44,173,17,theme.dim);
    const all = lines(test), page=13;
    test.offset = Math.min(test.offset,Math.max(0,all.length-page));
    const end = Math.max(0,all.length-test.offset), start=Math.max(0,end-page);
    if(!all.length) cv.text('TX: not sent   RX: no test run',44,200,22,theme.dim);
    all.slice(start,end).forEach((line,i)=>cv.text(line,44,194+i*22,19,theme.text));
    cv.text('Replies ' + (all.length ? start+1 : 0) + '-' + end + '/' + all.length + ' | Earlier / Later to review | Lighting source stays F2',44,508,17,theme.dim);
}
module.exports = { AddressTests, SOURCES, draw, lines };
