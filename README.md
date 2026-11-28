# Custom MGU apps

Apps and supporting tools for BMW iDrive 7 (MGU), installed through **MGU Store**.
Versions and download links were checked against GitHub Releases on **November 28, 2026**.

## Apps

| App | Published version | What it does | Source and setup | Download |
|---|---|---|---|---|
| AI Terminal | 0.3.0 | Ask Claude/OpenAI, create files and run approved commands; QR phone setup and chat. | [Guide](docs/AI_TERMINAL.md) · [Source](apps/mgu_ai_terminal) | [Release](https://github.com/Raslin777/mgu-private-apps/releases/tag/ai-terminal-v0.3.0) |
| AWD Diagnostic | 0.1.0 | Read AWD status and run the temporary PAD diagnostic for the G12 750i xDrive. | [Procedure](#awd-diagnostic) · [Source](apps/awd_diag) | [Release](https://github.com/Raslin777/mgu-private-apps/releases/tag/awd-diag-v0.1.0) |
| Better Lighting | 0.1.0 | Ambient colours, favourites, breathe/pulse/rainbow effects and driving-mode profiles. | [Guide and source](projects/BettetLighting/README.md) | [Release](https://github.com/Raslin777/mgu-private-apps/releases/tag/custom-apps-2026-11-14) |
| Camera Cluster | 0.1.0 | Show the front or rear camera in the instrument cluster's centre map area. | [Guide and source](projects/Camera-Cluster/README.md) | [Release](https://github.com/Raslin777/mgu-private-apps/releases/tag/custom-apps-2026-11-14) |
| External Lights | 0.2.9 | Exterior lamp effects, individual lamp tests and diagnostic-address comparisons. | [Guide and source](projects/external_lights/README.md) | [Release](https://github.com/Raslin777/mgu-private-apps/releases/tag/external-lights-v0.2.9) |
| HUD Blindspot | 0.1.4 | Small translucent left/right blind-spot indicators on the HUD, with saved position controls. | [Guide and source](projects/HUD-Blindspot/README.md) | [Release](https://github.com/Raslin777/mgu-private-apps/releases/tag/hud-blindspot-v0.1.4) |
| Road Sight (KAFAS viewer) | 0.1.0 | Inspect reported lanes, signs, traffic lights, objects and driver-assistance warnings. | [Guide and source](projects/Road-Sight/README.md) | [Release](https://github.com/Raslin777/mgu-private-apps/releases/tag/road-sight-v0.1.0) |

These are the **published downloads**, not unreleased local builds. Look for
**Road Sight** in the Store when looking for the KAFAS app.

## Supporting tools

| Tool | Version | Used by | Source and setup | Download |
|---|---|---|---|---|
| AI Terminal root helper | 0.1.1 | Optional helper for approved root commands in AI Terminal. | [Guide](docs/AI_TERMINAL.md) · [Source](native/mgu-ai-root) | [Release](https://github.com/Raslin777/mgu-private-apps/releases/tag/ai-terminal-v0.3.0) |
| Camera Cluster feed | 0.1.0 | Required camera-stream feed for Camera Cluster. | [Guide](projects/Camera-Cluster/README.md) · [Source](projects/Camera-Cluster/native/camera-cluster-feed) | [Release](https://github.com/Raslin777/mgu-private-apps/releases/tag/custom-apps-2026-11-14) |

Camera Cluster also needs **Cluster renderer 0.5.3 or newer**. HUD Blindspot
needs **Cluster renderer 0.6.7 or newer**. Install that separate dependency
from the upstream [robertnisipeanu/idrive-apps](https://github.com/robertnisipeanu/idrive-apps) Store source.

## Install through MGU Store

1. Add **Raslin777/mgu-private-apps** as a GitHub source.
2. Select **Releases**, then **Check now** or refresh the source.
3. Choose the app by its name above and install its latest version. Install
   the supporting tools and renderer listed for it as well.

Use the release's catalog.json as an alternative catalog source where one
is attached. AWD Diagnostic's release supplies its installable package directly.
If an account token is needed, add it under **Settings → Accounts**, including
through the Store's phone access page. A fine-grained GitHub token only needs
repository **Contents: Read-only** access for installation.

All current app packages target **iDrive 7**. Several are offline-tested
prototypes; consult each project's validation and compatibility notes for
its actual vehicle-testing status.

## App notes

### AI Terminal

QR pairing opens a phone page for API-key setup, typing requests, reading
output and stopping work. It uses your own Claude or OpenAI **API key**;
ChatGPT/Claude account sign-in is not implemented. Command approval stays
on the head-unit screen. The phone page uses HTTP on the car's Wi-Fi.

The published AI Terminal package **includes the original root RSA key at
the owner's explicit request**. The source keeps its null key placeholder.
API credentials and helper tokens are configured separately.

[Setup and build guide](docs/AI_TERMINAL.md) · [Review notes](REVIEW_NOTES.md) · [Validation](VALIDATION.md).

### AWD Diagnostic

**Alpha.** This temporarily puts the supported car into RWD diagnostic mode
until the ignition is cycled. It targets the 2020 750i xDrive (G12) with the
IB_G05 and VIP_G05 ECU pair.

1. With the vehicle parked, enter PAD mode with the engine off.
2. Use **Read AWD status** to identify the ECUs and read the VIP status flag.
3. Select **Arm PAD test**, then **Confirm PAD test**. The app rechecks identity
   and status and requires fresh zero-speed and zero-RPM readings.
4. Cycle the ignition afterwards and use **Read AWD status** to check the
   ECU's reported AWD state again.

PAD mode is confirmed by the operator; actual vehicle behavior requires a
live check. See [BMW SIB 27 02 20](https://static.nhtsa.gov/odi/tsbs/2025/MC-11016472-0001.pdf).

### Better Lighting

Ambient-light colours and effects, saved favourites and a look for each
driving mode. See the [project guide](projects/BettetLighting/README.md)
for its BDC driver, configuration and offline-test limits.

### Camera Cluster

Front, Rear and Off controls for the cluster's centre map area. Install the
Camera Cluster feed tool and upstream Cluster renderer before using the app.
Camera availability and the actual video path still need vehicle verification.
See the [camera setup and evidence](projects/Camera-Cluster/README.md).

### External Lights

Version **0.2.9** includes corrected TASU session-request framing and displays
outgoing request details and raw replies. A successful read does not establish
that a lamp write will be accepted.

This testing build has the app's Park/speed checks switched off; vehicle ECU
conditions can still reject a request. See the [version history and test notes](projects/external_lights/README.md)
for the exact behavior and remaining limits.

### HUD Blindspot

Version **0.1.4** uses **SOME/IP only in Auto mode**, trying the primary LCA
warning feed and then Assisted Driving View. Auto does not fall back to
UDS diagnostics. The primary warning is held while its provider is available;
D347 remains an explicit diagnostic test mode.

The HUD contains only two small amber indicators: faint outlines while
enabled, filled on an active warning. Size, opacity, height and independent
left/right positions are saved. Data status and raw replies stay on the
centre screen. Physical mirror-LED agreement and signal timing remain
unverified. See [source and validation](projects/HUD-Blindspot/README.md).

### Road Sight (KAFAS viewer)

The published **0.1.0** viewer listens to **88 notifications across 29 services**.
Its overview reports service availability, event counts, rates and ages;
individual service pages list the latest reported values. It does not start
by itself and does not write to the monitored car-side services.

The release includes the app package, catalog and checksums. Live service
availability remains unverified; preview images use invented values.
See the [service list and setup](projects/Road-Sight/README.md).

## Build and repository layout

- [AWD Diagnostic](apps/awd_diag): build with python build_awd.py from the repository root.
- [AI Terminal](apps/mgu_ai_terminal) and its [optional root helper](native/mgu-ai-root):
  use the [build instructions](docs/AI_TERMINAL.md), including the existing
  owner-requested RSA packaging option.
- [Better Lighting](projects/BettetLighting), [Camera Cluster](projects/Camera-Cluster),
  [External Lights](projects/external_lights), [HUD Blindspot](projects/HUD-Blindspot)
  and [Road Sight](projects/Road-Sight): each has its own app, tests, documentation
  and build tools. Run python tools/build.py from the chosen project folder,
  following its README for prerequisites.

The emulator is excluded. API credentials and extracted BMW SDK, firmware
and schema files are not release inputs to commit. The AI Terminal RSA
inclusion described above is intentional.

To publish an installable app, attach its matching app-id@version.tgz or
.mgu package to a **published** GitHub release. MGU Store skips drafts and
prereleases. Include the corresponding catalog/checksums when available.

[Custom-app review notes](docs/CUSTOM_APPS_REVIEW_2026-11-14.md) ·
[All releases](https://github.com/Raslin777/mgu-private-apps/releases).
