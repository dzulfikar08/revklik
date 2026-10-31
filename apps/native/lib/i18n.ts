/**
 * Minimal English / Bahasa Indonesia strings for the screens that carry the
 * money figures and account actions. The web app's wording for the shared
 * labels (apps/web/src/lib/i18n-messages-shell.ts) is reused verbatim so the
 * same number reads the same on both. Language follows the device locale
 * (Indonesian when it starts with `id`, English otherwise).
 */

export type Lang = "en" | "id";

const detectLang = (): Lang => {
	try {
		const tag = Intl.DateTimeFormat().resolvedOptions().locale;
		return tag.toLowerCase().startsWith("id") ? "id" : "en";
	} catch {
		return "en";
	}
};

export const lang: Lang = detectLang();

/** BCP-47 tag for number and date formatting; Indonesian groups with dots. */
export const numberLocale: string = lang === "id" ? "id-ID" : "en-US";

const en = {
	"account.delete": "Delete account",
	"account.deleteBody":
		"Permanently deletes your account, sites and analytics data, and cancels your subscription. This cannot be undone.",
	"account.deleteConfirmEmail": "Type your email to confirm",
	"account.deleteFailed": "Couldn't delete the account",
	"account.deletePassword": "Current password",
	"account.deleteRunning": "Deleting your data. This can take a moment for large accounts.",
	"account.deleteTitle": "Delete your account?",
	"account.books": "RevKlik Books",
	"account.booksHint": "Sign in to bookkeeping with your RevKlik account",
	"auth.consentBefore": "By creating an account, you agree to the",
	"auth.consentTerms": "Terms",
	"auth.consentAnd": "and the",
	"auth.consentPrivacy": "Privacy Policy",
	"common.cancel": "Cancel",
	"common.tryAgain": "Try again",
	"dash.bounce": "Bounce rate",
	"dash.duration": "Visit duration",
	"dash.gross": "Gross revenue",
	"dash.net": "Net after fees",
	"dash.est": "est.",
	"dash.pageviews": "Pageviews",
	"dash.sales": "Sales",
	"dash.visitors": "Visitors",
	"dash.visitorToSale": "Visitor to sale",
	"dash.visitorToSaleNote": "{sales} of {visitors} visitors",
	"dash.noPrevious": "Nothing earlier to compare",
	"dash.noRevenue": "No revenue in this range.",
	"dash.campaignConvert": "{rate}% convert",
	"earn.title": "Earnings",
	"earn.subtitleAll": "All products, net of fees",
	"earn.subtitleRange": "{from} → {to} · all products",
	"earn.net": "Net after fees",
	"earn.gross": "Gross revenue",
	"earn.sales": "Sales",
	"earn.refunds": "Refunds",
	"earn.today": "Today",
	"earn.month": "This month",
	"earn.auto": "Auto",
	"earn.loadFailed": "Couldn't load earnings",
	"earn.noSales": "No sales in this range",
	"earn.noSalesBody":
		"Sales and refunds from every product show up here as soon as they are forwarded to RevKlik.",
	"earn.daily": "Daily",
	"earn.byProduct": "By product",
	"earn.byRail": "By payment rail",
	"earn.recent": "Recent sales",
	"earn.noProduct": "No product revenue.",
	"earn.noRail": "No rail data.",
	"earn.refund": "Refund",
	"earn.sale": "Sale",
	"earn.netShort": "net {amount}",
	"err.forbidden": "Your role on this site can't do that.",
	"err.generic": "Request failed ({status})",
	"err.rateLimited": "Too many attempts. Wait a minute and try again.",
	"err.server": "Something went wrong on our side. Try again in a moment.",
	"err.subscription": "This account's trial or subscription has ended. Renew it on the web.",
	"err.passwordInvalid": "That password is wrong.",
	"err.emailMismatch": "That doesn't match your account email.",
	"err.recentLogin": "Sign in again, then retry.",
	"err.billingCancel": "Couldn't cancel your subscription, so nothing was deleted. Try again.",
} as const;

export type MessageKey = keyof typeof en;

