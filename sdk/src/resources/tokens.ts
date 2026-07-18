import type { RevKlikClient } from "../client";
import type {
	CreateTokenRequest,
	CreateTokenResponse,
	RevokeTokenResponse,
	TokenInfo,
} from "../types";

export class TokensResource {
	constructor(private client: RevKlikClient) {}

	/** List all API tokens for the authenticated user. */
	list(): Promise<TokenInfo[]> {
		return this.client.request<TokenInfo[]>("GET", "/tokens");
	}

	/** Create a new API token. */
	create(data: CreateTokenRequest): Promise<CreateTokenResponse> {
		return this.client.request<CreateTokenResponse>(
			"POST",
			"/tokens",
			undefined,
			data,
		);
	}

	/** Revoke (delete) an API token by ID. */
	revoke(tokenId: string): Promise<RevokeTokenResponse> {
		return this.client.request<RevokeTokenResponse>(
			"DELETE",
			`/tokens/${tokenId}`,
		);
	}
}
