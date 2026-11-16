'use strict';
const { Diag, toBytes } = require('./kit/diag');
const hex = bytes => bytes.map(b => ('0' + b.toString(16)).slice(-2)).join(' ');

function transportError(message, raw, code) {
    const error = new Error(message);
    error.origin = 'tasu';
    error.transportCode = code == null ? null : code;
    error.rawTasu = raw ? hex(raw.bytes) : '';
    return error;
}

// TASU exposes a separate one-byte subroutine field. Use it for the session
// and tester-present subfunctions, without duplicating them in udsData.
// This API encoding still needs verification on the HU; logged TX is intent,
// not a capture of the request on the vehicle bus.
function tasuPayload(sid, data) {
    const split = (sid === 0x10 || sid === 0x3e) && data.length === 1;
    return { subroutineID: split ? data[0] : 0, data: split ? [] : data.slice() };
}

class Transport extends Diag {
    async send(target, sid, data, options) {
        const d = data || [], opts = options || {};
        const selected = opts.testSource != null;
        if (!selected && sid !== 0x10 && sid !== 0x3e) return super.send(target, sid, data, options);
        const source = selected ? opts.testSource : 0xf2;
        const read = sid === 0x22 && d.length === 2 &&
            ((d[0] === 0xf1 && d[1] === 0x50) || (d[0] === 0xd5 && d[1] === 0x42));
        const session = sid === 0x10 && d.length === 1 && (d[0] === 1 || d[0] === 3);
        const keep = sid === 0x3e && d.length === 1 && d[0] === 0;
        const lamp = sid === 0x2e && d.length === 6 && d[0] === 0xd5 && d[1] === 0x42 &&
            d[2] === 0 && d[3] === 6 && d[4] === 0 && (d[5] === 0 || d[5] === 50);
        if ([0xf1,0xf2,0xf4,0xf5].indexOf(source) < 0 || target !== 0x40 ||
            !(selected ? (read || session || keep || lamp) : (session || keep)))
            throw new Error('Request outside the address-test workflow');
        if (!this.p || !this.available) throw new Error('Diagnostic link unavailable');
        if (lamp && d[5] !== 0 && (!opts.testAllowed || opts.testAllowed()))
            throw new Error('Address-test write requires fresh zero speed');
        const payload = tasuPayload(sid, d);
        const result = await this.signals.call(this.p, 'sendTasuRequest', {
            sourceAddress: source, targetAddress: target, serviceID: sid, subroutineID: payload.subroutineID,
            udsDataLength: payload.data.length, udsData: Buffer.from(payload.data), deadlockTime: 0
        }, opts.callTimeoutMs || 1200);
        const value = result && typeof result === 'object' ?
            (result.TasuErrorEnum || Object.keys(result).map(k => result[k]).find(v => typeof v === 'string')) : result;
        return value === undefined ? 'NO_ERROR' : String(value);
    }
    _onResponse(value) {
        this.rawResponse = { bytes: toBytes(value && (value.udsResponse !== undefined ? value.udsResponse : value)) };
        super._onResponse(value);
    }
    async physical(target, sid, data, timeoutMs, accept, options) {
        if (this.activeRequest) throw new Error('A diagnostic request is already active');
        const opts = options || {}, request = [sid].concat(data || []);
        const exchange = { source: opts.testSource == null ? 0xf2 : opts.testSource,
            target: target, request: hex(request), rawTasu: [], origin: null, transportCode: null };
        const payload = tasuPayload(sid, data || []);
        exchange.tasuRequest = { serviceID: sid, subroutineID: payload.subroutineID,
            udsDataLength: payload.data.length, udsData: hex(payload.data) };
        this.activeRequest = exchange;
        let timer, hard, done = false, finish;
        const got = new Promise(resolve => {
            finish = (reply, error) => {
                if (done) return;
                done = true;
                clearTimeout(timer); clearTimeout(hard);
                this.removeListener('frame', onFrame);
                this.removeListener('tasReject', onReject);
                this.removeListener('tasError', onError);
                this.removeListener('available', onAvailable);
                exchange.origin = error ? error.origin || 'tasu' : reply ? 'ecu' : 'timeout';
                exchange.transportCode = error && error.transportCode != null ? error.transportCode : null;
                this.lastExchange = exchange; this.activeRequest = null;
                this.log.info('external lights TASU exchange: ' + JSON.stringify(exchange));
                resolve({ reply: reply, error: error });
            };
        });
        const capture = () => {
            if (this.rawResponse && exchange.rawTasu.length < 16) exchange.rawTasu.push(hex(this.rawResponse.bytes));
        };
        const onFrame = frame => {
            if (frame.ecu !== target) return;
            const u = frame.uds || [];
            if (u.length >= 3 && u[0] === 0x7f && u[1] === sid && u[2] === 0x78) {
                capture(); clearTimeout(timer);
                timer = setTimeout(() => finish(null), opts.pendingTimeoutMs || 10000);
                return;
            }
            if (accept && !accept(u)) return;
            capture(); finish(u);
        };
        const onReject = code => {
            capture();
            finish(null, transportError('TASU rejected diagnostic request (code ' + hex([code]).toUpperCase() + ')', this.rawResponse, code));
        };
        const onError = message => finish(null, transportError('TASU error: ' + message, this.rawResponse));
        const onAvailable = available => { if (!available) finish(null, transportError('Diagnostic link disconnected', null)); };
        this.on('frame', onFrame); this.on('tasReject', onReject);
        this.on('tasError', onError); this.on('available', onAvailable);
        hard = setTimeout(() => finish(null), opts.hardTimeoutMs || 10000);
        // Attach both continuations even if an event settles first, so a later
        // method-call failure cannot leak listeners or reject unhandled.
        let sending;
        try { sending = this.send(target, sid, data, opts); }
        catch (error) { finish(null, transportError(String(error.message || error), null)); }
        Promise.resolve(sending).then(verdict => {
            if (done) return;
            try { this._check(verdict); }
            catch (error) { finish(null, transportError(error.message, null)); return; }
            if (!timer) timer = setTimeout(() => finish(null), timeoutMs || 4000);
        }, error => finish(null, transportError(String(error.message || error), null)));
        const result = await got;
        if (result.error) throw result.error;
        return result.reply;
    }
}
module.exports = { Transport };
