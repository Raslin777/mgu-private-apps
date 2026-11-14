'use strict';
// The request bytes (lin.js) and what each light shows at a moment (scenes.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../apps/better_lighting/lin');
const S = require('../apps/better_lighting/scenes');

const look = (kind, extra) => Object.assign({ kind, upper: { rgb: [255, 0, 0], bright: 80 }, lower: { rgb: [0, 0, 255], bright: 40 }, speed: 2 }, extra);
const up = { part: 'upper', y: 0.2 }, low = { part: 'lower', y: 0.8 };

test('colour write: DID of the bus, light, on, brightness, red, green, blue, seconds', () => {
    assert.deepEqual(L.writeFrame(0, 0, [10, 20, 30], 50, 5), [0xda, 0x5e, 0, 1, 50, 10, 20, 30, 5]);
    assert.deepEqual(L.writeFrame(1, 4, [10, 20, 30], 50, 60), [0xe3, 0xd1, 4, 1, 50, 10, 20, 30, 60]);
    // FF in a colour byte is not a colour (the kit: "no change"; the Android app: "invalid"): colours stop at FE
    assert.deepEqual(L.writeFrame(0, 3, [255, -4, 300], 120, 400), [0xda, 0x5e, 3, 1, 100, 0xfe, 0, 0xfe, 254]);
    assert.equal(L.writeFrame(0, 0, [1, 2, 3], 50, 0)[8], 1, 'never a hold of 0 s');
    assert.deepEqual(L.releaseFrame(1, 0), [0xe3, 0xd1, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(L.BDC, 0x40);
    assert.deepEqual(L.BUSES.map((b) => b.read.concat(b.write)), [[0xda, 0x5f, 0xda, 0x5e], [0xe3, 0xd1, 0xe3, 0xd1]]);
});

test('status reply: 26 records of 10 bytes, the place and part of each light', () => {
    const b = [0x62, 0xda, 0x5f];
    [0x0f, 0x0c].forEach((loc) => b.push(loc, 254, 60, 120, 100, 0, 0, 0, 0, 0));
    for (let i = 2; i < 26; i++) b.push(0xff, 0xff, 0xff, 0xff, 0x7f, 3, 7, 7, 7, 7);
    const got = L.parseStatus(0, b);
    assert.deepEqual(got.map((l) => [l.nad, l.part, l.name]), [[1, 'lower', 'Passenger front door pocket'], [2, 'upper', 'Passenger front door line']]);
    assert.deepEqual(got[0].rgb, [120, 60, 254]);
    assert.equal(L.parseStatus(0, [0x7f, 0x22, 0x31]), null);
    assert.equal(L.parseStatus(1, b), null, 'the reply of another bus');
});

test('breathe: a smooth swell between 12 % and the brightness of the look, 4 s at normal speed', () => {
    const at = (t, speed) => S.lightAt(look('breathing', { speed: speed || 2 }), up, t).bright;
    assert.equal(at(0), 10); assert.equal(at(2000), 80); assert.equal(at(4000), 10);
    assert.ok(at(1000) > at(500) && at(500) > at(0));
    assert.equal(at(2000 * 1.6, 1), 80, 'slow: 6.4 s');
    assert.equal(at(2000 * 0.55, 3), 80, 'fast: 2.2 s');
    assert.equal(S.lightAt(look('breathing'), low, 2000).bright, 40, 'the lower lights their own');
    assert.deepEqual(S.lightAt(look('breathing'), low, 700).rgb, [0, 0, 255]);
});

test('pulse: straight up from 3 % to the brightness of the look and straight down, 2.2 s at normal speed', () => {
    const at = (t) => S.lightAt(look('pulse'), up, t).bright;
    assert.equal(at(0), 3); assert.equal(at(1100), 80); assert.equal(at(2200), 3);
    assert.equal(at(550), Math.round(3 + 77 / 2), 'half way up at a quarter of the time');
    assert.equal(at(1650), at(550), 'and the same on the way down');
    assert.equal(S.lightAt(look('pulse', { upper: { rgb: [9, 9, 9], bright: 2 } }), up, 1100).bright, 6, 'a top of at least 6 %');
});

test('rainbow: every colour in 12 s, or from one colour of a list to the next in 3 s each', () => {
    const at = (t, extra) => S.lightAt(look('rainbow', extra), low, t);
    assert.deepEqual(at(0).rgb, [255, 0, 0]); assert.deepEqual(at(4000).rgb, [0, 255, 0]); assert.deepEqual(at(8000).rgb, [0, 0, 255]);
    assert.deepEqual(at(12000).rgb, at(0).rgb);
    assert.equal(at(5000).bright, 80, 'the upper brightness for every light');
    const pal = { palette: [[254, 0, 0], [0, 254, 0], [0, 0, 254]] };
    assert.deepEqual(at(0, pal).rgb, [254, 0, 0]); assert.deepEqual(at(1500, pal).rgb, [127, 127, 0]);
    assert.deepEqual(at(3000, pal).rgb, [0, 254, 0]); assert.deepEqual(at(7500, pal).rgb, [127, 0, 127], 'the last back to the first');
    assert.deepEqual(at(5000, { palette: [[1, 2, 3]] }).rgb, [1, 2, 3]);
    assert.deepEqual(at(4000, { palette: [] }).rgb, [0, 255, 0], 'an empty list: every colour');
});

test('which scenes every light shows alike (one write a bus) and which not', () => {
    const one = { lower: { rgb: [255, 0, 0], bright: 80 } };
    ['solid', 'breathing', 'pulse'].forEach((k) => { assert.equal(S.uniform(look(k, one)), true, k); assert.equal(S.uniform(look(k)), false, k + ' in two colours'); });
    assert.equal(S.uniform(look('rainbow')), true); assert.equal(S.uniform(look('fade')), true);
    assert.equal(S.uniform(look('wave', one)), false); assert.equal(S.uniform(look('welcome', one)), false);
    assert.ok(S.moves(look('pulse')) && !S.moves(look('solid')) && S.lasts(look('sportpulse')) === 2000 && S.lasts(look('pulse')) === 0);
    assert.deepEqual(S.KINDS, ['solid', 'breathing', 'pulse', 'rainbow', 'fade', 'wave']);
    S.KINDS.forEach((k) => assert.ok(S.NAMES[k]));
});

test('the other scenes of the kit are as they were', () => {
    assert.deepEqual(S.lightAt(look('fade'), up, 4000).rgb, [0, 0, 255]);
    assert.notDeepEqual(S.lightAt(look('wave'), { part: 'upper', y: 0 }, 0).rgb, S.lightAt(look('wave'), { part: 'upper', y: 0.25 }, 0).rgb);
    assert.equal(S.lightAt(look('welcome'), { part: 'upper', y: 0.9 }, 100).bright, 0);
    assert.deepEqual(S.lightAt(look('sportpulse'), low, 1000).rgb, [255, 0, 0]);
    assert.deepEqual(S.lightAt(look('sportpulse'), low, 1600).rgb, [0, 0, 255]);
    assert.deepEqual(S.hsv(S.snapHue(3), 1, 1), [255, 0, 0]); assert.equal(S.stepHue(345, 15), 0);
});
