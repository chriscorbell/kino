#!/usr/bin/env python3
"""Install the development APK on an explicitly selected ADB device."""
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
device = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ANDROID_SERIAL")
if not device:
    sys.exit("Usage: pnpm android:run <ADB serial or IP:5555>")
if ":" in device:
    subprocess.run(["adb", "connect", device], check=True, timeout=15)
subprocess.run(["adb", "-s", device, "install", "-r", str(root / "build/android/Kino-TV.apk")], check=True)
subprocess.run(["adb", "-s", device, "shell", "am", "start", "-n", "app.kino.tv/.MainActivity"], check=True)
