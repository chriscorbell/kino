# The Shield keeps only minutes of log

Read when: Chris is about to test on the Shield, or a failure he reports from the TV needs its log.
Status: verified
Scope: the development Shield at 10.0.0.191:5555
Verified: 2026-10-21
Source: `docs/memory/work/2026-09-25-full-featured-plan-k7q.md` "Traps found on 2026-09-28"; `adb logcat -g` and `adb logcat --help` on the Shield, 2026-10-21
Recheck when: the Shield's Android version changes, or someone sets its logger buffer size in developer options.

The Shield's `main` and `system` log buffers are 256 KiB each. On 2026-09-28, while Chris tested, they held about eleven minutes, so the log of a failure he reported later was already gone and he had to repeat it. On an idle TV on 2026-10-21 the full `main` buffer held about 23 minutes. Before he tests, raise the buffers with `adb -s 10.0.0.191:5555 logcat -G 16M` and keep a copy on the host with a background `adb logcat -v threadtime -b main,system,crash -T 1 >> <file>` loop. `KinoIntro` lines say where chapters came from and how the file's runtime compares with TheIntroDB's versions. The work note says the raised size lasts until the next reboot; that part was not checked.
