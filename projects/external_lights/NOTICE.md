# Third-party components

**App kit.** The app is built with the MIT-licensed app kit by cauliflowermossgrape
(`cauliflowermossgrape/idrive7-apps`) at commit `2c6cfdfaa6902f1b469c3784508fadae12b577eb`. The build adds the
kit's runtime (`kit/runtime/*`, among it `diag.js` for the diagnostic link and `parked.js` for the speed check) to
the package, unchanged. The kit's full licence (MIT, Copyright (c) 2026 cauliflowermossgrape) is included in the
app package as `LICENSE-app-kit`; runtime notices are retained. The app's own files (`lamps.js`, `shows.js`,
`player.js`, `view.js`, `main.js`) are written for this project; the player's pacing rules are those of the
sibling Better Lighting project.

**BMW's ISTA.** The request (`2E D542`), its two arguments and the table of lamp functions were read from the
diagnostic description of the body controller in the owner's ISTA installation (`Ecu/bdc_g11.prg`). They are
facts about the car's interface; no ISTA file, table dump or program is included in this repository or in any
package.

**Bimmer Light and other light-show apps.** None was read, run or copied. The idea (shows on the exterior
lamps) is the only thing in common.

**Not used.** No IterioDev code or binary is included.

BMW's oap-sdk is supplied by the owner's MGU Store installation and is not included in this repository or in any
generated package.
