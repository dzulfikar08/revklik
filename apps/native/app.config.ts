import fs from "node:fs";
import path from "node:path";

import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json is the source of truth; this file only layers build-time inputs that
 * must not live in git:
 * - BUILD_NUMBER: monotonically increasing store build number (CI passes the run number).
 * - APS_ENVIRONMENT=production: signs release IPAs with the production APNs entitlement.
 * - updates: app.json points expo-updates at this project's EAS Update channel "production". An OTA
 *   bundle bakes in EXPO_PUBLIC_REVKLIK_API_URL at publish time, so a build aimed at any other API
 *   (self-hosted) turns updates off instead of pulling the hosted app's bundle.
 * - google-services.json (Firebase, required for Android push): GOOGLE_SERVICES_JSON points at it,
 *   else ./google-services.json is used when present. Without it the app still builds but
 *   Android cannot obtain a push token.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
	const buildNumber = process.env.BUILD_NUMBER;
	const googleServices = process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json";
	const hasGoogleServices = fs.existsSync(path.resolve(__dirname, googleServices));
	const apsEnvironment =
		process.env.APS_ENVIRONMENT === "production" ? "production" : "development";

	const hostedApi =
		!process.env.EXPO_PUBLIC_REVKLIK_API_URL?.trim() ||
		new URL(process.env.EXPO_PUBLIC_REVKLIK_API_URL).origin === "https://app.revklik.com";

	return {
		...(config as ExpoConfig),
		updates: { ...config.updates, enabled: hostedApi },
		android: {
			...config.android,
			...(buildNumber ? { versionCode: Number(buildNumber) } : {}),
			...(hasGoogleServices ? { googleServicesFile: googleServices } : {}),
		},
		ios: {
			...config.ios,
			...(buildNumber ? { buildNumber } : {}),
		},
		plugins: (config.plugins ?? []).map((plugin) =>
			Array.isArray(plugin) && plugin[0] === "expo-notifications"
				? ["expo-notifications", { ...plugin[1], mode: apsEnvironment }]
				: plugin,
		),
	};
};
