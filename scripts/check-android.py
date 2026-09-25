#!/usr/bin/env python3
"""Run isolated Core and hardware playback checks on a selected Shield."""
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
device = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ANDROID_SERIAL")
if not device:
    sys.exit("Usage: pnpm android:check <ADB serial>")
fixture_env = {**os.environ, "KINO_FIXTURES_DIR": str(root / "build/android-fixtures")}
subprocess.run(["node", "scripts/check-macos-playback.mjs", "--generate-only"], cwd=root, env=fixture_env, check=True)
subprocess.run(["node", "scripts/test-support/track-fixtures.mjs", str(root / "build/android-fixtures")], cwd=root, check=True)
subprocess.run(["node", "scripts/test-support/tv-ending-fixtures.mjs", str(root / "build/android-fixtures")], cwd=root, check=True)
subprocess.run(["node", "scripts/test-support/tv-intro-fixtures.mjs", str(root / "build/android-fixtures")], cwd=root, check=True)
subprocess.run(["node", "scripts/test-support/hdr-probe-fixture.mjs", str(root / "build/android-fixtures")], cwd=root, check=True)
subprocess.run(["node", "scripts/test-support/loudness-reference.mjs", str(root / "build/android-fixtures")], cwd=root, check=True)
subprocess.run([sys.executable, "scripts/build-android.py", ":app:assembleBenchmark", ":app:assembleBenchmarkAndroidTest"], cwd=root, check=True)
adb = ["adb", "-s", device]
# UpdateTest needs this build signed by someone else, which the update check must refuse. A
# throwaway key re-signs it on the host; the test reads it from the device's temporary directory.
benchmark = root / "apps/android-tv/app/build/outputs/apk/benchmark/app-benchmark.apk"
other_key = root / "build/android-other-key"
other_key.mkdir(parents=True, exist_ok=True)
keystore = other_key / "other.jks"
java_home = os.environ.get("JAVA_HOME", "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home")
if not keystore.exists():
    subprocess.run([f"{java_home}/bin/keytool", "-genkeypair", "-keystore", str(keystore), "-storepass", "kino-other",
        "-keypass", "kino-other", "-alias", "other", "-keyalg", "RSA", "-keysize", "2048", "-validity", "2",
        "-dname", "CN=Not Kino"], check=True, capture_output=True)
sdk = Path(os.environ.get("ANDROID_HOME", "/opt/homebrew/share/android-commandlinetools"))
apksigner = sorted((sdk / "build-tools").glob("*/apksigner"))[-1]
subprocess.run([str(apksigner), "sign", "--ks", str(keystore), "--ks-pass", "pass:kino-other",
    "--out", str(other_key / "kino-other-key.apk"), str(benchmark)], check=True)
try:
    subprocess.run([*adb, "push", str(other_key / "kino-other-key.apk"), "/data/local/tmp/kino-other-key.apk"],
        check=True, capture_output=True)
    for path in ["benchmark/app-benchmark.apk", "androidTest/benchmark/app-benchmark-androidTest.apk"]:
        subprocess.run([*adb, "install", "-r", str(root / "apps/android-tv/app/build/outputs/apk" / path)], check=True)
    # Apply the APK's baseline profile as a device does in idle maintenance after an install, so
    # the frame gates measure the code people run rather than a first, interpreted pass.
    subprocess.run([*adb, "shell", "am", "broadcast", "-a", "androidx.profileinstaller.action.INSTALL_PROFILE",
        "app.kino.tv/androidx.profileinstaller.ProfileInstallReceiver"], check=True, capture_output=True)
    subprocess.run([*adb, "shell", "cmd", "package", "compile", "-f", "-m", "speed-profile", "app.kino.tv"],
        check=True, capture_output=True)
    # UpdateTest hands a build to Android's installer. Android ends the app's process whenever this
    # permission changes, so it is granted here, before any test is running in that process.
    subprocess.run([*adb, "shell", "appops", "set", "app.kino.tv", "REQUEST_INSTALL_PACKAGES", "allow"], check=True)
    subprocess.run([*adb, "shell", "input", "keyevent", "KEYCODE_WAKEUP"], check=True)
    def instrument(*arguments):
        result = subprocess.run([*adb, "shell", "am", "instrument", "-w", "-r", *arguments,
            "app.kino.tv.test/app.kino.tv.ShieldTestRunner"], capture_output=True, text=True, check=True, timeout=300)
        print(result.stdout)
        if "OK (" not in result.stdout or "FAILURES" in result.stdout:
            sys.exit("Shield checks failed")

    instrument()
    # The first process leaves only its isolated instrumentation profile. The
    # second must restore the actual Unload snapshot without any Core memory.
    instrument("-e", "class", "app.kino.tv.PlaybackShutdownTest#backWaitsForTheFinalPositionAndTheUnloadSnapshot",
        "-e", "persistencePhase", "prepare")
    subprocess.run([*adb, "shell", "am", "force-stop", "app.kino.tv"], check=True)
    instrument("-e", "class", "app.kino.tv.PlaybackShutdownTest#savedEpisodeSurvivesProcessRestart",
        "-e", "persistencePhase", "verify")
    # Sign-out must reach Stremio: a stored session loads in a fresh process and signs out.
    instrument("-e", "class", "app.kino.tv.LogoutTest", "-e", "logoutPhase", "prepare")
    subprocess.run([*adb, "shell", "am", "force-stop", "app.kino.tv"], check=True)
    instrument("-e", "class", "app.kino.tv.LogoutTest", "-e", "logoutPhase", "verify")
    # Both profile names must restore their own language defaults through a new JNI Core.
    for profile in ["guest", "account"]:
        instrument("-e", "class", "app.kino.tv.SettingsTest#preferencesSurviveProcessRestart",
            "-e", "settingsPhase", "prepare", "-e", "settingsProfile", profile)
        subprocess.run([*adb, "shell", "am", "force-stop", "app.kino.tv"], check=True)
        instrument("-e", "class", "app.kino.tv.SettingsTest#preferencesSurviveProcessRestart",
            "-e", "settingsPhase", "verify", "-e", "settingsProfile", profile)
finally:
    # Leave the same optimized APK that android:run and CI distribute on the device.
    subprocess.run([*adb, "shell", "am", "force-stop", "app.kino.tv"], check=True)
    subprocess.run([*adb, "install", "-r", str(root / "build/android/Kino-TV.apk")], check=True)
