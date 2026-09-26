#!/usr/bin/env bash
# Cross-compiles libmpv for 64-bit Windows from pinned sources, on Linux with
# mingw-w64, as one DLL with every dependency linked in. It carries what Kino
# plays with and nothing else: FFmpeg's decoders and demuxers with dav1d,
# D3D11VA, and Schannel for HTTPS; libass with DirectWrite; libplacebo for
# OpenGL; LCMS2, uchardet, and iconv for colour and subtitle text. The
# pins match the Flatpak where the two share a library, so one set of notices
# describes both.
#
#   scripts/build-windows-mpv.sh [output directory]
#
# The output holds libmpv-2.dll, its MinGW import library, and the headers.
set -euo pipefail

kino_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kino_work="${kino_repo_root}/build/windows-mpv"
kino_out="${1:-${kino_work}/dist}"
kino_host=x86_64-w64-mingw32
kino_prefix="${kino_work}/prefix"
kino_sources="${kino_work}/sources"
kino_jobs="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN)"

# name|urls|sha256, with mirrors after the first URL. The archive's top
# directory becomes the name's build directory.
kino_archives=(
  "zlib|https://github.com/madler/zlib/releases/download/v1.3.2/zlib-1.3.2.tar.xz https://zlib.net/zlib-1.3.2.tar.xz|d7a0654783a4da529d1bb793b7ad9c3318020af77667bcae35f95d0e42a792f3"
  "libiconv|https://ftpmirror.gnu.org/gnu/libiconv/libiconv-1.18.tar.gz https://mirrors.kernel.org/gnu/libiconv/libiconv-1.18.tar.gz|3b08f5f4f9b4eb82f151a7040bfd6fe6c6fb922efe4b1659c66ea933276965e8"
  "freetype|https://download-mirror.savannah.gnu.org/releases/freetype/freetype-2.14.3.tar.xz https://sourceforge.net/projects/freetype/files/freetype2/2.14.3/freetype-2.14.3.tar.xz/download|36bc4f1cc413335368ee656c42afca65c5a3987e8768cc28cf11ba775e785a5f"
  "fribidi|https://github.com/fribidi/fribidi/releases/download/v1.0.17/fribidi-1.0.17.tar.xz|6949dcde27d41cebad1fd741fcafc36d55a1020d2d872d4a6eb3914caabbada2"
  "harfbuzz|https://github.com/harfbuzz/harfbuzz/releases/download/14.5.0/harfbuzz-14.5.0.tar.xz|b7132e148358a45185c9feafd049dbaf243649d3c44414b3534d9c95d18592b9"
  "libass|https://github.com/libass/libass/releases/download/0.17.5/libass-0.17.5.tar.xz|2dca25c0e0c837ddf00b52011b3f82cac1e4ddd3ad018227806b0c2288864acc"
  "dav1d|https://downloads.videolan.org/pub/videolan/dav1d/1.5.4/dav1d-1.5.4.tar.xz|686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5"
  "lcms2|https://github.com/mm2/Little-CMS/releases/download/lcms2.19.1/lcms2-2.19.1.tar.gz|bfc54f7bab59fbc921012014a8032e4cba4abd46db47d46b76416a8c0b2815c8"
  "uchardet|https://www.freedesktop.org/software/uchardet/releases/uchardet-0.0.8.tar.xz|e97a60cfc00a1c147a674b097bb1422abd9fa78a2d9ce3f3fdcc2e78a34ac5f0"
  "ffmpeg|https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz|cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635"
  "mpv|https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz|ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209"
)
# libplacebo's release archive leaves out the submodules its OpenGL loader
# and number parsing come from, so it is cloned at the tag's commit.
kino_libplacebo_url=https://github.com/haasn/libplacebo.git
kino_libplacebo_commit=cee9b076f2c63104ccfd497fa79c39a867293ec4

kino_sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

kino_fetch() {
  local name="$1" urls="$2" sha="$3" archive url
  archive="${kino_sources}/${name}-${sha:0:12}.archive"
  for url in ${urls}; do
    [[ -f "${archive}" && "$(kino_sha256 "${archive}")" == "${sha}" ]] && break
    curl -fsSL --retry 3 -o "${archive}" "${url}" || echo "Could not fetch ${url}" >&2
  done
  if [[ ! -f "${archive}" || "$(kino_sha256 "${archive}")" != "${sha}" ]]; then
    echo "No source for ${name} matched its checksum" >&2
    exit 1
  fi
  rm -rf "${kino_work}/build/${name}"
  mkdir -p "${kino_work}/build/${name}"
  tar -xf "${archive}" -C "${kino_work}/build/${name}" --strip-components=1
}

