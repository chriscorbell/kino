# Kino

Kino is a Stremio-compatible media client with an original desktop and television interface. Development starts on macOS, followed by Android TV, Windows, and Linux.

The first release focuses on browsing, explicit source selection, reliable playback, progress sync, and a built-in Skip Intro feature.

## Development

Requirements:

- Node.js 24
- pnpm 11

```sh
pnpm install
pnpm dev
```

The client browses, searches, and resolves sources through the real Stremio Core. Home gives each installed movie and series catalog its own row, named by its add-on, and See all opens that catalog in Discover. Library sorts by the orders Core offers and marks partial progress, watched titles, and series with new episodes. Library and Discover provide Load more controls. Failed later pages retain the visible titles and offer Retry. `pnpm core:check-pagination`, included in `pnpm check`, exercises the pinned WASM with 125 saved titles, duplicate catalog entries, delayed responses, failed-page retries and filter changes.

Details pages show the add-on's logo art, IMDb rating, genres, cast and directors. Cast names are plain text until [issue 176](https://github.com/chriscorbell/kino/issues/176) settles whether cast search is useful. Series show one season at a time in numeric episode order. The season selector only changes the list; choosing an episode opens its sources page. Episode rows show the add-on's thumbnail and air date, and Core marks announced episodes of a scheduled series as Upcoming. Back restores the selected season, scroll position, and focused episode, including after playback. `pnpm core:check-seasons` verifies initial season selection against Core's saved progress and watched state. `pnpm macos:check-seasons` drives the production interface in Qt WebEngine through season changes, delayed sources, playback return, and profile changes.

Movies, episodes, and whole seasons can be marked watched or unwatched from the details page. Marking a title does not add it to the library. Marking the episode Continue Watching points at moves it to the next episode. `pnpm core:check-watched` drives those actions through the pinned WASM and reads the flags back.

Every Core model is read through validating adapters, so screens receive navigation requests and playback fields rather than serializer payloads, as recorded in [ADR 0018](docs/adr/0018-read-stremio-core-through-a-validating-adapter.md). `pnpm core:check-contract` runs those adapters against the pinned WASM; `pnpm core:capture-fixtures` regenerates the committed fixtures they are unit-tested with.

Configurable add-ons open their provider's settings page in the system browser. Paste the resulting HTTPS manifest URL or Stremio install link into Add-ons. Kino asks whether to replace existing configurations or keep both, and verifies the new installation before removing an old configuration.

### Android TV

The native Kotlin/Compose development app runs on the NVIDIA Shield. The distributed development APK is non-debuggable and optimized with R8; `pnpm android:check` includes remote navigation and frame-time gates on the device. It includes remote navigation, Stremio device-link sign-in, browsing, details, source selection, and hardware playback, with HDR10 tone mapped to SDR by Kino's own shader. TV offers Up Next near an episode ending and opens the next episode's sources only after saving progress. TV also resolves trusted embedded or community intro markers, marks them on the timeline, and supports manual or optional automatic skipping with Undo. TV Settings controls Up Next, Skip Intro, subtitle and language defaults, clears cached artwork, copies a diagnostic summary, reads the license notices the APK carries, and checks for updates, which it installs through Android's installer after checking the download. The Shield suite checks the real cache, clipboard, playback tracks and preferences after process restart. See [Android TV development](docs/ANDROID-TV.md) for toolchain setup, device checks, and current limitations.

```sh
pnpm android:build
pnpm android:run "$ANDROID_SERIAL"
```

### macOS shell

The native bootstrap currently targets Apple Silicon on macOS 26 and links against local Homebrew libraries. Install CMake, Qt, libmpv, pkg-config, and FFmpeg (used only to generate playback fixtures), then build the development app:

```sh
brew install cmake qt mpv pkgconf ffmpeg
pnpm macos:build
open build/macos/Kino.app
```

The shell loads the packaged Kino UI, keeps Stremio authentication material in an owner-only file under Kino's application data, and hands playback to libmpv with VideoToolbox hardware decoding, forced SDR output, and an optional Stereo path that downmixes and normalizes loudness. Playback integrates with macOS media keys and Now Playing, blocks display sleep only while video plays, and exposes embedded and add-on subtitles with delay, size, and position controls. It is a local validation build, not yet a signed or self-contained distribution. The WebChannel, including that authentication store, reaches only Kino's own interface: the main frame refuses any navigation outside the packaged UI directory, or outside the development server's origin. `pnpm macos:check-navigation` drives real navigations from both kinds of interface to check it. Run the short native launch regression probe with:

```sh
pnpm macos:check-launch
```

Settings can copy a diagnostic summary with the application version and build kind, macOS, Qt, Core, player, and engine versions, and playback capabilities. The summary excludes account data, media URLs, paths, and log contents. External engine overrides report an unknown version. The `diagnostic_summary` CTest suite uses an offscreen clipboard contained within the test process.

