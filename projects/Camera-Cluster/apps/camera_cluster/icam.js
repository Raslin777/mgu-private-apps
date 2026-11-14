'use strict';
// The camera unit's SOME/IP interface, as camera.js's `io`.
//
// Checked against the owner's head-unit catalog (someip-interfaces.json):
// ICAM2Proxy (service 0xF78A, instance "1") has changeState(cookie, desiredState)
// and the field currentState, and extends CameraProxy, which has
// clientAttach(type) -> cookie, clientDetach(cookie) and the field streamInfo.
// The enum names and numbers below are the catalog's. What the catalog cannot
// say is whether the camera unit grants the request; every failure ends up as
// text on the app's screen.
const INTERFACE = 'de.bmw.infotainment.video.cameraproxy.ICAM2Proxy';
const INSTANCE = '1';
const NAMES = { client: 'CLIENT_INDIRECT', application: 'DR_ACTIVE', mode: 'MODE_MOSAIK' };
const NUMBERS = { client: 1, application: 51, mode: 50 };

// signals: the app kit's signals module (proxy, call). Enum arguments go by
// name first; a proxy that refuses names gets the wire numbers once.
function create(signals, log) {
    let proxy = null;
    const say = log || function () {};
    function connect() {
        if (proxy) return Promise.resolve(proxy);
        return signals.proxy(INTERFACE, INSTANCE).then((p) => { proxy = p; return p; });
    }
    function either(method, byName, byNumber) {
        return connect().then((p) => signals.call(p, method, byName, 10000).catch((e) => {
            say('camera: ' + method + ' with names failed (' + String((e && e.message) || e).slice(0, 80) + '), trying numbers');
            return signals.call(p, method, byNumber, 10000);
        }));
    }
    const desired = (cookie, view, v) => ({ cookie: cookie, desiredState: { application: v.application, mode: v.mode, perspective: view } });
    return {
        attach() {
            return either('clientAttach', { type: NAMES.client }, { type: NUMBERS.client })
                .then((reply) => (reply && typeof reply === 'object' ? reply.cookie : reply));
        },
        change(cookie, view) {
            return either('changeState', desired(cookie, view, NAMES), desired(cookie, view, NUMBERS));
        },
        state() {
            // From a fresh tick, as the app kit does for every native SOME/IP call.
            return connect().then((p) => new Promise((resolve, reject) => {
                setImmediate(() => { try { Promise.resolve(p.getValue('currentState', 3000)).then(resolve, reject); } catch (e) { reject(e); } });
            }));
        },
        // { imageWidth, imageHeight, framesPerSecond, approximateBitrate } or null.
        info() {
            return connect().then((p) => new Promise((resolve) => {
                setImmediate(() => { try { Promise.resolve(p.getValue('streamInfo', 3000)).then(resolve, () => resolve(null)); } catch (e) { resolve(null); } });
            }));
        },
        detach(cookie) {
            return connect().then((p) => signals.call(p, 'clientDetach', { cookie: cookie }, 10000));
        }
    };
}

module.exports = { create, INTERFACE, INSTANCE, NAMES, NUMBERS };
