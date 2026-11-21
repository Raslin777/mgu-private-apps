# HUD Blindspot 0.1.3 validation — November 20, 2026

Built and tested offline. No HU connection, live UDS request, vehicle coding or firmware modification was performed.

## Source correction and evidence

0.1.3 was checked directly against the owner-supplied `someip-interfaces (1).json`:
689 interfaces, 674 instance definitions, 7,411 datatypes; SHA-256
`645b929b273197df927dd45d958e82c823a3f1f843f71587baaba03c205c74e4`.
The primary LCA and TASU contracts match the older 018_030_018 reference.
The additional Assisted View adapter follows the new file's nested
`statusLaneChangeWarning` qualifier and side enums, ignoring lane departure,
side collision and object IDs. Both SOME/IP feeds are optional and independently
subscribed/aged. Auto prefers primary LCA, then Assisted View, then D347.
Definitions are verified; provider availability and actual mirror agreement
remain car checks. The earlier file lacking LCA was from a similar car.

0.1.2 adds an independent read-only path: **22 D3 47** to BDC 40 from F2. ISTA's bdc_g11.prg, bdc_g05.prg, bdc.prg and bcp_sp21.prg define AUSSENSPIEGEL_HC2 / D347. Their result tables give one left byte, then one right byte: 00 off, 01 steady, 02/03/04 blinking levels, 0D display fault, FF invalid. Diag.sqlite corroborates the BDC STATUS_LESEN mirror job and argument.

The optional PRG test checks the actual function, result-table order/types and enum table against the decoder. None of these proprietary inputs are distributed. The outgoing request has fixed target/source/SID/DID; no session change, security access, actuator control or alternate tester identity is implemented. These are active diagnostic reads, not passive CAN monitoring.

## Offline verification

**34 tests passed, none skipped**, with the new owner-supplied schema and bdc_g11.prg supplied:

- Correct D347 request fields and left/right decoding, including value 04. Wrong DID, malformed length, faults and invalid values never fill icons.
- Single-flight reads, 250 ms minimum delay after a reply, a 1.5 s deadline, error backoff and no reads while disabled or in SOME/IP-only mode.
- Unsupported/range/access/session refusals latch until Disable/Enable or a source-change cycle. The adapter never attempts to unlock the ECU.
- Different ECU/tester replies are ignored. Observed other BDC traffic yields the shared link. ECU negative replies and outer TASU errors remain distinct with raw bytes retained.
- Response-pending replies stay within the original deadline. Stalled method calls cannot overlap another read; late rejections are handled.
- Provider loss, stale samples, clock reversal, shutdown and Disable remove active data. Unavailable is never inferred to mean the lane is clear.
- Primary and Assisted View enums, event/field access and instance IDs match the new JSON. Only nested lane-change warnings can drive the secondary source. Fresh primary clear, standby and errors take priority over conflicting secondary data.
- Auto prefers fresh SOME/IP, pauses diagnostic reads while the primary is fresh, switches to Assisted View after primary expiry and D347 after both expire and resumes the primary when notifications return. Fresh explicit primary errors remain unavailable; selected D347 errors are also preserved. The real background adapter runs against a simulated HU without LCA.
- Source selection, both SOME/IP providers/qualifier/side values/age, last TX, UDS RX and raw TASU RX appear on the center-screen page. The HUD still draws only two indicators.
- Existing enable/disable, independent/group positioning, bounds, reset, saved-setting hooks, transparency, fill/blink and renderer disconnect/guard handling pass.
- Archive sources match the app; ID7/autostart/dependency metadata and licences are present. No BMW SDK, ISTA data, schema, executable or key is bundled.

Node v8.16.2 compiles every shipped module and executes the actual D347 reader with a mocked TASU call, decoder, source selection, positioning and artwork. The SDK-free build passed. Synthetic app and HUD previews were rendered and visually inspected.

## Build and third-party details

MGU App Kit pin: 2c6cfdfaa6902f1b469c3784508fadae12b577eb (MIT). Background processing works without a visible RHMI screen. The package has mguAppStartType autostart, enablement defaults to false, and all three data interfaces are optional. Existing atomic settings storage preserves positions/opacity/size.

The unmodified Cluster renderer client is MPL-2.0, with full licence and source distributed. Cluster renderer 0.6.7+ remains a separate dependency. The app does not reset its guard or force stock popups out of the way.

## Required on-car verification

Definitions and mocks do not prove that this installed BDC accepts D347 from TASU, returns the described payload, refreshes it live or permits reads while moving. Start with SOME/IP-only mode while parked and inspect provider/notification state; test D347-only separately for actual replies. Physical mirror parity, blink timing, latency, HUD placement/brightness and background operation across sleep/profile changes still need verification.

Avoid concurrent diagnostic applications: TASU is a shared response broadcast, and some negative replies cannot uniquely identify clients using the same tester/SID. SOME/IP availability and notification cadence also remain unverified; its notifier may be change-only.

All warning sources expire after 2 seconds without a fresh valid sample. Faint outlines remain as position markers while enabled, including without data; they are not a readiness/all-clear indication. This app supplements the factory warning system. ID8 is not claimed or packaged.
