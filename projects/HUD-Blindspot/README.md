# HUD Blindspot 0.1.0

A small amber warning on the left or right of the **windshield HUD** when the
car reports a blind-spot/lane-change warning on that side. The default icons
are 40 by 40 scene pixels at 65% opacity on an iDrive 7 800x480 HUD scene,
with a completely transparent background. An acute warning blinks at 2 Hz.
Both sides can appear together. There is no all-clear symbol on the HUD.
The app draws only these two indicators: no speed, MPH/km/h, gauges, labels
or other readouts. Settings and diagnostic text stay on the center screen.

**Offline-tested prototype, not car-tested.** Signal availability, warning
timing, physical visibility and agreement with the mirror LEDs need checking
on the actual car. This is a supplemental display, not a replacement for the
factory mirror warnings or checking before changing lanes.

## Install and use

1. In MGU Store, add `robertnisipeanu/idrive-apps` as a Releases source and
   install/update **Cluster renderer 0.6.7 or newer**. Follow its restart/setup
   instructions. This app uses the existing renderer; it does not install a
   second RAMSES participant or patch firmware.
2. Add `Raslin777/mgu-private-apps` as a **Releases** source, refresh, and
   install **HUD Blindspot 0.1.0**. Alternatively use the release's `catalog.json`.
   The catalog and package declare the renderer dependency.
3. Open **HUD Blindspot**, then press **Enable**. It is disabled on first
   install. **Disable** removes this app's HUD layers and closes its renderer
   connection immediately. The setting is saved.
4. **Size**, **Opacity** and **Height** cycle the corresponding saved settings.
   Settings also offers these options. The defaults are Small / 65% / Middle.

Once enabled the background component watches warnings even when its center-
screen page is closed, and is marked for platform autostart. Actual lifecycle
behavior across sleep/profile changes still needs HU verification. Shutdown
releases the subscriptions and HUD layers. There is no fake live-data mode.

This package targets **iDrive 7 only**. The upstream renderer also supports
iDrive 8, but this app's RHMI package and the owner's checked signal schema
are ID7; this is not an ID8 release.

## Signal and rendering evidence

The owner's local HU SOME/IP catalog lists:

- `de.bmw.dass.driverassistanceapplications.LateralCollisionAvoidance`,
  instance `1`.
- The notifier-only `lateralCollisionAvoidanceQualifiers` field. Its
  `statusLaneChangeWarning` struct has independent left/right enums:
  0 no warning, 1 warning, 2 acute warning, 3 acute warning plus steering.
- `qualifierLaneChangeWarning`: 9/11 are active/active reduced; 1/3 are
  available/available reduced. Unavailable, invalid or inconsistent states
  do not produce icons.
- The broadcast `requestWarningSteeringWheelExteriorMirror`, with
  `requestExteriorMirrorDisplayWarningLeftHand` and `...RightHand` outputs.
  These are **UInt8 with no enum**, default 15, in the catalog. They are
  retained as raw values on the app page; they do not drive the overlay.

The app therefore follows the documented **lane-change warning states**.
Exact electrical mirror-LED parity has not been established. It does not
interpret any nonzero mirror-event value as a warning, nor use lane-departure
arrows, turn signals or sunblind fields as a blind-spot substitute.

Notifications, rather than polled cached getters, timestamp the samples. A
sample older than **2 seconds** is marked stale and its icons removed. The
catalog does not document whether this notifier is periodic on every car; if
it is change-only, a steady warning may time out. This needs real signal logs
before changing the expiry policy. A fresh-looking timestamp cannot establish
physical mirror agreement. Missing data is shown as Unavailable, not Clear.

The renderer receives two small RGBA image layers, target `hud`, class
`overlay`, nonexclusive, with no slot contention or guide hold. It retains
its normal arbitration, stock-warning handling and mapping guard. The app
does not force its graphics over a stock popup or reset a renderer guard.
If the renderer refuses or disables the HUD, the page reports it. A guard
failure needs the renderer's own documented diagnosis; do not clear it merely
to force this prototype to appear.

## Similar projects researched

- [Redline HUD](https://github.com/cauliflowermossgrape/idrive7-apps/tree/main/apps/redline):
  MGU App Kit, background apps and small image layers on the physical HUD.
- [Cluster renderer](https://github.com/robertnisipeanu/idrive-apps/tree/main/native/cluster-render):
  shared HUD target, RGBA transparency/opacity, layer arbitration and Node 8
  socket client. This app bundles its MPL-2.0 client from the pinned kit.
- [bimmer-lab HUD Widgets](https://github.com/bimmer-lab/apps): another app
  using this renderer for windshield HUD readouts; no code copied from it.

No exact BMW mirror-warning-to-HUD implementation was identified in the
GitHub searches used for this build. Rendering is based on existing projects;
the warning subscription/decoder and indicator artwork are original here.

## Build and check

Requires Python 3.11+, Git and Node.js on the PC. The builder clones the pinned
MIT kit into `.cache/idrive-kit` (using a sibling checkout when present),
never edits a sibling project, and produces an SDK-free MGU Store package:

```powershell
python tools/build.py
npm test
npm run check:node8
npm run preview
python tools/catalog.py --base-url https://github.com/Raslin777/mgu-private-apps/releases/download/hud-blindspot-v0.1.0
```

For the Node 8 check, supply the official Windows Node v8.16.2 executable at
`.cache/node8.exe`. For the optional local schema check, set
`HUD_BLINDSPOT_SCHEMA` to the owner's JSON catalog path. Neither is committed.

Artifacts: `dist/hud_blindspot@0.1.0.tgz`, `dist/catalog.json`,
`dist/SHA256SUMS.txt`. Previews in `preview/` are synthetic placement examples,
not photographs or evidence of car operation. The package contains no BMW
SDK, firmware, schema, keys, native renderer binary or emulator.

## First HU check

Install/configure while parked. Confirm Enable/Disable and unobstructed stock
HUD content first. Validate left, right, both, steady, urgent and clear states
against the actual mirror LEDs using a passenger or recorded logs. Do not
operate the setup controls while driving. The app log is `hud_blindspot.log`
in its platform data directory; it records decoded and raw mirror state changes. The app
page shows current raw mirror-event values and the warning sample's age.
Check stale/unavailable behavior and renderer coexistence before relying on
the overlay as supplemental information. An absent icon is not an assurance
that a lane is clear.

See [VALIDATION.md](VALIDATION.md) and [NOTICE.md](NOTICE.md).
