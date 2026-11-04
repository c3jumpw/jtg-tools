import { select, insert, patch, json, readJson, originAllowed, rateLimited, clientIp, route } from '../lib/core.js';
import { hashToken, TOKEN_RE } from '../lib/tokens.js';
import { activeCompaniesFor, orgsByIds, pickOrgId, portalBase } from '../lib/directory.js';
import { hashPassword, passwordProblem } from '../lib/passwords.js';
import { startSession, endSessions } from '../lib/client-auth.js';
import { welcomeEmail, sendEmail } from '../lib/mail.js';
import { comment } from '../lib/clickup.js';
import { auditClient } from '../lib/audit.js';

/* POST { t, password } — set a password from a setup or reset link.
 *
 * Checks, in order, before anything is written: the link is real, unused
 * and in date; the contact is still eligible (linked to an active company);
 * the password is acceptable. Then the link is spent atomically, the
 * password stored (scrypt), other sessions ended, and a new one started.
 *
 * The first time someone sets a password they get the welcome email with
 * add-to-home-screen steps, and their ClickUp contact gets a note.
 */

const fail = (code, error, status = 400) => json(status, { ok: false, code, error });

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (rateLimited(`fr-setpw:${clientIp(request)}`, 30, 60 * 60_000)) return fail('slow', 'Too many attempts. Wait a few minutes.', 429);
  const { body, error } = await readJson(request, 2048);
  if (error) return error;
  const raw = typeof body.t === 'string' ? body.t : '';
  if (!TOKEN_RE.test(raw)) return fail('badlink', 'That link isn’t valid.');
  const hash = hashToken(raw);

  const rows = await select('frontrow', 'account_tokens', `select=contact_id,purpose,organization_id,expires_at,used_at&token_hash=eq.${hash}`);
  const t = rows && rows[0];
  if (!t) return fail('badlink', 'That link isn’t valid.');
  if (t.used_at) return fail('used', 'That link has already been used.');
  if (new Date(t.expires_at).getTime() <= Date.now()) return fail('expired', 'That link has expired.');

  const people = await select('frontrow', 'contacts', `select=id,email,full_name,clickup_contact_id,active&id=eq.${t.contact_id}`);
  const contact = people && people[0];
  const companies = contact && contact.active !== false ? await activeCompaniesFor(contact.id) : [];
  if (!companies.length) return fail('no_access', 'Your account isn’t linked to an active client right now. Contact your account manager.', 403);
  const accRows = await select('frontrow', 'accounts', `select=status,activated_at&contact_id=eq.${contact.id}`);
  const account = accRows && accRows[0];
  if (account && account.status !== 'active') return fail('disabled', 'Your portal access has been switched off. Contact your account manager.', 403);

  const password = typeof body.password === 'string' ? body.password : '';
  const problem = passwordProblem(password, contact.email);
  if (problem) return fail('weak', problem);

  // Spend the link only if nobody spent it first (two tabs, a double tap).
  const spent = await patch('frontrow', 'account_tokens', `token_hash=eq.${hash}&used_at=is.null`, { used_at: new Date().toISOString() });
  if (!spent || spent.length === 0) return fail('used', 'That link has already been used.');

  const now = new Date().toISOString();
  const firstTime = !account || !account.activated_at;
  const password_hash = await hashPassword(password);
  if (account) {
    await patch('frontrow', 'accounts', `contact_id=eq.${contact.id}`, {
      password_hash, failed_attempts: 0, locked_until: null, last_sign_in_at: now, ...(firstTime ? { activated_at: now } : {})
    });
  } else {
    await insert('frontrow', 'accounts', { contact_id: contact.id, password_hash, status: 'active', activated_at: now, last_sign_in_at: now });
  }
  // Any other device signed in with the old password is signed out.
  await endSessions(contact.id);
  const cookie = await startSession(contact.id, request);

  const [org] = await orgsByIds([pickOrgId(companies, t.organization_id)]);
  if (firstTime && org) {
    const err = await sendEmail({ to: contact.email, ...welcomeEmail({ org, portalUrl: portalBase(org), name: contact.full_name }), key: `fr-welcome-${contact.id}` });
    if (err) console.error('welcome email failed', err);
    await comment(contact.clickup_contact_id,
      `Frontrow: ${contact.full_name || contact.email} set up their ${org.name} portal account and can now see ${companies.map((c) => c.name).join(', ')}.`);
  }
  await auditClient({ contactId: contact.id, email: contact.email }, firstTime ? 'client.activate' : 'client.password_reset', contact.id, { org: org && org.slug });
  return json(200, { ok: true, org: org ? org.slug : null, firstTime }, { 'Set-Cookie': cookie });
});
