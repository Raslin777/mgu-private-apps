# External Lights offline validation — November 14, 2026

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
