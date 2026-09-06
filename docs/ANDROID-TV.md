# Android TV development build

Kino has a native Kotlin and Compose TV app in `apps/android-tv`. The first build targets ARM64 devices running Android 9 or newer and is tested on an NVIDIA Shield.

This is the first runnable TV version. It includes Stremio device-link sign-in, guest browsing, Home, Search, Library, movie and episode details, explicit source selection, and fullscreen Media3 playback. Continue Watching uses poster cards with titles below, a centered play icon, and saved progress. Opening a Continue Watching item shows a loading screen until the remembered source comes back from its add-on, then plays it; Back during that wait reveals the details page for a manual choice. If every add-on answers without that source, the loading screen gives way to the source list without an unavailable-source notice.

## Interface

Home follows the Mac app's structure: Continue Watching, Movies, and Series, without an unrelated featured-title banner. All media cards use the same 2:3 poster size. Titles wrap below the posters, including long titles, and Continue Watching displays Core's percentage progress as a fractional bar.

A compact icon rail expands into a labeled drawer when focused. The first Home poster receives focus on entry. Left from the first poster returns to the active navigation item, and Back from details restores the selected poster and its scroll position. Search groups movies and series into rows. Library has All, Movies, and Series filters. Add-ons has its own read-only list. Settings provides account actions, Up Next, Audio output, subtitles on/off, preferred audio and subtitle languages, artwork cache size and clearing, and Copy diagnostic summary.

Series have a season selector above full-width episode rows. New viewers start at Season 1, or the first available regular season. Core's current episode selects its season; a watched finale advances to the next available regular season. Announced, unreleased episodes count when identifying a finale. Specials and unnumbered episodes have separate entries. Later metadata or progress updates do not replace a season the viewer already chose.

Choosing a season does not request sources. Choosing an episode opens a separate page, and source rows must match that episode before they can play. Back restores the episode list and focus, including after leaving playback or a playback failure. Guest and account entries keep separate navigation state. `SeasonNavigationTest` checks the season rules and drives this path with remote keys on the Shield.

Posters enlarge over 140 ms; the drawer and page entry use 160 ms transitions. New input replaces a running transition, and only the current page can receive focus. Compose's motion duration scale applies to these animations. `NavigationMotionTest` checks disabled motion without changing device settings.

Library renders its grid as cached rows, keeping a viewport on either side of the visible rows. Poster titles and their year/type caption are announced together on the card. `NavigationPerformanceTest` exercises loaded and loading artwork, repeated remote input, shelf changes, the drawer, and long episode/source lists on the Shield. [Frame measurements](validation/android-navigation.md) record the build comparison and the device gate.

Gradle generates Android colors from `packages/design-tokens/src/tokens.css`. The TV app uses native Compose TV controls with Geist typography and Lucide icons, matching the Mac app's palette and visual language. The four bundled Geist weights were converted from the repository's locked `@fontsource-variable/geist` 5.3.0 Latin font. Lucide vectors come from commit `94e4cb9d9db5907053ebf3636a97c45529cf776b`. Their licenses are included in the APK's `assets/licenses` directory.

Settings changes apply to new playback. A private provider in the default process owns the existing device-preferences file; guest and account callers read and edit it through that owner. Returning to Settings refreshes values changed in the other process. Up Next defaults to on, subtitles default to off, and Audio output defaults to Auto. Both language pickers offer the same 15 languages as desktop, focus the current choice on opening, and return focus to the invoking row. Changing a language updates only that field in the current local Core profile and waits for a durable write; a failed write offers Retry. It does not send a remote account-settings update. Remembered movie or show track choices take precedence over these defaults.

Up Next uses Core's next episode and appears in the final two minutes, capped at the final 10% for shorter videos. Seeking earlier hides it; unknown duration waits for end-of-file. The offer stays available when playback controls hide and does not take focus when it appears. Up from visible playback controls focuses Choose source, and Down returns to those controls. Choosing it waits for the final progress and Unload writes before opening that episode's source list. Failed saves offer Retry with the same destination. The source list never starts a stream automatically.

Clear cache removes the current profile's Coil memory and disk artwork entries. Guest and account processes have separate cache directories. Clearing does not remove profiles, credentials, library state, progress, add-ons, or Kino settings. The displayed size counts disk entries; artwork may refill the cache when browsing resumes. Copy diagnostic summary places app/build, Android/API, ABI, Core revision, Media3, loaded FFmpeg codec version and playback policies on the Android clipboard. It includes no account, title, source, device identifier, filesystem path, or log content.

## Build and install

On the Mac, set `ANDROID_SERIAL` to the target device's ADB serial or `IP:5555` address:

