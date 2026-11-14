'use strict';
/**
 * lights.js - the ambient light modules driven with any colour, through the head unit's diagnostic link to the body
 * controller (lin.js has the bytes, scenes.js what each light shows).
 *
 * The request bytes, the frame planning (one write to all lights of a bus, then the ones that differ), the hold and
 * renewal times and the pause after failures are the app kit's ambient_config/lights.js (MIT,
 * cauliflowermossgrape/idrive7-apps). What is different, taken from how the owner's Android app (BMWCOLOR
 * AmbientEngine / BdcTcpClient) drives the same body controller:
 *
 *   No read before the first write. A colour for the whole car goes out at once as one write for each bus to all
 *     its lights (NAD 0); the list of the car's lights is only needed for the picture and for looks whose lights
 *     differ. It is read once (after a still colour is out), kept in the settings, and not read again unless
 *     asked (find()).
 *   No read-back after a write. Each read takes the body controller seconds and nothing else gets through
 *     meanwhile. A still colour is written a second time 0.7 s later instead (a light that missed the first write
 *     takes the second), and again at every renewal.
 *   Each write carries the colour of the moment it is sent, not of the moment its frame was planned.
 *   Writes are paced like the Android app's: one at a time, the answer awaited, a rest of GAP_MS after it, and
 *     never more than one write started each MIN_WRITE_MS (10 a second) however fast the car answers.
 *
 *   const l = new Lights({ diag, log, store });      store: { get(), set(v) } keeps the lights found
 *   l.show(scene)  l.carColour()  l.flash(rgb, ms)  l.dim(f)  l.find()  l.stop()
 *   l.lights -> [{ bus, nad, name, part, x, y, ... }]   l.state -> 'finding' | 'none' | 'car' | 'ours'
 *   l.at(light) -> what the light shows now ({ rgb, bright })
 *   l.rate -> writes a second   l.fps -> whole frames a second   l.rtt -> ms from a write to its answer
 */
const EventEmitter = require('events');
const { BDC, BUSES, parseStatus, writeFrame, releaseFrame, place } = require('./lin');
const S = require('./scenes');

const HOLD_S = 60, RENEW_MS = 40000, MOVE_HOLD_S = 5, MOVE_RENEW_MS = 3000;
const PAUSE_MS = 10000, FAILS = 4;
const ALL = 0;                 // NAD 0: every light of the bus
const GAP_MS = 20;             // rest after each answer (the Android app: 18)
const MIN_WRITE_MS = 100;      // from the start of one write to the start of the next
const SECOND_MS = 700;         // a still colour (or giving back) is written again this long after
const IDLE_MS = 40;            // a moving scene with nothing due looks again this soon
const READ_MS = 15000;         // the status read: the body controller asks its lights first
const NO_SUCH = 0x31;          // request out of range: the car has no such bus
const REFUSALS = 2;

const echo = (sid, did) => (u) => (u[0] === sid + 0x40 && u[1] === did[0] && u[2] === did[1]) || (u[0] === 0x7f && u[1] === sid);
const same = (a, b) => !!a && !!b && Math.abs(a.bright - b.bright) < 2 && a.rgb.every((x, i) => Math.abs(x - b.rgb[i]) < 3);

