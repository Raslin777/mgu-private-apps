# HUD Blindspot 0.1.3

A faint amber outline on each side of the **windshield HUD**, filling when the
car reports a blind-spot/lane-change warning on that side. The default icons
are 40 by 40 scene pixels at 65% opacity on an iDrive 7 800x480 HUD scene,
with a completely transparent background. Idle outlines use 22% of the selected
opacity (about 14% at the default 65%). Active icons use the full selected
opacity. A blinking/acute warning alternates filled and outlined at 2 Hz.
Both sides can activate together. Outlines are position markers, not an
all-clear or an assurance that the warning system is available.
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
   install **HUD Blindspot 0.1.4**. Alternatively use the release's `catalog.json`.
   The catalog and package declare the renderer dependency.
3. Open **HUD Blindspot**, then press **Enable**. It is disabled on first
   install. **Disable** removes this app's HUD layers and closes its renderer
   connection immediately. The setting is saved.
4. **Size**, **Opacity** and **Height** cycle the corresponding saved settings.
   Settings also offers these options. The defaults are Small / 65% / Middle.
5. **Position** opens a native button menu usable with touch or the iDrive
   controller. Press **Move: Both/Left/Right** to select which indicator moves,
   then use **Move left/right/up/down**. Each press moves about 2% of the HUD
   scene. **Reset selected position** restores the selected side(s) to their
   original offsets under the current Height preset. **Back** returns to the
   app page. All offsets and the selected side are saved across restarts.
6. In **Settings > Warning data source**, use **Auto: SOME/IP, then D347**
   (default), **D347 mirror status only**, or **SOME/IP only**. Auto prefers
   fresh SOME/IP notifications. If they are absent or stale, it uses the
   read-only BDC mirror-status fallback. Diagnostic polling pauses while
   either SOME/IP notification feed is fresh. The center-screen page identifies which source is in use.

Movement is clamped inside a conservative viewport and each icon's half of
the HUD. Repeated presses at an edge do not accumulate invisible movement.
The ID7 viewport is based on the same scene assumptions as the original
placement; the actually visible area varies by vehicle. Nothing is added to
the HUD except the two indicators, including while adjusting positions.

Once enabled the background component watches warnings even when its center-
screen page is closed, and is marked for platform autostart. Actual lifecycle
behavior across sleep/profile changes still needs HU verification. Shutdown
releases the subscriptions, pending read and HUD layers. Disable also stops
UDS reads; SOME/IP-only mode sends no UDS requests. There is no fake live-data mode.

This package targets **iDrive 7 only**. The upstream renderer also supports
iDrive 8, but this app's RHMI package and the owner's checked signal schema
are ID7; this is not an ID8 release.

## Source selection update (0.1.3)

Auto selects the first fresh warning feed in this order:

1. **LateralCollisionAvoidance** (`0xD005`), typed qualifier notifications.
2. **AssistedDrivingViewLateralCollisionAvoidance** (`0x3043`), the
   `statusLaneChangeWarning` portion of `assistedDrivingViewLcaInput`.
3. **BDC D347**, the existing read-only diagnostic fallback.

D347 polling pauses while either SOME/IP feed is fresh. Fresh explicit
fault/unavailable or malformed data from the selected higher-priority feed
remains unavailable; fallback does not hide it. Fresh clear/standby primary
data is also authoritative even if the secondary feed differs. Explicit
D347-only and SOME/IP-only modes remain available; SOME/IP-only considers
the two notification feeds in the same order and sends no diagnostic requests.

The center-screen page shows both providers, decoded qualifier/left/right
values, sample ages, raw primary mirror-event values and last diagnostic
TX/RX bytes. These details never appear on the HUD.

The owner-supplied **someip-interfaces (1).json** was checked directly:
689 interfaces, 674 instance definitions and 7,411 datatypes; SHA-256
`645b929b273197df927dd45d958e82c823a3f1f843f71587baaba03c205c74e4`.
Its primary LCA and TASU interface definitions match the earlier firmware
reference. Its Assisted View event defines a nested lane-change qualifier
and left/right enums; the new adapter uses those exact types. Lane-departure,
side-collision and object-ID fields are ignored. The schema itself is not
included. A defined interface does not prove its provider is running.

## Read-only BDC mirror status (introduced in 0.1.2)

