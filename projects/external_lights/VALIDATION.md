# External Lights 0.2.9 validation — November 15, 2026

The supplied HU screenshot confirms that F4 identity and D542 reads succeeded,
but extended-session setup and default cleanup returned `7F 10 13`. No lamp
write is present in this attempt. The screenshot does not capture outgoing
vehicle-bus bytes and does not establish the cause of the length/format error.

Candidate change: session and keepalive requests use TASU's separate UInt8
subroutineID, an empty data buffer and data length zero. The local HU SOME/IP
schema confirms the API shape, not the native transport's encoding semantics.
The existing BMW reference package uses subroutineID zero for its generic
jobs; it does not establish the correct session-control mapping. HU confirmation
of `50 03` and `50 01` remains required. No live ECU requests were made here.

Regression coverage exercises the real app Transport on normal F2 and each
test source for setup/keepalive/cleanup, checking every API field and that only
one call is made. It also reproduces session/cleanup NRC 13, retains both raw
replies, verifies outgoing API fields are available on screen, and proves no
lamp write is sent after failed session setup. Node 8 executes the encoding
path as well as compiling the shipped modules.

Offline result: 68 tests, 66 passed, two optional ISTA/HU-catalog checks skipped;
Node 8.16.2 compatibility passed; SDK-free 0.2.9 package built and its source
content matched the app files in the package tests. These checks do not emulate
the native TASU serializer or prove that the BDC will accept this encoding.

## Previous 0.2.8 validation

Current run: 66 tests, 64 pass; the optional ISTA-file and HU-catalog checks
are skipped. The SDK-free build and Node 8.16.2 checks pass; the built app was
run on the offline HU stub through every button.

The speed check is off as well as the Park check (`SPEED_CHECK = false`,
`PARK_CHECK = false` in `vehicle.js`). Tests of the shipped default: nothing
blocks with no signal, any selector value, any speed or stale speed; the write
test runs with no signals and while moving in Neutral; Stop during the write
still switches the lamp off and restores the default session; the lighting
page's speed warning is still produced. Both checks' logic is unchanged and
still tested switched on, together and speed alone.

No HU connection was made. Not verified: anything on the HU, including what
the BDC answers to the write. The app no longer prevents the write test while
the car is moving.

## Previous 0.2.7 checks

Current run: 65 tests, 63 pass; the optional ISTA-file and HU-catalog checks
are skipped. The SDK-free build and Node 8.16.2 checks pass; the built app was
run on the offline HU stub through every button.

The Park check is off (`PARK_CHECK = false` in `vehicle.js`). New tests cover
the shipped default: zero speed alone clears the warning with no selector
signal, with Neutral, Reverse, a gear or an invalid value; the write test runs
in Neutral at zero speed; moving, stale or missing speed still blocks it. The
Park logic itself is unchanged and still tested with the check switched on.

No HU connection was made. Not verified: that the write test now gets past the
app-side block on the HU (it still needs `statusCarSpeed2` delivered there and
reading 0), and what the BDC answers to the write.

## Previous 0.2.6 checks

Current run: 62 tests pass; one optional HU catalog check is skipped.
The SDK-free build and Node 8.16.2 checks pass. The latter also executes
the powertrain selector's numeric Park/Neutral cases.

The additional event-only permission is checked against the pinned upstream
Car Vitals manifest and against the generated install manifest. Regression
coverage checks Park from DataPowerTrain2 without any gearbox-stage event,
both enum mappings, fresh conflicting signals, stale Park, missing/invalid/
nonzero speed, unknown/N-or-P selections, sample-age display, and the complete
guarded indicator test using the fallback. Fresh Neutral must send no request.

The telemetry line was rendered with simulated values and visually checked.
No HU connection was made. The owner's screenshot confirms a positive D542
read and an app-side Park block; it does not identify which selector signal
the HU actually supplies. That still needs checking using the new raw inputs.

## Previous 0.2.5 checks

Current run: 57 tests pass and one optional HU catalog check is skipped.
The SDK-free build and Node 8.16.2 checks pass. The package now contains a
single canvas (MAIN) plus SETTINGS, rather than a second diagnostics canvas.

The renderer's single-canvas behavior is checked against the pinned Display
implementation. A navigation regression exercises 150 test-page redraws,
five Back/reopen cycles, footer label restoration, Read/Write source selection,
Earlier/Later scrolling, the busy Stop test label and lighting activation
blocking while a test is active. It asserts one loop, one image component,
and no RHMI openState calls for page navigation. The packaged app-spec is
also checked to prevent accidentally shipping the previous second canvas.

