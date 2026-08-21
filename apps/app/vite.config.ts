import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		// Order matters: tanstackRouter before react; cloudflare LAST
		tanstackRouter({
			target: "react",
			routesDirectory: "./src/client/routes",
			generatedRouteTree: "./src/client/routeTree.gen.ts",
			autoCodeSplitting: true,
		}),
		react(),
		tailwindcss(),
		// Local bindings by default (D1 via miniflare); plugin >=1.53 defaults to
		// remote bindings which requires interactive account selection.
		cloudflare({ remoteBindings: false }),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src/client"),
		},
		dedupe: ["react", "react-dom"],
	},
	// No server.proxy — the cloudflare plugin serves the worker (with real
	// D1/EMAIL/AI bindings via miniflare) on the vite dev server itself.
	base: process.env.VITE_MOBILE ? "./" : "/",
	define: process.env.VITE_MOBILE
		? {
				"import.meta.env.VITE_API_BASE": JSON.stringify(
					"https://app.revklik.com/api",
				),
			}
		: undefined,
	build: {
		chunkSizeWarningLimit: 1000,
	},
});
