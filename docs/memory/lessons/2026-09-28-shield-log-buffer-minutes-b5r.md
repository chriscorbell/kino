# The Shield keeps only minutes of log

Read when: Chris is about to test on the Shield, or a failure he reports from the TV needs its log.
Status: verified
Scope: the development Shield at 10.0.0.191:5555
Verified: 2026-10-21
Source: the traps of 2026-09-28 that #329 moved here from `docs/memory/work/2026-09-25-full-featured-plan-k7q.md`; `adb logcat -g` and `adb logcat --help` on the Shield, 2026-10-21
Recheck when: the Shield's Android version changes, or someone sets its logger buffer size in developer options.

The Shield's `main` and `system` log buffers are 256 KiB each. On an idle TV on 2026-10-21 the full `main` buffer held about 23 minutes; the 2026-09-28 record says it held about eleven while Chris tested, so the log of a failure he reported later was already gone and he had to repeat it. Before he tests, keep a copy on the host with a background `adb logcat -v threadtime -b main,system,crash -T 1 >> <file>` loop. `KinoIntro` lines say where chapters came from and how the file's runtime compares with TheIntroDB's versions. `adb logcat --help` lists `-G <size>` for a larger buffer, but nobody has run it on the Shield or checked how long it lasts; if you try it, read `adb logcat -g` afterward to see whether it took.
