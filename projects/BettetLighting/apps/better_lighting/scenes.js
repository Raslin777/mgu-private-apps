'use strict';
/**
 * scenes.js - what each light shows at a moment. Pure: a scene and a light in, { rgb, bright } out.
 * Based on the app kit's ambient_config/scenes.js (MIT, cauliflowermossgrape/idrive7-apps); the pulse and the
 * rainbow's colour list are the owner's Android effects (BMWCOLOR AmbientEngine: runPulse, runRainbow), written
 * here by the clock instead of by step count, so a slow link skips steps instead of stretching the effect.
 *
 * A scene: { kind, upper: { rgb, bright }, lower: { rgb, bright }, speed, palette }
 *   solid       upper and lower lights each their own colour (the same colour for both: one colour)
 *   breathing   the colour slowly brighter and dimmer (a smooth swell)
 *   pulse       the colour's brightness straight up from 3 % to full and straight down again
 *   rainbow     the whole cabin through every colour; with a palette of two or more colours, from one to the next
 *   fade        slowly from the upper colour to the lower one and back
 *   wave        a band of colour moving from the dash to the rear (a write for each light: the slow one)
 *   welcome     a sweep of the colour from the dash to the rear, once (then solid)
 *   sportpulse  red for 1.5 s, then the colour (Sport picked), once
 * speed: 1 slow, 2 normal, 3 fast.
 */
const KINDS = ['solid', 'breathing', 'pulse', 'rainbow', 'fade', 'wave'];
const ONCE = { welcome: 2600, sportpulse: 2000 };
const NAMES = { solid: 'Solid', breathing: 'Breathe', pulse: 'Pulse', rainbow: 'Rainbow', fade: 'Smooth fade', wave: 'Colour wave',
    welcome: 'Welcome sweep', sportpulse: 'Sport pulse' };
const PERIOD = { 1: 1.6, 2: 1, 3: 0.55 };      // x the base time of each animation
const BREATHE_MS = 4000, PULSE_MS = 2200, RAINBOW_MS = 12000, LEG_MS = 3000, FADE_MS = 8000, WAVE_MS = 5000;
const PULSE_MIN = 3;                           // per cent, the Android pulse's floor

function hsv(h, s, v) {
    const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}
function hueOf(rgb) {
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
}
/** A hue picked on the ring: within 5 degrees of red, yellow, green, cyan, blue or magenta, exactly that one. */
function snapHue(h) {
    const s = (Math.round(h / 60) * 60) % 360;
    return Math.abs(((h - s + 540) % 360) - 180) <= 5 ? s : (h + 360) % 360;
}
/** The < / > buttons: the next multiple of 15 degrees (d +-15), so red, green and blue come up exactly. */
const stepHue = (h, d) => ((Math.round((h + d) / 15) * 15) % 360 + 360) % 360;
const mix = (a, b, f) => a.map((x, i) => Math.round(x + (b[i] - x) * f));
const hex = (rgb) => '#' + rgb.map((x) => ('0' + Math.max(0, Math.min(255, x | 0)).toString(16)).slice(-2)).join('');

/** The time a once-only scene lasts (ms), 0 for one that runs on. */
const lasts = (scene) => ONCE[scene && scene.kind] || 0;
/** Whether a scene moves (the lights are written over and over). */
const moves = (scene) => !!scene && scene.kind !== 'solid';
const colours = (scene) => (Array.isArray(scene.palette) ? scene.palette.filter((c) => Array.isArray(c) && c.length === 3) : []);
const alike = (a, b) => !!a && !!b && a.bright === b.bright && a.rgb.join() === b.rgb.join();
/**
 * Whether every light shows the same thing at every moment: such a scene needs no list of the car's lights and one
 * write for each bus (to all its lights at once) for each step.
 */
function uniform(scene) {
    if (!scene) return false;
    if (scene.kind === 'rainbow' || scene.kind === 'fade') return true;
    if (scene.kind === 'wave' || scene.kind === 'welcome') return false;
    return alike(scene.upper, scene.lower || scene.upper);
}

/** What a light shows: the scene, the light ({ part, y }), t ms since the scene started. */
function lightAt(scene, light, t) {
    const own = scene[light.part === 'upper' ? 'upper' : 'lower'] || scene.upper;
    const base = scene.upper, k = PERIOD[scene.speed] || 1;
    switch (scene.kind) {
    case 'breathing': {
        const f = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / (BREATHE_MS * k));
        return { rgb: own.rgb, bright: Math.round(own.bright * (0.12 + 0.88 * f)) };
    }
    case 'pulse': {
        // straight up, straight down: 0 at the start of a period, 1 in its middle
        const p = (t / (PULSE_MS * k)) % 1, f = p < 0.5 ? p * 2 : 2 - p * 2, top = Math.max(own.bright, PULSE_MIN * 2);
        return { rgb: own.rgb, bright: Math.round(PULSE_MIN + (top - PULSE_MIN) * f) };
    }
    case 'rainbow': {
        const list = colours(scene);
        if (list.length === 1) return { rgb: list[0], bright: base.bright };
        if (list.length > 1) {
            const x = t / (LEG_MS * k), i = Math.floor(x) % list.length;
            return { rgb: mix(list[i], list[(i + 1) % list.length], x - Math.floor(x)), bright: base.bright };
        }
        return { rgb: hsv((t / (RAINBOW_MS * k) * 360) % 360, 1, 1), bright: base.bright };
    }
    case 'fade': {
        const f = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / (FADE_MS * k));
        return { rgb: mix(scene.upper.rgb, scene.lower.rgb, f), bright: Math.round(scene.upper.bright + (scene.lower.bright - scene.upper.bright) * f) };
    }
    case 'wave': {
        // the base colour's hue, a band 120 degrees wide travelling to the rear
        const h = hueOf(base.rgb) + 60 * Math.sin(2 * Math.PI * (t / (WAVE_MS * k) - light.y));
        return { rgb: hsv((h + 360) % 360, 1, 1), bright: base.bright };
    }
    case 'welcome': {
        // the lights come on from the dash to the rear
        const front = t / ONCE.welcome * 1.4 - 0.2, f = Math.max(0, Math.min(1, (front - light.y) / 0.2));
        return { rgb: own.rgb, bright: Math.round(own.bright * f) };
    }
    case 'sportpulse':
        return t < 1500 ? { rgb: [255, 0, 0], bright: 100 } : own;
    default:
        return own;
    }
}

module.exports = { KINDS, NAMES, PERIOD, BREATHE_MS, PULSE_MS, RAINBOW_MS, LEG_MS, PULSE_MIN,
    lightAt, lasts, moves, uniform, hsv, hueOf, snapHue, stepHue, hex, mix };
