import { esc } from './core.js';

const SHELL = (siteUrl, inner, preheader) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#F1F3F5">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F3F5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#15161D;padding:22px 28px"><img src="${esc(siteUrl)}/assets/brand/frontrow-manager-on-dark.png" alt="Frontrow Manager" height="30" style="display:block;height:30px;width:auto;border:0"></td></tr>
<tr><td style="padding:32px 28px">${inner}</td></tr>
</table></td></tr></table></body></html>`;

export function magicLinkEmail({ url, siteUrl, email, ip }) {
  const html = SHELL(siteUrl, `
    <div style="font:800 22px/1.3 Arial,sans-serif;color:#15161D;margin:0 0 8px">Sign in to Frontrow Manager</div>
    <div style="font:15px/1.55 Arial,sans-serif;color:#4C5566;margin-bottom:22px">Tap the button below to sign in. The link works once and expires in 15 minutes.</div>
    <a href="${esc(url)}" style="display:inline-block;background:#15161D;color:#fff;font:700 15px Arial,sans-serif;padding:14px 22px;border-radius:999px;text-decoration:none">Sign in →</a>
    <div style="font:13px/1.5 Arial,sans-serif;color:#8B93A4;margin-top:22px;word-break:break-all">If the button doesn’t work, paste this into your browser:<br><span style="color:#4C5566">${esc(url)}</span></div>
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #E4E7EE;font:12px/1.6 Arial,sans-serif;color:#8B93A4">
      Requested for <strong style="color:#4C5566">${esc(email)}</strong>${ip ? ` from ${esc(ip)}` : ''}. If that wasn’t you, ignore this email — nothing changes until the link is used.
    </div>`,
    'Your Frontrow Manager sign-in link');
  const text = `Sign in to Frontrow Manager\n\n${url}\n\nThe link works once and expires in 15 minutes.`;
  return { subject: 'Frontrow Manager sign-in link', html, text };
}

export async function sendEmail({ to, subject, html, text, key }, env = process.env, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) return 'Resend is not configured (RESEND_API_KEY / FROM_EMAIL).';
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html, text })
    });
    if (res.ok || res.status === 409) return null;
    return `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
  } catch (e) { return `Resend request failed: ${e.message}`; }
}
