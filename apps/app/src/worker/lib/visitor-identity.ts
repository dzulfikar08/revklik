/**
 * Who a tracked event belongs to.
 *
 * The browser tracker keeps a random first-party id in localStorage (`_kp_vid`)
 * and sends it with every event; that id IS the visitor. The request
 * fingerprint (a salted hash of network and browser headers) is a weak,
 * shared signal: every phone on one mobile carrier's NAT with the same model,
 * language and screen has the same one. It therefore never decides identity
 * when a client id is present, so two people behind one IP stay two visitors.
 *
 * Only a client that sends no usable id (an old script, blocked storage, a
 * server-side caller) falls back to a visitor derived from the fingerprint, so
 * its events still group into one anonymous visitor per device signature.
 */

/** Accepts UUIDs and the other opaque ids clients mint; rejects anything free-form or oversized. */
const CLIENT_VID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Prefix of fingerprint-derived ids, so they can never collide with a client-minted id. */
export const FINGERPRINT_VID_PREFIX = "fp_";

/** Hex characters of the fingerprint kept in a derived id (128 bits). */
const FINGERPRINT_VID_LENGTH = 32;

export function resolveVisitorId(clientVid: unknown, fingerprint: string | null): string | null {
	if (typeof clientVid === "string" && CLIENT_VID_RE.test(clientVid)) return clientVid;
	if (!fingerprint) return null;
	return `${FINGERPRINT_VID_PREFIX}${fingerprint.slice(0, FINGERPRINT_VID_LENGTH)}`;
}
