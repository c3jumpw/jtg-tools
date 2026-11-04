import { randomBytes } from 'node:crypto';
import { select, insert, json, clean, readJson, originAllowed, rateLimited, clientIp, atLeast, route } from '../lib/core.js';
import { contactByEmail, activeCompaniesFor, orgBySlug, orgsByIds, pickOrgId } from '../lib/directory.js';
import { issueAccountToken, accountLink, hashToken, TTL } from '../lib/tokens.js';
import { setupEmail, resetEmail, requestEmail, sendEmail } from '../lib/mail.js';
import { comment } from '../lib/clickup.js';

/* POST { email, org } — "Set up your account" and "Forgot password".
 *
 * Always the same answer, in about the same time, so the form can't reveal
 * who is a client. What happens behind it:
 *
 *   eligible, no password yet  → setup link (60 minutes), noted in ClickUp
 *   eligible, has a password   → reset link (60 minutes)
 *   switched off               → nothing
 *   not eligible               → "we couldn't find an active account" email
 *                                with a link to request access. Only when
 *                                they confirm (proving the mailbox is theirs)
 *                                does anything reach the CRM.
 */

const GENERIC = 'If that email can use this portal, we’ve sent a link to it. Check your inbox (and spam) — it expires in 60 minutes.';

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const ip = clientIp(request);
  if (rateLimited(`fr-access-ip:${ip}`, 10, 60 * 60_000)) return json(429, { error: 'Too many requests. Please try again later.' });
  const { body, error } = await readJson(request, 2048);
  if (error) return error;
  const email = clean(body.email, 200).toLowerCase();
  if (!/^[^\s@,()"]+@[^\s@,()"]+\.[^\s@,()"]{2,}$/.test(email)) return json(400, { error: 'Please check your email address.' });
  if (rateLimited(`fr-access-em:${email}`, 4, 60 * 60_000)) return json(429, { error: 'We’ve already sent a few links to that address. Check your inbox, or try again in an hour.' });

  const started = Date.now();
  const done = async () => { await atLeast(1500, started); return json(200, { ok: true, message: GENERIC }); };
  const org = await orgBySlug(clean(body.org, 31));

  const contact = await contactByEmail(email);
  const companies = contact && contact.active !== false ? await activeCompaniesFor(contact.id) : [];

  if (companies.length) {
    const accRows = await select('frontrow', 'accounts', `select=status,password_hash&contact_id=eq.${contact.id}`);
    const account = accRows && accRows[0];
    if (account && account.status !== 'active') return done();
    const [target] = await orgsByIds([pickOrgId(companies, org && org.id)]);
    const purpose = account && account.password_hash ? 'reset' : 'setup';
    const raw = await issueAccountToken(contact.id, purpose, { orgId: target.id, ttlMs: purpose === 'setup' ? TTL.selfSetup : TTL.reset, ip });
    const url = accountLink(target, purpose, raw);
    const mail = purpose === 'setup' ? setupEmail({ org: target, url, name: contact.full_name }) : resetEmail({ org: target, url });
    const err = await sendEmail({ to: email, ...mail, key: `fr-${purpose}-${hashToken(raw).slice(0, 24)}` });
    if (err) { console.error('access email failed', err); return json(500, { error: 'We couldn’t send the email just now. Please try again.' }); }
    if (purpose === 'setup') {
      await comment(contact.clickup_contact_id, `Frontrow: ${email} asked for a setup link from the ${target.name} sign-in page. Link sent.`);
    }
    return done();
  }

  if (contact && contact.active === false) return done();

  // Not eligible: one confirm email per address per day at most.
  const recent = await select('frontrow', 'access_requests',
    `select=id&email=eq.${encodeURIComponent(email)}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 864e5).toISOString())}&limit=1`);
  if (recent && recent.length) return done();
  const raw = randomBytes(32).toString('base64url');
  await insert('frontrow', 'access_requests', {
    organization_id: org ? org.id : null,
    email,
    confirm_token_hash: hashToken(raw),
    confirm_expires_at: new Date(Date.now() + 864e5).toISOString(),
    ip
  });
  const url = accountLink(org, 'request', raw);
  const err = await sendEmail({ to: email, ...requestEmail({ org: org || { name: 'Frontrow', branding: {} }, url }), key: `fr-req-${hashToken(raw).slice(0, 24)}` });
  if (err) console.error('request email failed', err);
  return done();
});
