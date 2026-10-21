# Signing the main executable signs the whole bundle

Read when: changing how `scripts/package-macos.mjs` signs the app, or macOS packaging fails with "cannot find code object on disk" on a `.cstemp` file.
Status: verified
Scope: macOS packaging
Verified: 2026-10-21
Source: #274 (commit df9ec03); `signEverything` in `scripts/package-macos.mjs`
Recheck when: `signEverything` in `scripts/package-macos.mjs` changes.

Packaging signs the bundle's Mach-O files from the inside out, loose files and each depth of nested bundles in parallel batches of 16, then the bundle itself last. `codesign` on `Contents/MacOS/Kino` signs the whole bundle, so when it ran in a batch it read a plugin while another `codesign` was rewriting it, and the v0.1.0-rc.2 release build failed with "cannot find code object on disk" on `libqtquickcontrols2macosstyleimplplugin.dylib.cstemp`. #272's own CI run had happened to miss the race. #274 keeps the main executable out of the parallel batches and leaves it to the bundle's own signature. Never sign `Contents/MacOS/Kino` on its own, and never sign anything while another `codesign` may still be writing inside the bundle. Checked on 2026-10-21 against the commit and the current `signEverything`.
