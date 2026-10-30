/**
 * Regression: "What sells" rows filtered by the event `path`, so a sale booked on
 * /checkout showed 0 for the /pricing row that brought the buyer in. Rows and the
 * "Only this page" next step now filter by the session's entry page.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteDashboard } from "@/lib/legacy/api";
import { translate } from "@/lib/i18n";

import { SellsPanel } from "./breakdown-panels";
import { FILTER_DIMS } from "./data";
import { NextStepsCard } from "./home-view";

const dash = {
	currency: "IDR",
	entryPagesRevenue: [{ conversions: 2, path: "/pricing", revenue: 150_000, sessions: 9 }],
	exitPages: [],
	topPages: [],
} as unknown as SiteDashboard;

describe("entry page filter", () => {
	let container: HTMLDivElement;

	beforeEach(() => {
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.append(container);
	});

	afterEach(() => {
		container.remove();
	});

	it("a What sells revenue row toggles the entry_path dimension", async () => {
		const onToggle = vi.fn();
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<SellsPanel
					state={{ dash, error: null, loading: false, onRetry: () => undefined, retrying: false }}
					handle={{ filters: [], onToggle }}
				/>,
			);
		});
		const row = [...container.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("/pricing"),
		);
		expect(row).toBeDefined();
		await act(async () => row?.click());
		expect(onToggle).toHaveBeenCalledWith("entry_path", "/pricing");
		await act(async () => root.unmount());
	});

	it("the 'Only this page' next step filters by entry page", async () => {
		const onAction = vi.fn();
		const root = createRoot(container);
		await act(async () => {
			root.render(
				<NextStepsCard
					steps={[{ id: "bestPage", path: "/pricing", sales: 2 }]}
					onAction={onAction}
				/>,
			);
		});
		const button = [...container.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Only this page"),
		);
		expect(button).toBeDefined();
		await act(async () => button?.click());
		expect(onAction).toHaveBeenCalledWith({
			dimension: "entry_path",
			kind: "filter",
			value: "/pricing",
		});
		await act(async () => root.unmount());
	});

	it("offers the dimension in the builder with an English and an Indonesian label", () => {
		const dim = FILTER_DIMS.find((d) => d.value === "entry_path");
		expect(dim?.label).toBe("fdim.entry_path");
		expect(translate("en", "fdim.entry_path")).toBe("Entry page");
		expect(translate("id", "fdim.entry_path")).toBe("Halaman masuk");
	});
});
