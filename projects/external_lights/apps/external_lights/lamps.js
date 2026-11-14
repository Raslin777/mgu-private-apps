'use strict';
/**
 * lamps.js - the exterior lamp functions of the body controller (BDC, address 0x40), and the one request that
 * switches one on for a time. Pure: a lamp and a time in, request bytes out.
 *
 * From the diagnostic description of the G11 body controller (ISTA, bdc_g11.prg; the same function is in bdc.prg,
 * bdc_g05.prg and bcp_sp21.prg):
 *
 *   LEUCHTEN_FUNKTION, 0xD542, services 22 and 2E: "Steuern der Lampenfunktion"
 *     ELEMENT  signed int (2 bytes, high byte first), a value of TAB_LAMPEN_FUNKTION
 *     ZEIT     signed int (2 bytes, high byte first), in units of 10 ms; 0 = off; at most 32767 (327 s),
 *              "as far as allowed for the lamp"
 *
 *   write  2E D5 42 | ELEMENT (2) | ZEIT (2)
 *
 * The lamp switches itself off when its time is over, so a flash is one request, not two. The byte order and
 * widths are read from the description's argument table, as for the interior light's DA5E, whose table matched a
 * capture of ISTA on the owner's car. This request itself was never captured and never sent to a car.
 *
 * TAB_LAMPEN_FUNKTION also has 0x13 interior light, 0x14 ambient light, 0x0D BFD / ESS (the emergency stop
 * signal) and 0x19 OVT. They are left out: the first two are not exterior, the other two are not for playing.
 */
const BDC = 0x40;
const DID = [0xd5, 0x42];
const MAX_MS = 10000;          // the longest one request may switch a lamp on (the car allows up to 327 s)

// key: [ELEMENT, name, where on the car picture: 'front' | 'rear' | 'left' | 'right' | 'both', glare]
const TABLE = {
    side: [0x01, 'Side lights', 'both'],
    low: [0x03, 'Low beam', 'front'],
    drl: [0x04, 'Daytime lights', 'front'],
    high: [0x05, 'High beam', 'front', true],
    turnL: [0x06, 'Indicator left', 'left'],
    turnR: [0x07, 'Indicator right', 'right'],
    fogF: [0x08, 'Front fog lights', 'front'],
    cornerL: [0x09, 'Cornering light left', 'left'],
    cornerR: [0x0a, 'Cornering light right', 'right'],
    brake: [0x0c, 'Brake lights', 'rear'],
    fogR: [0x0e, 'Rear fog light', 'rear', true],
    reverse: [0x0f, 'Reversing lights', 'rear'],
    parkL: [0x10, 'Parking light left', 'left'],
    parkR: [0x11, 'Parking light right', 'right'],
    hazard: [0x12, 'Hazard lights', 'both'],
    search: [0x15, 'Search light', 'both'],
    grille: [0x16, 'Lit grille', 'front'],
};
const LAMPS = Object.keys(TABLE).map((key) => ({ key, id: TABLE[key][0], name: TABLE[key][1], where: TABLE[key][2], glare: !!TABLE[key][3] }));
const BY_KEY = {};
LAMPS.forEach((l) => { BY_KEY[l.key] = l; });

const lamp = (key) => BY_KEY[key] || null;

/** The write that switches a lamp on for ms milliseconds (10 ms steps, 10 ms to MAX_MS). */
function onFrame(key, ms) {
    const l = lamp(key);
    if (!l) throw new Error('no such lamp: ' + key);
    const units = Math.max(1, Math.min(MAX_MS / 10, Math.round(ms / 10)));
    return DID.concat([0, l.id, units >> 8, units & 0xff]);
}

/** The write that switches a lamp off at once. */
function offFrame(key) {
    const l = lamp(key);
    if (!l) throw new Error('no such lamp: ' + key);
    return DID.concat([0, l.id, 0, 0]);
}

module.exports = { BDC, DID, MAX_MS, LAMPS, lamp, onFrame, offFrame };
