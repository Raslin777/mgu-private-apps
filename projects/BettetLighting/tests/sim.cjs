'use strict';
// A simulated car for the offline tests (plain Node 8 syntax: tools/check-node8.cjs runs it under Node 8.16.2).
//   Clock  time that only moves when a test says so: nothing here waits for real time
//   Car    a body controller behind the app kit's diag.physical(): two LIN buses of light modules that remember
//          the colour, brightness and hold time written to them, answer after a set time, take one request at a
//          time, and can be told to stay silent, refuse, or answer a write without the light taking it
const path = require('path');
const APP = path.join(__dirname, '..', 'apps', 'better_lighting');
const immediate = setImmediate;

function Clock() { this.t = 0; this.q = []; this.id = 0; }
Clock.prototype.now = function () { return this.t; };
Clock.prototype.setTimer = function (fn, ms) { const id = ++this.id; this.q.push({ id: id, at: this.t + Math.max(0, ms || 0), fn: fn }); return id; };
Clock.prototype.clearTimer = function (id) { this.q = this.q.filter(function (x) { return x.id !== id; }); };
Clock.prototype.flush = function () { return new Promise(function (r) { immediate(function () { immediate(r); }); }); };
/** Lets ms of simulated time pass, running everything due on the way. */
Clock.prototype.run = async function (ms) {
    const end = this.t + ms;
    for (;;) {
        await this.flush();
        let next = null;
        this.q.forEach(function (x) { if (x.at <= end && (!next || x.at < next.at || (x.at === next.at && x.id < next.id))) next = x; });
        if (!next) break;
        this.clearTimer(next.id);
        this.t = Math.max(this.t, next.at);
        next.fn();
    }
    this.t = end;
    await this.flush();
};

// a G20's lights (location codes, as the app kit's lin.js sample): 7 on bus 1, 12 on bus 2
const G20 = [[0x0f, 0x0e, 0x0c, 0x12, 0x22, 0x10, 0x04], [0x15, 0x17, 0x13, 0x01, 0x03, 0x08, 0x07, 0x05, 0x0b, 0x21, 0x09, 0x02]];
const READ = ['da5f', 'e3d1'], WRITE = ['da5e', 'e3d1'];
const hex2 = function (d) { return ('0' + d[0].toString(16)).slice(-2) + ('0' + d[1].toString(16)).slice(-2); };

