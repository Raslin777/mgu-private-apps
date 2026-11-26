'use strict';
const IFACE = 'de.bmw.dass.driverassistanceapplications.LateralCollisionAvoidance';
const FIELD = 'lateralCollisionAvoidanceQualifiers';
const MIRROR_EVENT = 'requestWarningSteeringWheelExteriorMirror';
const VIEW_IFACE = 'de.bmw.dass.driverassistanceapplications.AssistedDrivingViewLateralCollisionAvoidance';
const VIEW_EVENT = 'assistedDrivingViewLcaInput';
const MAX_AGE_MS = 2000;
const QUALIFIERS = { FUNCTION_AVAILABLE: 1, FUNCTION_AVAILABLE_REDUCED: 3,
    FUNCTION_ACTIVE: 9, FUNCTION_ACTIVE_REDUCED: 11,
    FUNCTION_NOT_AVAILABLE_ERROR: 6, FUNCTION_NOT_AVAILABLE: 14, INVALID: 15 };
const LEFT = { NO_WARNING_LEFT: 0, WARNING_LEFT: 1, ACUTE_WARNING_LEFT: 2, ACUTE_WARNING_LEFT_AND_STEERING: 3 };
const RIGHT = { NO_WARNING_RIGHT: 0, WARNING_RIGHT: 1, ACUTE_WARNING_RIGHT: 2,
    FUNCTION_ACTIVE_ACUTE_WARNING_RIGHT_AND_STEERING: 3 };
function value(raw, names) {
    if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
    if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(names, raw)) return names[raw];
    return null;
}
class WarningState {
    // maxAge: how long a sample counts. Events expire (MAX_AGE_MS, the default).
    // A SOME/IP *field* is state: the last notified value is the current value
    // until the provider goes away, so the app's primary source passes Infinity.
    constructor(now, maxAge) {
        this.now = now || Date.now; this.maxAge = maxAge == null ? MAX_AGE_MS : maxAge;
        this.available = false; this.sample = null; this.mirror = null; this.updates = 0;
    }
    availability(on) {
        this.available = on === true;
        if (!this.available) { this.sample = null; this.mirror = null; }
    }
    update(raw) {
        const data = raw && (raw[FIELD] || raw);
        const sides = data && data.statusLaneChangeWarning;
        this.available = true; this.updates++;
        this.sample = { at: this.now(), qualifier: value(data && data.qualifierLaneChangeWarning, QUALIFIERS),
            left: value(sides && sides.statusLaneChangeWarningLeft, LEFT),
            right: value(sides && sides.statusLaneChangeWarningRight, RIGHT) };
    }
    updateMirror(data) {
        // UInt8 values have no enum in the owner's catalog. Keep them as evidence;
        // never guess that a nonzero/default value means an illuminated mirror LED.
        this.mirror = { at: this.now(), left: data && data.requestExteriorMirrorDisplayWarningLeftHand,
            right: data && data.requestExteriorMirrorDisplayWarningRightHand };
    }
    updateView(raw) {
        const data = raw && (raw[VIEW_EVENT] || raw);
        const sides = data && data.statusLaneChangeWarning;
        // Only the lane-change struct is a blind-spot warning source. Ignore
        // adjacent lane-departure, side-collision and object-ID structures.
        this.update({ qualifierLaneChangeWarning: sides && sides.qualifierLaneChangeWarning,
            statusLaneChangeWarning: sides });
    }
    snapshot() {
        const s = this.sample;
        const age = s ? this.now() - s.at : null;
        const fresh = !!(this.available && s && age >= 0 && age <= this.maxAge);
        let reason = '';
        if (!this.available) reason = 'Warning signal unavailable';
        else if (!s) reason = 'Waiting for warning data';
        else if (this.now() - s.at > this.maxAge || this.now() < s.at) reason = 'Warning data stale';
        else if ([1, 3, 9, 11].indexOf(s.qualifier) < 0) reason = 'Blind-spot system unavailable';
        else if ([0, 1, 2, 3].indexOf(s.left) < 0 || [0, 1, 2, 3].indexOf(s.right) < 0) reason = 'Warning value unknown';
        const active = !reason && (s.qualifier === 9 || s.qualifier === 11);
        if (!reason && !active && (s.left || s.right)) reason = 'Warning data inconsistent';
        return { valid: !reason, authoritative: fresh, available: this.available,
            active: !!active && !reason, reason: reason,
            left: active && !reason ? s.left : 0, right: active && !reason ? s.right : 0,
            age: s ? Math.max(0, this.now() - s.at) : null, sample: s, mirror: this.mirror,
            updates: this.updates, held: this.maxAge === Infinity };
    }
}
function selectSomeip(primary, assisted) {
    const first = Object.assign({ source: 'SOME/IP' }, primary);
    if (first.authoritative || first.valid) return first;
    if (assisted.authoritative || assisted.valid) return Object.assign({}, assisted,
        { source: 'SOME/IP Assisted View', fallbackReason: first.reason });
    return first;
}
module.exports = { WarningState, selectSomeip, IFACE, FIELD, MIRROR_EVENT, VIEW_IFACE, VIEW_EVENT, MAX_AGE_MS };
