'use strict';
// The app's manifest, what it asks of the head unit, and the built Store package.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const app = path.join(root, 'apps', 'better_lighting');
const manifest = JSON.parse(fs.readFileSync(path.join(app, 'app.json'), 'utf8'));
const TASU = 'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu';

// Read from the owner's head-unit SOME/IP catalog (someip-interfaces.json) on 2026-11-14. The catalog is not in
// this repository; set BETTER_LIGHTING_CATALOG to a copy to check against the file itself.
const FROM_CATALOG = {
    [TASU]: { instance: 'SystemFunctionsInternalTasuInst1', methods: ['sendTasuRequest'], events: ['sendTasuResponse'] },
    'de.bmw.infotainment.misc.ComfortFunctionIuK': { instance: '1', fields: ['ambientLightInteriorColour', 'statusAmbientLightInteriorColour'] },
    'de.bmw.infotainment.drivingexcitement.FES': { instance: '1', fields: ['statusFESVehicleDynamicSwitchHMI'] },
    'de.bmw.infotainment.vehicle.Vehicle': { instance: '1', fields: ['statusDayNightChangeOver'] },
};

test('manifest: its own id, the version of package.json, started with the platform', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.id, 'better_lighting');
    assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.loggingId.length, 4);
    assert.equal(manifest.autostart, true);
    assert.match(manifest.description, /Not car-tested/);
});

test('the app asks for the four interfaces the kit\'s Ambient config asks for, and nothing else', () => {
    assert.deepEqual(Object.keys(manifest.signals).sort(), Object.keys(FROM_CATALOG).sort());
    const t = manifest.signals[TASU];
    assert.equal(t._instances, FROM_CATALOG[TASU].instance);
    assert.deepEqual(t._methods, FROM_CATALOG[TASU].methods);
    assert.deepEqual(t._broadcasts, FROM_CATALOG[TASU].events);
    Object.keys(FROM_CATALOG).filter((k) => k !== TASU).forEach((iface) => {
        const asked = Object.keys(manifest.signals[iface]).filter((k) => k[0] !== '_');
        assert.deepEqual(asked.sort(), FROM_CATALOG[iface].fields.slice().sort());
    });
});

const file = process.env.BETTER_LIGHTING_CATALOG;
test('the catalog file itself', { skip: !file && 'set BETTER_LIGHTING_CATALOG to a someip-interfaces.json to run' }, () => {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    Object.keys(FROM_CATALOG).forEach((iface) => {
        const have = c.interfaces[iface], want = FROM_CATALOG[iface];
        assert.ok(have, iface);
        assert.ok(want.instance in c.instanceIDs[iface], iface + ' instance ' + want.instance);
        (want.methods || []).forEach((m) => assert.ok(have.methods[m], m));
        (want.events || []).forEach((e) => assert.ok(have.events[e], e));
        (want.fields || []).forEach((f) => assert.ok(have.fields[f], f));
    });
    const req = c.interfaces[TASU].methods.sendTasuRequest.inputs.map((x) => x.name);
    assert.deepEqual(req, ['sourceAddress', 'targetAddress', 'serviceID', 'subroutineID', 'udsDataLength', 'udsData', 'deadlockTime']);
    assert.deepEqual(c.interfaces[TASU].events.sendTasuResponse.outputs.map((x) => x.name), ['udsResponse', 'udsResponseLength', 'errorCode']);
});

test('sources: only services 22 and 2E to the body controller, no SDK, no network or process use', () => {
    const files = fs.readdirSync(app).filter((f) => f.endsWith('.js'));
    files.forEach((f) => {
        const s = fs.readFileSync(path.join(app, f), 'utf8');
        assert.ok(!/oap-sdk/.test(s), f + ' names the SDK');
        assert.ok(!/require\(['"](net|http|https|dgram|child_process|tls)['"]\)/.test(s), f + ' opens a socket or a process');
        const calls = s.match(/diag\.(physical|functional|send)\([^)]*/g) || [];
        calls.forEach((c) => assert.match(c, /^diag\.physical\(BDC, 0x(22|2e), /, f + ': ' + c));
    });
    const lights = fs.readFileSync(path.join(app, 'lights.js'), 'utf8');
    assert.equal((lights.match(/diag\.physical\(/g) || []).length, 2, 'one read call and one write call');
});

/** The names in a .tgz (ustar; names under 100 bytes, as this package has). */
function names(tgz) {
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

const tgz = path.join(root, 'dist', 'better_lighting@' + manifest.version + '.tgz');
test('the Store package: the app\'s files as in apps/, the kit\'s licence, no SDK', { skip: !fs.existsSync(tgz) && 'not built (python tools/build.py)' }, () => {
    const { raw, out } = names(tgz);
    const all = out.map((x) => x.name);
    ['package/package.json', 'package/manifest.json', 'package/LICENSE-app-kit', 'package/NOTICE.md', 'package/javascript/app.js',
        'package/javascript/kit/diag.js', 'package/javascript/kit/mgu.js'].forEach((n) => assert.ok(all.includes(n), n));
    assert.ok(!all.some((n) => /oap-sdk|node_modules/.test(n)), 'the SDK is not packaged');
    ['ambient.js', 'cabin.js', 'control.js', 'lights.js', 'lin.js', 'scenes.js'].forEach((f) => {
        const e = out.find((x) => x.name === 'package/javascript/' + f);
        assert.ok(e, f);
        assert.ok(raw.slice(e.at, e.at + e.size).equals(fs.readFileSync(path.join(app, f))), f + ' is the file in apps/ (build again)');
    });
    const p = out.find((x) => x.name === 'package/package.json');
    const pkg = JSON.parse(raw.slice(p.at, p.at + p.size).toString('utf8'));
    assert.equal(pkg.name, 'better_lighting');
    assert.equal(pkg.version, manifest.version);
    assert.deepEqual(pkg.mguHmi, ['ID7']);
    assert.equal(pkg.mguAppStartType, 'autostart');
    assert.equal(pkg.dependencies, undefined);
});
