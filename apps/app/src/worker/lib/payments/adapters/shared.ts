import { timingSafeEqual } from "../../webhook-utils";
import type { DeliveryContext, VerifyOutcome } from "../types";

export const NO_SECRET: VerifyOutcome = {
	ok: false,
	status: 401,
	label: "no_secret",
	reason: "no_secret",
	message: "Webhook secret not configured for this integration",
};

/** The shared-secret-in-a-header scheme (Xendit, Mayar, Paywuz): required, compared in constant time. */
export function verifyHeaderToken(
	ctx: DeliveryContext,
	secret: string,
	headerName: string,
): VerifyOutcome {
	if (!secret) return NO_SECRET;
	if (!timingSafeEqual(ctx.header(headerName), secret)) {
		return {
			ok: false,
			status: 401,
			label: "invalid_token",
			reason: "invalid_token",
			message: "Invalid webhook token",
		};
	}
	return { ok: true };
}

const SANDBOX_VALUES = new Set(["sandbox", "test", "development", "dev", "true"]);

/** `environment: sandbox` (or `sandbox: true`) on the provider's saved config marks its payments as test mode. */
export function isSandboxConfig(config: Record<string, string>): boolean {
	return (
		SANDBOX_VALUES.has((config.environment ?? "").toLowerCase()) ||
		SANDBOX_VALUES.has((config.sandbox ?? "").toLowerCase())
	);
}

/** Metadata block of an Indonesian-rail payload, or an empty record. */
export function metadataBlock(...candidates: unknown[]): Record<string, string | undefined> {
	for (const candidate of candidates) {
		if (candidate && typeof candidate === "object") {
			return candidate as Record<string, string | undefined>;
		}
	}
	return {};
}

export function attributionFromMetadata(meta: Record<string, string | undefined>) {
	return {
		visitorId: meta.revklik_visitor_id ?? null,
		sessionId: meta.revklik_session_id ?? null,
		utmSource: meta.revklik_utm_source ?? null,
		utmMedium: meta.revklik_utm_medium ?? null,
		utmCampaign: meta.revklik_utm_campaign ?? null,
	};
}

/** ISO instant of a provider timestamp, or null when it does not parse. */
export function toIso(value: unknown): string | null {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const ms = new Date(value).getTime();
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
