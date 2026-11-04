import { randomBytes } from 'node:crypto';
import { select, insert, patch, json, readJson, originAllowed, clientIp, rateLimited, route } from '../lib/core.js';
import { hashToken, sessionCookie, SESSION_TTL_SEC, ensurePerson, getAccessRole } from '../lib/auth.js';
import { audit } from '../lib/pipeline.js';

/* POST { t } — exchanges a sign-in token for a session cookie.
 *
 * The emailed link is /#signin=<token>. The token sits in the URL fragment,
 * which never reaches a server, and the page posts it here only after the
 * person taps "Continue". So mail scanners that pre-open links (Safe Links,
 * Proofpoint, link previews) neither spend it nor get a session from it.
 * Failures return a short code the page turns into plain English. */

const fail = (code, status = 400) => json(status, { ok: false, code });

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (rateLimited(`pm-cb:${clientIp(request)}`, 30, 60 * 60_000)) return fail('slow', 429);

  const { body, error } = await readJson(request, 512);
  if (error) return error;
  const raw = typeof body.t === 'string' ? body.t : '';
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(raw)) return fail('badlink');
  const th = hashToken(raw);

  const rows = await select('core', 'magic_links', `select=email,expires_at,used_at&token_hash=eq.${th}`);
  const ml = rows && rows[0];
  if (!ml) return fail('badlink');
  if (ml.used_at) return fail('used');
  if (new Date(ml.expires_at).getTime() < Date.now()) return fail('expired');
  // Checked BEFORE the link is spent: core.magic_links is shared with MKC
  // Admin, so a link minted there must not open this tool for someone without
  // portal access — and a failed check here must not burn their link.
  if (!(await getAccessRole(ml.email))) return fail('notallowed', 403);

  // Spend the link only if nobody spent it first (two tabs, a double tap).
  const spent = await patch('core', 'magic_links', `token_hash=eq.${th}&used_at=is.null`, { used_at: new Date().toISOString() });
  if (!spent || spent.length === 0) return fail('used');

  const person = await ensurePerson(ml.email);
  const sessionToken = randomBytes(32).toString('base64url');
  await insert('core', 'sessions', {
    token_hash: hashToken(sessionToken),
    email: ml.email,
    person_id: person ? person.id : null,
    expires_at: new Date(Date.now() + SESSION_TTL_SEC * 1000).toISOString(),
    ip: clientIp(request),
    user_agent: (request.headers.get('user-agent') || '').slice(0, 400)
  });
  await audit({ email: ml.email, personId: person ? person.id : null }, 'staff.sign_in', person && person.id, {});
  return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(sessionToken) });
});
