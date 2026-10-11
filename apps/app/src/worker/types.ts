import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import type { EmailBinding } from "./lib/email";

export type Variables = { db: Kysely<KlikapaDatabase>; userId: string };

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
	// IDR per 1 USD for revenue conversion (default 16000)
	FX_USD_IDR?: string;
};

export type Env = { Bindings: Bindings; Variables: Variables };