function Car(clock, o) {
    o = o || {};
    this.clock = clock;
    this.buses = o.buses || G20;                     // null in place of a bus: the car has no such bus
    this.writeMs = o.writeMs == null ? 200 : o.writeMs;
    this.readMs = o.readMs == null ? 3000 : o.readMs;
    this.silent = false;                             // true: no answer to anything
    this.refuse = 0;                                 // an NRC: every write refused with it
    this.drop = null;                                // { bus, nad }: the next write to it answered but not taken
    this.lit = this.buses.map(function (b) { return (b || []).map(function () { return null; }); });
    this.log = [];                                   // every request: { t, target, sid, data, done }
    this.inFlight = 0; this.overlaps = 0; this.expired = 0; this.bad = [];
}
Car.prototype.writes = function () { return this.log.filter(function (r) { return r.sid === 0x2e; }); };
Car.prototype.reads = function () { return this.log.filter(function (r) { return r.sid === 0x22; }); };
/** What a light shows now: { rgb, bright } of ours, or null (the car's own colour: never written, given back, or its hold ran out). */
Car.prototype.shown = function (bus, i) { const l = this.lit[bus][i]; return l && l.until > this.clock.now() ? l : null; };
Car.prototype.all = function () {
    const out = [], self = this;
    this.lit.forEach(function (b, bus) { b.forEach(function (l, i) { out.push(self.shown(bus, i)); }); });
    return out;
};
Car.prototype.everyLight = function (rgb, bright) {
    return this.all().every(function (l) { return !!l && l.rgb.join() === rgb.join() && (bright == null || l.bright === bright); });
};
Car.prototype.physical = function (target, sid, data, timeoutMs) {
    const self = this, rec = { t: this.clock.now(), target: target, sid: sid, data: data.slice(), done: null };
    this.log.push(rec);
    if (this.inFlight) this.overlaps++;
    this.inFlight++;
    const heard = !this.silent && target === 0x40;
    const after = heard ? (sid === 0x22 ? this.readMs : this.writeMs) : timeoutMs || 4000;
    return new Promise(function (resolve) {
        self.clock.setTimer(function () {
            // the lights change (and the status is taken) when the answer comes, not when the request leaves
            const answer = !heard ? null : sid === 0x22 ? self._read(data) : sid === 0x2e ? self._write(data) : [0x7f, sid, 0x11];
            self.inFlight--; rec.done = self.clock.now(); rec.reply = answer; resolve(answer);
        }, after);
    });
};
Car.prototype._read = function (data) {
    const bus = READ.indexOf(hex2(data)), self = this;
    if (bus < 0 || !this.buses[bus] || data.length !== 2) return [0x7f, 0x22, 0x31];
    const b = [0x62].concat(data.slice(0, 2));
    for (let i = 0; i < 26; i++) {
        const loc = this.buses[bus][i], l = loc == null ? null : this.shown(bus, i);
        b.push.apply(b, loc == null ? [0xff, 0xff, 0xff, 0xff, 0x7f, 3, 7, 7, 7, 7]
            : l ? [loc, l.rgb[2], l.rgb[1], l.rgb[0], l.bright, 0, 0, 0, 0, 0] : [loc, 254, 60, 120, 100, 0, 0, 0, 0, 0]);
    }
    return b.concat([2]);
};
Car.prototype._write = function (data) {
    const bus = WRITE.indexOf(hex2(data)), now = this.clock.now(), self = this;
    if (bus < 0 || !this.buses[bus]) return [0x7f, 0x2e, 0x31];
    if (data.length !== 9) { this.bad.push('length ' + data.length); return [0x7f, 0x2e, 0x13]; }
    if (this.refuse) return [0x7f, 0x2e, this.refuse];
    const nad = data[2], on = data[3], bright = data[4], rgb = data.slice(5, 8), secs = data[8];
    if (nad > this.buses[bus].length || on > 1 || bright > 100 || rgb.some(function (x) { return x > 0xfe; }) || secs > 254 || (on && !secs)) this.bad.push(data.join(' '));
    if (this.drop && this.drop.bus === bus && this.drop.nad === nad) { this.drop = null; return [0x6e, data[0], data[1]]; }
    this.lit[bus].forEach(function (l, i) {
        if (nad !== 0 && nad !== i + 1) return;
        // a light of ours whose hold ran out before this write: it showed the car's colour in between
        if (l && on && l.until <= now) self.expired++;
        self.lit[bus][i] = on ? { rgb: rgb, bright: bright, until: now + secs * 1000, at: now } : null;
    });
    return [0x6e, data[0], data[1]];
};

/** A store as main.js gives the driver (the settings' lightsFound). */
function Store(v) { this.v = v || null; }
Store.prototype.get = function () { return this.v; };
Store.prototype.set = function (v) { this.v = JSON.parse(JSON.stringify(v)); };

const quiet = { info: function () {}, warn: function () {}, error: function () {} };
const look = function (kind, extra) {
    return Object.assign({ kind: kind, upper: { rgb: [254, 0, 0], bright: 80 }, lower: { rgb: [254, 0, 0], bright: 80 }, speed: 2 }, extra || {});
};
/** The G20's lights as an earlier run kept them. */
const found = function () {
    const lights = [];
    G20.forEach(function (b, bus) { b.forEach(function (loc, i) { lights.push([bus, i + 1, loc]); }); });
    return { lights: lights, buses: ['present', 'present'] };
};

/** A driver (this project's, or another Lights class given) on a simulated car. */
function rig(o) {
    o = o || {};
    const clock = new Clock(), car = new Car(clock, o), store = new Store(o.found ? found() : null);
    const Lights = o.Lights || require(path.join(APP, 'lights')).Lights;
    const lights = new Lights({ diag: car, log: quiet, store: store, now: function () { return clock.now(); },
        setTimer: function (fn, ms) { return clock.setTimer(fn, ms); }, clearTimer: function (id) { clock.clearTimer(id); } });
    return { clock: clock, car: car, lights: lights, store: store };
}

module.exports = { APP: APP, Clock: Clock, Car: Car, Store: Store, G20: G20, rig: rig, look: look, found: found, quiet: quiet };
