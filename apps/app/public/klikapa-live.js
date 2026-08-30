/**
 * Klikapa Live — embeddable live-stats widget.
 * Shows online-now / today / total visitor counts from a site's public feed.
 *
 * Usage (after enabling the widget in RevKlik → Settings → Widget):
 *   <script async src="https://<your-klikapa-host>/klikapa-live.js"
 *           data-widget-token="YOUR_TOKEN"></script>
 *
 * Options:
 *   data-mode     "bubble" (default, floating corner) | "badge" (inline)
 *   data-show     comma subset of "online,today,total" (default: all)
 *   data-position br|bl|tr|tl (bubble mode only, default br)
 *   data-face     bubble mode only: which stat(s) sit on the pill itself,
 *                 comma subset of "online,today,total" (default: "online")
 *
 * Inline badge renders into the element matching [data-klikapa-live-target],
 * otherwise inserts itself where this script tag sits.
 */
((w, d) => {
	const el = d.currentScript;
	if (!el) return;

	// Guard against double-init (duplicated tags, prerendering, SPA re-execution)
	if (w.__klikapaLive) return;
	w.__klikapaLive = true;

	const TOKEN = el.getAttribute("data-widget-token");
	if (!TOKEN) return;

	const MODE = el.getAttribute("data-mode") === "badge" ? "badge" : "bubble";
	const POSITION = el.getAttribute("data-position") || "br";
	const SHOW = (() => {
		const wanted = (el.getAttribute("data-show") || "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const valid = ["online", "today", "total"].filter((k) => wanted.includes(k));
		return valid.length ? valid : ["online", "today", "total"];
	})();
	// Which stat(s) sit on the bubble pill itself — the panel still lists SHOW.
	const FACE = (() => {
		const wanted = (el.getAttribute("data-face") || "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const valid = ["online", "today", "total"].filter((k) => wanted.includes(k));
		return valid.length ? valid : ["online"];
	})();
	const ENDPOINT = `${new URL(el.src).origin}/api/widgets/live/${encodeURIComponent(TOKEN)}`;

	const REFRESH_MS = 30_000;
	const BACKOFF_MAX_MS = 300_000;

	// ---- state ----
	let stats = null; // { online_now, visitors_today, total_visitors }
	let live = true; // false while backing off after errors
	let backoffMs = REFRESH_MS;
	let timer = null;

	function formatCount(n) {
		if (n >= 10_000) {
			try {
				return new Intl.NumberFormat(undefined, {
					notation: "compact",
					maximumFractionDigits: 1,
				}).format(n);
			} catch {
				/* fall through to plain formatting */
			}
		}
		try {
			return n.toLocaleString();
		} catch {
			return String(n);
		}
	}

	function valueFor(key) {
		if (!stats) return "—";
		if (key === "online") return formatCount(stats.online_now);
		if (key === "today") return formatCount(stats.visitors_today);
		return formatCount(stats.total_visitors);
	}

	// ---- styles ----
	function buildStyle() {
		const style = d.createElement("style");
		style.textContent = `
			:host {
				all: initial;
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
				font-size: 13px;
				line-height: 1.4;
				color: #1f2937;
			}
			.dot {
				display: inline-block;
				width: 8px;
				height: 8px;
				border-radius: 50%;
				background: #22c55e;
				margin-right: 6px;
				vertical-align: middle;
			}
			@keyframes kp-live-pulse {
				0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.45); }
				70% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
				100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
			}
			.dot.live { animation: kp-live-pulse 2s infinite; }
			.dot.off { background: #9ca3af; animation: none; }
			.num { font-variant-numeric: tabular-nums; font-weight: 600; }

			.badge {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				padding: 4px 10px;
				border: 1px solid rgba(0, 0, 0, 0.08);
				border-radius: 999px;
				background: rgba(0, 0, 0, 0.03);
				white-space: nowrap;
			}
			.badge .sep, .bubble-btn .sep { opacity: 0.35; }

			.bubble-btn {
				display: flex;
				align-items: center;
				gap: 8px;
				padding: 10px 14px;
				border: 1px solid rgba(0, 0, 0, 0.08);
				border-radius: 999px;
				background: #ffffff;
				box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
				cursor: pointer;
				font: inherit;
				color: inherit;
			}
			.panel {
				position: absolute;
				right: 0;
				bottom: calc(100% + 8px);
				width: 190px;
				padding: 12px 14px;
				border: 1px solid rgba(0, 0, 0, 0.08);
				border-radius: 12px;
				background: #ffffff;
				box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
			}
			.panel .row {
				display: flex;
				justify-content: space-between;
				align-items: baseline;
				padding: 3px 0;
			}
			.panel .label { opacity: 0.6; }
			.panel .brand {
				margin-top: 8px;
				padding-top: 8px;
				border-top: 1px solid rgba(0, 0, 0, 0.06);
				font-size: 11px;
				opacity: 0.55;
			}
			.panel .brand a { color: inherit; text-decoration: none; font-weight: 600; }
			.kp-pos-bl .panel, .kp-pos-tl .panel { right: auto; left: 0; }
			.kp-pos-tr .panel, .kp-pos-tl .panel { bottom: auto; top: calc(100% + 8px); }

			@media (prefers-color-scheme: dark) {
				:host { color: #e5e7eb; }
				.badge { border-color: rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.06); }
				.bubble-btn, .panel {
					border-color: rgba(255, 255, 255, 0.1);
					background: #111827;
					box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
				}
				.panel .brand { border-top-color: rgba(255, 255, 255, 0.08); }
			}
		`;
		return style;
	}

	// ---- rendering (textContent only — never innerHTML) ----
	function makeNumber(key) {
		const span = d.createElement("span");
		span.className = "num";
		span.setAttribute("data-kp-key", key);
		span.textContent = valueFor(key);
		return span;
	}

	function makeDot() {
		const dot = d.createElement("span");
		dot.className = "dot live";
		dot.setAttribute("data-kp-dot", "");
		return dot;
	}

	function renderValues(root) {
		root.querySelectorAll("[data-kp-key]").forEach((node) => {
			node.textContent = valueFor(node.getAttribute("data-kp-key"));
		});
	}

	function buildBadge(shadow) {
		const badge = d.createElement("div");
		badge.className = "badge";
		SHOW.forEach((key, i) => {
			if (i > 0) {
				const sep = d.createElement("span");
				sep.className = "sep";
				sep.textContent = "·";
				badge.appendChild(sep);
			}
			if (key === "online") badge.appendChild(makeDot());
			badge.appendChild(makeNumber(key));
		});
		shadow.appendChild(badge);
	}

	function buildBubble(shadow) {
		const pos = ["br", "bl", "tr", "tl"].includes(POSITION) ? POSITION : "br";
		const posCss = {
			br: "bottom:20px;right:20px;",
			bl: "bottom:20px;left:20px;",
			tr: "top:20px;right:20px;",
			tl: "top:20px;left:20px;",
		};
		const root = d.createElement("div");
		root.className = `kp-pos-${pos}`;
		root.style.cssText = `position:fixed;z-index:2147483000;${posCss[pos]}`;

		const wrap = d.createElement("div");
		wrap.style.cssText = "position:relative;";

		const panel = d.createElement("div");
		panel.className = "panel";
		panel.hidden = true;
		const labels = { online: "Online now", today: "Visitors today", total: "Total visitors" };
		SHOW.forEach((key) => {
			const row = d.createElement("div");
			row.className = "row";
			const label = d.createElement("span");
			label.className = "label";
			label.textContent = labels[key];
			row.appendChild(label);
			row.appendChild(makeNumber(key));
			panel.appendChild(row);
		});
		const brand = d.createElement("div");
		brand.className = "brand";
		brand.append("Powered by ");
		const link = d.createElement("a");
		link.href = "https://revklik.com";
		link.target = "_blank";
		link.rel = "noopener";
		link.textContent = "RevKlik";
		brand.appendChild(link);
		panel.appendChild(brand);

		const btn = d.createElement("button");
		btn.className = "bubble-btn";
		btn.type = "button";
		btn.setAttribute("aria-expanded", "false");
		btn.setAttribute("aria-label", "Visitor stats");
		FACE.forEach((key, i) => {
			if (i > 0) {
				const sep = d.createElement("span");
				sep.className = "sep";
				sep.textContent = "·";
				btn.appendChild(sep);
			}
			if (key === "online") btn.appendChild(makeDot());
			btn.appendChild(makeNumber(key));
		});

		const close = () => {
			panel.hidden = true;
			btn.setAttribute("aria-expanded", "false");
		};
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const open = panel.hidden;
			panel.hidden = !open;
			btn.setAttribute("aria-expanded", String(open));
		});
		d.addEventListener("click", (e) => {
			if (!panel.hidden && !wrap.contains(e.target)) close();
		});
		d.addEventListener("keydown", (e) => {
			if (e.key === "Escape") close();
		});

		wrap.appendChild(panel);
		wrap.appendChild(btn);
		root.appendChild(wrap);
		shadow.appendChild(root);
	}

	// ---- mount ----
	function mount() {
		if (!d.body) {
			// Script ran in <head> without defer; wait for the body to exist.
			d.addEventListener("DOMContentLoaded", mount, { once: true });
			return;
		}

		const host = d.createElement("div");
		host.setAttribute("data-kp-live", "");
		if (!host.attachShadow) return; // very old browser — bail silently

		const shadow = host.attachShadow({ mode: "open" });
		shadow.appendChild(buildStyle());

		if (MODE === "badge") {
			const target = d.querySelector("[data-klikapa-live-target]");
			if (target) {
				target.appendChild(host);
			} else if (el.parentElement && el.parentElement !== d.head) {
				el.parentElement.insertBefore(host, el);
			} else {
				d.body.appendChild(host);
			}
			buildBadge(shadow);
		} else {
			d.body.appendChild(host);
			buildBubble(shadow);
		}

		w.__klikapaLiveEl = host;
		refresh();
	}

	// ---- polling ----
	function schedule(ms) {
		clearTimeout(timer);
		timer = setTimeout(tick, ms);
	}

	async function refresh() {
		try {
			const res = await fetch(ENDPOINT, { headers: { Accept: "application/json" } });
			if (!res.ok) throw new Error(`status ${res.status}`);
			const body = await res.json();
			if (body && body.data) stats = body.data;
			live = true;
		} catch {
			live = false;
		}

		if (w.__klikapaLiveEl) {
			const shadow = w.__klikapaLiveEl.shadowRoot;
			if (shadow) {
				renderValues(shadow);
				const dot = shadow.querySelector("[data-kp-dot]");
				if (dot) dot.classList.toggle("off", !live);
			}
		}
		if (typeof w.klikapaLiveUpdate === "function") {
			try {
				w.klikapaLiveUpdate(stats);
			} catch {
				/* user callback errors must not break the loop */
			}
		}
	}

	async function tick() {
		if (d.hidden) {
			// Idle while the tab is hidden; visibilitychange triggers a refresh.
			schedule(REFRESH_MS);
			return;
		}
		await refresh();
		backoffMs = live ? REFRESH_MS : Math.min(backoffMs * 2, BACKOFF_MAX_MS);
		schedule(backoffMs);
	}

	d.addEventListener("visibilitychange", () => {
		if (!d.hidden) {
			backoffMs = REFRESH_MS;
			refresh();
			schedule(REFRESH_MS);
		}
	});

	mount();
})(window, document);
