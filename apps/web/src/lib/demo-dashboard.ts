import { useEffect, useState } from "react";

import type { RangeKey } from "@/components/analytics/data";
import type {
	ChannelRow,
	DeviceRow,
	LiveState,
	PublicPayload,
	SourceRow,
} from "@/components/analytics/public-dashboard";

/**
 * Deterministic fixture behind /demo: a made-up Indonesian online shop,
 * "Toko Kopi Senja" (tokokopisenja.id), in the exact payload shape the public
 * dashboard API returns. Nothing here is a real customer's data.
 *
 * Every number derives from one per-day model seeded by the calendar day, so
 * the same day always yields the same figures, a shorter range is a suffix of
 * a longer one, and every breakdown sums exactly to its total.
 */

const DAY_MS = 86_400_000;
const CURRENCY = "IDR";
const SITE = { domain: "tokokopisenja.id", name: "Toko Kopi Senja" } as const;

/* --------------------------------- seeding --------------------------------- */

const FNV_PRIME = 16_777_619;
const FNV_OFFSET = 2_166_136_261;

const hash = (parts: readonly (string | number)[]): number => {
	let h = FNV_OFFSET;
	for (const part of parts) {
		for (const ch of String(part)) {
			h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), FNV_PRIME);
		}
		h = Math.imul(h ^ 0x2c, FNV_PRIME);
	}
	return h >>> 0;
};

