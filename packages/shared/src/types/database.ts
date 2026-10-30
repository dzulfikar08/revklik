/**
 * Column with a database DEFAULT: always present on reads, optional on insert.
 * Structurally identical to Kysely's `Generated<T>` (shared has no kysely dep).
 */
export type Defaulted<T> = {
	readonly __select__: T;
	readonly __insert__: T | undefined;
	readonly __update__: T;
};

export interface EventTable {
	id: string;
	site_id: string;
	session_id: string;
	visitor_id: string;
	timestamp: string;
	event_type: "pageview" | "custom" | "conversion" | "refund" | "payment" | "subscription";
	name: string | null;
	path: string;
	hostname: string | null;
	referrer: string | null;
	utm_source: string | null;
	utm_medium: string | null;
	utm_campaign: string | null;
	utm_term: string | null;
	utm_content: string | null;
	country: string | null;
	region: string | null;
	city: string | null;
	device_type: string | null;
	browser: string | null;
	os: string | null;
	revenue: number | null;
	props: string | null;
	fingerprint: string | null;
	payment_provider: string | null;
	payment_method: string | null;
	currency: string | null;
	subscription_id: string | null;
	/** 1 when classified as non-human traffic; excluded from every analytics read. */
	is_bot: Defaulted<number>;
	/** Idempotency key of server-side events (Apple transactionId, Polar order id). */
	external_id: string | null;
	/** Payment rail ("apple", "polar", "doku", ...) of a server-reported sale. */
	rail: Defaulted<string | null>;
	/** Product slug the sale belongs to. */
	product: Defaulted<string | null>;
	/** What the merchant keeps, same currency and sign as revenue; NULL on legacy rows. */
	net_revenue: Defaulted<number | null>;
	/** How net_revenue was obtained. */
	net_source: Defaulted<"reported" | "rule" | "refund_ratio" | null>;
	/** Canonical traffic source (lib/source-sql.ts classifySource), stamped at insert; NULL on rows not yet backfilled. */
	source: Defaulted<string | null>;
	/** Why the row is left out of every read: "test" (smoke/test sale) or "duplicate" (same sale booked twice), "unconfirmed" (browser-reported sale no provider order confirms); NULL = counted. */
	excluded_reason: Defaulted<"test" | "duplicate" | "unconfirmed" | null>;
}

export interface SessionTable {
	id: string;
	site_id: string;
	visitor_id: string;
	started_at: string;
	ended_at: string | null;
	entry_path: string | null;
	exit_path: string | null;
	referrer: string | null;
	utm_source: string | null;
	utm_medium: string | null;
	utm_campaign: string | null;
	country: string | null;
	region: string | null;
	city: string | null;
	device_type: string | null;
	browser: string | null;
	os: string | null;
	page_count: number;
	is_bounce: number;
	fingerprint: string | null;
	/** 1 when classified as non-human traffic; excluded from every analytics read. */
	is_bot: Defaulted<number>;
	/** Why the session was flagged (reason code), null for humans. */
	bot_reason: string | null;
	/** Seconds of activity: the gap between consecutive events counted up to a cap. */
	active_seconds: number | null;
	/** Cloudflare ASN organization of the first request, kept for reclassification. */
	as_org: string | null;
	/** Canonical traffic source of the session's entry, stamped at insert. */
	source: Defaulted<string | null>;
}

export interface SiteTable {
	id: string;
	user_id: string;
	name: string;
	domain: string;
	created_at: string;
	share_token?: string | null;
	public_dashboard?: number;
	excluded_fingerprints?: string | null;
	widget_enabled?: number;
	widget_token?: string | null;
	widget_tz_offset?: number;
	/** ISO code revenue is displayed in; rows in other currencies are converted. */
	revenue_currency?: string;
	/** NULL until inferred by the cron; then 'auto', or 'user'/'default' when set explicitly. */
	revenue_currency_source?: string | null;
	/** Secret per-site key for visitor fingerprints (lib/visitor-hash.ts); never returned by any route. */
	visitor_salt?: string | null;
}

