# AI Terminal 0.2.1 review and release notes

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
