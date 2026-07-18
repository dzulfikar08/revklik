#!/usr/bin/env bun
/**
 * Seed klikapa D1 with realistic fake analytics data.
 * Generates ~150 pageviews/day across 7 days for the KlikApa site.
 *
 * Usage: bun run seed.ts [--remote]
 */

const SITE_ID = "92f66934-e8d8-40ca-8058-3f8b4d899697";

// --- Data pools ---
const PATHS = [
	"/",
	"/features",
	"/pricing",
	"/blog",
	"/blog/analytics-tanpa-cookie.html",
	"/blog/funnel-konversi.html",
	"/docs",
	"/docs/setup",
	"/about",
];
const PAGES_WEIGHTS = [35, 18, 14, 10, 6, 5, 4, 4, 4]; // distribution %

const COUNTRIES: {
	country: string;
	region: string;
	city: string;
	weight: number;
}[] = [
	{ country: "ID", region: "JK", city: "Jakarta", weight: 35 },
	{ country: "ID", region: "JB", city: "Surabaya", weight: 12 },
	{ country: "ID", region: "BT", city: "Bandung", weight: 8 },
	{ country: "ID", region: "BA", city: "Denpasar", weight: 5 },
	{ country: "ID", region: "YO", city: "Yogyakarta", weight: 5 },
	{ country: "MY", region: "14", city: "Kuala Lumpur", weight: 7 },
	{ country: "SG", region: "01", city: "Singapore", weight: 6 },
	{ country: "TH", region: "10", city: "Bangkok", weight: 4 },
	{ country: "PH", region: "00", city: "Manila", weight: 3 },
	{ country: "US", region: "CA", city: "San Francisco", weight: 4 },
	{ country: "US", region: "NY", city: "New York", weight: 3 },
	{ country: "GB", region: "ENG", city: "London", weight: 3 },
	{ country: "DE", region: "BY", city: "Munich", weight: 2 },
	{ country: "JP", region: "13", city: "Tokyo", weight: 3 },
];

const BROWSERS: { name: string; weight: number }[] = [
	{ name: "Chrome", weight: 60 },
	{ name: "Safari", weight: 20 },
	{ name: "Firefox", weight: 10 },
	{ name: "Edge", weight: 8 },
	{ name: "Arc", weight: 2 },
];

const DEVICES: { name: string; weight: number }[] = [
	{ name: "desktop", weight: 55 },
	{ name: "mobile", weight: 40 },
	{ name: "tablet", weight: 5 },
];

const OS_MAP: Record<string, string[]> = {
	desktop: ["macOS", "Windows", "Linux"],
	mobile: ["iOS", "Android"],
	tablet: ["iPadOS", "Android"],
};

const REFERRERS: { source: string; utm?: string; weight: number }[] = [
	{ source: "direct", weight: 30 },
	{ source: "google.com", weight: 25 },
	{ source: "twitter.com", weight: 12, utm: "twitter" },
	{ source: "github.com", weight: 10, utm: "github" },
	{ source: "producthunt.com", weight: 8, utm: "producthunt" },
	{ source: "indiehackers.com", weight: 5, utm: "indiehackers" },
	{ source: "reddit.com", weight: 5, utm: "reddit" },
	{ source: "linkedin.com", weight: 3, utm: "linkedin" },
	{ source: "t.co", weight: 2, utm: "twitter" },
];

const SCROLL_SECTIONS = [
	"hero",
	"features",
	"how-it-works",
	"code-example",
	"pricing",
	"comparison",
	"cta",
];
const SCROLL_DEPTHS = [25, 50, 75, 90];

const NAMES = [
	"Andi Pratama",
	"Budi Santoso",
	"Citra Dewi",
	"Dian Permata",
	"Eka Putri",
	"Fajar Hidayat",
	"Gita Sari",
	"Hendra Wijaya",
	"Indah Lestari",
	"Joko Susilo",
	"Kartini Rahayu",
	"Lukman Hakim",
	"Maya Anggraini",
	"Nadia Fitriani",
	"Oscar Prasetyo",
];
const EMAIL_DOMAINS = [
	"gmail.com",
	"yahoo.com",
	"outlook.com",
	"company.id",
	"startup.co",
];

