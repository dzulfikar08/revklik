#!/usr/bin/env bun
/**
 * Seed visitors and sessions from existing events data.
 * Run after seed.ts (which seeds events).
 */
const SITE_ID = "92f66934-e8d8-40ca-8058-3f8b4d899697";
const remote = process.argv.includes("--remote");
const flag = remote ? "--remote" : "--local";

async function d1query(sql: string): Promise<Array<Record<string, unknown>>> {
	const p = Bun.spawnSync({
		cmd: ["npx", "wrangler", "d1", "execute", "klikapa-db", flag, "--command", sql, "--json"],
		stdout: "pipe",
		stderr: "pipe",
	});
	const raw = p.stdout.toString();
	try {
		const parsed = JSON.parse(raw);
		// wrangler --json returns array of [{results, success, meta}]
		if (Array.isArray(parsed)) return parsed[0]?.results ?? [];
		return parsed.results ?? [];
	} catch {
		console.log("Parse error. Raw output preview:", raw.slice(0, 200));
		return [];
	}
}

async function seed() {
	console.log("Seeding visitors and sessions from events...");

	const rows = await d1query(
		`SELECT visitor_id, country, region, city, device_type, browser, os, MIN(timestamp) as first_ts, MAX(timestamp) as last_ts, COUNT(CASE WHEN event_type='pageview' THEN 1 END) as pv_count FROM events WHERE site_id='${SITE_ID}' GROUP BY visitor_id, country, region, city, device_type, browser, os ORDER BY last_ts DESC`,
	);
	console.log(`Found ${rows.length} visitor groups`);

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
	const DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "company.id", "startup.co"];

	const revRows = await d1query(
		`SELECT visitor_id, SUM(revenue) as total_rev FROM events WHERE site_id='${SITE_ID}' AND revenue > 0 GROUP BY visitor_id`,
	);
	const visitorRevenue = new Map<string, number>();
	revRows.forEach((r: { visitor_id: string; total_rev: number }) => {
		visitorRevenue.set(r.visitor_id, Number(r.total_rev));
	});

	const visitorLines: string[] = [];
	const visitorIds = new Set<string>();

	for (const row of rows) {
		if (visitorIds.has(row.visitor_id)) continue;
		visitorIds.add(row.visitor_id);

		const isIdentified = Math.random() < 0.12;
		const name = isIdentified ? NAMES[Math.floor(Math.random() * NAMES.length)] : null;
		const email = isIdentified
			? `${name?.toLowerCase().replace(" ", ".")}@${DOMAINS[Math.floor(Math.random() * DOMAINS.length)]}`
			: null;
		const rev = visitorRevenue.get(row.visitor_id) ?? 0;

		visitorLines.push(
			`INSERT OR IGNORE INTO visitor_profiles (id,site_id,visitor_id,name,email,phone,avatar,first_seen,last_seen,country,region,city,device_type,browser,os,total_sessions,total_pageviews,total_revenue,tags,notes) VALUES ('${crypto.randomUUID()}','${SITE_ID}','${row.visitor_id}',${name ? `'${name}'` : "NULL"},${email ? `'${email}'` : "NULL"},NULL,NULL,'${row.first_ts}','${row.last_ts}',${row.country ? `'${row.country}'` : "NULL"},${row.region ? `'${row.region}'` : "NULL"},${row.city ? `'${row.city}'` : "NULL"},${row.device_type ? `'${row.device_type}'` : "NULL"},${row.browser ? `'${row.browser}'` : "NULL"},${row.os ? `'${row.os}'` : "NULL"},1,${row.pv_count},${rev},NULL,NULL);`,
		);
	}

	const sessRows = await d1query(
		`SELECT session_id, visitor_id, country, region, city, device_type, browser, os, MIN(timestamp) as started, MAX(timestamp) as ended, MIN(CASE WHEN event_type='pageview' THEN path END) as entry, MAX(CASE WHEN event_type='pageview' THEN path END) as exitp, COUNT(CASE WHEN event_type='pageview' THEN 1 END) as pcount, MIN(referrer) as ref, MIN(utm_source) as usrc FROM events WHERE site_id='${SITE_ID}' GROUP BY session_id`,
	);
	console.log(`Found ${sessRows.length} sessions`);

	const sessionLines = sessRows.map((s) => {
		const isBounce = Number(s.pcount) <= 1 ? 1 : 0;
		return `INSERT INTO sessions (id,site_id,visitor_id,started_at,ended_at,entry_path,exit_path,referrer,utm_source,utm_medium,utm_campaign,country,region,city,device_type,browser,os,page_count,is_bounce) VALUES ('${s.session_id}','${SITE_ID}','${s.visitor_id}','${s.started}','${s.ended}',${s.entry ? `'${s.entry}'` : "NULL"},${s.exitp ? `'${s.exitp}'` : "NULL"},${s.ref && s.ref !== "" ? `'${s.ref}'` : "NULL"},${s.usrc ? `'${s.usrc}'` : "NULL"},NULL,NULL,${s.country ? `'${s.country}'` : "NULL"},${s.region ? `'${s.region}'` : "NULL"},${s.city ? `'${s.city}'` : "NULL"},${s.device_type ? `'${s.device_type}'` : "NULL"},${s.browser ? `'${s.browser}'` : "NULL"},${s.os ? `'${s.os}'` : "NULL"},${s.pcount},${isBounce});`;
	});

	const BATCH = 100;
	const allLines = [...visitorLines, ...sessionLines];
	for (let i = 0; i < allLines.length; i += BATCH) {
		const chunk = allLines.slice(i, i + BATCH);
		const file = `/tmp/klikapa-seed-vs-${Math.floor(i / BATCH)}.sql`;
		await Bun.write(file, chunk.join("\n"));
		console.log(`Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(allLines.length / BATCH)}...`);
		for (let retry = 0; retry < 3; retry++) {
			try {
				await Bun.$`npx wrangler d1 execute klikapa-db ${flag} --file ${file}`.quiet();
				break;
			} catch {
				if (retry < 2) {
					console.log(`  Retry ${retry + 1}...`);
					await new Promise((r) => setTimeout(r, 2000));
				} else console.log(`  Skipped batch after 3 failures`);
			}
		}
	}

	console.log(`\nDone! Seeded ${visitorLines.length} visitors and ${sessionLines.length} sessions`);
}

seed().catch(console.error);
