import { select, json, readJson, originAllowed, route } from '../lib/core.js';
import { requireSession } from '../lib/auth.js';
import { loadVisibleCompany } from '../lib/access.js';
import { createDraft, saveUpdate, transition, loadUpdate } from '../lib/pipeline.js';

/* Portal updates for one client.
 *
 *   GET    ?companyId=          list (no page bodies — they can be large)
 *   GET    ?id=                 one update, with notes and page, for editing
 *   POST                        new draft  { companyId, type, title, summary, notes, bodyHtml }
 *   PATCH  ?id=                 save edits (same fields, all optional)
 *   POST   ?id=&action=publish  publish | unpublish | archive | restore
 *
 * Every write goes through lib/pipeline.js, which checks role and client
 * access, validates, sanitises the page and writes the audit row. */

const LIST_FIELDS = 'id,type,title,summary,status,published_at,created_at,updated_at,created_by,published_by';
const ACTIONS = ['publish', 'unpublish', 'archive', 'restore'];

function shape(u) {
  return {
    id: u.id,
    companyId: u.company_id,
    type: u.type,
    title: u.title,
    summary: u.summary,
    status: u.status,
    publishedAt: u.published_at,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    ...('notes' in u ? { notes: u.notes } : {}),
    ...('body_html' in u ? { bodyHtml: u.body_html } : {})
  };
}

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  const session = await requireSession(request);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (request.method === 'GET') {
    if (id) {
      const u = await loadUpdate(id, { select });
      await loadVisibleCompany(session, u.company_id);
      return json(200, { update: shape(u) });
    }
    const company = await loadVisibleCompany(session, url.searchParams.get('companyId'));
    const status = url.searchParams.get('status');
    const statusFilter = ['draft', 'published', 'archived'].includes(status) ? `&status=eq.${status}` : '';
    const rows = await select('frontrow', 'updates',
      `select=${LIST_FIELDS}&company_id=eq.${company.id}${statusFilter}&order=updated_at.desc&limit=200`) || [];
    return json(200, { updates: rows.map(shape) });
  }

  if (request.method === 'POST' && id) {
    const action = url.searchParams.get('action');
    if (!ACTIONS.includes(action)) return json(400, { error: 'Unknown action.' });
    const u = await transition(session, id, action);
    return json(200, { update: shape(u) });
  }

  if (request.method === 'POST') {
    const { body, error } = await readJson(request, 2100000);
    if (error) return error;
    const u = await createDraft(session, body);
    return json(201, { update: shape(u) });
  }

  if (request.method === 'PATCH') {
    if (!id) return json(400, { error: 'A valid update is required.' });
    const { body, error } = await readJson(request, 2100000);
    if (error) return error;
    // companyId and status are never editable here: moving an update between
    // clients or publishing it each have their own checked path.
    delete body.companyId; delete body.status;
    const u = await saveUpdate(session, id, body);
    return json(200, { update: shape(u) });
  }

  return json(405, { error: 'Method not allowed.' });
});
