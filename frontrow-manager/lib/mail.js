import { esc } from './core.js';

/* Client emails, in the organization's colours, with "Powered by Frontrow"
 * underneath. Shared by Frontrow and Frontrow Manager (copied). Table layout
 * and inline styles because email clients ignore most CSS. */

const HEX = /^#[0-9a-f]{6}$/i;

function site(env = process.env) {
  return (env.FRONTROW_URL || 'https://frontrow.jtgworkspace.com').replace(/\/$/, '');
}

function layout(org, inner, env) {
  const b = (org && org.branding) || {};
  const ink = HEX.test(b.ink || '') ? b.ink : '#15161D';
  const logoPath = b.logo_on_dark || '';
  const logo = /^\/assets\//.test(logoPath) ? `${site(env)}${logoPath}` : (/^https:\/\//.test(logoPath) ? logoPath : '');
  const head = logo
    ? `<img src="${esc(logo)}" height="40" alt="${esc(org.name)}" style="display:block;border:0;height:40px;width:auto">`
    : `<span style="font:bold 20px Arial,sans-serif;color:#ffffff">${esc(org ? org.name : 'Frontrow')}</span>`;
  return `<!doctype html><html><body style="margin:0;background:#F4F2EE;font-family:Arial,Helvetica,sans-serif;color:#1F2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EE;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:${ink};padding:22px 28px">${head}</td></tr>
<tr><td style="padding:28px">${inner}</td></tr></table>
<p style="font-size:12px;color:#6B7280;margin:16px 0 0">Powered by <a href="${esc(site(env))}" style="color:#6B7280">Frontrow</a></p>
</td></tr></table></body></html>`;
}

function button(org, url, label) {
  const b = (org && org.branding) || {};
  const accent = HEX.test(b.accent || '') ? b.accent : '#15161D';
  return `<p style="margin:0 0 24px"><a href="${esc(url)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 26px;border-radius:999px">${esc(label)}</a></p>
<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#6B7280">If the button doesn’t work, copy this link into your browser:</p>
<p style="margin:0 0 22px;font-size:13px;line-height:1.5;word-break:break-all"><a href="${esc(url)}" style="color:#374151">${esc(url)}</a></p>`;
}

const h1 = (t) => `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#111827">${esc(t)}</h1>`;
const p = (t) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#374151">${t}</p>`;
const small = (t) => `<p style="margin:0;font-size:12px;line-height:1.5;color:#6B7280">${t}</p>`;

export function setupEmail({ org, url, name, invitedBy, days }, env) {
  const when = days ? `${days} days` : '60 minutes';
  const subject = `Set up your ${org.name} client portal`;
  const inner = h1(name ? `Welcome, ${name.split(' ')[0]}` : 'Welcome') +
    p(`${invitedBy ? `${esc(invitedBy)} has invited you to` : 'Here’s your link to set up'} the ${esc(org.name)} client portal — one place for updates, tasks and guides from your team.`) +
    p('Choose a password and you’re in.') +
    button(org, url, 'Set up my account') +
    small(`The link works once and expires in ${when}. Didn’t expect this? You can ignore it — nothing happens until the link is used.`);
  const text = `Set up your ${org.name} client portal\n\nChoose a password here (the link works once and expires in ${when}):\n${url}`;
  return { subject, html: layout(org, inner, env), text };
}

export function resetEmail({ org, url }, env) {
  const subject = `Reset your ${org.name} portal password`;
  const inner = h1('Reset your password') +
    p(`Someone asked to reset the password for your ${esc(org.name)} client portal account.`) +
    button(org, url, 'Choose a new password') +
    small('The link works once and expires in 60 minutes. If it wasn’t you, ignore this email — your password stays the same.');
  const text = `Reset your ${org.name} portal password:\n${url}\n\nThe link works once and expires in 60 minutes. If it wasn't you, ignore this email.`;
  return { subject, html: layout(org, inner, env), text };
}

export function requestEmail({ org, url }, env) {
  const name = org ? org.name : 'Frontrow';
  const subject = `Confirm your ${name} portal access request`;
  const inner = h1('We couldn’t find an active account') +
    p(`There’s no active client account for this email at ${esc(name)} yet. If you’d like access, confirm your request and your team will be in touch.`) +
    button(org, url, 'Request access') +
    small('The link expires in 24 hours. Didn’t ask for this? Ignore this email and nothing will happen.');
  const text = `There's no active client account for this email at ${name} yet. To request access, open:\n${url}\n\nThe link expires in 24 hours.`;
  return { subject, html: layout(org, inner, env), text };
}

/** Sent once, when a contact first sets their password. */
export function welcomeEmail({ org, portalUrl, name }, env) {
  const subject = `You’re all set — put ${org.name} on your home screen`;
  const step = (n, t) => `<tr><td style="width:28px;vertical-align:top;padding:0 0 10px"><span style="display:inline-block;width:22px;height:22px;border-radius:11px;background:#EEF0F4;color:#111827;font:bold 12px/22px Arial,sans-serif;text-align:center">${n}</span></td><td style="padding:0 0 10px;font-size:15px;line-height:1.5;color:#374151">${t}</td></tr>`;
  const inner = h1(name ? `You’re all set, ${name.split(' ')[0]}` : 'You’re all set') +
    p(`Your ${esc(org.name)} client portal is ready. Sign in any time at:`) +
    p(`<a href="${esc(portalUrl)}" style="color:#111827;font-weight:bold">${esc(portalUrl.replace(/^https:\/\//, ''))}</a>`) +
    `<h2 style="margin:24px 0 10px;font-size:17px;color:#111827">Add it to your phone like an app</h2>` +
    `<p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#111827">iPhone or iPad (Safari)</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px">${step(1, 'Open your portal link in <b>Safari</b> and sign in.')}${step(2, 'Tap the <b>Share</b> button (the square with an arrow).')}${step(3, 'Choose <b>Add to Home Screen</b>, then <b>Add</b>.')}</table>` +
    `<p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#111827">Android (Chrome)</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px">${step(1, 'Open your portal link in <b>Chrome</b> and sign in.')}${step(2, 'Tap the <b>⋮</b> menu in the top corner.')}${step(3, 'Choose <b>Install app</b> or <b>Add to Home screen</b>.')}</table>` +
    small('The icon opens your portal full-screen, and you stay signed in for 30 days.');
  const text = `You're all set. Your ${org.name} client portal: ${portalUrl}

Add it to your phone like an app:
iPhone (Safari): open the link, tap Share, then Add to Home Screen.
Android (Chrome): open the link, tap the ⋮ menu, then Install app or Add to Home screen.`;
  return { subject, html: layout(org, inner, env), text };
}

export async function sendEmail({ to, subject, html, text, key }, env = process.env, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) return 'Email is not configured (RESEND_API_KEY / FROM_EMAIL).';
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {})
      },
      body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html, text })
    });
    if (!res.ok) return `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
    return null;
  } catch (e) {
    return `Resend unreachable: ${e.message}`;
  }
}
