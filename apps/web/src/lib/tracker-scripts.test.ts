import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const SITE_ID = "11111111-2222-4333-8444-555555555555";
const SCRIPT_URL = "https://app.revklik.com/klikapa.js";
const PAGE_URL = "https://shop.example/pricing?utm_source=newsletter";

const sources = import.meta.glob<string>(
	[
		"../../../app/public/klikapa.js",
		"../../../app/public/klikapa-full.js",
		"../../../app/public/klikapa-core.js",
	],
	{ eager: true, query: "?raw", import: "default" },
);
const variants = Object.entries(sources).map(([path, source]) => ({
	name: path.slice(path.lastIndexOf("/") + 1),
	source,
}));

interface TrackerEvent {
	t: string;
	n?: string;
	p?: string;
	s?: string;
	rv?: number | null;
	pr?: Record<string, unknown>;
}

interface TrackerWindow {
	klikapa?: {
		track: (name: string, props?: unknown, revenue?: number) => void;
		getVisitorId: () => string;
		consent?: (granted: boolean) => void;
	};
}

interface LoadOptions {
	/** Attributes on the <script> tag besides data-site-id. */
	attrs?: Record<string, string>;
	/** Properties defined on navigator before the script runs (globalPrivacyControl, doNotTrack). */
	navigatorProps?: Record<string, unknown>;
	/** localStorage entries present before the script runs (a returning visitor). */
	storage?: Record<string, string>;
}

/** Executes the tracker like a browser tag would: currentScript points at the <script> carrying data-site-id. */
function loadTracker(source: string, opts: LoadOptions = {}) {
	const win = new Window({ url: PAGE_URL });
	const requests: Array<{ url: string; via: "fetch" | "sendBeacon"; events: TrackerEvent[] }> = [];
	const errors: unknown[] = [];
	const record = (via: "fetch" | "sendBeacon", url: string, body: unknown) => {
		requests.push({ url, via, events: JSON.parse(String(body)) as TrackerEvent[] });
	};
	Object.assign(win, {
		fetch: (url: string, init?: { body?: unknown }) => {
			record("fetch", String(url), init?.body);
			return Promise.resolve({ ok: false });
		},
	});
	Object.assign(win.navigator, {
		sendBeacon: (url: string, body: unknown) => {
			record("sendBeacon", String(url), body);
			return true;
		},
	});
	win.addEventListener("error", (event) => errors.push(Reflect.get(event, "error") ?? event.type));

	const tag = win.document.createElement("script");
	tag.setAttribute("data-site-id", SITE_ID);
	tag.setAttribute("src", SCRIPT_URL);
	Object.defineProperty(win.document, "currentScript", { value: tag });
	for (const [name, value] of Object.entries(opts.attrs ?? {})) tag.setAttribute(name, value);
	for (const [name, value] of Object.entries(opts.navigatorProps ?? {})) {
		Object.defineProperty(win.navigator, name, { value, configurable: true });
	}
	for (const [key, value] of Object.entries(opts.storage ?? {}))
		win.localStorage.setItem(key, value);

	let thrown: unknown;
	try {
		win.eval(source);
	} catch (err) {
		thrown = err;
	}

	/** Dispatching beforeunload makes the tracker flush its queue immediately instead of waiting 1s. */
	const flush = () => win.dispatchEvent(new win.Event("beforeunload"));
	const sent = () => requests.flatMap((r) => r.events);
	return { win, tag, thrown, errors, requests, flush, sent };
}

