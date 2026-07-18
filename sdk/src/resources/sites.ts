import type { RevKlikClient } from "../client";
import type { Site } from "../types";

export class SitesResource {
	constructor(private client: RevKlikClient) {}

	/** List all sites accessible to the authenticated token. */
	list(): Promise<Site[]> {
		return this.client.request<Site[]>("GET", "/sites");
	}

	/** Get a single site by ID. */
	get(siteId: string): Promise<Site> {
		return this.client.request<Site>("GET", `/sites/${siteId}`);
	}
}
