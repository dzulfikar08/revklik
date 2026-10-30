import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isSpaRoute } from "./spa-routes";

const ROUTES_DIR = join(import.meta.dir, "../../../../web/src/routes");

describe("isSpaRoute", () => {
	it("knows every route the dashboard defines", () => {
		const declared = readdirSync(ROUTES_DIR)
			.filter((f) => f.endsWith(".tsx") && !f.startsWith("__"))
			.map((f) => readFileSync(join(ROUTES_DIR, f), "utf8").match(/createFileRoute\("([^"]+)"\)/)?.[1])
			.filter((p): p is string => Boolean(p));
		expect(declared.length).toBeGreaterThan(5);
		for (const route of declared) {
			const path = route.replace(/\$[A-Za-z]+/g, "x");
			expect(isSpaRoute(path)).toBe(true);
		}
	});

	it("rejects paths the SPA does not serve", () => {
		for (const path of ["/nonexistent-xyz", "/register/extra", "/public", "/wp-login.php", "/index.html"]) {
			expect(isSpaRoute(path)).toBe(false);
		}
	});
});
