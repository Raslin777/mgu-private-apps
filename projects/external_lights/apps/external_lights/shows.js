'use strict';
/**
 * shows.js - light shows: which lamp comes on when, and for how long. Pure.
 *
 * A show: { key, name, period (ms), events: [{ t (ms from the start of a round), lamp (lamps.js key), ms (on) }] }.
 * It repeats every period. One request switches one lamp on for its time (the lamp goes off by itself), and the
 * link takes one request at a time, so events are at least STEP_MS apart: a show is lamps coming on one after
 * the other, never many in the same instant. Lamps that glare (high beam, rear fog) are only in a show when
 * asked for (opts.glare).
 */
const { lamp } = require('./lamps');

const STEP_MS = 300;

/** Lamps one after the other, each on for onMs, STEP_MS apart, then a rest. */
function chain(keys, onMs, rest) {
    const events = keys.map((k, i) => ({ t: i * STEP_MS, lamp: k, ms: onMs }));
    return { events, period: keys.length * STEP_MS + (rest || 0) };
}

const SHOWS = [
    { key: 'chase', name: 'Front to rear', make: (o) => chain(['drl', 'low'].concat(o.glare ? ['high'] : [], ['side', 'turnL', 'turnR', 'brake', 'reverse']), 450, 300) },
    { key: 'ends', name: 'Front and rear in turn', make: () => ({ period: 1400, events: [{ t: 0, lamp: 'drl', ms: 500 }, { t: 700, lamp: 'brake', ms: 500 }] }) },
    { key: 'sides', name: 'Left and right in turn', make: () => ({ period: 1200, events: [{ t: 0, lamp: 'turnL', ms: 450 }, { t: 600, lamp: 'turnR', ms: 450 }] }) },
    { key: 'heart', name: 'Heartbeat', make: () => ({ period: 2000, events: [{ t: 0, lamp: 'brake', ms: 150 }, { t: 300, lamp: 'brake', ms: 250 }, { t: 1000, lamp: 'drl', ms: 150 }, { t: 1300, lamp: 'drl', ms: 250 }] }) },
    { key: 'strobe', name: 'Strobe', make: (o) => ({ period: 600, events: [{ t: 0, lamp: o.glare ? 'high' : 'drl', ms: 120 }, { t: 300, lamp: 'drl', ms: 120 }] }) },
];

/** The show with that key (the first one for an unknown key), built for opts { glare }. */
function show(key, opts) {
    const s = SHOWS.find((x) => x.key === key) || SHOWS[0], made = s.make(opts || {});
    made.events.forEach((e) => { if (!lamp(e.lamp)) throw new Error(s.key + ': no such lamp ' + e.lamp); });
    return { key: s.key, name: s.name, period: made.period, events: made.events.slice().sort((a, b) => a.t - b.t) };
}

const keys = () => SHOWS.map((s) => s.key);
const next = (key) => { const k = keys(); return k[(k.indexOf(key) + 1) % k.length]; };

module.exports = { STEP_MS, show, keys, next };
