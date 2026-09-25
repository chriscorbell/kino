# A button swapped into an open TV dialog can miss its first press

Read when: a TV Compose button inside a `Dialog` sometimes ignores a remote press that other buttons take.
Status: verified
Scope: Android TV Compose dialogs
Verified: 2026-09-25
Source: `TvAddonsTest` while building add-on installation; the confirmation lives in `ConfirmDialog` in `apps/android-tv/app/src/main/java/app/kino/tv/TvAddons.kt`.
Recheck when: `androidx.tv:tv-material` or Compose UI is upgraded.

The install dialog first showed an address field, then replaced its content with the found add-on and an Install button. The Install button held focus by every accessibility measure, yet about one press in three never reached its `onClick` (a counter in the click path stayed at zero). Hiding the keyboard before submitting, waiting, and leaving touch mode changed nothing. Showing the confirmation as a separate `Dialog`, the way removal already worked, passed twelve runs in a row. Give a new step its own dialog instead of swapping a dialog's contents.