rm -rf "${kino_prefix}" "${kino_work}/build"
mkdir -p "${kino_sources}" "${kino_prefix}" "${kino_work}/build"
for entry in "${kino_archives[@]}"; do
  IFS='|' read -r name url sha <<<"${entry}"
  kino_fetch "${name}" "${url}" "${sha}"
done
git clone --quiet --filter=blob:none "${kino_libplacebo_url}" "${kino_work}/build/libplacebo"
git -C "${kino_work}/build/libplacebo" checkout --quiet "${kino_libplacebo_commit}"
git -C "${kino_work}/build/libplacebo" submodule update --quiet --init --recursive --depth 1

export PKG_CONFIG_LIBDIR="${kino_prefix}/lib/pkgconfig"
export PKG_CONFIG_PATH=""
export PATH="${kino_prefix}/bin:${PATH}"
# Every library here is static, so pkg-config always answers with what a
# static link needs. meson then finds libraries without a .pc file, such as
# libiconv, by linking against them.
kino_pkg_config="${kino_work}/pkg-config"
printf '#!/bin/sh\nexec pkg-config --static "$@"\n' >"${kino_pkg_config}"
chmod +x "${kino_pkg_config}"
kino_cross="${kino_work}/cross.ini"
cat >"${kino_cross}" <<EOF
[binaries]
c = '${kino_host}-gcc'
cpp = '${kino_host}-g++'
ar = '${kino_host}-ar'
strip = '${kino_host}-strip'
windres = '${kino_host}-windres'
dlltool = '${kino_host}-dlltool'
nasm = 'nasm'
pkg-config = '${kino_pkg_config}'