const id: Record<MessageKey, string> = {
	"account.delete": "Hapus akun",
	"account.deleteBody":
		"Menghapus akun, situs, dan data analitik Anda secara permanen, serta membatalkan langganan. Tindakan ini tidak bisa dibatalkan.",
	"account.deleteConfirmEmail": "Ketik email Anda untuk konfirmasi",
	"account.deleteFailed": "Akun tidak bisa dihapus",
	"account.deletePassword": "Kata sandi saat ini",
	"account.deleteRunning": "Data Anda sedang dihapus. Akun besar bisa butuh beberapa saat.",
	"account.deleteTitle": "Hapus akun Anda?",
	"account.books": "RevKlik Books",
	"account.booksHint": "Masuk ke pembukuan dengan akun RevKlik Anda",
	"auth.consentBefore": "Dengan mendaftar, Anda menyetujui",
	"auth.consentTerms": "Ketentuan",
	"auth.consentAnd": "dan",
	"auth.consentPrivacy": "Kebijakan Privasi",
	"common.cancel": "Batal",
	"common.tryAgain": "Coba lagi",
	"dash.bounce": "Bounce rate",
	"dash.duration": "Durasi kunjungan",
	"dash.gross": "Pendapatan kotor",
	"dash.net": "Bersih setelah biaya",
	"dash.est": "perkiraan",
	"dash.pageviews": "Tayangan halaman",
	"dash.sales": "Penjualan",
	"dash.visitors": "Pengunjung",
	"dash.visitorToSale": "Pengunjung jadi pembeli",
	"dash.visitorToSaleNote": "{sales} dari {visitors} pengunjung",
	"dash.noPrevious": "Belum ada data sebelumnya",
	"dash.noRevenue": "Belum ada pendapatan pada rentang ini.",
	"dash.campaignConvert": "{rate}% konversi",
	"earn.title": "Pendapatan",
	"earn.subtitleAll": "Semua produk, bersih setelah biaya",
	"earn.subtitleRange": "{from} → {to} · semua produk",
	"earn.net": "Bersih setelah biaya",
	"earn.gross": "Pendapatan kotor",
	"earn.sales": "Penjualan",
	"earn.refunds": "Refund",
	"earn.today": "Hari ini",
	"earn.month": "Bulan ini",
	"earn.auto": "Otomatis",
	"earn.loadFailed": "Pendapatan tidak bisa dimuat",
	"earn.noSales": "Belum ada penjualan pada rentang ini",
	"earn.noSalesBody":
		"Penjualan dan refund dari semua produk muncul di sini begitu diteruskan ke RevKlik.",
	"earn.daily": "Harian",
	"earn.byProduct": "Per produk",
	"earn.byRail": "Per metode pembayaran",
	"earn.recent": "Penjualan terbaru",
	"earn.noProduct": "Belum ada pendapatan produk.",
	"earn.noRail": "Belum ada data metode pembayaran.",
	"earn.refund": "Refund",
	"earn.sale": "Penjualan",
	"earn.netShort": "bersih {amount}",
	"err.forbidden": "Peran Anda di situs ini tidak bisa melakukan itu.",
	"err.generic": "Permintaan gagal ({status})",
	"err.rateLimited": "Terlalu banyak percobaan. Tunggu semenit lalu coba lagi.",
	"err.server": "Ada masalah di sisi kami. Coba lagi sebentar lagi.",
	"err.subscription": "Masa percobaan atau langganan akun ini sudah berakhir. Perpanjang di web.",
	"err.passwordInvalid": "Kata sandi salah.",
	"err.emailMismatch": "Tidak cocok dengan email akun Anda.",
	"err.recentLogin": "Masuk lagi, lalu coba ulang.",
	"err.billingCancel": "Langganan tidak bisa dibatalkan, jadi tidak ada yang dihapus. Coba lagi.",
};

const messages: Record<MessageKey, string> = lang === "id" ? id : en;

/** Marketing site: Indonesian at the root, English under /en (same as the web auth pages). */
export const marketingUrl = (path: "privacy" | "terms"): string =>
	`https://revklik.com${lang === "en" ? "/en" : ""}/${path}`;

export const t = (key: MessageKey, vars?: Record<string, string | number>): string => {
	const template = messages[key];
	if (!vars) {
		return template;
	}
	return template.replaceAll(/\{(\w+)\}/gu, (_, name: string) => `${vars[name] ?? ""}`);
};
