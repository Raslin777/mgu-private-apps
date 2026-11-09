# Private MGU app source

Use this repository as a **Releases** source in MGU Store.

1. In GitHub, create a fine-grained personal access token for this repository with repository **Contents: Read-only**.
2. In the Store, add the token under **Settings → Accounts**. You can also use the Store's phone access page to enter it.
3. Add `Raslin777/mgu-private-apps` as a GitHub source, select **Releases**, and choose **Check now**.

To publish an app, attach its installable `<app-id>@<version>.tgz` or `<app-id>@<version>.mgu` to a published GitHub release. The Store skips draft and prerelease entries. The package's app ID and version must match its filename.

Keep tokens, SSH keys, and extracted BMW SDK or firmware files out of the repository and its release assets.

See the [MGU Store publishing guide](https://github.com/cauliflowermossgrape/mgu-store/blob/main/docs/PUBLISHING.md) for package layout.