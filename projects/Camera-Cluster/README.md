# Camera Cluster for MGU

Shows the **front or the rear camera in the instrument cluster**, in the centre
map area between the gauges, on a BMW with an MGU head unit (iDrive 7). Front,
Rear and Off are three buttons in the app on the centre screen.

**Status: a prototype built and tested offline. It has never run on a car, and
it may need adjustments on the first try.** The cluster half rests on a
mechanism other people have verified on iDrive 7 cars. The camera half is now
checked against the owner's own head-unit interface catalog and firmware
image: the request the app sends and the stream the feed reads both exist
there as designed. What remains open is what the car does when asked. The
section [What is confirmed, what is a guess](#what-is-confirmed-what-is-a-guess)
says which is which.

| | |
|---|---|
| App package | `dist/camera_cluster@0.1.0.tgz` (built) |
| Feed tool | `dist/camera-cluster-feed@0.1.0.tgz` (built; contains the GPL-3.0 Waze on cluster decoder, see [NOTICE.md](NOTICE.md)) |
| Local catalog | `dist/catalog.json` (unpublished) |
| Also needed on the car | Cluster renderer (`cluster-render` 0.5.3 or newer) from `robertnisipeanu/idrive-apps`, through MGU Store |
| Car | iDrive 7 with a cluster that Cluster renderer supports (it decides that itself at start; which clusters qualify was not checked here) and a camera unit that has the camera you pick |

## Is it possible?

Yes for the cluster, probably for the cameras, and only with two root-installed
tools besides the app. An app on its own can do neither half.

### 1. The cluster's centre map area

On iDrive 7 the cluster (KOMBI) draws that area itself. It does not receive a
video signal: the head unit publishes a 3D scene over the car's Ethernet and
the cluster's own renderer draws it into a display "slot". The map area is slot
`0x100`, 1088 x 480 pixels; the head unit's stock map is one scene mapped into
it.

An app cannot publish such a scene: it runs as an unprivileged user, and only
one extra participant on the head unit can reach the cluster's renderer at all.
The community's **Cluster renderer** (`cluster-render`, by Robert Nisipeanu) is
that participant: a system service that owns the slot handling and lets apps
send it pictures over a socket that every app may open. It takes the map slot
over from the stock map while an app's picture wants it and gives it back
after. This is how *Waze on cluster* shows a phone's map there, and it is
verified on iDrive 7 cars by its authors.

So Camera Cluster does not draw on the cluster itself. It hands a video
picture to Cluster renderer, target `map`.

### 2. The camera video

The cameras are not connected to the head unit as video inputs. The car's
camera unit sends compressed video (H.264) over Ethernet AVB, and only while
something has asked for a view: the reversing camera, a parking view, or the
camera unit's "Drive Recorder" mode. On the head unit that stream appears on
BMW's internal media bus, where BMW's own camera display reads it.

An app cannot read that bus (it needs a system group the app user is not in)
and Node 8 could not decode the video anyway. What an app *can* do is ask the
camera unit for a view, over the same interface BMW's own recorder uses
(`ICAM2Proxy`): Drive Recorder mode with one camera, front or rear.

So two things are needed: the app asks the camera unit for the view, and a
system service reads and decodes the stream.

### 3. What the community projects do

| Project | What it does that matters here |
|---|---|
| `cauliflowermossgrape/idrive7-apps` | The app kit used here. Its Redline app draws shift lights on the **HUD** through Cluster renderer as a small picture; it does not touch the map area or the cameras. Its `mgu-renderd` draws on the **centre screen** only. Its README states that an app cannot tap the camera streams, which matches the above. |
| `robertnisipeanu/mgu-store` | The Store, the tool format (root services from a `component.json`), and `mgu-render`, again for the **centre screen** only. |
| `robertnisipeanu/idrive-apps` | **Cluster renderer** and **Waze on cluster**: a service that reads an H.264 stream from the media bus, decodes it on the head unit's GPU and shows it in the cluster's map area. iDrive 7, open source (GPL-3.0), car-verified for a phone's map stream. |
| `IterioDev/car-apps` | Overlays draws shift lights on the cluster (iDrive 8 only). More relevant: **Turn View** shows the *front camera in the cluster* and **Drive Recorder** records the cameras. Both ask the camera unit through `ICAM2Proxy` and read media-bus stream `media_transport.avb_streaming.1`. Turn View is iDrive 8 only and car-tested there. Drive Recorder installs on iDrive 7; an earlier version recorded on one iDrive 7 car (G20) through the head unit's camera service. Their licence forbids reusing or changing their code, and their decoder is not open source. |

Nobody has published "camera in the cluster" for iDrive 7. The pieces exist
separately: Waze on cluster proves video-to-cluster on iDrive 7, Turn View
proves camera-to-cluster on iDrive 8.

## What is confirmed, what is a guess

**Confirmed in the owner's head-unit catalog** (`someip-interfaces.json`, read
on 2026-11-14; `tests/catalog.test.cjs` re-checks a copy):