The player saves volume locally between launches. Its slider and Up/Down shortcuts adjust 0-100% volume; M toggles mute, and raising volume unmutes playback. Focused sliders keep their native keyboard step. Run `pnpm macos:check-volume` to verify the production WebChannel method and libmpv volume notifications, including bounds.

Desktop navigation moves focus to the page or heading without drawing an outline. Keyboard controls and Skip to content retain their visible focus indicators. `pnpm macos:check-focus` exercises the production bundle in Qt WebEngine through launch, navigation, Tab, and Skip to content.

A Continue Watching card for a series names the saved episode, such as S2 E5, when its video id follows Stremio's `<title>:<season>:<episode>` convention; other id schemes show no label rather than a guess. Continue Watching covers the desktop with a spinner while the remembered add-on answers, then starts the previous source if it still matches. Escape reveals manual selection and cancels the pending resume. `pnpm macos:check-resume` compiles the production presentation with delayed Core snapshots and checks movie and series coverage from the first frame, keyboard focus, cancellation, profile changes, and playback preparation before unrelated add-ons finish.

The fullscreen button and F toggle the current window state. Escape exits fullscreen after closing any open subtitle menu. The native bridge follows Qt window visibility, including changes through macOS window controls. Run `pnpm macos:check-fullscreen` to verify the actual WebChannel property and change notifications through repeated entry and exit.

Validate the playback contract against generated legal fixtures — codecs, HDR ranges, audio formats, subtitles, chapters, and failure paths — with the command below. The probe keeps its player hidden until playback starts and loads immediately, as the app does, so a source that opens before the renderer exists would fail it by playing without video:

```sh
pnpm macos:check-playback
```

Run the native regression tests after building with:

```sh
ctest --test-dir build/macos --output-on-failure
pnpm macos:check-request-headers
```

The render lifetime test checks the real libmpv calls for the original current OpenGL context, callback removal, and render cleanup before core destruction. It exercises item and window deletion plus repeated scene-graph invalidation on the GUI thread and a dedicated render thread. To include repeated hardware playback and verify rendered frames after reconstruction, generate the fixtures above and run:

```sh
KINO_LIFETIME_MEDIA="$PWD/build/fixtures/h264-sdr-aac.mp4" \
  ctest --test-dir build/macos -R render_lifetime --output-on-failure
```

Direct media uses the add-on's original HTTPS URL and required request headers in libmpv, independent of any Stremio Service URL saved in the account. TLS certificate verification is required, against the macOS system trust anchors: the bundled FFmpeg and libtorrent use Homebrew's OpenSSL, whose own certificate directory exists only on a Mac with Homebrew, so the shell exports the system roots at launch and hands that bundle to libmpv and the streaming engine. `pnpm macos:check-tls` plays HTTPS media with OpenSSL's certificate locations emptied and checks that an unknown authority is still rejected. The native header check drives the production WebChannel and player through a protected media request, external subtitles, and a second source. It verifies literal header values, prevents headers from carrying into subtitles or later sources, rejects header injection and untrusted certificates, and checks diagnostic output for synthetic credentials. It uses `openssl` for the untrusted certificate and generates a short H.264 fixture with `ffmpeg`, or uses `KINO_PLAYBACK_FIXTURE` when provided.

Community intro markers require an exact known runtime. `pnpm intro:check` exercises the bundled client against HTTP fixtures, `pnpm macos:check-intro` repeats the match and cancellation checks in Qt WebEngine, and `pnpm android:check` drives the real Media3 player and remote on the Shield.

### Brand assets

The Kino mark lives in [`assets/brand/`](assets/brand/). `Kino.icon` is the Icon Composer document the app icon is drawn in; `kino-app-icon.png` is its 1024 point export, and `kino-mark.svg` is the K on its own for surfaces that already supply a dark background. Both clients redraw the mark from that SVG rather than embedding a copy of the icon.

Icon Composer exports art that fills its canvas edge to edge, which is what iOS wants and what makes a macOS icon sit larger than its neighbours in the Dock. `pnpm macos:icon` places that art on the macOS grid, 824 of a 1024 point canvas with the drop shadow the system does not draw for legacy icon resources, and writes `apps/macos-shell/resources/Kino.icns`. `pnpm macos:check-icon`, included in `pnpm check`, reads the committed icns back and fails if any variant is missing or has gone full bleed.

Android TV draws `kino_mark` for the navigation rail and welcome screen, and `kino_icon` for `android:icon`, which carries the icon's background so it stays readable on any launcher. Both are vector drawables.

