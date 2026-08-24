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

The native bootstrap currently targets Apple Silicon on macOS 26 and links against local Homebrew libraries. Install CMake, Qt, libmpv, and pkg-config, then build the development app:

```sh
brew install cmake qt mpv pkgconf
pnpm macos:build
open build/macos/Kino.app
```

The shell loads the packaged Kino UI and hands playback to libmpv with VideoToolbox hardware decoding, forced SDR output, and optional stereo downmixing. It is a local validation build, not yet a signed or self-contained distribution. Run the short native launch regression probe with:

```sh
pnpm macos:check-launch
```

Run the complete local validation suite with:

```sh
pnpm check
```

## Project documents

- [Product contract](docs/PRODUCT.md)
- [Playback contract](docs/PLAYBACK.md)
- [Delivery roadmap](docs/ROADMAP.md)
- [Validation gates](docs/RISKS.md)
- [Domain glossary](CONTEXT.md)
- [Architecture decisions](docs/adr)

The original UI mockup and logo are preserved in [`mockup/`](mockup/).