class Lights extends EventEmitter {
    constructor(o) {
        super();
        this.diag = o.diag; this.log = o.log; this.now = o.now || Date.now; this.store = o.store || null;
        this.setTimer = o.setTimer || setTimeout; this.clearTimer = o.clearTimer || clearTimeout;
        this.lights = [];
        this.bus = BUSES.map(() => 'unknown');      // 'unknown' | 'present' | 'absent'
        // every light of a bus as one: what the car is written to before (or without) its lights being known
        this._whole = BUSES.map((b, bus) => ({ bus, nad: ALL, whole: true, part: 'upper', y: 0.5, name: 'Every light of bus ' + (bus + 1) }));
        this.state = 'car';
        this.error = null;
        this.scene = null; this.t0 = 0;
        this._flash = null;
        this._dim = 1;
        this._last = new Map();        // light (or a bus's whole) -> { rgb, bright, at }
        this._release = [];            // [{ bus }] to give back to the car
        this._seconds = 0; this._secondAt = 0; this._secondOff = null;
        this._running = false; this._timer = null; this._onceTimer = null; this._stopped = false;
        this._fails = 0; this._refused = BUSES.map(() => 0); this._pauseTill = 0; this._frame = null; this._frames = [];
        this._startAt = -1e9; this._answerAt = -1e9;
        this._wantFind = false; this._reading = false; this._finders = []; this._reached = false; this._dead = false;
        this.writes = 0; this.reads = 0; this._times = []; this.rtt = 0; this.perFrame = 0;
        this._load();
    }

    get rate() { const t = this.now(); this._times = this._times.filter((x) => t - x < 3000); return this._times.length / 3; }
    /** Whole frames a second (every light on the same moment of a moving scene). */
    get fps() { const t = this.now(); this._frames = this._frames.filter((x) => t - x < 5000); return this._frames.length / 5; }

    /**
     * What is known of each LIN bus: [{ n (1, 2), state ('unknown' | 'present' | 'absent'), count, upper, lower }].
     * 'unknown': not read yet, written to as a whole; 'absent': the car answered that it has no such bus, or none
     * of its lights.
     */
    buses() {
        return this.bus.map((state, bus) => {
            const on = this._on(bus);
            return { n: bus + 1, state, count: on.length, upper: on.filter((l) => l.part === 'upper').length, lower: on.filter((l) => l.part !== 'upper').length };
        });
    }
    /** What the car's lights allow: known (the list is read), split (upper and lower lights both there). */
    get known() { return this.lights.length > 0; }
    get split() { return this.lights.some((l) => l.part === 'upper') && this.lights.some((l) => l.part !== 'upper'); }

    /** The lights found on an earlier run. */
    _load() {
        let c = null;
        try { c = this.store && this.store.get(); } catch (e) { c = null; }
        if (!c || !Array.isArray(c.lights) || !Array.isArray(c.buses) || c.buses.length !== BUSES.length) return;
        const ok = c.lights.every((l) => Array.isArray(l) && l.length === 3 && BUSES[l[0]] && l[1] >= 1 && l[1] <= 26);
        if (!ok || !c.lights.length) return;
        this.lights = c.lights.map((l) => Object.assign(place(l[2]), { bus: l[0], nad: l[1], rgb: [0, 0, 0], bright: 0, fault: false }));
        this.bus = c.buses.map((b) => (b === 'absent' ? 'absent' : 'present'));
    }

    _setState() {
        const s = this.bus.every((b) => b === 'absent') || this._dead ? 'none'
            : this._reading && !this.lights.length && !this._reached ? 'finding' : this.scene ? 'ours' : 'car';
        if (s !== this.state) { this.state = s; this.emit('change'); }
    }

    /** Reads which lights the car has (between two writes; a look that is on stays on meanwhile). */
    find() {
        this._wantFind = true;
        this.bus = this.bus.map((b) => (b === 'absent' ? 'unknown' : b));
        this._dead = false;
        const done = new Promise((resolve) => this._finders.push(resolve));
        this._kick();
        return done;
    }

