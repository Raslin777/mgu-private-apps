'use strict';
// The camera request, checked against the facts read from the owner's head-unit
// SOME/IP catalog (someip-interfaces.json, version 0.1.0, 591 interfaces). The
// catalog itself is not in this repository; these are the values read from it
// on 2026-11-14. If CAMERA_CLUSTER_CATALOG names a copy, it is checked directly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const icam = require('../apps/camera_cluster/icam');
const { VIEWS } = require('../apps/camera_cluster/camera');

const FROM_CATALOG = {
    application: { OFF: 0, TOPREARVIEW: 1, SIDEVIEW: 2, RFK: 3, OFFROAD: 20, DR_STANDBY: 50, DR_ACTIVE: 51, DR_CRASH: 52, REMOTE360: 60, SIGNAL_UNFILLED: 255 },
    mode: { MODE_MOSAIK: 50 },
    client: { CLIENT_DIRECT: 0, CLIENT_INDIRECT: 1 }
};

test('enum names and numbers are the ones in the catalog', () => {
    assert.equal(FROM_CATALOG.application[icam.NAMES.application], icam.NUMBERS.application);
    assert.equal(FROM_CATALOG.mode[icam.NAMES.mode], icam.NUMBERS.mode);
    assert.equal(FROM_CATALOG.client[icam.NAMES.client], icam.NUMBERS.client);
    assert.equal(icam.INSTANCE, '1');
    assert.deepEqual([VIEWS.front, VIEWS.rear], [1, 2]);
});

const file = process.env.CAMERA_CLUSTER_CATALOG;
test('the catalog file itself', { skip: !file && 'set CAMERA_CLUSTER_CATALOG to a someip-interfaces.json to run' }, () => {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cam = c.interfaces['de.bmw.infotainment.video.cameraproxy.CameraProxy'];
    const i2 = c.interfaces[icam.INTERFACE];
    assert.equal(i2.extends, 'de.bmw.infotainment.video.cameraproxy.CameraProxy');
    assert.deepEqual(i2.methods.changeState.inputs.map((x) => x.name), ['cookie', 'desiredState']);
    assert.ok(i2.fields.currentState.getter);
    assert.deepEqual(cam.methods.clientAttach.inputs.map((x) => x.name), ['type']);
    assert.deepEqual(cam.methods.clientAttach.outputs.map((x) => x.name), ['cookie']);
    assert.deepEqual(cam.methods.clientDetach.inputs.map((x) => x.name), ['cookie']);
    assert.ok(cam.fields.streamInfo.getter);
    assert.ok(icam.INSTANCE in c.instanceIDs[icam.INTERFACE]);
    const d = c.datatypes;
    assert.deepEqual(d['de.bmw.dasstypes.DASSTypes.XView3DState'].members.map((m) => m.name), ['application', 'mode', 'perspective']);
    assert.equal(d['de.bmw.dasstypes.DASSTypes.Xview3DApplication'].items[icam.NAMES.application], icam.NUMBERS.application);
    assert.equal(d['de.bmw.dasstypes.DASSTypes.XView3DMode'].items[icam.NAMES.mode], icam.NUMBERS.mode);
    assert.equal(d['de.bmw.infotainment.video.videotypes.VideoTypes.ClientType'].items[icam.NAMES.client], icam.NUMBERS.client);
    assert.deepEqual(d['de.bmw.infotainment.video.videotypes.VideoTypes.VideoStreamInfo'].members.map((m) => m.name),
        ['imageWidth', 'imageHeight', 'framesPerSecond', 'approximateBitrate']);
});
