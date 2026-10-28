import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import type { EmailBinding } from "./lib/email";

export type Variables = {
	db: Kysely<KlikapaDatabase>;
	userId: string;
	/** Earliest ISO timestamp the caller's plan may read (retention window). */
	retentionFloor?: string;
};

export type Bindings = {
	// wrangler.jsonc bindings
	DB: D1Database;
	EMAIL: EmailBinding;
	ASSETS: Fetcher;
	AI: Ai;
	// Daily DB dump destination
	BACKUP_BUCKET: R2Bucket;
	// Polar billing
	POLAR_ACCESS_TOKEN?: string;
	POLAR_ORG_ID?: string;
	POLAR_WEBHOOK_SECRET?: string;
	POLAR_MICRO_PRODUCT_ID?: string;
	POLAR_STARTER_PRODUCT_ID?: string;
	POLAR_GROWTH_PRODUCT_ID?: string;
	// Pakasir (QRIS)
	PAKASIR_API_KEY?: string;
	// Pakasir project slug that owns the checkout pages (default "revklik")
	PAKASIR_PROJECT?: string;
	// Google OAuth (auth + GSC)
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	// Marketplace: Shopee
	SHOPEE_PARTNER_ID?: string;
	SHOPEE_SHOP_ID?: string;
	// Marketplace: Tokopedia
	TOKOPEDIA_CLIENT_ID?: string;
	TOKOPEDIA_CLIENT_SECRET?: string;
	TOKOPEDIA_FS_ID?: string;
	// Admin bootstrap
	SUPER_ADMIN_EMAIL?: string;
	// Public app origin for emailed links and checkout returns (default https://app.revklik.com)
	APP_URL?: string;
	// Sender of transactional email (default "RevKlik <noreply@revklik.com>")
	EMAIL_FROM?: string;
	// "1" or "true": fully unlocked self-hosted install. No plans, limits, trials,
	// checkout or referral payouts. Unset = hosted RevKlik behavior.
	SELF_HOSTED?: string;
	// Hard-delete raw analytics older than N days (unset = never; default off)
	RETENTION_HARD_DELETE_DAYS?: string;
	// Expo push access token; only needed when "enhanced push security" is on for the EAS project
	EXPO_ACCESS_TOKEN?: string;
	// IDR per 1 USD for revenue conversion (default 16000)
	FX_USD_IDR?: string;
	// Site id that receives a `signup` conversion for every new account (unset = off)
	REVKLIK_SELF_SITE_ID?: string;
};

export type Env = { Bindings: Bindings; Variables: Variables };
