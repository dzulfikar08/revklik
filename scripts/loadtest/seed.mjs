const API = process.env.API || "http://localhost:8787";
const TOTAL = Number(process.env.EVENTS || 50000);
const BATCH = Number(process.env.BATCH || 50);
const CONC = Number(process.env.CONC || 20);
const DAYS = Number(process.env.DAYS || 7);
const CONV = Number(process.env.CONV || 0.03);

const PATHS = [
	"/",
	"/products",
	"/products/widget",
	"/pricing",
	"/blog/how-to",
	"/docs",
	"/about",
	"/contact",
	"/cart",
	"/checkout",
];
const REF = [
	"",
	"https://google.com",
	"https://twitter.com",
	"https://t.co",
	"https://facebook.com",
	"https://github.com",
	"https://news.ycombinator.com",
];
const UTM = [
	null,
	{ us: "google", um: "cpc" },
	{ us: "twitter", um: "social" },
	{ us: "newsletter", um: "email" },
];
const DEV = [
	["desktop", "Chrome", "macOS"],
	["mobile", "Safari", "iOS"],
	["desktop", "Firefox", "Linux"],
	["mobile", "Chrome", "Android"],
	["desktop", "Edge", "Windows"],
];
const COUNTRIES = [
	["US", "America/New_York"],
	["ID", "Asia/Jakarta"],
	["GB", "Europe/London"],
	["SG", "Asia/Singapore"],
	["IN", "Asia/Kolkata"],
	["JP", "Asia/Tokyo"],
	["DE", "Europe/Berlin"],
];
// Visitor pool size: lower => more repeats within a batch (exercises the
// visitor-dedup + session-merge paths). 20k visitors over 100k events ~= 5 pv/visitor.
const VISITORS = Number(process.env.VISITORS || 20000);

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const randIp = () => `${1 + rnd(223)}.${rnd(256)}.${rnd(256)}.${1 + rnd(254)}`;
const now = Date.now();
const spanMs = DAYS * 86400000;
// one session per visitor, stable attrs so repeated events share vid+sid+fp.
const POOL = Array.from({ length: VISITORS }, (_, i) => {
	const c = pick(COUNTRIES),
		d = pick(DEV);
	return {
		vid: `seed_v_${i}`,
		sid: `seed_s_${i}`,
		fp: `fp_${i}`,
		c,
		d,
		first: now - rnd(spanMs),
	};
});

function makeEvent(siteId) {
	const v = POOL[rnd(VISITORS)];
	const isConv = Math.random() < CONV;
	const ts = v.first + rnd(3600000); // within 1h of session start
	const ev = {
		s: siteId,
		sid: v.sid,
		vid: v.vid,
		fp: v.fp,
		p: isConv ? "/checkout" : pick(PATHS),
		t: isConv ? "c" : "p",
		ts,
		h: "example.com",
		r: pick(REF),
		tz: v.c[1],
		dv: v.d[0],
		br: v.d[1],
		os: v.d[2],
	};
	const u = pick(UTM);
	if (u) {
		ev.us = u.us;
		ev.um = u.um;
	}
	if (isConv) {
		ev.rv = Math.round((5 + Math.random() * 195) * 100) / 100;
		ev.n = "purchase";
		ev.cur = "USD";
		ev.pp = "stripe";
	}
	ev.c = v.c[0];
	return ev;
}

function req(path, opts = {}) {
	return fetch(`${API}${path}`, opts);
}

async function ensureSite() {
	if (process.env.SITE) return process.env.SITE;
	// register (or login if SUPER email already exists -> super_admin bypasses quota)
	const email = process.env.SUPER
		? "seed@loadtest.local"
		: `seed_${Date.now()}@loadtest.local`;
	const password = "seedpass12345";
	let r = await req("/api/auth/register", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name: "Seed Loadtest", email, password }),
	});
	let body = await r.json();
	let token = body?.data?.token;
	if (!token) {
		// fall back to login (email already registered)
		r = await req("/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password }),
		});
		body = await r.json();
		token = body?.data?.token;
	}
	if (!token) throw new Error(`no token: ${JSON.stringify(body)}`);
	r = await req("/api/sites", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			name: "Loadtest Site",
			domain: "loadtest.example.com",
		}),
	});
	body = await r.json();
	const siteId = body?.data?.id;
	if (!siteId)
		throw new Error(`create site failed ${r.status}: ${JSON.stringify(body)}`);
	console.log(`# registered ${email}`);
	console.log(`# site ${siteId} (token ${token.slice(0, 12)}…)`);
	return siteId;
}

async function worker(siteId, state) {
	while (true) {
		const todo = state.sent.add(BATCH);
		if (todo > TOTAL) return;
		const n = Math.min(BATCH, TOTAL - (todo - BATCH));
		const events = Array.from({ length: n }, () => makeEvent(siteId));
		const t0 = performance.now();
		try {
			const res = await fetch(`${API}/api/track`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-For": randIp(),
				},
				body: JSON.stringify(events),
			});
			const ms = performance.now() - t0;
			state.lat.push(ms);
			if (res.status === 202 || res.status === 200) {
				state.okEvents += n;
			} else {
				state.err++;
				if (state.err <= 5) state.errSamples.push(`${res.status}`);
			}
		} catch (e) {
			state.netErr++;
			if (state.netErr <= 5)
				state.errSamples.push(String(e.message || e).slice(0, 80));
		}
		if (state.sent.get() % (BATCH * 10) === 0) report(state, false);
	}
}

function pct(arr, p) {
	if (!arr.length) return 0;
	const s = [...arr].sort((a, b) => a - b);
	return s[Math.floor(s.length * p) - 1] || s[s.length - 1];
}

let lastReport = 0;
function report(state, final) {
	const sent = state.okEvents;
	const elapsed = (performance.now() - state.t0) / 1000;
	const evps = (sent / elapsed).toFixed(0);
	const lat = state.lat;
	const p50 = pct(lat, 0.5).toFixed(0);
	const p95 = pct(lat, 0.95).toFixed(0);
	const p99 = pct(lat, 0.99).toFixed(0);
	const line = `[${elapsed.toFixed(0)}s] sent=${sent}/${TOTAL} ${evps} ev/s  lat p50=${p50} p95=${p95} p99=${p99}ms  err=${state.err} net=${state.netErr}`;
	if (final) {
		console.log(line);
		console.log(`# errSamples=${JSON.stringify(state.errSamples)}`);
	} else if (performance.now() - lastReport > 2000) {
		console.log(line);
		lastReport = performance.now();
	}
}

const state = {
	sent: {
		v: 0,
		add(n) {
			this.v += n;
			return this.v;
		},
		get() {
			return this.v;
		},
	},
	okEvents: 0,
	err: 0,
	netErr: 0,
	lat: [],
	errSamples: [],
	t0: 0,
};

console.log(
	`# API=${API} events=${TOTAL} batch=${BATCH} conc=${CONC} days=${DAYS} conv=${CONV}`,
);
const siteId = await ensureSite();
state.t0 = performance.now();
const workers = Array.from({ length: CONC }, () => worker(siteId, state));
await Promise.all(workers);
report(state, true);
const elapsed = (performance.now() - state.t0) / 1000;
console.log(
	`# DONE site=${siteId} ${state.okEvents} events in ${elapsed.toFixed(1)}s = ${(state.okEvents / elapsed).toFixed(0)} ev/s`,
);
console.log(
	`# STORAGE_KPI: ${(state.okEvents).toLocaleString()} events -> measure db disk delta via monitor.sh`,
);
