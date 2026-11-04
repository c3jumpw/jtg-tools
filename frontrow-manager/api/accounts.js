import { select, insert, patch, remove, json, readJson, originAllowed, UUID_RE, route, clean } from '../lib/core.js';
import { requireSession } from '../lib/auth.js';
import { requirePower, visibleCompanyIds, loadVisibleCompany } from '../lib/access.js';
import { audit } from '../lib/pipeline.js';
import { inviteContact, requireVisibleContact } from '../lib/invites.js';
import { comment, relateContactToAccount } from '../lib/clickup.js';

/* Client accounts: every contact a staff member can see, with their sign-in
 * status, and the actions on them.
 *
 *   GET   ?q=                         list (max 500, newest activity first)
 *   POST  ?action=invite  { contactId, companyId?, send }   setup/reset link
 *   POST  ?action=link    { contactId, companyId }          associate with a company
 *   POST  ?action=status  { contactId, status }             'active' | 'disabled'
 */

// Search is a single word: characters that mean something to PostgREST
// filters or LIKE are removed rather than escaped.
function searchWord(s) { return String(s || '').replace(/[\\%_*(),."':]/g, ' ').trim().split(/\s+/)[0] || ''; }

async function list(session, q) {
  const ids = await visibleCompanyIds(session);
  if (ids && ids.length === 0) return [];
  const linkFilter = ids === null ? '' : `&company_id=in.(${ids.join(',')})`;
  const links = await select('frontrow', 'contact_companies',
    `select=contact_id,company_id,source,role,companies(id,name,active,organization_id)${linkFilter}&limit=5000`) || [];
  const contactIds = [...new Set(links.map((l) => l.contact_id))];
  if (!contactIds.length) return [];
  const term = searchWord(q).slice(0, 60);
  const people = [];
  const accounts = [];
  for (let i = 0; i < contactIds.length; i += 150) {
    const part = contactIds.slice(i, i + 150).join(',');
    const search = term ? `&or=(email.ilike.*${encodeURIComponent(term)}*,full_name.ilike.*${encodeURIComponent(term)}*)` : '';
    people.push(...(await select('frontrow', 'contacts', `select=id,email,full_name,clickup_contact_id,active&id=in.(${part})${search}`) || []));
    accounts.push(...(await select('frontrow', 'accounts', `select=contact_id,status,activated_at,last_sign_in_at,password_hash&contact_id=in.(${part})`) || []));
  }
  const acc = new Map(accounts.map((a) => [a.contact_id, a]));
  const byContact = new Map();
  for (const l of links) {
    if (!l.companies) continue;
    (byContact.get(l.contact_id) || byContact.set(l.contact_id, []).get(l.contact_id)).push({
      id: l.companies.id, name: l.companies.name, active: l.companies.active, organizationId: l.companies.organization_id, source: l.source
    });
  }
  return people.map((p) => {
    const a = acc.get(p.id);
    const companies = (byContact.get(p.id) || []).sort((x, y) => x.name.localeCompare(y.name));
    return {
      contactId: p.id,
      email: p.email,
      fullName: p.full_name,
      clickupContactId: p.clickup_contact_id,
      active: p.active,
      eligible: p.active !== false && companies.some((c) => c.active),
      companies,
      account: a ? { status: a.status, hasPassword: Boolean(a.password_hash), activatedAt: a.activated_at, lastSignInAt: a.last_sign_in_at } : null
    };
  }).sort((x, y) => String((y.account || {}).lastSignInAt || '').localeCompare(String((x.account || {}).lastSignInAt || '')) || x.email.localeCompare(y.email))
    .slice(0, 500);
}

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  const session = await requireSession(request);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    return json(200, { accounts: await list(session, clean(url.searchParams.get('q'), 80)) });
  }
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const { body, error } = await readJson(request, 4000);
  if (error) return error;
  const action = url.searchParams.get('action');

  if (action === 'invite') {
    requirePower(session, 'edit', 'Your role can’t send setup links.');
    return json(200, await inviteContact(session, body.contactId, { companyId: UUID_RE.test(String(body.companyId || '')) ? body.companyId : null, send: Boolean(body.send) }));
  }

  if (action === 'link') {
    requirePower(session, 'edit', 'Your role can’t change who sees a client.');
    const contact = await requireVisibleContact(session, body.contactId);
    const company = await loadVisibleCompany(session, body.companyId);
    const role = ['owner', 'member', 'viewer'].includes(body.role) ? body.role : 'member';
    await insert('frontrow', 'contact_companies', { contact_id: contact.id, company_id: company.id, role, source: 'manual' }, { onConflict: 'contact_id,company_id' });
    // Write it back to ClickUp so the next sync agrees, and leave a note.
    let related = false;
    if (contact.clickup_contact_id && company.clickup_account_id) related = await relateContactToAccount(contact.clickup_contact_id, company.clickup_account_id);
    await comment(contact.clickup_contact_id, `Frontrow: linked to ${company.name} by ${session.fullName || session.email}.${related ? '' : ' (Add the relationship in ClickUp too, so the CRM shows it.)'}`);
    await audit(session, 'account.link', contact.id, { company_id: company.id, clickup_related: related });
    return json(200, { ok: true, clickupRelated: related });
  }

  if (action === 'status') {
    requirePower(session, 'manageClients', 'Only managers can switch accounts on or off.');
    const contact = await requireVisibleContact(session, body.contactId);
    if (!['active', 'disabled'].includes(body.status)) return json(400, { error: 'Choose on or off.' });
    const rows = await patch('frontrow', 'accounts', `contact_id=eq.${contact.id}`, { status: body.status, failed_attempts: 0, locked_until: null });
    if (!rows || !rows[0]) return json(404, { error: 'This contact hasn’t set up an account yet.' });
    if (body.status === 'disabled') await remove('frontrow', 'client_sessions', `contact_id=eq.${contact.id}`);
    await comment(contact.clickup_contact_id, `Frontrow: account ${body.status === 'disabled' ? 'switched off' : 'switched back on'} by ${session.fullName || session.email}.`);
    await audit(session, `account.${body.status === 'disabled' ? 'disable' : 'enable'}`, contact.id, {});
    return json(200, { ok: true });
  }

  return json(400, { error: 'Unknown action.' });
});
