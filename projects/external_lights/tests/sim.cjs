'use strict';
// A simulated car for the offline tests (plain Node 8 syntax: tools/check-node8.cjs runs it under Node 8.16.2).
//   Clock  time that only moves when a test says so
//   Car    a body controller behind the app kit's diag.physical(): it takes 2E D542 (lamp function, time in
//          10 ms), keeps each lamp on until its time is over, answers after a set time, takes one request at a
//          time, and can be told to stay silent, to refuse everything, or not to have some lamps
const path = require('path');
const APP = path.join(__dirname, '..', 'apps', 'external_lights');
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

// TAB_LAMPEN_FUNKTION of the G11 body controller's description (every value, also the ones the app leaves out)
const TABLE = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x19];

function Car(clock, o) {
    o = o || {};
    this.clock = clock;
    this.writeMs = o.writeMs == null ? 200 : o.writeMs;
    this.missing = o.missing || [];                  // lamp function numbers this car refuses as out of range
    this.silent = false; this.refuse = 0;
    this.on = {};                                    // lamp function number -> the moment it goes off
    this.log = [];                                   // every request: { t, target, sid, data, done, reply }
    this.inFlight = 0; this.overlaps = 0; this.bad = [];
    this.longest = 0;                                // the longest on-time any request asked for, ms
}
Car.prototype.lit = function () {
    const now = this.clock.now(), self = this;
    return Object.keys(this.on).map(Number).filter(function (id) { return self.on[id] > now; }).sort(function (a, b) { return a - b; });
};
Car.prototype.writes = function () { return this.log.filter(function (r) { return r.sid === 0x2e; }); };
Car.prototype.physical = function (target, sid, data, timeoutMs) {
    const self = this, rec = { t: this.clock.now(), target: target, sid: sid, data: data.slice(), done: null };
    this.log.push(rec);
    if (this.inFlight) this.overlaps++;
    this.inFlight++;
    const heard = !this.silent && target === 0x40;
    return new Promise(function (resolve) {
        self.clock.setTimer(function () {
            const answer = !heard ? null : sid === 0x2e ? self._write(data) : [0x7f, sid, 0x11];
            self.inFlight--; rec.done = self.clock.now(); rec.reply = answer; resolve(answer);
        }, heard ? self.writeMs : timeoutMs || 4000);
    });
};
Car.prototype._write = function (data) {
    if (data[0] !== 0xd5 || data[1] !== 0x42) { this.bad.push('DID ' + data.slice(0, 2).join(' ')); return [0x7f, 0x2e, 0x31]; }
    if (data.length !== 6) { this.bad.push('length ' + data.length); return [0x7f, 0x2e, 0x13]; }
    if (this.refuse) return [0x7f, 0x2e, this.refuse];
    const id = data[2] * 256 + data[3], units = data[4] * 256 + data[5];
    if (TABLE.indexOf(id) < 0) { this.bad.push('lamp ' + id); return [0x7f, 0x2e, 0x31]; }
    if (units > 32767) { this.bad.push('time ' + units); return [0x7f, 0x2e, 0x31]; }
    if (this.missing.indexOf(id) >= 0) return [0x7f, 0x2e, 0x31];
    this.longest = Math.max(this.longest, units * 10);
    this.on[id] = units ? this.clock.now() + units * 10 : 0;
    return [0x6e, 0xd5, 0x42];
};

const quiet = { info: function () {}, warn: function () {}, error: function () {} };

/** A player on a simulated car. o: Car options, moving (a function), maxMs. */
function rig(o) {
    o = o || {};
    const clock = new Clock(), car = new Car(clock, o), state = { moving: false };
    const Player = require(path.join(APP, 'player')).Player;
    const player = new Player({ diag: car, log: quiet, now: function () { return clock.now(); },
        setTimer: function (fn, ms) { return clock.setTimer(fn, ms); }, clearTimer: function (id) { clock.clearTimer(id); },
        moving: function () { return state.moving; }, maxMs: function () { return o.maxMs || 180000; } });
    return { clock: clock, car: car, player: player, state: state };
}

module.exports = { APP: APP, Clock: Clock, Car: Car, TABLE: TABLE, rig: rig, quiet: quiet };
