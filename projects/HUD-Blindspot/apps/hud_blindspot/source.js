'use strict';
const { IFACE, FIELD, MIRROR_EVENT } = require('./warnings');
class WarningSource {
    constructor(signals, state, log, change, options) {
        const opts = options || {};
        this.signals = signals; this.state = state; this.log = log; this.change = change;
        this.iface = opts.iface || IFACE; this.event = opts.event || FIELD;
        this.withMirror = opts.mirror !== false; this.update = opts.update || (raw => this.state.update(raw));
        this.p = null; this.stopped = false; this.last = ''; this.lastMirror = ''; this.generation = 0; this.providerAvailable = null;
    }
    async start() {
        const generation = ++this.generation;
        let p = null;
        try {
            p = await this.signals.proxy(this.iface, '1');
            if (this.stopped || generation !== this.generation) { if (p.shutdown) await p.shutdown(); return; }
            this.p = p;
            const live = fn => data => { if (!this.stopped && generation === this.generation) { fn(data); this.change(); } };
            await this.signals.onAvailable(p, live(on => { this.providerAvailable = on === true; this.state.availability(on); }));
            await this.signals.on(p, this.event, live(raw => {
                if (this.providerAvailable === false) return;
                this.update(raw);
                const key = JSON.stringify(this.state.sample && {
                    qualifier: this.state.sample.qualifier, left: this.state.sample.left, right: this.state.sample.right });
                if (key !== this.last) { this.last = key; this.log.info('blind-spot ' + this.iface + ': ' + key); }
            }), this.log);
            // Failure to subscribe to the optional raw mirror event must not take
            // away the typed warning field. Raw values are shown on the HU only.
            if (this.withMirror) try { await this.signals.on(p, MIRROR_EVENT, live(raw => {
                if (this.providerAvailable === false) return;
                this.state.updateMirror(raw);
                const mirror = this.state.mirror, key = JSON.stringify({ left: mirror.left, right: mirror.right });
                if (key !== this.lastMirror) { this.lastMirror = key; this.log.info('blind-spot raw mirror event: ' + key); }
            }), this.log); }
            catch (e) { this.log.warn('raw mirror event unavailable: ' + e.message); }
        } catch (e) {
            this.state.availability(false); this.change();
            this.log.warn('blind-spot subscription ' + this.iface + ': ' + String(e.message || e));
            if (p && p.shutdown) await Promise.resolve(p.shutdown()).catch(() => {});
            this.p = null;
        }
    }
    stop() {
        this.stopped = true; this.generation++;
        this.state.availability(false);
        const p = this.p; this.p = null;
        if (p && p.shutdown) Promise.resolve().then(() => p.shutdown()).catch(() => {});
    }
}
module.exports = { WarningSource };
