import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// Worker-only dev server: the old TanStack SPA (src/client) was removed at
// cutover — the dashboard now lives in the revklik-new repo and ships as
// worker assets (see scripts/deploy-new-ui.sh in the repo root).
export default defineConfig({
	plugins: [
		// Local bindings by default (D1 via miniflare); plugin >=1.53 defaults to
		// remote bindings which requires interactive account selection.
		cloudflare({ remoteBindings: false }),
	],
});
