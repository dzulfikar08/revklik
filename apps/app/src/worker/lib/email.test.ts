import { describe, expect, it } from "bun:test";
import {
	sendAccountLinkedNotice,
	sendNewSignupAlert,
	sendWeeklyReport,
	type EmailBinding,
} from "./email";

const PAYLOAD = `<img src=x onerror=alert(1)>`;

function capture() {
	const sent: { subject: string; html: string }[] = [];
	const binding: EmailBinding = {
		send: async (msg) => {
			sent.push({ subject: msg.subject, html: msg.html });
		},
	};
	return { binding, sent };
}

describe("email templates escape user-controlled text", () => {
	it("escapes the name and email in the new-signup alert", async () => {
		const { binding, sent } = capture();
		await sendNewSignupAlert(
			"admin@example.com",
			{ name: PAYLOAD, email: `a"b@example.com`, via: "password" },
			binding,
		);
		expect(sent[0].html).not.toContain("<img");
		expect(sent[0].html).toContain("&#60;img src=x onerror=alert(1)&#62;");
		expect(sent[0].html).toContain("a&#34;b@example.com");
	});

	it("escapes site names and page paths in the weekly report", async () => {
		const { binding, sent } = capture();
		await sendWeeklyReport(
			"owner@example.com",
			PAYLOAD,
			{ pageviews: 1, visitors: 1, topPages: [{ path: `/<script>`, views: 1 }] },
			binding,
		);
		expect(sent[0].html).not.toContain("<img");
		expect(sent[0].html).not.toContain("<script>");
	});

	it("escapes the linked account addresses", async () => {
		const { binding, sent } = capture();
		await sendAccountLinkedNotice([{ to: "a@example.com", other: PAYLOAD }], binding);
		expect(sent[0].html).not.toContain("<img");
	});
});
