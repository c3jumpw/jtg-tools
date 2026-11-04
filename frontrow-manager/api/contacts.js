import { select, insert, patch, remove, json, clean, readJson, originAllowed, EMAIL_RE, UUID_RE, route } from '../lib/core.js';
import { requireSession } from '../lib/auth.js';
import { requirePower, loadVisibleCompany, visibleCompanyIds } from '../lib/access.js';
import { audit } from '../lib/pipeline.js';
import { contactByEmail, orgsByIds } from '../lib/directory.js';
import { clickupAvailable, createContact, relateContactToAccount, comment } from '../lib/clickup.js';
import { accountFor } from '../lib/invites.js';

/* The people on one client company.
 *
 *   GET    ?companyId=                     contacts with their account status
 *   POST   { companyId, email, fullName, role }   add someone
 *   PATCH  ?contactId=&companyId=  { role }      change role
 *   DELETE ?contactId=&companyId=                 remove from this company
 *
 * ClickUp stays the source of truth. Adding someone who isn't in ClickUp
 * creates their contact entry there (with a note); links that come from
 * ClickUp can only be removed in ClickUp, or the next sync would restore them.
 */

const ROLES = ['owner', 'member', 'viewer'];

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  const session = await requireSession(request);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const company = await loadVisibleCompany(session, url.searchParams.get('companyId'));
    const links = await select('frontrow', 'contact_companies',
      `select=role,source,created_at,contacts(id,email,full_name,clickup_contact_id,active)&company_id=eq.${company.id}&order=created_at.asc`) || [];
    const out = [];
    for (const l of links.filter((x) => x.contacts)) {
      out.push({
        id: l.contacts.id, email: l.contacts.email, fullName: l.contacts.full_name, active: l.contacts.active,
        clickupContactId: l.contacts.clickup_contact_id, role: l.role, source: l.source,
        account: await accountFor(l.contacts.id)
      });
    }
    return json(200, { contacts: out });
  }

  requirePower(session, 'edit', 'Your role can’t change who has portal access.');

  if (request.method === 'POST') {
    const { body, error } = await readJson(request, 4000);
    if (error) return error;
    const company = await loadVisibleCompany(session, body.companyId);
    const email = clean(body.email, 200).toLowerCase();
    const fullName = clean(body.fullName, 120);
    const role = ROLES.includes(body.role) ? body.role : 'member';
    if (!EMAIL_RE.test(email) || /[,()"]/.test(email)) return json(400, { error: 'Enter a valid email address.' });

    let contact = await contactByEmail(email);
    // Someone who is already a contact on other clients can only be added by
    // staff who can see all of those clients: otherwise adding them here
    // would make them "visible" and open their account to this person.
    if (contact) {
      const visible = await visibleCompanyIds(session);
      if (visible !== null) {
        const theirs = await select('frontrow', 'contact_companies', `select=company_id&contact_id=eq.${contact.id}`) || [];
        if (theirs.some((l) => !visible.includes(l.company_id))) {
          return json(403, { error: 'This person is already a contact on a client you don’t manage. Ask a manager to add them here.', code: 'other_client' });
        }
      }
    }
    let createdInClickUp = false;
    if (!contact || !contact.clickup_contact_id) {
      // Not in ClickUp yet: create their contact entry there first, so
      // ClickUp keeps being the one list of who our clients are.
      let clickupId = null;
      if (clickupAvailable()) {
        const [org] = await orgsByIds([company.organization_id]);
        try {
          clickupId = await createContact({ name: fullName || (contact && contact.full_name) || email, email, orgLabel: org && org.clickup_label });
          createdInClickUp = true;
        } catch (e) {
          console.error('clickup create contact failed', e.message);
        }
      }
      if (contact) {
        if (clickupId) await patch('frontrow', 'contacts', `id=eq.${contact.id}`, { clickup_contact_id: clickupId });
        contact = { ...contact, clickup_contact_id: clickupId || contact.clickup_contact_id };
      } else {
        contact = (await insert('frontrow', 'contacts', { email, full_name: fullName, clickup_contact_id: clickupId }))[0];
      }
    }
    await insert('frontrow', 'contact_companies', { contact_id: contact.id, company_id: company.id, role, source: 'manual' },
      { onConflict: 'contact_id,company_id' });

    let related = false;
    if (contact.clickup_contact_id && company.clickup_account_id) related = await relateContactToAccount(contact.clickup_contact_id, company.clickup_account_id);
    await comment(contact.clickup_contact_id,
      `Frontrow: ${createdInClickUp ? 'contact created and ' : ''}added to ${company.name} by ${session.fullName || session.email}.${related || !company.clickup_account_id ? '' : ' (Link this contact to the account in ClickUp too.)'}`);
    await audit(session, 'contact.link', contact.id, { company_id: company.id, email, role, created_in_clickup: createdInClickUp });
    return json(201, { id: contact.id, createdInClickUp, clickupRelated: related, clickupConnected: clickupAvailable() });
  }

  const contactId = url.searchParams.get('contactId');
  if (!UUID_RE.test(String(contactId || ''))) return json(400, { error: 'A valid contact is required.' });
  const company = await loadVisibleCompany(session, url.searchParams.get('companyId'));
  const links = await select('frontrow', 'contact_companies', `select=source&contact_id=eq.${contactId}&company_id=eq.${company.id}`);
  const link = links && links[0];
  if (!link) return json(404, { error: 'That person isn’t on this client.' });

  if (request.method === 'PATCH') {
    const { body, error } = await readJson(request, 1000);
    if (error) return error;
    if (!ROLES.includes(body.role)) return json(400, { error: 'Choose owner, member or viewer.' });
    await patch('frontrow', 'contact_companies', `contact_id=eq.${contactId}&company_id=eq.${company.id}`, { role: body.role });
    await audit(session, 'contact.role', contactId, { company_id: company.id, role: body.role });
    return json(200, { ok: true });
  }

  if (request.method === 'DELETE') {
    if (link.source === 'clickup') {
      return json(409, { error: 'This link comes from ClickUp. Remove the relationship there; the next sync will update Frontrow.', code: 'clickup_link' });
    }
    await remove('frontrow', 'contact_companies', `contact_id=eq.${contactId}&company_id=eq.${company.id}&source=eq.manual`);
    await audit(session, 'contact.unlink', contactId, { company_id: company.id });
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed.' });
});
