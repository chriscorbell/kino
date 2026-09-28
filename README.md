# Kino

Kino is a Stremio-compatible media client for macOS, Windows, Linux, and Android TV, with its own interface. It uses Stremio accounts, add-ons, libraries, and watch progress, and has no backend of its own.

The desktop app is a Qt shell around libmpv that hosts a React client. The TV app is Kotlin and Compose over Media3. Both run the same pinned Stremio Core.

## Install

Download a package from [Releases](https://github.com/chriscorbell/kino/releases) and check it against the release's `SHA256SUMS`. Pre-releases are not signed by Apple or Microsoft, so macOS and Windows warn before the first launch.

- **macOS 26 or newer, Apple Silicon.** Open `Kino-<version>-arm64.dmg` and drag Kino to Applications. macOS refuses the first launch. Open System Settings → Privacy & Security and choose Open Anyway.
- **Windows 10 or 11, x64.** Extract `Kino-<version>-windows-x64.zip` and run `Kino.exe` from the `Kino` folder. If SmartScreen stops it, choose More info → Run anyway.
- **Linux, x86_64.** Run `flatpak install --user Kino-<version>-x86_64.flatpak`. It also installs the KDE runtime from Flathub.
- **Android TV.** Install `Kino-TV-<version>.apk` with `adb install` or a sideloading app. If a development build is installed, uninstall it first, since it uses a different signing key. Uninstalling clears its sign-in and settings.

The desktop apps check for a new release once a day and link to its page. The TV app installs new releases from Settings → Check for updates.

## Development

You need Node.js 24 and pnpm 11.

```sh
pnpm install
pnpm dev
```

`pnpm dev` serves the React client for work in a browser, against the real Stremio Core. Playing a source needs a native shell.

```sh
pnpm check
```

`pnpm check` runs formatting, lint, type checks, unit tests, the Core and intro gates, and the production build. CI runs it on every pull request. Native checks, the streaming engine, and packaging details are in [the desktop guide](docs/DESKTOP.md).

### macOS

```sh
brew install cmake qt mpv pkgconf ffmpeg
pnpm macos:build
open build/macos/Kino.app
```

This is a Debug build for Apple Silicon on macOS 26 that links Homebrew's libraries. FFmpeg is only used to generate playback fixtures.

Torrent sources need the streaming engine. Without it, Kino runs and reports torrent sources as unavailable.

```sh
brew install rustup libtorrent-rasterbar boost
pnpm engine:build
pnpm macos:build
```

### Linux

On Ubuntu 26.04:

```sh
sudo apt install build-essential cmake ninja-build pkg-config libmpv-dev qt6-base-dev qt6-declarative-dev qt6-webengine-dev qt6-webchannel-dev qt6-wayland qml6-module-qtquick qml6-module-qtquick-controls qml6-module-qtquick-window qml6-module-qtwebchannel qml6-module-qtwebengine
pnpm install
cmake -S apps/macos-shell -B build/linux -G Ninja
cmake --build build/linux
build/linux/Kino
```

The shell needs Qt 6.8 and libmpv 2.4 or newer. Kino never decodes video in software, so it also needs the GPU's VA-API driver. Ubuntu installs AMD's driver but not Intel's, which is `intel-media-va-driver`.

To build the Flatpak, install `flatpak-builder` and build the interface first, because the Flatpak build has no network access for pnpm:

```sh
pnpm --filter @kino/desktop build
flatpak-builder --user --install build/flatpak packaging/flatpak/com.chriscorbell.Kino.yml
```

### Windows

Windows builds with MSVC against Qt 6.11 and libmpv. `.github/workflows/windows.yml` is the exact recipe.

### Android TV

```sh
pnpm android:build
pnpm android:run "$ANDROID_SERIAL"
pnpm android:check "$ANDROID_SERIAL"
```

`ANDROID_SERIAL` is the device's ADB serial or `IP:5555` address. The TV toolchain and device checks are in [the Android TV guide](docs/ANDROID-TV.md).

## Packaging and releases

```sh
pnpm macos:package
```

This builds a self-contained, ad-hoc signed disk image and its checksum in `build/dist`.

To publish a release, push a tag named for the version in the root `package.json`, such as `v0.1.0-rc.5`. The Release workflow builds the macOS disk image, the TV APK, the Windows zip, and the Flatpak from that commit and publishes them with a combined `SHA256SUMS`. A version with a pre-release label becomes a GitHub pre-release. Running the workflow by hand builds everything without publishing.

The TV release key lives only in the workflow's secrets. Run `scripts/setup-android-release-key.sh` once to create or choose the keystore, upload it, and write the certificate pin to commit. All other builds use the machine's development key.

## Documents

- [Product contract](docs/PRODUCT.md)
- [Playback contract](docs/PLAYBACK.md)
- [Desktop guide](docs/DESKTOP.md)
- [Android TV guide](docs/ANDROID-TV.md)
- [Delivery roadmap](docs/ROADMAP.md)
- [Validation gates](docs/RISKS.md)
- [Domain glossary](CONTEXT.md)
- [Architecture decisions](docs/adr)
- [Agent guide](AGENTS.md)
- [Cardboard board](https://cardboard.xode.cc/b/kino)

The original UI mockup and logo are in [`mockup/`](mockup/).

## License

GPL-3.0-only. See [LICENSE](LICENSE).
