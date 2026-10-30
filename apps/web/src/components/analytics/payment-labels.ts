/** Human-readable names for the `payment_method` / `payment_provider` values events carry. */

const METHOD_LABELS: Record<string, string> = {
	bank_transfer: "Bank transfer",
	card: "Card",
	cash: "Cash",
	cod: "Cash on delivery",
	credit_card: "Card",
	dana: "DANA",
	debit_card: "Card",
	ewallet: "E-wallet",
	e_wallet: "E-wallet",
	gopay: "GoPay",
	linkaja: "LinkAja",
	ovo: "OVO",
	paylater: "Paylater",
	qris: "QRIS",
	shopeepay: "ShopeePay",
	va: "Virtual account",
	virtual_account: "Virtual account",
};

const PROVIDER_LABELS: Record<string, string> = {
	app_store_sales_report: "App Store",
	apple: "App Store",
	doku: "DOKU",
	google_play: "Google Play",
	lemonsqueezy: "Lemon Squeezy",
	mayar: "Mayar",
	midtrans: "Midtrans",
	pakasir: "Pakasir",
	paymay: "Paymay",
	paypal: "PayPal",
	paywuz: "Paywuz",
	polar: "Polar",
	polar_import: "Polar",
	stripe: "Stripe",
	xendit: "Xendit",
};

const norm = (v: string): string =>
	v
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");

export const paymentMethodLabel = (method: string): string => METHOD_LABELS[norm(method)] ?? method;

export const paymentProviderLabel = (provider: string): string =>
	PROVIDER_LABELS[norm(provider)] ?? provider;

const RAIL_LABELS: Record<string, string> = {
	apple: "App Store",
	google_play: "Google Play",
	other: "Other",
};

/** Name for a canonical revenue rail: store rails first, then the payment providers. */
export const railLabel = (rail: string): string => {
	const key = norm(rail);
	return RAIL_LABELS[key] ?? PROVIDER_LABELS[key] ?? rail;
};
