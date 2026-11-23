'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.join(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const archive = path.join(root, 'dist', 'road_sight@' + version + '.tgz');
function unpack() {
    const bytes = zlib.gunzipSync(fs.readFileSync(archive));
    const files = new Map();
    for (let at = 0; at + 512 <= bytes.length;) {
        const name = bytes.subarray(at, at + 100).toString().replace(/\0.*$/, '');
        if (!name) break;
        const size = parseInt(bytes.subarray(at + 124, at + 136).toString().replace(/\0.*$/, '').trim() || '0', 8);
        if (bytes[at + 156] === 48 || bytes[at + 156] === 0) files.set(name, bytes.subarray(at + 512, at + 512 + size));
        at += 512 + Math.ceil(size / 512) * 512;
    }
    return files;
}
test('archive holds the current source, licences and a read-only manifest, and no SDK, schema or keys',
    { skip: fs.existsSync(archive) ? false : 'run "python tools/build.py" first' }, () => {
        const files = unpack();
        const pkg = JSON.parse(files.get('package/package.json'));
        assert.deepEqual(pkg.mguHmi, ['ID7']); assert.equal(pkg.version, version);
        assert.notEqual(pkg.mguAppStartType, 'autostart', 'the viewer must not start by itself');
        const app = path.join(root, 'apps', 'road_sight');
        for (const file of fs.readdirSync(app).filter(f => /\.js$/.test(f))) {
            const packaged = file === 'main.js' ? 'app.js' : file;
            assert.ok(files.has('package/javascript/' + packaged), packaged);
            assert.ok(files.get('package/javascript/' + packaged).equals(fs.readFileSync(path.join(app, file))), file);
        }
        for (const file of ['NOTICE.md', 'LICENSE', 'LICENSE-app-kit', 'LICENSES/MIT-app-kit.txt']) assert.ok(files.has('package/' + file), file);
        assert.ok(![...files.keys()].some(name => /node_modules\/oap-sdk|\.pem$|\.key$|schema\.json|someip-interfaces|\.exe$/.test(name)));
        const manifest = JSON.parse(files.get('package/manifest.json'));
        const services = require('../apps/road_sight/services');
        for (const s of services) {
            const proxy = manifest.proxies[s.iface];
            assert.ok(proxy, s.iface);
            assert.deepEqual((proxy.broadcasts || []).slice().sort(), s.events.slice().sort());
            for (const f of s.fields) assert.equal(proxy.attributes[f], 's');
            for (const value of Object.values(proxy.attributes || {})) assert.equal(value, 's', 'no readable-writable or writable attribute');
            assert.ok(!(proxy.methods && proxy.methods.length), 'no methods');
        }
        // Everything else in the manifest is the app platform's own head-unit plumbing (screen, lifecycle, user),
        // added by the app kit for every app. None of it may be a car-side service.
        const mine = new Set(services.map(s => s.iface));
        const extra = Object.keys(manifest.proxies).filter(name => !mine.has(name));
        for (const name of extra) assert.match(name, /^(de\.bmw\.infotainment\.|de\.bmw\.infrastructure\.EnvironmentalInformation$|org\.genivi\.)/, name);
        assert.ok(!extra.some(name => /\.(body|chassis|dass|powertrain|sensors|environmentalmodel)\./.test(name)));
    });
