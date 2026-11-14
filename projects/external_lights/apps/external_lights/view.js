'use strict';
/**
 * view.js - the screen: the car from above (its front to the left) with the lamps that are on, and what the app
 * is doing. Pure: a canvas and a state in.
 *
 *   draw(cv, t, s)   t: the theme's colours { bg, text, dim, warn, accent }
 *   s: { lit: [lamp keys], show, state, reason, lamp (the one picked for a test), moving, speed, rtt, writes,
 *        skipped, refused: [lamp names], link (false: no diagnostic link) }
 */
const { lamp } = require('./lamps');

const CAR = { x: 70, y: 150, w: 620, h: 250 };
const AMBER = '#ffb000', RED = '#ff2a2a', WHITE = '#ffffff';
const COLOUR = { turnL: AMBER, turnR: AMBER, hazard: AMBER, parkL: AMBER, parkR: AMBER, brake: RED, fogR: RED, reverse: WHITE };
const SPOTS = {
    front: [[CAR.x + 14, CAR.y + 44], [CAR.x + 14, CAR.y + CAR.h - 44]],
    rear: [[CAR.x + CAR.w - 14, CAR.y + 44], [CAR.x + CAR.w - 14, CAR.y + CAR.h - 44]],
    left: [[CAR.x + 50, CAR.y + 8], [CAR.x + CAR.w - 50, CAR.y + 8]],
    right: [[CAR.x + 50, CAR.y + CAR.h - 8], [CAR.x + CAR.w - 50, CAR.y + CAR.h - 8]],
};
SPOTS.both = SPOTS.left.concat(SPOTS.right);

/** What the top line says. */
function headline(s) {
    if (s.link === false) return { text: 'No diagnostic link to the car', warn: true };
    if (s.moving) return { text: 'Only while the car stands', warn: true };
    if (s.state === 'playing') return { text: 'Playing: ' + s.show, warn: false };
    if (s.state === 'stopping') return { text: 'Switching the lamps off', warn: false };
    if (s.reason && s.reason !== 'Stopped') return { text: s.reason, warn: true };
    return { text: 'Ready: ' + s.show, warn: false };
}

function draw(cv, t, s) {
    cv.clear(t.bg);
    cv.text('In the car', 44, 90, 30, t.text, { font: 'bold' });
    cv.roundRect(CAR.x, CAR.y, CAR.w, CAR.h, 70, '#2a2f37');
    cv.roundRect(CAR.x + 150, CAR.y + 34, 330, CAR.h - 68, 40, '#11151b');
    cv.text('front', CAR.x - 4, CAR.y + CAR.h + 44, 18, t.dim);
    cv.text('rear', CAR.x + CAR.w - 34, CAR.y + CAR.h + 44, 18, t.dim);
    (s.lit || []).forEach((key) => {
        const l = lamp(key);
        if (!l) return;
        SPOTS[l.where].forEach((p) => cv.roundRect(p[0] - 16, p[1] - 16, 32, 32, 16, COLOUR[key] || WHITE));
    });

    const x = 800, top = headline(s);
    cv.text(top.text, x, 104, 34, top.warn ? t.warn : t.text, { font: 'bold' });
    cv.text('Show: ' + s.show, x, 168, 26, t.text);
    cv.text('Lamp for a test: ' + (s.lamp || '-'), x, 208, 26, t.text);
    const lines = [];
    if (s.speed != null) lines.push('Speed ' + Math.round(s.speed) + ' km/h');
    if (s.rtt) lines.push(s.rtt + ' ms a request, ' + s.writes + ' sent' + (s.skipped ? ', ' + s.skipped + ' left out (link too slow)' : ''));
    if (s.refused && s.refused.length) lines.push('Not in this car: ' + s.refused.join(', '));
    lines.push('Not car-tested. Lamps go off by themselves when their time is over.');
    lines.forEach((line, i) => cv.text(line, x, 268 + i * 34, 20, t.dim));
    return top;
}

module.exports = { draw, headline, SPOTS };
