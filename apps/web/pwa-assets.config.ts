import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// public/logo.png is already the full-bleed icon (dark tile, mark inside the maskable safe zone),
// so no preset adds padding or a white backdrop. favicon.ico (16/32/48) is committed by hand:
// the generator can only emit a single size.
const preset = {
	...minimal2023Preset,
	transparent: { ...minimal2023Preset.transparent, padding: 0, favicons: [] },
	maskable: { ...minimal2023Preset.maskable, padding: 0 },
	apple: { ...minimal2023Preset.apple, padding: 0 },
};

export default defineConfig({
	headLinkOptions: {
		preset: "2023",
	},
	preset,
	images: ["public/logo.png"],
});
