# HUD Blindspot 0.1.1 validation — November 20, 2026

0.1.1 adds a native Position button menu: select both, left or right; move in
four directions; reset selected offsets; return to the main page. Offsets are
saved in the existing atomic settings storage. Bounds prevent side swapping
and off-viewport movement, including corrupted settings. At a boundary a
reverse press moves immediately; invisible excess offsets never accumulate.
The Position page is a native list, not a second renderer canvas.

At the owner's request, enabled indicators now remain as faint outlines and
fill on a fresh active warning. Acute warnings alternate filled/outlined at
2 Hz. Missing/stale/invalid data removes fills but leaves idle position-marker
outlines. The outlines do not indicate warning-system availability or safety.

New checks exercise independent/group movement, reset and persisted settings,
viewport limits at all sizes, reverse movement at edges, malformed values,
and the overlay's actual separate x/y placement. Background/foreground tests
press every position control and verify native menu navigation.

Built and tested offline on the development PC. No connection to the HU, no
vehicle commands, no coding or firmware modifications, and no car test.

## Evidence checked

The owner's locally held `mgu_someip_service_schema.json` was used for a test
that checks the exact interface, instance, notifier-only field permission,
broadcast output names and typed left/right/qualifier enums. The proprietary
schema was not copied into this project or its release package.

The MGU App Kit is pinned to
`2c6cfdfaa6902f1b469c3784508fadae12b577eb`. Its background/start split is used
so warning processing does not depend on a visible RHMI screen. The package
is marked `mguAppStartType: autostart` and enablement defaults to false.

Cluster renderer's public README/protocol and Redline's HUD implementation
were reviewed for the physical HUD target, image layers, transparency,
coexistence and disconnect handling. The bundled unmodified client retains
its MPL-2.0 notice and full licence. Runtime MIT notices are packaged.

## Offline checks

18 tests passed with the owner's schema supplied, none skipped:

- Independent left/right warning and acute levels, numeric and named enums.
- Standby/unavailable/invalid/inconsistent states, unknown values, partial
  updates, stale samples and clock reversal never authorize active fill.
- Provider loss clears data and late notifications are ignored until the
  provider returns. Raw mirror-event values never create icons by themselves.
- Only subscriptions are used; no setters, diagnostic methods or commands.
- Enable/disable, transparency, small dimensions, placement, independent
  fill clearing, urgent filled/outline blinking and no upload for unchanged steady warnings.
- Disconnect clears cached layers so stale artwork is not replayed; unsupported
  targets and mapping-guard refusal remove graphics without overriding guards.
- Background-only boot without RHMI, all footer controls, saved-setting hooks,
  and shutdown of proxies, timer and renderer connection.
- SDK-free Store archive: source modules match, dependency and ID7 metadata,
  required notices/licences, no BMW SDK, schema, executables or keys.

Node v8.16.2 compiles every shipped application module and executes warning
expiry, artwork, HUD geometry and the real renderer client module. The
SDK-free build succeeded. Synthetic app and HUD previews were rendered and
visually inspected for placement and transparency.

## Unverified on a car

Installation and permissions on this exact HU, whether notifications are
periodic (the fail-hidden expiry is 2 s), signal delivery and latency while
moving, exact matching with the physical mirror LEDs, apparent size and
brightness on glass, background behavior across sleep/profile switches, and
coexistence with each installed HUD app. The typed warning state is not proof
of an electrically lit mirror LED. The renderer tests use a simulated peer;
they do not emulate the KOMBI, RAMSES or the car's warning system.

Missing/stale signal data removes active fills and is reported as unavailable;
only faint position-marker outlines remain while enabled.
The absence of a graphic never means the lane is safe. This release does not
change the factory warning system. ID8 is not claimed or packaged.
