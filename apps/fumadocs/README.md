# fumadocs

RevKlik docs: Astro + Fumadocs, content in `content/docs`.

```bash
bun run dev      # http://localhost:4000
bun run build
bun run lint
```

## Languages

English is the default and lives at `/<slug>/`. Bahasa Indonesia lives at `/id/<slug>/`.
Locale files use the dot convention: `getting-started.mdx` is English,
`getting-started.id.mdx` is Indonesian, and `dashboard/meta.id.json` translates a
folder title. Write Indonesian in the "Anda" register.

- A page without an `.id.mdx` twin is still served under `/id/` with its English body,
  a notice, a canonical pointing at the English page, and no sitemap entry.
- Keep heading anchors identical across languages with a custom id: `## Judul [#english-slug]`.
  Links between pages use the served URL (`/id/billing`, trailing slash is added at build).
- Pages that exist in both languages get `hreflang` links (`en`, `id`, `x-default`) in the
  head and the sitemap. `src/lib/i18n.ts` holds the language list and the Indonesian UI strings.

## URLs

`trailingSlash: "always"` and `build.format: "directory"`: every page is served at `/<slug>/`
and the canonical URL matches. `src/pages/404.astro` becomes `404.html` for Cloudflare Pages
(noindex, not in the sitemap). Renamed pages need a line in `public/_redirects`.

## MDX components

- `<Tabs label="Framework"><Tab value="Next.js">...</Tab></Tabs>` is CSS-only (radio inputs).
  The docs body is static HTML inside a React island, so client-side tab state would break
  hydration.
- Code blocks get a copy button wired by `src/scripts/enhance.ts`.