The expanded offline preview navigates into tests, through its controls,
back to lighting, and into tests again; the rendered pages were inspected.
The former preview did not exercise the GPU renderer's first-canvas/visibility
restriction. No live HU check was performed, so vehicle confirmation remains
outstanding.

## Previous 0.2.4 checks

Current run: 56 tests pass and one optional HU catalog check is skipped.
Nine app JavaScript files compile under Node 8.16.2. The address-test
controller also executes a simulated parked write workflow and a moving
write refusal under Node 8. The SDK-free package includes the new controller
byte-for-byte and retains the subscription-only gearbox permission.

New coverage verifies selected-source reads, one 500 ms indicator write,
lamp-off/default-session cleanup, prevention of overlapping shows/tests,
Stop or movement during a test, missing/stale telemetry, NRC22 retention
without fallback/replay, source F2 preservation for normal lighting,
low-level parked-write guards, successful TX/RX display and reply paging.
All new navigation/buttons were exercised with the offline HU stub. The
diagnostic screen was rendered with simulated responses and visually checked.

No vehicle connection was made. Alternate-source handling by the HU, the
Park/speed telemetry on that HU, actual lamp operation and restoration still
require verification. The original NRC22 prerequisite remains unidentified.

## Previous 0.2.3 checks

Current run: 45 tests pass and one optional HU catalog check is skipped.
The local ISTA description check, SDK-free package checks and Node 8.16.2
compatibility pass. Node 8 executes the new transport's routing-rejection
and inner-ECU-NRC paths as well as compiling all eight app JavaScript files.

New regression coverage exercises TASU header rejections, inner ECU NRC22,
unrelated ECU/service/DID frames, failed method calls, disconnection, listener
cleanup, hard deadlines, late method failures, overlapping requests, F2
source-address preservation and session invalidation by foreign responses.
The unchanged production-session simulation remains serialized.

This fixes confirmed transport/session handling defects. It does not establish
the prerequisite behind the observed ECU NRC22, and is not a verified cure for
that refusal. No vehicle was connected and no gateway routing mode changed.

## Previous 0.2.2 checks

34 tests pass and one optional HU catalog check is skipped. The local ISTA
reference-file check passes. SDK-free build and Node 8.16.2 compatibility pass.

New coverage includes read-only preflight, matching session replies,
unavailable TASU, empty/refused capability and identification reads, session
refusal, keepalive in quiet gaps, lost session replies, failed cleanup,
forbidden brake/headlight requests, no replay after an uncertain activation,
serialized requests, Stop during setup and movement/stale-telemetry warnings.
The real session controller is exercised with the player against a simulated
BDC. Movement does not prevent writes in the production configuration.

No head unit or car was connected. Actual ECU acceptance, physical lamp
output/restoration and physical shutdown timing remain unverified. Stop other
diagnostic clients; observed foreign-DID detection is not a global TASU lock.
The new selector field is based on the pinned kit's
VehicleInformation.statusGearboxDrive; availability on this HU has not been
rechecked against its catalog in this run.

The 0.2.1 regression compares the gearbox subscription permission against
the pinned upstream app manifest and verifies the packaged SOME/IP manifest
uses subscription-only access. Live installation has not been verified.

The 0.2.2 checks cover NRC 22 at each workflow phase, separate primary and
cleanup refusals, malformed/unrelated replies and timeouts, plus on-screen
phase/ECU/TX/RX details within the canvas bounds. A simulated error screen was
rendered and visually inspected. Upstream Ambient Config's pure gate functions
were evaluated with moving=true: its show is blocked, its strobe is allowed
when enabled and occupied. This is source-level evidence only; no ECU or
head unit was connected or changed.

## Historical 0.1.0 validation — November 14, 2026

Nothing here was run on a car or a head unit. The head unit was not contacted. The request `2E D542` was never
sent to a car by this project. Every timing comes from a simulated car whose answer time is an assumption.

## Verified on the development PC

