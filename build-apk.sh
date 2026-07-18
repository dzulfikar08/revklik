#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/client"

echo "Building web assets (VITE_API_BASE=https://app.revklik.com/api)..."
VITE_API_BASE=https://app.revklik.com/api npx vite build

echo "Syncing to Android..."
npx cap sync android

echo "Building APK..."
cd android
./gradlew assembleDebug

APK="app/build/outputs/apk/debug/app-debug.apk"
OUT="../../RevKlik-debug.apk"

if [ -f "$APK" ]; then
  cp "$APK" "$OUT"
  echo "Done: $(pwd)/$OUT ($(du -h "$OUT" | cut -f1))"
else
  echo "APK not found at $APK"
  exit 1
fi
