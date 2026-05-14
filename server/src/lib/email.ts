import type { Kysely } from "kysely";
import type { KlikapaDatabase } from "shared";

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const { to, subject, html } = payload;
  const from = "KlikApa <noreply@klikapa.app>";

  try {
    const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [{ type: "text/html", value: html }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendMilestoneAlert(
  db: Kysely<KlikapaDatabase>,
  siteId: string,
  useremail: string,
  metric: string,
  value: number,
): Promise<void> {
  const subject = `KlikApa — ${metric} reached ${value.toLocaleString()}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #0a0a0a; color: #e8e4de; border-radius: 12px;">
      <h2 style="font-size: 20px; margin: 0 0 16px; color: #d4882a;">${metric} Milestone</h2>
      <p style="font-size: 15px; line-height: 1.6; margin: 0 0 12px;">Your site just reached <strong style="color: #d4882a;">${value.toLocaleString()} ${metric.toLowerCase()}</strong>.</p>
      <a href="https://klikapa.app/site" style="display: inline-block; padding: 10px 20px; background: #d4882a; color: #0a0a0a; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">View Dashboard</a>
      <p style="font-size: 12px; color: #6b6560; margin-top: 20px;">You're receiving this because you enabled email alerts for this site.</p>
    </div>
  `;
  await sendEmail({ to: useremail, subject, html });
}

export async function sendWeeklyReport(
  useremail: string,
  siteName: string,
  stats: { pageviews: number; visitors: number; topPages: { path: string; views: number }[] },
): Promise<void> {
  const topPagesHtml = stats.topPages.map(p =>
    `<tr><td style="padding: 6px 12px; border-bottom: 1px solid #222; font-size: 13px;">${p.path}</td><td style="padding: 6px 12px; border-bottom: 1px solid #222; font-size: 13px; text-align: right; font-family: monospace;">${p.views.toLocaleString()}</td></tr>`
  ).join("");

  const subject = `KlikApa — Weekly report for ${siteName}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #0a0a0a; color: #e8e4de; border-radius: 12px;">
      <h2 style="font-size: 20px; margin: 0 0 16px; color: #d4882a;">Weekly Report</h2>
      <p style="font-size: 15px; margin: 0 0 20px;">Here's your weekly summary for <strong>${siteName}</strong>.</p>
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
      <a href="https://klikapa.app/site" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #d4882a; color: #0a0a0a; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">View Full Dashboard</a>
      <p style="font-size: 12px; color: #6b6560; margin-top: 20px;">You're receiving this because you enabled weekly reports.</p>
    </div>
  `;
  await sendEmail({ to: useremail, subject, html });
}
