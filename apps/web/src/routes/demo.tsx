import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { PublicDashboardView } from "@/components/analytics/public-dashboard";
import type { RangeKey } from "@/components/analytics/data";
import { buildDemoPayload, useDemoLive } from "@/lib/demo-dashboard";

/**
 * Sample dashboard at /demo, embedded by the landing page. It renders the
 * same PublicDashboardView as /public/:token, fed from a seeded fixture
 * (a fictional shop) instead of the API: no session, no network requests.
 * ?embed=1 compacts the chrome for iframe use, exactly like the real page.
 */

function DemoDashboardPage() {
	const { embed } = Route.useSearch();
	const [range, setRange] = useState<RangeKey>("30d");
	const [now] = useState(() => new Date());
	const payload = useMemo(() => buildDemoPayload(range, now), [range, now]);
	const live = useDemoLive();

	return (
		<PublicDashboardView
			site={payload.site}
			dash={payload.dashboard}
			loading={false}
			error={null}
			range={range}
			onRangeChange={setRange}
			live={live}
			embed={Boolean(embed)}
		/>
	);
}

export const Route = createFileRoute("/demo")({
	// Same ?embed=1 contract as /public/$token.
	validateSearch: (search: Record<string, unknown>): { embed?: boolean } =>
		search.embed ? { embed: true } : {},
	component: DemoDashboardPage,
	head: () => ({
		meta: [{ title: "Dashboard demo · RevKlik" }, { name: "robots", content: "noindex, nofollow" }],
	}),
});