/** Uniform [0, 1) from a seed made of any mix of strings and numbers (mulberry32). */
const rand = (...parts: (string | number)[]): number => {
	let t = (hash(parts) + 0x6d_2b_79_f5) >>> 0;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

/** Split an integer `total` across `weights`, largest remainder first: parts sum to `total`. */
const allocate = (total: number, weights: readonly number[]): number[] => {
	const sum = weights.reduce((a, b) => a + b, 0);
	if (sum <= 0 || total <= 0) return weights.map(() => 0);
	const raw = weights.map((w) => (total * w) / sum);
	const parts = raw.map(Math.floor);
	let rest = total - parts.reduce((a, b) => a + b, 0);
	const order = raw
		.map((r, i) => ({ frac: r - Math.floor(r), i }))
		.sort((a, b) => b.frac - a.frac || a.i - b.i);
	for (const { i } of order) {
		if (rest <= 0) break;
		parts[i] += 1;
		rest -= 1;
	}
	return parts;
};

/* ------------------------------- per-day model ------------------------------ */

interface Bucket {
	visits: number;
	pageviews: number;
	sessions: number;
	orders: number;
	revenue: number;
}

interface Day extends Bucket {
	/** Average order value, a whole multiple of Rp 1.000. */
	aov: number;
}

const WEEKDAY_FACTOR = [1.06, 0.92, 0.95, 0.97, 1, 1.12, 1.08] as const;
const BASE_DAILY_VISITS = 640;
/** Daily growth, so a 90-day chart climbs about 20%. */
const DAILY_TREND = 0.0022;
const PAYDAY_FROM = 25;

const dayModel = (dayN: number, todayN: number): Day => {
	const date = new Date(dayN * DAY_MS);
	const dom = date.getUTCDate();
	const weekday = WEEKDAY_FACTOR[date.getUTCDay()] ?? 1;
	const payday = dom >= PAYDAY_FROM || dom === 1 ? 1.12 : 1;
	const campaign = rand("campaign", dayN) < 0.05 ? 1.45 : 1;
	const trend = 1 + DAILY_TREND * (dayN - todayN);
	const noise = 0.88 + 0.24 * rand("visits", dayN);

	const visits = Math.round(BASE_DAILY_VISITS * weekday * payday * campaign * trend * noise);
	const pageviews = Math.round(visits * (2.7 + 0.5 * rand("pv", dayN)));
	const sessions = Math.round(visits * (1.14 + 0.06 * rand("sessions", dayN)));
	const conversion = (0.017 + 0.007 * rand("conv", dayN)) * (payday > 1 ? 1.1 : 1);
	const orders = Math.round(sessions * conversion);
	const aov = Math.round(160 + 70 * rand("aov", dayN)) * 1000;
	return { aov, orders, pageviews, revenue: orders * aov, sessions, visits };
};

/** Share of a day's traffic per local hour: night trough, lunch and evening peaks. */
const HOUR_PROFILE = [
	1.2, 0.8, 0.5, 0.4, 0.4, 0.7, 1.4, 2.6, 3.8, 4.6, 5.2, 5.8, 6.2, 5.4, 5, 5.2, 5.4, 5.6, 6, 6.8,
	7.4, 6.6, 4.4, 2.4,
] as const;
const HOUR_PROFILE_SUM = HOUR_PROFILE.reduce((a, b) => a + b, 0);

const hourModel = (day: Day, dayN: number, hour: number): Bucket => {
	const share = (HOUR_PROFILE[hour] ?? 0) / HOUR_PROFILE_SUM;
	const noise = 0.85 + 0.3 * rand("hour", dayN, hour);
	const scale = share * noise;
	const orders = Math.round(day.orders * scale);
	return {
		orders,
		pageviews: Math.round(day.pageviews * scale),
		revenue: orders * day.aov,
		sessions: Math.round(day.sessions * scale),
		visits: Math.round(day.visits * scale),
	};
};

/* ------------------------------- breakdown tables --------------------------- */

interface WeightedLabel {
	label: string;
	weight: number;
}

/** Visitors per source and how well each converts relative to the average. */
const SOURCES: readonly (WeightedLabel & { convMult: number; aovMult: number; channel: string })[] =
	[
		{ aovMult: 1, channel: "Organic Search", convMult: 1.15, label: "google", weight: 31 },
		{ aovMult: 0.92, channel: "Social Media", convMult: 0.85, label: "instagram", weight: 22 },
		{ aovMult: 1.12, channel: "Referral", convMult: 1.9, label: "whatsapp", weight: 15 },
		{ aovMult: 1.05, channel: "Direct", convMult: 1.3, label: "direct", weight: 13 },
		{ aovMult: 0.78, channel: "Social Media", convMult: 0.55, label: "tiktok", weight: 9 },
		{ aovMult: 0.9, channel: "Social Media", convMult: 0.6, label: "facebook", weight: 4 },
		{ aovMult: 1.2, channel: "Referral", convMult: 1.4, label: "chatgpt", weight: 3.5 },
		{ aovMult: 0.85, channel: "Social Media", convMult: 0.7, label: "youtube", weight: 2.5 },
	];

const COUNTRIES: readonly WeightedLabel[] = [
	{ label: "ID", weight: 96.4 },
	{ label: "SG", weight: 1.5 },
	{ label: "MY", weight: 1 },
	{ label: "AU", weight: 0.6 },
	{ label: "JP", weight: 0.5 },
];

/** Indonesian checkout mix: QRIS leads, then virtual accounts, e-wallets and cards. */
const PAYMENT_METHODS: readonly WeightedLabel[] = [
	{ label: "qris", weight: 41 },
	{ label: "virtual_account", weight: 26 },
	{ label: "ewallet", weight: 19 },
	{ label: "credit_card", weight: 10 },
	{ label: "bank_transfer", weight: 4 },
];

const PAYMENT_PROVIDERS: readonly WeightedLabel[] = [
	{ label: "midtrans", weight: 44 },
	{ label: "xendit", weight: 31 },
	{ label: "doku", weight: 15 },
	{ label: "mayar", weight: 10 },
];

const DEVICES: readonly WeightedLabel[] = [
	{ label: "mobile", weight: 75.5 },
	{ label: "desktop", weight: 21.5 },
	{ label: "tablet", weight: 3 },
];

const OPERATING_SYSTEMS: readonly WeightedLabel[] = [
	{ label: "Android", weight: 52 },
	{ label: "iOS", weight: 26.5 },
	{ label: "Windows", weight: 14 },
	{ label: "macOS", weight: 5.5 },
	{ label: "Linux", weight: 2 },
];

const BROWSERS: readonly WeightedLabel[] = [
	{ label: "Chrome", weight: 58 },
	{ label: "Safari", weight: 21 },
	{ label: "Samsung Internet", weight: 8 },
	{ label: "Edge", weight: 4.5 },
	{ label: "Opera", weight: 3.5 },
	{ label: "Firefox", weight: 2.5 },
	{ label: "Other", weight: 2.5 },
];

/** Share of all pageviews; the rest is the long tail the top-10 list leaves out. */
const PAGES: readonly WeightedLabel[] = [
	{ label: "/", weight: 17 },
	{ label: "/koleksi/biji-kopi", weight: 8.4 },
	{ label: "/produk/kopi-arabika-gayo", weight: 9.5 },
	{ label: "/keranjang", weight: 7.2 },
	{ label: "/produk/kopi-robusta-temanggung", weight: 6.8 },
	{ label: "/produk/paket-cold-brew", weight: 5.9 },
	{ label: "/blog/cara-seduh-v60", weight: 4.6 },
	{ label: "/koleksi/alat-seduh", weight: 4.4 },
	{ label: "/checkout", weight: 4.1 },
	{ label: "/produk/drip-bag-isi-10", weight: 3.7 },
];
const PAGES_SHARE_OF_ALL = 71.6;

/** Visitors with a jittered share per label, biggest first; parts sum to `total`. */
const splitTotal = (
	total: number,
	rows: readonly WeightedLabel[],
	salt: string,
): { label: string; value: number }[] => {
	const weights = rows.map((r) => r.weight * (0.94 + 0.12 * rand(salt, r.label)));
	return allocate(total, weights)
		.map((value, i) => ({ label: rows[i]?.label ?? "", value }))
		.sort((a, b) => b.value - a.value);
};

const toDeviceRows = (rows: { label: string; value: number }[], total: number): DeviceRow[] =>
	rows.map((r) => ({
		device: r.label,
		percentage: total > 0 ? Math.round((r.value / total) * 100) : 0,
		visitors: r.value,
	}));

/* ---------------------------------- payload --------------------------------- */

/** Unique visitors are fewer than the sum of daily visitors; longer ranges overlap more. */
const UNIQUE_FACTOR: Record<RangeKey, number> = {
	"24h": 0.97,
	"30d": 0.86,
	"7d": 0.94,
	"90d": 0.76,
};
const BOUNCE_RATE: Record<RangeKey, number> = { "24h": 52.4, "30d": 51.6, "7d": 50.8, "90d": 52.1 };
const AVG_DURATION_SECONDS = 138;
const RANGE_DAYS: Record<Exclude<RangeKey, "24h">, number> = { "30d": 30, "7d": 7, "90d": 90 };
const HOURS_IN_DAY = 24;

const pad2 = (n: number): string => String(n).padStart(2, "0");
const dayKey = (dayN: number): string => new Date(dayN * DAY_MS).toISOString().slice(0, 10);

/** Time buckets for a range, oldest first, ending at the viewer's current day or hour. */
const bucketsFor = (range: RangeKey, now: Date): { key: string; data: Bucket }[] => {
	const todayN = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);

	if (range === "24h") {
		const lastHour = todayN * HOURS_IN_DAY + now.getHours();
		const out: { key: string; data: Bucket }[] = [];
		for (let i = HOURS_IN_DAY - 1; i >= 0; i -= 1) {
			const idx = lastHour - i;
			const dayN = Math.floor(idx / HOURS_IN_DAY);
			const hour = idx - dayN * HOURS_IN_DAY;
			out.push({
				data: hourModel(dayModel(dayN, todayN), dayN, hour),
				key: `${dayKey(dayN)}T${pad2(hour)}:00:00`,
			});
		}
		return out;
	}

	const days = RANGE_DAYS[range];
	const out: { key: string; data: Bucket }[] = [];
	for (let dayN = todayN - days + 1; dayN <= todayN; dayN += 1) {
		out.push({ data: dayModel(dayN, todayN), key: dayKey(dayN) });
	}
	return out;
};

