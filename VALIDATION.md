# AI Terminal offline validation — November 11, 2026

App 0.2.1; optional root helper 0.1.1. Development and review were performed
offline from the car. No head-unit changes were made.

## Verified on the development PC

- `npm test`: 49 tests passed, none skipped. Provider calls, shell execution,
  and root-helper socket transport use simulated responses/processes.
- Regression coverage includes Stop immediately after approval, Stop between
  file operations, explicit root opt-out, dangling workspace links (a Windows
  junction), hard-link replacement, process-group cancellation, command and
  provider deadlines, root-client cancellation, and a late helper close event.
- Official Node 8.16.2 loads the runtime modules and completes the simulated
  tool/approval turn in `tools/check-node8.cjs`. Shipped app and helper source
  syntax is also checked with that binary.
- The SDK-free app builds with the pinned MIT app kit. App metadata declares
  ID7, internet access and the `mgu-uplink >= 0.4.0` dependency.
- The app intentionally contains the owner's RSA key in
  `package/javascript/rootkey.js`. The original PEM file is unchanged; the
  packaged PEM matches it after normalizing line endings. No API keys,
  provisioned config, helper token, firmware or BMW SDK are included.
- The root tool archive uses `component.json`, `files/`, and `units/`, owned
  0:0. Shell scripts and units have Unix line endings; file hashes match the
  manifest. Catalog sizes and SHA-256 digests match the built archives.

## Not verified

- Actual installation in MGU Store or operation on an ID7 head unit. ID8 is
  not declared supported by this app kit/build.
- Live Claude/OpenAI requests, model access, billing, provider request-field
  acceptance, TLS with the HU's old Node runtime, or DNS through mgu-uplink.
- Native keyboard, rendering, scrolling, controller interaction, and button
  relabelling on the car.
- A usable SSH client on the HU and loopback root authentication using the
  bundled key. Stopping that client does not guarantee remote descendants stop.
- Linux process-group termination, root-helper socket activation, group
  membership, provisioning, token ownership and audit logging on the car.

The earlier SSH probe timed out before authentication. After the owner
confirmed the offline scope, no further HU connections were attempted.

## Addendum — November 14, 2026: app 0.3.0 phone-link release

Verified on the development PC:

- `npm test`: 57 tests pass. The 8 new ones run the phone link as a real HTTP
  server on loopback: pairing with the on-screen code, rejection of every
  request before pairing, single-phone takeover, lockout after five wrong
  codes, JSON/size/Host checks, forgetting the phone when the link is turned
  off, saving settings from the phone, and the pairing screen.
- `tools/check-link-node8.cjs` starts the link, pairs and reads state over
  HTTP under Node 8.16.2, and syntax-checks the page's script.
- The app builds as `dist/mgu_ai_terminal@0.3.0.tgz` with `link.js` and
  `qrcodegen.js`; `dist/catalog.json` was regenerated for it.
- The RSA PEM's SHA-256 is unchanged from the 0.2.1 release, and the bundled
  key matches it after line-ending normalization. Release archives, catalog
  hashes and uploaded asset hashes were checked again for 0.3.0.

Not verified:

- Whether a phone on the car's hotspot can reach port 8377 on the head unit
  (firewall, and which address the hotspot interface has).
- The page in a real phone browser. Its script was syntax-checked only.
- QR scanning of the code as rendered on the head-unit display.
