#!/usr/bin/env bash
# Android build of the RevKlik app (apps/native) on a Linux machine with JDK 17 and the Android SDK
# (ANDROID_HOME). No EAS: `expo prebuild` generates the Gradle project, Gradle builds it.
#
#   scripts/mobile/build-android.sh apk   -> dist/revklik.apk   (assembleRelease)
#   scripts/mobile/build-android.sh aab   -> dist/revklik.aab   (bundleRelease, Play upload artifact)
#
# Signing: if apps/native/keystore/keystore.properties exists (the release workflow writes it from the
# ANDROID_KEYSTORE_* secrets) the build is signed with that key; otherwise it falls back to the Expo template's
# debug key so a PR build still produces an installable APK. The aab target refuses to run without the keystore.
# Push on Android needs apps/native/google-services.json (Firebase); without it the app builds but cannot get a
# push token (the app says so on launch).
#
# Env: BUILD_NUMBER (versionCode, default minutes since 2024-01-01 UTC), ARCHS (ABI list, default
# arm64-v8a for apk, arm64-v8a,armeabi-v7a for aab), MINIFY=1 (R8 + resource shrinking; the release workflow sets it),
# EXPO_PUBLIC_REVKLIK_API_URL (baked in at build time, default production).
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
NATIVE="$ROOT/apps/native"
KEYSTORE_PROPS="$NATIVE/keystore/keystore.properties"

target="${1:-}"
case "$target" in
  apk) GRADLE_TASK=assembleRelease; OUT_SRC=app/build/outputs/apk/release/app-release.apk; OUT="$ROOT/dist/revklik.apk"
       export ARCHS="${ARCHS:-arm64-v8a}" ;;
  aab) GRADLE_TASK=bundleRelease; OUT_SRC=app/build/outputs/bundle/release/app-release.aab; OUT="$ROOT/dist/revklik.aab"
       export ARCHS="${ARCHS:-arm64-v8a,armeabi-v7a}"
       [ -f "$KEYSTORE_PROPS" ] || { echo "aab needs the release keystore ($KEYSTORE_PROPS)" >&2; exit 1; } ;;
  *) echo "usage: $0 apk|aab" >&2; exit 1 ;;
esac

export BUILD_NUMBER="${BUILD_NUMBER:-$(( ($(date -u +%s) - 1704067200) / 60 ))}"
export NODE_ENV=production
export EXPO_PUBLIC_REVKLIK_API_URL="${EXPO_PUBLIC_REVKLIK_API_URL:-https://app.revklik.com/api}"
export MINIFY="${MINIFY:-0}"

cd "$NATIVE"
bunx expo prebuild -p android --no-install --clean 2>&1 | tail -n 3

python3 - <<'PY'
import os, pathlib, re

app = pathlib.Path("android/app/build.gradle")
s = app.read_text()

if pathlib.Path("keystore/keystore.properties").exists():
    # Load keystore.properties (next to the keystore, outside android/ so prebuild --clean never wipes it).
    s = s.replace(
        "android {",
        """def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("../keystore/keystore.properties")
keystoreProperties.load(new FileInputStream(keystorePropertiesFile))

android {""",
        1,
    )
    s = s.replace(
        """    signingConfigs {
        debug {""",
        """    signingConfigs {
        release {
            storeFile new File(keystorePropertiesFile.parentFile, new File(keystoreProperties['storeFile']).name)
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
        debug {""",
        1,
    )
    # The template comments sit between `release {` and `signingConfig`; fail loudly instead of shipping the debug key.
    s, n = re.subn(
        r"(buildTypes \{.*?\n        release \{.*?signingConfig signingConfigs\.)debug",
        r"\1release",
        s, count=1, flags=re.S,
    )
    if n != 1 or "signingConfigs.release" not in s:
        raise SystemExit("could not set the release signingConfig in android/app/build.gradle")
    print("release signing: keystore")
else:
    print("release signing: template debug key (no keystore)")

s, n = re.subn(r"versionCode \d+", "versionCode " + os.environ["BUILD_NUMBER"], s, count=1)
if n != 1:
    raise SystemExit("could not set versionCode")
app.write_text(s)

props = pathlib.Path("android/gradle.properties")
p = props.read_text()
p = re.sub(r"reactNativeArchitectures=.*", "reactNativeArchitectures=" + os.environ["ARCHS"], p)
if os.environ["MINIFY"] == "1":
    # app/build.gradle reads both properties; the template defines neither.
    for key in ("android.enableMinifyInReleaseBuilds", "android.enableShrinkResourcesInReleaseBuilds"):
        p = re.sub(rf"^{re.escape(key)}=.*\n?", "", p, flags=re.M)
        p = p.rstrip("\n") + f"\n{key}=true\n"
props.write_text(p)
PY

cd android
./gradlew "$GRADLE_TASK" --no-daemon

# Bundle sanity: the API URL must be inlined, and the dev-only token hook must be compiled out.
case "$target" in
  apk) STRINGS="$(unzip -p "$OUT_SRC" assets/index.android.bundle | strings)" ;;
  aab) STRINGS="$(unzip -p "$OUT_SRC" base/assets/index.android.bundle | strings)" ;;
esac
grep -qF "$EXPO_PUBLIC_REVKLIK_API_URL" <<<"$STRINGS" || { echo "bundle does not contain $EXPO_PUBLIC_REVKLIK_API_URL" >&2; exit 1; }
if grep -q 'EXPO_PUBLIC_REVKLIK_DEV_TOKEN' <<<"$STRINGS"; then
  echo "release bundle still reads the dev token env var" >&2
  exit 1
fi

mkdir -p "$ROOT/dist"
cp "$OUT_SRC" "$OUT"
if [ "$GRADLE_TASK" = bundleRelease ] && [ -f app/build/outputs/mapping/release/mapping.txt ]; then
  cp app/build/outputs/mapping/release/mapping.txt "$ROOT/dist/mapping.txt"
fi
ls -la "$ROOT/dist"
echo "versionCode=$BUILD_NUMBER"
