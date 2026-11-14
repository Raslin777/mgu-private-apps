# AI Terminal 0.3.0 release notes — November 14, 2026

This update adds the owner's phone-link implementation:

- Scan the QR code on the HU to pair a phone on the car's Wi-Fi.
- Enter API keys and choose the provider/root setting from the phone page.
- Type requests, view output, stop work and start a new conversation on the phone.
- Command approvals remain on the head-unit screen; the phone cannot approve them.
- Turn the phone link on or off from the app's More menu.

All 57 tests pass. Both Node 8.16.2 compatibility checks pass, including
pairing and reading state over real loopback HTTP. Runtime syntax checks and
the SDK-free build pass. No head-unit or live-provider test was performed.

The `mgu_ai_terminal@0.3.0.tgz` release includes the unchanged original RSA key,
as previously requested. The optional root helper remains version 0.1.1.
API keys and provisioned tokens are not included. Source keeps the null key
placeholder; the RSA key is present in the downloadable app package.

In MGU Store, refresh this repository's **Releases** source and update AI
Terminal. See [phone setup instructions](docs/AI_TERMINAL.md#phone-link) and
[validation details](VALIDATION.md). Pairing configures an API key; this is
not ChatGPT/Claude account sign-in. The phone page uses plain HTTP, and phone
access through the car's hotspot/firewall and QR scanning on the HU remain
unverified. ID7 only; not car-tested.

## Previous release: 0.2.1 review

Reviewed November 11, 2026. This keeps the owner's direct Claude/OpenAI API
implementation, native terminal, workspace file tools, command approval,
optional root helper and bundled RSA SSH fallback. It does not restore the
earlier Codex runtime, QR pairing or account-login implementation.

## Findings corrected

| Finding | Change |
|---|---|
| Stop could arrive after approval but before command launch, or between tools in one reply | Check the active operation before each provider/tool action and immediately before spawning. |
| A dangling symlink could redirect a workspace write outside the workspace | Inspect path components with `lstat`, reject links, and replace files atomically. Atomic replacement also preserves other hard-link targets. |
| Provisioning root off left the bundled SSH fallback enabled | Persist `allowRoot` and gate both helper and SSH. Disabling root leaves the key intact. Legacy configs with a helper token retain root unless explicitly disabled. |
| A late close event from a failed root command could release another command's lock | Settle each helper command once; consume each socket request once. |
| Local Stop killed only the shell; stalled transports could hang indefinitely | Use detached process groups, settle cancellation, and bound helper/provider requests with deadlines. |
| Predictable config temporary files could follow pre-existing links | Use exclusive random temporary files and apply provisioning ownership through the open descriptor. |

49 offline tests pass and the Node 8.16.2 compatibility simulation passes.
See [VALIDATION.md](VALIDATION.md) for the exact scope and unverified items.

## Packages and setup

- `mgu_ai_terminal@0.2.1.tgz`: SDK-free ID7 app, with the original RSA key bundled
  in `javascript/rootkey.js` as explicitly requested by the owner. The public
  release exposes that key to anyone who downloads it. Source retains a null
  placeholder; the original local PEM was not edited.
- `mgu-ai-root@0.1.1.tgz`: optional root companion; used in preference to SSH
  when installed and provisioned.
- `catalog.json` and `SHA256SUMS.txt`: release artifact metadata and checksums.

Add `Raslin777/mgu-private-apps` as a **Releases** source in MGU Store and choose
**Check now**. Open AI Terminal once to obtain its data directory, then run
`provision.sh` over SSH with that directory to enter API credentials. Answer
`y` for root access, then choose **Reload** in the app. This release uses API
keys; it has no QR pairing or ChatGPT/Claude account sign-in.

## Remaining limits

This is an offline prototype, not car-tested. ID8 is not supported by this
build. The text filters and approval UI are not a sandbox: approved shell
commands can access resources available to their Linux user. Path checking
does not defend against another process concurrently replacing parent
directories. With SSH root fallback, stopping the local client may leave
remote processes running; the helper is preferred for cancellation and audit.

The current Claude API version and fallback header were checked against
[Anthropic versioning](https://platform.claude.com/docs/en/api/versioning) and
[fallback documentation](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback).
No live provider request was made during review.
