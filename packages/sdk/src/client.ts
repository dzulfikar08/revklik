export class RevKlikError extends Error {
	public status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "RevKlikError";
		this.status = status;
	}
}

export interface RevKlikClientOptions {
	token: string;
	baseUrl?: string;
}

export class RevKlikClient {
	private baseUrl: string;
	private token: string;

	constructor(options: RevKlikClientOptions) {
		this.token = options.token;
		this.baseUrl = options.baseUrl || "https://klikapa.dzulfikar-at.workers.dev";
	}

	async request<T>(
		method: string,
		path: string,
		params?: Record<string, string>,
		body?: unknown,
	): Promise<T> {
		const url = new URL(`/api/v1${path}`, this.baseUrl);
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				url.searchParams.set(k, v);
			}
		}

		const res = await fetch(url.toString(), {
			method,
			headers: {
				Authorization: `Bearer ${this.token}`,
				"Content-Type": "application/json",
			},
			body: body ? JSON.stringify(body) : undefined,
		});

		const text = await res.text();
		let data: { success?: boolean; data?: T; error?: string };
		try {
			data = JSON.parse(text);
		} catch {
			throw new RevKlikError(
				res.status,
				`API returned non-JSON response (${res.status}): ${text.slice(0, 200)}`,
			);
		}

		if (!res.ok || data.success === false) {
			throw new RevKlikError(res.status, data.error || `API error ${res.status}`);
		}

		return data.data as T;
	}
}
