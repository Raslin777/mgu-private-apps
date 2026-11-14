'use strict';
// The feed tool's settings, units and packer, checked without the real decoder
// program: the packer is run against a stand-in release archive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const native = path.join(root, 'native', 'camera-cluster-feed');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');
const component = JSON.parse(read(native, 'component.json'));

function settings() {
    const out = {};
    read(native, 'camera-feed.conf').split(/\r?\n/).forEach((line) => {
        if (!line.trim() || line.trim().startsWith('#')) return;
        const at = line.indexOf('=');
        assert.ok(at > 0, 'not a "key = value" line: ' + line);
        out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    });
    return out;
}

// The keys the pinned waze-on-cluster 0.9.14 defines (its src/main.cpp define_keys),
// plus the ones its shared Config has. An unknown key would stop the program.
const KNOWN = ['local_conf', 'socket_path', 'socket_mode', 'socket_group', 'log_file', 'log_file_kb', 'verbose',
    'fifo_path', 'carplay_group', 'udp_port', 'avb_stream', 'drm_device', 'tex_size', 'src_crop', 'map_rect',
    'dirty_threshold', 'dirty_settle_ms', 'stall_ms', 'idle_ms', 'freeze_ms', 'freeze_min_fps', 'blank_ms',
    'alt_screen_port', 'alt_screen_uid', 'target_fps', 'picture_fps', 'pan_blocks', 'tex_level_bits', 'gpu_copy',
    'target', 'hide_bmw_guidance', 'state_file', 'map_state_file', 'cluster', 'hud', 'hud_fps', 'hud_width_pct',
    'hud_offset_x', 'hud_offset_y', 'hud_keep_shown', 'hud_scale_down', 'hud_round_corners', 'hud_black_background',
    'render_socket'];

test('settings use only keys the pinned program knows, within its ranges', () => {
    const s = settings();
    Object.keys(s).forEach((key) => assert.ok(KNOWN.includes(key), 'unknown key ' + key));
    const range = (key, lo, hi) => assert.ok(+s[key] >= lo && +s[key] <= hi, key + ' out of range');
    range('stall_ms', 1000, 600000); range('blank_ms', 1000, 600000); range('freeze_ms', 0, 600000);
    range('target_fps', 0, 60); range('picture_fps', 0, 60); range('alt_screen_port', 0, 65535);
});

test('the picture starts off, on the map area, from the camera stream, guidance left alone', () => {
    const s = settings();
    assert.equal(s.cluster, '0');
    assert.equal(s.hud, '0');
    assert.equal(s.target, 'map');
    assert.equal(s.avb_stream, 'media_transport.avb_streaming.1');
    assert.equal(s.hide_bmw_guidance, '0');
    assert.equal(s.alt_screen_port, '0');
});

test('no path or port is shared with a Waze on cluster installation', () => {
    const s = settings();
    ['local_conf', 'socket_path', 'log_file', 'fifo_path', 'state_file', 'map_state_file'].forEach((key) => {
        assert.ok(s[key], key + ' must be set: its default is Waze on cluster\'s own');
        assert.ok(!/waze/.test(s[key]), key + ' points into Waze on cluster: ' + s[key]);
        assert.match(s[key], /camera-cluster-feed/);
    });
    assert.notEqual(s.udp_port, '20557');
});

test('units: started by the app\'s connection only, not root, same socket as the app', () => {
    const socket = read(native, 'systemd', 'camera-cluster-feed.socket');
    const service = read(native, 'systemd', 'camera-cluster-feed.service');
    const appSocket = require('../apps/camera_cluster/feed').SOCKET;
    assert.ok(socket.includes('ListenStream=' + appSocket));
    assert.equal(settings().socket_path, appSocket);
    assert.match(socket, /SocketGroup=tm_oap_app/);
    assert.match(socket, /SocketMode=0660/);
    assert.match(service, /^User=hmi_5000$/m);
    assert.ok(!/\[Install\]/.test(service), 'the service must not start at boot');
    assert.match(service, /ExecStart=\/var\/opt\/camera-cluster-feed\/current\/waze-on-cluster -c \/var\/opt\/camera-cluster-feed\/current\/camera-feed\.conf$/m);
    assert.deepEqual(component.enable, [{ unit: 'camera-cluster-feed.socket', target: 'sockets.target' }]);
});

