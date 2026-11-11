'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Canvas } = require('../.cache/idrive-kit/kit/runtime/canvas');
const { draw } = require('../apps/mgu_ai_terminal/view');
const out = path.resolve('preview');
fs.mkdirSync(out, { recursive: true });
// Simulated data only: nothing here was produced by a model or a head unit.
const states = {
    terminal: { status: 'PREVIEW — Ready — Claude', approvals: [], lines: [
        '> Create a hello-world script in my workspace and run it.',
        'Wrote hello.sh (24 bytes)', '$ sh hello.sh', 'Hello from your MGU!\n[exit 0]',
        'AI: Created hello.sh. It ran successfully.'
    ] },
    setup: { status: 'PREVIEW — Not set up', approvals: [], lines: [
        'Not set up. Run provision.sh for /example/oap_app/data', '', 'Setup file: /example/oap_app/data/config.json'
    ] },
    approval: { status: 'PREVIEW — Action needs approval', lines: [], approvals: [
        { id: 1, root: false, flags: [], reason: 'Read the head-unit operating-system information you asked for', command: 'cat /etc/os-release' }
    ] },
    'approval-root': { status: 'PREVIEW — Action needs approval', lines: [], approvals: [
        { id: 2, root: true, flags: ['RUNS AS ROOT', 'CHANGES A SERVICE'], reason: 'Restart the uplink so the new Wi-Fi settings apply',
            command: 'systemctl restart mgu-uplink.service' }
    ] }
};
for (const [name, state] of Object.entries(states)) {
    const cv = new Canvas(1600, 520);
    draw(cv, state, 0);
    fs.writeFileSync(path.join(out, name + '.png'), cv.png());
}
for (const stale of ['login.png']) fs.rmSync(path.join(out, stale), { force: true });
console.log('Preview images: ' + out);
