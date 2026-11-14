# Third-party components

**App kit and its Ambient config app.** This app is built with, and derived from, the MIT-licensed app kit by
cauliflowermossgrape (`cauliflowermossgrape/idrive7-apps`) at commit
`2c6cfdfaa6902f1b469c3784508fadae12b577eb`:

- `apps/better_lighting/ambient.js`, `cabin.js`, `lin.js` and `icon.png` are that project's
  `apps/ambient_config/` files, unchanged.
- `control.js`, `main.js`, `scenes.js` and `app.json` are its files with changes (named in each file's header).
- `lights.js` is rewritten; its request bytes, frame planning, hold and renewal times and failure pause are the
  kit's.
- The kit's runtime (`kit/runtime/*`) is added to the package by the build, unchanged.

The kit's full licence (MIT, Copyright (c) 2026 cauliflowermossgrape) is included in the app package as
`LICENSE-app-kit`; runtime notices are retained.

**The owner's Android app.** The pacing rules (one write at a time, the answer awaited, a rest after it), the
no-read approach, the pulse and the rainbow's colour list follow the owner's own BMWCOLOR Android project
(`AmbientEngine.kt`, `BdcTcpClient.kt`). They are written anew in JavaScript; no Kotlin source is included. That
project's other functions (extended session, Fe-Mode writes, the AWD test, LIN forwarding, DIDs E4A3 / E4A4) are
not used here.

**Not used.** No IterioDev code or binary is included. Their Ambient Light app (`IterioDev/car-apps`, PolyForm
Strict licence, which forbids modified or derived works) was not used as a source.

BMW's oap-sdk is supplied by the owner's MGU Store installation and is not included in this repository or in any
generated package.