The launcher banner is not, because Google asks for one raster per density bucket and the artwork carries shading a vector cannot reproduce. `pnpm android:banner` renders `kino-banner.svg` into `res/mipmap-*/kino_banner.png` at all five sizes, 160x90 through 640x360. The banner is opaque and full bleed with square corners: launchers apply their own rounding, and a baked-in corner shows through as a transparent notch. That renderer fails quietly, so `pnpm android:check-banner`, included in `pnpm check`, reads the pixels back and fails when a density is missing, is not fully opaque, or is blank where the mark or the wordmark belongs.

### Streaming engine

Torrent sources play through a pinned build of the open [stream-server](https://github.com/stremio-native/stream-server) engine, which the shell starts on demand and binds to loopback. The TV app runs the same engine, cross-compiled by `pnpm android:build`; [Android TV development](docs/ANDROID-TV.md) describes it. It is optional: without it Kino runs normally and reports torrent sources as unavailable. Build and bundle it with:

```sh
brew install rustup libtorrent-rasterbar boost
pnpm engine:build
pnpm engine:check-profile
pnpm engine:check-trackers
pnpm macos:build
pnpm macos:check-engine
pnpm macos:check-engine-ui
```

Each engine build reconstructs `build/vendor/stream-server` from the pinned revision and current patches, then enforces Cargo's lockfile. It compiles with the Rust release pinned in `apps/stream-engine/rust-toolchain.toml`, through rustup, because packaging embeds that release's runtime and checks its notices by compiler revision. Keep upstream changes in `apps/stream-engine/patches`; edits inside the generated vendor directory are discarded. `pnpm engine:check-vendor` checks patch changes and failed retries without requiring the native toolchain.

Audio and subtitle picker choices are saved on the current device per movie or show. A later episode inherits its show's choice; a replacement source matches by language, codec, and track variant. An absent remembered track falls back to the Settings language preference, and subtitle Off is remembered too. Desktop add-on subtitles use a fresh URL from Core's current response. `pnpm macos:check-track-choices` drives the React pickers and real libmpv through movie/show reopening, replacement and missing-track sources, Off, and add-on subtitles. `pnpm macos:check-audio` separately checks the native language preference and manual-switch bridge. The Shield suite exercises the same embedded-track behavior through Media3, including choosing Auto again.

The shell gives the helper 30 seconds to become ready and terminates it if that deadline expires. An unexpected exit reports a playback failure. Selecting a torrent source again starts a fresh helper after failure. CTest exercises ready, silent, premature-exit, post-ready-exit, and retry cases with a temporary helper; `pnpm macos:check-engine-retry` verifies retry through production QML and WebChannel. These checks require no torrents. `KINO_ENGINE_STARTUP_TIMEOUT_MS` can shorten the deadline for fixtures.

Clear Cache asks the helper to shut down over stdin, waits for a successful exit, then deletes disposable files. A failed or timed-out shutdown leaves the cache intact and reports failure in Settings. Playback requested during deletion waits until clearing finishes. The next playback starts a fresh helper with a new session capability. Cache clearing is refused while the native player is active.

Engine settings live in Kino's application data directory under `streaming-engine`, separate from the media cache and rotating shell logs. Existing `settings.json` files and legacy diagnostics are preserved before the first new helper starts or cache clearing proceeds. Developer fixtures can set `KINO_CACHE_DIR`, `KINO_ENGINE_CACHE_DIR`, and `KINO_ENGINE_CONFIG_DIR` to isolated paths; the helper requires its configuration path explicitly. `pnpm macos:check-cache-clear` exercises real torrent playback, leaving playback, clearing, and replay in one shell process using synthetic media and temporary storage. It also checks that seeding and download-limit settings survive.

The engine never asks the router to forward a port through UPnP or NAT-PMP, and never announces loaded torrents to the local network, as [ADR 0022](docs/adr/0022-keep-the-streaming-engine-off-router-port-mapping-and-lan-discovery.md) records; `pnpm engine:check-profile` checks the running helper's sockets for both. Kino excludes the upstream YouTube resolver and yt-dlp downloader from its engine. `pnpm engine:check-profile` starts the helper with a fresh cache and a blocking HTTP proxy, then checks that startup and an unsupported YouTube request create no executable tools or release-download requests. The engine's tracker-list data refreshes remain allowed.

Engine diagnostics pass through Kino's sanitizer before entering the shell's rotating log, available through Open Log Folder. Request URLs, queries, headers, and sensitive details are omitted; event locations, levels, and safe failure details remain. The helper creates no separate log files. The engine profile check exercises synthetic credentials, and CTest checks forwarding and the five-file, 10 MB rotation limit.

WebEngine console messages enter the same rotating log under `kino.web`, preserving info, warning, and error levels. Messages flagged by the sanitizer are omitted in full, and script URLs are excluded. Run `pnpm macos:check-web-console` to check the production WebEngine handler, file output, and stderr with synthetic messages.

The embedded HTTP API requires a fresh 256-bit token in its base URL, shared with Kino over the helper's private stdout pipe. Every request checks that token, the bound loopback Host, and the configured UI Origin. Only health, torrent creation/removal/media reads, and Kino's seeding/download-limit settings are exposed. The URL works directly with libmpv's byte-range requests and is never included in diagnostics or the startup probe's output. `pnpm macos:check-engine-ui` verifies the production WebChannel and WebEngine path with both local-file and HTTP development UI documents, using disposable engine caches.

The engine profile check streams a private torrent from a local web seed and compares returned range bytes. Set `KINO_ENGINE_MEDIA_FIXTURE` to a legal playback fixture and `KINO_ENGINE_PLAYER_BINARY` to the built Kino executable to include actual libmpv playback in that check.

`pnpm core:check-streams` runs the pinned Core WASM serializer and verifies that add-on torrent trackers survive resolution into the engine request. It runs in CI as part of `pnpm check`. `pnpm engine:check-trackers` also runs a local tracker and a libtorrent seeder with DHT, local discovery, and peer exchange disabled. A random unpublished torrent must transfer through the actual engine using only the tracker supplied through Core. This native check requires the engine build, a C++ compiler, and `pkg-config` for libtorrent.

Run the web checks, pinned Core integration checks, and vendor reconstruction regression with:

```sh
pnpm check
```

CI runs those checks on every PR. Changes to the native shell, native bridge, engine, build scripts, workflow, or dependency locks also run on a macOS 26 ARM runner. That job reconstructs the pinned vendor checkout, applies patches, builds and tests the Rust helper with `--locked`, checks the engine profile and tracker transfer, compiles the shell and packaged UI, and runs CTest plus launch and engine-supervision probes. Homebrew downloads and Cargo outputs are cached. The `Validate` result includes every applicable job.

The hardware playback fixture matrix, HDR tone mapping, and audio output checks remain manual release gates. Hosted runner probes do not establish playback quality or hardware decoder support.

### Packaging

Produce a self-contained disk image with checksums:

```sh
pnpm macos:package
```

Packaging configures its own Release build in `build/macos-release` and refuses any other build type; `pnpm macos:build` and the probes keep using the Debug build in `build/macos`. The app carries its own Qt, mpv, and torrent stack, so it runs on a Mac without Homebrew. Packages are ad-hoc signed and Apple Silicon only; code signing, notarization, and universal builds wait for a public release channel, as recorded in [ADR 0017](docs/adr/0017-ship-apple-silicon-first-and-defer-universal-packages.md).

Packaging writes Kino's GPL text, retained shell provenance, and dependency notices to `Kino.app/Contents/Resources/licenses/`. Open **Settings → Licenses and notices → Read notices** to search the local index. The accompanying `manifest.json` records component versions, source URLs, file checksums, and the origin of every shipped Mach-O binary.

The collector reads installed npm, Cargo, and Homebrew packages without network access. [Reviewed supplements](third_party/notices/README.md) supply omitted upstream texts, Qt and Chromium attributions, and complete Rust runtime notices. Packaging fails on missing texts, unknown binary origins, or changed dependency versions that need new supplements. `pnpm macos:package --no-dmg` runs the same collection, signing, and verification while skipping disk-image creation; native CI runs this path after its probes. Development builds need the packaging step before Read notices is available.

The TV APK carries the same kind of index at `assets/licenses/`, collected by `pnpm android:build` from the Core it compiles and a [reviewed record](docs/research/android-notices.md); the build fails when the APK holds a native library no notice covers. TV Settings reads it under **Licenses and notices → Read notices**.

### Releases

Pushing a tag named for the root `package.json` version, such as `v0.1.0-beta.1`, runs the Release workflow. It builds the macOS disk image and the TV APK from that commit, checks that both carry the tag's version, verifies the APK is signed with the release certificate pinned in `apps/android-tv/release-certificate.sha256`, and publishes both with a combined `SHA256SUMS`. A version with a pre-release label becomes a GitHub pre-release, which the desktop update check follows from preview builds. Running the workflow by hand builds the same artifacts without publishing them.

The TV release key lives only in the workflow's secrets. `scripts/setup-android-release-key.sh` sets it up once: it chooses or creates the keystore, uploads it with its passwords, and writes the certificate pin to commit. Every other build, locally and in CI, is signed with the machine's development key.

## Project documents

- [Product contract](docs/PRODUCT.md)
- [Playback contract](docs/PLAYBACK.md)
- [Delivery roadmap](docs/ROADMAP.md)
- [Validation gates](docs/RISKS.md)
- [Domain glossary](CONTEXT.md)
- [Architecture decisions](docs/adr)
- [Agent guide](AGENTS.md)
- [Cardboard board](https://cardboard.xode.cc/b/kino)

The original UI mockup and logo are preserved in [`mockup/`](mockup/).
