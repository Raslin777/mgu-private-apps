'use strict';
// Real values only: never the app kit's bench/demo parked fallback.
const FRESH_MS = 1500;
// The Park check (0.2.7) and the zero-speed check (0.2.8) are switched off for the owner's testing: reason()
// then blocks nothing. The signals are still received, shown on the tests page and logged, and warning()
// still reports speed for the lighting page. Set either to true to restore that check.
const PARK_CHECK = false;
const SPEED_CHECK = false;
const stageOf = raw => ({ P:'P',R:'R',N:'N',D:'D',1:'P',2:'R',3:'N',4:'D' })[raw] || null;
// DataPowerTrain2 has a DIFFERENT enum: N=1, R=2, P=3, NP=4.
// NP/N_OR_P and the engaged-gear field cannot confirm Park.
function selectionOf(raw) {
    if (raw === 'P' || raw === 3) return 'P';
    if (raw === 'N' || raw === 1) return 'N';
    if (raw === 'R' || raw === 2) return 'R';
    if ((typeof raw === 'number' && raw >= 5 && raw <= 13) || /^_[1-9]$/.test(String(raw))) return 'D';
    return null;
}
function watch(ctx, log, now, opts) {
    now = now || Date.now;
    const parkCheck = opts && opts.parkCheck != null ? !!opts.parkCheck : PARK_CHECK;
    const speedCheck = opts && opts.speedCheck != null ? !!opts.speedCheck : SPEED_CHECK;
    let speed = null, speedRaw = null, speedAt = -Infinity;
    const selectors = { gearbox:{raw:null,stage:null,at:-Infinity}, powertrain:{raw:null,stage:null,at:-Infinity} };
    const subs = [];
    const add = (iface, fields) => {
        ctx.signals.watch(iface, '1', fields, log, { pollMs: 500 }).then(s => subs.push(s)).catch(e => log.warn(String(e)));
    };
    add('de.bmw.infotainment.vehicle.Vehicle2', { statusCarSpeed2(v) {
        const raw = v && v.speedVehicleCentreOfGravity;
        speedRaw = raw;
        speed = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw < 65535 ? raw / 64 : null;
        speedAt = now();
    } });
    add('de.bmw.infrastructure.VehicleInformation', { statusGearboxDrive(v) {
        const raw = v && v.statusActualStageDrive;
        const previous = selectors.gearbox.raw;
        selectors.gearbox = {raw:raw,stage:stageOf(raw),at:now()};
        if (previous !== raw) log.info('external lights gearbox stage: ' + JSON.stringify(selectors.gearbox));
    }, DataPowerTrain2(v) {
        const raw = v && v.statusGearSelectionDrive;
        const previous = selectors.powertrain.raw;
        selectors.powertrain = {raw:raw,stage:selectionOf(raw),at:now()};
        if (previous !== raw) log.info('external lights powertrain selection: ' + JSON.stringify(selectors.powertrain));
    } });
    const speedReason = () => {
        if (speed === null || now() - speedAt > FRESH_MS) return 'Warning: vehicle speed unavailable or stale';
        if (speed !== 0) return 'Warning: moving vehicle; light effects can mislead other drivers';
        return null;
    };
    // What blocks the address-test write.
    const reason = () => {
        const moving = speedCheck ? speedReason() : null;
        if (moving) return moving;
        if (!parkCheck) return null;
        const fresh = Object.keys(selectors).map(k => selectors[k]).filter(s => now()-s.at <= FRESH_MS && s.stage);
        const parked = fresh.some(s => s.stage === 'P'), other = fresh.find(s => s.stage !== 'P');
        if (parked && other) return 'Warning: conflicting selector signals';
        if (other) return 'Warning: selector reports ' + other.stage + ', not Park';
        if (parked) return null;
        if (Object.keys(selectors).some(k => selectors[k].stage)) return 'Warning: Park data is stale';
        return 'Warning: Park signal unavailable';
    };
    const summary = () => {
        const value = (raw,at) => at === -Infinity ? 'not received' : String(raw == null ? '?' : raw) + ' (' + Math.max(0,now()-at) + ' ms)';
        return 'Selector inputs: gearbox=' + value(selectors.gearbox.raw,selectors.gearbox.at) +
            '; powertrain=' + value(selectors.powertrain.raw,selectors.powertrain.at) +
            '; speed=' + (speed == null ? '?' : speed.toFixed(1)) + ' km/h raw=' + String(speedRaw) + ' (' + (speedAt === -Infinity ? 'not received' : Math.max(0,now()-speedAt)+' ms') + ')';
    };
    return {
        speed: () => speed,
        reason, summary,
        // What the lighting page shows: display only, blocks nothing.
        warning: () => speedReason() || reason(),
        close() { subs.forEach(s => s.shutdown && s.shutdown()); }
    };
}
module.exports = { watch, FRESH_MS, PARK_CHECK, SPEED_CHECK };
