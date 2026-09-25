# Full-featured and stable on every platform

Read when: continuing the multi-milestone push tracked in issue #182, or picking the next chunk of platform work.

Status: active
Plan: [issue #182](https://github.com/chriscorbell/kino/issues/182), checked off as each pull request merges.
Source: Chris's instruction of 2026-09-25 to plan and implement a full-featured, stable Kino on all supported platforms, with full agency.

## Continuation facts

- Work runs in milestone order: desktop stability and CI, releases and updates, Android TV daily driver, feature completeness, then Linux and Windows. Each chunk is its own pull request, squash-merged once CI passes.
- The `kardboard` ruleset requires one approving review with an admin bypass. Interactive work merges with `gh pr merge --squash --delete-branch --admin`, as `AGENTS.md` Shipping describes.
- The development Shield answers at `10.0.0.191:5555`. If `adb connect` reports "No route to host" while `nc -z 10.0.0.191 5555` succeeds, restart the adb server (`adb kill-server`) and connect again.
- The running desktop app can be driven without taking over the screen: launch `build/macos/Kino.app/Contents/MacOS/Kino` with `QTWEBENGINE_REMOTE_DEBUGGING=127.0.0.1:<port>` and use the DevTools protocol. Accessibility clicks do not reach WebEngine content.
- The TV feature branches are stacked on the one-version change (#191) in this order: `feat/tv-hdr10-tone-mapping`, `feat/tv-discover-paging`, `feat/tv-subtitles`, `feat/tv-mark-watched`. Each passed its Shield tests when committed. After #191 merges, replay them with `git rebase --onto origin/main <#191's pre-merge commit>` and open one pull request per branch in that order. `build/release-workflow` also sits on #191.
- After a Homebrew upgrade of mpv or its dependencies, CMake fails with "includes non-existent path". Delete `build/macos/CMakeCache.txt` and build again.
- Windows (`gaming-pc`, PowerShell over SSH) and Linux with an AMD GPU (`minicore`) are reachable for Milestone 5 hardware checks.

## Traps found on 2026-09-25

- `cmake --build --parallel` with no count runs `make` unbounded and ignores `CMAKE_BUILD_PARALLEL_LEVEL`; on the three-core macOS runner that thrashed a two-minute compile into twenty-five (#229). Keep an explicit job count.
- GitHub runs every stacked branch's workflows on each restack. Restacking the TV chain queues about eighteen runs; cancel superseded ones (`gh run cancel`) to free the account's runners.
- `git rebase --onto origin/main <old base> <top branch> --update-refs` restacks a whole chain in one pass.
- The Shield sleeps between sessions, and Media3 then renders no frames: every playback test fails with decoder timeouts. Send `KEYCODE_WAKEUP` before running instrumentation by hand (`pnpm android:check` already does).
- Media3 1.9 buffers `file:` URIs as local playback with a one-second target; buffering gates must stream over HTTP.
- TV dialogs need `WideDialog` (`usePlatformDefaultWidth = false`); the platform default is about 440 dp on the Shield.
- `refactor/split-desktop-styles` exists locally only. After the desktop stack lands, rebase it by rerunning `build/tools/split-desktop-styles.mjs` on main rather than resolving conflicts, and compare with `build/tools/compare-desktop-css.mjs` against a build of main.

## Milestone 5 inventory (2026-09-25)

- The shell has no conditional compilation at all: every macOS dependency is compiled unconditionally.
- Already behind neutral headers: `nowplaying.h` (MediaPlayer in `.mm`), `sleepobserver.h` (AppKit in `.mm`), `displaymode.h`. `powerguard.h` leaks IOKit types in its header.
- Hard-coded: `hwdec=videotoolbox` and the `hwdec-current == "videotoolbox"` check in `mpvitem.cpp`; the `.app` paths `../Resources/ui` (`main.cpp`) and `../Resources/licenses` (`diagnostics.cpp`); the engine name without `.exe` (`streamengine.cpp`, `cmake/PackageEngine.cmake`); `::kill(SIGKILL)` in `main.cpp`; `architecture=arm64` in logs; "VideoToolbox required" in diagnostics.
- Portable already: `tlsroots`, `streamengine` (QProcess), `securestore` (0600 file, ADR 0016), `logging`, `externalnavigation`, `addonnetwork`, `closecoordinator`.
- macOS-only tests: `mpv_failure.cpp` and `render_lifetime_guard.cpp` use dyld interposition; `streamengine_test.cpp` uses `kill` and a Homebrew path.
- Client: `en-US.ts` says "macOS secure store" and "hardware-decoded on this Mac"; `PlayerScreen.tsx` sends `device: 'kino-macos'`.
- Probes run `build/macos/Kino.app/Contents/MacOS/Kino` unless `KINO_APP_BINARY` is set; most only assume that path.
- minicore is a production Ubuntu Server running Chris's Docker stacks: installing build packages there needs his yes. Linux work runs in CI containers instead.

## Waiting on Chris

- Android release signing key: generating it and storing it as repository secrets needs his yes.
- The v0.1.0 tag waits on his daily-driver retest.

Close when: every box in #182 is checked or explicitly deferred there.
