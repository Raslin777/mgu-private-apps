# Source of the program in this package

`waze-on-cluster` in this package is the render program of **Waze on cluster**
by Robert Nisipeanu, licensed GPL-3.0-or-later (`LICENSE` beside this file). It
is the unmodified binary from the project's own release:

- Repository: https://github.com/robertnisipeanu/idrive-apps
- Release tag: `waze-on-cluster@0.9.14`
- Commit: `f7a678b27693c88a12d2ed4f18ac4652f005bffd`
- Source of the program: `native/waze-on-cluster/` and `native/cluster-render/`
  at that commit (build: `make target` in `native/waze-on-cluster/`)
- Release file it was taken from: `waze-on-cluster@0.9.14.tgz`,
  SHA-256 `05118ea14c2c2d4b7217d9652c9bff2a5e57f8b8bbd69c24c9bd87d599c460d8`

Only the program and its licence are taken. None of that project's CarPlay or
Android Auto patch scripts, units or settings are in this package, and nothing
here patches any program on the head unit.

`camera-feed.conf` and the two systemd units are this project's own files.
They only give the program different settings: the camera stream instead of a
phone's map stream, its own socket, log and state paths.
