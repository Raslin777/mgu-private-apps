'use strict';
/**
 * player.js - plays a light show (shows.js) on the car's exterior lamps (lamps.js) through the head unit's
 * diagnostic link to the body controller.
 *
 * Each event is one request that switches one lamp on for its time; the lamp goes off by itself. So nothing has
 * to be sent for a lamp to go dark, and if the app, the link or the car stops answering, every lamp is dark
 * again when its own time is over (at most 10 s, in the shows half a second).
 *
 * Rules:
 *   Production uses an explicit session/link interlock. Movement is warning-only.
 *   WATCH_MS is the scheduler's check interval, not a physical lamp shutoff guarantee.
 *   One request at a time, the answer awaited, GAP_MS rest after it, and never more than one request started
 *     each MIN_WRITE_MS (10 a second). These are the pacing rules of the Better Lighting app's driver.
 *   The show keeps its timing: an event the link could not send within LATE_MS of its moment is left out.
 *   A show ends by itself after maxMs.
 *   A lamp the car refuses as unknown (7F 2E 31) is left out from then on. Any other refusal, or three requests
 *     in a row without an answer, ends the show.
 *   Stopping sends "off" for each lamp that is still within its time.
 *
 *   const p = new Player({ diag, log, moving, maxMs });
 *   p.play(show) -> false when not allowed     p.flash(key, ms)     p.stop(reason)
 *   p.state -> 'idle' | 'playing' | 'stopping'   p.reason -> why it last ended   p.isLit(key)
 *   p.rtt -> ms from a request to its answer     p.writes  p.skipped  p.refused -> [lamp keys]
 */
const EventEmitter = require('events');
const { BDC, MAX_MS, lamp, onFrame, offFrame } = require('./lamps');

const GAP_MS = 20, MIN_WRITE_MS = 100, LATE_MS = 150, WATCH_MS = 250, FAILS = 3, MAX_SHOW_MS = 180000;
const NO_SUCH = 0x31;
const NRC = { 0x11: 'the body controller does not know this request', 0x13: 'the body controller refused the request\'s length',
    0x22: 'the car is not in a state for it (ignition on?)', 0x33: 'the body controller wants a security unlock',
    0x7e: 'not allowed in this diagnostic session', 0x7f: 'not allowed in this diagnostic session' };

const echo = (frame) => (u) => (u[0] === 0x6e && u[1] === frame[0] && u[2] === frame[1]) || (u[0] === 0x7f && u[1] === 0x2e);

class Player extends EventEmitter {
    constructor(o) {
        super();
        this.diag = o.diag; this.log = o.log; this.now = o.now || Date.now;
        this.setTimer = o.setTimer || setTimeout; this.clearTimer = o.clearTimer || clearTimeout;
        this.moving = o.moving || (() => false);
        this.maxMs = o.maxMs || (() => MAX_SHOW_MS);
        this.session = o.session || null;
        this.allowed = o.allowed || (() => this.moving() ? 'The car is moving' : null);
        this.prepared = false; this.closing = false;
        this.state = 'idle'; this.reason = null; this.show = null;
        this.lit = new Map();          // lamp key -> the moment its time is over
        this.held = new Map();         // includes uncertain writes, for cleanup only
        this.refused = [];
        this.writes = 0; this.skipped = 0; this.rtt = 0;
        this._t0 = 0; this._i = 0; this._round = 0; this._fails = 0;
        this._startAt = -1e9; this._answerAt = -1e9; this._running = false; this._timer = null;
    }

    isLit(key) { return (this.lit.get(key) || 0) > this.now(); }

    /** Starts a show. False (and .reason) when the car is moving. */
    play(show) {
        if (this.closing || this.state === 'preparing' || this.state === 'stopping') return false;
        if (this.session) this.session.cancelled = false;
        const why = this.allowed();
        if (why) { if (this.state !== 'idle') this.stop(why); else this._set('idle', why); return false; }
        if (!show || !show.events || !show.events.length) return false;
        if (show.events.some(e => !lamp(e.lamp) || lamp(e.lamp).experimental)) { this.reason = 'Experimental lamps disabled'; return false; }
        this.show = show; this._t0 = this.now(); this._i = 0; this._round = 0; this._fails = 0; this.skipped = 0;
        this._set(this.session && !this.prepared ? 'preparing' : 'playing', null);
        this._kick();
        return true;
    }

    /** One lamp on for ms, once. */
    flash(key, ms) {
        if (!lamp(key) || lamp(key).experimental || !Number.isFinite(ms) || ms <= 0) return false;
        return this.play({ key: 'flash', name: lamp(key).name, once: true, period: Math.min(MAX_MS, ms) + 100, events: [{ t: 0, lamp: key, ms: Math.min(MAX_MS, ms) }] });
    }

    /** Ends the show; its lamps that are still within their time are switched off. */
    stop(reason) {
        if (this.state === 'idle') return;
        if (this.session) this.session.cancelled = true;
        this._set('stopping', reason || null);
        this._kick();
    }

    /** Forgets what the car refused (after a change to the car, or to try again). */
    forget() { this.refused = []; }

