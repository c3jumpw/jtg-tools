import { randomBytes } from 'node:crypto';
import { select, insert, remove, json, UUID_RE, clientIp } from './core.js';
import { hashToken } from './tokens.js';
import { activeCompaniesFor } from './directory.js';

/* Client sessions for Frontrow.
 *
 * Clients are frontrow.contacts, not MKC staff, so they have their own
 * session table and cookie. A staff session can never be used here and a
 * client session can never be used in Frontrow Manager.
 *
 * Which companies a client sees is worked out on the server from the
 * contact's links on every request (directory.activeCompaniesFor). The
 * browser only ever names a company it wants; it never decides what it may see.
 */

// __Host- : Secure, Path=/ and no Domain, so a sibling subdomain can't plant or
// overwrite it.
export const COOKIE_NAME = '__Host-frontrow_sid';
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

export function readCookie(request, name = COOKIE_NAME) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) {
      try { return decodeURIComponent(part.slice(eq + 1)); } catch { return null; }
    }
  }
  return null;
}

export function sessionCookie(token, { clear = false } = {}) {
  if (clear) return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}`;
}

/** Starts a session for a contact and returns the Set-Cookie value. */
export async function startSession(contactId, request) {
  const token = randomBytes(32).toString('base64url');
  await insert('frontrow', 'client_sessions', {
    token_hash: hashToken(token),
    contact_id: contactId,
    expires_at: new Date(Date.now() + SESSION_TTL_SEC * 1000).toISOString(),
    ip: clientIp(request),
    user_agent: (request.headers.get('user-agent') || '').slice(0, 300)
  });
  return sessionCookie(token);
}

/** Ends every session of a contact (after a password reset or switch-off). */
export async function endSessions(contactId) {
  if (UUID_RE.test(String(contactId || ''))) await remove('frontrow', 'client_sessions', `contact_id=eq.${contactId}`);
}

/** Returns { contactId, email, fullName } or throws a JSON Response. */
export async function requireClient(request, db = { select }) {
  const token = readCookie(request);
  if (!token) throw json(401, { error: 'Sign in required.' });
  const rows = await db.select('frontrow', 'client_sessions',
    `select=contact_id,expires_at&token_hash=eq.${hashToken(token)}`);
  const s = rows && rows[0];
  if (!s || new Date(s.expires_at).getTime() <= Date.now()) throw json(401, { error: 'Your session has ended. Sign in again.' });
  const [people, accounts] = await Promise.all([
    db.select('frontrow', 'contacts', `select=id,email,full_name,active&id=eq.${s.contact_id}`),
    db.select('frontrow', 'accounts', `select=status&contact_id=eq.${s.contact_id}`)
  ]);
  const contact = people && people[0];
  const account = accounts && accounts[0];
  if (!contact || contact.active === false || !account || account.status !== 'active') {
    throw json(401, { error: 'Your portal access has been switched off.' });
  }
  return { contactId: contact.id, email: contact.email, fullName: contact.full_name || '' };
}

/** The one company a request names, if this client may see it; else 404. */
export async function requireClientCompany(client, companyId, db = { select }) {
  if (!UUID_RE.test(String(companyId || ''))) throw json(400, { error: 'Choose a company.' });
  const companies = await activeCompaniesFor(client.contactId, {}, db);
  const company = companies.find((c) => c.id === companyId);
  if (!company) throw json(404, { error: 'Not found.' });
  return company;
}
