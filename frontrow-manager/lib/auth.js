import { createHash } from 'node:crypto';
import { select, insert, json, emailFilter, sameEmail } from './core.js';

/* Staff sign-in for the Frontrow Manager.
 *
 * Same model as MKC Admin: server-issued magic links, an HTTP-only session
 * cookie, and the shared core.magic_links / core.sessions tables, so one MKC
 * team member has one identity across tools. Access is per tool: a person
 * may enter the Frontrow Manager only with a core.tool_access row for tool
 * 'portal'. Every callback checks its OWN tool's access before consuming a
 * link, so a link minted here cannot open MKC Admin for someone without
 * booking access, and vice versa.
 */

export const TOOL = 'frontrow';
// __Host- : Secure, Path=/ and no Domain, so a sibling subdomain can't plant or
// overwrite it.
export const COOKIE_NAME = '__Host-frontrow_mgr_sid';
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

export const ROLES = ['super_admin', 'manager', 'account_manager', 'supervisor'];

export const hashToken = (raw) => createHash('sha256').update(raw).digest('hex');

export function readCookie(request, name) {
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

export function sessionCookie(token, { maxAge = SESSION_TTL_SEC, clear = false } = {}) {
  if (clear) return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/* Bootstrap super-admins come from an env var so the very first sign-in works
 * before anyone has been granted access. PORTAL_ADMIN_EMAILS wins; if it is
 * unset, the MKC Admin list is used, so the same people start in charge. */
export function bootstrapEmails(env = process.env) {
  return (env.PORTAL_ADMIN_EMAILS || env.MKC_ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export async function getAccessRole(email, db = { select }, env = process.env) {
  const em = (email || '').toLowerCase();
  if (!em) return null;
  if (bootstrapEmails(env).includes(em)) return 'super_admin';
  try {
    const rows = await db.select('core', 'people',
      `select=id,email,active,tool_access!inner(role,tool)&${emailFilter(em)}&tool_access.tool=eq.${TOOL}`);
    const person = (Array.isArray(rows) ? rows : []).find((p) => sameEmail(p.email, em));
    if (!person || person.active === false) return null;
    const role = ((person.tool_access || [])[0] || {}).role;
    return ROLES.includes(role) ? role : null;
  } catch (e) {
    console.error('frontrow role check failed', e.message);
    return null;
  }
}

/** Returns { email, personId, role, fullName } or throws a JSON Response. */
export async function requireSession(request) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) throw json(401, { error: 'Sign in required.' });
  const rows = await select('core', 'sessions',
    `select=email,person_id,expires_at&token_hash=eq.${hashToken(token)}`);
  const s = rows && rows[0];
  if (!s) throw json(401, { error: 'Session invalid or expired.' });
  if (new Date(s.expires_at).getTime() <= Date.now()) throw json(401, { error: 'Session expired.' });
  const role = await getAccessRole(s.email);
  if (!role) throw json(403, { error: 'Your Frontrow Manager access has been removed.' });
  let personId = s.person_id;
  let fullName = s.email;
  if (!personId) {
    const person = await ensurePerson(s.email);
    personId = person ? person.id : null;
  }
  if (personId) {
    const pr = await select('core', 'people', `select=full_name&id=eq.${personId}`);
    if (pr && pr[0] && pr[0].full_name) fullName = pr[0].full_name;
  }
  return { email: s.email, personId, role, fullName };
}

/** Finds or creates the core.people row. Grants portal access only to bootstrap
 *  emails — everyone else must be added from the Team screen. */
export async function ensurePerson(email, fullNameGuess = '') {
  const em = email.toLowerCase();
  const found = await select('core', 'people', `select=id,full_name,email&${emailFilter(em)}`);
  let person = (found || []).find((p) => sameEmail(p.email, em));
  if (!person) {
    const created = await insert('core', 'people', { email: em, full_name: fullNameGuess || em.split('@')[0] });
    person = created && created[0];
  }
  if (person && bootstrapEmails().includes(em)) {
    try {
      await insert('core', 'tool_access', { person_id: person.id, tool: TOOL, role: 'super_admin' },
        { onConflict: 'person_id,tool' });
    } catch (e) { /* already granted */ }
  }
  return person;
}
