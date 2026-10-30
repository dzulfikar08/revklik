import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";

/** Team roles that may change a site's payment secrets; viewers read only. */
export const WRITE_ROLES = ["admin", "editor"];

/**
 * The site when the caller owns it or is an accepted teammate. With `roles`, a teammate
 * must hold one of them (the owner always passes).
 */
export function accessibleSite(
	db: Kysely<KlikapaDatabase>,
	userId: string,
	siteId: string,
	roles?: string[],
) {
	return db
		.selectFrom("sites")
		.select("id")
		.where("id", "=", siteId)
		.where((eb) =>
			eb.or([
				eb("user_id", "=", userId),
				eb.exists(
					eb
						.selectFrom("team_members")
						.select("id")
						.where("site_id", "=", siteId)
						.where("user_id", "=", userId)
						.where("accepted_at", "is not", null)
						.$if(Boolean(roles), (qb) => qb.where("role", "in", roles ?? [])),
				),
			]),
		)
		.executeTakeFirst();
}
