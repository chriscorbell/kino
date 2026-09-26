# Bundle only the Qt Kino loads

## Status

Accepted

## Context

The Mac package was assembled by Qt's `macdeployqt`, then patched for what it missed. Given the shell's `import QtQuick`, it copies Qt's whole `QtQuick` directory: Qt 3D scenes, the virtual keyboard and its spell checker, PDF, Timeline, particles and vector images, none of which Kino imports. It also deploys every plugin of each kind Qt ships, so the input method directory brought the virtual keyboard's frameworks, and multimedia, positioning and SQL drivers came with it. The app carried about 75 Qt frameworks; a session loads 24.

It was also slow. `macdeployqt` and the patching after it ran `otool`, `install_name_tool` and `codesign` once per file, and `file` once per file per pass, one process at a time. Packaging the v0.1.0-rc.1 release took twelve minutes on GitHub's macOS runner, nine of them in `macdeployqt`.

Neither was checked. CI packaged the app but never started it, and on a Mac with Homebrew a library the bundle lacked would load from Homebrew anyway.

## Decision

`scripts/package-macos.mjs` bundles Qt itself:

- The QML modules `qmlimportscanner` finds in the shell's QML, each without the modules nested in it, which the scanner names on their own when Kino needs them. That keeps every Qt Quick Controls style, since the default style is chosen at run time.
- The Cocoa platform plugin and the TLS backends, the only plugins a session loads.
- The libraries those link, found by reading load commands in `scripts/macho.mjs` rather than with a process per file. Every binary gets one search path, relative to itself, to the bundle's `Frameworks`, and no other.

The tools that must still run, `strip`, `install_name_tool` and `codesign`, run in parallel.

`pnpm macos:check-package` gates the result. It fails if a load command or search path leaves the bundle, if a bundled library is loaded by nothing, or if a QML module's plugin is missing. It then runs the packaged app, a clip and the streaming engine with dyld's library log and fails on any file loaded from outside the bundle and the system. CI runs it on every native change, and the Release workflow runs it before publishing.

## Consequences

Packaging takes seconds rather than minutes, and the app shrank from 456 to 402 MB, the disk image from 191 to 173 MB. The packaged app passed the playback matrix, pixel gates included, and the interface probes.

Anything opened at run time rather than linked, such as a plugin Qt loads only for a feature the check does not reach, is invisible to the scan. The run under dyld's log catches what a session reaches; anything else joins the plugin list in `package-macos.mjs` once found.