    async _read() {
        this._wantFind = false; this._reading = true; this._setState();
        // the body controller takes nothing else while it answers: a moving look gets the long hold first
        if (S.moves(this.scene)) {
            const items = this._plan(this.now() - this.t0);
            for (let i = 0; i < items.length && !this._stopped; i++) {
                await this._pace();
                await this._send(this._writeOf(items[i], items[i].want, HOLD_S));
            }
        }
        const found = [];
        let answered = 0;
        for (let bus = 0; bus < BUSES.length && !this._stopped; bus++) {
            const did = BUSES[bus].read;
            let reply = null;
            await this._pace();
            this._startAt = this.now(); this.reads++;
            try { reply = await this.diag.physical(BDC, 0x22, did, READ_MS, echo(0x22, did), { pendingTimeoutMs: READ_MS }); } catch (e) { this.error = String(e && e.message || e); }
            this._answerAt = this.now();
            const got = reply ? parseStatus(bus, reply) : null;
            if (got) { answered++; found.push.apply(found, got); this.bus[bus] = got.length ? 'present' : 'absent'; }
            else if (reply) {
                this.log.info('lights: bus ' + (bus + 1) + ' refused (' + reply.map((x) => x.toString(16)).join(' ') + ')');
                if (reply[2] === NO_SUCH) { answered++; this.bus[bus] = 'absent'; }
            }
        }
        if (answered) {
            this.lights = found; this._reached = true; this.error = null;
            try { if (this.store && found.length) this.store.set({ lights: found.map((l) => [l.bus, l.nad, l.loc]), buses: this.bus.slice() }); } catch (e) { this.log.warn('lights: not kept: ' + e); }
            this.log.info('lights: ' + found.length + ' found (' + found.map((l) => l.name).join(', ') + ')');
        } else {
            if (!this._reached) this._dead = true;
            this.log.warn('lights: no answer to the status read' + (this.error ? ': ' + this.error : ''));
        }
        this._frame = null; this._reading = false;
        this._setState(); this.emit('change');
        const waiting = this._finders; this._finders = [];
        waiting.forEach((resolve) => resolve(this.lights));
    }

    /** What a light shows now. */
    at(light, scene, t) {
        const now = this.now();
        if (this._flash && now < this._flash.until) return { rgb: this._flash.rgb, bright: 100 };
        const sc = scene || this.scene;
        if (!sc) return null;
        const v = S.lightAt(sc, light, t == null ? now - this.t0 : t);
        return { rgb: v.rgb, bright: Math.round(v.bright * this._dim) };
    }

    show(scene) {
        const once = S.lasts(scene);
        this.scene = scene; this.t0 = this.now(); this._frame = null;
        this.clearTimer(this._onceTimer);
        // a once-only scene (welcome, sportpulse) runs, then its "then" (null: the car's colour), else its still colour
        if (once) {
            this._onceTimer = this.setTimer(() => {
                if (this.scene !== scene) return;
                if (scene.then === null) this.carColour();
                else this.show(scene.then || Object.assign({}, scene, { kind: 'solid' }));
            }, once);
        }
        this._release = []; this._secondOff = null;
        this._seconds = S.moves(scene) ? 0 : 1; this._secondAt = 0;
        this._setState(); this.emit('change');
        this._kick();
    }

    carColour() {
        this.clearTimer(this._onceTimer);
        this.scene = null;
        this._frame = null;
        this._giveBack();
        this._setState(); this.emit('change');
        this._kick();
    }

    flash(rgb, ms) {
        this._flash = { rgb, until: this.now() + (ms || 600) };
        this._frame = null;
        this._kick();
        this.setTimer(() => {
            // with no colour of ours on, the lights go back to the car's
            if (!this.scene) this._giveBack();
            this._frame = null;
            this._kick();
        }, (ms || 600) + 20);
    }

    dim(f) { if (f !== this._dim) { this._dim = f; this._frame = null; this._kick(); } }

    stop() { this._stopped = true; this.clearTimer(this._timer); this.clearTimer(this._onceTimer); }

    /** Every bus with a light of ours on it given back (one write each), and once more a little later. */
    _giveBack() {
        const buses = [];
        this._last.forEach((v, l) => { if (buses.indexOf(l.bus) < 0) buses.push(l.bus); });
        buses.sort();
        this._release = buses.map((bus) => ({ bus }));
        this._seconds = buses.length ? 1 : 0; this._secondAt = 0; this._secondOff = buses;
    }

    _on(bus) { return this.lights.filter((l) => l.bus === bus); }

