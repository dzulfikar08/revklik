/** Currencies whose smallest unit is the currency itself (Stripe's zero-decimal list). */
const ZERO_DECIMAL = new Set([
	"BIF",
	"CLP",
	"DJF",
	"GNF",
	"JPY",
	"KMF",
	"KRW",
	"MGA",
	"PYG",
	"RWF",
	"UGX",
	"VND",
	"VUV",
	"XAF",
	"XOF",
	"XPF",
]);

/** Currencies with three decimals (Stripe's three-decimal list). */
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/** Decimal places of a currency's minor unit. */
export function minorUnitExponent(currency: string): number {
	const code = currency.toUpperCase();
	if (ZERO_DECIMAL.has(code)) return 0;
	return THREE_DECIMAL.has(code) ? 3 : 2;
}

/** Provider amounts quoted in minor units (cents, sen) as major units. */
export function minorToMajor(minor: number, currency: string): number {
	return minor / 10 ** minorUnitExponent(currency);
}

/** A finite number from a number or numeric string; null for anything else. */
export function toNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : null;
}
