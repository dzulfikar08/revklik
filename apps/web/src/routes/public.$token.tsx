import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PublicDashboardView } from "@/components/analytics/public-dashboard";
import type { LiveState, PublicPayload } from "@/components/analytics/public-dashboard";
import type { RangeKey } from "@/components/analytics/data";
import { tzParam } from "@/lib/legacy/api";

/**
 * Chrome-less public dashboard at /public/:token — the viewer-facing page
 * behind a site's share link. No session, no secrets: everything comes from
 * the public JSON feed (/api/public/:token) and its live companion
 * (/api/public/:token/live). ?embed=1 compacts the chrome for iframe use.
 * The rendering lives in PublicDashboardView, shared with /demo.
 */

/** Fetch error carrying the HTTP status so 404 can render the not-found UI. */
class PublicFetchError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

const fetchPublicDashboard = async (token: string, range: string): Promise<PublicPayload> => {
	// tz: viewer's offset in east-positive minutes, so day buckets match local days.
	const qs = new URLSearchParams({ range, tz: tzParam() });
	const res = await fetch(`/api/public/${encodeURIComponent(token)}?${qs}`);
	if (!res.ok) {
		throw new PublicFetchError(res.status, res.status === 404 ? "not found" : `HTTP ${res.status}`);
	}
	const json = (await res.json()) as { data: PublicPayload };
	// The currency may sit on the dashboard or next to it; keep one place.
	const { dashboard, currency } = json.data;
	return { ...json.data, dashboard: { ...dashboard, currency: dashboard.currency ?? currency } };
};

/* ------------------------------ live polling ------------------------------ */

const LIVE_INTERVAL_MS = 25_000;
const LIVE_MAX_MS = 120_000;

/**
 * Polls /api/public/:token/live on a chained timeout — each tick reschedules
 * itself, backing off on errors and resetting on success.
 */
function usePublicLive(token: string): LiveState {
	const [live, setLive] = useState<LiveState>({ online: null, updatedAt: null });

	useEffect(() => {
		let alive = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let delay = LIVE_INTERVAL_MS;

		const tick = async () => {
			try {
				const res = await fetch(`/api/public/${encodeURIComponent(token)}/live`);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const json = (await res.json()) as {
					data: { online_now: number; updated_at: string };
				};
				if (!alive) return;
				setLive({ online: json.data.online_now, updatedAt: json.data.updated_at });
				delay = LIVE_INTERVAL_MS;
			} catch {
				if (alive) delay = Math.min(delay * 2, LIVE_MAX_MS);
			}
			if (alive) timer = setTimeout(tick, delay);
		};

		void tick();
		return () => {
			alive = false;
			if (timer) clearTimeout(timer);
		};
	}, [token]);

	return live;
}

/* --------------------------------- states --------------------------------- */

function NotFoundState() {
	return (
		<div className="grid min-h-svh place-items-center px-4">
			<div className="text-center">
				<p className="text-2xl font-semibold tracking-tight">Dashboard not found</p>
				<p className="text-muted-foreground mt-1 text-sm">
					This public dashboard doesn't exist or sharing was turned off.
				</p>
			</div>
		</div>
	);
}

/* ---------------------------------- page ---------------------------------- */

function PublicDashboardPage() {
	const { token } = Route.useParams();
	const { embed } = Route.useSearch();
	const [range, setRange] = useState<RangeKey>("7d");

	const dashQ = useQuery({
		queryFn: () => fetchPublicDashboard(token, range),
		queryKey: ["public", token, range],
		retry: false,
		staleTime: 60_000,
	});
	const notFound = dashQ.error instanceof PublicFetchError && dashQ.error.status === 404;
	const live = usePublicLive(token);

	if (notFound) return <NotFoundState />;

	return (
		<PublicDashboardView
			site={dashQ.data?.site}
			dash={dashQ.data?.dashboard}
			loading={dashQ.isPending && !dashQ.isError}
			error={dashQ.isError ? (dashQ.error instanceof Error ? dashQ.error.message : "error") : null}
			range={range}
			onRangeChange={setRange}
			live={live}
			embed={Boolean(embed)}
		/>
	);
}

/* --------------------------------- route ---------------------------------- */

export const Route = createFileRoute("/public/$token")({
	// TanStack JSON-parses search values, so ?embed=1 arrives as number 1 —
	// validate by truthiness, and return {} for clean URLs (no ?embed=false).
	validateSearch: (search: Record<string, unknown>): { embed?: boolean } =>
		search.embed ? { embed: true } : {},
	component: PublicDashboardPage,
	head: () => ({ meta: [{ title: "Dashboard · RevKlik" }] }),
});
