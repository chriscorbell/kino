# A sleeping Shield empties every remote-driven test

Read when: a Shield instrumentation test fails with "Missing visible text" and an empty "Visible nodes:" list.
Status: verified
Scope: Android TV instrumentation on the development Shield
Verified: 2026-09-25
Source: observed while running `WatchedTest` and `TvBrowseTest` on 2026-09-25; `adb shell dumpsys power` reported `mWakefulness=Asleep`.

The Shield sleeps with its display off between runs, and the accessibility tree the `TvRemote` helper reads is then empty, so every test that looks for a node fails at once while Core-only assertions still pass. `pnpm android:check` sends `KEYCODE_WAKEUP` once before installing, which a long build can outlast. Wake it right before instrumenting (`adb -s 10.0.0.191:5555 shell input keyevent KEYCODE_WAKEUP`) and confirm with `adb shell dumpsys power | grep mWakefulness` before reading the failure as a regression.
