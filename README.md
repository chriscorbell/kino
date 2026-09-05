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

The client browses, searches, and resolves sources through the real Stremio Core. Library and Discover provide Load more controls. Failed later pages retain the visible titles and offer Retry. `pnpm core:check-pagination`, included in `pnpm check`, exercises the pinned WASM with 125 saved titles, duplicate catalog entries, delayed responses, failed-page retries and filter changes.

Every Core model is read through validating adapters, so screens receive navigation requests and playback fields rather than serializer payloads, as recorded in [ADR 0018](docs/adr/0018-read-stremio-core-through-a-validating-adapter.md). `pnpm core:check-contract` runs those adapters against the pinned WASM; `pnpm core:capture-fixtures` regenerates the committed fixtures they are unit-tested with.

Configurable add-ons open their provider's settings page in the system browser. Paste the resulting HTTPS manifest URL or Stremio install link into Add-ons. Kino asks whether to replace existing configurations or keep both, and verifies the new installation before removing an old configuration.

### macOS shell

The native bootstrap currently targets Apple Silicon on macOS 26 and links against local Homebrew libraries. Install CMake, Qt, libmpv, pkg-config, and FFmpeg (used only to generate playback fixtures), then build the development app:

```sh
brew install cmake qt mpv pkgconf ffmpeg
pnpm macos:build
open build/macos/Kino.app
```

The shell loads the packaged Kino UI, keeps Stremio authentication material in an owner-only file under Kino's application data, and hands playback to libmpv with VideoToolbox hardware decoding, forced SDR output, and optional stereo downmixing. Playback integrates with macOS media keys and Now Playing, blocks display sleep only while video plays, and exposes embedded and add-on subtitles with delay, size, and position controls. It is a local validation build, not yet a signed or self-contained distribution. Run the short native launch regression probe with:

```sh
pnpm macos:check-launch
```

Settings can copy a diagnostic summary with application, macOS, Qt, Core, player, and engine versions and playback capabilities. The summary excludes account data, media URLs, paths, and log contents. External engine overrides report an unknown version. The `diagnostic_summary` CTest suite uses an offscreen clipboard contained within the test process.

The player saves volume locally between launches. Its slider and Up/Down shortcuts adjust 0-100% volume; M toggles mute, and raising volume unmutes playback. Focused sliders keep their native keyboard step. Run `pnpm macos:check-volume` to verify the production WebChannel method and libmpv volume notifications, including bounds.

The fullscreen button and F toggle the current window state. Escape exits fullscreen after closing any open subtitle menu. The native bridge follows Qt window visibility, including changes through macOS window controls. Run `pnpm macos:check-fullscreen` to verify the actual WebChannel property and change notifications through repeated entry and exit.

Validate the playback contract against generated legal fixtures — codecs, HDR ranges, audio formats, subtitles, chapters, and failure paths — with:

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

Direct media uses the add-on's original HTTPS URL and required request headers in libmpv, independent of any Stremio Service URL saved in the account. TLS certificate verification is required. The native header check drives the production WebChannel and player through a protected media request, external subtitles, and a second source. It verifies literal header values, prevents headers from carrying into subtitles or later sources, rejects header injection and untrusted certificates, and checks diagnostic output for synthetic credentials. It uses `openssl` for the untrusted certificate and generates a short H.264 fixture with `ffmpeg`, or uses `KINO_PLAYBACK_FIXTURE` when provided.

### Streaming engine

Torrent sources play through a pinned build of the open [stream-server](https://github.com/stremio-native/stream-server) engine, which the shell starts on demand and binds to loopback. It is optional: without it Kino runs normally and reports torrent sources as unavailable. Build and bundle it with:

```sh
brew install rust libtorrent-rasterbar boost
pnpm engine:build
pnpm engine:check-profile
pnpm engine:check-trackers
pnpm macos:build
pnpm macos:check-engine
pnpm macos:check-engine-ui
```

Each engine build reconstructs `build/vendor/stream-server` from the pinned revision and current patches, then enforces Cargo's lockfile. Keep upstream changes in `apps/stream-engine/patches`; edits inside the generated vendor directory are discarded. `pnpm engine:check-vendor` checks patch changes and failed retries without requiring the native toolchain.

The shell gives the helper 30 seconds to become ready and terminates it if that deadline expires. An unexpected exit reports a playback failure. Selecting a torrent source again starts a fresh helper after failure. CTest exercises ready, silent, premature-exit, post-ready-exit, and retry cases with a temporary helper; `pnpm macos:check-engine-retry` verifies retry through production QML and WebChannel. These checks require no torrents. `KINO_ENGINE_STARTUP_TIMEOUT_MS` can shorten the deadline for fixtures.

Clear Cache asks the helper to shut down over stdin, waits for a successful exit, then deletes disposable files. A failed or timed-out shutdown leaves the cache intact and reports failure in Settings. Playback requested during deletion waits until clearing finishes. The next playback starts a fresh helper with a new session capability. Cache clearing is refused while the native player is active.

Engine settings live in Kino's application data directory under `streaming-engine`, separate from the media cache and rotating shell logs. Existing `settings.json` files and legacy diagnostics are preserved before the first new helper starts or cache clearing proceeds. Developer fixtures can set `KINO_CACHE_DIR`, `KINO_ENGINE_CACHE_DIR`, and `KINO_ENGINE_CONFIG_DIR` to isolated paths; the helper requires its configuration path explicitly. `pnpm macos:check-cache-clear` exercises real torrent playback, leaving playback, clearing, and replay in one shell process using synthetic media and temporary storage. It also checks that seeding and download-limit settings survive.

Kino excludes the upstream YouTube resolver and yt-dlp downloader from its engine. `pnpm engine:check-profile` starts the helper with a fresh cache and a blocking HTTP proxy, then checks that startup and an unsupported YouTube request create no executable tools or release-download requests. The engine's tracker-list data refreshes remain allowed.

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

The app carries its own Qt, mpv, and torrent stack, so it runs on a Mac without Homebrew. Packages are ad-hoc signed and Apple Silicon only; code signing, notarization, and universal builds wait for a public release channel, as recorded in [ADR 0017](docs/adr/0017-ship-apple-silicon-first-and-defer-universal-packages.md).

## Project documents

- [Product contract](docs/PRODUCT.md)
- [Playback contract](docs/PLAYBACK.md)
- [Delivery roadmap](docs/ROADMAP.md)
- [Validation gates](docs/RISKS.md)
- [Domain glossary](CONTEXT.md)
- [Architecture decisions](docs/adr)

The original UI mockup and logo are preserved in [`mockup/`](mockup/).
