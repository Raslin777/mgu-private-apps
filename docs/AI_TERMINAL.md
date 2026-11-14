# AI Terminal for MGU

A native head-unit terminal: type a request on your phone or the iDrive
keyboard and an AI model answers, creates files, or runs commands you approve on screen. The app
calls the model API directly from the head unit's own Node 8. No separate AI
runtime or external relay server is needed.

**Status: built and tested offline, never run on a car.** ID7 only.

| | |
|---|---|
| App package | `mgu_ai_terminal@0.3.0.tgz` |
| Root helper (optional tool) | `mgu-ai-root@0.1.1.tgz` |
| Providers | Claude (Anthropic API) or OpenAI, switchable on screen |
| Setup | Scan a QR code on the car screen and enter your own API key on your phone. No ChatGPT/Claude account sign-in. |

## How it works

1. Type a request on the linked phone page, or choose **Ask** for the native
   keyboard. Either way the request is checked, then sent to the
   chosen provider with three tools: `run_command`, `read_file`, `write_file`.
2. Files in the app's `workspace/` folder are read and written without asking.
3. **Every command is shown for approval.** Ask becomes Approve and Reload
   becomes Deny. The command is shown from its first line; if it does not fit,
   the screen says how many lines are below.
4. Commands run as the app user in the workspace. With `as_root`, they go to
   the root helper and run from `/` as root, or use loopback SSH with the bundled key.
5. **Stop** cancels the request and waiting approvals, and stops local/helper
   process groups. With SSH it terminates the local SSH client; remote processes
   may survive disconnection. Leaving the app does the same.

## Safety checks

These are filters plus an approval step, **not a sandbox**. With root enabled,
the approval screen is the only thing between the model and the head unit.

**On the request (before anything is sent):**
- Empty or over 4000 characters: rejected. Non-printing controls are stripped.
- Contains something that looks like a key or password: rejected.
- Asks for control-unit coding, flashing or safety-system changes: rejected.

**On every command the model proposes (`safety.js`):**
- **Denied outright, cannot be approved:** deleting system directories, disk
  and partition tools, writing to devices, firmware and boot-setting tools,
  download-and-run pipes, encoded code, reading SSH keys, key files or stored
  credentials, changing user accounts, stopping services the head unit depends
  on, killing init, vehicle-bus writers.
- **Flagged in red on the review screen:** runs as root, restarts the head
  unit, remounts a file system, deletes files, changes a service, uses the
  network, changes security settings.
- Everything else still needs approval. Nothing is ever auto-approved.
- An approval pressed within 1.5 s of the command appearing is ignored, so a
  press meant for Ask cannot approve a command.

**Also:**
- API keys and the root token are removed from command output before the
  model or the screen sees it.
- The root helper checks a token, applies the same deny rules again on the
  root side, runs one command at a time, and logs every command to
  `/var/opt/mgu-ai-root/audit.log`.
- The provider client contacts only `api.anthropic.com` and `api.openai.com`.
  Approved shell commands have the head unit's normal network access.

**Known limits:**
- The deny rules match text. A script the model writes to the workspace and
  then runs is approved as `sh script.sh`; read the "Wrote ..." lines and the
  file before approving.
- Commands run as the app user can read the app's own `config.json`. The deny
  rules and output redaction reduce this; they do not make it impossible.
- The request filter is keyword based. It stops obvious requests, not every
  phrasing; the command rules and your approval are what count.

## Phone link

The head unit serves a small web page itself; there is no outside server.

1. With no API key saved, the app shows a QR code, an address and a 6-digit
   code. Later, **More > Phone link on / off** shows it again.
2. Join the car's Wi-Fi hotspot on the phone and scan the QR code. The code is
   carried in the scanned address, so pairing needs no typing; opening the
   address by hand asks for the code.
3. First time: choose Claude or OpenAI, paste the API key, choose whether to
   allow root commands, and save. The app is then ready.
4. After that the same page is where you type requests, read the output, stop
   a request, start a new conversation or change settings.

What the phone cannot do: **approve a command.** The page shows the command
that is waiting, but Approve and Deny exist only on the car screen.

Protections: nothing but the page itself is served before pairing; one phone
at a time; five wrong codes lock pairing for 30 s and change the code; a
paired phone is forgotten when the link is turned off or the app restarts;
requests must be addressed to the head unit by IP, be JSON and under 16 KB;
saved keys are never sent back to the phone.

Limits you should know:
- **The page is plain HTTP on the car's Wi-Fi.** Another device on that
  hotspot could read the API key while you save it, and the session while you
  use it. Use it on a hotspot only you are on.
- The server listens on port 8377 on every network interface of the head unit
  while the link is on, not only the hotspot.
- **Not verified on a car:** whether the head unit's firewall lets a phone on
  the hotspot reach a port opened by an app, and which address the hotspot
  uses (172.16.222.x is tried first). If the phone cannot open the page, use
  the `provision.sh` fallback below.
- Leaving the AI Terminal screen on the head unit stops a running request,
  including one started from the phone.

## Root access

Root commands reach the head unit one of two ways. Both show every command for
approval first.

| | Bundled SSH key (default build) | Root helper (optional tool) |
|---|---|---|
| How | The app runs `ssh root@127.0.0.1` with the root key built into the package | A root service behind a socket, with a per-install token |
| Setup | Tick "Allow root commands" on the phone page | Install `mgu-ai-root`, answer `y` in `provision.sh` |
| Root-side checks | None: the deny rules run in the app only | Deny rules re-applied as root, audit log |
| Needs | An SSH client on the head unit (`/usr/bin/ssh`); **not verified** | Store acceptance of the tool; not verified |

