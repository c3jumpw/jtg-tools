import { select, patch, json, clean, readJson, originAllowed, rateLimited, clientIp, atLeast, route } from '../lib/core.js';
import { contactByEmail, activeCompaniesFor, orgBySlug, orgsByIds, pickOrgId } from '../lib/directory.js';
import { verifyPassword, burnTime } from '../lib/passwords.js';
import { startSession } from '../lib/client-auth.js';
import { auditClient } from '../lib/audit.js';

/* POST { email, password, org } — password sign-in.
 *
 * One answer ("invalid"), padded to the same time, for an unknown email, a
 * contact without a password, a wrong password and a locked account, so the
 * form can't be used to find out who has an account.
 *
 * Each guess is counted before the password is checked, with a
 * compare-and-swap on failed_attempts, so guesses sent in parallel can't
 * share one count. The 10th wrong guess in a row pauses the account for 15
 * minutes; setting a new password from a reset link clears it.
 *
 * `org` is the sign-in page's organization. If the person has companies
 * there they land there; otherwise they land in their own organization.
 */

const MAX_FAILS = 10;
const LOCK_MINUTES = 15;
const MIN_MS = 700;
const INVALID = 'That email and password don’t match. After several wrong tries sign-in pauses for 15 minutes — you can reset your password instead.';

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (rateLimited(`fr-login-ip:${clientIp(request)}`, 30, 15 * 60_000)) {
    return json(429, { ok: false, code: 'slow', error: 'Too many sign-in attempts. Wait a few minutes and try again.' });
  }
  const started = Date.now();
  const { body, error } = await readJson(request, 2048);
  if (error) return error;
  const email = clean(body.email, 200).toLowerCase();
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  const invalid = async () => { await atLeast(MIN_MS, started); return json(401, { ok: false, code: 'invalid', error: INVALID }); };
  if (!email || !password) return invalid();
  if (rateLimited(`fr-login-em:${email}`, 15, 15 * 60_000)) {
    return json(429, { ok: false, code: 'slow', error: 'Too many sign-in attempts for this email. Wait a few minutes and try again.' });
  }

  const contact = await contactByEmail(email);
  const read = async () => {
    const rows = contact ? await select('frontrow', 'accounts',
      `select=contact_id,password_hash,status,failed_attempts,locked_until,activated_at&contact_id=eq.${contact.id}`) : null;
    return rows && rows[0];
  };
  let account = await read();
  if (!contact || !account || !account.password_hash) { await burnTime(password); return invalid(); }

  // Count this guess first (compare-and-swap), then check the password.
  // The count only ever goes up until a lock runs out or a sign-in succeeds,
  // so a stale read can't be swapped in after a lock (no A-B-A).
  let reserved = false;
  for (let i = 0; i < 4 && account; i++) {
    if (account.locked_until && Date.parse(account.locked_until) > Date.now()) break;
    const fails = account.failed_attempts || 0;
    const next = (fails >= MAX_FAILS ? 0 : fails) + 1; // a lock that has run out starts a fresh count
    const changes = next >= MAX_FAILS
      ? { failed_attempts: MAX_FAILS, locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() }
      : { failed_attempts: next, locked_until: null };
    const rows = await patch('frontrow', 'accounts', `contact_id=eq.${contact.id}&failed_attempts=eq.${fails}`, changes);
    if (rows && rows.length) { reserved = true; break; }
    account = await read();
  }
  if (!reserved) { await burnTime(password); return invalid(); }
  if (!(await verifyPassword(password, account.password_hash))) return invalid();

  // Right password. Now the things only the account owner should learn.
  if (account.status !== 'active' || contact.active === false) {
    return json(403, { ok: false, code: 'disabled', error: 'Your portal access has been switched off. Contact your account manager.' });
  }
  const companies = await activeCompaniesFor(contact.id);
  if (!companies.length) {
    return json(403, { ok: false, code: 'no_access', error: 'Your account isn’t linked to an active client right now. Contact your account manager.' });
  }

  const requested = await orgBySlug(clean(body.org, 31));
  const [landing] = await orgsByIds([pickOrgId(companies, requested && requested.id)]);
  await patch('frontrow', 'accounts', `contact_id=eq.${contact.id}`,
    { failed_attempts: 0, locked_until: null, last_sign_in_at: new Date().toISOString() });
  const cookie = await startSession(contact.id, request);
  await auditClient({ contactId: contact.id, email: contact.email }, 'client.sign_in', contact.id, { org: landing && landing.slug });
  return json(200, { ok: true, org: landing ? landing.slug : null }, { 'Set-Cookie': cookie });
});
