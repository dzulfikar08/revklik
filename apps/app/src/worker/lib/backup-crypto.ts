/**
 * Encrypted backup container, shared by the nightly dump (backup.ts) and the
 * restore tools (scripts/restore-backup.ts, scripts/restore-drill.ts).
 *
 *   file   = MAGIC | frame*
 *   frame  = u32 BE length of (ciphertext + tag) | 12-byte IV | ciphertext + 16-byte tag
 *   cipher = AES-256-GCM, one fresh random IV per frame
 *   AAD    = MAGIC | u32 BE frame index | u8 final flag
 *
 * The AAD binds each frame to its position and marks the last one, so a dump
 * with reordered, dropped or truncated frames fails to decrypt instead of
 * restoring a silently incomplete database. The key is 32 random bytes given as
 * base64 (BACKUP_ENCRYPTION_KEY, e.g. `openssl rand -base64 32`).
 */

export const BACKUP_MAGIC = new TextEncoder().encode("RVKBAK01");
/** Plaintext bytes per frame. */
export const FRAME_BYTES = 1024 * 1024;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const LENGTH_BYTES = 4;
const KEY_BYTES = 32;

export class BackupCryptoError extends Error {}

/** Import the base64 key; throws when it is not exactly 32 bytes. */
export async function importBackupKey(base64: string | undefined): Promise<CryptoKey> {
	const trimmed = base64?.trim();
	if (!trimmed) throw new BackupCryptoError("BACKUP_ENCRYPTION_KEY is not set");
	let raw: Uint8Array;
	try {
		raw = Uint8Array.from(atob(trimmed), (ch) => ch.charCodeAt(0));
	} catch {
		throw new BackupCryptoError("BACKUP_ENCRYPTION_KEY is not valid base64");
	}
	if (raw.length !== KEY_BYTES) {
		throw new BackupCryptoError(
			`BACKUP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${raw.length}`,
		);
	}
	return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function frameAad(index: number, final: boolean): Uint8Array {
	const aad = new Uint8Array(BACKUP_MAGIC.length + 5);
	aad.set(BACKUP_MAGIC, 0);
	new DataView(aad.buffer).setUint32(BACKUP_MAGIC.length, index);
	aad[BACKUP_MAGIC.length + 4] = final ? 1 : 0;
	return aad;
}

async function sealFrame(
	key: CryptoKey,
	index: number,
	final: boolean,
	plain: Uint8Array,
): Promise<Uint8Array> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const sealed = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv, additionalData: frameAad(index, final) },
			key,
			plain,
		),
	);
	const frame = new Uint8Array(LENGTH_BYTES + IV_BYTES + sealed.length);
	new DataView(frame.buffer).setUint32(0, sealed.length);
	frame.set(iv, LENGTH_BYTES);
	frame.set(sealed, LENGTH_BYTES + IV_BYTES);
	return frame;
}

/**
 * Streaming encryptor: feed plaintext with push(), call finish() once. A frame is
 * only emitted while MORE than FRAME_BYTES are buffered, so the tail is always
 * left for finish() to seal with the final flag.
 */
export class BackupEncryptor {
	private pending = new Uint8Array(FRAME_BYTES * 2);
	private length = 0;
	private index = 0;
	private started = false;

	constructor(private readonly key: CryptoKey) {}

	/** File header; emitted with the first push() or finish(). */
	private header(): Uint8Array[] {
		if (this.started) return [];
		this.started = true;
		return [BACKUP_MAGIC];
	}

	async push(bytes: Uint8Array): Promise<Uint8Array[]> {
		const out = this.header();
		let offset = 0;
		while (offset < bytes.length) {
			const take = Math.min(this.pending.length - this.length, bytes.length - offset);
			this.pending.set(bytes.subarray(offset, offset + take), this.length);
			this.length += take;
			offset += take;
			while (this.length > FRAME_BYTES) {
				out.push(
					await sealFrame(this.key, this.index++, false, this.pending.slice(0, FRAME_BYTES)),
				);
				this.pending.copyWithin(0, FRAME_BYTES, this.length);
				this.length -= FRAME_BYTES;
			}
		}
		return out;
	}

	async finish(): Promise<Uint8Array[]> {
		const out = this.header();
		out.push(await sealFrame(this.key, this.index++, true, this.pending.slice(0, this.length)));
		this.length = 0;
		return out;
	}
}

/** Decrypt a whole container held in memory (restore tools; dumps are far below memory limits locally). */
export async function decryptBackup(key: CryptoKey, file: Uint8Array): Promise<Uint8Array> {
	const magic = file.subarray(0, BACKUP_MAGIC.length);
	if (magic.length !== BACKUP_MAGIC.length || magic.some((b, i) => b !== BACKUP_MAGIC[i])) {
		throw new BackupCryptoError("not a RevKlik encrypted backup (bad header)");
	}
	const chunks: Uint8Array[] = [];
	let offset = BACKUP_MAGIC.length;
	let index = 0;
	let sawFinal = false;
	while (offset < file.length) {
		if (sawFinal) throw new BackupCryptoError("data after the final frame");
		if (offset + LENGTH_BYTES + IV_BYTES > file.length) {
			throw new BackupCryptoError("truncated frame header");
		}
		const sealedLength = new DataView(file.buffer, file.byteOffset + offset).getUint32(0);
		const ivStart = offset + LENGTH_BYTES;
		const bodyStart = ivStart + IV_BYTES;
		const end = bodyStart + sealedLength;
		if (sealedLength < TAG_BYTES || end > file.length) {
			throw new BackupCryptoError("truncated frame");
		}
		const iv = file.subarray(ivStart, bodyStart);
		const body = file.subarray(bodyStart, end);
		// The final flag is not stored: try "not final", and only a frame that is the last one can open as final.
		const isLast = end === file.length;
		try {
			chunks.push(
				new Uint8Array(
					await crypto.subtle.decrypt(
						{ name: "AES-GCM", iv, additionalData: frameAad(index, isLast) },
						key,
						body,
					),
				),
			);
		} catch {
			throw new BackupCryptoError(
				`frame ${index} failed authentication: wrong key, corrupted or truncated backup`,
			);
		}
		sawFinal = isLast;
		offset = end;
		index++;
	}
	if (!sawFinal) throw new BackupCryptoError("backup has no final frame (truncated)");
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const plain = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		plain.set(chunk, at);
		at += chunk.length;
	}
	return plain;
}
