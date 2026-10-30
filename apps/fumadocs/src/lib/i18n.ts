import { defineI18nUI } from "fumadocs-ui/i18n";

export const LANGUAGES = ["en", "id"] as const;
export type Locale = (typeof LANGUAGES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Fumadocs UI strings in Bahasa Indonesia. Keys are the library's own message keys. */
const ID_UI_STRINGS = {
	displayName: "Bahasa Indonesia",
	"Back to Home(404 not found page)": "Kembali ke beranda",
	"Choose a language(language switcher)": "Pilih bahasa",
	"Choose a language(language switcher)(aria-label)": "Pilih bahasa",
	"Close Banner(banner)(aria-label)": "Tutup banner",
	"Close Search(search dialog)(aria-label)": "Tutup pencarian",
	"Close Sidebar(aria-label)": "Tutup sidebar",
	"Close Sidebar(sidebar)(aria-label)": "Tutup sidebar",
	"Collapse Sidebar(sidebar)(aria-label)": "Ciutkan sidebar",
	"Copied Text(code block)(aria-label)": "Teks tersalin",
	"Copy Anchor Link(heading anchor)(aria-label)": "Salin tautan judul",
	"Copy Link(accordion)(aria-label)": "Salin tautan",
	"Copy Markdown(page actions)": "Salin Markdown",
	"Copy Text(code block)(aria-label)": "Salin teks",
	"Default(type table)": "Bawaan",
	"Edit on GitHub(edit page)": "Edit di GitHub",
	"Hide Sidebar(sidebar)": "Sembunyikan sidebar",
	"Last updated on(page footer)": "Terakhir diperbarui",
	"Next Page(pagination)": "Halaman berikutnya",
	"No Headings(table of contents)": "Tidak ada judul",
	"No results found(search dialog)": "Tidak ada hasil",
	"On this page(table of contents)": "Di halaman ini",
	"Open Search(search trigger)(aria-label)": "Buka pencarian",
	"Open Sidebar(aria-label)": "Buka sidebar",
	"Open Sidebar(sidebar)(aria-label)": "Buka sidebar",
	"Page Not Found(404 not found page)": "Halaman tidak ditemukan",
	"Parameters(type table)": "Parameter",
	"Previous Page(pagination)": "Halaman sebelumnya",
	"Prop(type table)": "Properti",
	"Returns(type table)": "Hasil",
	"Search(search dialog)": "Cari",
	"Search(search trigger)": "Cari",
	"Show Sidebar(sidebar)": "Tampilkan sidebar",
	"Table of Contents(inline table of contents)": "Daftar isi",
	"Type(type table)": "Tipe",
	"View as Markdown(page actions)": "Lihat sebagai Markdown",
} as const;

/**
 * Single i18n definition shared by the loader, the layout and the search API.
 * English is served at `/<slug>/`, Bahasa Indonesia at `/id/<slug>/`.
 */
export const i18n = defineI18nUI(
	{
		languages: [...LANGUAGES],
		defaultLanguage: DEFAULT_LOCALE,
		hideLocale: "default-locale",
		parser: "dot",
	},
	{
		en: { displayName: "English" },
		id: { ...ID_UI_STRINGS },
	},
);

/** Short labels for the EN/ID switch in the docs navigation. */
export const LOCALE_LABELS: Record<Locale, { short: string; name: string; htmlLang: string }> = {
	en: { short: "EN", name: "English", htmlLang: "en" },
	id: { short: "ID", name: "Bahasa Indonesia", htmlLang: "id" },
};

export function isLocale(value: string | undefined): value is Locale {
	return LANGUAGES.some((language) => language === value);
}

/** Path prefix for a locale: empty for the default language, `/id` for Indonesian. */
export function localePrefix(locale: string): string {
	return locale === DEFAULT_LOCALE ? "" : `/${locale}`;
}

const FILE_LIKE = /\.[a-z0-9]+$/i;

/** Add the trailing slash Astro serves (`trailingSlash: "always"`); leaves the root, hashes and queries intact. */
export function withTrailingSlash(href: string): string {
	const match = /^([^#?]*)(.*)$/.exec(href);
	const path = match?.[1] ?? href;
	const rest = match?.[2] ?? "";

	if (path === "" || path.endsWith("/") || FILE_LIKE.test(path)) return href;

	return `${path}/${rest}`;
}
