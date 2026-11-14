# Better Lighting for MGU

An ambient-light app for a BMW MGU head unit (iDrive 7): any colour, **breathe, pulse and rainbow**, a look for
each driving mode, favourites. It is the app kit's *Ambient config* app (`cauliflowermossgrape/idrive7-apps`,
MIT) with its light driver rewritten after the way the owner's Android app (BMWCOLOR) drives the same body
controller.

**Not car-tested.** Everything below was built and checked on a PC against a simulated car. No timing in this
document was measured on a car; where a number comes from is said each time.

## Why the kit's Ambient config is slow

Paths are in the kit at commit `2c6cfdf` (`.cache/idrive-kit/apps/ambient_config/`).

Every colour goes to the body controller (BDC, address 0x40) as UDS `2E DA5E …` (LIN bus 1) or `2E E3D1 …`
(LIN bus 2) through the head unit's diagnostic gateway service, `InternalTasu.sendTasuRequest`
(`kit/runtime/diag.js:77-96`, `137-163`). That link takes one request at a time, and the answer comes back as a
broadcast event. The kit's author gives about **200 ms for one write** (`lights.js:7`). That figure is theirs,
measured on a G20; it is not confirmed for this car.

On top of that fixed cost the kit spends time in four places:

1. **It reads before it writes.** Nothing is written until both LIN buses have been read with `22 DA5F` and
   `22 E3D1` (`lights.js:56-73`; `_kick` returns while no lights are known, `lights.js:215`). The body controller
   asks its light modules first and answers "a few seconds" later (`lin.js:6-8`). This happens at every start
   (`main.js:49`), and again every two minutes if it fails.
2. **It reads back after every still colour.** 1.5 s after the last write of a still colour it reads both buses
   again to see whether each light took it, twice (`lights.js:98`, `191-212`, `227-231`). The write loop waits for
   those reads (`await this._check()`, `lights.js:227`), and the gateway takes nothing else meanwhile. A second
   colour picked in that window waits for the reads to end. This is the lag felt when stepping through colours.
3. **Lights that differ are written one by one.** A frame is one write to all lights of a bus (NAD 0) plus one
   write for every light that wants something else (`lights.js:171-185`). A whole-car colour is 2 writes; a
   two-colour look on a G20 is 9; the colour wave is one per light (19). Each is a full round trip, one after
   the other (`lights.js:240`). The kit says so itself (`scenes.js:72`).
4. **The screen is drawn on the same thread.** While the app is open and something moves, the whole 1600 x 520
   picture is drawn and packed into a PNG in JavaScript up to 8 times a second (`main.js:263-274`, `293`;
   `kit/runtime/canvas.js:3-6`). Node has one thread, so the lights wait while a picture is made. How many
   milliseconds that costs on the Atom is not known here; the kit logs it on the car as
   `loop MAIN: … ms per frame in JS`.

## Why the Android app is faster

Paths are in `AndroidStudioProjects/BMWCOLOR/app/src/main/java/com/bmwcolor/`.

- **A direct link.** It talks HSFZ over TCP port 6801 straight to the car's gateway as tester 0xF4
  (`data/obd/BdcTcpClient.kt:347-388`, `412-415`) and reads the answer off the socket. There is no gateway
  service in between that queues requests from every app. Its effect steps are 20 to 140 ms apart
  (`AmbientEngine.kt:541`), which only makes sense if an answer comes in tens of milliseconds. The project holds
  no measured answer time, so that is an inference.
- **It never reads the lights.** Zones are a fixed table (`ColorViewModel.kt:38-75`). No discovery, no read-back.
- **Effects are two writes a step.** Rainbow and pulse paint the zone "0 · All": NAD 0 on `DA5E` and on `E3D1`
  (`ColorViewModel.kt:17-21`, `39`; `AmbientEngine.kt:446-492`).
- **Simple pacing.** One request, wait for its answer (up to 600 ms), rest 18 ms, next
  (`AmbientEngine.kt:515-525`, `615-617`). A busy answer (`7F .. 21`) is retried after 220 ms
  (`BdcTcpClient.kt:383-385`).