    _writeOf(it, want, hold) {
        return { bus: it.bus, nad: it.nad, lights: it.lights, want, frame: writeFrame(it.bus, it.nad, want.rgb, want.bright, hold) };
    }

    /**
     * The next write: something to give back, else the next of the frame. Lights that show their colour already
     * (and are not due for their renewal) are skipped. A write to all lights of a bus in a scene every light shows
     * alike, and a write to one light, carry the colour of now, not of the moment the frame was planned.
     */
    _next() {
        if (this._release.length) {
            const r = this._release.shift();
            return { bus: r.bus, nad: ALL, lights: this._on(r.bus).concat([this._whole[r.bus]]), frame: releaseFrame(r.bus, ALL), off: true };
        }
        const now = this.now(), flashing = !!(this._flash && now < this._flash.until + 50);
        if (!this.scene && !flashing) return null;
        const moving = S.moves(this.scene) || flashing, renew = moving ? MOVE_RENEW_MS : RENEW_MS, hold = moving ? MOVE_HOLD_S : HOLD_S;
        for (let tries = 0; tries < 2; tries++) {
            if (!this._frame || !this._frame.todo.length) {
                if (this._frame && this._frame.wrote) { this._frames.push(now); this.perFrame = this._frame.wrote; }
                this._frame = { t: now - this.t0, todo: this._plan(now - this.t0), wrote: 0 };
            }
            while (this._frame.todo.length) {
                const it = this._frame.todo.shift();
                const want = it.fresh ? this.at(it.need[0], null, now - this.t0) || it.want : it.want;
                const due = it.need.some((l) => { const had = this._last.get(l); return !same(want, had) || now - had.at > renew; });
                if (!due) continue;
                this._frame.wrote++;
                return this._writeOf(it, want, hold);
            }
        }
        return null;
    }

    /**
     * One frame's writes. A bus whose lights all show the same (or whose lights are not known): one write to all of
     * them (NAD 0). Otherwise the colour most of its lights want as one write to all, then a write for each light
     * that wants another. [{ bus, nad, lights (written), need (the lights it is for), want, fresh }]
     */
    _plan(t) {
        const items = [];
        const alike = !this.scene || S.uniform(this.scene) || !!(this._flash && this.now() < this._flash.until);
        for (let bus = 0; bus < BUSES.length; bus++) {
            if (this.bus[bus] === 'absent') continue;
            const whole = this._whole[bus];
            const on = this._on(bus).sort((a, b) => a.y - b.y);
            if (alike || !on.length) {
                const want = this.at(whole, null, t);
                if (want) items.push({ bus, nad: ALL, lights: on.concat([whole]), need: [whole], want, fresh: true });
                continue;
            }
            const wants = on.map((l) => this.at(l, null, t));
            if (wants.some((w) => !w)) continue;
            const key = (w) => w.rgb.join() + '/' + w.bright, count = {};
            wants.forEach((w) => { count[key(w)] = (count[key(w)] || 0) + 1; });
            const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
            const most = count[top] > 1 ? wants.find((w) => key(w) === top) : null;
            if (most) items.push({ bus, nad: ALL, lights: on.concat([whole]), need: on.filter((l, i) => key(wants[i]) === top), want: most, fresh: false });
            on.forEach((l, i) => { if (!most || key(wants[i]) !== top) items.push({ bus, nad: l.nad, lights: [l], need: [l], want: wants[i], fresh: true }); });
        }
        return items;
    }

    /** How long until the next request may start. */
    _rest() { return Math.max(this._answerAt + GAP_MS, this._startAt + MIN_WRITE_MS) - this.now(); }

    _pace() {
        const rest = this._rest();
        return rest > 0 ? new Promise((resolve) => this.setTimer(resolve, rest)) : Promise.resolve();
    }

