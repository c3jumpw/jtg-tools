import { select, esc, UUID_RE, route } from '../lib/core.js';
import { requireClient } from '../lib/client-auth.js';
import { activeCompaniesFor } from '../lib/directory.js';
import { asDocument, VIEW_HEADERS } from '../lib/sanitize.js';
import { auditClient } from '../lib/audit.js';

/* GET ?id= — one published update page, for a client linked to its company.
 *
 * Served under VIEW_HEADERS (CSP sandbox: no scripts, forms or navigation,
 * opaque origin) and framed only by this site. Anything not visible to this
 * client — a draft, another company's update, a made-up id — gets the same
 * "not available" page, so ids can't be probed. */

function page(status, title, message) {
  return new Response(asDocument(`<h1 style="font-size:20px;color:#15161D">${esc(title)}</h1><p>${esc(message)}</p>`, title),
    { status, headers: VIEW_HEADERS });
}

export default route(async (request) => {
  if (request.method !== 'GET') return page(405, 'Not available', 'Open updates from your portal.');
  let client;
  try { client = await requireClient(request); } catch { return page(401, 'Signed out', 'Sign in to your portal again to see this update.'); }

  const id = new URL(request.url).searchParams.get('id');
  const notFound = () => page(404, 'Not available', 'This update isn’t available. It may have been taken down, or it belongs to another account.');
  if (!UUID_RE.test(String(id || ''))) return notFound();

  const rows = await select('frontrow', 'updates', `select=id,company_id,title,summary,body_html,status&id=eq.${id}`);
  const u = rows && rows[0];
  if (!u || u.status !== 'published') return notFound();
  const companies = await activeCompaniesFor(client.contactId);
  if (!companies.some((c) => c.id === u.company_id)) return notFound();

  await auditClient(client, 'update.view', u.id, { company_id: u.company_id });
  const body = String(u.body_html || '').trim()
    || `<h1 style="font-size:22px;color:#15161D">${esc(u.title)}</h1><p>${esc(u.summary || '')}</p>`;
  return new Response(asDocument(body, u.title), { status: 200, headers: VIEW_HEADERS });
});
