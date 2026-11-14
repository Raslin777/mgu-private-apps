# Custom apps review — November 14, 2026

Reviewed all four projects in the owner's `My-Custom-Apps` directory, excluding
the emulator. Existing AWD Diagnostic source is preserved. No car connection,
installation, diagnostic request or live AI request was made.

| Project | Tests on this PC | Compatibility/build |
|---|---|---|
| AI Terminal 0.3.0 | 57 passed | Node 8 runtime and phone-link HTTP checks passed; app rebuilt and RSA retained |
| Better Lighting 0.1.0 | 36 passed, 1 catalog-dependent check skipped | Node 8 simulation and SDK-free build passed |
| Camera Cluster 0.1.0 / feed 0.1.0 | 25 passed, 1 catalog-dependent check skipped | Node 8 simulation, SDK-free app and pinned decoder packaging passed |
| External Lights 0.1.0 | 19 passed, 1 catalog-dependent check skipped | Includes ISTA reference-file verification and new empty-lamp regression; Node 8 simulation and SDK-free build passed |

137 tests passed in total; 3 optional head-unit catalog checks were skipped.
These figures describe this review run; individual project validation files
also retain historical checks from development.

## Finding fixed

External Lights filtered refused lamps from its selector without handling an
empty result. Once every selectable lamp was refused, drawing dereferenced
an absent lamp and the buttons used modulo zero. The screen now shows
`No available lamps`, selection stays valid, and Flash sends nothing when
there is no lamp. A regression exercises the main module's drawing and buttons.

## Source and packages

The three newly added projects retain independent layouts under `projects/`.
App archives were checked against current JavaScript source and exclude BMW's
SDK and extracted firmware. The camera feed is built from the hash-verified
upstream Waze on cluster 0.9.14 release, carries its license/source notice,
and has a matching upstream source archive attached to this release.

AI Terminal's source matches the previously published 0.3.0 version; its
existing release remains the install source. The rebuilt app was checked to
retain the owner's RSA key, and the original PEM is unchanged. No API keys,
helper tokens, firmware, caches or emulator files are committed.

Camera Cluster requires the feed tool and upstream Cluster renderer 0.5.3 or
newer. Its camera request, media permissions, decoder and cluster behavior
remain unverified on a car. Lighting timings and movement handling are
simulations; External Lights currently uses the kit's behavior that missing
speed data counts as stationary. No claim of live compatibility follows from
the passing tests. See each project's README for its operating limits.
