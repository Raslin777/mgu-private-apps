'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Canvas } = require('../.cache/idrive-kit/kit/runtime/canvas');
const { draw } = require('../apps/camera_cluster/view');
const out = path.resolve('preview');
fs.mkdirSync(out, { recursive: true });
// Simulated states only: nothing here came from a head unit or a camera.
const states = {
    off: { camera: { want: 0, state: 'off', text: 'Not asked for' }, feed: { link: 'not started', state: '', reason: '', cluster: false } },
    front: { camera: { want: 1, state: 'on', text: 'Front camera view is on' }, feed: { link: 'connected', state: 'showing', reason: '', cluster: true } },
    'rear-waiting': { camera: { want: 2, state: 'on', text: 'Rear camera view is on' },
        feed: { link: 'connected', state: 'starting', reason: 'the stock map holds the slot', cluster: true } },
    refused: { camera: { want: 1, state: 'refused', text: 'View not given (camera unit: SIGNAL_UNFILLED/0/255)' },
        feed: { link: 'connected', state: 'off', reason: '', cluster: false } },
    'no-feed': { camera: { want: 1, state: 'asking', text: 'Asking the camera unit (1 of 3)' },
        feed: { link: 'feed tool not installed', state: '', reason: '', cluster: false } }
};
for (const [name, state] of Object.entries(states)) {
    const cv = new Canvas(1600, 520);
    draw(cv, state);
    fs.writeFileSync(path.join(out, name + '.png'), cv.png());
}
console.log('Preview images: ' + out);
