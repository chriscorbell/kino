# Workspace memory

Read this index and [the protocol](protocol.md) when starting or resuming a session. Load topic notes only when their retrieval cue matches the task.

| When needed                                                                                               | Read                                 |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Workspace constraints, non-obvious structure, or recurring procedures                                     | [Context](context/README.md)         |
| A failure, gotcha, or previously corrected assumption                                                     | [Lessons](lessons/README.md)         |
| Continuing unfinished work                                                                                | [Work](work/README.md)               |
| Writing or updating a memory note                                                                         | [Note format](note-format.md)        |
| Deciding which document owns a fact, whether a change owes a documentation edit, or repairing `AGENTS.md` | [Document maintenance](documents.md) |
| Finish step 4, a category over its threshold, or a requested memory review                                | [Bounded review](maintenance.md)     |
| Several agents writing memory at once                                                                     | [Concurrency](concurrency.md)        |

## Canonical project documents

| When needed                                                                    | Read                                                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Setting up Kino, running checks, building either client, or packaging macOS    | [Project README](../../README.md)                                                                           |
| Naming domain concepts in code, UI text, or documentation                      | [Domain glossary](../../CONTEXT.md)                                                                         |
| Product scope, platform order, privacy, diagnostics, or distribution promises  | [Product contract](../PRODUCT.md)                                                                           |
| Source handling, decoders, audio, subtitles, video range, or playback controls | [Playback contract](../PLAYBACK.md)                                                                         |
| Building, driving, or checking the TV app on the Shield                        | [Android TV guide](../ANDROID-TV.md)                                                                        |
| Delivery phases and planned platform work                                      | [Delivery roadmap](../ROADMAP.md)                                                                           |
| Gates that decide whether a replaceable technical layer stays                  | [Validation gates](../RISKS.md)                                                                             |
| Understanding an accepted architectural decision or proposing a replacement    | [Architecture decisions](../adr/)                                                                           |
| Repeating Shield navigation and frame-time measurements                        | [Navigation validation record](../validation/android-navigation.md)                                         |
| Repeating the probes and playback gate on Windows hardware                     | [Windows validation record](../validation/windows-hardware.md)                                              |
| Prior investigations into dependency notices or Shield HDR tone mapping        | [Research records](../research/)                                                                            |
| Updating packaged dependency notices and their retained source texts           | [Notice maintenance guide](../../third_party/notices/README.md)                                             |
| Checking retained native shell provenance                                      | [Shell provenance](../../apps/macos-shell/UPSTREAM.md)                                                      |
| Working on a Cardboard task or finding its board                               | [Cardboard workflow](../../AGENTS.md#cardboard-sessions) and [Kino board](https://cardboard.xode.cc/b/kino) |

## Review record

2026-09-26, ordinary review after Milestone 5's Linux and Windows work:

- `lessons/2026-09-25-shield-asleep-empty-nodes-p3w.md`: checked; `scripts/check-android.py` still wakes the Shield.
- `lessons/2026-09-25-tv-material-long-press-repeat-m8d.md`: checked; `TvRemote.hold` still sends the repeat with `FLAG_LONG_PRESS`.
- `lessons/2026-09-25-tv-dialog-content-swap-loses-press-r2k.md`: corrected; the dialog it names became `ChoiceDialog` in #230, and each step is still its own dialog.

Next cursor: `context/`.
