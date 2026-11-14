# Better Lighting offline validation — November 14, 2026

Nothing here was run on a car or a head unit. The head unit was not contacted. Every timing below comes from a
simulated car whose answer times are assumptions.

## Verified on the development PC

**Tests** (`npm test`, Node 26.13.1): 37 tests, 36 pass, 1 skipped (the catalog-file check, which needs
`BETTER_LIGHTING_CATALOG`; run with it set to the owner's `someip-interfaces.json`, it passes).

- *Request building* (`tests/scenes.test.cjs`): the write is `DID, light, on, brightness, red, green, blue,
  seconds`; colours stop at FE, brightness at 100, hold between 1 and 254 s; the give-back write; the status
  reply parser.
- *Only ambient-light requests* (`tests/lights.test.cjs`, `tests/package.test.cjs`): over a long mixed run every
  request the driver sent was `22 DA5F`, `22 E3D1`, `2E DA5E …` or `2E E3D1 …` to address 0x40, and the sources
  contain no other diagnostic call, no socket and no process use.
- *Pacing* (`tests/lights.test.cjs`): never a second request before the answer to the first; at least 20 ms
  after each answer; at least 100 ms between the starts of two writes, checked with a simulated car that answers
  in 5 ms (about 100 writes in 10 s, not more).
- *Breathe, pulse, rainbow*: one write a bus a step to all its lights, each carrying the colour of the moment it
  is sent; the brightness reaches bottom and top; the rainbow passes every hue; the favourites' colour list;
  5 s hold renewed so no light falls back to the car's colour in between.
- *Start and still colours*: colour before any read; the lights read once and kept; no read at the next start;
  the second write reaches a light that missed the first; renewal before the 60 s hold ends.
- *What the car has*: the bus summary the screen uses (unknown, present with counts, absent), upper and lower
  both there or not, a bus that answers with no lights left alone afterwards.
- *Failures*: a car with one bus; no answer (pause after four tries, on again when it answers); a refusal.
- *Flash, night dim, once-only scenes, give-back, a status read during an animation.*
- *Look control* (`tests/control.test.cjs`): animation choice, rainbow through favourites, driving-mode look.
- *Against the kit* (`tests/baseline.test.cjs`): the kit's unchanged `lights.js` and this driver on the same
  simulated car at 200 ms a write and 3 s a read. Start to first colour 6.4 s against 0.42 s; a second colour
  after 2 s, 6.3 s against 0.42 s; one-colour breathe, 101 against 91 writes in 20 s.

**Node 8** (`npm run check:node8`): under Node v8.16.2 (`.cache/node8.exe`, SHA-256
`e4e2c2aadcae1f6b5fe1936a4606b2fb59fbcfda263114e3abd10892d1433024`, the `win-x64/node.exe` line of
`.cache/node8-shasums.txt`) all 7 app files compile, and the driver with the look control ran a colour, breathe,
pulse, rainbow, a driving-mode look and the give-back on the simulated car. `main.js` and `cabin.js` are only
compiled there: they need the kit's runtime and BMW's SDK to run.

**Screen** (`node tools/preview.cjs`, current Node, the kit's stub head unit): the built app starts and draws all
four tabs without an error, for three cars: 19 lights kept, lights not read yet (empty picture, no Smooth fade or
Colour wave, Whole car only), and one bus of upper lights (no Smooth fade, Whole car only, `LIN 1: not in this
car`). The stub has no diagnostic link, so this is the "lights did not answer" state.
Touch buttons are drawn by the head unit's renderer and are not in these pictures.

**Package** (`python tools/build.py`): `dist/better_lighting@0.1.0.tgz`, built with the kit at commit
`2c6cfdfaa6902f1b469c3784508fadae12b577eb`, 103 entries. It contains the app's files as in `apps/`, the kit's
runtime, `LICENSE-app-kit`, `NOTICE.md`; no `oap-sdk`, no `node_modules`. `dist/catalog.json` names it with its
size and SHA-256. Nothing was installed, published, committed or pushed.

**Interface names** were checked against the owner's catalog (`someip-interfaces.json`): `InternalTasu`
instance `SystemFunctionsInternalTasuInst1`, method `sendTasuRequest` with its seven inputs, event
`sendTasuResponse`; `ComfortFunctionIuK`, `FES` and `Vehicle` instance `1` with the fields the app asks for.

## Not verified

- **Any timing on a car.** 200 ms a write is the kit author's figure from a G20. 3 s a status read is a stand-in
  for the kit's "a few seconds". This car's values are unknown until the app shows "… ms a write".
- **That this car's body controller takes these writes** from the head unit: `2E DA5E` / `2E E3D1` in the
  default session. The kit reports it car-tested on a G20 (BDC_G05); the Android notes report it from an ISTA
  capture. The Android app opens an extended session first; this app, like the kit, does not.
- **NAD 0 reaching every light of a bus** on this car. Both code bases rely on it.
- **Writing before the lights are known.** New here. On a car without LIN bus 2 the app expects a refusal
  `7F 2E 31` and stops trying that bus after two; what such a car really answers is not known.
- **Which LIN buses and lights this car has.** The app reads that on the car; it was not read for this work.
  How this car answers for a bus it does not have is a guess (`7F 22 31` / `7F 2E 31`).
- **Dropping the read-back.** The kit says a `6E` answer does not prove a light took the colour. This app writes
  a still colour twice instead of reading back. A light that misses both keeps the wrong colour until the
  renewal 40 s later.
- **Effects on the real lights**: how breathe, pulse and rainbow look at this car's real step rate, and whether
  the LIN modules show any flicker at 5 s holds.
- **The screen's cost** on the Atom and whether 4 pictures a second is the right trade.
- **Installation through MGU Store**, autostart, and behaviour next to other apps that use the diagnostic link
  (they share it; a busy link is retried as in the kit).
- **Running beside the kit's Ambient config.** Not supported: both write the same lights.
- **The flash file** written by Redline, and the day / night and driving-mode signals: the kit's code, unchanged,
  not exercised here beyond the look control test.
- **Long runs**: hours of a moving effect at up to 10 writes a second. The rate is inside what the kit and the
  Android app already send, but neither project documents a long-run limit for the lighting units.
