'use strict';
// Asks the car's camera unit for one camera view and keeps track of whether it
// gave it. All access to the car goes through `io` (icam.js on the head unit,
// a fake in the tests):
//
//   io.attach()            -> Promise<cookie>   register as a client
//   io.change(cookie, v)   -> Promise           ask for view v
//   io.state()             -> Promise<{ application, mode, perspective } | null>
//   io.detach(cookie)      -> Promise           give the cameras back
//
// The view numbers and the "Drive Recorder" mode they are asked in come from
// what the community Drive Recorder and Turn View apps do on other cars (see
// README, "Camera"). Whether this car's camera unit accepts them is unverified.
const EventEmitter = require('events');

const VIEWS = { off: 0, front: 1, rear: 2 };
const CHECK_MS = 2000;    // how long the camera unit gets before its state is read
const WATCH_MS = 5000;    // how often a view that is on is read again
const TRIES = 3;          // asks per selection before giving up

const DR = /^(DR_ACTIVE|51)$/;
// Views the car shows by itself (reversing, parking, off-road). They own the cameras.
const PARKING = /^(TOPREARVIEW|SIDEVIEW|RFK|OFFROAD|REMOTE360|1|2|3|20|60)$/;

function describe(s) {
    if (!s || typeof s !== 'object') return 'no answer';
    return s.application + '/' + s.mode + '/' + s.perspective;
}
function applied(s, view) {
    return !!s && typeof s === 'object' && DR.test(String(s.application)) && Number(s.perspective) === view;
}
function parking(s) {
    return !!s && typeof s === 'object' && PARKING.test(String(s.application));
}
function message(e) { return String((e && e.message) || e).slice(0, 100); }

class Camera extends EventEmitter {
    constructor(options) {
        super();
        this.io = options.io;
        this.log = options.log || function () {};
        this.setTimer = options.setTimer || setTimeout;
        this.clearTimer = options.clearTimer || clearTimeout;
        this.want = VIEWS.off;
        this.state = 'off';          // off | asking | on | paused | refused | releasing
        this.text = 'Not asked for';
        this.cookie = null;
        this.stream = '';            // the picture's size, as the camera service reports it
        this.tries = 0;
        this.timer = null;
        this.run = 0;                // changes with every selection: late answers of an older one are dropped
        this.work = Promise.resolve();   // attach / detach never overlap
    }

    status() { return { want: this.want, state: this.state, text: this.text, stream: this.stream }; }

    _set(state, text) {
        if (state === this.state && text === this.text) return;
        this.state = state; this.text = text;
        this.log('camera: ' + state + ' (' + text + ')');
        this.emit('change', this.status());
    }

    _later(fn, ms) {
        const run = this.run;
        if (this.timer) this.clearTimer(this.timer);
        this.timer = this.setTimer(() => { this.timer = null; return run === this.run ? fn() : undefined; }, ms);
    }

    // view: VIEWS.front, VIEWS.rear or VIEWS.off. Returns a promise that settles
    // when the request (or the release) has been sent.
    select(view) {
        if (view !== VIEWS.front && view !== VIEWS.rear) view = VIEWS.off;
        this.run++;
        if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
        this.want = view;
        this.tries = 0;
        if (view === VIEWS.off) return this._release();
        return this._ask();
    }

    _queue(fn) {
        const next = this.work.then(fn, fn);
        this.work = next.catch(() => {});
        return next;
    }

    _ask() {
        const run = this.run, view = this.want;
        this.tries++;
        this._set('asking', 'Asking the camera unit (' + this.tries + ' of ' + TRIES + ')');
        return this._queue(() => {
            if (run !== this.run) return null;
            const attached = this.cookie !== null ? Promise.resolve(this.cookie)
                : Promise.resolve().then(() => this.io.attach()).then((cookie) => { this.cookie = cookie; return cookie; });
            return attached.then((cookie) => {
                // Selected again or switched off while attaching: that selection's own step follows.
                if (run !== this.run) return null;
                return this.io.change(cookie, view);
            });
        }).then(() => {
            if (run === this.run) this._later(() => this._check(), CHECK_MS);
        }, (e) => {
            if (run !== this.run) return;
            // A failed request may have failed after the attach: the cookie is kept and reused.
            this.log('camera: request failed: ' + message(e));
            if (this.tries < TRIES) this._later(() => this._ask(), CHECK_MS);
            else this._set('refused', 'The camera unit did not take the request: ' + message(e));
        });
    }

    _check() {
        const run = this.run, view = this.want;
        return Promise.resolve().then(() => this.io.state()).catch(() => null).then((s) => {
            if (run !== this.run) return;
            if (applied(s, view)) {
                this.tries = 0;
                this._set('on', (view === VIEWS.front ? 'Front' : 'Rear') + ' camera view is on');
                this._later(() => this._check(), WATCH_MS);
                return this._size(run);
            } else if (parking(s)) {
                // The car's own view has the cameras. Never fight it: wait, then ask again.
                this.tries = 0;
                this._set('paused', 'A parking view has the cameras');
                this._later(() => this._check(), WATCH_MS);
            } else if (this.state === 'paused' || this.tries < TRIES) {
                return this._ask();
            } else {
                this._set('refused', 'View not given (camera unit: ' + describe(s) + ')');
            }
            return null;
        });
    }

    _size(run) {
        if (!this.io.info) return null;
        return Promise.resolve().then(() => this.io.info()).catch(() => null).then((i) => {
            if (run !== this.run || !i || !(i.imageWidth > 0 && i.imageHeight > 0)) return;
            const text = i.imageWidth + ' x ' + i.imageHeight + (i.framesPerSecond > 0 ? ', ' + i.framesPerSecond + ' a second' : '');
            if (text === this.stream) return;
            this.stream = text;
            this.log('camera: stream ' + text);
            this.emit('change', this.status());
        });
    }

    _release() {
        const run = this.run;
        if (this.cookie === null && this.state === 'off') return Promise.resolve();
        this._set('releasing', 'Giving the cameras back');
        return this._queue(() => {
            if (this.cookie === null) return null;
            const cookie = this.cookie;
            return Promise.resolve().then(() => this.io.detach(cookie))
                .then(() => { this.cookie = null; }, (e) => { this.log('camera: release failed: ' + message(e)); });
        }).then(() => {
            if (run !== this.run) return;
            this._set('off', this.cookie === null ? 'Not asked for' : 'Release failed; the camera unit may still be in its recorder mode');
        });
    }
}

module.exports = { Camera, VIEWS, CHECK_MS, WATCH_MS, TRIES, applied, parking, describe };