// --- Helpers ---
function weightedPick<T extends { weight: number }>(
	pool: T[],
): T & { weight: number } {
	const total = pool.reduce((s, x) => s + x.weight, 0);
	let r = Math.random() * total;
	for (const item of pool) {
		r -= item.weight;
		if (r <= 0) return item;
	}
	return pool[pool.length - 1]!;
}

function pickPath(): string {
	const pool = PATHS.map((p, i) => ({ path: p, weight: PAGES_WEIGHTS[i]! }));
	return weightedPick(pool).path;
}

function uid(): string {
	return crypto.randomUUID();
}

function randFrom<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

// --- Generate data ---
const now = new Date();
const DAYS = 7;
const VISITORS_PER_DAY = () => randInt(80, 180);

interface SeedEvent {
	id: string;
	site_id: string;
	session_id: string;
	visitor_id: string;
	timestamp: string;
	event_type: string;
	name: string | null;
	path: string;
	hostname: string | null;
	referrer: string | null;
	utm_source: string | null;
	utm_medium: string | null;
	utm_campaign: string | null;
	utm_term: string | null;
	utm_content: string | null;
	country: string | null;
	region: string | null;
	city: string | null;
	device_type: string | null;
	browser: string | null;
	os: string | null;
	revenue: number | null;
	props: string | null;
}

interface SeedSession {
	id: string;
	site_id: string;
	visitor_id: string;
	started_at: string;
	ended_at: string | null;
	entry_path: string | null;
	exit_path: string | null;
	referrer: string | null;
	utm_source: string | null;
	utm_medium: string | null;
	utm_campaign: string | null;
	country: string | null;
	region: string | null;
	city: string | null;
	device_type: string | null;
	browser: string | null;
	os: string | null;
	page_count: number;
	is_bounce: number;
}

interface SeedVisitor {
	id: string;
	site_id: string;
	visitor_id: string;
	name: string | null;
	email: string | null;
	phone: string | null;
	avatar: string | null;
	first_seen: string;
	last_seen: string;
	country: string | null;
	region: string | null;
	city: string | null;
	device_type: string | null;
	browser: string | null;
	os: string | null;
	total_sessions: number;
	total_pageviews: number;
	total_revenue: number;
	tags: string | null;
	notes: string | null;
}

const allEvents: SeedEvent[] = [];
const allSessions: SeedSession[] = [];
const visitorMap = new Map<
	string,
	{ visitor: SeedVisitor; sessions: number; pageviews: number; revenue: number }
>();

