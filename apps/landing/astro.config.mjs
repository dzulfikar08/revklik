import { defineConfig } from 'astro/config';

// Parity-safe settings (same doctrine as voltrus-landing):
// - build.format: 'directory' -> src pages emit dir/index.html; public/ flat .html
//   (blog posts, docs) copied verbatim and served by Cloudflare Pages pretty URLs.
// - inlineStylesheets: 'never' + is:inline scripts -> Astro never extracts/bundles,
//   so the page ships the same hand-written JS/CSS as the old static site.
export default defineConfig({
  site: 'https://revklik.com',
  build: {
    format: 'directory',
    inlineStylesheets: 'never',
  },
  compressHTML: false,
});
