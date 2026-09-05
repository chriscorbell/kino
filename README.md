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

The client browses, searches, and resolves sources through the real Stremio Core. Torrent playback currently requires a separately installed Stremio Service.

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

Validate the playback contract against generated legal fixtures — codecs, HDR ranges, audio formats, subtitles, chapters, and failure paths — with:

```sh
pnpm macos:check-playback
```

Run the native property-event regression tests after building with:

```sh
ctest --test-dir build/macos --output-on-failure
```

### Streaming engine

Torrent sources play through a pinned build of the open [stream-server](https://github.com/stremio-native/stream-server) engine, which the shell starts on demand and binds to loopback. It is optional: without it Kino runs normally and reports torrent sources as unavailable. Build and bundle it with:

```sh
brew install rust libtorrent-rasterbar boost
pnpm engine:build
pnpm engine:check-profile
pnpm macos:build
pnpm macos:check-engine
```

Each engine build reconstructs `build/vendor/stream-server` from the pinned revision and current patches, then enforces Cargo's lockfile. Keep upstream changes in `apps/stream-engine/patches`; edits inside the generated vendor directory are discarded. `pnpm engine:check-vendor` checks patch changes and failed retries without requiring the native toolchain.

Kino excludes the upstream YouTube resolver and yt-dlp downloader from its engine. `pnpm engine:check-profile` starts the helper with a fresh cache and a blocking HTTP proxy, then checks that startup and an unsupported YouTube request create no executable tools or release-download requests. The engine's tracker-list data refreshes remain allowed.

Run the complete local validation suite with:

```sh
pnpm check
```

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