for (let d = 0; d < DAYS; d++) {
	const dayStart = new Date(now);
	dayStart.setDate(dayStart.getDate() - d);
	dayStart.setHours(0, 0, 0, 0);

	const numVisitors = VISITORS_PER_DAY();

	for (let v = 0; v < numVisitors; v++) {
		const geo = weightedPick(COUNTRIES);
		const browser = weightedPick(BROWSERS).name;
		const device = weightedPick(DEVICES).name;
		const os = randFrom(OS_MAP[device]!);
		const ref = weightedPick(REFERRERS);
		const isNewVisitor = Math.random() > 0.3;
		const visitorId =
			isNewVisitor || !visitorMap.size
				? uid()
				: randFrom([...visitorMap.keys()]);

		// Session: 1-6 pageviews
		const numPages = randInt(1, 6);
		const isBounce = numPages === 1 ? 1 : 0;
		const sessionId = uid();

		// Time: random hour in the day, weighted toward business hours
		const hour = Math.random() < 0.7 ? randInt(8, 22) : randInt(0, 7);
		const minute = randInt(0, 59);
		const second = randInt(0, 59);
		const sessionStart = new Date(dayStart);
		sessionStart.setHours(hour, minute, second);

		const paths: string[] = [];
		for (let p = 0; p < numPages; p++) {
			paths.push(p === 0 ? pickPath() : pickPath());
		}

		// Generate events for this session
		let sessionRevenue = 0;
		const sessionEvents: SeedEvent[] = [];

		for (let p = 0; p < numPages; p++) {
			const evTime = new Date(
				sessionStart.getTime() + p * randInt(8000, 45000),
			);

			// Pageview event
			sessionEvents.push({
				id: uid(),
				site_id: SITE_ID,
				session_id: sessionId,
				visitor_id: visitorId,
				timestamp: evTime.toISOString(),
				event_type: "pageview",
				name: null,
				path: paths[p]!,
				hostname: "klikapa-landing.pages.dev",
				referrer: ref.source === "direct" ? null : `https://${ref.source}`,
				utm_source: ref.utm ?? null,
				utm_medium: ref.utm ? "social" : null,
				utm_campaign: null,
				utm_term: null,
				utm_content: null,
				country: geo.country,
				region: geo.region,
				city: geo.city,
				device_type: device,
				browser,
				os,
				revenue: null,
				props: null,
			});

			// Scroll events for landing page
			if (paths[p] === "/") {
				for (const depth of SCROLL_DEPTHS) {
					if (Math.random() < 1 - depth / 120) {
						sessionEvents.push({
							id: uid(),
							site_id: SITE_ID,
							session_id: sessionId,
							visitor_id: visitorId,
							timestamp: new Date(evTime.getTime() + depth * 100).toISOString(),
							event_type: "custom",
							name: "scroll",
							path: "/",
							hostname: null,
							referrer: null,
							utm_source: null,
							utm_medium: null,
							utm_campaign: null,
							utm_term: null,
							utm_content: null,
							country: geo.country,
							region: geo.region,
							city: geo.city,
							device_type: device,
							browser,
							os,
							revenue: null,
							props: JSON.stringify({ depth }),
						});
					}
				}
				for (const section of SCROLL_SECTIONS) {
					if (Math.random() < 0.5) {
						sessionEvents.push({
							id: uid(),
							site_id: SITE_ID,
							session_id: sessionId,
							visitor_id: visitorId,
							timestamp: new Date(
								evTime.getTime() + randInt(2000, 20000),
							).toISOString(),
							event_type: "custom",
							name: "scroll_section",
							path: "/",
							hostname: null,
							referrer: null,
							utm_source: null,
							utm_medium: null,
							utm_campaign: null,
							utm_term: null,
							utm_content: null,
							country: geo.country,
							region: geo.region,
							city: geo.city,
							device_type: device,
							browser,
							os,
							revenue: null,
							props: JSON.stringify({ section }),
						});
					}
				}
			}

			// Click events (20% chance per page)
			if (Math.random() < 0.2) {
				const clickLabels = [
					"Tambahkan Website Saya",
					"Get Started",
					"Mulai Sekarang",
					"Lihat Semua Artikel",
					"EN",
					"ID",
				];
				const clickTags = ["a", "button"];
				sessionEvents.push({
					id: uid(),
					site_id: SITE_ID,
					session_id: sessionId,
					visitor_id: visitorId,
					timestamp: new Date(
						evTime.getTime() + randInt(1000, 10000),
					).toISOString(),
					event_type: "custom",
					name: "click",
					path: paths[p]!,
					hostname: null,
					referrer: null,
					utm_source: null,
					utm_medium: null,
					utm_campaign: null,
					utm_term: null,
					utm_content: null,
					country: geo.country,
					region: geo.region,
					city: geo.city,
					device_type: device,
					browser,
					os,
					revenue: null,
					props: JSON.stringify({
						label: randFrom(clickLabels),
						href: "#",
						tag: randFrom(clickTags),
					}),
				});
			}
		}

		// Conversion event (8% of sessions)
		if (Math.random() < 0.08) {
			const convTime = new Date(sessionStart.getTime() + numPages * 20000);
			const rev = Math.random() < 0.4 ? [4, 12][randInt(0, 1)] : 0;
			sessionRevenue = rev;
			sessionEvents.push({
				id: uid(),
				site_id: SITE_ID,
				session_id: sessionId,
				visitor_id: visitorId,
				timestamp: convTime.toISOString(),
				event_type: "conversion",
				name: "signup",
				path: "/register",
				hostname: null,
				referrer: null,
				utm_source: null,
				utm_medium: null,
				utm_campaign: null,
				utm_term: null,
				utm_content: null,
				country: geo.country,
				region: geo.region,
				city: geo.city,
				device_type: device,
				browser,
				os,
				revenue: rev,
				props: null,
			});
		}

		allEvents.push(...sessionEvents);

		// Session record
		const sessionEnd = new Date(
			sessionStart.getTime() + numPages * 20000 + randInt(5000, 30000),
		);
		allSessions.push({
			id: sessionId,
			site_id: SITE_ID,
			visitor_id: visitorId,
			started_at: sessionStart.toISOString(),
			ended_at: sessionEnd.toISOString(),
			entry_path: paths[0]!,
			exit_path: paths[paths.length - 1]!,
			referrer: ref.source === "direct" ? null : `https://${ref.source}`,
			utm_source: ref.utm ?? null,
			utm_medium: ref.utm ? "social" : null,
			utm_campaign: null,
			country: geo.country,
			region: geo.region,
			city: geo.city,
			device_type: device,
			browser,
			os,
			page_count: numPages,
			is_bounce: isBounce,
		});

		// Visitor profile
		const existing = visitorMap.get(visitorId);
		const isIdentified = Math.random() < 0.12;
		const name = isIdentified ? randFrom(NAMES) : null;
		const email = isIdentified
			? `${name?.toLowerCase().replace(" ", ".")}@${randFrom(EMAIL_DOMAINS)}`
			: null;

		if (existing) {
			existing.sessions += 1;
			existing.pageviews += numPages;
			existing.revenue += sessionRevenue;
			existing.visitor.last_seen = sessionStart.toISOString();
			if (isIdentified) {
				existing.visitor.name = name;
				existing.visitor.email = email;
			}
		} else {
			visitorMap.set(visitorId, {
				visitor: {
					id: uid(),
					site_id: SITE_ID,
					visitor_id: visitorId,
					name,
					email,
					phone: null,
					avatar: null,
					first_seen: sessionStart.toISOString(),
					last_seen: sessionStart.toISOString(),
					country: geo.country,
					region: geo.region,
					city: geo.city,
					device_type: device,
					browser,
					os,
					total_sessions: 1,
					total_pageviews: numPages,
					total_revenue: sessionRevenue,
					tags: null,
					notes: null,
				},
				sessions: 1,
				pageviews: numPages,
				revenue: sessionRevenue,
			});
		}
	}
}

