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

// Keep the pinned kit's F2 identity and send protocol. Handle its separate
// transport-error events in the same waiter as ECU replies, without retries.
class Transport extends Diag {
    _onResponse(value) {
        this.rawResponse = { bytes: toBytes(value && (value.udsResponse !== undefined ? value.udsResponse : value)) };
        super._onResponse(value);
    }
    async physical(target, sid, data, timeoutMs, accept, options) {
        if (this.activeRequest) throw new Error('A diagnostic request is already active');
        const opts = options || {}, request = [sid].concat(data || []);
        const exchange = { target: target, request: hex(request), rawTasu: [], origin: null, transportCode: null };
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