export interface UserTable {
	id: string;
	email: string;
	password_hash: string;
	name: string;
	google_id: string | null;
	avatar_url: string | null;
	role: "user" | "admin" | "super_admin";
	created_at: string;
	/** Plan picked on the pricing page before signup; informational only. */
	intended_plan?: string | null;
	/** Set once the owner proved the address (email link or Google sign-in). */
	email_verified_at?: string | null;
}

export interface ApiKeyTable {
	id: string;
	user_id: string;
	key_hash: string;
	key_prefix: string;
	name: string;
	token_type: "session" | "account" | "site";
	scopes: string | null;
	site_id: string | null;
	last_used_at: string | null;
	expires_at: string | null;
	created_at: string;
	/** When a credential was last proven for this session; NULL for switch-minted sessions. */
	authenticated_at?: string | null;
}

export interface VisitorProfileTable {
	id: string;
	site_id: string;
	visitor_id: string;
	name: string | null;
	email: string | null;
	phone: string | null;
	avatar: string | null;
	first_seen: string;
	last_seen: string;
	country: string | null;
	region: string | null;
	city: string | null;
	device_type: string | null;
	browser: string | null;
	os: string | null;
	total_sessions: number;
	total_pageviews: number;
	total_revenue: number;
	tags: string | null;
	notes: string | null;
	fingerprint: string | null;
	is_bot: Defaulted<number>;
}

/** Latest units of one currency per 1 USD, refreshed daily from a public rate feed. */
export interface FxRateTable {
	currency: string;
	per_usd: number;
	as_of: string;
}

/** Owner-specific payment fee for one rail; overrides the built-in default. */
export interface FeeRuleTable {
	user_id: string;
	rail: string;
	percent_bps: number;
	fixed_amount: number;
	fixed_currency: string | null;
	updated_at: number | null;
}

export interface PaymentProviderTable {
	id: string;
	site_id: string;
	provider: string;
	config: string;
	enabled: number;
	created_at: string;
}

export interface WebhookLogTable {
	id: string;
	site_id: string;
	provider: string;
	event_type: string;
	payload: string;
	status: string;
	error: string | null;
	created_at: string;
	processed_at: string | null;
}

export interface SegmentTable {
	id: string;
	site_id: string;
	name: string;
	filters: string;
	created_at: string;
}

export interface AnnotationTable {
	id: string;
	site_id: string;
	date: string;
	text: string;
	user_id: string;
	created_at: string;
}

export interface EmailReportTable {
	id: string;
	site_id: string;
	user_id: string;
	frequency: string;
	enabled: number;
	last_sent: string | null;
	created_at: string;
}

export interface CrawlerHitTable {
	id: string;
	site_id: string;
	bot: string;
	category: "ai_answers" | "indexing" | "training" | "other";
	path: string | null;
	user_agent: string | null;
	country: string | null;
	timestamp: string;
}

export interface AscDailyMetricTable {
	id: string;
	site_id: string;
	app_id: string;
	date: string;
	units: number;
	proceeds: number;
	iap_units: number;
	iap_proceeds: number;
	proceeds_currency: string | null;
	impressions: number | null;
	page_views: number | null;
	paying_users: number | null;
	synced_at: string;
}

export interface AscDailyCountryTable {
	id: string;
	site_id: string;
	app_id: string;
	date: string;
	country: string;
	units: number;
	proceeds: number;
	customer_price: number | null;
	customer_currency: string | null;
	synced_at: string;
}