describe.each(variants)("tracker script $name", ({ source }) => {
	it("loads without throwing and exposes window.klikapa", () => {
		const { win, thrown, errors } = loadTracker(source);
		expect(thrown).toBeUndefined();
		expect(errors).toEqual([]);
		const api = (win as unknown as TrackerWindow).klikapa;
		expect(typeof api?.track).toBe("function");
		expect(typeof api?.getVisitorId).toBe("function");
		expect(api?.getVisitorId()).toMatch(/\S/);
	});

	it("sends a pageview for the current path with the site id", () => {
		const { requests, flush, sent } = loadTracker(source);
		flush();
		const [request] = requests;
		expect(request?.url).toBe("https://app.revklik.com/api/track");
		const pageviews = sent().filter((e) => e.t === "p");
		expect(pageviews).toHaveLength(1);
		expect(pageviews[0]).toMatchObject({ t: "p", p: "/pricing", s: SITE_ID });
	});

	it("sends custom events through window.klikapa.track", () => {
		const { win, flush, sent } = loadTracker(source);
		(win as unknown as TrackerWindow).klikapa?.track("signup_started", { plan: "pro" }, 9);
		flush();
		expect(sent()).toContainEqual(
			expect.objectContaining({ t: "e", n: "signup_started", s: SITE_ID, rv: 9 }),
		);
	});

	it("fires a conversion when a data-revklik-goal element is clicked", () => {
		const { win, flush, sent } = loadTracker(source);
		const button = win.document.createElement("button");
		button.setAttribute("data-revklik-goal", "checkout");
		button.setAttribute("data-revklik-goal-value", "25");
		button.setAttribute("data-revklik-goal-plan", "pro");
		button.textContent = "Buy";
		win.document.body.appendChild(button);
		button.click();
		flush();
		expect(sent()).toContainEqual(
			expect.objectContaining({
				t: "c",
				n: "checkout",
				p: "/pricing",
				s: SITE_ID,
				rv: 25,
				pr: { plan: "pro" },
			}),
		);
	});

	describe("privacy controls", () => {
		const storedKeys = (win: Window) => [
			...Array.from({ length: win.localStorage.length }, (_, i) => win.localStorage.key(i)),
			...Array.from({ length: win.sessionStorage.length }, (_, i) => win.sessionStorage.key(i)),
		];

		it.each([
			["Global Privacy Control", { globalPrivacyControl: true }],
			["Do Not Track", { doNotTrack: "1" }],
		])("%s stops all tracking and storage", (_name, navigatorProps) => {
			const { win, thrown, flush, requests } = loadTracker(source, { navigatorProps });
			expect(thrown).toBeUndefined();
			const api = (win as unknown as TrackerWindow).klikapa;
			api?.track("signup_started");
			api?.consent?.(true);
			flush();
			expect(requests).toEqual([]);
			expect(storedKeys(win)).toEqual([]);
			expect(api?.getVisitorId()).toBe("");
		});

		it('data-consent="required" stores and sends nothing before consent', () => {
			const { win, flush, requests } = loadTracker(source, {
				attrs: { "data-consent": "required" },
			});
			(win as unknown as TrackerWindow).klikapa?.track("signup_started");
			flush();
			expect(requests).toEqual([]);
			expect(storedKeys(win)).toEqual([]);
		});

		it("consent(true) sends the pageview, stores the ids and remembers the grant", () => {
			const { win, flush, sent } = loadTracker(source, { attrs: { "data-consent": "required" } });
			const api = (win as unknown as TrackerWindow).klikapa;
			api?.consent?.(true);
			flush();
			expect(sent().filter((e) => e.t === "p")).toHaveLength(1);
			expect(win.localStorage.getItem("_kp_consent")).toBe("1");
			expect(win.localStorage.getItem("_kp_vid")).toMatch(/\S/);
			expect(api?.getVisitorId()).toBe(win.localStorage.getItem("_kp_vid") ?? "");
		});

		it("a remembered grant resumes tracking on the next page load", () => {
			const { sent, flush } = loadTracker(source, {
				attrs: { "data-consent": "required" },
				storage: { _kp_consent: "1" },
			});
			flush();
			expect(sent().filter((e) => e.t === "p")).toHaveLength(1);
		});

		it("consent(false) erases the identifiers and stops sending", () => {
			const { win, flush, requests } = loadTracker(source, {
				attrs: { "data-consent": "required" },
				storage: { _kp_consent: "1" },
			});
			const api = (win as unknown as TrackerWindow).klikapa;
			expect(win.localStorage.getItem("_kp_vid")).toMatch(/\S/);
			api?.consent?.(false);
			api?.track("after_withdrawal");
			flush();
			expect(storedKeys(win)).toEqual([]);
			expect(requests).toEqual([]);
		});
	});
});

it("covers every shipped tracker variant", () => {
	expect(variants.map((v) => v.name).sort()).toEqual([
		"klikapa-core.js",
		"klikapa-full.js",
		"klikapa.js",
	]);
});
