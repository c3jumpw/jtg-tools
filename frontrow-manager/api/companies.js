import { select, insert, patch, json, clean, readJson, originAllowed, UUID_RE, route } from '../lib/core.js';
import { requireSession } from '../lib/auth.js';
import { requirePower, visibleCompanyIds, loadVisibleCompany, companyFilter } from '../lib/access.js';
import { audit } from '../lib/pipeline.js';
import { orgsByIds, portalBase } from '../lib/directory.js';

/* Client companies.
 *
 *   GET            every company you can see, with organization, branch and counts
 *   GET ?id=       one company, with its staff and portal link
 *   POST           add a company by hand (most come from the ClickUp sync)
 *   PATCH ?id=     change settings
 *
 * For companies that come from ClickUp, the name, organization, branch and
 * active state follow ClickUp on every sync; edit them there.
 */

async function readCompany(body, { partial }) {
  const out = {};
  const errors = [];
  if (!partial || 'name' in body) {
    const name = clean(body.name, 201);
    if (!name) errors.push('A client name is required.');
    else if (name.length > 200) errors.push('Keep the name under 200 characters.');
    else out.name = name;
  }
  if (!partial || 'organizationId' in body) {
    if (!UUID_RE.test(String(body.organizationId || ''))) errors.push('Choose an organization.');
    else out.organization_id = body.organizationId;
  }
  if ('branchId' in body) {
    if (body.branchId && !UUID_RE.test(String(body.branchId))) errors.push('Choose a valid branch.');
    else out.branch_id = body.branchId || null;
  }
  if ('clickupAccountId' in body) {
    const id = clean(body.clickupAccountId, 64);
    if (id && !/^[a-z0-9]+$/i.test(id)) errors.push('The ClickUp account ID should be letters and numbers only.');
    else out.clickup_account_id = id || null;
  }
  if ('primaryOwnerPersonId' in body) {
    const pid = body.primaryOwnerPersonId;
    if (pid && !UUID_RE.test(String(pid))) errors.push('Choose a valid account owner.');
    else out.primary_owner_person_id = pid || null;
  }
  if ('accent' in body) {
    const a = clean(body.accent, 7);
    if (a && !/^#[0-9a-f]{6}$/i.test(a)) errors.push('Accent colour must look like #2E3192.');
    else out.accent = a || null;
  }
  if ('active' in body) out.active = Boolean(body.active);
  if (errors.length) throw json(400, { error: errors.join(' ') });
  // A branch must belong to the chosen organization.
  if (out.branch_id) {
    const orgId = out.organization_id || body._currentOrgId;
    const rows = await select('frontrow', 'branches', `select=id&id=eq.${out.branch_id}&organization_id=eq.${orgId}`);
    if (!rows || !rows[0]) throw json(400, { error: 'That branch belongs to a different organization.' });
  }
  return out;
}

async function listCompanies(session) {
  const ids = await visibleCompanyIds(session);
  if (ids && ids.length === 0) return [];
  const filter = companyFilter(ids, 'id');
  const companies = await select('frontrow', 'companies',
    `select=id,name,organization_id,branch_id,clickup_account_id,clickup_status,primary_owner_person_id,active,source,updated_at&order=name.asc&limit=5000${filter ? '&' + filter : ''}`) || [];
  if (companies.length === 0) return [];

  const ownerIds = [...new Set(companies.map((c) => c.primary_owner_person_id).filter(Boolean))];
  const overviewFilter = companyFilter(ids);
  const [overview, owners] = await Promise.all([
    select('frontrow', 'company_overview', `select=company_id,contacts,accounts,drafts,last_published_at&limit=5000${overviewFilter ? '&' + overviewFilter : ''}`),
    ownerIds.length ? select('core', 'people', `select=id,full_name,email&id=in.(${ownerIds.join(',')})`) : Promise.resolve([])
  ]);
  const stats = Object.fromEntries((overview || []).map((o) => [o.company_id, o]));
  const ownerById = Object.fromEntries((owners || []).map((p) => [p.id, p]));
  return companies.map((c) => ({
    id: c.id, name: c.name, organizationId: c.organization_id, branchId: c.branch_id,
    clickupAccountId: c.clickup_account_id, clickupStatus: c.clickup_status, active: c.active, source: c.source,
    owner: c.primary_owner_person_id && ownerById[c.primary_owner_person_id]
      ? { id: c.primary_owner_person_id, name: ownerById[c.primary_owner_person_id].full_name || ownerById[c.primary_owner_person_id].email }
      : null,
    contacts: (stats[c.id] && stats[c.id].contacts) || 0,
    accounts: (stats[c.id] && stats[c.id].accounts) || 0,
    drafts: (stats[c.id] && stats[c.id].drafts) || 0,
    lastPublishedAt: (stats[c.id] && stats[c.id].last_published_at) || null
  }));
}

async function companyDetail(session, id) {
  const c = await loadVisibleCompany(session, id);
  const [org] = await orgsByIds([c.organization_id]);
  const assignments = await select('frontrow', 'staff_company_assignments', `select=person_id,is_primary&company_id=eq.${c.id}`) || [];
  const staffIds = assignments.map((a) => a.person_id);
  const people = staffIds.length ? await select('core', 'people', `select=id,full_name,email&id=in.(${staffIds.join(',')})`) : [];
  const byId = Object.fromEntries((people || []).map((p) => [p.id, p]));
  return {
    company: {
      id: c.id, name: c.name, organizationId: c.organization_id, branchId: c.branch_id,
      organization: org ? { id: org.id, name: org.name, slug: org.slug, clickupLabel: org.clickup_label } : null,
      clickupAccountId: c.clickup_account_id, clickupStatus: c.clickup_status, source: c.source, syncedAt: c.synced_at,
      primaryOwnerPersonId: c.primary_owner_person_id, active: c.active,
      accent: (c.branding && c.branding.accent) || null,
      orgAccent: org && org.branding && /^#[0-9a-f]{6}$/i.test(org.branding.accent || '') ? org.branding.accent : null,
      portalUrl: org ? portalBase(org) : null
    },
    staff: assignments.map((a) => ({
      personId: a.person_id, isPrimary: a.is_primary,
      name: (byId[a.person_id] && (byId[a.person_id].full_name || byId[a.person_id].email)) || 'Unknown'
    }))
  };
}

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  const session = await requireSession(request);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (request.method === 'GET') {
    if (id) return json(200, await companyDetail(session, id));
    return json(200, { companies: await listCompanies(session) });
  }

  if (request.method === 'POST') {
    requirePower(session, 'manageClients', 'Only managers and super admins can add clients.');
    const { body, error } = await readJson(request, 8000);
    if (error) return error;
    const fields = await readCompany(body, { partial: false });
    const { accent, ...row } = fields;
    if (accent) row.branding = { accent };
    row.source = 'manual';
    let created;
    try {
      created = (await insert('frontrow', 'companies', row))[0];
    } catch (e) {
      if (e.status === 409) return json(409, { error: 'Another client already uses that ClickUp account ID.' });
      throw e;
    }
    await audit(session, 'company.create', created.id, { name: created.name, organization_id: created.organization_id });
    return json(201, { id: created.id });
  }

  if (request.method === 'PATCH') {
    requirePower(session, 'manageClients', 'Only managers and super admins can change client settings.');
    const current = await loadVisibleCompany(session, id);
    const { body, error } = await readJson(request, 8000);
    if (error) return error;
    const fields = await readCompany({ ...body, _currentOrgId: current.organization_id }, { partial: true });
    const { accent, ...changes } = fields;
    if ('accent' in fields) changes.branding = { ...(current.branding || {}), accent: accent || undefined };
    if (Object.keys(changes).length === 0) return json(200, { ok: true });
    try {
      await patch('frontrow', 'companies', `id=eq.${current.id}`, changes);
    } catch (e) {
      if (e.status === 409) return json(409, { error: 'Another client already uses that ClickUp account ID.' });
      throw e;
    }
    await audit(session, 'company.edit', current.id, { fields: Object.keys(changes) });
    return json(200, { ok: true, followsClickUp: current.source === 'clickup' });
  }

  return json(405, { error: 'Method not allowed.' });
});
