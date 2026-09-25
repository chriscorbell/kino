# Android TV notices

The TV APK carries its own license index at `assets/licenses/`: `manifest.json` lists every component with its version, declared license, source URL, and file checksums, and `texts/` holds the full texts by SHA256. `scripts/android-notices.mjs` writes it during `pnpm android:build` and reads it back out of the finished APK. The reviewed parts live in [the Android record](../../third_party/notices/android.json), with their texts in `third_party/notices/texts/` beside the macOS ones.

The index covers four things: Kino itself, the release runtime classpath, the Stremio Core crate graph with its build dependencies, and the three native libraries in the APK. The first build produced 464 components.

## What the APK contains

`lib/arm64-v8a` holds three libraries, and the APK check fails on any library no component claims:

| Library                        | Components that claim it                                                  |
| ------------------------------ | ------------------------------------------------------------------------- |
| `libstremio_core_kotlin.so`    | `stremio-core-kotlin` and the Rust standard library, over the crate graph |
| `libffmpegJNI.so`              | FFmpeg n6.0.1 and the Media3 FFmpeg decoder extension                     |
| `libandroidx.graphics.path.so` | `androidx.graphics:graphics-path` 1.0.1                                   |

The dex code comes from Kino, the Maven artifacts, the Media3 FFmpeg extension's Java classes, and the Kotlin bindings from the stremio-core-kotlin 1.15.0 release. Resources include the Geist fonts, the Lucide icons, and two Media3 UI resources that keep their Apache headers.

## Maven artifacts

`gradle.lockfile` lists 182 coordinates on `releaseRuntimeClasspath`, and the record accounts for each one. `pnpm notices:check` compares the two and names any coordinate added or dropped, so a dependency bump fails the web job until someone reviews it.

Each artifact's POM, or for Guava its parent POM, declares its license. All but four are Apache-2.0 alone. None of the jars or AARs carries a NOTICE file, so the Apache text is the whole obligation. Some AndroidX artifacts carry the Apache terms inside `META-INF`, without the appendix, and those copies stay in the APK.

The four others:

| Artifact                                          | Terms and retained texts                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `com.squareup.okhttp3:okhttp` 4.12.0              | Apache-2.0. Its compiled Public Suffix List ships as `publicsuffixes.gz` under MPL-2.0, with the jar's own NOTICE beside it in the APK. The NOTICE and the MPL-2.0 text are retained.                                     |
| `org.checkerframework:checker-qual` 3.43.0        | MIT. The jar's `META-INF/LICENSE.txt` is retained.                                                                                                                                                                        |
| `pro.streem.pbandk:pbandk-runtime-android` 0.16.0 | MIT. The LICENSE at the v0.16.0 tag is retained.                                                                                                                                                                          |
| `pro.streem.pbandk:pbandk-protos` 0.16.0          | MIT, plus the Protocol Buffers Well-Known Type `.proto` files, which pbandk repackages from protobuf-java 4.28.0. They ship in the APK with their headers, which refer to the Protocol Buffers LICENSE retained at v28.0. |

## Stremio Core

The collector selects the graph the way the Core WASM review does, from the Core Kino just compiled:

```sh
cargo tree --offline --locked --target aarch64-linux-android \
  -p stremio-core-kotlin -e normal,build --prefix none --format '{p}' \
  --manifest-path build/vendor/stremio-core-kotlin/Cargo.toml
```

That gives 276 crates. Build dependencies count because `openssl-src` compiles OpenSSL 3.4.0 into the library; its Apache-2.0 LICENSE and AUTHORS come from inside the crate. Notice files come from each crate's own directory, so nested ones such as ring's are kept.

Nine crates publish no notice file. The record supplies each from the source the crate points at:

| Crate                                              | Recovered notice                                                                                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Inflector` 0.11.4                                 | BSD-2-Clause `LICENSE.md` from the commit in the crate's `.cargo_vcs_info.json`.                                                                                                                                |
| `fxhash` 0.2.1                                     | The source header and Apache text the Core WASM review already recovered for the same version.                                                                                                                  |
| `http-cache` 0.20.0, `http-cache-reqwest` 0.15.0   | `LICENSE-MIT` and `LICENSE-APACHE` from the workspace root at the recorded commit.                                                                                                                              |
| `http-serde` 2.1.1                                 | Nothing to recover: neither the crate nor the repository at the recorded commit has a license file or a copyright notice. Cargo.toml permits Apache-2.0 or MIT, so the Apache text is supplied for that choice. |
| `prost-reflect` 0.14.6                             | `LICENSE-MIT` and `LICENSE-APACHE` from the workspace root at the recorded commit.                                                                                                                              |
| `stremio-derive`, `stremio-watched-bitfield` 0.1.0 | The stremio-core root `LICENSE.md` at the locked revision `9a827fd`.                                                                                                                                            |
| `stremio-official-addons` 2.1.1                    | The root `LICENSE.md` at the v2.1.1 tag.                                                                                                                                                                        |

The collector fails when a selected crate has no text or when a supplement no longer matches any crate, and `pnpm notices:check` fails when `apps/android-tv/core/Cargo.lock` changes, so a Core update always comes back here.

## Rust standard library

`libstremio_core_kotlin.so` embeds panic locations under `/rustc/01f6ddf7588f42ae2d7eb0a2f21d44e8e96674cf`, the revision of Rust 1.93.1. The record retains that release's `LICENSE-MIT`, `LICENSE-APACHE`, `COPYRIGHT`, and full `COPYRIGHT-library.html` from the official `rustc-1.93.1-aarch64-apple-darwin.tar.xz`, whose SHA256 `d103a0ee…25fd` matched the published checksum. The rustup toolchain installs the same HTML byte for byte. A text extraction sits beside it for the TV screen, made the way the macOS review made its own, along with the Unicode-3.0 and BSD-2-Clause texts from the same archive.

## FFmpeg and the Media3 extension

`libffmpegJNI.so` links static libavcodec, libavutil, and libswresample, built from the n6.0.1 tag with only the AC-3, E-AC-3, DTS, TrueHD, and MLP decoders and no GPL or non-free parts. That makes it LGPL-2.1-or-later. The record keeps FFmpeg's `LICENSE.md` and `COPYING.LGPLv2.1` from the tag. Because the libraries are linked statically, the LGPL's relinking terms apply. Kino's own source, including the build script that produces this library, is public under the GPL, which meets them.

`LICENSE.md` says a few files are under other terms. Every object in the three archives was checked against its source header, and six are not LGPL: `adler32.c` (zlib), `avsscanf.c` (MIT, from musl), `faandct.c` (ISC style), and `jfdctfst.c`, `jfdctint_template.c`, and `jrevdct.c` (Independent JPEG Group). Those license comments are retained unedited, whether or not the linker kept each object. The IJG terms require that documentation for executables say the software "is based in part on the work of the Independent JPEG Group". The FFmpeg entry in the index says it.

Media3 publishes the FFmpeg extension only as source. Its JNI code is compiled into the same library and its Java classes into the app, under the Apache LICENSE at the 1.9.3 tag. The repository has no NOTICE file.

## Updating

- A Maven change: read the new POM's license, look inside the artifact for NOTICE or license files, add the coordinate to the right group in `android.json`, then update `gradleLockfileSha256`.
- A Core change: build the TV app, add supplements for any crate the collector reports without a notice, then update `coreLockSha256` and, for a new revision, `coreRevision`.
- A Rust, FFmpeg, or Media3 change: `pnpm notices:check` names the entry whose version no longer matches `scripts/build-android.py`. Retain the new release's texts and, for FFmpeg, check the headers of the archive objects again.
