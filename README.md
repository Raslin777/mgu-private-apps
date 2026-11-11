# Private MGU app source

## AWD Diagnostic
ALPHA USE AT YOUR OWN RISK
This will temporarily put your car into RWD mode until you turn off the car.

An iDrive 7 app for the temporary AWD diagnostic on the 2020 750i xDrive (G12) with the IB_G05 and VIP_G05 ECU pair.

1. With the vehicle parked, enter PAD mode with the engine off.
2. Open **AWD Diagnostic**. **Read AWD status** identifies the ECUs and reads the VIP status flag.
3. Select **Arm PAD test**, then **Confirm PAD test**. The app rechecks ECU identity and AWD status and requires fresh zero-speed and zero-RPM readings before sending a single request over the head unit's diagnostic service.
4. After the test, cycle the ignition and select **Read AWD status** to verify AWD is active again. The displayed state is the ECU's reported flag.

The car's PAD mode is confirmed by the operator. The head-unit transport and actual vehicle behavior require a live check. The procedure is described in [BMW SIB 27 02 20](https://static.nhtsa.gov/odi/tsbs/2025/MC-11016472-0001.pdf).

Run `python build_awd.py` with Git and Node.js installed to build the SDK-free package into `dist/`. The Store supplies the SDK during installation.

## Store setup

Use this repository as a **Releases** source in MGU Store.

1. In GitHub, create a fine-grained personal access token for this repository with repository **Contents: Read-only**.
2. In the Store, add the token under **Settings → Accounts**. You can also use the Store's phone access page to enter it.
3. Add `Raslin777/mgu-private-apps` as a GitHub source, select **Releases**, and choose **Check now**.

To publish an app, attach its installable `<app-id>@<version>.tgz` or `<app-id>@<version>.mgu` to a published GitHub release. The Store skips draft and prerelease entries. The package's app ID and version must match its filename.

Keep API tokens, other SSH keys, and extracted BMW SDK or firmware files out of the repository and release assets. The AI Terminal release below intentionally bundles its root RSA key at the owner's explicit request.

See the [MGU Store publishing guide](https://github.com/cauliflowermossgrape/mgu-store/blob/main/docs/PUBLISHING.md) for package layout.

## AI Terminal 0.2.1

An ID7 terminal for direct Claude/OpenAI API requests, workspace files and
commands approved on the head-unit screen. Optional root access uses the
bundled RSA SSH key or the separate `mgu-ai-root` helper.

**Offline prototype; not car-tested. ID8 is not supported by this build.**
This version uses API keys and has no QR pairing or account sign-in.

Install from [AI Terminal 0.2.1 releases](https://github.com/Raslin777/mgu-private-apps/releases/tag/ai-terminal-v0.2.1)
through the Store's **Releases** source. The app archive **includes the root RSA
key at the owner's explicit request**; anyone downloading it can extract the
key. The source placeholder does not contain it. API credentials and helper
tokens are provisioned separately.

- [Setup, root access and build instructions](docs/AI_TERMINAL.md)
- [Review findings and release notes](REVIEW_NOTES.md)
- [Offline validation and remaining limits](VALIDATION.md)

Run `npm test` for 49 offline tests. Build with
`python tools/build.py --root-key <path-to-private-key>`, or `--no-root-key`.
Build the optional helper with `python tools/package-root.py`.