test('the app and the tool agree on ids and versions', () => {
    const app = JSON.parse(read(root, 'apps', 'camera_cluster', 'app.json'));
    const pkg = JSON.parse(read(root, 'package.json'));
    assert.equal(app.version, pkg.version);
    assert.equal(component.id, 'camera-cluster-feed');
    assert.deepEqual(Object.keys(app.signals), ['de.bmw.infotainment.video.cameraproxy.ICAM2Proxy', 'de.bmw.infotainment.video.cameraproxy.CameraProxy']);
    assert.match(read(root, 'tools', 'build.py'), /requires=\{feed\['id'\]: feed\['version'\]\}/);
});

// --- the packer, against a stand-in release archive -------------------------
const python = ['python', 'python3'].find((name) => spawnSync(name, ['--version']).status === 0);
const packer = `
import importlib.util, io, json, sys, tarfile, hashlib, gzip
spec = importlib.util.spec_from_file_location('package_feed', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
work = sys.argv[2]
def release(binary):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w:gz') as t:
        for name, data in (('files/waze-on-cluster', binary), ('files/LICENSE', b'GPL text\\n'), ('files/patchd.js', b'never taken')):
            i = tarfile.TarInfo(name); i.size = len(data); t.addfile(i, io.BytesIO(data))
    return raw.getvalue()
good = release(b'\\x7fELF stand-in')
open(work + '/good.tgz', 'wb').write(good)
up = {'size': len(good), 'sha256': hashlib.sha256(good).hexdigest(),
      'take': [{'path': 'waze-on-cluster', 'from': 'files/waze-on-cluster', 'mode': '0755'}, {'path': 'LICENSE', 'from': 'files/LICENSE', 'mode': '0644'}]}
taken = m.read_upstream(work + '/good.tgz', up)
result = {'taken': sorted(taken)}
try:
    m.read_upstream(work + '/good.tgz', dict(up, sha256='0' * 64)); result['wrong_hash'] = 'accepted'
except SystemExit as e:
    result['wrong_hash'] = 'refused'
# Pack with the real component.json, its pin swapped for the stand-in's.
real = m.read_upstream
m.read_upstream = lambda file, upstream: real(file, up)
target = m.build(work + '/good.tgz', work + '/out')
with tarfile.open(target) as t:
    result['members'] = [(i.name, oct(i.mode), i.uid, i.gid) for i in t.getmembers()]
    manifest = json.load(t.extractfile('component.json'))
    result['manifest'] = manifest
    result['hashes_ok'] = all(hashlib.sha256(t.extractfile('files/' + f['path']).read()).hexdigest() == f['sha256'] for f in manifest['files'])
    result['crlf'] = any(b'\\r' in t.extractfile(i).read() for i in t.getmembers() if i.name.startswith('units/') or i.name.endswith('.conf'))
print(json.dumps(result))
`;

test('packer: verified release in, Store tool artifact out', { skip: !python && 'Python not found' }, () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'camera-cluster-pack-'));
    const run = spawnSync(python, ['-c', packer, path.join(root, 'tools', 'package-feed.py'), work], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout.trim().split('\n').pop());
    assert.deepEqual(result.taken, ['LICENSE', 'waze-on-cluster']);
    assert.equal(result.wrong_hash, 'refused');
    const names = result.members.map((m) => m[0]);
    assert.deepEqual(names, ['component.json', 'files/LICENSE', 'files/SOURCE.md', 'files/camera-feed.conf', 'files/waze-on-cluster',
        'units/camera-cluster-feed.service', 'units/camera-cluster-feed.socket']);
    result.members.forEach((m) => { assert.equal(m[2], 0); assert.equal(m[3], 0); });
    assert.equal(result.members.find((m) => m[0] === 'files/waze-on-cluster')[1], '0o755');
    assert.equal(result.hashes_ok, true);
    assert.equal(result.crlf, false);
    assert.equal(result.manifest.upstream, undefined);
    assert.deepEqual(result.manifest.requires, { 'cluster-render': '0.5.3' });
    assert.deepEqual(result.manifest.units.map((u) => u.name), ['camera-cluster-feed.socket', 'camera-cluster-feed.service']);
    fs.rmSync(work, { recursive: true, force: true });
});
