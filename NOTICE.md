# Third-party components

The ID7 build uses the MIT-licensed app kit by cauliflowermossgrape at commit
`2c6cfdfaa6902f1b469c3784508fadae12b577eb`. Its full license is included in the
package as `LICENSE-app-kit`; runtime notices are retained.

The root helper's manifest, unit layout and socket settings follow the tool
format documented by robertnisipeanu/mgu-store (GPL-3.0). No Store code is
copied; the units and helper are written for this project.

No IterioDev application implementation is incorporated.

BMW's oap-sdk is supplied by the owner's MGU Store installation and is not
included in this repository or generated release package.

The development workspace also retains an earlier Codex/QR prototype under
`legacy/codex/`. That archive is not included in this repository addition or
release, and none of its code is built into this app.
