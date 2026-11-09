import { select, insert, patch, remove, json, readJson, originAllowed, UUID_RE, route } from '../lib/core.js';
import { requireSession, TOOL } from '../lib/auth.js';
import { requirePower, loadVisibleCompany } from '../lib/access.js';
import { audit } from '../lib/pipeline.js';

/* Which staff work on which client. Account managers and supervisors only
 * see clients assigned to them here; managers and super admins see all. */

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  const session = await requireSession(request);
  requirePower(session, 'manageClients', 'Only managers and super admins can assign staff to clients.');

  if (request.method === 'POST') {
    const { body, error } = await readJson(request, 2000);
    if (error) return error;
    const company = await loadVisibleCompany(session, body.companyId);
    if (!UUID_RE.test(String(body.personId || ''))) return json(400, { error: 'Choose a team member.' });
    const staff = await select('core', 'tool_access', `select=person_id&person_id=eq.${body.personId}&tool=eq.${TOOL}`);
    if (!staff || !staff[0]) return json(400, { error: 'That person does not have Frontrow Manager access yet. Add them on the Team page first.' });
    const isPrimary = Boolean(body.isPrimary);
    if (isPrimary) {
      // One primary per client, so requests and notifications route to one accountable person.
      await patch('frontrow', 'staff_company_assignments', `company_id=eq.${company.id}&is_primary=eq.true`, { is_primary: false });
      await patch('frontrow', 'companies', `id=eq.${company.id}`, { primary_owner_person_id: body.personId });
    }
    await insert('frontrow', 'staff_company_assignments',
      { person_id: body.personId, company_id: company.id, is_primary: isPrimary },
      { onConflict: 'person_id,company_id' });
    await audit(session, 'assignment.add', body.personId, { company_id: company.id, is_primary: isPrimary });
    return json(201, { ok: true });
  }

  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const personId = url.searchParams.get('personId');
    if (!UUID_RE.test(String(personId || ''))) return json(400, { error: 'Choose a team member.' });
    const company = await loadVisibleCompany(session, url.searchParams.get('companyId'));
    await remove('frontrow', 'staff_company_assignments', `person_id=eq.${personId}&company_id=eq.${company.id}`);
    if (company.primary_owner_person_id === personId) {
      await patch('frontrow', 'companies', `id=eq.${company.id}`, { primary_owner_person_id: null });
    }
    await audit(session, 'assignment.remove', personId, { company_id: company.id });
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed.' });
});
