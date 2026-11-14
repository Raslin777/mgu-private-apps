# External Lights for MGU

A head-unit app (iDrive 7) that plays light shows on the car's **exterior lamps** and can flash each lamp on its
own, in the manner of light-show. It runs only while the car stands.

**Not car-tested, and the request it sends has never been sent to a car by this project.** It was found in
ISTA's description of the body controller and checked on a PC against a simulated car. Read "Before the first
try" before installing it.

## How the lamps are switched

The body controller (BDC, address 0x40) of the G11 has a diagnostic function for exactly this. From
`C:\EC-APPS\ISTA\Ecu\bdc_g11.prg` (the same function is in `bdc.prg`, `bdc_g05.prg` and `bcp_sp21.prg`):

| | |
|---|---|
| Function | `LEUCHTEN_FUNKTION`, "Steuern der Lampenfunktion" |
| Identifier, services | `0xD542`, `22` and `2E` |
| Argument 1 | `ELEMENT`, signed int (2 bytes, high first), a value of `TAB_LAMPEN_FUNKTION` |
| Argument 2 | `ZEIT`, signed int (2 bytes, high first), in units of 10 ms; 0 = off; up to 32767 (327 s) "as far as allowed for the lamp" |

So one request is `2E D5 42 | lamp (2 bytes) | time (2 bytes)`. High beam for half a second is
`2E D5 42 00 05 00 32`. **The lamp goes off by itself when its time is over.** A flash is one request, and a
lamp can never be left on by a crash, a lost link or a closed app.

The lamps the app uses (`apps/external_lights/lamps.js`), with the table's values:

`01` side lights, `03` low beam, `04` daytime lights, `05` high beam, `06` / `07` indicator left / right,
`08` front fog, `09` / `0A` cornering light left / right, `0C` brake lights, `0E` rear fog, `0F` reversing
lights, `10` / `11` parking light left / right, `12` hazard lights, `15` search light, `16` lit grille.

Left out on purpose: `13` interior light and `14` ambient light (not exterior), `0D` BFD / ESS (the emergency
stop signal) and `19` OVT.

The request goes through the head unit's diagnostic service (`InternalTasu`, the kit's `kit/diag.js`), the same
link Better Lighting uses. That is the only diagnostic call in the app: no session change, no other service, no
other control unit, no coding (`tests/package.test.cjs` holds the source to that).

How Bimmer Light does it is not known to me: it was not read or run. This app does what its user sees, by the
function BMW's own description offers for it.

## What the app does

- **Shows** (`shows.js`): Front to rear, Front and rear in turn, Left and right in turn, Heartbeat, Strobe.
  A show repeats until Stop, until the car moves, or until its time is up (1, 3 or 10 minutes; 3 by default).
- **Lamp test**: pick a lamp with Next lamp, Flash lamp switches it on for one second.
- **Buttons**: Start, Stop, Next show, Next lamp, Flash lamp. They are the head unit's own buttons, so they work
  with and without the kit's touch renderer.
- **The screen** shows the car from above with the lamps the app believes are on, the state, the car's speed,
  and the real time from a request to its answer.
- **High beam and rear fog light** are in shows and tests only when the setting "High beam and rear fog light
  too" is switched on. It is off by default: both dazzle people nearby.

Because the link takes one request at a time and each takes about 200 ms (the kit author's figure, not
confirmed for this car), a show is lamps coming on one after the other, about three a second. Lamps never
switch in the same instant, except the hazard lights, which are one function.

## Safety rules in the code

`apps/external_lights/player.js`:

- **Only while the car stands.** Speed comes from `Vehicle2.statusCarSpeed2` through the kit's `parked.js`.
  Above 3 km/h no show or test starts, and a running show ends within a quarter of a second, with "off" sent for
  every lamp still on. With no speed signal at all (a bench) the kit counts the car as standing.
- **Short on-times.** In the shows a lamp is on for at most half a second; the longest any request may ask for
  is 10 s (the car's own limit is 327 s).
- **Pacing**, as in Better Lighting: one request at a time, the answer awaited, 20 ms rest, never more than 10
  requests a second. The shows use about three.
- **No repeats on trouble.** A refusal ends the show. Three requests without an answer end the show. A lamp the
  car refuses as unknown (`7F 2E 31`) is tried once and left out.
- **It keeps its timing.** A request that could not go out within 150 ms of its moment is dropped, not queued.
- **Not started with the car.** No `autostart`: nothing is sent unless the app is open and Start or Flash lamp
  was pressed.

Using the exterior lamps for a show is for a parked car on private ground. On a public road it can be illegal
and can mislead other drivers (brake lights, indicators, hazard lights). That is the owner's call; the app only
makes sure it cannot happen while driving.

## Layout

```
apps/external_lights/
  lamps.js    the lamp table and the request bytes
  shows.js    the shows: which lamp when, for how long
  player.js   plays a show: pacing, standing check, stop, failures
  view.js     the screen
  main.js     buttons, settings, the kit's link and speed check
```

## Building

Needs Python 3.11+, Node 20+ (for the tests), git.

```bash
python tools/build.py
```

clones the kit at its pinned commit into `.cache/idrive-kit` (from a sibling project's copy if there is one,
else from GitHub), builds with BMW's SDK left out, and writes `dist/external_lights@0.1.0.tgz`. MGU Store
supplies the SDK on the head unit.

```bash
npm test
```

```bash
npm run check:node8
```

```bash
python tools/catalog.py
```

```bash
node tools/preview.cjs
```

Two tests check against files that are not in the repository. Point `EXTERNAL_LIGHTS_PRG` at
`C:\EC-APPS\ISTA\Ecu\bdc_g11.prg` and `EXTERNAL_LIGHTS_CATALOG` at the head unit's `someip-interfaces.json` to
run them.

## Before the first try

What can go wrong, most likely first:

1. **The body controller refuses.** `7F 2E 7F` or `7E` would mean it wants the extended diagnostic session,
   `33` a security unlock, `22` another car state. The app shows which and stops. It does not open a session by
   itself; say so if you want that added.
2. **A lamp behaves differently from its name**: an indicator may blink at the car's own rate or stay on; the
   headlight units (FLE) may fade in or ignore very short times.
3. **A fault entry or a check-control message** for a lamp that was switched this way. ISTA can clear fault
   memory; whether any appears is not known.
4. **The byte layout is wrong** (it is read from the description's argument table, not from a capture). Then
   the car answers `7F 2E 13` or `31` and nothing lights.

A careful first try: park, ignition on, engine off, nobody in front of the car. Next lamp until "Daytime
lights", Flash lamp once, and look at the car and at the screen's top line. Then the brake lights, then a show.
The surest check beforehand is the one that found the interior light's request: run the lamp test in ISTA with
Wireshark on the ENET cable and compare its bytes with `2E D5 42 …` (`BMWCOLOR/tools/parse_ista_pcap.py`).
