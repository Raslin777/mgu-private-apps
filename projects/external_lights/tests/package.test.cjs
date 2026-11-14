'use strict';
// The manifest, what the app asks of the head unit, the facts read from ISTA's description, and the Store package.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const L = require('../apps/external_lights/lamps');

const root = path.join(__dirname, '..');
const app = path.join(root, 'apps', 'external_lights');
const manifest = JSON.parse(fs.readFileSync(path.join(app, 'app.json'), 'utf8'));
const TASU = 'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu';
const SPEED = 'de.bmw.infotainment.vehicle.Vehicle2';

// TAB_LAMPEN_FUNKTION as read from C:\EC-APPS\ISTA\Ecu\bdc_g11.prg on 2026-11-14 (value: the description's text).
// ISTA's files are not in this repository; set EXTERNAL_LIGHTS_PRG to bdc_g11.prg to check against the file.
const FROM_DESCRIPTION = { 0x01: 'Standlicht', 0x03: 'Abblendlicht', 0x04: 'Tagfahrlicht', 0x05: 'Fernlicht', 0x06: 'Blinker links',
    0x07: 'Blinker rechts', 0x08: 'Nebellicht vorne', 0x09: 'Abbiegelicht vorne links', 0x0a: 'Abbiegelicht vorne rechts', 0x0c: 'Bremslicht',
    0x0e: 'Nebelschlusslicht', 0x0f: 'ckfahrlicht', 0x10: 'Parklicht links', 0x11: 'Parklicht rechts', 0x12: 'Warnblinken',
    0x15: 'Such- und Funktionslicht', 0x16: 'beleuchteter K' };

test('manifest: its own id, the version of package.json, not started with the platform', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.id, 'external_lights');
    assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.loggingId.length, 4);
    assert.equal(manifest.autostart, undefined, 'the lamps are only driven while the app is open');
    assert.match(manifest.description, /Only while the car stands\. Not car-tested/);
    assert.deepEqual(manifest.screens[0].buttons.map((b) => b[0]), ['BTN_START', 'BTN_STOP', 'BTN_SHOW', 'BTN_LAMP', 'BTN_FLASH']);
    assert.equal(manifest.settings.find((s) => s.key === 'glare').default, false);
});

test('the app asks for the diagnostic link and the car\'s speed, nothing else', () => {
    assert.deepEqual(Object.keys(manifest.signals).sort(), [TASU, SPEED].sort());
    assert.equal(manifest.signals[TASU]._instances, 'SystemFunctionsInternalTasuInst1');
    assert.deepEqual(manifest.signals[TASU]._methods, ['sendTasuRequest']);
    assert.deepEqual(manifest.signals[TASU]._broadcasts, ['sendTasuResponse']);
    assert.deepEqual(Object.keys(manifest.signals[SPEED]), ['statusCarSpeed2']);
});

const catalog = process.env.EXTERNAL_LIGHTS_CATALOG;
test('the head unit\'s catalog file itself', { skip: !catalog && 'set EXTERNAL_LIGHTS_CATALOG to a someip-interfaces.json to run' }, () => {
    const c = JSON.parse(fs.readFileSync(catalog, 'utf8'));
    assert.ok(c.interfaces[TASU].methods.sendTasuRequest && c.interfaces[TASU].events.sendTasuResponse);
    assert.ok('SystemFunctionsInternalTasuInst1' in c.instanceIDs[TASU]);
    assert.ok(c.interfaces[SPEED].fields.statusCarSpeed2.getter);
    assert.ok('1' in c.instanceIDs[SPEED]);
});

test('every lamp of the app is a value of the description\'s table', () => {
    L.LAMPS.forEach((l) => assert.ok(FROM_DESCRIPTION[l.id], l.key + ' ' + l.id));
    assert.deepEqual(L.DID, [0xd5, 0x42]);
});

