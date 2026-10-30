import { unified } from '@astrojs/markdown-remark';
import { defineConfig } from 'astro/config';
import { rehypeInlineCta } from './src/plugins/rehype-inline-cta.ts';

// Cloudflare Pages serves `x.html` at `/x` and `dir/index.html` at `/dir/`.
// `format: 'preserve'` makes every page except the two locale homes extensionless
// with no trailing slash, which is the URL shape canonical/hreflang/sitemap use
// (see src/data/seo.ts). `inlineStylesheets: 'never'` + is:inline scripts keep
// the shipped JS/CSS as plain files.
export default defineConfig({
  site: 'https://revklik.com',
  trailingSlash: 'ignore',
  build: {
    format: 'preserve',
    inlineStylesheets: 'never',
  },
  compressHTML: false,
  markdown: {
    processor: unified({ rehypePlugins: [rehypeInlineCta] }),
  },
});