// Update visitor aggregates
const allVisitors: SeedVisitor[] = [];
for (const { visitor, sessions, pageviews, revenue } of visitorMap.values()) {
	visitor.total_sessions = sessions;
	visitor.total_pageviews = pageviews;
	visitor.total_revenue = revenue;
	allVisitors.push(visitor);
}

// --- Output SQL via wrangler ---
async function seed(remote: boolean) {
	const flag = remote ? "--remote" : "--local";
	const _cmd = (sql: string) =>
		`npx wrangler d1 execute klikapa-db ${flag} --command "${sql.replace(/"/g, '\\"')}"`;

	console.log(
		`Seeding ${allEvents.length} events, ${allSessions.length} sessions, ${allVisitors.length} visitors...`,
	);

	// Clear existing data for this site
	console.log("Clearing existing data...");
	await Bun.$`npx wrangler d1 execute klikapa-db ${flag} --command "DELETE FROM events WHERE site_id = '${SITE_ID}'"`.quiet();
	await Bun.$`npx wrangler d1 execute klikapa-db ${flag} --command "DELETE FROM sessions WHERE site_id = '${SITE_ID}'"`.quiet();
	await Bun.$`npx wrangler d1 execute klikapa-db ${flag} --command "DELETE FROM visitor_profiles WHERE site_id = '${SITE_ID}'"`.quiet();

	// Batch insert using SQL file
	console.log("Generating SQL file...");
	const lines: string[] = [];

	// Visitors
	for (const v of allVisitors) {
		lines.push(
			`INSERT OR IGNORE INTO visitor_profiles (id,site_id,visitor_id,name,email,phone,avatar,first_seen,last_seen,country,region,city,device_type,browser,os,total_sessions,total_pageviews,total_revenue,tags,notes) VALUES ('${v.id}','${v.site_id}','${v.visitor_id}',${v.name ? `'${v.name}'` : "NULL"},${v.email ? `'${v.email}'` : "NULL"},NULL,NULL,'${v.first_seen}','${v.last_seen}',${v.country ? `'${v.country}'` : "NULL"},${v.region ? `'${v.region}'` : "NULL"},${v.city ? `'${v.city}'` : "NULL"},${v.device_type ? `'${v.device_type}'` : "NULL"},${v.browser ? `'${v.browser}'` : "NULL"},${v.os ? `'${v.os}'` : "NULL"},${v.total_sessions},${v.total_pageviews},${v.total_revenue},NULL,NULL);`,
		);
	}

	// Sessions
	for (const s of allSessions) {
		lines.push(
			`INSERT INTO sessions (id,site_id,visitor_id,started_at,ended_at,entry_path,exit_path,referrer,utm_source,utm_medium,utm_campaign,country,region,city,device_type,browser,os,page_count,is_bounce) VALUES ('${s.id}','${s.site_id}','${s.visitor_id}','${s.started_at}',${s.ended_at ? `'${s.ended_at}'` : "NULL"},${s.entry_path ? `'${s.entry_path}'` : "NULL"},${s.exit_path ? `'${s.exit_path}'` : "NULL"},${s.referrer ? `'${s.referrer}'` : "NULL"},${s.utm_source ? `'${s.utm_source}'` : "NULL"},${s.utm_medium ? `'${s.utm_medium}'` : "NULL"},${s.utm_campaign ? `'${s.utm_campaign}'` : "NULL"},${s.country ? `'${s.country}'` : "NULL"},${s.region ? `'${s.region}'` : "NULL"},${s.city ? `'${s.city}'` : "NULL"},${s.device_type ? `'${s.device_type}'` : "NULL"},${s.browser ? `'${s.browser}'` : "NULL"},${s.os ? `'${s.os}'` : "NULL"},${s.page_count},${s.is_bounce});`,
		);
	}

	// Events — split into small chunks to avoid D1 upload limits
	const BATCH = 50;
	for (let i = 0; i < allEvents.length; i += BATCH) {
		const chunk = allEvents.slice(i, i + BATCH);
		const file = `/tmp/klikapa-seed-ev-${Math.floor(i / BATCH)}.sql`;
		const sqlLines = chunk.map(
			(e) =>
				`INSERT INTO events (id,site_id,session_id,visitor_id,timestamp,event_type,name,path,hostname,referrer,utm_source,utm_medium,utm_campaign,utm_term,utm_content,country,region,city,device_type,browser,os,revenue,props) VALUES ('${e.id}','${e.site_id}','${e.session_id}','${e.visitor_id}','${e.timestamp}','${e.event_type}',${e.name ? `'${e.name}'` : "NULL"},'${e.path}',${e.hostname ? `'${e.hostname}'` : "NULL"},${e.referrer ? `'${e.referrer}'` : "NULL"},${e.utm_source ? `'${e.utm_source}'` : "NULL"},${e.utm_medium ? `'${e.utm_medium}'` : "NULL"},${e.utm_campaign ? `'${e.utm_campaign}'` : "NULL"},NULL,NULL,${e.country ? `'${e.country}'` : "NULL"},${e.region ? `'${e.region}'` : "NULL"},${e.city ? `'${e.city}'` : "NULL"},${e.device_type ? `'${e.device_type}'` : "NULL"},${e.browser ? `'${e.browser}'` : "NULL"},${e.os ? `'${e.os}'` : "NULL"},${e.revenue ?? "NULL"},${e.props ? `'${e.props.replace(/'/g, "''")}'` : "NULL"});`,
		);
		await Bun.write(file, sqlLines.join("\n"));

		const batchNum = Math.floor(i / BATCH) + 1;
		const totalBatches = Math.ceil(allEvents.length / BATCH);
		console.log(`Events batch ${batchNum}/${totalBatches}...`);
		for (let retry = 0; retry < 3; retry++) {
			try {
				await Bun.$`npx wrangler d1 execute klikapa-db ${flag} --file ${file}`.quiet();
				break;
			} catch {
				if (retry < 2) {
					console.log(`  Retry ${retry + 1}...`);
					await new Promise((r) => setTimeout(r, 2000));
				} else console.log(`  Skipped batch ${batchNum} after 3 failures`);
			}
		}
	}

	console.log(`\nDone! Seeded:`);
	console.log(`  ${allVisitors.length} visitors`);
	console.log(`  ${allSessions.length} sessions`);
	console.log(`  ${allEvents.length} events`);
	console.log(
		`  ${allEvents.filter((e) => e.event_type === "pageview").length} pageviews`,
	);
	console.log(
		`  ${allEvents.filter((e) => e.event_type === "conversion").length} conversions`,
	);
	console.log(
		`  $${allVisitors.reduce((s, v) => s + v.total_revenue, 0)} total revenue`,
	);
}

const remote = process.argv.includes("--remote");
seed(remote).catch(console.error);
