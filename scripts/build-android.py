#!/usr/bin/env python3
"""Build Kino TV and its pinned, patched ARM64 Stremio Core."""
import hashlib
import io
import os
from pathlib import Path
import platform
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


def run(*args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT, **kwargs)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
    if not (VENDOR / ".git").exists():
        run("git", "clone", "--no-checkout", "https://github.com/Stremio/stremio-core-kotlin.git", VENDOR)
    run("git", "-C", VENDOR, "fetch", "--depth", "1", "origin", REVISION)
    # This exact generated checkout is disposable; all Kino patches live in apps/android-tv/core.
    run("git", "-C", VENDOR, "checkout", "--force", REVISION)
    run("git", "-C", VENDOR, "clean", "-ffdqx")
    patches = sorted((APP / "core/patches").glob("*.patch"))
    for patch in patches:
        run("git", "-C", VENDOR, "apply", patch)
    shutil.copyfile(APP / "core/Cargo.lock", VENDOR / "Cargo.lock")

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
    env.update({"RUSTUP_TOOLCHAIN": TOOLCHAIN, "CARGO_TARGET_DIR": str(BUILD / "android-core-target"),
        "CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER": compiler, "CC_aarch64_linux_android": compiler,
        "AR_aarch64_linux_android": str(llvm / "llvm-ar"), "RANLIB_aarch64_linux_android": str(llvm / "llvm-ranlib"),
        "ANDROID_NDK_ROOT": str(ndk)})
    run(rustup, "run", TOOLCHAIN, "cargo", "build", "--locked", "--release", "--target", "aarch64-linux-android",
        "--manifest-path", VENDOR / "Cargo.toml", "-p", "stremio-core-kotlin", env=env)
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
