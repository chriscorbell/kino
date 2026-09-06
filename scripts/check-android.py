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
subprocess.run([sys.executable, "scripts/build-android.py", ":app:assembleDebug", ":app:assembleDebugAndroidTest"], cwd=root, check=True)
adb = ["adb", "-s", device]
for path in ["debug/app-debug.apk", "androidTest/debug/app-debug-androidTest.apk"]:
    subprocess.run([*adb, "install", "-r", str(root / "apps/android-tv/app/build/outputs/apk" / path)], check=True)
subprocess.run([*adb, "shell", "input", "keyevent", "KEYCODE_WAKEUP"], check=True)
result = subprocess.run([*adb, "shell", "am", "instrument", "-w", "-r", "app.kino.tv.test/app.kino.tv.ShieldTestRunner"], capture_output=True, text=True, check=True)
print(result.stdout)
if "OK (" not in result.stdout or "FAILURES" in result.stdout:
    sys.exit("Shield checks failed")
