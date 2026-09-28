# Full-featured and stable on every platform

Read when: continuing the multi-milestone push to a full-featured, stable Kino, or picking the next chunk of platform work.

Status: blocked on Chris; what remains is the v0.1.0 retest.
Plan: issue #182, deleted from GitHub by 2026-09-28 along with #176 (cast search) and #143 (diagnostic reports). Every milestone in it was done except the v0.1.0 tag; its pull requests carry the detail.
Source: Chris's instruction of 2026-09-25 to plan and implement a full-featured, stable Kino on all supported platforms, with full agency.

## Continuation facts

- Milestones 1, 3 and 4 are done. Milestone 5's code, packaging and notices shipped (#232 to #252). Windows passed every probe and the playback gate on the gaming PC (#255), and Linux on the Ubuntu laptop and minicore (#257), with the MPRIS gate (#258), interface recovery on Linux (#259, #261) and a real suspend through logind (#260). HLG now plays on the TV, and HLG and Dolby Vision 8.4 are pixel-gated on both clients (#264). Each chunk is its own pull request, squash-merged once CI passes.
- The `kardboard` ruleset allows only squash merges through a pull request. Chris set its required approvals to zero on 2026-09-28, after `milo-devbot`, which `gh` uses on `agent-pc` and which cannot bypass rules, could not merge #280; `gh pr merge --squash --delete-branch` now merges once CI passes.
- The development Shield answers at `10.0.0.191:5555`. If `adb connect` reports "No route to host" while `nc -z 10.0.0.191 5555` succeeds, restart the adb server (`adb kill-server`) and connect again.
- The running desktop app can be driven without taking over the screen: launch `build/macos/Kino.app/Contents/MacOS/Kino` with `QTWEBENGINE_REMOTE_DEBUGGING=127.0.0.1:<port>` and use the DevTools protocol. Accessibility clicks do not reach WebEngine content.
- After a Homebrew upgrade of mpv or its dependencies, CMake fails with "includes non-existent path". Delete `build/macos/CMakeCache.txt` and build again.
- Chris allows running and testing on his Windows and Linux machines. `gaming-pc` (PowerShell over SSH) runs the probes in his signed-in session through a scheduled task; `%USERPROFILE%\kino-validation` holds node and ffmpeg under `tools`, a clone in `kino`, and the portable build in `portable\Kino`. The Intel Arc laptop of the first Linux run was reinstalled on 2026-09-27 as `agent-pc` (user `milo`, Xubuntu 26.04.1, Xfce on X11), so its `~/kino-validation` is gone. The validation records under `docs/validation/` say how to run in each signed-in session. minicore runs the same checks in a container under headless Weston.
- `agent-pc` builds and runs everything but the Mac: on 2026-09-27 it got JDK 21, the pinned NDK under `~/Android/Sdk`, rustup, `pkgconf`, `dovi_tool` and `mkvtoolnix` for the TV, and the README's Linux shell packages with `intel-media-va-driver`. Export `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`, `ANDROID_HOME=$HOME/Android/Sdk` and `PATH=$HOME/.cargo/bin:$PATH` before `pnpm android:*`. Its ADB key is authorized on the Shield. The desktop playback gate runs there with `DISPLAY=:0 KINO_APP_BINARY=build/linux/Kino`. Its 16 GB fills after a few TV builds: the Gradle and Kotlin daemons held about 6.5 GB, swap filled, and `pnpm check` then failed with Vitest timeouts. Run `./gradlew --stop` in `apps/android-tv` before `pnpm check` or the desktop gates there.
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

## Traps found on 2026-09-26