```sh
brew install --cask android-commandlinetools
brew install openjdk@21
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
sdkmanager 'platforms;android-36' 'build-tools;35.0.0' 'ndk;29.0.14206865'
pnpm android:build
pnpm android:run "$ANDROID_SERIAL"
```

The build also requires `rustup`, Python 3, and Git. It installs Rust 1.93.1 with the Android ARM64 standard library through rustup. `JAVA_HOME` and `ANDROID_HOME` override the Homebrew defaults on other hosts. Gradle 8.13 is downloaded by the checked-in wrapper and verified by SHA-256.

The non-debuggable, R8-optimized, development-signed APK and its checksum are written to `build/android/Kino-TV.apk` and `build/android/Kino-TV.apk.sha256`. The app appears as **Kino** in the TV launcher. Select **Settings → Sign in** to link Stremio using a phone. This does not copy the Mac's credentials or profile to the TV.

After the first native build, Kotlin-only iteration can use the commands below. Gradle refuses to build until `pnpm android:build` has produced the FFmpeg audio renderer under `build/android-ffmpeg`, since an APK without it fails every surround source on the Shield.

```sh
cd apps/android-tv
./gradlew :app:assembleRelease
adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/release/app-release.apk
adb -s "$ANDROID_SERIAL" shell am start -n app.kino.tv/.MainActivity
```

Use `:app:assembleDebug` only when attaching a debugger. Its Compose runtime and frame timings differ from the installed development artifact.

The Android TV GitHub Actions workflow builds the APK, compiles the device tests, and runs Android lint. It uploads the APK and checksum as a workflow artifact. Hardware checks still run on the Shield.

## Core and profile boundaries

The Kotlin bridge is pinned to Stremio `stremio-core-kotlin` 1.15.0, commit `2a8083f1026603e7c49f104473340d110902a72c`. Its Cargo lock pins Core to `9a827fdd6f319ba3c22a96436c5f61292cb24ff1`. The bridge's release archive is verified by SHA-256 and supplies Kotlin bindings and protobuf classes. Kino compiles its JNI library from source with the checked-in patches and Cargo lock.

The patch disables analytics and upstream diagnostic payloads, limits responses to 16 MiB and requests to 20 seconds, and requires HTTPS without URL credentials. GET redirects must remain HTTPS and stop after ten hops. Requests with bodies cannot redirect. Local Files requests are blocked and its descriptor is hidden from the presentation. Generated Rust protobuf files use Cargo's output directory so reconstructing the vendor checkout cannot invalidate a cached build.

`TvCore` converts Core's protobuf models into presentation data and owns its actions. Catalog ranges are explicitly requested. Backward seeks use Core's `SeekAction`, since its ordinary `TimeChanged` action only advances progress.

Guest and account sessions use separate Android processes and private preference files. Each process owns one native Core runtime. Signing in leaves the guest runtime and storage intact; signing out clears the account's local credentials and returns to the guest process. Android backup and device transfer are disabled for app data.

Startup routes to the saved account process before composing the guest interface. Loading, sign-in, and browsing derive from the same Core state, so a restored signed-in profile does not briefly render the device-link screen.

## Device checks

```sh
pnpm android:check "$ANDROID_SERIAL"
```

This generates legal synthetic media in `build/android-fixtures`, builds and installs the non-debuggable benchmark APK and its test APK, wakes the Shield, and runs instrumentation. The benchmark variant retains the APIs called from the separate test APK and compiles a loopback-only transport for synthetic persistence fixtures. The distributed release variant removes unused APIs and excludes the fixture entry points. The command reinstalls `build/android/Kino-TV.apk` after the checks, including after a failure. Test Core storage is isolated from both user profiles. The tests exercise native catalog and metadata requests, device-link creation, saved progress and its display fraction, backward seeking, startup routing, hardware H.264/HEVC SDR playback, and rejection of unsupported video. A separate instrumentation-only player probes OpenGL HDR-to-SDR conversion without enabling it in Kino.

The shared fixture generator checks HDR primaries and transfer metadata with ffprobe. It regenerates stale fixtures whose names say HDR but whose video is missing those tags.

Sanitized diagnostics are available through:

```sh
adb -s "$ANDROID_SERIAL" logcat -s KinoCore:I KinoPlayer:I KinoProbe:I
```

`KinoPlayer` reports the hardware video decoder, each audio track's format, layout, and support verdict, the audio decoder, and sink errors, with no titles, URLs, or identifiers.