- `ICAM2Proxy` exists (service 0xF78A, instance `1`) with
  `changeState(cookie, desiredState)` and the field `currentState`.
- It extends `CameraProxy`, which has `clientAttach(type) -> cookie`,
  `clientDetach(cookie)` and the field `streamInfo` (picture width, height,
  frames a second). The app declares both interfaces.
- The values the app sends are the catalog's: client type `CLIENT_INDIRECT` = 1,
  application `DR_ACTIVE` = 51, mode `MODE_MOSAIK` = 50, `perspective` a plain
  number. The parking applications the app steps aside for (`TOPREARVIEW`,
  `SIDEVIEW`, `RFK`, `OFFROAD`, `REMOTE360`) are in the same list.

**Confirmed in the owner's firmware image** (`HU_MGU_01`, 21-11, strings of the
unpacked programs; nothing was executed):

- BMW's camera display program (`dasvideo`) reads the stream
  `media_transport.avb_streaming.1` and treats it as H.264 over AVB. The camera
  service (`icam2proxy`) names the same stream. This is the stream the feed is
  set to.
- The media-bus library the decoder links against is there under the same
  name (`libias-media_transport-avb_ufipc_bridge.so.1`) and exports the three
  functions the decoder calls to join a stream.
- How the camera service treats requests, from its own log messages:
  - It keeps **one** indirect client. Attaching replaces an earlier one, so
    Camera Cluster and a drive-recorder app cannot both hold the cameras.
  - While the car's own camera view is attached, a request is held, not
    applied, and the last requested mode is restored afterwards.
  - An indirect client asking for "off" is ignored; giving the cameras back is
    done by detaching, which is what the app does.
  - Recording to a buffer and exporting clips depend on BMW provisioning. The
    mode request itself shows no such condition in the strings.

**Confirmed by other projects' authors on cars** (read in their source and
documentation; nothing here was run by this project):

- The map area is slot `0x100`, 1088 x 480, and Cluster renderer can show an
  app's video there on iDrive 7 and return the stock map afterwards.
- The Waze on cluster render program joins a media-bus stream, decodes H.264
  on the head unit's GPU and shows it in the map area on iDrive 7, running as
  user `hmi_5000` with the `mgu_ufipc` group. Stream, target and all paths are
  settings. It accepts RTP packets and plain H.264, and writes a report of
  what it receives.
- On iDrive 8 the camera unit gives a single front or rear picture in Drive
  Recorder mode with view 1 or 2, on the same stream name. On one iDrive 7 car
  (G20) an app got the camera unit into that mode.

**Still guesses:**

- That view 1 is front and view 2 is rear on this car. The catalog only says
  the view is a number.
- That the camera stream's packets are in one of the two forms the decoder
  accepts, and that a key picture arrives at the start or often enough.
- That user `hmi_5000` may join the camera stream. For the phone stream it
  may; the iDrive 8 tools run as root for the camera stream.
- That the Store's installer gives the app the inherited `clientAttach` and
  `clientDetach` when both interfaces are declared, as the published
  Drive Recorder app does.
- That the app keeps running while another screen is shown, so the picture
  stays up when you leave the app.

**What can only be learned on the car:**

1. Whether the car's camera unit takes Drive Recorder mode when asked, and has
   a front camera. A car with only the reversing camera may refuse, or give
   the rear view only. The firmware image shows the head unit's side, not what
   is fitted to the car.
2. The picture's size and shape. The app shows what the camera service reports
   (*Camera picture* line); until a setting uses it, the picture is stretched
   to the map area and will look too wide.
3. Delay, frame rate and head-unit load.
4. Whether the cluster shows the map slot in every cluster layout, or only
   when its map view is selected.
5. What the cluster shows when you shift into reverse or open a parking view
   while the picture is up. By design the app takes its picture off then.
6. Whether the camera unit leaves Drive Recorder mode cleanly on Off.

`tools/probe-hu.sh` is a read-only script for the stream, group and service
questions. It has not been run.

## Design

The lightest arrangement that can work: **no new native code**. The decoding
service is the existing open-source Waze on cluster render program, unchanged,
started with a different settings file.

```
 Camera Cluster app (unprivileged)          camera-cluster-feed (system tool)        Cluster renderer      cluster
 ---------------------------------          ---------------------------------        ----------------      -------
 Front / Rear / Off buttons
   |  asks the camera unit for the view  ->  camera unit starts its stream
   |  (ICAM2Proxy, Drive Recorder mode)        |
   |                                         reads stream ...avb_streaming.1
   |  "show" / "hide" over a socket  ------> decodes H.264 on the GPU
   |  <-- status                             picture, 1088x480 ------------------->  target "map" ------->  map area
```

- **App** (`apps/camera_cluster/`, Node 8, app kit). `camera.js` asks the
  camera unit and checks every few seconds that it still gives the chosen
  view. `feed.js` talks to the feed tool. `view.js` shows what each part says,
  so a failure on the car reads as text on the screen.
