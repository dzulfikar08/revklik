/**
 * The "confirm your email" message: a table-based HTML part with inline CSS
 * (so mail clients keep it), a dark-mode override for clients that honour
 * prefers-color-scheme, and a plain-text part. Written in Bahasa Indonesia or
 * English; the language comes from the client, not from stored user data.
 */

export type EmailLang = "id" | "en";

const BRAND_ORANGE = "#F99D4E";
const BRAND_INK = "#0b0e14";
const ON_ORANGE = "#1b1305";
const DOCS_GETTING_STARTED: Record<EmailLang, string> = {
	en: "https://docs.revklik.com/getting-started/",
	id: "https://docs.revklik.com/id/getting-started/",
};

interface Copy {
	subject: string;
	preheader: (hours: number) => string;
	heading: string;
	intro: string;
	button: string;
	fallback: string;
	expiry: (hours: number) => string;
	nextTitle: string;
	nextBody: string;
	nextLink: string;
	reason: string;
}

const COPY: Record<EmailLang, Copy> = {
	en: {
		button: "Confirm email",
		expiry: (hours) => `This link is valid for ${hours} hours and works once.`,
		fallback: "If the button doesn't work, copy this link into your browser:",
		heading: "Confirm your email",
		intro:
			"Thanks for signing up for RevKlik. Click the button below to confirm this address is yours.",
		nextBody: "Add the RevKlik script to your site so your first data starts coming in.",
		nextLink: "Getting started guide",
		nextTitle: "Next: install the script",
		preheader: (hours) =>
			`One click to confirm your email address. The link is valid for ${hours} hours.`,
		reason:
			"You are receiving this because someone signed up for RevKlik with this address. If that wasn't you, you can ignore this email.",
		subject: "Confirm your RevKlik email",
	},
	id: {
		button: "Konfirmasi email",
		expiry: (hours) => `Link ini berlaku ${hours} jam dan hanya bisa dipakai sekali.`,
		fallback: "Jika tombol tidak berfungsi, salin link ini ke browser Anda:",
		heading: "Konfirmasi email Anda",
		intro:
			"Terima kasih sudah mendaftar di RevKlik. Klik tombol di bawah untuk memastikan alamat email ini milik Anda.",
		nextBody: "Pasang script RevKlik di situs Anda agar data pertama mulai masuk.",
		nextLink: "Panduan memulai",
		nextTitle: "Berikutnya: pasang script",
		preheader: (hours) =>
			`Satu klik untuk mengonfirmasi alamat email Anda. Link berlaku ${hours} jam.`,
		reason:
			"Anda menerima email ini karena seseorang mendaftar di RevKlik dengan alamat ini. Jika itu bukan Anda, abaikan saja email ini.",
		subject: "Konfirmasi email RevKlik",
	},
};

const ACCEPT_LANGUAGE_TAG = /^(id|en)(?:-|$)/iu;

/**
 * Pick the email language: the `lang` the app sent wins (it is the language
 * the visitor was reading), then the first Accept-Language tag that is
 * Indonesian or English, then English.
 */
export function resolveEmailLang(bodyLang: unknown, acceptLanguage?: string | null): EmailLang {
	if (bodyLang === "id" || bodyLang === "en") return bodyLang;
	for (const part of (acceptLanguage ?? "").split(",")) {
		const tag = ACCEPT_LANGUAGE_TAG.exec(part.split(";")[0]?.trim() ?? "");
		if (tag) return tag[1]?.toLowerCase() === "id" ? "id" : "en";
	}
	return "en";
}

/** A bare `EMAIL_FROM` address gets the RevKlik display name; named senders are left alone. */
export function brandedFrom(from: string | undefined): string | undefined {
	const trimmed = from?.trim();
	if (!trimmed) return undefined;
	return trimmed.includes("<") ? trimmed : `RevKlik <${trimmed}>`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export interface VerificationEmailInput {
	/** The single-use verify link. */
	link: string;
	lang: EmailLang;
	/** How long the link works, in hours (shown to the reader). */
	ttlHours: number;
	/** Public origin of this deployment; the logo is read from `<origin>/logo.png`. */
	origin: string;
}

export interface VerificationEmail {
	subject: string;
	html: string;
	text: string;
}

export function buildVerificationEmail(input: VerificationEmailInput): VerificationEmail {
	const { lang, link, ttlHours, origin } = input;
	const c = COPY[lang];
	const docs = DOCS_GETTING_STARTED[lang];
	const safeLink = escapeHtml(link);
	const expiry = c.expiry(ttlHours);

	const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(c.subject)}</title>
<style>
@media (prefers-color-scheme: dark) {
  .rk-page { background-color: #07090d !important; }
  .rk-card { background-color: #13181f !important; }
  .rk-text { color: #edf0f4 !important; }
  .rk-muted { color: #a7adb7 !important; }
  .rk-rule { border-top-color: #242931 !important; }
  .rk-link { color: ${BRAND_ORANGE} !important; }
}
</style>
</head>
<body class="rk-page" style="margin:0;padding:0;background-color:#f4f3ef;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(c.preheader(ttlHours))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="rk-page" style="background-color:#f4f3ef;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="background-color:${BRAND_INK};border-radius:12px 12px 0 0;padding:20px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding-right:12px;"><img src="${escapeHtml(origin)}/logo.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:8px;"></td>
<td style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:${BRAND_ORANGE};letter-spacing:-0.2px;">RevKlik</td>
</tr></table>
</td></tr>
<tr><td class="rk-card" style="background-color:#ffffff;border-radius:0 0 12px 12px;padding:32px 28px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<h1 class="rk-text" style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;color:#1b1f27;">${escapeHtml(c.heading)}</h1>
<p class="rk-text" style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#1b1f27;">${escapeHtml(c.intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${BRAND_ORANGE}" style="background-color:${BRAND_ORANGE};border-radius:8px;"><a href="${safeLink}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:${ON_ORANGE};text-decoration:none;border-radius:8px;">${escapeHtml(c.button)}</a></td>
</tr></table>
<p class="rk-muted" style="margin:24px 0 6px;font-size:13px;line-height:1.6;color:#5b6270;">${escapeHtml(c.fallback)}</p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${safeLink}" class="rk-link" style="color:#b45309;">${safeLink}</a></p>
<p class="rk-muted" style="margin:0;font-size:13px;line-height:1.6;color:#5b6270;">${escapeHtml(expiry)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr>
<td class="rk-rule" style="border-top:1px solid #e4e2dc;padding-top:20px;">
<p class="rk-text" style="margin:0 0 6px;font-size:15px;font-weight:600;color:#1b1f27;">${escapeHtml(c.nextTitle)}</p>
<p class="rk-muted" style="margin:0;font-size:14px;line-height:1.6;color:#5b6270;">${escapeHtml(c.nextBody)} <a href="${docs}" class="rk-link" style="color:#b45309;font-weight:600;">${escapeHtml(c.nextLink)}</a></p>
</td></tr></table>
</td></tr>
<tr><td style="padding:16px 8px 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<p class="rk-muted" style="margin:0;font-size:12px;line-height:1.6;color:#5b6270;">${escapeHtml(c.reason)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

	const text = [
		c.heading,
		"",
		c.intro,
		"",
		`${c.button}: ${link}`,
		"",
		expiry,
		"",
		c.nextTitle,
		`${c.nextBody} ${c.nextLink}: ${docs}`,
		"",
		c.reason,
		"",
		"RevKlik",
	].join("\n");

	return { html, subject: c.subject, text };
}
