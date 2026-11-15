'use strict';
// Real values only: never the app kit's bench/demo parked fallback.
const FRESH_MS = 1500;
function watch(ctx, log, now) {
    now = now || Date.now;
    let speed = null, park = false, speedAt = -Infinity, parkAt = -Infinity;
    const subs = [];
    const add = (iface, fields) => {
        ctx.signals.watch(iface, '1', fields, log, { pollMs: 500 }).then(s => subs.push(s)).catch(e => log.warn(String(e)));
    };
    add('de.bmw.infotainment.vehicle.Vehicle2', { statusCarSpeed2(v) {
        const raw = v && v.speedVehicleCentreOfGravity;
        speed = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw < 65535 ? raw / 64 : null;
        speedAt = now();
    } });
    add('de.bmw.infrastructure.VehicleInformation', { statusGearboxDrive(v) {
        const raw = v && v.statusActualStageDrive;
        park = raw === 'P' || raw === 1; parkAt = now();
    } });
    return {
        speed: () => speed,
        reason() {
            if (speed === null || now() - speedAt > FRESH_MS) return 'Warning: vehicle speed unavailable or stale';
            if (speed !== 0) return 'Warning: moving vehicle; light effects can mislead other drivers';
            if (!park || now() - parkAt > FRESH_MS) return 'Warning: Park is not confirmed';
            return null;
        },
        close() { subs.forEach(s => s.shutdown && s.shutdown()); }
    };
}
module.exports = { watch, FRESH_MS };
