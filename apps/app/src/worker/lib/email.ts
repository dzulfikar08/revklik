import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "@revklik/shared";
import { DEFAULT_APP_URL } from "./app-url";

interface EmailPayload {
	to: string;
	/** Sender; defaults to the hosted RevKlik address. Set EMAIL_FROM on self-hosted installs. */
	from?: string;
	subject: string;
	html: string;
	text?: string;
}

export interface EmailBinding {
	send: (msg: {
		to: string;
		from: string;
		subject: string;
		html: string;
		text?: string;
	}) => Promise<void>;
}

const DEFAULT_FROM = "RevKlik <noreply@revklik.com>";

/** Escape text before it goes into an HTML email body (names, emails and paths are user-controlled). */
export const escapeHtml = (value: string): string =>
	value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// Send email using Cloudflare Email Service Workers binding
// Requires "send_email" binding in wrangler.jsonc
export async function sendEmail(
	payload: EmailPayload,
	emailBinding?: EmailBinding,
): Promise<boolean> {
	if (!emailBinding) return false;
	try {
		await emailBinding.send({
			to: payload.to,
			from: payload.from?.trim() || DEFAULT_FROM,
			subject: payload.subject,
			html: payload.html,
			text: payload.text || payload.subject,
		});
		return true;
	} catch {
		return false;
	}
}

/** Notify the admin that a new account registered. */
export async function sendNewSignupAlert(
	adminEmail: string,
	user: { name: string; email: string; via: "password" | "google" },
	emailBinding?: EmailBinding,
	from?: string,
): Promise<void> {
	if (!adminEmail || adminEmail === user.email) return;
	const method = user.via === "google" ? "Google sign-in" : "email + password";
	const subject = `RevKlik: new signup ${user.email}`;
	const html = `
  <p>New RevKlik registration:</p>
  <ul>
    <li><strong>${escapeHtml(user.email)}</strong> (${escapeHtml(user.name)})</li>
    <li>via ${method}</li>
    <li>${new Date().toISOString()}</li>
  </ul>`;
	await sendEmail({ to: adminEmail, from, subject, html }, emailBinding);
}

export async function sendMilestoneAlert(
	_db: Kysely<KlikapaDatabase>,
	_siteId: string,
	useremail: string,
	metric: string,
	value: number,
	emailBinding?: EmailBinding,
	opts: { from?: string; dashboardUrl?: string } = {},
): Promise<void> {
	const subject = `RevKlik: ${metric} reached ${value.toLocaleString()}`;
	const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0a0a0a; color: #e8e4de; border-radius: 12px;">
      <h2 style="font-size: 20px; margin: 0 0 16px; color: #d4882a;">${escapeHtml(metric)} Milestone</h2>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 12px;">Your site just reached <strong style="color: #d4882a;">${value.toLocaleString()} ${escapeHtml(metric.toLowerCase())}</strong>.</p>
      <a href="${opts.dashboardUrl ?? `${DEFAULT_APP_URL}/site`}" style="display: inline-block; padding: 10px 20px; background: #d4882a; color: #0a0a0a; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">View Dashboard</a>
      <p style="font-size: 12px; color: #6b6560; margin-top: 20px;">You're receiving this because you enabled email alerts for this site.</p>
    </div>
  `;
	await sendEmail({ to: useremail, from: opts.from, subject, html }, emailBinding);
}

export async function sendWeeklyReport(
	useremail: string,
	siteName: string,
	stats: {
		pageviews: number;
		visitors: number;
		topPages: { path: string; views: number }[];
	},
	emailBinding?: EmailBinding,
	opts: { from?: string; dashboardUrl?: string } = {},
): Promise<void> {
	const topPagesHtml = stats.topPages
		.map(
			(p) =>
				`<tr><td style="padding: 6px 12px; border-bottom: 1px solid #222; font-size: 13px;">${escapeHtml(p.path)}</td><td style="padding: 6px 12px; border-bottom: 1px solid #222; font-size: 13px; text-align: right; font-family: monospace;">${p.views.toLocaleString()}</td></tr>`,
		)
		.join("");

	const subject = `RevKlik: weekly report for ${siteName}`;
	const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #0a0a0a; color: #e8e4de; border-radius: 12px;">
      <h2 style="font-size: 20px; margin: 0 0 16px; color: #d4882a;">Weekly Report</h2>
      <p style="font-size: 15px; margin: 0 0 20px;">Here's your weekly summary for <strong>${escapeHtml(siteName)}</strong>.</p>
      <div style="display: flex; gap: 16px; margin-bottom: 24px;">
        <div style="flex: 1; background: #161616; padding: 16px; border-radius: 8px; text-align: center;">
          <div style="font-size: 28px; font-weight: 700; color: #d4882a; font-family: monospace;">${stats.pageviews.toLocaleString()}</div>
          <div style="font-size: 12px; color: #6b6560; margin-top: 4px;">Pageviews</div>
        </div>
        <div style="flex: 1; background: #161616; padding: 16px; border-radius: 8px; text-align: center;">
          <div style="font-size: 28px; font-weight: 700; color: #60a5fa; font-family: monospace;">${stats.visitors.toLocaleString()}</div>
          <div style="font-size: 12px; color: #6b6560; margin-top: 4px;">Visitors</div>
        </div>
      </div>
      <h3 style="font-size: 14px; margin: 0 0 8px; color: #a8a29e;">Top Pages</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead><tr style="border-bottom: 1px solid #333;"><th style="padding: 6px 12px; text-align: left; font-size: 11px; color: #6b6560; text-transform: uppercase;">Path</th><th style="padding: 6px 12px; text-align: right; font-size: 11px; color: #6b6560; text-transform: uppercase;">Views</th></tr></thead>
        <tbody>${topPagesHtml}</tbody>
      </table>
      <a href="${opts.dashboardUrl ?? `${DEFAULT_APP_URL}/site`}" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #d4882a; color: #0a0a0a; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">View Full Dashboard</a>
      <p style="font-size: 12px; color: #6b6560; margin-top: 20px;">You're receiving this because you enabled weekly reports.</p>
    </div>
  `;
	await sendEmail({ to: useremail, from: opts.from, subject, html }, emailBinding);
}

/** Tell both accounts that they were linked, so an unexpected link is noticed. */
export async function sendAccountLinkedNotice(
	emails: { to: string; other: string }[],
	emailBinding?: EmailBinding,
	from?: string,
): Promise<void> {
	await Promise.all(
		emails.map(({ to, other }) =>
			sendEmail(
				{
					to,
					from,
					subject: "RevKlik: an account was linked to yours",
					html: `<p>The RevKlik account <strong>${escapeHtml(other)}</strong> was linked to <strong>${escapeHtml(to)}</strong>. Signed in to either one, you can now switch to the other.</p><p>If this wasn't you, sign in and remove the link under Settings, Linked accounts, then reset your password.</p>`,
					text: `The RevKlik account ${other} was linked to ${to}. If this wasn't you, remove the link under Settings, Linked accounts, and reset your password.`,
				},
				emailBinding,
			),
		),
	);
}
