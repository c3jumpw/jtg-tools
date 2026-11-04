import { select, insert, patch, json, readJson, originAllowed, UUID_RE, route } from '../lib/core.js';
import { requireSession } from '../lib/auth.js';
import { requirePower, loadVisibleCompany } from '../lib/access.js';
import { audit } from '../lib/pipeline.js';
import { contactByEmail } from '../lib/directory.js';
import { comment, relateContactToAccount, taskUrl } from '../lib/clickup.js';
import { inviteContact } from '../lib/invites.js';

/* Access requests: people who asked for a portal from a sign-in page but
 * weren't linked to an active account, and confirmed their email.
 *
 *   GET                                   confirmed requests waiting, plus recent handled ones
 *   POST ?action=approve&id=  { companyId }   link them to a company and email a setup link
 *   POST ?action=dismiss&id=
 */

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  const session = await requireSession(request);
  requirePower(session, 'manageClients', 'Only managers can handle access requests.');
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const rows = await select('frontrow', 'access_requests',
      'select=id,organization_id,email,full_name,company_name,message,status,clickup_task_id,created_at,confirmed_at,handled_at&status=in.(confirmed,approved,dismissed)&order=created_at.desc&limit=200') || [];
    const orgs = await select('frontrow', 'organizations', 'select=id,name,slug') || [];
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    return json(200, {
      requests: rows.map((r) => ({
        id: r.id, email: r.email, fullName: r.full_name, companyName: r.company_name, message: r.message,
        status: r.status, organization: orgName.get(r.organization_id) || null, organizationId: r.organization_id,
        clickupUrl: r.clickup_task_id ? taskUrl(r.clickup_task_id) : null,
        createdAt: r.created_at, confirmedAt: r.confirmed_at, handledAt: r.handled_at
      }))
    });
  }
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const id = url.searchParams.get('id');
  if (!UUID_RE.test(String(id || ''))) return json(400, { error: 'Choose a request.' });
  const rows = await select('frontrow', 'access_requests', `select=*&id=eq.${id}`);
  const req = rows && rows[0];
  if (!req) return json(404, { error: 'Request not found.' });
  if (req.status !== 'confirmed') return json(409, { error: 'This request has already been handled.' });
  const { body, error } = await readJson(request, 2000);
  if (error) return error;
  const now = new Date().toISOString();

  if (url.searchParams.get('action') === 'dismiss') {
    const done = await patch('frontrow', 'access_requests', `id=eq.${req.id}&status=eq.confirmed`, { status: 'dismissed', handled_by: session.personId || null, handled_at: now });
    if (!done || !done.length) return json(409, { error: 'This request has already been handled.' });
    await comment(req.clickup_task_id, `Frontrow: access request dismissed by ${session.fullName || session.email}.`);
    await audit(session, 'request.dismiss', req.id, { email: req.email });
    return json(200, { ok: true });
  }

  if (url.searchParams.get('action') === 'approve') {
    const company = await loadVisibleCompany(session, body.companyId);
    if (!company.active) return json(409, { error: 'That company isn’t active, so the person still couldn’t sign in. Pick an active one or activate it in ClickUp.' });
    // Claim the request first, so two people approving at once (or a double
    // click) can't link the person twice and send two setup emails.
    const claimed = await patch('frontrow', 'access_requests', `id=eq.${req.id}&status=eq.confirmed`, { status: 'approved', handled_by: session.personId || null, handled_at: now });
    if (!claimed || !claimed.length) return json(409, { error: 'This request has already been handled.' });
    try {
      let contact = await contactByEmail(req.email);
      // The ClickUp entry noted on the request is only theirs if no other
      // contact already holds it (their email may have changed since).
      const taken = req.clickup_task_id
        ? ((await select('frontrow', 'contacts', `select=id&clickup_contact_id=eq.${encodeURIComponent(req.clickup_task_id)}`)) || []).length > 0
        : true;
      if (!contact) {
        contact = (await insert('frontrow', 'contacts', { email: req.email, full_name: req.full_name, clickup_contact_id: taken ? null : req.clickup_task_id }))[0];
      } else if (!contact.clickup_contact_id && !taken) {
        await patch('frontrow', 'contacts', `id=eq.${contact.id}`, { clickup_contact_id: req.clickup_task_id });
        contact.clickup_contact_id = req.clickup_task_id;
      }
      await insert('frontrow', 'contact_companies', { contact_id: contact.id, company_id: company.id, role: 'member', source: 'manual' }, { onConflict: 'contact_id,company_id' });
      if (contact.clickup_contact_id && company.clickup_account_id) await relateContactToAccount(contact.clickup_contact_id, company.clickup_account_id);
      await audit(session, 'request.approve', req.id, { email: req.email, company_id: company.id });
      const invite = await inviteContact(session, contact.id, { companyId: company.id, send: true });
      return json(200, { ok: true, invite });
    } catch (e) {
      // Put it back so it can be approved again once the problem is fixed.
      await patch('frontrow', 'access_requests', `id=eq.${req.id}&status=eq.approved`, { status: 'confirmed', handled_by: null, handled_at: null }).catch(() => {});
      throw e;
    }
  }

  return json(400, { error: 'Unknown action.' });
});
