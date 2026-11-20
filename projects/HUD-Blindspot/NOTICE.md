# Licences and provenance

Original HUD Blindspot application modules and artwork: MIT, Copyright 2026
Raslin777, except the third-party file identified below.

`apps/hud_blindspot/cluster_render_client.js` is an unmodified copy from
`cauliflowermossgrape/idrive7-apps`, commit
`2c6cfdfaa6902f1b469c3784508fadae12b577eb`, `apps/redline/cluster_render_client.js`.
It is Robert Nisipeanu's Node 8 Cluster renderer client, MPL-2.0. Its SPDX
header is retained; the full licence is in `LICENSES/MPL-2.0.txt`. Source for
this exact file is distributed beside the application in this repository.

The bundled MGU App Kit runtime and build templates come from the same pinned
commit, under the MIT licence in `LICENSES/MIT-app-kit.txt`. They carry their
own notices; the builder's default font remains the kit's original assets.
`LICENSE-app-kit` is also shipped in the package. The builder does not include
the optional native GPU renderer. Cluster renderer itself is an independently
installed upstream dependency; its executable is not bundled here.

BMW's SOME/IP schema was consulted locally to identify read-only subscriptions
and warning enums. No BMW schema file, SDK, firmware or key is distributed.
No IterioDev code or binary is used.
