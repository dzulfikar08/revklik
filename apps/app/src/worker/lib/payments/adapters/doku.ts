import { timingSafeEqual, verifyDokuSignature } from "../../webhook-utils";
import { toNumber } from "../money";
import { findProviderRow } from "../pipeline";
import type { DeliveryContext, PaymentAdapter, PaymentLeg, ProviderRow } from "../types";
import { isSandboxConfig, toIso } from "./shared";

interface DokuBody {
	virtualAccountData?: {
		trxId?: string;
		paymentRequestId?: string;
		virtualAccountNo?: string;
		paymentFlagStatus?: string;
		trxDateTime?: string;
		amount?: { value?: string; currency?: string };
		paidAmount?: { value?: string; currency?: string };
	};
}

const PAID_FLAG = "00";

/**
 * DOKU SNAP virtual-account notifications (X-SIGNATURE over method, path, token, body hash and
 * timestamp). The site comes from X-PARTNER-ID matched against the stored client id; the body
 * is read only after the signature checks out. DOKU sends no refund notification on this channel.
 */
export const dokuAdapter: PaymentAdapter = {
	provider: "doku",

	siteId() {
		return null;
	},

	async findProvider(ctx: DeliveryContext): Promise<ProviderRow | null> {
		const clientId = ctx.header("x-partner-id");
		if (!clientId) return null;
		const rows = await ctx.db
			.selectFrom("payment_providers")
			.select(["site_id", "config"])
			.where("provider", "=", "doku")
			.where("enabled", "=", 1)
			.execute();
		for (const r of rows) {
			let config: Record<string, string> = {};
			try {
				config = JSON.parse((r.config as string) || "{}") as Record<string, string>;
			} catch {
				continue;
			}
			if (config.client_id && timingSafeEqual(config.client_id, clientId)) {
				return findProviderRow(ctx.db, r.site_id, "doku");
			}
		}
		return null;
	},

	async verify(ctx, config) {
		const clientSecret = config.secret_key ?? "";
		if (!clientSecret) {
			return {
				ok: false,
				status: 401,
				label: "unconfigured",
				reason: "unconfigured",
				message: "Provider not configured for verification",
			};
		}
		const valid = await verifyDokuSignature({
			httpMethod: "POST",
			relativeUrl: ctx.url.pathname,
			authorizationHeader: ctx.header("authorization"),
			requestBody: ctx.rawBody,
			timestamp: ctx.header("x-timestamp"),
			clientSecret,
			signature: ctx.header("x-signature"),
		});
		return valid
			? { ok: true }
			: {
					ok: false,
					status: 401,
					label: "invalid_signature",
					reason: "invalid_signature",
					message: "Invalid signature",
				};
	},

	async parse(ctx, config) {
		const va = (ctx.body as DokuBody).virtualAccountData ?? {};
		const trxId = String(va.trxId ?? va.paymentRequestId ?? va.virtualAccountNo ?? "");
		if (va.paymentFlagStatus && va.paymentFlagStatus !== PAID_FLAG) {
			return { ignored: `flag_${va.paymentFlagStatus}` };
		}
		const leg: PaymentLeg = {
			kind: "sale",
			saleId: trxId,
			amount: toNumber(va.amount?.value ?? va.paidAmount?.value) ?? 0,
			currency: va.amount?.currency ?? va.paidAmount?.currency ?? "IDR",
			test: isSandboxConfig(config),
			recurring: false,
			method: "va",
			occurredAt: toIso(va.trxDateTime),
			props: { doku_trx_id: trxId, virtual_account_no: va.virtualAccountNo ?? null },
		};
		return { legs: [leg], label: "paid" };
	},
};
