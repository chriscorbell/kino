# Linux Flatpak notices

The Flatpak carries its license index at `/app/share/kino/licenses/`: `manifest.json` lists every component with its version, declared license, source, and file checksums, `texts/` holds the full texts by SHA256, and `index.html` shows them. `scripts/linux-notices.mjs` writes it and reads it back. The reviewed native parts live in [the Linux record](../../third_party/notices/linux.json), with their texts in `third_party/notices/texts/` beside the macOS and Android ones.

The index covers Kino itself, the npm runtime closure and Core, the engine's crate graph as Cargo selects it for `x86_64-unknown-linux-gnu`, and the native code in `/app`. The collection produces 486 components.

## Where the pieces are collected

The Flatpak build sandbox has no network, no `node_modules`, and no crate sources, so the workflow's first job collects the notices on the runner and hands them to `flatpak-builder` as a source directory. The `kino` module copies them into `/app`.

After the build, the workflow installs the bundle and verifies what it installed:

- Every ELF file in `/app` matches a component's `binaries` glob, and every glob still matches a file, so a library added or dropped by the manifest or the base app fails the job until the record changes with it.
- The engine embeds exactly the Rust compiler revision the record reviews. The engine is built with the `rust-stable` SDK extension, which Flathub moves on its own schedule, unlike the macOS engine's pinned toolchain.
- The base app's Qt WebEngine is the release the record reviews.
- The packaged Core WASM matches its reviewed hash, and every text in the manifest appears in the page.

`pnpm notices:check` compares the record with the manifest: every module needs a component or a `buildOnly` reason, and each component's commit or archive and checksum must match the module's source.

## One page with every text

When a Flatpak app opens a local file, Qt passes it to the desktop's OpenURI portal, which gives the browser that single file. Links from `index.html` to the texts beside it would not resolve, so the Linux page carries each distinct text inline and links to it by anchor. The page is about 6.5 MB. The macOS page keeps its links, since a browser there reads the bundle directly.

## What is in `/app`

The KDE runtime (`org.kde.Platform//6.11`) holds Qt itself and the libraries FFmpeg, mpv, libass, and libplacebo link against. It is a separate Flatpak with its own notices, and the record leaves it out.

From Kino's manifest: uchardet, libass, FFmpeg, libplacebo, libXpresent, libdisplay-info, and libmpv as shared libraries, and libtorrent, Boost headers, and the Rust standard library inside the engine. hwdata is build-time only, but libdisplay-info compiles its `pnp.ids` into a lookup table, so its notice stays with that library.

From `io.qt.qtwebengine.BaseApp//6.11`: Qt WebEngine and Qt PDF, and the krb5, libevent, minizip, pciutils, re2, and snappy libraries it builds for Chromium. The BaseApp builds Qt WebEngine at the same revision the macOS record reviews, so its NOTICES bundle is reused as is, including a preamble written for the macOS package.

The manifest removes three things the base app adds and Kino never uses: the spell-check dictionaries, converted from the SDK's Hunspell set under many licenses, Qt WebView, and Qt WebEngine's WebDriver.

## Decisions and limits

- Per-file permissive headers follow the macOS review: the record keeps each project's root license files plus the IJG notices FFmpeg's `LICENSE.md` names, and does not list every file whose header carries MIT, BSD, ISC, or zlib terms.
- mpv embeds `sub/osd_font.otf`. Upstream says only that its glyphs came from a freely licensed font such as Symbola, so their original terms are not recorded.
- `BOOST-HEADER-NOTICES.txt` came from preprocessing the engine on macOS. Linux includes different platform headers (epoll rather than kqueue), so the aggregate is approximate for this build.
- The base app's manifest pins its own sources; the record pins the base app revision it reviewed and checks the Qt WebEngine release, not each of its libraries' versions.
