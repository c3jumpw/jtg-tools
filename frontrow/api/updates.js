import { select, json, originAllowed, route } from '../lib/core.js';
import { requireClient, requireClientCompany } from '../lib/client-auth.js';

/* GET ?companyId= — the published updates for one of the client's companies.
 * Drafts, archived updates and staff notes never leave the server here. */

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  const client = await requireClient(request);
  const company = await requireClientCompany(client, new URL(request.url).searchParams.get('companyId'));
  const rows = await select('frontrow', 'updates',
    `select=id,type,title,summary,published_at&company_id=eq.${company.id}&status=eq.published&order=published_at.desc&limit=100`) || [];
  return json(200, {
    updates: rows.map((u) => ({ id: u.id, type: u.type, title: u.title, summary: u.summary, publishedAt: u.published_at }))
  });
});
