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
			// index.html there renders the app's 404 instead of the redirect.
			workbox: {
				navigateFallbackDenylist: [/^\/api\//],
				skipWaiting: true,
				clientsClaim: true,
			},
			manifest: {
				name: "revklik",
				short_name: "revklik",
				description: "revklik — privacy-friendly web analytics",
				theme_color: "#0c0c0c",
			},
			pwaAssets: { disabled: false, config: true },
			devOptions: { enabled: true },
		}),
	],
});