**ISTA's description** (`C:\EC-APPS\ISTA\Ecu\bdc_g11.prg`, read with the XOR-0xF7 decoding of the owner's
BMWCOLOR tools): `LEUCHTEN_FUNKTION` is `0xD542` with services `22;2E` and an argument table of exactly two
arguments, `ELEMENT` (signed int, high byte first, values of `TAB_LAMPEN_FUNKTION`) and `ZEIT` (signed int, high
byte first, not scaled, "Angabe der Zeit in 10ms 0: aus max. 32767: 327sec sofern für die Lampe zugelassen").
The table's rows for all 17 lamps the app uses were found with their values. `tests/package.test.cjs` repeats
this check when `EXTERNAL_LIGHTS_PRG` points at the file. The function name also occurs in `bdc.prg`,
`bdc_g05.prg` and `bcp_sp21.prg`.

**Tests** (`npm test`, Node 26.13.1): 19 tests, 17 pass, 2 skipped (the two that need the ISTA file and the
head unit's catalog; with `EXTERNAL_LIGHTS_PRG` and `EXTERNAL_LIGHTS_CATALOG` set, all 19 pass).

- *Request bytes*: `2E D5 42`, lamp in two bytes, time in 10 ms in two bytes; never 0 by rounding; at most 10 s.
- *Only this request*: over every show, a stop and a lamp test, each request was `2E D542…` to 0x40, well
  formed, never two at once, no on-time above one second. The sources hold a single diagnostic call.
- *A show on the simulated car*: each event sent at its moment, lamps on for their time and off by themselves.
- *Pacing*: 20 ms after each answer, at most 10 requests a second on a car that answers in 5 ms; what does not
  fit is dropped, not queued. On a slow link (450 ms) late events are left out and the show keeps its timing.
- *Standing only*: nothing starts while moving; driving off ends the show within 250 ms and sends "off" for the
  lamps still on; nothing is sent afterwards.
- *Stop, time limit, a lamp the car lacks, a car with none of a show's lamps, refusals (session, security), no
  answer (three tries, then the end), the lamp test.*
- *Manifest*: no autostart, five buttons, high beam and rear fog off by default, only the diagnostic link and
  the speed signal asked for.

**Node 8** (`npm run check:node8`): under Node v8.16.2 (`.cache/node8.exe`, SHA-256
`e4e2c2aadcae1f6b5fe1936a4606b2fb59fbcfda263114e3abd10892d1433024`) all 5 app files compile; the five shows, a
lamp test, the screen, driving off and Stop ran on the simulated car. `main.js` is only compiled there.

**The built app on the kit's stub head unit** (`node tools/preview.cjs`): it starts, each of the five buttons has
a handler and was pressed, and the screen was drawn after each. The stub has no diagnostic link and no speed
signal, so the screen reads "No diagnostic link to the car" and nothing was sent anywhere.

**Package** (`python tools/build.py`): `dist/external_lights@0.1.0.tgz`, kit commit
`2c6cfdfaa6902f1b469c3784508fadae12b577eb`, 101 entries; the app's files as in `apps/`, the kit's runtime,
`LICENSE-app-kit`, `NOTICE.md`; no `oap-sdk`, no ISTA file. `dist/catalog.json` names it with size and SHA-256.
Nothing was installed, published, committed or pushed.

**Interface names** checked against the owner's `someip-interfaces.json`: `InternalTasu`
(`SystemFunctionsInternalTasuInst1`, `sendTasuRequest`, `sendTasuResponse`) and `Vehicle2` instance `1`,
field `statusCarSpeed2`.

## Not verified

- **That the car takes `2E D542` at all**, from the head unit, in the default diagnostic session, without a
  security unlock. The app opens no session. A refusal is shown with its reason and ends the show.
- **The byte layout on the wire.** It is read from the description's argument table. The same reading matched
  an ISTA capture for the interior light's `DA5E`, but this request was never captured.
- **What each lamp really does**: whether indicators blink or stay on, how the headlight units treat times of
  120 to 500 ms, which lamps a 750i of this build has (front fog, lit grille, search light may be absent), and
  which times the car allows per lamp.
- **Fault memory and check-control messages** after lamps were switched this way.
- **Any timing.** 200 ms a request is the kit author's figure from another car.
- **The standing check on the car**: that `statusCarSpeed2` is delivered to this app and reads 0 when parked.
  The kit's `parked.js` counts "no speed signal at all" as standing.
- **The end of a show when the app is closed.** The platform gives 200 ms; an "off" may not get out. Lamps then
  go off by their own time (at most 1 s in the shows and the test).
- **Battery and lamp wear** over a 10-minute show, and the effect on other apps that use the diagnostic link.
- **Installation through MGU Store** and the five buttons on the real screen.
- **How Bimmer Light works.** It was not examined; this app shares only the idea.