    _set(state, reason) { this.state = state; this.reason = reason; this.emit('change'); }

    _rest() { return Math.max(this._answerAt + GAP_MS, this._startAt + MIN_WRITE_MS) - this.now(); }
    _wake(ms) { this._timer = this.setTimer(() => this._kick(), Math.max(1, ms)); }
    _kick() {
        if (this._running) return;
        this.clearTimer(this._timer); this._timer = null;
        this._run().catch((e) => { this.log.warn('lights: ' + e); this.lit.clear(); this._set('idle', String(e && e.message || e)); });
    }

    /** One request, its answer awaited: the reply bytes, or null. */
    async _write(frame, cleanup) {
        let reply = null;
        const t = this._startAt = this.now();
        try {
            if (this.session) reply = await this.session.write(frame, cleanup);
            else reply = await this.diag.physical(BDC, 0x2e, frame, 1500, echo(frame), { maxRetries: 0 });
        } catch (e) { this.log.warn('lights: ' + (e && e.message || e)); this.reason = e.message; }
        const now = this._answerAt = this.now();
        if (reply && reply[0] === 0x6e) { this.writes++; this.rtt = this.rtt ? Math.round(this.rtt * 0.8 + (now - t) * 0.2) : now - t; }
        return reply;
    }

    /** The show cannot go on. Nothing is sent: each lamp goes dark when its own time is over. */
    _fail(reason) { this.log.warn('lights: ' + reason); this._set('idle', reason); }

    async _run() {
        this._running = true;
        try {
            for (;;) {
                if (this.state === 'idle') return;
                if (this.state === 'preparing') {
                    try { await this.session.open(); }
                    catch (e) { this._set('idle', e.message); return; }
                    if (this.state !== 'preparing') continue;
                    const why = this.allowed();
                    if (why) { this._set('stopping', why); continue; }
                    this.prepared = true; this._t0 = this.now(); this._set('playing', null);
                }
                const rest = this._rest();
                if (rest > 0) { this._wake(rest); return; }
                if (this.state === 'stopping') {
                    let key = null;
                    this.held.forEach((until, k) => { if (!key && until > this.now()) key = k; });
                    if (!key) { this.lit.clear(); this._set('idle', this.reason); return; }
                    this.lit.delete(key);
                    this.held.delete(key);
                    await this._write(offFrame(key), true);
                    continue;
                }
                const why = this.allowed();
                if (why) { this._set('stopping', why); continue; }
                if (this.session && this.session.due()) {
                    try { await this.session.keep(); } catch (e) { this._set('stopping', e.message); }
                    continue;
                }
                if (this.now() - this._t0 > this.maxMs()) { this._set('stopping', 'Time is up'); continue; }
                const show = this.show, ev = show.events[this._i], due = this._t0 + this._round * show.period + ev.t;
                // waiting for an event's moment, the car is looked at every WATCH_MS: driving off is not left until the next event
                if (this.now() < due) { this._wake(Math.min(due - this.now(), WATCH_MS)); return; }
                if (++this._i >= show.events.length) { this._i = 0; this._round++; }
                const last = show.once && this._round > 0;
                if (this.refused.indexOf(ev.lamp) >= 0) {
                    if (show.events.every((e) => this.refused.indexOf(e.lamp) >= 0)) { this._fail('The car has none of these lamps'); return; }
                } else if (this.now() - due > LATE_MS) this.skipped++;
                else {
                    // Track an uncertain activation too: a lost reply does not prove no write occurred.
                    this.held.set(ev.lamp, this.now() + ev.ms + 2000);
                    const reply = await this._write(onFrame(ev.lamp, ev.ms));
                    if (reply && reply[0] === 0x6e) { this._fails = 0; this.lit.set(ev.lamp, this.now() + ev.ms); this.held.set(ev.lamp, this.now() + ev.ms); this.emit('change'); }
                    else if (reply && reply[2] === NO_SUCH) { this.refused.push(ev.lamp); this.log.info('lights: the car refused ' + lamp(ev.lamp).name); this.emit('change'); }
                    else if (reply) { this._fail('Refused: ' + (NRC[reply[2]] || 'code ' + (reply[2] || 0).toString(16))); return; }
                    else { this._fail(this.reason || 'No answer from the body controller'); return; }
                }
                if (last && this.state === 'playing') { this._set('idle', null); return; }
            }
        } finally {
            if (this.state === 'idle' && this.session) {
                this.closing = true;
                // A timed request can have succeeded even if its reply was lost.
                for (const key of this.held.keys()) {
                    if (this.held.get(key) > this.now()) await this._write(offFrame(key), true);
                }
                await this.session.close();
                if (this.session.cleanupFailed) this.reason = 'Cleanup not confirmed; verify lamps and cycle ignition';
                this.prepared = false; this.closing = false; this.lit.clear(); this.held.clear(); this.emit('change');
            }
            this._running = false;
        }
    }
}

module.exports = { Player, GAP_MS, MIN_WRITE_MS, LATE_MS, FAILS, MAX_SHOW_MS };
