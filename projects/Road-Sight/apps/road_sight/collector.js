'use strict';
// Subscribes, read-only, to every notification of every listed service and
// keeps a count, the time and the latest value of each. Nothing is ever sent
// to the car beyond the subscriptions themselves.
const { oneLine } = require('./flatten');
const RATE_WINDOW_MS = 5000;
class Collector {
    constructor(signals, services, log, options) {
        const opts = options || {};
        this.signals = signals; this.log = log; this.now = opts.now || Date.now;
        this.logFirst = opts.logFirst || (() => true);
        this.stopped = false; this.proxies = [];
        this.services = services.map(spec => ({
            spec: spec, state: 'waiting', available: null, error: '',
            members: spec.fields.map(name => ({ name: name, kind: 'field' }))
                .concat(spec.events.map(name => ({ name: name, kind: 'event' })))
                .map(m => Object.assign(m, { count: 0, at: null, first: null, value: undefined, error: '', stamps: [] }))
        }));
    }
    async start() {
        // One service after another: a failure in one must not stop the rest.
        for (let i = 0; i < this.services.length && !this.stopped; i++) await this._open(this.services[i]);
    }
    async _open(svc) {
        let proxy = null;
        try {
            proxy = await this.signals.proxy(svc.spec.iface, svc.spec.instance);
            if (this.stopped) { if (proxy && proxy.shutdown) await proxy.shutdown(); return; }
            this.proxies.push(proxy);
            svc.state = 'subscribing';
            await this.signals.onAvailable(proxy, on => { if (!this.stopped) svc.available = on === true; });
        } catch (e) {
            svc.state = 'refused'; svc.error = String(e && e.message || e).slice(0, 120);
            this.log.warn('road-sight ' + svc.spec.name + ': ' + svc.error);
            return;
        }
        let ok = 0;
        for (let i = 0; i < svc.members.length && !this.stopped; i++) {
            const member = svc.members[i];
            try {
                await this.signals.on(proxy, member.name, value => this._receive(svc, member, value), this.log);
                ok++;
            } catch (e) {
                member.error = String(e && e.message || e).slice(0, 100);
                this.log.warn('road-sight ' + svc.spec.name + '.' + member.name + ': ' + member.error);
            }
        }
        svc.state = ok === svc.members.length ? 'subscribed' : ok ? 'partly subscribed' : 'refused';
    }
    _receive(svc, member, value) {
        if (this.stopped) return;
        const now = this.now();
        member.count++; member.at = now; member.value = value;
        member.stamps.push(now);
        while (member.stamps.length && now - member.stamps[0] > RATE_WINDOW_MS) member.stamps.shift();
        if (member.first === null) {
            member.first = now;
            if (this.logFirst()) this.log.info('road-sight first ' + svc.spec.name + '.' + member.name + ': ' + oneLine(value, 900));
        }
    }
    // Events per second over the last few seconds.
    static rate(member, now) {
        const recent = member.stamps.filter(t => now - t <= RATE_WINDOW_MS);
        return recent.length < 2 ? (recent.length ? recent.length / (RATE_WINDOW_MS / 1000) : 0)
            : (recent.length - 1) / Math.max((recent[recent.length - 1] - recent[0]) / 1000, 0.001);
    }
    snapshot() {
        const now = this.now();
        return this.services.map(svc => {
            const members = svc.members.map(m => ({ name: m.name, kind: m.kind, count: m.count, error: m.error,
                age: m.at === null ? null : now - m.at, rate: Collector.rate(m, now), value: m.value }));
            const seen = members.filter(m => m.count > 0);
            return { name: svc.spec.name, iface: svc.spec.iface, group: svc.spec.group, id: svc.spec.id, evidence: svc.spec.evidence,
                state: svc.state, available: svc.available, error: svc.error, members: members,
                total: members.reduce((n, m) => n + m.count, 0), seen: seen.length,
                age: seen.length ? Math.min.apply(null, seen.map(m => m.age)) : null,
                rate: members.reduce((n, m) => n + m.rate, 0) };
        });
    }
    logAll() {
        const snap = this.snapshot();
        let written = 0;
        snap.forEach(svc => svc.members.forEach(m => {
            if (!m.count) return;
            written++;
            this.log.info('road-sight ' + svc.name + '.' + m.name + ' x' + m.count + ': ' + oneLine(m.value, 900));
        }));
        this.log.info('road-sight snapshot: ' + written + ' members with data, ' +
            snap.filter(s => s.total > 0).length + ' of ' + snap.length + ' services');
        return written;
    }
    stop() {
        this.stopped = true;
        const proxies = this.proxies; this.proxies = [];
        proxies.forEach(p => { if (p && p.shutdown) Promise.resolve().then(() => p.shutdown()).catch(() => {}); });
    }
}
module.exports = { Collector };
