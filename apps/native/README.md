# RevKlik mobile app (`@revklik/native`)

Expo (React Native, expo-router) app for iOS and Android. It does two things:

- **Sale alerts**: a push notification on your phone for every sale and refund across all your products.
- **Earnings**: gross vs net, sales and refunds, daily chart, by product, by payment rail and recent sales
  (`GET /api/portfolio/revenue`), plus the existing Sites, Dashboard, Visitors and Settings tabs.

Plan purchases happen on the web (revklik.com), not in the app. Settings links there ("Manage plan on
revklik.com"), so the app has no in-app checkout and no App Store in-app purchase flow.

Identity: name `RevKlik`, slug `revklik`, bundle id / package `com.joyodigitama.revklik`, scheme `revklik`,
Expo owner `dzulfikar08`, EAS project id `bd106b95-1003-499e-bbec-a7a9999a40fd` (needed by Expo push tokens,
nothing here uses EAS Build). Apple team `F6Q6UFUK69`.

## Develop

```sh
bun install                      # at the repo root
cd apps/native
cp .env.example .env             # optional
bunx expo start                  # Expo dev client / simulator (push needs a physical device)
bun run check-types              # tsc --noEmit
```

Environment (build-time, inlined by Expo; see `lib/env.ts`):

| Variable                        | Default                                     | Meaning                                                                                                           |
| ------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_REVKLIK_API_URL`   | `https://app.revklik.com/api`               | Worker API base. Point it at your own deployment when self-hosting.                                               |
| `EXPO_PUBLIC_REVKLIK_DEV_TOKEN` | unset                                       | Dev builds only (`__DEV__`): use an existing session token instead of signing in. Compiled out of release builds. |
| `EXPO_PUBLIC_REVKLIK_BOOKS_URL` | unset (hosted: `https://books.revklik.com`) | RevKlik Books origin for the Settings "RevKlik Books" row. Hidden on a self-hosted API unless this is set.        |

Sign-in: email and password, or Google (`WebBrowser.openAuthSessionAsync` on
`/auth/google?redirect_to=revklik://auth/callback`, the Worker answers with `revklik://auth/callback#token=...`).

## Push notifications

On sign-in the app asks for notification permission, gets an Expo push token with the project id from
`app.json` (`extra.eas.projectId`; it fails with a visible alert if that is missing) and registers it with
`POST /api/push/devices`. Sign-out calls `DELETE /api/push/devices`. Settings -> Notifications toggles sales and
refunds alerts (`/api/push/prefs`) and sends a test notification (`/api/push/test`). Tapping an alert opens Earnings.
Android uses the high-importance channel `sales`.

What must exist outside this repo for pushes to arrive (Expo push service credentials, one-time):

- **iOS**: an APNs key (Apple Developer -> Keys -> Apple Push Notifications service) uploaded to the Expo project
  `@dzulfikar08/revklik` (`bunx eas-cli credentials -p ios`). The App ID needs the Push Notifications capability;
  the release workflow enables it through the App Store Connect API.
- **Android**: a Firebase project with an Android app `com.joyodigitama.revklik`; put its `google-services.json` in
  `apps/native/google-services.json` (gitignored; `app.config.ts` wires it in when present) and upload an FCM v1
  service-account key to the same Expo project (`bunx eas-cli credentials -p android`). Without
  `google-services.json` the app builds but Android cannot get a push token.
- The Worker needs `EXPO_ACCESS_TOKEN` only if you enable "enhanced push security" on the Expo project.

## Build locally (no EAS)

```sh
cd apps/native
bunx expo prebuild -p android --no-install --clean   # generates android/ (gitignored)
cd android && ./gradlew assembleDebug                # needs JDK 17 and the Android SDK (ANDROID_HOME)

bunx expo prebuild -p ios --no-install --clean       # macOS only for the next steps
cd ios && pod install && open RevKlik.xcworkspace
```

The CI scripts do the same plus signing and sanity checks: `scripts/mobile/build-android.sh apk|aab` and
`scripts/mobile/build-ios.sh simulator|ipa`. `app.config.ts` layers `BUILD_NUMBER`, `APS_ENVIRONMENT=production`
and `google-services.json` on top of `app.json`.

## CI (free GitHub-hosted runners)

- `.github/workflows/mobile.yml` (PRs and pushes touching `apps/native`): Android `expo prebuild` +
  `assembleRelease` on ubuntu (debug-signed APK artifact) and iOS `expo prebuild` + `pod install` + `xcodebuild` for the
  simulator on macOS (unsigned). No secrets.
- `.github/workflows/release-mobile.yml` (manual, environment `release`, only in `dzulfikar08/revklik`): signed
  Android AAB (optional Play internal-track upload) and signed iOS IPA (optional TestFlight upload).

Release secrets (environment `release`; set with `gh secret set NAME --env release -R dzulfikar08/revklik`):

| Secret                                                                                              | Used for                                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Signing the AAB (Play upload key)                                         |
| `GOOGLE_SERVICES_JSON_BASE64`                                                                       | Firebase config for Android push (`base64 -w0 google-services.json`)      |
| `PLAY_SERVICE_ACCOUNT_JSON`                                                                         | Optional Play upload (internal track)                                     |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_BASE64`                                                     | App Store Connect API key (`.p8`): profile creation and TestFlight upload |
| `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD`                                                | Apple Distribution identity for manual signing                            |

The iOS profile is created through the App Store Connect API (`scripts/ios/asc-ci-profile.py`, adapted from
JoyoRogo), which also registers the bundle id and enables Push Notifications. The release IPA is built with the
production APNs entitlement (`APS_ENVIRONMENT=production`) and the build checks it. Build numbers are minutes since
2024-01-01 UTC (Android `versionCode`, iOS `CFBundleVersion`), so they only ever increase.

## Updates (OTA)

Builds embed `expo-updates` (SDK 57), configured in `app.json`: `runtimeVersion` policy `appVersion`, update URL
`https://u.expo.dev/<extra.eas.projectId>` and channel `production` (sent as the `expo-channel-name` request
header, so no EAS Build is needed; `expo prebuild` in CI writes it into the manifest/plist). The app checks on
launch and applies a downloaded update on the next cold start.

Because the runtime version is the app version, an update only reaches binaries with the same `version` in
`app.json`. JavaScript, styles and assets can ship over the air; anything that changes native code (a new Expo
module, permission, plugin option) or `version` needs a new store build, and the version bump starts a new
update line. `app.config.ts` turns updates off when `EXPO_PUBLIC_REVKLIK_API_URL` points anywhere but
`https://app.revklik.com`, because an OTA bundle bakes that URL in at publish time.

Publish an update (needs the Expo account that owns the project, `EXPO_TOKEN` in CI or `bunx eas-cli login`):

```bash
cd apps/native
bun run update:publish -- --message "what changed"     # eas update --channel production
```

The first publish on a project may ask to create the `production` channel/branch; accept. Updates for 1.1.0 are
only delivered to 1.1.0 builds. Store builds still go through `release-mobile.yml`; build numbers come from the
clock. Money figures, labels and day boundaries mirror the web dashboard (net after fees, gross, sales, visitor
to sale, site currency, device-local days via `tz`). Strings for those screens live in `lib/i18n.ts`.

## License

AGPL-3.0-only, like the rest of the repository.
