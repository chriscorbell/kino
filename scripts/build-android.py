#!/usr/bin/env python3
"""Build Kino TV and its pinned, patched ARM64 Stremio Core."""
import hashlib
import io
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps/android-tv"
BUILD = ROOT / "build"
VENDOR = BUILD / "vendor/stremio-core-kotlin"
REVISION = "2a8083f1026603e7c49f104473340d110902a72c"
ARCHIVE_SHA = "0225427898d8f71a03d92a51d572eed8b06260c1f5a50876f62a4ce8dafbb1de"
NDK_VERSION = "29.0.14206865"
TOOLCHAIN = "1.93.1"

# Media3 ships its FFmpeg audio decoder only as source. These are the pieces of
# that module at the pinned Media3 release, verified by checksum, and the
# LGPL-only FFmpeg build they link against: audio decoders the Shield offers no
# MediaCodec for, arm64 only, no demuxers, no video, no GPL components.
MEDIA3_REVISION = "1.9.3"
MEDIA3_FFMPEG_FILES = {
    "jni/CMakeLists.txt": "8044f1d53d8f115e5fee59255931ca2886698f7cd7b6a8b03f38539b998b5f3d",
    "jni/ffmpeg_jni.cc": "cebafb59c70cd7082d40a94d33680f8627547994758fbd8551ab4b3434d4088c",
    "java/androidx/media3/decoder/ffmpeg/FfmpegAudioRenderer.java": "bb860123a49456e48761fff145eed3d156497be77346955d93286286d42a9a3f",
    "java/androidx/media3/decoder/ffmpeg/FfmpegAudioDecoder.java": "1f88283be0226e9d1cab8d6b7055f75e9ca0678e74818704822b4a1d8613fb25",
    "java/androidx/media3/decoder/ffmpeg/FfmpegLibrary.java": "d7d00601c1864f742c3e0d73f7e9b77d9946f2a9dbe5a6e8e255272bc54d2356",
    "java/androidx/media3/decoder/ffmpeg/FfmpegDecoderException.java": "9e73968d0802b2d7f8add911ec4dc5a6e621777e997eca74332e173c5463ad7a",
}
FFMPEG_TAG = "n6.0.1"
FFMPEG_DECODERS = ["ac3", "eac3", "dca", "truehd", "mlp"]
FFMPEG_OUTPUT = BUILD / "android-ffmpeg"


def run(*args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT, **kwargs)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch_pinned(url, expected, destination):
    """Download once; a checksum mismatch is a hard stop, never a retry with the new bytes."""
    if destination.exists() and digest(destination) == expected:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".download")
    urllib.request.urlretrieve(url, temporary)
    if digest(temporary) != expected:
        temporary.unlink()
        sys.exit(f"Checksum mismatch for {url}")
    temporary.replace(destination)