export interface KlikapaDatabase {
	events: EventTable;
	sessions: SessionTable;
	sites: SiteTable;
	users: UserTable;
	api_keys: ApiKeyTable;
	visitor_profiles: VisitorProfileTable;
	heatmap_clicks: HeatmapClickTable;
	heatmap_scrolls: HeatmapScrollTable;
	session_recordings: SessionRecordingTable;
	heatmap_aggregates: HeatmapAggregateTable;
	integrations: IntegrationTable;
	crawler_hits: CrawlerHitTable;
	fx_rates: FxRateTable;
	fee_rules: FeeRuleTable;
	webhook_events: WebhookEventTable;
	ai_insights: AiInsightTable;
	subscriptions: SubscriptionTable;
	team_members: TeamMemberTable;
	push_devices: PushDeviceTable;
	push_prefs: PushPrefTable;
	push_outbox: PushOutboxTable;
	payment_providers: PaymentProviderTable;
	webhook_logs: WebhookLogTable;
	segments: SegmentTable;
	annotations: AnnotationTable;
	email_reports: EmailReportTable;
	search_console_data: SearchConsoleDataTable;
	asc_daily_metrics: AscDailyMetricTable;
	asc_daily_country: AscDailyCountryTable;
	marketplace_orders: MarketplaceOrderTable;
	affiliates: AffiliateTable;
	referrals: ReferralTable;
	pakasir_orders: PakasirOrderTable;
	webhook_dedupe: WebhookDedupeTable;
	account_usage: AccountUsageTable;
	password_resets: PasswordResetTable;
	email_verifications: EmailVerificationTable;
	login_attempts: LoginAttemptTable;
	account_links: AccountLinkTable;
	account_link_intents: AccountLinkIntentTable;
	account_link_flows: AccountLinkFlowTable;
}

export interface PasswordResetTable {
	id: string;
	user_id: string;
	/** SHA-256 of the emailed token; the plaintext is never stored. */
	token_hash: string;
	expires_at: string;
	used_at: string | null;
	created_at: string;
}

export interface EmailVerificationTable {
	id: string;
	user_id: string;
	token_hash: string;
	expires_at: string;
	used_at: string | null;
	created_at: string;
}

/** Two accounts one person proved they own; user_a < user_b always. */
export interface AccountLinkTable {
	id: string;
	user_a: string;
	user_b: string;
	created_at: string;
	created_by: string;
}

/** One-time, 10-minute proof that a signed-in user started a Google link flow. */
export interface AccountLinkIntentTable {
	token_hash: string;
	user_id: string;
	expires_at: string;
}

/** A Google link in progress: owner, starting browser, and (after consent) the account to link. */
export interface AccountLinkFlowTable {
	state_hash: string;
	owner_id: string;
	browser_hash: string;
	target_id: string | null;
	code_hash: string | null;
	expires_at: string;
}

/** Fixed-window attempt counters (login, password-reset requests). */
export interface LoginAttemptTable {
	key: string;
	count: number;
	window_start: string;
}

/** Monthly ingested-event counter per account (all sites of the owner). */
export interface AccountUsageTable {
	user_id: string;
	/** UTC calendar month, "YYYY-MM". */
	month: string;
	events: number;
}

export interface PakasirOrderTable {
	order_id: string;
	user_id: string;
	plan: string;
	amount: number;
	checkout_url: string;
	status: "pending" | "completed";
	created_at: string;
	processed_at: string | null;
}

/** Idempotency keys for webhook deliveries and payment records. */
export interface WebhookDedupeTable {
	key: string;
	created_at: string;
}

export interface HeatmapClickTable {
	id: string;
	site_id: string;
	session_id: string;
	visitor_id: string;
	path: string;
	x: number;
	y: number;
	element_selector: string | null;
	element_text: string | null;
	viewport_width: number | null;
	timestamp: string;
}

export interface HeatmapScrollTable {
	id: string;
	site_id: string;
	session_id: string;
	visitor_id: string;
	path: string;
	max_scroll: number;
	viewport_height: number | null;
	doc_height: number | null;
	timestamp: string;
}

