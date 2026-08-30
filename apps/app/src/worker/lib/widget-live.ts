import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";

// Embeddable live-stats widget: pure helpers + the shared count queries
// backing GET /api/widgets/live/:token (routes/widgets-live.ts).

const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function validateWidgetToken(token: string): boolean {
	return TOKEN_RE.test(token);
}

/** East-positive UTC offset minutes (e.g. WIB = 420); null when out of ±14h. */
export function clampTzOffset(minutes: number): number | null {
	if (!Number.isFinite(minutes) || !Number.isInteger(minutes)) return null;
	if (minutes < -840 || minutes > 840) return null;
	return minutes;
}

/** ISO timestamp of local midnight for a site at the given east-positive offset. */
export function dayStartIso(nowMs: number, tzOffsetMinutes: number): string {
	const local = nowMs + tzOffsetMinutes * 60_000;
	const localMidnight = Math.floor(local / 86_400_000) * 86_400_000;
	return new Date(localMidnight - tzOffsetMinutes * 60_000).toISOString();
}

export interface LiveStats {
	online_now: number;
	visitors_today: number;
	total_visitors: number;
}

export async function getLiveStats(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	tzOffsetMinutes: number,
): Promise<LiveStats> {
	const now = Date.now();
	const onlineSince = new Date(now - 5 * 60_000).toISOString();
	const todayStart = dayStartIso(now, tzOffsetMinutes);

	const countDistinct = () =>
		db
			.selectFrom("events")
			.select(({ fn }) => fn.count<number>("visitor_id").distinct().as("count"))
			.where("site_id", "=", siteId);

	const [online, today, total] = await Promise.all([
		countDistinct().where("timestamp", ">", onlineSince).executeTakeFirst(),
		countDistinct().where("timestamp", ">=", todayStart).executeTakeFirst(),
		countDistinct().executeTakeFirst(),
	]);

	return {
		online_now: online?.count ?? 0,
		visitors_today: today?.count ?? 0,
		total_visitors: total?.count ?? 0,
	};
}
