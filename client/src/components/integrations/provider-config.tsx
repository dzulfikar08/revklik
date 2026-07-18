import type { IntegrationType } from "shared";

export const PAYMENT_PROVIDERS = [
	"midtrans",
	"xendit",
	"doku",
	"nicepay",
	"stripe",
	"lemonsqueezy",
];
export const MARKETPLACE_PROVIDERS = ["shopee", "tokopedia"];

export const PROVIDERS: {
	type: IntegrationType;
	name: string;
	icon: string;
	description: string;
	fields: {
		key: string;
		label: string;
		placeholder: string;
		secret?: boolean;
	}[];
}[] = [
	{
		type: "mailchimp",
		name: "Mailchimp",
		icon: "M",
		description: "Sync subscriber data and track email engagement",
		fields: [
			{
				key: "api_key",
				label: "API Key",
				placeholder: "your-mailchimp-api-key",
				secret: true,
			},
			{ key: "dc", label: "Server Prefix", placeholder: "us1" },
		],
	},
	{
		type: "convertkit",
		name: "ConvertKit",
		icon: "C",
		description: "Connect your ConvertKit audience data",
		fields: [
			{
				key: "api_key",
				label: "API Key",
				placeholder: "your-convertkit-api-key",
				secret: true,
			},
		],
	},
	{
		type: "kit",
		name: "Kit",
		icon: "K",
		description: "Sync with Kit (formerly ConvertKit) v3 API",
		fields: [
			{
				key: "api_key",
				label: "API Key",
				placeholder: "your-kit-api-key",
				secret: true,
			},
		],
	},
	{
		type: "beehiiv",
		name: "Beehiiv",
		icon: "B",
		description: "Track newsletter subscriber activity",
		fields: [
			{
				key: "api_key",
				label: "API Key",
				placeholder: "your-beehiiv-api-key",
				secret: true,
			},
			{
				key: "publication_id",
				label: "Publication ID",
				placeholder: "pub_...",
			},
		],
	},
	{
		type: "meta_ads",
		name: "Meta Ads",
		icon: "F",
		description: "Import ad performance and conversion data",
		fields: [
			{
				key: "access_token",
				label: "Access Token",
				placeholder: "your-meta-access-token",
				secret: true,
			},
			{ key: "pixel_id", label: "Pixel ID", placeholder: "123456789" },
		],
	},
	{
		type: "google_ads",
		name: "Google Ads",
		icon: "G",
		description: "Link Google Ads campaign data",
		fields: [
			{ key: "client_id", label: "Client ID", placeholder: "your-client-id" },
			{
				key: "client_secret",
				label: "Client Secret",
				placeholder: "your-client-secret",
				secret: true,
			},
			{
				key: "refresh_token",
				label: "Refresh Token",
				placeholder: "your-refresh-token",
				secret: true,
			},
			{ key: "customer_id", label: "Customer ID", placeholder: "123-456-7890" },
		],
	},
	{
		type: "google_search_console",
		name: "Google Search Console",
		icon: "\uD83D\uDD0D",
		description: "Import search query performance data from Google",
		fields: [],
	},
	{
		type: "shopee",
		name: "Shopee",
		icon: "\uD83D\uDED2",
		description: "Indonesian e-commerce marketplace",
		fields: [],
	},
	{
		type: "tokopedia",
		name: "Tokopedia",
		icon: "\uD83D\uDECD",
		description: "Indonesian e-commerce marketplace",
		fields: [],
	},
	{
		type: "midtrans",
		name: "Midtrans",
		icon: "\uD83D\uDCB3",
		description:
			"Indonesian payment gateway \u2014 GoPay, QRIS, bank transfer, credit card, ShopeePay",
		fields: [
			{
				key: "server_key",
				label: "Server Key",
				placeholder: "SB-Mid-server-...",
				secret: true,
			},
			{
				key: "client_key",
				label: "Client Key",
				placeholder: "SB-Mid-client-...",
				secret: true,
			},
			{ key: "is_production", label: "Production Mode", placeholder: "false" },
		],
	},
	{
		type: "xendit",
		name: "Xendit",
		icon: "\uD83D\uDCB3",
		description:
			"Southeast Asian payment gateway \u2014 OVO, DANA, ShopeePay, virtual accounts",
		fields: [
			{
				key: "secret_key",
				label: "Secret API Key",
				placeholder: "xnd_development_...",
				secret: true,
			},
			{
				key: "webhook_secret",
				label: "Webhook Secret (x-callback-token)",
				placeholder: "your-callback-token",
				secret: true,
			},
		],
	},
	{
		type: "doku",
		name: "DOKU",
		icon: "\uD83D\uDCB3",
		description:
			"Indonesian payment gateway \u2014 SNAP standard, virtual accounts, e-wallets",
		fields: [
			{
				key: "client_id",
				label: "Client ID",
				placeholder: "your-doku-client-id",
			},
			{
				key: "secret_key",
				label: "Secret Key",
				placeholder: "your-doku-secret-key",
				secret: true,
			},
		],
	},
	{
		type: "nicepay",
		name: "NICEPAY",
		icon: "\uD83D\uDCB3",
		description:
			"Indonesian payment gateway \u2014 e-wallets, QRIS, virtual accounts, paylater",
		fields: [
			{
				key: "client_id",
				label: "Client ID",
				placeholder: "your-nicepay-client-id",
			},
			{
				key: "secret_key",
				label: "Secret Key",
				placeholder: "your-nicepay-secret-key",
				secret: true,
			},
		],
	},
	{
		type: "stripe",
		name: "Stripe",
		icon: "S",
		description:
			"Global payments \u2014 cards, wallets, bank debits, subscriptions",
		fields: [
			{
				key: "webhook_secret",
				label: "Webhook Signing Secret",
				placeholder: "whsec_...",
				secret: true,
			},
		],
	},
	{
		type: "lemonsqueezy",
		name: "LemonSqueezy",
		icon: "L",
		description: "Digital products and SaaS billing platform",
		fields: [
			{
				key: "webhook_secret",
				label: "Webhook Secret",
				placeholder: "your-webhook-secret",
				secret: true,
			},
		],
	},
];

export const WEBHOOK_PATHS: Record<string, string> = {
	midtrans: "/api/webhooks/midtrans",
	xendit: "/api/webhooks/xendit",
	doku: "/api/webhooks/doku",
	nicepay: "/api/webhooks/nicepay",
	stripe: "/api/webhooks/stripe",
	lemonsqueezy: "/api/webhooks/lemonsqueezy",
};