When the helper is provisioned it is used in preference to the key.
Choosing root off disables both paths without deleting the bundled or extracted key.

`npm run build` reads `assets/05_SSH_ROOT_KEY.pem` and writes it into the built
package as `javascript/rootkey.js`. The source tree only holds a placeholder.
When root is enabled the app copies the key to `<data directory>/root_key` (mode
0600). Build without it using `python tools/build.py --no-root-key`.

**The published 0.3.0 package includes the root RSA key, as explicitly requested
by the repository owner.** Anyone downloading it can extract that key and use
it on units that trust it. `Raslin777/mgu-private-apps` is public. Source keeps
the placeholder; the original local PEM is unchanged. API keys and root-helper
tokens are not included. For a fresh source checkout, supply your key using
`python tools/build.py --root-key <path-to-private-key>`; use `--no-root-key`
for a package without it.

## Setup on the head unit

1. Add `Raslin777/mgu-private-apps` as a **Releases** source in MGU Store,
   choose **Check now**, and install `mgu_ai_terminal`. The `mgu-ai-root`
   tool is optional; loopback SSH is available when root is enabled and the
   head unit has a compatible SSH client. Local builds are also in `dist/`.
2. Open AI Terminal. It shows a QR code: scan it with a phone on the car's
   Wi-Fi hotspot and enter your API key (see Phone link above).

Fallback without a phone: over SSH as root, run
`sh provision.sh <app data directory>` (the script is in
`native/mgu-ai-root/`, and in `/var/opt/mgu-ai-root/current/` when the root
helper is installed), then choose **Reload** in the app.

`config.json` (mode 0600, owned by the app user):

| Field | |
|---|---|
| `provider` | `anthropic` or `openai`; also switched with More > Switch Claude / OpenAI |
| `anthropicKey`, `anthropicModel` | model defaults to `claude-opus-5-5` |
| `openaiKey`, `openaiModel` | the model id is required; there is no default |
| `allowRoot` | `true` enables root; `false` disables helper and SSH. Defaults off unless a legacy config has a root token. |
| `rootToken` | helper token written by `provision.sh`; SSH fallback does not require a token |
| `maxSteps` | model round trips per request, default 12 |

If Node 8's certificate list is too old for a provider, put a current CA
bundle at `<data directory>/ca.pem`; the app uses it when present.

## Development

Python 3.11+ and Node.js 18+ on the PC; application sources use Node 8 syntax.

```powershell
npm test                              # offline regression tests
.cache\node8.exe tools\check-node8.cjs  # loads and runs the code under Node 8.16.2
.cache\node8.exe tools\check-link-node8.cjs  # phone link over real HTTP under Node 8.16.2
npm run build                         # dist\mgu_ai_terminal@<version>.tgz
npm run build:root                    # dist\mgu-ai-root@<version>.tgz
npm run catalog                       # dist\catalog.json
npm run preview                       # preview\*.png (simulated data)
```

| Path | |
|---|---|
| `apps/mgu_ai_terminal/safety.js` | request and command checks, redaction |
| `apps/mgu_ai_terminal/api.js` | HTTPS client and the two provider adapters |
| `apps/mgu_ai_terminal/agent.js` | the request / tool / approval loop |
| `apps/mgu_ai_terminal/tools.js` | workspace files, local commands, root-helper client |
| `apps/mgu_ai_terminal/config.js` | `config.json` loading, saving and provider switch |
| `apps/mgu_ai_terminal/link.js`, `qrcodegen.js` | phone link: pairing, setup and request page; QR code |
| `apps/mgu_ai_terminal/main.js`, `view.js`, `speller.js` | screen, buttons, keyboard |
| `native/mgu-ai-root/` | root helper, systemd units, `provision.sh` |

## Before a car installation

1. Run `tools/probe-hu.sh` over SSH. It is read-only and reports Node, memory,
   disk, the uplink, the app group and whether Node 8 can complete a TLS
   handshake with each provider. **Do this first:** if TLS fails, nothing else
   matters until `ca.pem` is in place.
2. Install the app only, provision without root, and try a question, a
   workspace file, an approved command, Deny, and Stop.
3. Check the native keyboard and scrolling on the real screen.
4. Only then install the root helper. Confirm the Store accepts the tool
   artifact (it was packed by `tools/package-root.py`, not the Store's own
   packer), that the socket appears at `/run/mgu-ai-root/root.sock` with group
   `tm_oap_app`, and that a harmless root command (`id`) round-trips.

## Repository findings

| Reference | Relevant finding |
| --- | --- |
| [robertnisipeanu/mgu-store](https://github.com/robertnisipeanu/mgu-store) | Store layouts, tool artifacts, root services, socket units for `tm_oap_app`, `mguInternet`; Node is `/usr/bin/node` 8.16.2. |
| [cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) | MIT native app kit, canvas rendering, RHMI input and builder. |
| [IterioDev/car-apps](https://github.com/IterioDev/car-apps) | Mostly ID8-only; its license restricts modified derivatives, so no code is used. |

See [NOTICE.md](../NOTICE.md) for component attribution and [REVIEW_NOTES.md](../REVIEW_NOTES.md)
for this release's review. API credentials, firmware and BMW's SDK are excluded.
The release app intentionally includes the root RSA key described above.
