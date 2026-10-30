import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";

/** Marks a fingerprint produced with a per-site salt; anything without it is the pre-salt SHA-256. */
export const SALTED_FINGERPRINT_PREFIX = "s1_";

/** Hex characters of the HMAC kept: 128 bits is plenty to tell one site's visitors apart. */
const FINGERPRINT_HEX_CHARS = 32;

const toHex = (buf: ArrayBuffer): string =>
	Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** SHA-256 of the request's network and device traits. Computed in memory only; never stored. */
async function requestDigest(req: Request, screenRes?: string): Promise<string> {
	const ip =
		req.headers.get("cf-connecting-ip") ??
		req.headers.get("x-forwarded-for")?.split(",")[0] ??
		"unknown";
	const ua = req.headers.get("user-agent") ?? "";
	const lang = req.headers.get("accept-language") ?? "";
	const input = `${ip}|${ua}|${lang}|${screenRes ?? ""}`;
	return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
}

/**
 * Key a request digest with a site's secret salt. The digest is the pre-salt
 * fingerprint, so a stored legacy value re-keys to exactly what a fresh request
 * from the same device produces (the v25 migration relies on this to carry
 * self-traffic blocklists over).
 */
export async function saltFingerprint(salt: string, digest: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(salt),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(digest));
	return `${SALTED_FINGERPRINT_PREFIX}${toHex(mac).slice(0, FINGERPRINT_HEX_CHARS)}`;
}

export function newSiteSalt(): string {
	return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

// A salt never changes once set, so an isolate may keep it for its lifetime.
const saltCache = new Map<string, string>();

/** Drop cached salts (tests). */
export function clearSaltCache(): void {
	saltCache.clear();
}

/**
 * The site's secret salt, created on first use for sites that predate the column
 * or were made since. Null when the site does not exist.
 */
export async function getSiteSalt(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
): Promise<string | null> {
	const cached = saltCache.get(siteId);
	if (cached) return cached;
	const read = () =>
		db.selectFrom("sites").select("visitor_salt").where("id", "=", siteId).executeTakeFirst();
	let row = await read();
	if (!row) return null;
	if (!row.visitor_salt) {
		// Two isolates may race: the WHERE keeps the first writer's salt, the re-read adopts it.
		await db
			.updateTable("sites")
			.set({ visitor_salt: newSiteSalt() })
			.where("id", "=", siteId)
			.where("visitor_salt", "is", null)
			.execute();
		row = await read();
	}
	const salt = row?.visitor_salt ?? null;
	if (salt) saltCache.set(siteId, salt);
	return salt;
}

/**
 * Per-site, salted, non-reversible device fingerprint. The raw IP never reaches
 * storage, and the same device gets unrelated values on two sites. Null for an
 * unknown site.
 */
export async function siteFingerprint(
	db: Kysely<KlikapaDatabase>,
	siteId: string,
	req: Request,
	screenRes?: string,
): Promise<string | null> {
	const salt = await getSiteSalt(db, siteId);
	if (!salt) return null;
	return saltFingerprint(salt, await requestDigest(req, screenRes));
}
