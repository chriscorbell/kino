# A shared lock is not a queue, and Gradle daemons outlive the build

Read when: several agents share one machine for builds and checks, a wait on a lock runs for hours, or `pnpm check` times out in vitest after a TV build.
Status: verified
Scope: machines that several builders share; the program ran agent-pc and mbp this way
Verified: 2026-10-21
Source: `docs/memory/work/2026-09-25-full-featured-plan-k7q.md` "Continuation facts"; `docs/memory/work/2026-10-18-agent-friendly-program-h3v.md`; the agent-friendly program's operations notes and standing orders; Gradle 8.13 user guide, "Gradle Daemon"
Recheck when: `scripts/build-android.py` starts stopping its own daemons or passes `--no-daemon` (kardboard card vhz6nrzwdn5q9e), or `org.gradle.jvmargs` changes.

Gradle and Kotlin daemons keep running after a TV build. On agent-pc on 2026-09-28 they held about 6.5 GB of its 16 GB, swap filled, and `pnpm check` then failed with vitest timeouts; the program later saw daemons of more than 7 GB each. `./gradlew --stop` is the wrong cleanup on a shared machine: Gradle stops every daemon of that Gradle version, which kills other builds in flight. Note which daemon pids exist before your build (`jps -l` lists Java processes), and stop only the new ones by pid afterward. The program also serialized heavy work through one lock. On agent-pc it used `flock /tmp/kino-heavy.lock`, which promises no order: a verifier's `pnpm check` waited about 2.8 hours during #305 while later requests took the lock. On mbp it uses `lockf -k /tmp/kino-native.lock` for native builds, probes and Gradle, with `pnpm check` unlocked; `lockf`'s manual says `-k` guarantees lock ordering, which the program has not measured. Hold a lock only for the command that needs it. The 6.5 GB figure is in the 2026-09-25 work note. The daemons of more than 7 GB and the 2.8-hour wait are unverified, from the program's records. The `--stop` behavior is from Gradle's documentation.
