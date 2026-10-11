import { describe, expect, it } from "vitest";

import { daysUntil, parseCheckoutResult, parsePlan, subscriptionState } from "./billing";
import type { BillingSubscription, SubscriptionState } from "./billing";

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const DAY = 86_400_000;
const at = (offsetDays: number): string => new Date(NOW + offsetDays * DAY).toISOString();

const sub = (patch: Partial<BillingSubscription>): BillingSubscription => ({
	cancel_at_period_end: false,
	current_period_end: at(30),
	current_period_start: at(-1),
	id: "sub_1",
	plan: "growth",
	polar_customer_id: null,
	polar_subscription_id: null,
	status: "active",
	user_id: "u1",
	...patch,
});

describe("subscriptionState", () => {
	it.each<[string, Partial<BillingSubscription>, SubscriptionState]>([
		[
			"trial active (days from the API)",
			{ current_period_end: at(3), status: "trialing", trial_days_remaining: 3 },
			{ graceDaysLeft: 0, paidActive: false, trialDaysLeft: 3, trialEnded: false, trialing: true },
		],
		[
			"trial active (days computed from period end)",
			{ current_period_end: at(2.5), status: "trialing" },
			{ graceDaysLeft: 0, paidActive: false, trialDaysLeft: 3, trialEnded: false, trialing: true },
		],
		[
			"trial ended by date: 14-day grace counts from the end",
			{ current_period_end: at(-4), status: "trialing", trial_days_remaining: 0 },
			{ graceDaysLeft: 10, paidActive: false, trialDaysLeft: 0, trialEnded: true, trialing: true },
		],
		[
			"trial flagged expired by the API",
			{ current_period_end: at(1), status: "trialing", trial_expired: true },
			{ graceDaysLeft: 15, paidActive: false, trialDaysLeft: 0, trialEnded: true, trialing: true },
		],
		[
			"trial ended past the grace window",
			{ current_period_end: at(-20), status: "trialing" },
			{ graceDaysLeft: 0, paidActive: false, trialDaysLeft: 0, trialEnded: true, trialing: true },
		],
		[
			"canceled subscription inside grace",
			{ current_period_end: at(-3), status: "canceled" },
			{
				graceDaysLeft: 11,
				paidActive: false,
				trialDaysLeft: 0,
				trialEnded: false,
				trialing: false,
			},
		],
		[
			"paid and active",
			{ current_period_end: at(12), status: "active" },
			{ graceDaysLeft: 0, paidActive: true, trialDaysLeft: 0, trialEnded: false, trialing: false },
		],
		[
			"active status but the period is over",
			{ current_period_end: at(-1), status: "active" },
			{
				graceDaysLeft: 13,
				paidActive: false,
				trialDaysLeft: 0,
				trialEnded: false,
				trialing: false,
			},
		],
		[
			// No subscription row: the API fakes micro/active for 30 days with
			// id "". The state is "active"; the UI hides badges/cancel via `id`.
			'legacy account without a subscription row (id "")',
			{ current_period_end: at(30), id: "", plan: "micro", status: "active" },
			{ graceDaysLeft: 0, paidActive: true, trialDaysLeft: 0, trialEnded: false, trialing: false },
		],
	])("%s", (_name, patch, expected) => {
		expect(subscriptionState(sub(patch), NOW)).toEqual(expected);
	});
});

describe("daysUntil", () => {
	it.each<[string | null | undefined, number]>([
		[at(1), 1],
		[at(0.1), 1],
		[at(6.5), 7],
		[at(0), 0],
		[at(-2), 0],
		[null, 0],
		[undefined, 0],
		["not a date", 0],
	])("%s -> %d", (iso, expected) => {
		expect(daysUntil(iso, NOW)).toBe(expected);
	});
});

describe("search param parsers", () => {
	it.each([
		["growth", "growth"],
		["micro", "micro"],
		["GROWTH", undefined],
		["enterprise", undefined],
		[1, undefined],
		[undefined, undefined],
	])("parsePlan(%j) -> %j", (input, expected) => {
		expect(parsePlan(input)).toBe(expected);
	});

	it.each([
		["success", "success"],
		["pakasir_success", "pakasir_success"],
		["failed", undefined],
		[true, undefined],
	])("parseCheckoutResult(%j) -> %j", (input, expected) => {
		expect(parseCheckoutResult(input)).toBe(expected);
	});
});