The instrumented suite covers native Core browsing, device-link creation, saved progress, startup routing, hardware H.264 and HEVC SDR playback with NVIDIA codecs, rejection of unsupported video, surround audio through AC-3, E-AC-3, and DTS fixtures under both audio output settings, the stereo downmix, caption styling, the presentation player, remote focus on the playback surface, the source field parser, and remembered audio/subtitle choices across movie/show reopening and replacement sources. The season checks cover Core completion semantics, remote selection, delayed source identity, and focus/scroll restoration through playback and profile changes. The persistence checks hold real storage callbacks and HTTP response bodies, fail writes, and retry retained snapshots. The playback shutdown checks cover Back through both the final-position write and Unload's next-episode write, duplicate Back, and retry after Activity replacement. Two further instrumentation runs save a nearly completed episode, stop the process, and restore its next-episode position through a fresh Core. The track checks also cover unavailable-language fallback, subtitle Off, title separation, and returning to automatic audio selection. `SettingsTest` changes device settings while both guest and account processes remain alive, verifies that returning to the guest screen refreshes its values, and checks that later track writes preserve those changes. It also drives language selection and focus, all 15 language writes with other profile fields preserved, failed-write Retry, actual fullscreen audio/subtitle selection, Coil cache clearing and retained track preferences, and the copied diagnostic allowlist. Four further instrumentation runs verify language, Up Next, and subtitle/audio preferences after a process restart using isolated guest and account profile names. `UpNextTest` drives the real JNI Core and hardware player through both ending windows, repeated remote focus changes, media keys, disabled and missing-next cases, and unknown-duration EOF. It delays final and Unload writes independently and checks failed-save Retry and the resulting source list without starting a stream. Returning from Up Next restores the selected episode, including across seasons and outside the previous list viewport. The correctly tagged HDR10 and HLG probes both failed before rendering with Media3 error 7001; the ordinary player rejects HDR rather than displaying unvalidated output.

### Driving and observing the Shield

The development Shield is on the local network at `10.0.0.191`. `adb connect 10.0.0.191:5555` attaches it; `adb shell input keyevent KEYCODE_WAKEUP` wakes it before instrumentation, which `pnpm android:check` does itself.

Only `pnpm android:check` bundles the fixtures into the test APK. Building with `scripts/build-android.py` or gradle alone and then running instrumentation fails every media test with `FileNotFoundException` on a fixture name; that is a missing asset, not a regression. To rerun one class after the suite restores the distributed APK, first reinstall the benchmark host:

```sh
adb -s "$ANDROID_SERIAL" install -r apps/android-tv/app/build/outputs/apk/benchmark/app-benchmark.apk
adb -s "$ANDROID_SERIAL" shell am instrument -w -r -e class app.kino.tv.ShieldAudioTest \
  app.kino.tv.test/app.kino.tv.ShieldTestRunner
adb -s "$ANDROID_SERIAL" install -r build/android/Kino-TV.apk
```

A signed-in Shield launches into `AccountActivity`, the same interface in the account process, so seeing that activity name means sign-in worked. From Home, `KEYCODE_DPAD_CENTER` on the focused Continue Watching item resumes playback directly; `KEYCODE_DPAD_DOWN` then `KEYCODE_DPAD_CENTER` opens a details page with live sources instead.

To read state rather than guess at it:

- `adb shell dumpsys activity top` prints every foreground app's view hierarchy. Scope it to the `ACTIVITY app.kino.tv` section; SmartTube runs on the same device and also has `exo_` views. The flag string after each view starts with its visibility (`V`, `I`, `G`), and the second group shows `.F......` for the focused view.
- `uiautomator dump` sees Compose text on browsing screens but not the player's `PlayerView` subtree.
- `screencap` returns the video layer black; controls and Compose overlays render.
- `adb shell dumpsys media_session` shows playback state (`state=3` is playing) and the rate.
- Audio: this Shield declares no AC-3, E-AC-3, DTS, or TrueHD decoder for apps, and with its surround setting on manual and nothing enabled the HDMI plug intent advertises PCM and IEC61937 only, so passthrough is refused and the FFmpeg renderer decodes. An agent cannot hear the output; audible checks need a person at the TV.

A recording of the signed-in cold launch reproduced the old "waiting for sign-in" flash. The same frame/OCR check passed after the startup change and confirmed that Home loaded. On-device navigation checks covered wrapped card titles, the expanded drawer, and returning from details to the selected poster.

## Remaining TV work

This build supports direct HTTPS media, HLS, and DASH through Media3. Torrent sources remain unavailable until the approved engine is ported. HDR needs further player work, including the libmpv alternative in the existing architecture decision. The frame-processing probe has not established correct HDR or Dolby Vision output.

The TV presentation still needs Discover and pagination, add-on management, complete subtitle controls, Skip Intro, release update handling, and distribution notices. Signed-in browsing and saved-account restoration have been exercised on the Shield. Surround audio plays through passthrough where the sink allows it and through the bundled FFmpeg decoders otherwise; `pnpm android:check` covers AC-3, E-AC-3, and DTS fixtures on the device. This build does not yet meet the Phase 4 daily-driver exit criteria.
