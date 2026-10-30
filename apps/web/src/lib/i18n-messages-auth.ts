/**
 * Strings for the sign-up, sign-in, reset and verify pages that sit on top of
 * the base dictionary in ./i18n-messages. Indonesian uses "Anda" throughout
 * the auth flow. Merged into MESSAGES by i18n-messages.ts.
 */

export const authEn = {
	"auth.pageTitle.signUp": "Create account",
	"auth.pageTitle.signIn": "Sign in",
	"auth.pageTitle.verify": "Verify email",
	"auth.pageTitle.reset": "Reset password",

	"auth.orEmail": "or with email",
	"auth.emailPlaceholder": "you@example.com",
	"auth.passwordHint": "At least 8 characters.",
	"auth.showPassword": "Show password",

	"auth.err.nameRequired": "Enter your name.",
	"auth.err.emailRequired": "Enter your email address.",
	"auth.err.emailInvalid": "That email address doesn't look right. Example: name@company.com",
	"auth.err.passwordRequired": "Enter a password.",
	"auth.err.passwordShort": "The password needs at least 8 characters.",
	"auth.err.invalidCredentials": "Wrong email or password.",
	"auth.err.emailTaken":
		"That email already has an account. Sign in with it, or use another email.",

	"auth.consent.before": "By creating an account, you agree to the",
	"auth.consent.terms": "Terms",
	"auth.consent.and": "and the",
	"auth.consent.privacy": "Privacy Policy",

	"auth.value.title": "What you get for 7 days",
	"auth.value.attribution":
		"Revenue attribution: see which channel brings the payments in your gateway.",
	"auth.value.funnels": "Scroll funnels and visitor journeys, session by session.",
	"auth.value.replay": "Heatmaps and session recordings that show where visitors drop off.",

	"auth.logoHome": "RevKlik home page",
	"auth.footer.label": "Legal and help links",
	"auth.footer.privacy": "Privacy",
	"auth.footer.terms": "Terms",
	"auth.footer.support": "Support",
	"auth.footer.docs": "Docs",
} as const;

export const authId: Record<keyof typeof authEn, string> = {
	"auth.pageTitle.signUp": "Buat akun",
	"auth.pageTitle.signIn": "Masuk",
	"auth.pageTitle.verify": "Verifikasi email",
	"auth.pageTitle.reset": "Atur ulang kata sandi",

	"auth.orEmail": "atau dengan email",
	"auth.emailPlaceholder": "nama@perusahaan.com",
	"auth.passwordHint": "Minimal 8 karakter.",
	"auth.showPassword": "Tampilkan kata sandi",

	"auth.err.nameRequired": "Isi nama Anda.",
	"auth.err.emailRequired": "Isi alamat email Anda.",
	"auth.err.emailInvalid": "Alamat email belum valid. Contoh: nama@perusahaan.com",
	"auth.err.passwordRequired": "Isi kata sandi.",
	"auth.err.passwordShort": "Kata sandi minimal 8 karakter.",
	"auth.err.invalidCredentials": "Email atau kata sandi salah.",
	"auth.err.emailTaken":
		"Email ini sudah punya akun. Masuk dengan email tersebut, atau pakai email lain.",

	"auth.consent.before": "Dengan mendaftar, Anda menyetujui",
	"auth.consent.terms": "Ketentuan",
	"auth.consent.and": "dan",
	"auth.consent.privacy": "Kebijakan Privasi",

	"auth.value.title": "Yang Anda dapat selama 7 hari",
	"auth.value.attribution":
		"Atribusi pendapatan: lihat channel mana yang membawa pembayaran di gateway Anda.",
	"auth.value.funnels": "Funnel scroll dan perjalanan pengunjung, sesi demi sesi.",
	"auth.value.replay": "Heatmap dan rekaman sesi untuk melihat di mana pengunjung berhenti.",

	"auth.logoHome": "Beranda RevKlik",
	"auth.footer.label": "Tautan legal dan bantuan",
	"auth.footer.privacy": "Privasi",
	"auth.footer.terms": "Ketentuan",
	"auth.footer.support": "Dukungan",
	"auth.footer.docs": "Docs",
};