- **Feed tool** (`native/camera-cluster-feed/`). The Waze on cluster program
  with `camera-feed.conf`: camera stream instead of the phone stream, its own
  socket, log and state paths, picture off until told otherwise. It contains
  none of Waze on cluster's CarPlay or Android Auto patches and patches
  nothing. It can be installed beside Waze on cluster.

Choices made on purpose:

- **The picture is on the cluster only while the camera unit confirms the
  chosen view.** If the car takes the cameras for a parking view, or the
  camera unit refuses, the cluster shows its own map, never some other
  picture.
- **Nothing runs until the app is used.** The feed service starts when the
  app first opens its socket. It then stays running until the head unit
  restarts.
- **The app starts Off every time.** The camera never comes up by itself.
- **The app never fights the car.** Three asks per selection, none while a
  parking view is up.
- **Not root.** The feed runs as `hmi_5000`, as Waze on cluster does.
- **BMW's turn-by-turn box stays visible** on the cluster.

Not done, because it could not be tested and is not needed for a first try:
keeping the picture's shape (one setting once the size is known), a picture on
the HUD, remembering the last choice.

**Safety.** A camera picture in the cluster while driving is a distraction and
may not be legal where you drive. The picture is delayed and can freeze. It is
not a mirror or a parking aid. The first tries belong in a parked car: the
Redline app's authors report that a heavy shader sent to the HUD restarted the
instrument cluster on a car. This design sends the same kind of content as
Waze on cluster (a video picture, no shaders).

## Building

Python 3.11+ and Node.js 18+ on the PC; application sources use Node 8 syntax.

```powershell
npm test                                # offline tests
.cache\node8.exe tools\check-node8.cjs  # the app's modules under Node 8.16.2
npm run build                           # dist\camera_cluster@0.1.0.tgz
npm run preview                         # preview\*.png (simulated states)
npm run build:feed                      # dist\camera-cluster-feed@0.1.0.tgz, see below
npm run catalog                         # dist\catalog.json, needs both packages
```

`npm run build:feed` reads the decoder from the Waze on cluster release file
`.cache\waze-on-cluster@0.9.14.tgz` (2,383,309 bytes, downloaded from
`github.com/robertnisipeanu/idrive-apps/releases` on 2026-11-14). The packer
checks its SHA-256 (`05118ea1...60d8`, pinned in `component.json`) and takes
only the program and its licence from it. `--fetch` downloads it again if it
is missing.

`tests/catalog.test.cjs` checks a head-unit catalog directly when
`CAMERA_CLUSTER_CATALOG` names a `someip-interfaces.json`.

| Path | |
|---|---|
| `apps/camera_cluster/camera.js`, `icam.js` | the camera request and the camera unit's interface |
| `apps/camera_cluster/feed.js` | link to the feed tool |
| `apps/camera_cluster/main.js`, `view.js` | buttons and screen |
| `native/camera-cluster-feed/` | settings, systemd units, manifest, source note |
| `tools/` | builders, Node 8 check, preview, read-only car probe |

## First try on the car (when you decide to)

Parked, engine running or ignition on.

1. Run `tools/probe-hu.sh` on the head unit. Stop if `icam2proxy` is not
   running: the app could not ask for a view. If a drive-recorder app is
   installed, close it first: the camera service keeps one such client.
2. In MGU Store install Cluster renderer, then Camera Cluster with its feed.
3. Open the app, choose **Rear**. Read the three status lines:
   - *Camera unit* stuck on asking or refused: the camera request is the
     problem (interface, view numbers, or the car has no such mode).
   - *Camera unit* on, *Feed tool* connected, no picture: read
     `/var/opt/camera-cluster-feed/log/camera-feed.log`. No `SPS from avb`
     line means nothing was decoded: either no stream was received (access),
     or its packets are in a form the decoder does not read. The file
     `/run/camera-cluster-feed/probe.txt` shows the first packets either way.
   - *Cluster* gives a reason such as the stock map holding the slot: that is
     Cluster renderer's side.
4. Try **Off**, then **Front**, then shift to reverse and back.

**If the stream cannot be joined** (the log says so), the likely cause is
access. To test that, make the service run as root with a drop-in
`/etc/systemd/system/camera-cluster-feed.service.d/root.conf` containing
`[Service]`, `User=root`, `Group=root`, and restart it. If that works the
service user needs another group; do not leave it as root.

**Once a picture shows**, read its size from the app's *Camera picture* line
or the log (`SPS from avb: ... WxH`) and set `map_rect` in `/var/opt/camera-cluster-feed/camera-feed.local.conf` so
the picture keeps its shape (the settings file has an example).

See [VALIDATION.md](VALIDATION.md) for what was and was not verified, and
[NOTICE.md](NOTICE.md) for the components and their licences. BMW's SDK,
firmware, keys and credentials are not included anywhere.
