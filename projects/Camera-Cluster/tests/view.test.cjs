'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { draw, summary } = require('../apps/camera_cluster/view');

const cam = (want, state, text) => ({ want, state, text: text || '' });
const feed = (link, state, reason) => ({ link, state: state || '', reason: reason || '', cluster: state === 'showing' });

test('summary says what the driver should see on the cluster', () => {
    assert.match(summary({ camera: cam(0, 'off'), feed: feed('not started') }).text, /^Off/);
    assert.match(summary({ camera: cam(1, 'asking'), feed: feed('feed tool not installed') }).text, /feed tool not installed/);
    assert.match(summary({ camera: cam(1, 'refused'), feed: feed('connected') }).text, /did not give the view/);
    assert.match(summary({ camera: cam(2, 'paused'), feed: feed('connected') }).text, /parking view/);
    assert.match(summary({ camera: cam(2, 'asking'), feed: feed('connected') }).text, /Asking/);
    assert.match(summary({ camera: cam(2, 'on'), feed: feed('connected', 'starting') }).text, /waiting for the picture/);
    assert.equal(summary({ camera: cam(2, 'on'), feed: feed('connected', 'showing') }).text, 'Rear camera is on the cluster.');
    assert.equal(summary({ camera: cam(1, 'on'), feed: feed('connected', 'showing') }).text, 'Front camera is on the cluster.');
});

test('draw shows the selection, each part\'s state and the prototype note', () => {
    const texts = [];
    const cv = { clear() {}, fillRect() {}, text(t) { texts.push(t); } };
    draw(cv, { camera: cam(1, 'on', 'Front camera view is on'), feed: feed('connected', 'starting', 'the stock map holds the slot') });
    assert.ok(texts.includes('Front camera'));
    assert.ok(texts.includes('Front camera view is on'));
    assert.ok(texts.includes('connected - starting'));
    assert.ok(texts.includes('the stock map holds the slot'));
    assert.ok(texts.some((t) => /not yet run on a car/.test(t)));
});