ISTA's `bdc_g11.prg`, `bdc_g05.prg`, `bdc.prg` and `bcp_sp21.prg` all define
`AUSSENSPIEGEL_HC2` / DID **D347**, with separate one-byte left/right mirror
status results. Diag.sqlite corroborates the `STATUS_LESEN` job and argument.
This avoids depending entirely on the LCA SOME/IP service being present.

The only diagnostic request the app can send is **`22 D3 47`**, source F2 to
BDC 40. A positive reply must be exactly `62 D3 47 LL RR`. Values 00 = off,
01 = steady on, 02/03/04 = blinking levels, 0D = display fault, FF = invalid.
The latter two are never treated as active warnings. The three blinking
levels are shown with this app's 2 Hz animation; exact OEM flash timing has
not been established. When D347 is selected as the fallback or explicit source, a fresh positive
mirror-fault/invalid reply remains unavailable.

Reads run only while enabled and D347 is selected or needed as the fallback: one at a time,
at least 250 ms after the previous response (at most four reads per second),
waiting up to 4 s for the reply once the head unit has accepted the request
and 10 s overall (0.1.4; it was 1.5 s in total before, see below). Errors back
off for 2 s. Unsupported/range/access-denied/session refusals stop further
reads until Disable/Enable or a source change. The app does not change
sessions, unlock access, test other addresses, or activate mirror LEDs. Other
apps' BDC traffic is ignored: it neither answers nor cancels a read (0.1.4).
All TASU traffic is shared; some negative replies cannot be uniquely
attributed to a client. Avoid running other diagnostic apps at once.

### 0.1.4: SOME/IP only (November 22, 2026)

The owner does not want the display to depend on diagnostics. From 0.1.4:

- **Auto uses SOME/IP only.** It takes the lane-change warning field, then the
  Assisted View event. It never sends a diagnostic request and never falls
  back to D347.
- **D347 is a test mode.** It runs only when *Test: D347 diagnostics only* is
  chosen in Settings.
