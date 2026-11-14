# Camera Cluster offline validation — November 14, 2026

App 0.1.0; feed tool 0.1.0. All work was done offline from the car. The head
unit was not connected to, probed or changed. Nothing was committed, pushed or
published.

## Verified on the development PC

- `npm test`: 26 tests, 25 pass and 1 is skipped unless
  `CAMERA_CLUSTER_CATALOG` names a head-unit catalog; with the owner's catalog
  all 26 pass (Node 26, Python 3.15).
  - Camera request (`camera.js`, `icam.js`) against a simulated camera unit:
    front is view 1 and rear view 2; switching reuses the attachment; Off
    releases; a view never given is refused after three asks with the unit's
    state in the text; no camera service is refused with the reason; a parking
    view pauses without further requests and the view is asked again after it;
    Off during an attach still releases and never asks for the view; enum
    arguments go by name, then by number; the reported picture size is shown,
    a zero size is not.
  - Feed link (`feed.js`) over a real local socket against a simulated feed
    tool: states the wish on connect, reads status, takes the picture off
    before leaving, reports a missing tool, backs off, reconnects and repeats
    the wish, ignores malformed and oversized input.
  - Screen (`view.js`): the summary line for each combination of states.
  - Feed tool sources: every key in `camera-feed.conf` is one the pinned
    Waze on cluster 0.9.14 source defines, within the ranges its `main.cpp`
    enforces; the picture starts off, targets `map`, reads stream
    `media_transport.avb_streaming.1`; no path or port is shared with a Waze on
    cluster installation; the socket path is the same in the app, the settings
    and the socket unit; the service has no install section and is not root.
  - Packer (`tools/package-feed.py`) against a stand-in release archive: a
    file with the wrong hash is refused; only the program and its licence are
    taken; owner 0:0, modes, Unix line endings, hashes matching the manifest.
- Official Node 8.16.2 (`.cache/node8.exe`, SHA-256 matching the Node.js
  release list) syntax-checks every app source and runs
  `tools/check-node8.cjs`: one selection end to end with simulated car and feed.
- **Owner's head-unit catalog** (`someip-interfaces.json`, version 0.1.0, 591
  interfaces): `ICAM2Proxy` has `changeState(cookie, desiredState)` and
  `currentState`, extends `CameraProxy` with `clientAttach(type) -> cookie`,
  `clientDetach(cookie)` and `streamInfo`; instance `1` exists; the enum
  values the app sends (`CLIENT_INDIRECT` 1, `DR_ACTIVE` 51, `MODE_MOSAIK` 50)
  and the state struct's members are the catalog's.
- **Owner's firmware image** (`HU_MGU_01`, 21-11; strings of unpacked
  programs only, nothing executed): `dasvideo` and `icam2proxy` name
  `media_transport.avb_streaming.1`; `dasvideo` handles it as H.264 over AVB;
  `libias-media_transport-avb_ufipc_bridge.so.1` exports
  `ias_avbbridge_create_receiver`, `ias_avbbridge_register_H264_cb` and
  `ias_avbbridge_destroy_receiver`, the three functions the decoder's source
  calls; `icam2proxy`'s messages describe one indirect client, requests held
  while a direct client is attached, and "off" requests from an indirect
  client ignored.
- Built packages:
  - `dist/camera_cluster@0.1.0.tgz` (934,189 bytes, SHA-256 `ff54a833...2d5ed`),
    with the pinned MIT app kit, no `oap-sdk`; `manifest.json` declares
    `ICAM2Proxy` and `CameraProxy`; `package.json` declares ID7 and requires
    `camera-cluster-feed` 0.1.0.
  - `dist/camera-cluster-feed@0.1.0.tgz` (2,240,944 bytes, SHA-256
    `657cb129...5867`): `component.json`, `files/` (the decoder 0755, its
    `LICENSE`, `camera-feed.conf`, `SOURCE.md`), `units/` (socket, service),
    all 0:0. The decoder was read from the release file
    `waze-on-cluster@0.9.14.tgz` after its size and SHA-256 matched the pin;
    it is a Linux x86-64 program (SHA-256 `3ed45da8...6553`).
  - `dist/catalog.json` lists both with sizes and hashes; local, unpublished.
- `npm run preview` renders the five simulated screens with the kit's canvas.
- The facts taken from other projects were read at these commits:
  `robertnisipeanu/idrive-apps` `f7a678b` (tag `waze-on-cluster@0.9.14`),
  `robertnisipeanu/mgu-store` `9c2360a`, `IterioDev/car-apps` `cdab455`,
  `cauliflowermossgrape/idrive7-apps` `2c6cfdf`.

## Not verified

Everything on the car. In particular:

- Installation of either package through MGU Store, and whether the installer
  gives the app the inherited `clientAttach` / `clientDetach`.
- `main.js`: it needs the app kit runtime and BMW's SDK, so it was
  syntax-checked only. Its wiring has not run.
- Whether the car's camera unit grants Drive Recorder mode to this app, has a
  front camera, and gives the front view for 1 and the rear view for 2.
- Whether the firmware image in the review folder is the version on the car.
- The decoder itself: it was never executed (it is a head-unit program). Its
  settings were checked against its source only. Whether the camera stream's
  packets are in a form it reads, and whether user `hmi_5000` may join that
  stream, is unknown.
- Any picture on the cluster: size, shape, delay, frame rate, load, behaviour
  with a parking view, with route guidance, and in each cluster layout.
- Whether the app keeps running, and the picture stays, after leaving the
  app's screen.
- Clean release of the camera unit on Off and when the platform stops the app.
- `tools/probe-hu.sh`: written offline, never run.

The README's "What is confirmed, what is a guess" gives the same split with
the reasoning.
