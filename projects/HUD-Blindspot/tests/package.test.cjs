'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.join(__dirname, '..');
function unpack() {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
    const bytes = zlib.gunzipSync(fs.readFileSync(path.join(root, 'dist', 'hud_blindspot@' + version + '.tgz')));
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
test('Store archive contains the current source, required licences, ID7 metadata and no SDK or keys', () => {
    const files = unpack();
    const pkg = JSON.parse(files.get('package/package.json'));
    assert.deepEqual(pkg.mguHmi, ['ID7']); assert.equal(pkg.requires['cluster-render'], '0.6.7');
    assert.equal(pkg.mguAppStartType, 'autostart');
    for (const file of fs.readdirSync(path.join(root, 'apps', 'hud_blindspot')).filter(f => /\.js$/.test(f))) {
        const packaged = file === 'main.js' ? 'app.js' : file;
        assert.ok(files.has('package/javascript/' + packaged), packaged);
        assert.ok(files.get('package/javascript/' + packaged).equals(fs.readFileSync(path.join(root, 'apps', 'hud_blindspot', file))), file);
    }
    for (const file of ['NOTICE.md', 'LICENSE', 'LICENSE-app-kit', 'LICENSES/MPL-2.0.txt', 'LICENSES/MIT-app-kit.txt'])
        assert.ok(files.has('package/' + file), file);
    assert.ok(![...files.keys()].some(name => /node_modules\/oap-sdk|\.pem$|\.key$|schema\.json|\.exe$/.test(name)));
    const manifest = JSON.parse(files.get('package/manifest.json'));
    const signal = manifest.proxies['de.bmw.dass.driverassistanceapplications.LateralCollisionAvoidance'];
    assert.equal(signal.attributes.lateralCollisionAvoidanceQualifiers, 's');
    assert.deepEqual(signal.broadcasts, ['requestWarningSteeringWheelExteriorMirror']);
    const secondary = manifest.proxies['de.bmw.dass.driverassistanceapplications.AssistedDrivingViewLateralCollisionAvoidance'];
    assert.deepEqual(secondary.broadcasts, ['assistedDrivingViewLcaInput']);
});
