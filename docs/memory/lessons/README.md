# Lessons

Verified failure mechanisms and corrections that change a future attempt. Search here when a symptom resembles a past failure.

One bullet per lesson, with a relative link and the symptom or task that should trigger reading it. A provisional lesson says "provisional" in its cue so a reader knows it is a hypothesis before relying on it. Update the matching lesson when evidence changes; [the note format](../note-format.md) states what a lesson records.

Threshold: 12 entries. Past it, the bounded review in [maintenance](../maintenance.md) samples this category first.

- [A sleeping Shield empties every remote-driven test](2026-09-25-shield-asleep-empty-nodes-p3w.md): "Missing visible text" with an empty node list on the Shield.
- [TV Material reads a long press from key repeat](2026-09-25-tv-material-long-press-repeat-m8d.md): a held select in a test never reaches `onLongClick`.
- [A button swapped into an open TV dialog can miss its first press](2026-09-25-tv-dialog-content-swap-loses-press-r2k.md): a dialog button that ignores some remote presses.
- [A TV playback test's progress resumes the next test on that episode](2026-09-28-tv-test-progress-resumes-next-test-v4t.md): a Shield playback test fails only in a class or suite run and passes alone.
- [An incremental tsc -b misses a change only in a workspace package](2026-10-19-incremental-tsc-misses-workspace-package-t5w.md): `pnpm typecheck` passes locally on a `packages/` type error that CI reports.
- [A piped check reports the pipe's exit code](2026-09-25-piped-check-hides-failure-q4n.md): running a check before a commit, push, or pull request, or a pull request claims a pass that CI fails.
- [A result from a build without the change says nothing about the change](2026-09-06-result-from-stale-build-h7x.md): about to report a change as checked on the Shield, the Mac app, or a live service.
- [A probe kills only the process it started](2026-09-26-probe-leftover-processes-z2c.md): looping a desktop probe, running Kino under a debugger or wrapper, or memory runs low after native checks.
- [The Shield keeps only minutes of log](2026-09-28-shield-log-buffer-minutes-b5r.md): Chris is about to test on the Shield, or his reported failure needs its log.
- [Deleting or force-pushing a branch can close a pull request for good](2026-09-25-gh-branch-and-draft-hazards-w3j.md): merging a stack's base, deleting a branch, merging a draft, or force-pushing a branch with a pull request.
- [A bare cmake --parallel runs make with no job limit](2026-09-25-bare-cmake-parallel-unbounded-k9e.md): writing a `cmake --build` command, or a native build suddenly takes many times longer.
- [Signing the main executable signs the whole bundle](2026-09-26-codesign-main-executable-signs-bundle-u6f.md): changing how macOS packaging signs, or "cannot find code object on disk" on a `.cstemp` file.
- [A usage check that over-counts passes on dead entries](2026-10-19-usage-check-over-counts-d8m.md): writing or changing a check that fails when something is unused.
- [A test harness can silently skip the case it exists for](2026-10-20-strict-harness-skips-unmount-a4y.md): a test mounts the player view with `strict: true`, or a harness option should exercise a remount, retry, or failure.
- [A script's main guard does nothing through a symlinked path](2026-10-20-main-guard-symlinked-path-g2t.md): a script exits 0 with no output, or a check passes from `/tmp` or another linked directory.
- [A shared lock is not a queue, and Gradle daemons outlive the build](2026-09-28-shared-lock-and-gradle-daemons-n6p.md): several agents share one machine, a lock wait runs for hours, or `pnpm check` times out in vitest after a TV build.
