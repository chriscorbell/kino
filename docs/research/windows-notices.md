# Windows notices

The portable build carries its license index beside `Kino.exe` in `licenses/`: `manifest.json` lists every component with its version, declared license, source, and file checksums, `texts/` holds the full texts by SHA256, and `index.html` shows them with every text inline. Settings opens that page. `scripts/windows-notices.mjs` writes the index and reads it back. The reviewed native parts live in [the Windows record](../../third_party/notices/windows.json), with their texts in `third_party/notices/texts/` beside the other platforms'.

The index covers Kino itself, the npm runtime closure and Core, the engine's crate graph as Cargo selects it for `x86_64-pc-windows-msvc`, and the native code in the folder. The collection produces 496 components.

## Where the pieces are collected

The notices job runs on Linux, where the npm packages and the engine's crates are at hand, and the package job puts its output beside `Kino.exe` and verifies the finished folder:

- Every `.exe` and `.dll` matches a component's `binaries` glob, and every glob still matches a file.
- The engine embeds exactly the Rust compiler revision the record reviews. It is built with the release `apps/stream-engine/rust-toolchain.toml` pins, the macOS engine's.
- The packaged Core WASM matches its reviewed hash, and every text in the manifest appears in the page.

`pnpm notices:check` compares the record with the Qt release in `.github/workflows/windows.yml` and with the sources and libplacebo commit in `scripts/build-windows-mpv.sh`: every source the script downloads needs a reviewed component, and every reviewed source must still be downloaded. The libmpv job checks its cross-compiler against the reviewed MinGW-w64 and GCC releases, whose runtimes it links in.

## Reused reviews

A component can take its review from another record (`"reuse": "reviewed.json#qt/qtbase"`) when the same release ships on both platforms; the version must match. Windows reuses:

- Qt 6.11.2 (`qtbase`, `qtdeclarative`, `qtsvg`, `qtpositioning`, `qtwebchannel`, `qtwebengine`) from the macOS record. Those bundles are Qt's module-wide attribution pages, which list the third-party code each module bundles whether or not a build configures it in, so they cover Qt's own Windows binaries too.
- FreeType 2.14.3 and HarfBuzz 14.5.0 from the macOS record, the releases `libmpv-2.dll` builds.
- Rust 1.98.0 from the macOS record.
- mpv, libass, libplacebo, uchardet, libtorrent and Boost from the Linux record, the same releases built from the same sources.

FFmpeg keeps its own entry: its texts are the Linux ones, but the IJG acknowledgement names this build.

## What is in the folder

- Qt's Windows binaries, installed from the Qt 6.11.2 release.
- The Microsoft Visual C++ runtime, copied from the Visual Studio that built Kino. Microsoft's Distributable Code terms ask for no notice; a Kino-written entry records where the files come from.
- `libmpv-2.dll`, cross-compiled by `scripts/build-windows-mpv.sh` with mpv, FFmpeg, libass, libplacebo, uchardet, FreeType, HarfBuzz, FriBidi, dav1d, LCMS2, zlib and libiconv linked in, and the MinGW-w64 runtime and GCC's runtime libraries from the cross-compiler. `COPYING.MinGW-w64-runtime.txt` is the MinGW-w64 project's file for exactly this case.
- `kino-stream-engine.exe`, with its crates, libtorrent, Boost headers, and OpenSSL 3.6.4 from vcpkg, and the Rust standard library.

The package leaves out Qt's software OpenGL (`opengl32sw.dll`), a 2016 Mesa build whose LLVM release nothing records, and the Direct3D shader compilers, which an OpenGL scene graph never loads.

## Why libmpv is built rather than downloaded

The build this replaced came from SourceForge's mpv-player-windows project. It links about fifty libraries, among them x264, x265, SVT-AV1, libjxl, OpenMPT, libbluray and OpenSSL, built from moving git heads, and neither the archive nor its release notes record their revisions. Its notices could not be made exact. The cross-build carries only what Kino plays with, from pinned sources, and is a third of the size.

## Limits

- Per-file permissive headers follow the macOS review: root license files plus the IJG notices FFmpeg's `LICENSE.md` names.
- mpv's `sub/osd_font.otf` glyphs came, upstream says, from a freely licensed font such as Symbola; their original terms are not recorded.
- `BOOST-HEADER-NOTICES.txt` came from preprocessing the engine on macOS; Windows includes different platform headers, so the aggregate is approximate for this build.
