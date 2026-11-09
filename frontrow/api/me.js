import { patch, json, originAllowed, route } from '../lib/core.js';
import { requireClient, readCookie, sessionCookie } from '../lib/client-auth.js';
import { hashToken } from '../lib/tokens.js';
import { activeCompaniesFor, orgsByIds, branchesFor, publicOrg } from '../lib/directory.js';
import { auditClient } from '../lib/audit.js';

/*  GET                  who is signed in, their companies, and the public
 *                       face of each organization those companies belong to
 *  POST ?action=logout  ends the session */

export default route(async (request) => {
  const action = new URL(request.url).searchParams.get('action');

  if (request.method === 'POST' && action === 'logout') {
    if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
    const token = readCookie(request);
    if (token) {
      try {
        const rows = await patch('frontrow', 'client_sessions', `token_hash=eq.${hashToken(token)}`, { expires_at: new Date(Date.now() - 1000).toISOString() });
        if (rows && rows[0]) await auditClient({ contactId: rows[0].contact_id, email: null }, 'client.sign_out', rows[0].contact_id);
      } catch { /* the cookie is cleared regardless */ }
    }
    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('', { clear: true }) });
  }
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed.' });

  let client;
  try {
    client = await requireClient(request);
  } catch (e) {
    if (e instanceof Response && e.status === 401) return json(200, { authenticated: false });
    throw e;
  }
  const companies = await activeCompaniesFor(client.contactId);
  const orgs = await orgsByIds(companies.map((c) => c.organizationId));
  const organizations = [];
  for (const o of orgs) organizations.push(publicOrg(o, await branchesFor(o.id)));
  const slugById = new Map(orgs.map((o) => [o.id, o.slug]));
  return json(200, {
    authenticated: true,
    email: client.email,
    fullName: client.fullName,
    companies: companies.map((c) => ({ id: c.id, name: c.name, org: slugById.get(c.organizationId) || null, accent: c.accent })),
    organizations
  });
});
