import { select, json, UUID_RE } from './core.js';

/* Who may do what in the Frontrow Manager. One table, read everywhere, so a
 * role's powers are never decided in two places.
 *
 *   super_admin      everything, including the team and roles
 *   manager          every client; publish, assign, configure
 *   account_manager  only assigned clients; full publishing rights
 *   supervisor       only assigned clients; read-only for now (the explainer
 *                    leaves supervisor scope open — read plus reminders is the
 *                    suggested default, and reminders do not exist yet)
 *
 * "assist" is Gemini drafting. It follows publish rights: anyone who can put
 * an update in front of a client can ask for a draft of one.
 */
export const CAN = {
  super_admin:     { seeAll: true,  publish: true,  edit: true,  manageClients: true,  manageTeam: true,  assist: true },
  manager:         { seeAll: true,  publish: true,  edit: true,  manageClients: true,  manageTeam: false, assist: true },
  account_manager: { seeAll: false, publish: true,  edit: true,  manageClients: false, manageTeam: false, assist: true },
  supervisor:      { seeAll: false, publish: false, edit: false, manageClients: false, manageTeam: false, assist: false }
};

export function can(role, power) {
  return Boolean(CAN[role] && CAN[role][power]);
}

export function requirePower(session, power, message) {
  if (!can(session.role, power)) {
    throw json(403, { error: message || 'Your role does not allow that.' });
  }
}

/** null means "every company"; otherwise the list of company ids this person
 *  is assigned to. Derived from the session on every call — the browser's
 *  idea of which companies it may see is never trusted. */
export async function visibleCompanyIds(session, db = { select }) {
  if (can(session.role, 'seeAll')) return null;
  if (!session.personId) return [];
  const rows = await db.select('frontrow', 'staff_company_assignments',
    `select=company_id&person_id=eq.${session.personId}`);
  return (rows || []).map((r) => r.company_id);
}

export const COMPANY_FIELDS = 'id,name,organization_id,branch_id,clickup_account_id,clickup_status,branding,primary_owner_person_id,active,source,synced_at';

/** Loads one company the session may see, or throws 400/404.
 *  Not-visible and not-found both answer 404, so an id that exists but is not
 *  yours looks exactly like one that does not exist. */
export async function loadVisibleCompany(session, companyId, db = { select }) {
  if (!UUID_RE.test(String(companyId || ''))) throw json(400, { error: 'A valid client is required.' });
  const ids = await visibleCompanyIds(session, db);
  if (ids !== null && !ids.includes(companyId)) throw json(404, { error: 'Client not found.' });
  const rows = await db.select('frontrow', 'companies',
    `select=${COMPANY_FIELDS}&id=eq.${companyId}`);
  const company = rows && rows[0];
  if (!company) throw json(404, { error: 'Client not found.' });
  return company;
}

/** PostgREST filter fragment limiting a query to visible companies. */
export function companyFilter(ids, column = 'company_id') {
  if (ids === null) return '';
  // An empty in.() list is an edge PostgREST does not handle uniformly, so an
  // id that cannot exist is used instead: valid syntax, matches nothing.
  if (ids.length === 0) return `${column}=eq.00000000-0000-0000-0000-000000000000`;
  return `${column}=in.(${ids.join(',')})`;
}