- **No drawing in the write path.** Effects run in a coroutine on an IO thread; the screen is another thread.

The bytes are the same in both: `2E <DID> | light, on, brightness, red, green, blue, seconds`
(`data/obd/AmbientLightController.kt:68-86`, kit `lin.js:85-87`). The difference is the link and what is sent
around the colour writes, not the colour writes.

## What this app changes

| | Kit's Ambient config | Better Lighting |
|---|---|---|
| First colour after a start | after two status reads | at once: one write a bus to all its lights (NAD 0) |
| Finding the car's lights | every start | once, after the first colour is out; kept in the settings |
| After a still colour | two read-backs of both buses | the same colour written once more 0.7 s later; no reads |
| Colour in a write | of the moment the frame was planned | of the moment the write is sent |
| Pacing | next write the moment the answer is in | answer awaited, 20 ms rest, at most 10 writes a second |
| Screen while something moves | up to 8 pictures a second | up to 4 |
| Animations | Breathing, Rainbow, Smooth fade, Colour wave | + Pulse, + Rainbow through the favourites' colours |

What it does **not** change: the round trip through the head unit's gateway. A one-colour breathe, pulse or
rainbow is two writes a step in the kit and two here. If one write takes 200 ms on this car, that is about
2 steps a second for each bus in both apps. The Android app is faster there because of its direct link, and an
app inside the head unit's sandbox does not have that link. The app shows the real figure on the Colour and
Animations tabs once it is on a car ("… ms a write").

Simulated on a PC, same simulated car for both drivers, **assuming** 200 ms a write and 3 s a status read
(`tests/baseline.test.cjs` runs the kit's unchanged `lights.js` beside this one):

| | Kit | Better Lighting |
|---|---|---|
| Start to first colour on every light | 6.4 s | 0.42 s |
| A second colour picked 2 s after the first | 6.3 s | 0.42 s |
| Status reads in that second case | 4 | 0 |
| One-colour breathe, writes in 20 s | 101 | 91 |

The last row is the honest one for effects: no gain, slightly fewer writes because of the 20 ms rest.

### Request rate

The lighting units are written over and over while an effect runs, so the rate is held to what the two code
bases already do:

- one request at a time, the answer awaited (both);
- 20 ms rest after each answer (Android: 18 ms; the kit: none);
- never more than one write started every 100 ms, so 10 a second at most, however fast the car answers. The kit
  has no ceiling (it sends the next write the moment an answer arrives, about 5 a second at 200 ms). The Android
  app at its default speed does two writes every 85 ms plus answer time, about 10 a second, and more at its
  fastest setting. 10 is inside both;
- a moving effect holds 5 s and is renewed every 3 s; a still colour holds 60 s and is renewed every 40 s (the
  kit's values; the Android app's minimum effect hold is also 5 s);
- four failures in a row pause the writing for 10 s (the kit's rule).

Only four requests exist in the code: `22 DA5F`, `22 E3D1`, `2E DA5E`, `2E E3D1`, all to 0x40
(`tests/lights.test.cjs` and `tests/package.test.cjs` hold it to that). The Android app's extended session
(`10 03`), Fe-Mode writes (`2E 5106`), AWD test, LIN forwarding (`31 01 1009`) and the LIN 3 / 4 DIDs
(`E4A3`, `E4A4`) are not here.

## The effects

`apps/better_lighting/scenes.js`. All run by the clock, so a slow link skips steps and the effect keeps its
length.

- **Breathe**: a smooth swell between 12 % and the look's brightness, 4 s (the kit's).
- **Pulse**: straight up from 3 % to the look's brightness and straight down, 2.2 s (the Android `runPulse`:
  floor 3 %, 12 steps each way at 85 ms).