const sum = (buckets: readonly Bucket[], field: keyof Bucket): number =>
	buckets.reduce((acc, b) => acc + b[field], 0);

/** The public-dashboard payload for `range`, as of `now`. Same inputs, same output. */
export const buildDemoPayload = (range: RangeKey, now: Date): PublicPayload => {
	const buckets = bucketsFor(range, now);
	const data = buckets.map((b) => b.data);

	const visitors = Math.round(sum(data, "visits") * UNIQUE_FACTOR[range]);
	const pageviews = sum(data, "pageviews");
	const sessions = sum(data, "sessions");
	const orders = sum(data, "orders");
	const revenue = sum(data, "revenue");

	// Sources: visitors, then conversions and revenue weighted by how each converts.
	const sourceVisitors = allocate(
		visitors,
		SOURCES.map((s) => s.weight * (0.94 + 0.12 * rand(range, "source", s.label))),
	);
	const sourceOrders = allocate(
		orders,
		SOURCES.map(
			(s, i) => (sourceVisitors[i] ?? 0) * s.convMult * (0.9 + 0.2 * rand(range, "conv", s.label)),
		),
	);
	const sourceRevenue = allocate(
		revenue / 1000,
		SOURCES.map((s, i) => (sourceOrders[i] ?? 0) * s.aovMult),
	).map((units) => units * 1000);

	const sources: SourceRow[] = SOURCES.map((s, i) => ({
		percentage: visitors > 0 ? Math.round(((sourceVisitors[i] ?? 0) / visitors) * 100) : 0,
		source: s.label,
		visitors: sourceVisitors[i] ?? 0,
	})).sort((a, b) => b.visitors - a.visitors);

	const revenueBySource = SOURCES.map((s, i) => ({
		conversions: sourceOrders[i] ?? 0,
		revenue: sourceRevenue[i] ?? 0,
		source: s.label,
	}))
		.filter((r) => r.conversions > 0)
		.sort((a, b) => b.revenue - a.revenue);

	// Channels roll the same sources up, so both tabs agree.
	const channelNames = [...new Set(SOURCES.map((s) => s.channel))];
	const channelVisitors = channelNames.map((name) =>
		SOURCES.reduce((acc, s, i) => acc + (s.channel === name ? (sourceVisitors[i] ?? 0) : 0), 0),
	);
	const channelPageviews = allocate(
		pageviews,
		channelNames.map(
			(name, i) => (channelVisitors[i] ?? 0) * (0.92 + 0.16 * rand(range, "cpv", name)),
		),
	);
	const channels: ChannelRow[] = channelNames
		.map((name, i) => ({
			channel: name,
			pageviews: channelPageviews[i] ?? 0,
			percentage: visitors > 0 ? Math.round(((channelVisitors[i] ?? 0) / visitors) * 100) : 0,
			revenue: SOURCES.reduce(
				(acc, s, j) => acc + (s.channel === name ? (sourceRevenue[j] ?? 0) : 0),
				0,
			),
			visitors: channelVisitors[i] ?? 0,
		}))
		.sort((a, b) => b.visitors - a.visitors);

	// Revenue by country: orders and revenue split by the same weights.
	const countryWeights = COUNTRIES.map((c) => c.weight);
	const countryOrders = allocate(orders, countryWeights);
	const countryRevenue = allocate(revenue / 1000, countryOrders).map((units) => units * 1000);
	const revenueByCountry = COUNTRIES.map((c, i) => ({
		conversions: countryOrders[i] ?? 0,
		country: c.label,
		revenue: countryRevenue[i] ?? 0,
	}))
		.filter((r) => r.conversions > 0)
		.sort((a, b) => b.revenue - a.revenue);

	// Revenue by payment method / provider: each splits orders, then revenue by orders.
	const splitPayments = (rows: readonly WeightedLabel[], salt: string) => {
		const counts = allocate(
			orders,
			rows.map((r) => r.weight * (0.94 + 0.12 * rand(range, salt, r.label))),
		);
		const revenues = allocate(revenue / 1000, counts).map((units) => units * 1000);
		return rows
			.map((r, i) => ({ count: counts[i] ?? 0, label: r.label, revenue: revenues[i] ?? 0 }))
			.filter((r) => r.count > 0)
			.sort((a, b) => b.revenue - a.revenue);
	};
	const revenueByMethod = splitPayments(PAYMENT_METHODS, "pm").map((r) => ({
		count: r.count,
		method: r.label,
		revenue: r.revenue,
	}));
	const revenueByProvider = splitPayments(PAYMENT_PROVIDERS, "pp").map((r) => ({
		count: r.count,
		provider: r.label,
		revenue: r.revenue,
	}));

	// Top pages: visitors never exceed pageviews or the site's unique visitors.
	const pageViews = allocate(
		Math.round((pageviews * PAGES_SHARE_OF_ALL) / 100),
		PAGES.map((p) => p.weight * (0.94 + 0.12 * rand(range, "page", p.label))),
	);
	const topPages = PAGES.map((p, i) => {
		const views = pageViews[i] ?? 0;
		return {
			pageviews: views,
			path: p.label,
			visitors: Math.min(visitors, Math.round(views * (0.62 + 0.2 * rand(range, "pv", p.label)))),
		};
	}).sort((a, b) => b.pageviews - a.pageviews);

	return {
		currency: CURRENCY,
		dashboard: {
			browsers: toDeviceRows(splitTotal(visitors, BROWSERS, `${range}b`), visitors),
			channels,
			currency: CURRENCY,
			devices: toDeviceRows(splitTotal(visitors, DEVICES, `${range}d`), visitors),
			os: toDeviceRows(splitTotal(visitors, OPERATING_SYSTEMS, `${range}o`), visitors),
			revenueBySource,
			revenueByCountry,
			revenueByMethod,
			revenueByProvider,
			revenueTimeseries: buckets.map((b) => ({
				conversions: b.data.orders,
				date: b.key,
				revenue: b.data.revenue,
			})),
			sources,
			stats: {
				avgDuration: AVG_DURATION_SECONDS,
				bounceRate: BOUNCE_RATE[range],
				conversions: orders,
				pageviews,
				revenue,
				sessions,
				visitors,
			},
			timeseries: buckets.map((b) => ({
				date: b.key,
				pageviews: b.data.pageviews,
				visitors: b.data.visits,
			})),
			topPages,
		},
		site: { domain: SITE.domain, name: SITE.name },
	};
};

/* ---------------------------------- live pill -------------------------------- */

const LIVE_TICK_MS = 15_000;
const LIVE_WAVE_MS = 420_000;

/** Visitors online at `ms`: a slow wave plus small steady jitter, always plausible. */
export const demoOnline = (ms: number): number =>
	Math.round(
		15 + 4 * Math.sin(ms / LIVE_WAVE_MS) + 6 * (rand("live", Math.floor(ms / LIVE_TICK_MS)) - 0.5),
	);

/** Simulated "online now": no network, drifts gently every few seconds. */
export function useDemoLive(): LiveState {
	const [live, setLive] = useState<LiveState>(() => ({
		online: demoOnline(Date.now()),
		updatedAt: new Date().toISOString(),
	}));

	useEffect(() => {
		const id = setInterval(() => {
			setLive({ online: demoOnline(Date.now()), updatedAt: new Date().toISOString() });
		}, LIVE_TICK_MS);
		return () => clearInterval(id);
	}, []);

	return live;
}
