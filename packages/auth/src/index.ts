import { expo } from "@better-auth/expo";
import { polar, checkout, portal } from "@polar-sh/better-auth";
import { createDb } from "@revklik/db";
import * as schema from "@revklik/db/schema/auth";
import { env } from "@revklik/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { polarClient } from "./lib/payments";

export function createAuth() {
	const db = createDb();

	// Polar's sign-up customer hook hard-fails sign-up on API errors; skip it
	// entirely for local dev (dummy token) so auth works without Polar.
	const polarEnabled = !env.POLAR_ACCESS_TOKEN.startsWith("polar_dummy");

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "sqlite",

			schema: schema,
		}),
		trustedOrigins: [
			env.CORS_ORIGIN,

			"revklik-new://",
			"exp://",
			"http://localhost:8081",
		],
		emailAndPassword: {
			enabled: true,
		},
		// uncomment cookieCache setting when ready to deploy to Cloudflare using *.workers.dev domains
		// session: {
		//   cookieCache: {
		//     enabled: true,
		//     maxAge: 60,
		//   },
		// },
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
			// uncomment crossSubDomainCookies setting when ready to deploy and replace <your-workers-subdomain> with your actual workers subdomain
			// https://developers.cloudflare.com/workers/wrangler/configuration/#workersdev
			// crossSubDomainCookies: {
			//   enabled: true,
			//   domain: "<your-workers-subdomain>",
			// },
		},
		plugins: [
			...(polarEnabled
				? [
						polar({
							client: polarClient,
							createCustomerOnSignUp: true,
							use: [
								checkout({
									products: [
										{
											productId: "your-product-id",
											slug: "pro",
										},
									],
									successUrl: env.POLAR_SUCCESS_URL,
									authenticatedUsersOnly: true,
								}),
								portal(),
							],
						}),
					]
				: []),
			expo(),
		],
	});
}
