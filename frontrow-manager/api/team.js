import { select, insert, patch, remove, json, clean, readJson, originAllowed, EMAIL_RE, UUID_RE, route, emailFilter, sameEmail } from '../lib/core.js';
import { requireSession, bootstrapEmails, TOOL, ROLES } from '../lib/auth.js';
import { requirePower, can } from '../lib/access.js';
import { audit } from '../lib/pipeline.js';

/* Frontrow Manager staff. Listing is open to anyone who assigns staff to
 * clients (they need the names); granting, changing and removing access is
 * super-admin only. Bootstrap super admins come from an env var and are
 * shown as such — they can't be removed here because the next sign-in would
 * simply restore them. */

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  const session = await requireSession(request);
  const boot = bootstrapEmails();

  if (request.method === 'GET') {
    if (!can(session.role, 'manageClients') && !can(session.role, 'manageTeam')) {
      return json(403, { error: 'Your role cannot see the team list.' });
    }
    const rows = await select('core', 'people',
      `select=id,full_name,email,active,tool_access!inner(role,tool)&tool_access.tool=eq.${TOOL}&order=full_name.asc`) || [];
    const team = rows.map((p) => ({
      personId: p.id, fullName: p.full_name, email: p.email, active: p.active,
      role: ((p.tool_access || [])[0] || {}).role || null,
      bootstrap: boot.includes(String(p.email || '').toLowerCase())
    }));
    return json(200, { team });
  }

  requirePower(session, 'manageTeam', 'Only super admins can change Frontrow Manager access.');

  if (request.method === 'POST') {
    const { body, error } = await readJson(request, 2000);
    if (error) return error;
    const email = clean(body.email, 200).toLowerCase();
    const fullName = clean(body.fullName, 120);
    if (!EMAIL_RE.test(email)) return json(400, { error: 'Enter a valid email address.' });
    if (!ROLES.includes(body.role)) return json(400, { error: 'Choose a role.' });
    const found = await select('core', 'people', `select=id,full_name,email&${emailFilter(email)}`);
    let person = (found || []).find((p) => sameEmail(p.email, email));
    if (!person) {
      person = (await insert('core', 'people', { email, full_name: fullName || email.split('@')[0] }))[0];
    }
    await insert('core', 'tool_access', { person_id: person.id, tool: TOOL, role: body.role }, { onConflict: 'person_id,tool' });
    await audit(session, 'team.grant', person.id, { email, role: body.role });
    return json(201, { personId: person.id });
  }

  const personId = new URL(request.url).searchParams.get('personId');
  if (!UUID_RE.test(String(personId || ''))) return json(400, { error: 'Choose a team member.' });
  if (personId === session.personId) {
    return json(400, { error: 'You can’t change your own access. Ask another super admin.' });
  }

  if (request.method === 'PATCH') {
    const { body, error } = await readJson(request, 1000);
    if (error) return error;
    if (!ROLES.includes(body.role)) return json(400, { error: 'Choose a role.' });
    const rows = await patch('core', 'tool_access', `person_id=eq.${personId}&tool=eq.${TOOL}`, { role: body.role });
    if (!rows || !rows[0]) return json(404, { error: 'That person does not have Frontrow Manager access.' });
    await audit(session, 'team.role', personId, { role: body.role });
    return json(200, { ok: true });
  }

  if (request.method === 'DELETE') {
    await remove('core', 'tool_access', `person_id=eq.${personId}&tool=eq.${TOOL}`);
    await remove('frontrow', 'staff_company_assignments', `person_id=eq.${personId}`);
    await audit(session, 'team.revoke', personId, {});
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed.' });
});
