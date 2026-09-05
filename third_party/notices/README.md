This directory retains reviewed upstream license and copyright texts needed by Kino's packaged dependencies. `reviewed.json` records their original filenames, source URLs, SHA256 hashes, package versions, and review notes. `texts/` stores the original bytes by content hash, sharing identical files across packages.

The package collector also copies notices from installed npm packages, the selected Cargo dependency graph, and the exact Homebrew kegs identified by each shipped binary's UUID. It includes Kino's root GPL text, the shell provenance record, and the streaming engine source pin. The resulting app contains a searchable HTML index, full texts, and a component inventory in `Contents/Resources/licenses/`.

Coverage includes the installed npm runtime closure, Core's pinned WASM normal/build graph, the native engine's selected normal dependency graph, and every shipped Mach-O binary. This is a package inventory; it does not infer which functions survive optimization. Qt module attributions and Rust runtime notices include optional and platform-specific components. Build tools that supply no runtime code are outside the inventory.

The reviews explain recovered notices and their limits:

- [Core WASM and retained shell](../../docs/research/core-notices.md)
- [Qt modules and Chromium](../../docs/research/qt-notices.md)
- [Streaming engine and embedded native libraries](../../docs/research/engine-notices.md)
- [Native Rust runtime](../../docs/research/native-rust-notices.md)
- [FFmpeg and compiled Boost headers](../../docs/research/homebrew-extra-notices.md)

GLib 2.88.3 and FreeType 2.14.3 supplements come from release archives whose SHA256s matched the installed Homebrew source metadata. FreeType's supplement includes its full FTL and GPLv2 texts and the original secondary notices referenced by `LICENSE.TXT`. Portions of this software are copyright © 2026 The FreeType Project (https://freetype.org). All rights reserved.

For a dependency update, collect the exact release's original notice files and their source URLs, verify their hashes, and update the affected manifest entries. Core and engine lock changes require reviewing the selected dependency graph as well. Native Rust needs the complete official `COPYRIGHT-library.html`; Homebrew's 1.98.0 copy omits third-party entries. Preserve separate package declarations, source notices, and standard license reference files as identified by their metadata. Do not substitute an invented copyright notice.

The native supplements also retain referenced source notices for libarchive, D-Bus, LZ4, HarfBuzz, Fontconfig, and Vulkan Loader. Libtorrent includes the original notices for its embedded WebTorrent dependencies. Shaderc includes glslang and SPIR-V licenses and source copyright statements. Their source pins, archive checksums, and original file paths are recorded in the inventory. Formula license declarations describe the formula and do not replace separate embedded-component terms.

Run `pnpm notices:check` to verify retained text hashes and dependency pins. Run a clean `pnpm macos:package` to verify the complete staged artifact. The package collector performs no downloads and rejects missing coverage before signing.
