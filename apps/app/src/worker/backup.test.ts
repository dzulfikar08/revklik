import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { backupDatabase, BACKUP_PREFIX, KEEP } from "./backup";
import {
	BackupEncryptor,
	BackupCryptoError,
	decryptBackup,
	FRAME_BYTES,
	importBackupKey,
} from "./lib/backup-crypto";
import { asBucket, FakeR2 } from "./lib/fake-r2";
import { drillKey, runRestoreDrill } from "./lib/restore-drill";
import { makeD1 } from "./lib/test-harness";
import { migrateDatabase } from "./migrations";

const concat = (parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};

async function encrypt(keyText: string, plain: Uint8Array, pushSize = 700_000) {
	const enc = new BackupEncryptor(await importBackupKey(keyText));
	const parts: Uint8Array[] = [];
	for (let at = 0; at < plain.length; at += pushSize) {
		parts.push(...(await enc.push(plain.subarray(at, at + pushSize))));
	}
	parts.push(...(await enc.finish()));
	return concat(parts);
}

describe("backup container", () => {
	it.each([0, 1, FRAME_BYTES - 1, FRAME_BYTES, FRAME_BYTES + 1, 3 * FRAME_BYTES + 5])(
		"round-trips %i bytes, whatever the frame boundary",
		async (size) => {
			const keyText = drillKey();
			const plain = crypto.getRandomValues(new Uint8Array(Math.min(size, 65_536)));
			const padded = new Uint8Array(size);
			padded.set(plain.subarray(0, Math.min(size, plain.length)));
			const sealed = await encrypt(keyText, padded);
			const opened = await decryptBackup(await importBackupKey(keyText), sealed);
			expect(opened.length).toBe(size);
			expect(Buffer.compare(Buffer.from(opened), Buffer.from(padded))).toBe(0);
		},
	);

	it("rejects dropped, reordered, truncated or extended frames and foreign files", async () => {
		const keyText = drillKey();
		const key = await importBackupKey(keyText);
		const plain = new Uint8Array(3 * FRAME_BYTES + 10).fill(7);
		const sealed = await encrypt(keyText, plain);
		const frameLength = 4 + 12 + FRAME_BYTES + 16;
		const header = 8;
		const frame = (n: number) =>
			sealed.slice(header + n * frameLength, header + (n + 1) * frameLength);
		const head = sealed.slice(0, header);

		await expect(decryptBackup(key, concat([head, frame(1), frame(0), frame(2)]))).rejects.toThrow(
			BackupCryptoError,
		);
		await expect(decryptBackup(key, concat([head, frame(0), frame(2)]))).rejects.toThrow(
			BackupCryptoError,
		);
		await expect(decryptBackup(key, sealed.slice(0, sealed.length - 1))).rejects.toThrow(
			BackupCryptoError,
		);
		// Cutting the file after a whole frame leaves a stream whose last frame was not sealed as final.
		await expect(decryptBackup(key, concat([head, frame(0)]))).rejects.toThrow(BackupCryptoError);
		await expect(decryptBackup(key, concat([sealed, frame(0)]))).rejects.toThrow(BackupCryptoError);
		await expect(decryptBackup(key, new TextEncoder().encode("SELECT 1;"))).rejects.toThrow(
			"bad header",
		);
	});

	it("insists on a 32-byte base64 key", async () => {
		await expect(importBackupKey(undefined)).rejects.toThrow("not set");
		await expect(importBackupKey("   ")).rejects.toThrow("not set");
		await expect(importBackupKey("%%%")).rejects.toThrow("base64");
		await expect(importBackupKey(btoa("too short"))).rejects.toThrow("32 bytes");
	});
});

describe("backupDatabase", () => {
	async function sourceDb() {
		const db = new Database(":memory:");
		await migrateDatabase(makeD1(db) as unknown as D1Database);
		db.exec(
			"INSERT INTO users (id, email, password_hash, name) VALUES ('u1','owner@example.com','x','Owner')",
		);
		return { db, d1: makeD1(db) as unknown as D1Database };
	}

	it("restores byte for byte after encryption: the local restore drill passes", async () => {
		const report = await runRestoreDrill({ events: 6_000 });
		expect(report.checks.filter((c) => !c.ok)).toEqual([]);
		expect(report.ok).toBe(true);
	});

	it("refuses to write anything without a key, so no plaintext copy can exist", async () => {
		const { d1 } = await sourceDb();
		const r2 = new FakeR2();
		await expect(backupDatabase({ DB: d1, BACKUP_BUCKET: asBucket(r2) })).rejects.toThrow(
			"BACKUP_ENCRYPTION_KEY is not set",
		);
		expect(r2.objects.size).toBe(0);
	});

	it("aborts the multipart upload and leaves no object when R2 fails mid-dump", async () => {
		const { d1 } = await sourceDb();
		const r2 = new FakeR2();
		r2.failUploads = true;
		await expect(
			backupDatabase({ DB: d1, BACKUP_BUCKET: asBucket(r2), BACKUP_ENCRYPTION_KEY: drillKey() }),
		).rejects.toThrow("R2 unavailable");
		expect(r2.aborted).toBe(1);
		expect(r2.objects.size).toBe(0);
	});

	it("deletes plaintext dumps once an encrypted one is stored and keeps only the newest KEEP", async () => {
		const { d1 } = await sourceDb();
		const r2 = new FakeR2();
		const day = 86_400_000;
		r2.seed(
			`${BACKUP_PREFIX}2026-01-01.sql`,
			"-- old plaintext dump",
			new Date(Date.now() - 90 * day),
		);
		for (let i = 0; i < KEEP + 2; i++) {
			const stamp = `2026-02-${String(i).padStart(2, "0")}`;
			const uploaded = new Date(Date.now() - (60 - i) * day);
			r2.seed(`${BACKUP_PREFIX}${stamp}.sql.enc`, "sealed", uploaded);
			r2.seed(`${BACKUP_PREFIX}${stamp}.manifest.json`, "{}", uploaded);
		}

		await backupDatabase({
			DB: d1,
			BACKUP_BUCKET: asBucket(r2),
			BACKUP_ENCRYPTION_KEY: drillKey(),
		});

		const keys = [...r2.objects.keys()];
		expect(keys.some((k) => k.endsWith(".sql"))).toBe(false);
		expect(keys.filter((k) => k.endsWith(".sql.enc"))).toHaveLength(KEEP);
		expect(keys.filter((k) => k.endsWith(".manifest.json"))).toHaveLength(KEEP);
		// The two oldest encrypted dumps (and their manifests) went; the new one stays.
		expect(keys).not.toContain(`${BACKUP_PREFIX}2026-02-00.sql.enc`);
		expect(keys).not.toContain(`${BACKUP_PREFIX}2026-02-01.manifest.json`);
	});
});
