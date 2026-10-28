#!/usr/bin/env bash
# iOS build of the RevKlik app (apps/native) ON macOS with Xcode (a GitHub macos-latest runner or a Mac).
# No EAS: `expo prebuild` generates the Xcode project, CocoaPods and xcodebuild build it.
#
#   scripts/mobile/build-ios.sh simulator   unsigned Release build for the iOS Simulator (compile check)
#   scripts/mobile/build-ios.sh ipa         signed archive + export -> build/ios/RevKlik.ipa
#   scripts/mobile/build-ios.sh ipa --upload   ...then upload it to App Store Connect (TestFlight) with altool
#
# Needs on PATH: node, bun, pod (CocoaPods), Xcode (xcodebuild, xcrun).
# ipa env:
#   EXPORT_PROFILE   name of the installed App Store provisioning profile of com.joyodigitama.revklik (the release
#                    workflow creates it with scripts/ios/asc-ci-profile.py); the archive and the export sign manually
#                    with the "Apple Distribution" identity in the keychain.
#   ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH   App Store Connect API key (.p8 in ~/.appstoreconnect/private_keys)
#                    for the --upload step.
# Env: BUILD_NUMBER (CFBundleVersion, default minutes since 2024-01-01 UTC), EXPO_PUBLIC_REVKLIK_API_URL (baked in).
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
mode="${1:-}"
upload="${2:-}"
case "$mode" in simulator | ipa) ;; *) echo "usage: $0 simulator|ipa [--upload]" >&2; exit 1 ;; esac

APP=RevKlik
BUNDLE_ID=com.joyodigitama.revklik
TEAM_ID=F6Q6UFUK69
NATIVE="$ROOT/apps/native"
IOS_DIR="$NATIVE/ios"
OUT="$ROOT/build/ios"

export BUILD_NUMBER="${BUILD_NUMBER:-$(( ($(date -u +%s) - 1704067200) / 60 ))}"
export NODE_ENV=production
export EXPO_PUBLIC_REVKLIK_API_URL="${EXPO_PUBLIC_REVKLIK_API_URL:-https://app.revklik.com/api}"
export LANG=en_US.UTF-8
# app.config.ts: production APNs entitlement only for a store build (a simulator build has no push entitlement use).
if [ "$mode" = ipa ]; then export APS_ENVIRONMENT=production; fi

for tool in node bun pod xcodebuild xcrun; do
  command -v "$tool" > /dev/null || { echo "$tool is not on PATH" >&2; exit 1; }
done
step() { printf '\n== %s ==\n' "$*"; }

rm -rf "$OUT"
mkdir -p "$OUT/tmp"
export TMPDIR="$OUT/tmp" # own Metro cache per build

step "Toolchain"
xcodebuild -version | tr '\n' ' '; echo
echo "node $(node -v), bun $(bun -v), pod $(pod --version 2> /dev/null | tail -n1); $APP build $BUILD_NUMBER"

step "1. expo prebuild --platform ios --clean"
(cd "$NATIVE" && bunx expo prebuild --platform ios --clean --no-install 2>&1 | tail -n 3)

step "2. pod install"
(cd "$IOS_DIR" && EXPO_PRECOMPILED_FLAVOR=release pod install > "$OUT/pod-install.log" 2>&1) ||
  { tail -n 40 "$OUT/pod-install.log" >&2; exit 1; }

if [ "$mode" = simulator ]; then
  step "3. xcodebuild build (iOS Simulator, unsigned)"
  xcodebuild build -workspace "$IOS_DIR/$APP.xcworkspace" -scheme "$APP" -configuration Release \
    -sdk iphonesimulator -arch arm64 CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER" SYMROOT="$OUT/sim" > "$OUT/xcodebuild-sim.log" 2>&1 < /dev/null ||
    { grep -E 'error:|\*\* BUILD FAILED' "$OUT/xcodebuild-sim.log" | head -n 30 >&2; tail -n 40 "$OUT/xcodebuild-sim.log" >&2; exit 1; }
  tail -n 3 "$OUT/xcodebuild-sim.log"
  test -d "$OUT/sim/Release-iphonesimulator/$APP.app"
  echo "built: $OUT/sim/Release-iphonesimulator/$APP.app"
  exit 0
fi

