import { describe, expect, it } from "bun:test";
import { createMigratedTestApp, settleWaitUntil } from "./test-harness";
import {
	brandedFrom,
	buildVerificationEmail,
	resolveEmailLang,
	type EmailLang,
} from "./verification-email";

const LINK = "https://app.revklik.com/verify-email?token=abc123";
const EM_DASH = "\u2014";

const build = (lang: EmailLang) =>
	buildVerificationEmail({ lang, link: LINK, origin: "https://app.revklik.com", ttlHours: 48 });

describe("buildVerificationEmail", () => {
	it("is written in Indonesian with the docs guide in Bahasa", () => {
		const mail = build("id");
		expect(mail.subject).toBe("Konfirmasi email RevKlik");
		expect(mail.html).toContain('lang="id"');
		expect(mail.html).toContain("Berikutnya: pasang script");
		expect(mail.html).toContain("https://docs.revklik.com/id/getting-started/");
		expect(mail.text).toContain("https://docs.revklik.com/id/getting-started/");
		expect(mail.text).toContain("berlaku 48 jam");
	});

	it("is written in English with the English docs guide", () => {
		const mail = build("en");
		expect(mail.subject).toBe("Confirm your RevKlik email");
		expect(mail.html).toContain('lang="en"');
		expect(mail.html).toContain("Next: install the script");
		expect(mail.html).toContain('href="https://docs.revklik.com/getting-started/"');
		expect(mail.text).toContain("valid for 48 hours");
	});

	it.each<EmailLang>(["id", "en"])("keeps the link in both parts and no em dash (%s)", (lang) => {
		const mail = build(lang);
		expect(mail.html).toContain(`href="${LINK}"`);
		// The raw URL is also printed for clients that strip buttons.
		expect(mail.html).toContain(`>${LINK}</a>`);
		expect(mail.text).toContain(LINK);
		expect(`${mail.subject}${mail.html}${mail.text}`).not.toContain(EM_DASH);
	});

	it("escapes the link and reads the logo from the deployment origin", () => {
		const mail = buildVerificationEmail({
			lang: "en",
			link: 'https://x.test/verify-email?token="><script>',
			origin: "https://self.example.com",
			ttlHours: 24,
		});
		expect(mail.html).not.toContain("<script>");
		expect(mail.html).toContain('src="https://self.example.com/logo.png"');
		expect(mail.html).toContain("valid for 24 hours");
	});
});

describe("resolveEmailLang", () => {
	it("prefers the language the app sent", () => {
		expect(resolveEmailLang("id", "en-US,en;q=0.9")).toBe("id");
		expect(resolveEmailLang("en", "id-ID")).toBe("en");
	});

	it("falls back to the first Indonesian or English Accept-Language tag", () => {
		expect(resolveEmailLang(undefined, "id-ID,id;q=0.9,en;q=0.8")).toBe("id");
		expect(resolveEmailLang("fr", "fr-FR, id;q=0.8")).toBe("id");
		expect(resolveEmailLang(undefined, "de-DE,en-GB;q=0.8")).toBe("en");
	});

	it("defaults to English", () => {
		expect(resolveEmailLang(undefined, undefined)).toBe("en");
		expect(resolveEmailLang(undefined, "")).toBe("en");
	});
});

describe("brandedFrom", () => {
	it("adds the RevKlik name to a bare address and leaves named senders alone", () => {
		expect(brandedFrom("noreply@example.com")).toBe("RevKlik <noreply@example.com>");
		expect(brandedFrom("Acme <hi@acme.test>")).toBe("Acme <hi@acme.test>");
		expect(brandedFrom(undefined)).toBeUndefined();
		expect(brandedFrom("  ")).toBeUndefined();
	});
});

interface Sent {
	to: string;
	from: string;
	subject: string;
	html: string;
	text?: string;
}

describe("verification email routes", () => {
	const setup = async () => {
		const sent: Sent[] = [];
		const t = await createMigratedTestApp({
			EMAIL: {
				send: async (msg: Sent) => {
					sent.push(msg);
				},
			},
			EMAIL_FROM: "noreply@revklik.test",
		});
		return { sent, t };
	};

	it("registers with lang=id and mails the Indonesian version from a named sender", async () => {
		const { sent, t } = await setup();
		const res = await t.call("POST", "/api/auth/register", {
			body: { name: "Siti", email: "siti@example.com", password: "password-1", lang: "id" },
		});
		expect(res.status).toBe(201);
		await settleWaitUntil();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe("siti@example.com");
		expect(sent[0]?.subject).toBe("Konfirmasi email RevKlik");
		expect(sent[0]?.from).toBe("RevKlik <noreply@revklik.test>");
		expect(sent[0]?.html).toContain("/verify-email?token=");
	});

	it("falls back to Accept-Language when register sends no lang", async () => {
		const { sent, t } = await setup();
		await t.call("POST", "/api/auth/register", {
			body: { name: "Budi", email: "budi@example.com", password: "password-1" },
			headers: { "accept-language": "id-ID,id;q=0.9" },
		});
		await settleWaitUntil();
		expect(sent[0]?.subject).toBe("Konfirmasi email RevKlik");
	});

	it("resends in the language the dashboard sends", async () => {
		const { sent, t } = await setup();
		const reg = await t.call("POST", "/api/auth/register", {
			body: { name: "Ann", email: "ann@example.com", password: "password-1", lang: "id" },
		});
		const { data } = (await reg.json()) as { data: { token: string } };
		await settleWaitUntil();
		sent.length = 0;
		const res = await t.call("POST", "/api/auth/resend-verification", {
			body: { lang: "en" },
			token: data.token,
		});
		expect(res.status).toBe(200);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.subject).toBe("Confirm your RevKlik email");
	});
});
