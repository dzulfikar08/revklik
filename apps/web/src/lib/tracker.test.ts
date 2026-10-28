import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadAuthTracker, SELF_SITE_ID } from "./tracker";

const VID = "4f7c2a9e-1b3d-4c5e-8f60-123456789abc";
const SID = "0a1b2c3d-4e5f-4a6b-9c7d-0123456789ab";

const instance = vi.hoisted(() => ({ selfHosted: false }));
vi.mock("./instance-config", () => ({ isSelfHosted: () => instance.selfHosted }));

// happy-dom refuses to run external scripts and logs a stack trace; capture instead.
let appended: HTMLScriptElement[] = [];

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	delete document.documentElement.dataset.rkTracker;
	instance.selfHosted = false;
	appended = [];
	vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
		appended.push(...(nodes as HTMLScriptElement[]));
	});
});

describe("loadAuthTracker", () => {
	it("injects the tracker for the revklik.com site and adopts the journey ids", () => {
		loadAuthTracker({ sessionId: SID, visitorId: VID });
		const script = appended[0];
		expect(script?.getAttribute("src")).toBe("/klikapa.js");
		expect(script?.getAttribute("data-site-id")).toBe(SELF_SITE_ID);
		expect(localStorage.getItem("_kp_vid")).toBe(VID);
		expect(sessionStorage.getItem("_kp_sid")).toBe(SID);
	});

	it("ignores malformed ids and keeps the tracker's own", () => {
		localStorage.setItem("_kp_vid", "own");
		loadAuthTracker({ sessionId: "nope", visitorId: "<script>" });
		expect(localStorage.getItem("_kp_vid")).toBe("own");
		expect(sessionStorage.getItem("_kp_sid")).toBeNull();
	});

	it("loads once per page", () => {
		loadAuthTracker();
		loadAuthTracker();
		expect(appended).toHaveLength(1);
	});

	it("does nothing on self-hosted installs", () => {
		instance.selfHosted = true;
		loadAuthTracker({ visitorId: VID });
		expect(appended).toHaveLength(0);
		expect(localStorage.getItem("_kp_vid")).toBeNull();
	});
});