- mpv measures each HDR frame's peak wherever the GPU has compute shaders, so Linux drew HDR darker than the Mac, whose OpenGL 4.1 has none. Every desktop sets `hdr-compute-peak=no` (ADR 0026, #257). Windows matched the Mac even before that; why is unknown.
- mpv labels Dolby Vision 8.4 frames PQ. Its `format:dolbyvision=no` filter restores the HLG base layer's transfer but leaves display light, which skips HLG's OOTF; the shell sets `light=hlg` for that file only (ADR 0027, #264).
- Stock Ubuntu has no Intel VA-API driver; `intel-media-va-driver` supplies it. The Flatpak's runtime pulls `org.freedesktop.Platform.VAAPI.Intel` by itself.
- Windows paths ignore case: extracting the portable zip's `Kino` folder beside a clone named `kino` merges them, and deleting one deletes the other.
- DevTools' `Page.crash` does nothing to a Qt WebEngine renderer on Linux. The recovery probe kills the process `SystemInfo.getProcessInfo` names instead (#259). In the Flatpak that number is the sandbox's, so the probe finds the host process by its `NSpid` numbers (#261).
- Qt WebEngine 6.11 keeps a freed accessibility parent after the interface process dies, and a macOS accessibility client reading the tree then crashes Kino. The shell reloads at once to narrow the window (#261). CI's Mac runners run no accessibility clients, so only a Mac like Chris's shows it.
- The desktop portal's WebEngine sandboxes inherit Kino's stderr and outlive a killed Flatpak Kino, so a probe reading that pipe never finishes. `scripts/test-support/kino-flatpak.sh` routes stderr through a file it follows for as long as Kino runs.
- Looping a probe with Kino under `lldb` through a wrapper left an orphaned lldb of about 4 GB per run and nearly exhausted the Mac's memory. Check for leftovers and memory after any loop.
- `pkill -f PATTERN` inside a compound or SSH command matches that command's own shell and kills it. Match on the process name, or bracket the pattern (`[n]ode scripts`), in a command of its own.
- `systemctl suspend` from SSH asks for interactive authorization; `pnpm linux:check-sleep` suspends through `sudo -n` (#260). macOS has no `timeout` command.
- The TV's mode change renegotiates HDMI audio, Android broadcasts audio becoming noisy, and Media3 pauses; the frame-rate matcher undoes that pause for fifteen seconds after its request (#265).
- `check-macos-focus` failed several runs on the macOS runner because its first Enter never reached the page: Chromium drops input while it holds a page's first frames, still acknowledges it, and React had already focused Home. Every DevTools key now waits for the page's first contentful paint. WebEngine probe timeouts report the page's state, whether it has painted, and the input it received.
- `macdeployqt` given `import QtQuick` copies all of Qt's `QtQuick` directory, 3D and the virtual keyboard included, and every plugin of each kind; it took nine of rc.1's twelve packaging minutes. Packaging now bundles what `qmlimportscanner` names and what that links (ADR 0028).
- `readdirSync(root, { recursive: true })` follows directory links. The old bundle's WebEngine helper linked back to `Frameworks`, and the walk looped until Node's heap ran out; `scripts/macho.mjs` walks without following links.
- `cpSync(link, target, { dereference: true })` fails on a link to a file with `ERR_FS_EISDIR`, and on the macOS runner it copied the links inside a directory as links, which codesign refused as leading out of the bundle. Packaging resolves and copies each file itself.
- Homebrew's Qt reaches its libraries through `@executable_path`, which inside the WebEngine helper means the helper's own folder. Each bundled binary now searches only `@loader_path`-relative `Frameworks`.
- A Kino killed with SIGTERM leaves its single-instance socket in `$TMPDIR`; Kino clears a stale one at launch, and the probes remove theirs.
- The notice review pins Homebrew versions from CI's runner. A Mac whose Homebrew lags, such as libtorrent 2.1.1 against the reviewed 2.1.2, fails `pnpm macos:package` at the notices step.
- TheIntroDB groups submissions into release versions and selects one up to 60 s from the requested runtime, then falls back to the most submitted; its documentation names no window. Kino required the runtime to the millisecond, so community intros almost never applied, and the fixtures used exact runtimes, so every gate passed (ADR 0029). `pnpm intro:check-live` now runs the client against the service.
- The TV concluded a Matroska file had no chapters only at the end of the file, so a chapterless release, the common case, never asked TheIntroDB during playback. Chris found it on Ted Lasso S3E4; the 30-second fixtures reached their end at once and hid it. Absence is now concluded at the first cluster.

## Traps found on 2026-09-28

- The Shield's log buffer holds about eleven minutes, so a failure Chris reports later is gone. `adb logcat -G 16M` raises it until the next reboot, and a background `adb logcat -v threadtime -b main,system,crash -T 1 >> file` loop keeps a copy on the host while he tests. `KinoIntro` lines say where chapters came from and how the file's runtime compares with TheIntroDB's versions.
- Chris's sources come from AIOStreams through Real-Debrid: HTTPS links that redirect to the file. Anything Kino fetches from a source itself must follow redirects as the player does (#286).
- Media3's `MatroskaExtractor` reads colour only from the container's Colour element and never sets `Format.frameRate`; Kino fills both from the stream and the track's DefaultDuration (#285, #289).
- Media3's `PlayerView` takes a direction key as "show the controls" until they have faded in, and keeps a paused player's controls up. The TV's remote handling in `TvPlayerLayout` works around the first; tests that need hidden controls must play (#291).
- A TV test that leaves the shared fixture episode mid-way saves progress that the next test resumes at; see the lesson note.

## rc.5 feedback, 2026-09-28

Chris's list after a session on rc.5, and what became of each: HDR10 remux without colour tags failed (#285); Skip Intro never ran on debrid links (#286); a confirmed update showed as cancelled (#287); the refresh rate stuck after leaving the player (#289); Home jittered along a row (#292); the remote should work as Stremio's, with shorter seeks (#291). He chose to keep an SDR source's range blank rather than guess it. All shipped in v0.1.0-rc.6. Open: #290, the flaky Dolby Vision pixel probes on Linux.

## Waiting on Chris

- The v0.1.0 tag waits on his daily-driver retest of the latest pre-release on the releases page. After the rc.6 suite runs the Shield was put back on the rc.6 release, signed out, so Chris signs in once and later releases install over it from Settings. `pnpm android:check` refuses to run over a release; uninstalling it first clears the TV app's sign-in and settings, so ask Chris. The confirmed-update path of #287 can only be checked by him, on the next update.

Close when: v0.1.0 is tagged after Chris's retest.
