# TV Material reads a long press from key repeat

Read when: a Shield test holds select on a TV Material `Card` or `Surface` and `onLongClick` never fires.
Status: verified
Scope: Android TV Compose tests
Verified: 2026-09-25
Source: `TvRemote.hold` in `apps/android-tv/app/src/androidTest/java/app/kino/tv/TvRemote.kt`, written for `WatchedTest`.
Recheck when: the `androidx.tv:tv-material` version changes.

A single key-down held past the long-press timeout does nothing: TV Material treats the repeated key-down a held remote sends as the long press. Sending one down event, sleeping, and sending the up event opened no menu. `TvRemote.hold` sends the down, a second down with repeat count 1 and `FLAG_LONG_PRESS`, then the up, which opens the Continue Watching options the way a real remote does.