: "${EXPORT_PROFILE:?EXPORT_PROFILE (App Store profile name for $BUNDLE_ID) is required for the ipa mode}"
step "3. manual signing"
ruby -rxcodeproj -e '
  proj = Xcodeproj::Project.open(ARGV[0])
  target = proj.targets.find { |t| t.name == ARGV[1] } or abort("no target #{ARGV[1]}")
  target.build_configurations.each do |c|
    s = c.build_settings
    s["CODE_SIGN_STYLE"] = "Manual"
    s["CODE_SIGN_IDENTITY"] = "Apple Distribution"
    s.delete("CODE_SIGN_IDENTITY[sdk=iphoneos*]")
    s["DEVELOPMENT_TEAM"] = ARGV[3]
    s["PROVISIONING_PROFILE_SPECIFIER"] = ARGV[2]
  end
  proj.save' "$IOS_DIR/$APP.xcodeproj" "$APP" "$EXPORT_PROFILE" "$TEAM_ID"

step "4. xcodebuild archive"
xcodebuild archive -workspace "$IOS_DIR/$APP.xcworkspace" -scheme "$APP" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/$APP.xcarchive" \
  DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" > "$OUT/xcodebuild-archive.log" 2>&1 < /dev/null ||
  { grep -E 'error:|\*\* ARCHIVE FAILED' "$OUT/xcodebuild-archive.log" | head -n 20 >&2; echo "full log: $OUT/xcodebuild-archive.log" >&2; exit 1; }

step "5. xcodebuild -exportArchive (app-store-connect)"
cat > "$OUT/ExportOptions.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>manual</string>
  <key>provisioningProfiles</key><dict>
    <key>$BUNDLE_ID</key><string>$EXPORT_PROFILE</string>
  </dict>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>stripSwiftSymbols</key><true/>
  <key>uploadSymbols</key><false/>
</dict>
</plist>
PLIST
xcodebuild -exportArchive -archivePath "$OUT/$APP.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" > "$OUT/xcodebuild-export.log" 2>&1 ||
  { tail -n 30 "$OUT/xcodebuild-export.log" >&2; exit 1; }
IPA="$OUT/$APP.ipa"
cp "$OUT/export/$APP.ipa" "$IPA"

step "6. Check the IPA"
CHECK="$OUT/ipa"
mkdir -p "$CHECK" && unzip -q "$IPA" -d "$CHECK"
APPDIR="$CHECK/Payload/$APP.app"
plist() { /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2> /dev/null; }
fail() { echo "CHECK FAILED: $*" >&2; exit 1; }

[ "$(plist "$APPDIR/Info.plist" CFBundleIdentifier)" = "$BUNDLE_ID" ] || fail "bundle id is not $BUNDLE_ID"
[ "$(plist "$APPDIR/Info.plist" CFBundleVersion)" = "$BUILD_NUMBER" ] || fail "CFBundleVersion is not $BUILD_NUMBER"
security cms -D -i "$APPDIR/embedded.mobileprovision" > "$OUT/profile.plist"
[ -z "$(plist "$OUT/profile.plist" ProvisionedDevices)" ] || fail "embedded profile lists devices (not an App Store profile)"
codesign -d --entitlements :- "$APPDIR" > "$OUT/entitlements.plist" 2> /dev/null
[ "$(plist "$OUT/entitlements.plist" get-task-allow)" = false ] || fail "get-task-allow is not false"
# Push alerts need the production APNs entitlement; without it TestFlight builds never receive a notification.
[ "$(plist "$OUT/entitlements.plist" aps-environment)" = production ] || fail "aps-environment is not production (is Push Notifications enabled on the App ID?)"
codesign --verify --deep --strict "$APPDIR" || fail "code signature does not verify"
codesign -dvv "$APPDIR" 2>&1 | grep -q '^Authority=Apple Distribution' || fail "not signed with an Apple Distribution identity"
[ -f "$APPDIR/main.jsbundle" ] || fail "no main.jsbundle in the app"
STRINGS="$(LC_ALL=C strings -a "$APPDIR/main.jsbundle")"
grep -qF "$EXPO_PUBLIC_REVKLIK_API_URL" <<< "$STRINGS" || fail "release bundle does not contain the API URL $EXPO_PUBLIC_REVKLIK_API_URL"
if grep -q 'EXPO_PUBLIC_REVKLIK_DEV_TOKEN' <<< "$STRINGS"; then fail "release bundle still reads the dev token env var"; fi
echo "   $BUNDLE_ID $(plist "$APPDIR/Info.plist" CFBundleShortVersionString) ($BUILD_NUMBER), aps-environment production"

mkdir -p "$ROOT/dist"
cp "$IPA" "$ROOT/dist/$APP.ipa"
echo "ipa: $ROOT/dist/$APP.ipa"

if [ "$upload" = --upload ]; then
  step "7. Upload to App Store Connect (altool)"
  : "${ASC_KEY_ID:?}" "${ASC_ISSUER_ID:?}"
  xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1
  echo "uploaded: $APP $BUILD_NUMBER"
fi
