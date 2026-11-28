'use strict';
// Read-only reachability check. It subscribes to one notification of a few
// other driver-assistance services so the app can say WHERE the blind-spot
// subscription stops: no definition on the head unit, refused, not offered by
// any unit, or offered and silent. Nothing is sent to the car.
const CHECKS = [
    // Published by the body controller's gateway: shows that car data reaches an app at all.
    { key: 'gap', label: 'Gap to car ahead (from body controller)', iface: 'de.bmw.dass.GapVehicleAhead', member: 'GapVehicleDrivingAhead', origin: 'bdc' },
    // Sent by the driver-assistance computer for the cluster's assisted driving view.
    { key: 'view', label: 'Assisted view: cruise state', iface: 'de.bmw.dass.AssistedDrivingViewFunctionInput', member: 'assistedDrivingViewFunctionInputIbVip', origin: 'assist' },
    { key: 'lateral', label: 'Assisted view: steering assist', iface: 'de.bmw.dass.pad.communication.AssistedDrivingViewLateralFunctionInput', member: 'lateralFunctionInputAssistedDrivingView', origin: 'assist' },
    { key: 'objects', label: 'Assisted view: object list', iface: 'de.bmw.dass.pad.communication.ObjectListSuAAR', member: 'suAARObjectList', origin: 'assist' }
];
// The stage a subscription reached, from the error text the platform gives.
function stageOf(error) {
    const text = String(error && error.message || error || '');
    if (/no SOME\/IP config/i.test(text)) return 'no definition';
    if (/native module/i.test(text)) return 'no SOME/IP on this host';
    return 'refused';
}
// One line of plain words for a status { stage, offered, events, error }.
function describe(label, status) {
    let text;
    if (status.stage === 'no definition') text = 'head unit has no definition for it (reinstall the app)';
    else if (status.stage === 'refused' || status.stage === 'no SOME/IP on this host') text = status.stage + (status.error ? ': ' + status.error : '');
    else if (status.stage !== 'subscribed') text = status.stage;
    else if (status.events > 0) text = 'RECEIVING, ' + status.events + ' updates';
    else if (status.offered === true) text = 'offered by the car, nothing sent yet';
    else if (status.offered === false) text = 'NOT OFFERED by any unit';
    else text = 'subscribed, waiting';
    return (label + ': ' + text).slice(0, 110);
}
class Probe {
    constructor(signals, log, checks) {
        this.signals = signals; this.log = log; this.stopped = false; this.proxies = [];
        this.items = (checks || CHECKS).map(c => Object.assign({}, c, { stage: 'starting', offered: null, events: 0, error: '' }));
    }
    async start() {
        for (let i = 0; i < this.items.length && !this.stopped; i++) await this._open(this.items[i]);
    }
    async _open(item) {
        let p = null;
        try {
            p = await this.signals.proxy(item.iface, '1');
            if (this.stopped) { if (p && p.shutdown) await p.shutdown(); return; }
            this.proxies.push(p);
            await this.signals.onAvailable(p, on => { if (!this.stopped) item.offered = on === true; });
            await this.signals.on(p, item.member, () => { if (!this.stopped) item.events++; }, this.log);
            item.stage = 'subscribed';
        } catch (e) {
            item.stage = stageOf(e); item.error = String(e && e.message || e).slice(0, 70);
            this.log.warn('blind-spot check ' + item.iface + ': ' + item.error);
        }
    }
    status() { return this.items.map(i => ({ key: i.key, label: i.label, origin: i.origin, stage: i.stage, offered: i.offered, events: i.events, error: i.error })); }
    stop() {
        this.stopped = true;
        const proxies = this.proxies; this.proxies = [];
        proxies.forEach(p => { if (p && p.shutdown) Promise.resolve().then(() => p.shutdown()).catch(() => {}); });
    }
}
// What the checks add up to. sources = the two blind-spot subscriptions, checks = Probe.status().
function verdict(sources, checks, uds) {
    const got = s => s.events > 0, offered = s => s.offered === true || got(s);
    if (sources.some(got)) return 'Blind-spot data is arriving over SOME/IP.';
    if (sources.some(s => s.stage === 'no definition')) return 'The head unit has no definition for the blind-spot service: reinstall the app.';
    if (sources.some(s => s.stage === 'refused')) return 'The head unit refused the blind-spot subscription (see the app log).';
    if (sources.some(offered)) return 'The car offers the blind-spot service but has sent nothing yet. Drive with a car beside you.';
    const bdc = checks.filter(c => c.origin === 'bdc'), assist = checks.filter(c => c.origin === 'assist');
    const tail = uds && uds.valid ? ' Using the mirror status read instead.' : '';
    if (assist.some(offered)) return 'The assistance computer is visible, but it does not offer the blind-spot service.' + tail;
    if (bdc.some(offered)) return 'Car data reaches the app, but nothing from the assistance computer is offered to the head unit.' + tail;
    if (checks.every(c => c.stage === 'subscribed')) return 'No car service is offered to this app yet. Is the ignition on?' + tail;
    return 'Checks did not complete (see the lines above).' + tail;
}
module.exports = { Probe, CHECKS, describe, verdict, stageOf };