export interface SessionRecordingTable {
	id: string;
	site_id: string;
	session_id: string;
	visitor_id: string;
	path: string;
	events: string;
	duration: number;
	viewport_width: number | null;
	viewport_height: number | null;
	started_at: string;
	ended_at: string | null;
}

export interface HeatmapAggregateTable {
	id: string;
	site_id: string;
	path: string;
	period: string;
	click_grid: string;
	scroll_depths: string;
	total_sessions: number;
	total_clicks: number;
	updated_at: string;
}

export interface IntegrationTable {
	id: string;
	site_id: string;
	user_id: string;
	type: string;
	name: string;
	config: string;
	enabled: number;
	last_sync: string | null;
	/** Newest day whose report was fully synced (appstoreconnect only); the next run resumes after it. */
	synced_through?: string | null;
	created_at: string;
}

export interface WebhookEventTable {
	id: string;
	site_id: string;
	integration_id: string;
	direction: string;
	event_type: string;
	payload: string;
	status: string;
	attempts: number;
	created_at: string;
	processed_at: string | null;
}

export interface AiInsightTable {
	id: string;
	site_id: string;
	range: string;
	insight_type: string;
	insight_text: string;
	data_refs: string | null;
	confidence: number;
	created_at: string;
	expires_at: string;
}

export interface SubscriptionTable {
	id: string;
	user_id: string;
	plan: string;
	status: string;
	current_period_start: string;
	current_period_end: string;
	cancel_at_period_end: number;
	polar_subscription_id: string | null;
	polar_customer_id: string | null;
	// Legacy: last QRIS order id. New orders live in pakasir_orders.
	pakasir_order_id: string | null;
	/** End of the period bought via QRIS; Polar events never cut access below it. */
	pakasir_paid_until?: string | null;
	created_at: string;
	updated_at: string;
}

export interface TeamMemberTable {
	id: string;
	site_id: string;
	user_id: string;
	role: string;
	invited_by: string;
	invited_at: string;
	accepted_at: string | null;
}

export interface PushDeviceTable {
	id: string;
	user_id: string;
	/** `ExponentPushToken[...]`; unique, the last user to register it owns it. */
	expo_token: string;
	platform: string;
	locale: string | null;
	app_version: string | null;
	created_at: string;
	last_seen_at: string;
}

export interface PushPrefTable {
	user_id: string;
	/** 1/0: alert on every sale. */
	sales: number;
	/** 1/0: alert on every refund. */
	refunds: number;
	updated_at: string;
}

export interface PushOutboxTable {
	id: string;
	user_id: string;
	event_id: string;
	/** JSON `{ title, body, data }` of the Expo message, minus the recipient token. */
	payload: string;
	status: "queued" | "sent" | "failed";
	attempts: number;
	/** JSON `[{ t: ticketId, d: deviceId }]` of accepted sends, until their receipts are read. */
	tickets_json: string | null;
	created_at: string;
	sent_at: string | null;
}

export interface SearchConsoleDataTable {
	id: string;
	site_id: string;
	date: string;
	query: string;
	clicks: number;
	impressions: number;
	ctr: number;
	position: number;
	fetched_at: string;
}

export interface MarketplaceOrderTable {
	id: string;
	site_id: string;
	marketplace: string;
	order_id: string;
	order_sn: string;
	amount: number;
	currency: string;
	status: string;
	buyer_info: string | null;
	items: string | null;
	ordered_at: string;
	synced_at: string;
}

export interface AffiliateTable {
	id: string;
	user_id: string;
	referral_code: string;
	commission_rate: number;
	total_earned: number;
	total_paid: number;
	status: string;
	created_at: string;
}

export interface ReferralTable {
	id: string;
	affiliate_id: string;
	referred_user_id: string;
	event: string;
	commission_amount: number;
	status: string;
	/** Payment id a commission was earned on (idempotency key); null for signups. */
	source_ref?: string | null;
	created_at: string;
}
