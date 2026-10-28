// Expo Push Service client. Expo hands each message to FCM (Android) or APNs (iOS) with the
// credentials of the app's EAS project. Batches of up to 100, one HTTP call per batch.

export interface ExpoPushEnv {
	/** Only needed when "enhanced push security" is on for the EAS project; unset sends without it. */
	EXPO_ACCESS_TOKEN?: string;
}

export interface ExpoMessage {
	to: string;
	title: string;
	body: string;
	data: Record<string, unknown>;
	sound?: "default" | null;
	/** Android notification channel; one the app never created falls back to the default channel. */
	channelId?: string;
	priority?: "default" | "normal" | "high";
	/** Seconds the push service keeps trying while the phone is offline. */
	ttl?: number;
}

/** One entry per message sent, in order. */
export type ExpoSendResult =
	| { ok: true; ticketId: string }
	/** `dead`: DeviceNotRegistered, delete the token. `transient`: worth another attempt later. */
	| { ok: false; dead: boolean; transient: boolean; error: string };

export interface ExpoReceipt {
	ok: boolean;
	dead: boolean;
	error?: string;
}

export const EXPO_BATCH = 100;
const RECEIPT_BATCH = 300;
const EXPO_API = "https://exp.host/--/api/v2/push";
const DEFAULT_TTL_SECONDS = 86_400;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

/** What `getExpoPushTokenAsync` returns; anything else is not a token this service can deliver to. */
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;
export const isExpoToken = (token: string): boolean => EXPO_TOKEN_RE.test(token);

const headers = (env: ExpoPushEnv): Record<string, string> => ({
	Accept: "application/json",
	"Content-Type": "application/json",
	...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
});

interface RawTicket {
	status?: string;
	id?: string;
	message?: string;
	details?: { error?: string };
}

function toResult(ticket: RawTicket | undefined): ExpoSendResult {
	if (ticket?.status === "ok" && typeof ticket.id === "string") {
		return { ok: true, ticketId: ticket.id };
	}
	const error = ticket?.details?.error ?? ticket?.message ?? "no-ticket";
	const dead = ticket?.details?.error === "DeviceNotRegistered";
	// MessageRateExceeded asks to slow down; every other named error (MessageTooBig,
	// InvalidCredentials, a bad payload) repeats on retry, so only the rate limit and a
	// missing ticket count as transient.
	const transient =
		!dead && (ticket?.details?.error === "MessageRateExceeded" || ticket === undefined);
	return { ok: false, dead, transient, error };
}

/** Sends `messages` (any number; chunks of 100). A failed HTTP call marks that chunk transient. */
export async function sendExpo(
	env: ExpoPushEnv,
	messages: ExpoMessage[],
): Promise<ExpoSendResult[]> {
	const out: ExpoSendResult[] = [];
	for (let i = 0; i < messages.length; i += EXPO_BATCH) {
		const chunk = messages.slice(i, i + EXPO_BATCH);
		try {
			const response = await fetch(`${EXPO_API}/send`, {
				method: "POST",
				headers: headers(env),
				body: JSON.stringify(
					chunk.map((m) => ({
						sound: "default",
						priority: "high",
						ttl: DEFAULT_TTL_SECONDS,
						...m,
					})),
				),
			});
			if (!response.ok) {
				const transient =
					response.status === HTTP_TOO_MANY_REQUESTS || response.status >= HTTP_SERVER_ERROR;
				out.push(
					...chunk.map(() => ({
						ok: false as const,
						dead: false,
						transient,
						error: `http-${response.status}`,
					})),
				);
				continue;
			}
			const body = (await response.json()) as { data?: RawTicket[] };
			const tickets = Array.isArray(body.data) ? body.data : [];
			out.push(...chunk.map((_, index) => toResult(tickets[index])));
		} catch {
			out.push(
				...chunk.map(() => ({
					ok: false as const,
					dead: false,
					transient: true,
					error: "network",
				})),
			);
		}
	}
	return out;
}

/**
 * Receipts for ticket ids (Expo keeps them 24 h; read them 15+ minutes after sending).
 * Unknown ids are absent from the result. Dead tokens are the point: FCM / APNs only tell
 * Expo after the send.
 */
export async function fetchReceipts(
	env: ExpoPushEnv,
	ids: string[],
): Promise<Record<string, ExpoReceipt>> {
	const out: Record<string, ExpoReceipt> = {};
	for (let i = 0; i < ids.length; i += RECEIPT_BATCH) {
		try {
			const response = await fetch(`${EXPO_API}/getReceipts`, {
				method: "POST",
				headers: headers(env),
				body: JSON.stringify({ ids: ids.slice(i, i + RECEIPT_BATCH) }),
			});
			if (!response.ok) continue;
			const body = (await response.json()) as { data?: Record<string, RawTicket> };
			for (const [id, receipt] of Object.entries(body.data ?? {})) {
				const error = receipt.details?.error ?? receipt.message;
				out[id] = {
					ok: receipt.status === "ok",
					dead: receipt.details?.error === "DeviceNotRegistered",
					...(error ? { error } : {}),
				};
			}
		} catch {
			// Read again on the next pass; the ids stay on the outbox row.
		}
	}
	return out;
}
