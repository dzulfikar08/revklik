import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { DEFAULT_ACCOUNT_SCOPES, DEFAULT_SITE_SCOPES, SCOPES } from "@revklik/shared";
import { generateApiKey, generateId, hashToken } from "../utils";

type Variables = { db: Kysely<KlikapaDatabase>; userId: string };
type TokensEnv = { Variables: Variables; Bindings: { DB: D1Database } };

export const tokenRoutes = new Hono<TokensEnv>();

const PLAN_TOKEN_LIMITS: Record<string, number> = {
	free: 2,
	starter: 5,
	growth: Infinity,
};

// GET / — list tokens (masked)
tokenRoutes.get("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");

	const keys = await db
		.selectFrom("api_keys")
		.select([
			"id",
			"key_prefix",
			"name",
			"token_type",
			"scopes",
			"site_id",
			"last_used_at",
			"created_at",
		])
		.where("user_id", "=", userId)
		.where("token_type", "in", ["account", "site"])
		.orderBy("created_at", "desc")
		.execute();

	const data = keys.map((k) => {
		let scopes: string[] = [];
		try {
			scopes = k.scopes ? JSON.parse(k.scopes) : [];
		} catch {
			scopes = [];
		}

		return {
			id: k.id,
			prefix: k.key_prefix,
			name: k.name,
			type: k.token_type as "account" | "site",
			scopes,
			site_id: k.site_id,
			last_used_at: k.last_used_at,
			created_at: k.created_at,
		};
	});

	return c.json({ data, success: true });
});

// POST / — create token
tokenRoutes.post("/", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");

	const body = await c.req.json();
	const { name, type, scopes, site_id } = body;

	if (!name || !type) {
		return c.json({ error: "name and type are required", success: false }, 400);
	}

	if (type !== "account" && type !== "site") {
		return c.json(
			{ error: "type must be 'account' or 'site'", success: false },
			400,
		);
	}

	// For site tokens, site_id is required
	if (type === "site" && !site_id) {
		return c.json(
			{ error: "site_id is required for site tokens", success: false },
			400,
		);
	}

	// Validate site ownership for site tokens
	if (type === "site" && site_id) {
		const site = await db
			.selectFrom("sites")
			.select(["id"])
			.where("id", "=", site_id)
			.where((eb) =>
				eb.or([
					eb("user_id", "=", userId),
					eb.exists(
						eb
							.selectFrom("team_members")
							.select("id")
							.where("site_id", "=", site_id)
							.where("user_id", "=", userId)
							.where("accepted_at", "is not", null),
					),
				]),
			)
			.executeTakeFirst();

		if (!site) {
			return c.json(
				{ error: "Site not found or no access", success: false },
				404,
			);
		}
	}

	// Check plan limits
	let plan = "free";
	try {
		const sub = await db
			.selectFrom("subscriptions")
			.select(["plan"])
			.where("user_id", "=", userId)
			.executeTakeFirst();
		if (sub?.plan) plan = sub.plan;
	} catch {
		/* default to free */
	}

	const maxTokens = PLAN_TOKEN_LIMITS[plan] ?? 2;

	const existingCount = await db
		.selectFrom("api_keys")
		.select(({ fn }) => [fn.count<number>("id").as("count")])
		.where("user_id", "=", userId)
		.where("token_type", "in", ["account", "site"])
		.executeTakeFirst();

	if (Number(existingCount?.count ?? 0) >= maxTokens) {
		return c.json(
			{
				error: `Token limit reached. Your plan (${plan}) allows up to ${maxTokens === Infinity ? "unlimited" : maxTokens} API tokens.`,
				success: false,
			},
			403,
		);
	}

	// Determine scopes
	const tokenScopes =
		scopes && scopes.length > 0
			? scopes
			: type === "account"
				? DEFAULT_ACCOUNT_SCOPES
				: DEFAULT_SITE_SCOPES;

	// Validate provided scopes are valid
	const validScopes = Object.values(SCOPES) as string[];
	const invalidScopes = tokenScopes.filter(
		(s: string) => !validScopes.includes(s),
	);
	if (invalidScopes.length > 0) {
		return c.json(
			{ error: `Invalid scopes: ${invalidScopes.join(", ")}`, success: false },
			400,
		);
	}

	// Site tokens can only have analytics scopes
	if (type === "site") {
		const siteAllowedScopes: string[] = [
			SCOPES.ANALYTICS_READ,
			SCOPES.ANALYTICS_EXPORT,
		];
		const disallowedScopes = tokenScopes.filter(
			(s: string) => !siteAllowedScopes.includes(s),
		);
		if (disallowedScopes.length > 0) {
			return c.json(
				{
					error: `Site tokens can only have scopes: ${siteAllowedScopes.join(", ")}`,
					success: false,
				},
				400,
			);
		}
	}

	// Generate token
	const { key, prefix } = generateApiKey(type);
	const keyHash = await hashToken(key);
	const id = generateId();
	const now = new Date().toISOString();

	await db
		.insertInto("api_keys")
		.values({
			id,
			user_id: userId,
			key_hash: keyHash,
			key_prefix: prefix,
			name,
			token_type: type,
			scopes: JSON.stringify(tokenScopes),
			site_id: type === "site" ? (site_id ?? null) : null,
			last_used_at: null,
			expires_at: null,
			created_at: now,
		})
		.execute();

	return c.json(
		{
			data: {
				id,
				token: key,
				prefix,
				name,
				type,
				scopes: tokenScopes,
				site_id: type === "site" ? (site_id ?? null) : null,
				created_at: now,
			},
			success: true,
		},
		201,
	);
});

// DELETE /:id — revoke token
tokenRoutes.delete("/:id", async (c) => {
	const db = c.get("db");
	const userId = c.get("userId");
	const tokenId = c.req.param("id");

	const apiKey = await db
		.selectFrom("api_keys")
		.select(["id", "user_id", "token_type"])
		.where("id", "=", tokenId)
		.executeTakeFirst();

	if (!apiKey) {
		return c.json({ error: "Token not found", success: false }, 404);
	}

	// Only allow revoking own tokens
	if (apiKey.user_id !== userId) {
		return c.json(
			{ error: "You can only revoke your own tokens", success: false },
			403,
		);
	}

	// Only allow revoking account/site tokens (not session tokens)
	if (apiKey.token_type === "session") {
		return c.json(
			{
				error: "Cannot revoke session tokens via this endpoint",
				success: false,
			},
			400,
		);
	}

	await db.deleteFrom("api_keys").where("id", "=", tokenId).execute();

	return c.json({ data: { id: tokenId, revoked: true }, success: true });
});
