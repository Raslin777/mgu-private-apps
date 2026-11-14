# Third-party components

**App.** The ID7 build uses the MIT-licensed app kit by cauliflowermossgrape
(`cauliflowermossgrape/idrive7-apps`) at commit
`2c6cfdfaa6902f1b469c3784508fadae12b577eb`. Its full licence is included in the
app package as `LICENSE-app-kit`; runtime notices are retained.

**Feed tool.** The `camera-cluster-feed` package contains `waze-on-cluster`, the
render program of Waze on cluster by Robert Nisipeanu
(`robertnisipeanu/idrive-apps`, release `waze-on-cluster@0.9.14`, commit
`f7a678b27693c88a12d2ed4f18ac4652f005bffd`), **GPL-3.0-or-later**, as the
unmodified binary from that project's release. The package carries its
`LICENSE` and a `SOURCE.md` naming where its source is. This repository holds
neither the binary nor its source; `tools/package-feed.py` reads the binary
from the release file after checking its SHA-256. The tool's settings file and
systemd units are this project's own; the unit layout follows the tool format
documented by `robertnisipeanu/mgu-store` (GPL-3.0), with no Store code copied.

Publishing the feed package means distributing a GPL-3.0 program: keep
`LICENSE` and `SOURCE.md` in it, as the packer does.

**Not used.** No IterioDev code or binary is included. Their Turn View and
Drive Recorder (`IterioDev/car-apps`, PolyForm Strict licence, which forbids
modified or derived works) were read to learn which camera interface, values
and stream other cars use; the request logic here is written for this project.

BMW's oap-sdk is supplied by the owner's MGU Store installation and is not
included in this repository or in any generated package.
