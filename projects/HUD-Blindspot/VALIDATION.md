# HUD Blindspot 0.1.0 validation — November 20, 2026

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

14 tests passed with the owner's schema supplied, none skipped:

- Independent left/right warning and acute levels, numeric and named enums.
- Standby/unavailable/invalid/inconsistent states, unknown values, partial
  updates, stale samples and clock reversal never authorize an icon.
- Provider loss clears data and late notifications are ignored until the
  provider returns. Raw mirror-event values never create icons by themselves.
- Only subscriptions are used; no setters, diagnostic methods or commands.
- Enable/disable, transparency, small dimensions, placement, independent
  clearing, urgent blinking and no upload for unchanged steady warnings.
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

Missing/stale signal data removes indicators and is reported as unavailable.
The absence of a graphic never means the lane is safe. This release does not
change the factory warning system. ID8 is not claimed or packaged.