[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'

[built-in options]
prefix = '${kino_prefix}'
libdir = 'lib'
buildtype = 'release'
default_library = 'static'
c_args = ['-I${kino_prefix}/include']
cpp_args = ['-I${kino_prefix}/include']
c_link_args = ['-L${kino_prefix}/lib']
cpp_link_args = ['-L${kino_prefix}/lib']
EOF

kino_meson() {
  local name="$1"
  shift
  meson setup --cross-file "${kino_cross}" --wrap-mode=nodownload \
    "${kino_work}/build/${name}/out" "${kino_work}/build/${name}" "$@"
  meson install -C "${kino_work}/build/${name}/out" --quiet
}

kino_autotools() {
  local name="$1"
  shift
  (cd "${kino_work}/build/${name}" &&
    ./configure --host="${kino_host}" --prefix="${kino_prefix}" --enable-static --disable-shared "$@" &&
    make -j"${kino_jobs}" && make install)
}

kino_cmake() {
  local name="$1"
  shift
  cmake -S "${kino_work}/build/${name}" -B "${kino_work}/build/${name}/out" -G Ninja \
    -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_C_COMPILER="${kino_host}-gcc" \
    -DCMAKE_CXX_COMPILER="${kino_host}-g++" -DCMAKE_RC_COMPILER="${kino_host}-windres" \
    -DCMAKE_FIND_ROOT_PATH="${kino_prefix}" -DCMAKE_INSTALL_PREFIX="${kino_prefix}" \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_POLICY_VERSION_MINIMUM=3.5 "$@"
  cmake --build "${kino_work}/build/${name}/out" --parallel "${kino_jobs}"
  cmake --install "${kino_work}/build/${name}/out"
}

kino_cmake zlib -DZLIB_BUILD_TESTING=OFF -DZLIB_BUILD_SHARED=OFF
# zlib names its static Windows library libzs, while its zlib.pc says -lz.
cp "${kino_prefix}/lib/libzs.a" "${kino_prefix}/lib/libz.a"
kino_autotools libiconv --disable-nls
kino_meson freetype -Dzlib=system -Dpng=disabled -Dbzip2=disabled -Dbrotli=disabled \
  -Dharfbuzz=disabled -Dtests=disabled
kino_meson fribidi -Ddocs=false -Dbin=false -Dtests=false
kino_meson harfbuzz -Dfreetype=enabled -Dglib=disabled -Dgobject=disabled -Dcairo=disabled \
  -Dicu=disabled -Dtests=disabled -Ddocs=disabled -Dutilities=disabled
kino_meson libass -Dfontconfig=disabled -Ddirectwrite=enabled -Dasm=enabled -Dlibunibreak=disabled \
  -Dtest=disabled -Dcompare=disabled -Dprofile=disabled -Dfuzz=disabled -Dcheckasm=disabled
kino_meson dav1d -Denable_tools=false -Denable_tests=false
kino_meson lcms2 -Dutils=false -Dtests=disabled -Djpeg=disabled -Dtiff=disabled
kino_cmake uchardet -DBUILD_BINARY=OFF -DBUILD_STATIC=ON
kino_meson libplacebo -Dvulkan=disabled -Dopengl=enabled -Dd3d11=disabled -Dlcms=enabled \
  -Ddemos=false -Dtests=false -Dshaderc=disabled -Dglslang=disabled -Dxxhash=disabled \
  -Dlibdovi=disabled -Dunwind=disabled

# libplacebo's .pc asks for -lstdc++, which would find the C++ runtime's DLL
# import library before -static-libstdc++ applies; name the archive itself.
sed -i 's/-lstdc++/-l:libstdc++.a/g' "${kino_prefix}"/lib/pkgconfig/*.pc

# Decoders and demuxers only, as the Flatpak builds it: FFmpeg's own codecs
# cover H.264, HEVC, VP9 and the audio formats, dav1d covers AV1, D3D11VA
# and DXVA2 the hardware path, and Schannel HTTPS.
(cd "${kino_work}/build/ffmpeg" &&
  ./configure --prefix="${kino_prefix}" --cross-prefix="${kino_host}-" --arch=x86_64 \
    --target-os=mingw32 --enable-cross-compile --pkg-config=pkg-config --pkg-config-flags=--static \
    --extra-cflags="-I${kino_prefix}/include" --extra-ldflags="-L${kino_prefix}/lib" \
    --enable-static --disable-shared --disable-debug --disable-doc --disable-programs \
    --enable-gpl --enable-version3 --disable-autodetect --enable-w32threads --enable-schannel \
    --enable-d3d11va --enable-dxva2 --enable-zlib --enable-iconv --enable-libdav1d &&
  make -j"${kino_jobs}" && make install)

# The DLL links the C and C++ runtimes and winpthreads statically, so it
# needs nothing beside it but Windows itself.
kino_meson mpv -Ddefault_library=shared -Dlibmpv=true -Dcplayer=false -Dbuild-date=false \
  -Dgpl=true -Dlua=disabled -Djavascript=disabled -Dlibarchive=disabled -Dlibbluray=disabled \
  -Ddvdnav=disabled -Dcdda=disabled -Drubberband=disabled -Dvapoursynth=disabled -Dzimg=disabled \
  -Djpeg=disabled -Dlibavdevice=disabled -Dvulkan=disabled -Dshaderc=disabled -Dspirv-cross=disabled \
  -Dd3d11=disabled -Degl-angle=disabled -Degl-angle-lib=disabled -Degl-angle-win32=disabled \
  -Dwin32-smtc=disabled -Dmanpage-build=disabled -Dhtml-build=disabled -Dpdf-build=disabled \
  -Dgl-win32=enabled -Dgl-dxinterop=enabled -Dd3d-hwaccel=enabled -Dd3d9-hwaccel=enabled \
  -Dgl-dxinterop-d3d9=enabled -Dwasapi=enabled -Diconv=enabled -Dzlib=enabled -Dlcms2=enabled \
  -Duchardet=enabled \
  -Dc_link_args="['-L${kino_prefix}/lib', '-static', '-static-libgcc', '-static-libstdc++']" \
  -Dcpp_link_args="['-L${kino_prefix}/lib', '-static', '-static-libgcc', '-static-libstdc++']"

rm -rf "${kino_out}"
mkdir -p "${kino_out}/include"
cp "${kino_prefix}/bin/libmpv-2.dll" "${kino_out}/"
"${kino_host}-strip" --strip-unneeded "${kino_out}/libmpv-2.dll"
cp "${kino_prefix}/lib/libmpv.dll.a" "${kino_out}/"
cp -r "${kino_prefix}/include/mpv" "${kino_out}/include/"

# Nothing but Windows system DLLs may be left to find at run time.
kino_imports="$("${kino_host}-objdump" -p "${kino_out}/libmpv-2.dll" | sed -n 's/^\s*DLL Name: //p' | sort -u)"
echo "libmpv-2.dll imports:"
echo "${kino_imports}"
if grep -Eiv '^(api-ms-win-.*|advapi32|avrt|bcrypt|comdlg32|crypt32|d3d11|d3d9|dwmapi|dwrite|dxgi|dxva2|gdi32|imm32|kernel32|mf|mfplat|msvcrt|ncrypt|ntdll|ole32|oleaut32|opengl32|powrprof|secur32|setupapi|shcore|shell32|shlwapi|user32|userenv|uuid|uxtheme|version|winmm|winspool|ws2_32)\.dll$' <<<"${kino_imports}"; then
  echo "libmpv-2.dll depends on a DLL outside Windows." >&2
  exit 1
fi
echo "Built ${kino_out}/libmpv-2.dll"