const prg = process.env.EXTERNAL_LIGHTS_PRG;
test('ISTA\'s description file itself', { skip: !prg && 'set EXTERNAL_LIGHTS_PRG to bdc_g11.prg to run' }, () => {
    const d = Buffer.from(fs.readFileSync(prg).map((b) => b ^ 0xf7)).toString('latin1');
    const fn = d.indexOf('LEUCHTEN_FUNKTION\0' + '0xD542\0');
    assert.ok(fn > 0, 'LEUCHTEN_FUNKTION is 0xD542');
    assert.match(d.slice(fn, fn + 400), /\x0022;2E\0ARG_0xD542_D\0/, 'services 22 and 2E, with an argument table');
    // the argument table: ELEMENT then ZEIT, both "signed int" (two bytes), high byte first
    const arg = d.indexOf('ELEMENT\x000-n\0high\0signed int\0-\0TAB_LAMPEN_FUNKTION\0');
    assert.ok(arg > 0, 'ELEMENT: signed int, high, TAB_LAMPEN_FUNKTION');
    // ZEIT: not scaled (x 1.0), and the last argument: the next table's heading follows it
    assert.match(d.slice(arg, arg + 400),
        /\0ZEIT\0ms\0high\0signed int\0-\0-\x001\.0\x001\.0\x000\.0\x000\.0\0-\0Angabe der Zeit in 10ms {2}0: aus {2}max\. 32767: 327sec[^\0]*\0ARG\0EINHEIT\0/);
    // the table's rows: "0xNN\0<text>\0"
    Object.keys(FROM_DESCRIPTION).forEach((id) => {
        const row = '0x' + ('0' + Number(id).toString(16).toUpperCase()).slice(-2) + '\0';
        const text = FROM_DESCRIPTION[id];
        assert.ok(d.includes(row + text) || new RegExp(row.replace('\0', '\\0') + '[^\\0]{0,3}' + text).test(d), 'row ' + row + text);
    });
});

test('sources: one diagnostic call (2E to the body controller), no SDK, no network or process use', () => {
    const files = fs.readdirSync(app).filter((f) => f.endsWith('.js'));
    assert.deepEqual(files.sort(), ['lamps.js', 'main.js', 'player.js', 'shows.js', 'view.js']);
    let calls = [];
    files.forEach((f) => {
        const s = fs.readFileSync(path.join(app, f), 'utf8');
        assert.ok(!/oap-sdk/.test(s), f + ' names the SDK');
        assert.ok(!/require\(['"](net|http|https|dgram|child_process|tls|fs)['"]\)/.test(s), f + ' opens a socket, a process or a file');
        calls = calls.concat(s.match(/diag\.(physical|functional|send)\([^)]*/g) || []);
    });
    assert.deepEqual(calls, ['diag.physical(BDC, 0x2e, frame, 1500, echo(frame'], 'no session change, no other service, no other unit');
});

/** The entries of a .tgz (ustar). */
function entries(tgz) {
    const raw = zlib.gunzipSync(fs.readFileSync(tgz)), out = [];
    for (let at = 0; at + 512 <= raw.length;) {
        const name = raw.slice(at, at + 100).toString('utf8').replace(/\0.*$/, '');
        if (!name) break;
        const prefix = raw.slice(at + 345, at + 500).toString('utf8').replace(/\0.*$/, '');
        const size = parseInt(raw.slice(at + 124, at + 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
        out.push({ name: prefix ? prefix + '/' + name : name, at: at + 512, size });
        at += 512 + Math.ceil(size / 512) * 512;
    }
    return { raw, out };
}

const tgz = path.join(root, 'dist', 'external_lights@' + manifest.version + '.tgz');
test('the Store package: the app\'s files as in apps/, the kit\'s licence, no SDK', { skip: !fs.existsSync(tgz) && 'not built (python tools/build.py)' }, () => {
    const { raw, out } = entries(tgz);
    const all = out.map((x) => x.name);
    ['package/package.json', 'package/manifest.json', 'package/LICENSE-app-kit', 'package/NOTICE.md', 'package/javascript/app.js',
        'package/javascript/kit/diag.js', 'package/javascript/kit/parked.js'].forEach((n) => assert.ok(all.includes(n), n));
    assert.ok(!all.some((n) => /oap-sdk|node_modules/.test(n)), 'the SDK is not packaged');
    ['lamps.js', 'player.js', 'shows.js', 'view.js'].forEach((f) => {
        const e = out.find((x) => x.name === 'package/javascript/' + f);
        assert.ok(e, f);
        assert.ok(raw.slice(e.at, e.at + e.size).equals(fs.readFileSync(path.join(app, f))), f + ' is the file in apps/ (build again)');
    });
    const p = out.find((x) => x.name === 'package/package.json');
    const pkg = JSON.parse(raw.slice(p.at, p.at + p.size).toString('utf8'));
    assert.equal(pkg.name, 'external_lights');
    assert.deepEqual(pkg.mguHmi, ['ID7']);
    assert.notEqual(pkg.mguAppStartType, 'autostart');
});
