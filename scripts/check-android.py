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
subprocess.run([sys.executable, "scripts/build-android.py", ":app:assembleBenchmark", ":app:assembleBenchmarkAndroidTest"], cwd=root, check=True)
adb = ["adb", "-s", device]
try:
    for path in ["benchmark/app-benchmark.apk", "androidTest/benchmark/app-benchmark-androidTest.apk"]:
        subprocess.run([*adb, "install", "-r", str(root / "apps/android-tv/app/build/outputs/apk" / path)], check=True)
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