def build_ffmpeg_decoders(env, ndk, llvm, host):
    """Media3's FFmpeg audio renderer for the formats the Shield cannot decode itself."""
    stamp = FFMPEG_OUTPUT.with_suffix(".stamp")
    state = hashlib.sha256(
        "\0".join([MEDIA3_REVISION, FFMPEG_TAG, NDK_VERSION, *FFMPEG_DECODERS, *MEDIA3_FFMPEG_FILES.values()]).encode()
    ).hexdigest()
    library = FFMPEG_OUTPUT / "jniLibs/arm64-v8a/libffmpegJNI.so"
    base = f"https://raw.githubusercontent.com/androidx/media/{MEDIA3_REVISION}/libraries/decoder_ffmpeg/src/main/"
    for path, checksum in MEDIA3_FFMPEG_FILES.items():
        fetch_pinned(base + path, checksum, FFMPEG_OUTPUT / "upstream" / path)
    # The Java sources compile into the app itself. Media3 annotates them with
    # Checker Framework qualifiers it only has at compile time; the app carries
    # no such dependency, and the annotations change nothing at runtime.
    for path in MEDIA3_FFMPEG_FILES:
        text = (FFMPEG_OUTPUT / "upstream" / path).read_text()
        if path.endswith(".java"):
            text = re.sub(r"^import org\.checkerframework\.[^;]+;\n", "", text, flags=re.M)
            text = re.sub(r"@(?:MonotonicNonNull|EnsuresNonNull|RequiresNonNull|EnsuresNonNullIf)(?:\([^)]*\))?\s*", "", text)
            # Media3 opts its own modules into its unstable API; here the classes
            # compile inside Kino's app, whose lint asks each class to opt in.
            text = re.sub(
                r"^((?:/\* package \*/ )?(?:public )?(?:final |abstract )?class )",
                "@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)\n\\1",
                text, flags=re.M,
            )
        destination = FFMPEG_OUTPUT / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists() or destination.read_text() != text:
            destination.write_text(text)
    if stamp.exists() and stamp.read_text() == state and library.exists():
        print(f"Reusing the FFmpeg audio decoders at {FFMPEG_TAG}")
        return
    stamp.unlink(missing_ok=True)

    source = FFMPEG_OUTPUT / "jni/ffmpeg"
    if not (source / ".git").exists():
        shutil.rmtree(source, ignore_errors=True)
        run("git", "clone", "--quiet", "--depth", "1", "--branch", FFMPEG_TAG,
            "https://github.com/FFmpeg/FFmpeg.git", source)
    run("git", "-C", source, "checkout", "--quiet", "--force", FFMPEG_TAG)
    run("git", "-C", source, "clean", "-ffdqx")
    prefix = str(llvm / "aarch64-linux-android26-")
    configure = [
        "./configure", "--libdir=android-libs/arm64-v8a", "--arch=aarch64", "--cpu=armv8-a",
        f"--cross-prefix={prefix}", f"--nm={llvm / 'llvm-nm'}", f"--ar={llvm / 'llvm-ar'}",
        f"--ranlib={llvm / 'llvm-ranlib'}", f"--strip={llvm / 'llvm-strip'}",
        "--target-os=android", "--enable-static", "--disable-shared", "--disable-doc",
        "--disable-programs", "--disable-everything", "--disable-avdevice", "--disable-avformat",
        "--disable-swscale", "--disable-postproc", "--disable-avfilter", "--disable-symver",
        "--enable-swresample", "--extra-ldexeflags=-pie", "--disable-v4l2-m2m", "--disable-vulkan",
        *(f"--enable-decoder={decoder}" for decoder in FFMPEG_DECODERS),
    ]
    subprocess.run(configure, check=True, cwd=source)
    jobs = str(os.cpu_count() or 4)
    subprocess.run(["make", f"-j{jobs}"], check=True, cwd=source)
    subprocess.run(["make", "install-libs"], check=True, cwd=source)

    cmake_build = FFMPEG_OUTPUT / "jni-build"
    shutil.rmtree(cmake_build, ignore_errors=True)
    run("cmake", "-S", FFMPEG_OUTPUT / "jni", "-B", cmake_build,
        f"-DCMAKE_TOOLCHAIN_FILE={ndk / 'build/cmake/android.toolchain.cmake'}",
        "-DANDROID_ABI=arm64-v8a", "-DANDROID_PLATFORM=android-26", "-DCMAKE_BUILD_TYPE=Release")
    run("cmake", "--build", cmake_build, "--parallel", jobs)
    library.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(cmake_build / "libffmpegJNI.so", library)
    run(llvm / "llvm-strip", "--strip-unneeded", library)
    stamp.write_text(state)


