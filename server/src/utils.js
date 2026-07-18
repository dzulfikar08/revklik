export async function hashPassword(password) {
	const encoder = new TextEncoder();
	const data = encoder.encode(password);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
}
export async function verifyPassword(password, hash) {
	const passwordHash = await hashPassword(password);
	return passwordHash === hash;
}
export function generateApiKey() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const key = `kp_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
	const prefix = key.slice(0, 7);
	return { key, hash: prefix, prefix };
}
export async function hashToken(token) {
	const encoder = new TextEncoder();
	const data = encoder.encode(token);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hashBuffer), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}
export function generateId() {
	return crypto.randomUUID();
}
export async function fingerprintFromRequest(req, screenRes) {
	const ip =
		req.headers.get("cf-connecting-ip") ??
		req.headers.get("x-forwarded-for")?.split(",")[0] ??
		"unknown";
	const ua = req.headers.get("user-agent") ?? "";
	const lang = req.headers.get("accept-language") ?? "";
	const input = `${ip}|${ua}|${lang}|${screenRes ?? ""}`;
	const data = new TextEncoder().encode(input);
	const buf = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(buf), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}
export function getDateRange(range) {
	const end = new Date();
	const start = new Date();
	if (range.includes(",")) {
		const parts = range.split(",");
		const s = new Date(parts[0] ?? "");
		const e = new Date(parts[1] ?? "");
		if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
			return { start: s, end: e };
		}
	}
	switch (range) {
		case "7d":
			start.setDate(start.getDate() - 7);
			break;
		case "30d":
			start.setDate(start.getDate() - 30);
			break;
		case "90d":
			start.setDate(start.getDate() - 90);
			break;
		case "24h":
			start.setHours(start.getHours() - 24);
			break;
		default:
			start.setDate(start.getDate() - 7);
	}
	return { start, end };
}
