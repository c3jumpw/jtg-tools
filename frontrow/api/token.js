import { select, json, readJson, originAllowed, rateLimited, clientIp, route } from '../lib/core.js';
import { hashToken, TOKEN_RE } from '../lib/tokens.js';
import { orgsByIds } from '../lib/directory.js';

/* POST { t, kind } — is this link still good, and who is it for?
 * Read-only: looking at a link never spends it. kind is setup, reset or request. */

const fail = (code, status = 400) => json(status, { ok: false, code });

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (rateLimited(`fr-token:${clientIp(request)}`, 60, 60 * 60_000)) return fail('slow', 429);
  const { body, error } = await readJson(request, 512);
  if (error) return error;
  const raw = typeof body.t === 'string' ? body.t : '';
  if (!TOKEN_RE.test(raw)) return fail('badlink');
  const hash = hashToken(raw);

  if (body.kind === 'request') {
    const rows = await select('frontrow', 'access_requests', `select=email,status,confirm_expires_at&confirm_token_hash=eq.${hash}`);
    const r = rows && rows[0];
    if (!r) return fail('badlink');
    if (r.status !== 'unconfirmed') return fail('used');
    if (new Date(r.confirm_expires_at).getTime() <= Date.now()) return fail('expired');
    return json(200, { ok: true, kind: 'request', email: r.email });
  }

  if (!['setup', 'reset'].includes(body.kind)) return fail('badlink');
  const rows = await select('frontrow', 'account_tokens', `select=contact_id,purpose,organization_id,expires_at,used_at&token_hash=eq.${hash}`);
  const t = rows && rows[0];
  if (!t || t.purpose !== body.kind) return fail('badlink');
  if (t.used_at) return fail('used');
  if (new Date(t.expires_at).getTime() <= Date.now()) return fail('expired');
  const people = await select('frontrow', 'contacts', `select=email,full_name&id=eq.${t.contact_id}`);
  const [org] = await orgsByIds([t.organization_id]);
  return json(200, { ok: true, kind: t.purpose, email: people && people[0] ? people[0].email : '', name: people && people[0] ? people[0].full_name : '', org: org ? org.slug : null });
});
