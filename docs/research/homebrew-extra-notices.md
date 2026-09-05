# FFmpeg and Boost notice supplements

The [supplement index](../../build/license-research/homebrew-extra/index.json) contains 11 SHA256-verified notice files for installed FFmpeg 9.0.1_1 and Boost 1.92.0. Version, source archive, checksum, installed formula hash, and installed SBOM hash are recorded in [the provenance artifact](../../build/license-research/homebrew-extra/provenance.json). The archives match the source records in the installed Homebrew SBOMs.

## FFmpeg

Homebrew FFmpeg 9.0.1_1 uses the upstream 9.0.1 release archive, SHA256 `cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635`. The installed formula enables both `--enable-gpl` and `--enable-version3`; it applies no source patches. The five root license files recovered from the archive match the installed files byte for byte. [Exact source archive](https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz).

The root `LICENSE.md` identifies three libjpeg-derived files whose separate notices and executable-distribution credit must be retained: `libavcodec/jfdctfst.c`, `libavcodec/jfdctint_template.c`, and `libavcodec/jrevdct.c`. The supplement copies each complete initial comment block without editing, including its Thomas G. Lane copyright, license, and implementation comments. `IJG-ACKNOWLEDGEMENT.txt` supplies the stated credit and records that Kino has not changed those FFmpeg source files. [Root license](https://github.com/FFmpeg/FFmpeg/blob/n9.0.1/LICENSE.md), [jfdctfst.c](https://github.com/FFmpeg/FFmpeg/blob/n9.0.1/libavcodec/jfdctfst.c), [jfdctint_template.c](https://github.com/FFmpeg/FFmpeg/blob/n9.0.1/libavcodec/jfdctint_template.c), [jrevdct.c](https://github.com/FFmpeg/FFmpeg/blob/n9.0.1/libavcodec/jrevdct.c).

The root's remaining specifically named non-GPL/LGPL item, `tests/reference.pnm`, is a test image and is not shipped in Kino. It is excluded from the runtime supplement. The GPL and LGPL alternatives named by the root are all retained. The inventory does not infer additional copyright holders from the image's creator-tool metadata.

The installed formula explicitly enables libsvtav1, libopus, libx264, libmp3lame, libdav1d, libvmaf, libvpx, libx265, and OpenSSL. Inspection of the installed `libavcodec.dylib` and `libavfilter.dylib` load commands found dynamic links to all of them. Their independent notices therefore belong to the Homebrew dynamic-library inventory. No additional static-only external library was identified by this formula and load-command comparison.

## Boost

The installed Boost formula and SBOM identify 1.92.0 and the release archive checksum `ea7b982002cc9dfbe59b0b217b206f470dc75f3de0bb2973d844118934d82411`. The installed package has no root license filename. The supplement recovers the complete `LICENSE_1_0.txt` from that exact verified archive. [Exact Boost source archive](https://github.com/boostorg/boost/releases/download/boost-1.92.0/boost-1.92.0-b2-nodocs.tar.xz), [upstream BSL text](https://github.com/boostorg/boost/blob/boost-1.92.0/LICENSE_1_0.txt).

Boost header code enters the native engine through its libtorrent C++ wrappers. This inclusion is independent of whether a Boost dynamic library appears in the final load commands. Kino's build script adds Homebrew's include directory, and `memory_storage.cpp` directly includes `boost/asio/post.hpp`. [Engine build script](../../scripts/build-engine.sh), [reviewed upstream source archive](https://github.com/boostorg/boost/releases/download/boost-1.92.0/boost-1.92.0-b2-nodocs.tar.xz).

Preprocessing `wrapper.cpp`, `memory_storage.cpp`, and generated `lib.rs.cc` with the current libtorrent pkg-config definitions and C++17 identified 1,387 Boost headers. Every installed header matched its release archive source bytes. This is conservative include coverage, not a claim that every included function survives compilation. The exact commands and source hashes are retained in `boost-dependency-commands.json` and `boost-header-source-index.json` under the research artifact directory.

`BOOST-HEADER-NOTICES.txt` retains 783 distinct copyright and license comment blocks from those headers. It groups identical blocks by original archive path and leaves their contents unchanged. Two namespace-only headers, `boost/move/detail/std_ns_begin.hpp` and `boost/move/detail/std_ns_end.hpp`, have no separate notice. The full root BSL text remains included for the distribution. No collective copyright holder was invented.
