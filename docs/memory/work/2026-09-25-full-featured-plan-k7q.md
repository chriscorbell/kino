# Full-featured and stable on every platform

Read when: continuing the multi-milestone push tracked in issue #182, or picking the next chunk of platform work.

Status: blocked on Chris; every remaining #182 box needs his hardware, his keys, or his retest.
Plan: [issue #182](https://github.com/chriscorbell/kino/issues/182), checked off as each pull request merges.
Source: Chris's instruction of 2026-09-25 to plan and implement a full-featured, stable Kino on all supported platforms, with full agency.

## Continuation facts

- Milestones 1, 3 and 4 are done. Milestone 5's code, packaging and notices shipped (#232 to #252); what remains is hardware validation on Linux and Windows. Each chunk is its own pull request, squash-merged once CI passes.
- The `kardboard` ruleset requires one approving review with an admin bypass. Interactive work merges with `gh pr merge --squash --delete-branch --admin`, as `AGENTS.md` Shipping describes.
- The development Shield answers at `10.0.0.191:5555`. If `adb connect` reports "No route to host" while `nc -z 10.0.0.191 5555` succeeds, restart the adb server (`adb kill-server`) and connect again.
- The running desktop app can be driven without taking over the screen: launch `build/macos/Kino.app/Contents/MacOS/Kino` with `QTWEBENGINE_REMOTE_DEBUGGING=127.0.0.1:<port>` and use the DevTools protocol. Accessibility clicks do not reach WebEngine content.
- After a Homebrew upgrade of mpv or its dependencies, CMake fails with "includes non-existent path". Delete `build/macos/CMakeCache.txt` and build again.
- Windows (`gaming-pc`, PowerShell over SSH) and Linux with an AMD GPU (`minicore`) exist for hardware checks, but a GUI started over SSH on Windows has no desktop, and minicore is a production server: installing packages there needs Chris's yes. Hardware playback checks are his.
- Windows builds Qt 6.11.2 (#247), the release macOS and the Flatpak use, so one Qt notices review covers all three. aqtinstall reads Qt 6.11's repository only from an unreleased commit; the Windows job runs it directly, with 7-Zip extracting one archive at a time.
- Windows libmpv is cross-built on Linux from pinned sources by `scripts/build-windows-mpv.sh`, sharing the Flatpak's pins, in `.github/workflows/windows.yml`. The SourceForge (shinchiro) build it replaced bundles about fifty libraries from moving git heads and records none of their revisions, so its notices could not be made exact.
- The Windows engine's vcpkg baseline is a current vcpkg commit (patch 0009, #243), which builds the reviewed Boost 1.92.0 and libtorrent 2.1.2; upstream's baseline builds Boost 1.89.0.

## Traps found on 2026-09-25

- `cmake --build --parallel` with no count runs `make` unbounded and ignores `CMAKE_BUILD_PARALLEL_LEVEL`; on the three-core macOS runner that thrashed a two-minute compile into twenty-five (#229). Keep an explicit job count.
- Every change to `.github/workflows/ci.yml` wakes the macOS native job and its packaging, and the account's macOS runners are the queue everything waits in. Windows has its own workflow for that reason. To iterate on a workflow without a pull request, add the branch to its `push` trigger for the duration: `ci.yml` runs only for pull requests and `main`.
- GitHub Actions caches are per branch (plus the default branch), so a branch's first Windows run rebuilds libmpv, about twenty-five minutes.
- A probe that only checks the process stays up passes a blank window. #232 left the Mac's resource path uncleaned, WebEngine navigated to the cleaned path, and the shell blocked its own interface; every other probe passes `KINO_UI_URL`, so none loaded the packaged path. `check-macos-launch` now waits for "packaged UI loaded" (#250).
- The Windows C runtime buffers stderr when it is a file or a pipe; the logger flushes each line (#247).
- Deleting a pull request's head branch closes it; restore the branch at the same commit and `gh pr reopen`. `gh pr merge` refuses drafts; run `gh pr ready` first. In a pipeline, a failing command before `| tail` still lets `&&` continue.
- A pull request's CI tests its merge with the base at that moment. Merging the base into a stacked branch, rather than rebasing it, restacks without a force push.
- The Flatpak CI image (`flatpak-github-actions:kde-6.11`) has neither `dnf` nor `apt-get`, and its Xvfb has no GLX. Chromium's GPU process then aborts ("GLOzone not found"), so the smoke run passes `--disable-gpu`; Qt itself draws through Mesa's EGL.
- libmpv built without Lua has no `osc` option; the shell tolerates that one missing option.
- GitHub's Windows runners have no OpenGL driver. The interface probes run a copy of the portable build with Mesa's llvmpipe beside `Kino.exe`.
- Cargo's selected graph differs per target: the engine's Linux graph carried GTK, Wayland and X11 bindings for upstream's tray until patch 0008 left the tray out (#246). Review each target's graph, not the Mac's.
- The Shield sleeps between sessions, and Media3 then renders no frames: every playback test fails with decoder timeouts. Send `KEYCODE_WAKEUP` before running instrumentation by hand (`pnpm android:check` already does).
- Media3 1.9 buffers `file:` URIs as local playback with a one-second target; buffering gates must stream over HTTP.
- TV dialogs need `WideDialog` (`usePlatformDefaultWidth = false`); the platform default is about 440 dp on the Shield.

## Waiting on Chris

- Android release signing key: generating it and storing it as repository secrets needs his yes.
- The v0.1.0 tag waits on his daily-driver retest, on a packaged build from after #250: from #232 until then the packaged Mac app opened a blank window.
- Linux hardware validation: install the `Kino-x86_64.flatpak` artifact from the Linux Flatpak workflow on a machine with a VA-API GPU and play SDR, HDR10 and a torrent source.
- Windows hardware validation: unzip `Kino-windows-x64-with-engine` from the Windows workflow and play the same sources with D3D11VA on the Windows PC.

Close when: every box in #182 is checked or explicitly deferred there.
