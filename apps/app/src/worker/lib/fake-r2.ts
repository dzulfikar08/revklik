/**
 * In-memory stand-in for the slice of R2Bucket the backup job uses. Test and
 * restore-drill support only: it enforces R2's rule that every non-trailing
 * multipart part has the same size, because the backup code is written around it.
 */
export class FakeR2 {
	readonly objects = new Map<string, { bytes: Uint8Array; uploaded: Date }>();
	/** When set, uploadPart rejects: simulates an R2 outage mid-dump. */
	failUploads = false;
	aborted = 0;

	async put(key: string, value: string | Uint8Array): Promise<void> {
		const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
		this.objects.set(key, { bytes: bytes.slice(), uploaded: new Date() });
	}

	async get(key: string) {
		const stored = this.objects.get(key);
		if (!stored) return null;
		return { arrayBuffer: async () => stored.bytes.slice().buffer };
	}

	async delete(key: string): Promise<void> {
		this.objects.delete(key);
	}

	async list(opts: { prefix?: string } = {}) {
		const objects = [...this.objects.entries()]
			.filter(([key]) => key.startsWith(opts.prefix ?? ""))
			.map(([key, value]) => ({ key, uploaded: value.uploaded, size: value.bytes.length }));
		return { objects, truncated: false };
	}

	async createMultipartUpload(key: string) {
		const parts: Uint8Array[] = [];
		return {
			uploadPart: async (partNumber: number, data: Uint8Array) => {
				if (this.failUploads) throw new Error("R2 unavailable");
				if (partNumber !== parts.length + 1) throw new Error("parts must be uploaded in order");
				const previous = parts[parts.length - 1];
				if (previous && previous.length !== parts[0]?.length) {
					throw new Error("R2 requires equal-sized non-trailing parts");
				}
				parts.push(data.slice());
				return { partNumber, etag: `etag-${partNumber}` };
			},
			complete: async () => {
				const total = parts.reduce((sum, p) => sum + p.length, 0);
				const bytes = new Uint8Array(total);
				let at = 0;
				for (const part of parts) {
					bytes.set(part, at);
					at += part.length;
				}
				this.objects.set(key, { bytes, uploaded: new Date() });
			},
			abort: async () => {
				this.aborted++;
			},
		};
	}

	/** Seed an object with a chosen upload time (retention tests). */
	seed(key: string, text: string, uploaded: Date): void {
		this.objects.set(key, { bytes: new TextEncoder().encode(text), uploaded });
	}
}

export const asBucket = (fake: FakeR2): R2Bucket => fake as unknown as R2Bucket;