def main():
    env = os.environ.copy()
    if "JAVA_HOME" not in env and platform.system() == "Darwin":
        env["JAVA_HOME"] = "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
    sdk = Path(env.get("ANDROID_HOME", env.get("ANDROID_SDK_ROOT", "/opt/homebrew/share/android-commandlinetools")))
    env["ANDROID_HOME"] = str(sdk)
    ndk = sdk / "ndk" / NDK_VERSION
    host = "darwin-x86_64" if platform.system() == "Darwin" else "linux-x86_64"
    llvm = ndk / "toolchains/llvm/prebuilt" / host / "bin"
    if not llvm.exists():
        sys.exit(f'Install the Android SDK, then run sdkmanager "platforms;android-36" "build-tools;35.0.0" "ndk;{NDK_VERSION}"')
    rustup = shutil.which("rustup") or str(Path.home() / ".cargo/bin/rustup")
    run(rustup, "toolchain", "install", TOOLCHAIN, "--profile", "minimal", "--target", "aarch64-linux-android")
    BUILD.mkdir(exist_ok=True)
    patches = sorted((APP / "core/patches").glob("*.patch"))
    lock = APP / "core/Cargo.lock"
    stamp = VENDOR.with_suffix(".stamp")
    # Reconstructing the checkout rewrites every vendored file, and Cargo
    # fingerprints on mtime, so an unchanged tree rebuilt the whole core every
    # run. The state covers the revision, the patches, the lock file, the
    # checked-out commit, and the working tree, so a patch edit, a hand edit, a
    # stray file, and a failed attempt all reconstruct.
    def vendor_state():
        parts = [REVISION.encode(), *(patch.read_bytes() for patch in patches), lock.read_bytes()]
        for command in (["rev-parse", "HEAD"], ["status", "--porcelain"], ["diff"]):
            try:
                parts.append(subprocess.run(["git", "-C", str(VENDOR), *command], capture_output=True, check=True).stdout)
            except (subprocess.CalledProcessError, FileNotFoundError, NotADirectoryError):
                return None
        return hashlib.sha256(b"\0".join(parts)).hexdigest()

    if stamp.exists() and stamp.read_text() == (vendor_state() or ""):
        print(f"Reusing the vendored Stremio Core at {REVISION}")
    else:
        stamp.unlink(missing_ok=True)
        if not (VENDOR / ".git").exists():
            run("git", "clone", "--no-checkout", "https://github.com/Stremio/stremio-core-kotlin.git", VENDOR)
        run("git", "-C", VENDOR, "fetch", "--depth", "1", "origin", REVISION)
        # This exact generated checkout is disposable; all Kino patches live in apps/android-tv/core.
        run("git", "-C", VENDOR, "checkout", "--force", REVISION)
        run("git", "-C", VENDOR, "clean", "-ffdqx")
        for patch in patches:
            run("git", "-C", VENDOR, "apply", patch)
        shutil.copyfile(lock, VENDOR / "Cargo.lock")
        stamp.write_text(vendor_state())

    archive = BUILD / "stremio-core-kotlin-1.15.0.tar.gz"
    if not archive.exists():
        temporary = archive.with_suffix(".download")
        urllib.request.urlretrieve("https://github.com/Stremio/stremio-core-kotlin/releases/download/1.15.0/stremio-core-kotlin.tar.gz", temporary)
        temporary.replace(archive)
    if digest(archive) != ARCHIVE_SHA:
        sys.exit("Stremio Kotlin bindings archive checksum mismatch")
    output = BUILD / "android-core"
    output.mkdir(exist_ok=True)
    with tarfile.open(archive) as tar:
        member = next(m for m in tar.getmembers() if m.name.endswith("stremio-core-kotlin-android-1.15.0.aar"))
        with zipfile.ZipFile(io.BytesIO(tar.extractfile(member).read())) as aar:
            # Reuse Kotlin bindings and protobuf classes. Build every shipped JNI library below.
            with zipfile.ZipFile(io.BytesIO(aar.read("classes.jar"))) as classes, zipfile.ZipFile(output / "classes.jar", "w", zipfile.ZIP_DEFLATED) as sanitized:
                for name in classes.namelist():
                    if not name.startswith("com/stremio/core/Core"):
                        sanitized.writestr(name, classes.read(name))

    compiler = str(llvm / "aarch64-linux-android26-clang")
    # Cargo resolves `rustc` through PATH, and `rustup run` does not put the
    # toolchain ahead of it. With Homebrew's Rust at /opt/homebrew/bin before
    # ~/.cargo/bin, Cargo compiled with a rustc that has no Android standard
    # library and failed with "can't find crate for `core`". Name the pinned
    # toolchain's own binaries so PATH order cannot swap compilers.
    toolchain_bin = Path(subprocess.run([rustup, "which", "--toolchain", TOOLCHAIN, "rustc"],
        capture_output=True, check=True, text=True).stdout.strip()).parent
    env.update({"RUSTUP_TOOLCHAIN": TOOLCHAIN, "RUSTC": str(toolchain_bin / "rustc"),
        "CARGO_TARGET_DIR": str(BUILD / "android-core-target"),
        "CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER": compiler, "CC_aarch64_linux_android": compiler,
        "AR_aarch64_linux_android": str(llvm / "llvm-ar"), "RANLIB_aarch64_linux_android": str(llvm / "llvm-ranlib"),
        "ANDROID_NDK_ROOT": str(ndk)})
    run(toolchain_bin / "cargo", "build", "--locked", "--release", "--target", "aarch64-linux-android",
        "--manifest-path", VENDOR / "Cargo.toml", "-p", "stremio-core-kotlin", env=env)
    build_ffmpeg_decoders(env, ndk, llvm, host)
    library = output / "jniLibs/arm64-v8a/libstremio_core_kotlin.so"
    library.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(BUILD / "android-core-target/aarch64-linux-android/release/libstremio_core_kotlin.so", library)
    run(llvm / "llvm-strip", "--strip-unneeded", library)
    tasks = sys.argv[1:] or [":app:assembleDebug"]
    run(APP / "gradlew", "-p", APP, *tasks, env=env)
    apk = APP / "app/build/outputs/apk/debug/app-debug.apk"
    if apk.exists():
        destination = BUILD / "android/Kino-TV.apk"
        destination.parent.mkdir(exist_ok=True)
        shutil.copyfile(apk, destination)
        destination.with_suffix(".apk.sha256").write_text(f"{digest(destination)}  {destination.name}\n")
        print(f"APK: {destination}")


if __name__ == "__main__":
    main()