- **Rainbow**: every colour in 12 s (the kit's), or from one favourite's colour to the next in 3 s each when
  two or more favourites are saved (the Android rainbow's colour list).
- Speed: slow x 1.6, normal, fast x 0.55.

With one colour for the whole car each step is two writes. With different upper and lower colours, breathe and
pulse need a write for each light that differs: 9 a step on a G20, about 2 s a step at 200 ms. Use one colour
for effects. Smooth fade is two writes a step; the colour wave is one per light and stays slow.

Not built, on purpose: a colour byte `FF` is described by the kit as "no change" and by the Android source as
"invalid". If "no change" is right, one write a bus could dim two-colour looks together. Neither code base
sends `FF`, so this app does not either.

## Only what the car has

The driver learns which LIN buses and lights the car has (`lights.buses()`, `lights.known`, `lights.split` in
`lights.js`) and the screen offers only that:

- **The picture** shows the lights read from the car. Before they are read it shows the empty car, not a
  sample car's lights.
- **Upper lights / Lower lights** appear on the Colour tab only when the car has both kinds. Otherwise there is
  only Whole car.
- **Smooth fade** (upper colour to lower colour) is offered only then too. **Colour wave** (light by light) is
  offered only once the lights are read. The Driving modes tab steps through the same reduced list.
- **A status line** under the status text names each bus: `LIN 1: 7 lights, LIN 2: not in this car`, or
  `not read yet`.

A bus counts as not in the car when its status read is refused as out of range (`7F 22 31`), when it answers
with no lights, or when two whole-bus writes to a not-yet-read bus are refused as out of range. Such a bus is
not written again until "Read lights again" on the Colour tab. Which buses *your* car has is not known here:
the app finds out on its first start. Your Android project's fixed zone table lists 24 lights on LIN 1 and 8
(sunroof) on LIN 2, which suggests both are there.

## Design

```
apps/better_lighting/
  lin.js      the bytes: status reply in, write bytes out            (kit, unchanged)
  scenes.js   what each light shows at a moment                      (kit + pulse, rainbow list)
  lights.js   the driver: planning, pacing, renewal, give-back       (rewritten)
  control.js  which look is on: own, driving mode, car's             (kit + rainbow list)
  ambient.js  BMW's 12 menu colours and the driving mode             (kit, unchanged)
  cabin.js    the car picture                                        (kit, unchanged)
  main.js     the four tabs                                          (kit + pulse, rainbow list, "ms a write")
```

The app starts with the platform (`autostart`), so the look and the driving modes work with the app closed, as
in the kit. It uses the kit's `kit/diag.js` for the link, unchanged.

Do not run it together with the kit's Ambient config: both would write the same lights through the same link.
Remove or stop that app first. Redline's shift flash (`/dev/shm/mgu-ambient-flash.json`) is read as in the kit.

## Building

Needs Python 3.11+, Node 20+ (for the tests), git.

```bash
python tools/build.py
```

clones the kit at its pinned commit into `.cache/idrive-kit` (from a sibling project's copy if there is one,
else from GitHub), builds with the kit's builder with BMW's SDK left out, and writes
`dist/better_lighting@0.1.0.tgz`. MGU Store supplies the SDK on the head unit.

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

`check:node8` runs the driver under `.cache/node8.exe` (Node 8.16.2 for Windows; check it against
`.cache/node8-shasums.txt`). `catalog.py` writes a local `dist/catalog.json` for MGU Store; nothing is
published. `preview.cjs` draws the four tabs to `preview/` with the kit's stub head unit; a third word picks the car:
`found` (a G20's 19 lights), `unknown` (not read yet) or `upper` (one bus, upper lights only).

## First try on the car (when you decide to)

1. Stop or remove the kit's Ambient config if it is installed.
2. Install `dist/better_lighting@0.1.0.tgz` through MGU Store. Ignition on, ambient light on in BMW's menu.
3. Colour tab, pick a colour. Expected: the whole car changes within about half a second. Read the
   "… ms a write" line: that is this car's real round trip.
4. Animations tab: Breathe, Pulse, Rainbow with one colour. Read "writes and frames a second".
5. Original colour: the lights go back to BMW's colour.

If the lights do not answer the app says so and offers BMW's 12 menu colours, as the kit does. See
`VALIDATION.md` for what is and is not known.
