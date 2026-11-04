import { select, insert, patch, json, clean, cleanBlock, UUID_RE } from './core.js';
import { requirePower, loadVisibleCompany } from './access.js';
import { sanitizeHtml } from './sanitize.js';

/* The one pipeline every update action goes through, as the explainer sets
 * out: (1) validate the actor's role and access to the client, (2) save,
 * (3) write to ClickUp where relevant, (4) audit and notify.
 *
 * Steps 3 and the notify half of 4 arrive with the ClickUp-sync and
 * notifications phases; they slot in here without any caller changing.
 */

export const TYPES = ['update', 'task', 'guide', 'report', 'meeting'];
const LIMITS = { title: 200, summary: 1000, notes: 20000, body: 2000000 };

const DEFAULT_DB = { select, insert, patch };

export async function audit(session, action, entityId, detail, db = DEFAULT_DB) {
  try {
    await db.insert('core', 'audit_log', {
      actor_person_id: session.personId || null,
      tool: 'frontrow',
      action,
      // 'update.publish' -> 'update', 'company.create' -> 'company'
      entity: String(action).split('.')[0],
      entity_id: entityId ? String(entityId) : null,
      detail: { actor_type: 'staff', actor_email: session.email, ...detail }
    });
  } catch (e) {
    // An audit failure must be visible in the logs, but must not undo work
    // the user has already seen succeed.
    console.error('frontrow audit write failed', action, e.message);
  }
}

/** Validates and normalises editable fields. Only fields present are returned. */
export function readFields(input) {
  const out = {};
  const errors = [];
  if ('type' in input) {
    if (!TYPES.includes(input.type)) errors.push('Choose a valid type.');
    else out.type = input.type;
  }
  if ('title' in input) {
    const t = clean(input.title, LIMITS.title + 1);
    if (!t) errors.push('A title is required.');
    else if (t.length > LIMITS.title) errors.push(`Keep the title under ${LIMITS.title} characters.`);
    else out.title = t;
  }
  if ('summary' in input) {
    const s = clean(input.summary, LIMITS.summary + 1);
    if (s.length > LIMITS.summary) errors.push(`Keep the summary under ${LIMITS.summary} characters.`);
    else out.summary = s;
  }
  if ('notes' in input) {
    const n = cleanBlock(input.notes, LIMITS.notes + 1);
    if (n.length > LIMITS.notes) errors.push(`Notes are limited to ${LIMITS.notes.toLocaleString('en-US')} characters.`);
    else out.notes = n;
  }
  if ('bodyHtml' in input) {
    const raw = typeof input.bodyHtml === 'string' ? input.bodyHtml : '';
    if (raw.length > LIMITS.body) errors.push('That page is too large (over 2 MB).');
    else out.body_html = sanitizeHtml(raw);
  }
  if (errors.length) throw json(400, { error: errors.join(' ') });
  return out;
}

async function loadUpdate(id, db) {
  if (!UUID_RE.test(String(id || ''))) throw json(400, { error: 'A valid update is required.' });
  const rows = await db.select('frontrow', 'updates', `select=*&id=eq.${id}`);
  const u = rows && rows[0];
  if (!u) throw json(404, { error: 'Update not found.' });
  return u;
}

export async function createDraft(session, input, db = DEFAULT_DB) {
  requirePower(session, 'edit', 'Your role can view updates but not write them.');
  const company = await loadVisibleCompany(session, input.companyId, db);
  const fields = readFields({ type: 'update', title: '', ...input });
  const rows = await db.insert('frontrow', 'updates', {
    company_id: company.id,
    type: fields.type || 'update',
    title: fields.title,
    summary: fields.summary || '',
    notes: fields.notes || '',
    body_html: fields.body_html || '',
    status: 'draft',
    created_by: session.personId || null
  });
  const update = rows && rows[0];
  await audit(session, 'update.create', update && update.id, { company_id: company.id, title: fields.title }, db);
  return update;
}

export async function saveUpdate(session, id, input, db = DEFAULT_DB) {
  requirePower(session, 'edit', 'Your role can view updates but not edit them.');
  const current = await loadUpdate(id, db);
  await loadVisibleCompany(session, current.company_id, db);
  if (current.status === 'archived') throw json(409, { error: 'This update is archived. Restore it as a draft before editing.' });
  // Two people editing the same update: the second save would silently undo
  // the first. The composer sends the version it loaded; refuse if it moved.
  if (input.expectedUpdatedAt && current.updated_at &&
      new Date(input.expectedUpdatedAt).getTime() !== new Date(current.updated_at).getTime()) {
    throw json(409, { error: 'Someone else saved this update after you opened it. Copy your changes, reload to see theirs, then re-apply yours.' });
  }
  const fields = readFields(input);
  if (Object.keys(fields).length === 0) return current;
  // The check above catches a stale editor; this filter catches two saves
  // landing at the same moment — only one can match the old updated_at.
  const rows = await db.patch('frontrow', 'updates',
    `id=eq.${current.id}&updated_at=eq.${encodeURIComponent(current.updated_at)}`, fields);
  const updated = rows && rows[0];
  if (!updated) throw json(409, { error: 'Someone else saved this update at the same moment. Copy your changes, reload, then re-apply them.' });
  await audit(session, current.status === 'published' ? 'update.edit_published' : 'update.edit', current.id,
    { company_id: current.company_id, fields: Object.keys(fields) }, db);
  return updated;
}

/** publish | unpublish | archive | restore */
export async function transition(session, id, action, db = DEFAULT_DB) {
  const current = await loadUpdate(id, db);
  await loadVisibleCompany(session, current.company_id, db);
  const now = new Date().toISOString();
  let changes;
  if (action === 'publish') {
    requirePower(session, 'publish', 'Your role cannot publish to clients.');
    if (current.status === 'published') return current;
    if (current.status === 'archived') throw json(409, { error: 'Restore this update as a draft before publishing it.' });
    if (!String(current.title || '').trim()) throw json(400, { error: 'Add a title before publishing.' });
    if (!String(current.body_html || '').trim() && !String(current.summary || '').trim()) {
      throw json(400, { error: 'Add the page or at least a summary before publishing — the client would see an empty update.' });
    }
    changes = { status: 'published', published_at: now, published_by: session.personId || null };
  } else if (action === 'unpublish') {
    requirePower(session, 'publish', 'Your role cannot change what clients see.');
    if (current.status !== 'published') return current;
    changes = { status: 'draft', published_at: null, published_by: null };
  } else if (action === 'archive') {
    requirePower(session, 'publish', 'Your role cannot archive updates.');
    if (current.status === 'archived') return current;
    changes = { status: 'archived' };
  } else if (action === 'restore') {
    requirePower(session, 'edit', 'Your role cannot restore updates.');
    if (current.status !== 'archived') return current;
    changes = { status: 'draft', published_at: null, published_by: null };
  } else {
    throw json(400, { error: 'Unknown action.' });
  }
  // Only applies if the status is still what we checked, so two people
  // publishing/unpublishing at once can't both "win".
  const rows = await db.patch('frontrow', 'updates', `id=eq.${current.id}&status=eq.${current.status}`, changes);
  const updated = rows && rows[0];
  if (!updated) throw json(409, { error: 'This update changed while you were looking at it. Reload and try again.' });
  await audit(session, `update.${action}`, current.id,
    { company_id: current.company_id, title: current.title, from: current.status, to: changes.status }, db);
  // Notification and CRM-timeline hooks attach here in their phases.
  return updated;
}

export { loadUpdate };