    /** One write, its answer awaited. True when the body controller took it. */
    async _send(w) {
        let reply = null;
        const t = this._startAt = this.now();
        // one write at a time (the gateway takes no second); a busy gateway is asked again soon, not after 1 s
        try { reply = await this.diag.physical(BDC, 0x2e, w.frame, 1500, echo(0x2e, w.frame), { retryBaseMs: 20, maxRetries: 10 }); } catch (e) { this.error = String(e && e.message || e); }
        const now = this._answerAt = this.now();
        if (reply && reply[0] === 0x6e) {
            this._fails = 0; this._refused[w.bus] = 0; this.writes++; this._times.push(now);
            this.rtt = this.rtt ? Math.round(this.rtt * 0.8 + (now - t) * 0.2) : now - t;
            w.lights.forEach((l) => {
                if (w.off) this._last.delete(l);
                else this._last.set(l, { rgb: w.want.rgb, bright: w.want.bright, at: now });
            });
            // one light written: the bus's lights no longer all show the same
            if (w.nad !== ALL) this._last.delete(this._whole[w.bus]);
            const news = !this._reached || this._dead || this.error;
            this._reached = true; this._dead = false; this.error = null;
            if (news) { this._setState(); this.emit('change'); }
            return true;
        }
        // a bus not yet known to be there, refused as out of range: this car has no such bus
        if (reply && reply[2] === NO_SUCH && this.bus[w.bus] === 'unknown' && ++this._refused[w.bus] >= REFUSALS) {
            this.log.info('lights: no bus ' + (w.bus + 1) + ' in this car');
            this.bus[w.bus] = 'absent'; this._frame = null;
            this._setState(); this.emit('change');
            return false;
        }
        if (w.off) this._release.push({ bus: w.bus });
        this.error = reply ? 'the body module refused (' + (reply[2] || 0).toString(16) + ')' : this.error || 'no answer from the body module';
        if (++this._fails >= FAILS) {
            this.log.warn('lights: ' + this.error + ', pausing');
            this._fails = 0; this._pauseTill = this.now() + PAUSE_MS;
            this._last.clear();
            if (!this._reached) this._dead = true;
            this._setState(); this.emit('change');
        }
        return false;
    }

    _wake(ms) { this._timer = this.setTimer(() => this._kick(), ms); }

    _kick() {
        if (this._running || this._stopped) return;
        this.clearTimer(this._timer); this._timer = null;
        this._run().catch((e) => this.log.warn('lights: ' + e));
    }

    async _run() {
        this._running = true;
        try {
            for (;;) {
                if (this._stopped) return;
                const wait = Math.max(this._pauseTill - this.now(), this._rest());
                if (wait > 0) { this._wake(wait); return; }
                // the status read: a still colour is written first, a moving one frozen for it
                const still = !!this.scene && !S.moves(this.scene);
                if (this._wantFind && !this._release.length && !still) { await this._read(); continue; }
                if (this._secondAt && this.now() >= this._secondAt && !this._release.length) {
                    // the second chance: giving back once more, or the still colour once more
                    this._secondAt = 0;
                    if (this._secondOff) { this._release = this._secondOff.map((bus) => ({ bus })); this._secondOff = null; }
                    else { this._last.clear(); this._frame = null; }
                    continue;
                }
                const w = this._next();
                if (!w) {
                    if (this._wantFind) { await this._read(); continue; }
                    if (this._seconds > 0 && !this._secondAt) { this._seconds--; this._secondAt = this.now() + SECOND_MS; }
                    // nothing due: a moving scene looks again soon, a still one when its next renewal is due
                    const moving = S.moves(this.scene) || !!(this._flash && this.now() < this._flash.until);
                    const next = this._secondAt ? Math.max(20, this._secondAt - this.now()) : moving ? IDLE_MS : 1000;
                    if (this.scene || moving || this._secondAt) this._wake(next);
                    return;
                }
                await this._send(w);
            }
        } finally { this._running = false; }
    }
}

module.exports = { Lights, HOLD_S, RENEW_MS, MOVE_HOLD_S, MOVE_RENEW_MS, GAP_MS, MIN_WRITE_MS, SECOND_MS, PAUSE_MS, FAILS };