- **The primary value is held, not expired.** The primary source,
  `lateralCollisionAvoidanceQualifiers`, is a SOME/IP *field* with a notifier
  and no getter (owner's catalog: service `0xD005`, eventgroup 2). A field is
  state: the last value notified is the current value. Earlier versions threw
  the value away after 2 s, which shows "stale" almost all the time if the car
  only notifies on change. The value is now kept for as long as the provider
  is available, and dropped the moment it is not. The Assisted View source is
  an event and still expires after 2 s.
- **The page counts notifications.** Each SOME/IP line shows "updates N" and
  the age of the last one, so one drive shows whether the car delivers the
  service to the head unit at all, and whether it sends cyclically or only on
  change.

Trade-off of holding: if a notification were lost, an indicator could stay in
its last state until the next one. The mirror lamps remain the warning to rely
on.

**Still unknown, and the main risk:** no program in the head-unit firmware
image uses this service, so nothing shows that the driver-assistance unit
offers it on the head unit's network. If the page says *Provider unavailable*
with *updates 0* while the car's own blind-spot warning works, the service is
not reaching the head unit, and no app change will fix that.

### 0.1.4: "the UDS read never replies" (November 22, 2026)

Reported from the car: the D347 read got no reply. No log from that run was
available, so the cause below is the most likely one found by comparing this
reader with code that does get BDC replies on the same car, not a confirmed
diagnosis.

- **The wait was too short.** The reader gave up 1.5 s after sending and then
  ignored any answer that arrived later. External Lights, whose `22 F1 50` and
  `22 D5 42` reads to the same BDC were answered on the owner's head unit,
  waits 4 s for the reply and 10 s overall, and allows 8 s for the call. The
  reader now uses those waits.
- **A late answer was thrown away.** A `62 D3 47` reply arriving after its read
  had been given up on is now used, and counted as "late".
- **Other apps' traffic cancelled the read.** Any other reply from the BDC,
  for example from a lighting app, ended the read and paused reads for 2 s.
  Such frames are now ignored.
- **A filter on unverified header bytes was removed.** Replies were dropped
  when the first two bytes of the frame header did not match an assumed
  pattern that has never been seen on this car. Frames are now matched only by
  the answering unit and the reply itself.
- **The page now counts.** The bottom line shows reads sent, answered, not
  answered, refused and late, the last and slowest reply time, and the head
  unit's verdict on the last request. One run on the car will show which of
  the above it was, or that the BDC does not answer D347 at all.

What the head unit itself requires of the request was checked in its
diagnostic server's code:
default session, service not deactivated, target not a tester or group
address, at most 4,088 bytes. `F2 -> 40, 22 D3 47` meets all of that, so the
request is not being refused on the head unit by that check.

The app page retains the last TX, UDS RX and raw TASU RX, with the selected
source, sample age and any fallback reason. The log records changed replies
and errors. A successful read is still only reported status; physical mirror
agreement, ECU support and delivery while moving need car verification.

## SOME/IP and rendering evidence

The owner-supplied **someip-interfaces (1).json** and recovered
018_030_018 reference both define the primary LCA contract:

- `de.bmw.dass.driverassistanceapplications.LateralCollisionAvoidance`,
  instance `1`.
- The notifier-only `lateralCollisionAvoidanceQualifiers` field. Its
  `statusLaneChangeWarning` struct has independent left/right enums:
  0 no warning, 1 warning, 2 acute warning, 3 acute warning plus steering.
- `qualifierLaneChangeWarning`: 9/11 are active/active reduced; 1/3 are
  available/available reduced. Unavailable, invalid or inconsistent states
  do not produce active fill.
- The broadcast `requestWarningSteeringWheelExteriorMirror`, with
  `requestExteriorMirrorDisplayWarningLeftHand` and `...RightHand` outputs.
  These are **UInt8 with no enum**, default 15, in the catalog. They are
  retained as raw values on the app page; they do not drive the overlay.

The earlier `Downloads/someip-interfaces.json` lacks LCA; the owner confirmed
that file came from a similar car. The new owner-supplied catalog contains
both LCA feeds. All three interfaces are optional at installation, so missing
providers do not prevent another source from working. No source invents
warning data when unavailable.

When SOME/IP is selected, the app follows the documented **lane-change warning states**.
Exact electrical mirror-LED parity has not been established. It does not
interpret any nonzero mirror-event value as a warning, nor use lane-departure
arrows, turn signals or sunblind fields as a blind-spot substitute.

SOME/IP notifications, rather than polled cached getters, timestamp those samples. A
sample older than **2 seconds** is marked stale and its active fill removed. The
catalog does not document whether this notifier is periodic on every car; if
it is change-only, a steady warning's fill may time out. This needs real signal logs
before changing the expiry policy. A fresh-looking timestamp cannot establish
physical mirror agreement. Missing data is shown as Unavailable on the app
page. While enabled, faint outlines remain as position markers; they do not
mean Clear or that signal data is available.

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
python tools/catalog.py --base-url https://github.com/Raslin777/mgu-private-apps/releases/download/hud-blindspot-v0.1.4
```

For the Node 8 check, supply the official Windows Node v8.16.2 executable at
`.cache/node8.exe`. For the optional local schema check, set
`HUD_BLINDSPOT_SCHEMA` to the owner-supplied `someip-interfaces (1).json` path. The optional
PRG check uses `HUD_BLINDSPOT_PRG` pointing to `bdc_g11.prg`. Neither input is committed.

Artifacts: `dist/hud_blindspot@0.1.3.tgz`, `dist/catalog.json`,
`dist/SHA256SUMS.txt`. Previews in `preview/` are synthetic placement examples,
not photographs or evidence of car operation. The package contains no BMW
SDK, firmware, schema, keys, native renderer binary or emulator.

## First HU check

Install/configure while parked. Confirm Enable/Disable and unobstructed stock
HUD content first. Validate left, right, both, steady, urgent and clear states
against the actual mirror LEDs using a passenger or recorded logs. Do not
operate the setup controls while driving. The app log is `hud_blindspot.log`
in its platform data directory; it records decoded and raw mirror state changes. The app
page shows the selected source, last UDS/TASU replies and sample age. For
the first check use SOME/IP-only mode and inspect provider, qualifier and
left/right updates. Separately test D347-only mode for actual `62 D3 47 LL RR`
responses. Unsupported/negative replies are not evidence of a clear lane.
Check stale/unavailable behavior and renderer coexistence before relying on
the overlay as supplemental information. An absent icon is not an assurance
that a lane is clear.

See [VALIDATION.md](VALIDATION.md) and [NOTICE.md](NOTICE.md).
