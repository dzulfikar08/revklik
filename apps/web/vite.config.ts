import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	server: {
		port: 3001,
	},
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [
		tailwindcss(),
		tanstackRouter({
			target: "react",
			autoCodeSplitting: true,
		}),
		react(),
		VitePWA({
			registerType: "autoUpdate",
			// Navigate-fallback must never swallow API endpoints: Google OAuth
			// starts with a full-page navigation to /api/auth/google, and a cached
			// index.html there renders the app's 404 instead of the redirect. The same
			// goes for /oauth/authorize, the Books sign-in page the worker answers.
			workbox: {
				// Embedded pages (landing demo, public dashboards) always load the deployed shell.
				navigateFallbackDenylist: [/^\/api\//, /^\/oauth\//, /^\/demo/, /^\/public\//],
				// Precache includes hashed CSS and the font; old caches are dropped on each new SW.
				globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
				cleanupOutdatedCaches: true,
				skipWaiting: true,
				clientsClaim: true,
			},
			manifest: {
				name: "RevKlik",
				short_name: "RevKlik",
				description: "RevKlik: privacy-friendly web analytics",
				theme_color: "#0c0c0c",
			},
			pwaAssets: { disabled: false, config: true },
			devOptions: { enabled: true },
		}),
	],
});
