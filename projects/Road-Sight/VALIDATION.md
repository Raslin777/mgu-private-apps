# Validation

Version 0.1.0, 2026-11-22.

## Checked offline

| Check | Result |
|---|---|
| `node --test tests/*.test.cjs` | 7 of 7 pass |
| `node tools/check-node8.cjs` (Node 8.16.2, the head unit's version) | all modules compile; 29 services, 88 subscriptions, 31 pages drawn |
| `python tools/build.py` | `dist/road_sight@0.1.0.tgz` built, SDK-free |

What the tests cover:

- The manifest declares exactly the generated services, each optional, with
  notifications only (no writable field, no method).
- Every member is subscribed; events are counted, the latest value kept, the
  rate computed and dropped to zero when events stop; the first value is logged
  once; nothing is counted after stop and every proxy is closed.
- A refused service or an unknown event does not stop the others, and each case
  shows the right status.
- Values of any shape are listed by name; lists are summarised; bytes print as
  hex; very large and self-referencing values do not break it.
- Paging, the live-only filter, the clamp for an out-of-range page and the
  split of a long page into parts.
- The entry point: collection without a screen, all six buttons, shutdown.
- The built archive: current source, licences, no SDK, schema or key; the only
  manifest entries beyond the app's own are the app kit's head-unit platform
  interfaces.

## Not verified

- **Nothing has run on a car or a head unit.**
- Whether the head unit accepts 88 subscriptions from one app.
- Which of the 29 services this car offers. That is what the app is for.
- The shape of the values the binding delivers for each event (assumed to be
  named members, as in the public apps that read assistance events).
- Screen layout on the real display: positions were checked by drawing against a
  stub canvas, not by looking at it.
- CPU load when the large object lists arrive at a high rate.

Not published, not committed: this folder is not a git repository.
