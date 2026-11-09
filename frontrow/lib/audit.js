import { insert } from './core.js';

/* Client actions land in the same append-only core.audit_log as staff
 * actions (tool 'frontrow'), marked actor_type 'client'. Clients are not
 * core.people, so actor_person_id stays empty and the contact goes in detail. */
export async function auditClient(client, action, entityId, detail = {}, db = { insert }) {
  try {
    await db.insert('core', 'audit_log', {
      actor_person_id: null,
      tool: 'frontrow',
      action,
      entity: String(action).split('.')[0],
      entity_id: entityId ? String(entityId) : null,
      detail: { actor_type: 'client', contact_id: client.contactId, actor_email: client.email, ...detail }
    });
  } catch (e) {
    console.error('frontrow client audit failed', action, e.message);
  }
}
