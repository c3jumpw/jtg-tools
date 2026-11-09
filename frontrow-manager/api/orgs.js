import { select, insert, patch, json, clean, readJson, originAllowed, UUID_RE, route } from '../lib/core.js';
import { requireSession } from '../lib/auth.js';
import { requirePower } from '../lib/access.js';
import { audit } from '../lib/pipeline.js';
import { ORG_FIELDS, safeBranding, portalBase } from '../lib/directory.js';

/* Organizations (tenants) and their branches.
 *
 *   GET                                   every organization, with branches,
 *                                         its shareable portal link and counts
 *   PATCH ?id=        { name, customDomain, branding{…}, active }
 *   POST              { slug, name, clickupLabel }        new organization (super admin)
 *   POST  ?branch     { organizationId, name, clickupValue, logo, tile }
 *   PATCH ?branchId=  { name, clickupValue, logo, tile, active, sort }
 *
 * Anyone signed in can read this (staff need the portal links to share).
 * Changes need manageClients; creating an organization needs manageTeam.
 */

const RESERVED = ['api', 'css', 'js', 'assets', 'signin', 'manager', 'admin', 'app', 'www', 'help', 'frontrow', 'static', 'setup', 'reset'];

function readBranding(input, current = {}) {
  const merged = { ...current };
  for (const k of ['accent', 'ink', 'highlight', 'logo', 'logo_on_dark', 'icon', 'home_url', 'tagline', 'font']) {
    if (k in (input || {})) merged[k] = typeof input[k] === 'string' ? input[k].trim() : input[k];
  }
  const clean = safeBranding(merged);
  // Report values that were dropped, rather than silently ignoring them.
  const bad = Object.keys(input || {}).filter((k) => input[k] && k !== 'font' && !(k in clean) && ['accent', 'ink', 'highlight', 'logo', 'logo_on_dark', 'icon', 'home_url'].includes(k));
  if (bad.length) throw json(400, { error: `Check ${bad.join(', ')}: colours look like #2E3192, images must be /assets/… or https:// links.` });
  return clean;
}

function readBranch(body) {
  const out = {};
  if ('name' in body) { out.name = clean(body.name, 120); if (!out.name) throw json(400, { error: 'Name the branch.' }); }
  if ('clickupValue' in body) out.clickup_value = clean(body.clickupValue, 60) || null;
  if ('logo' in body) {
    const logo = clean(body.logo, 500);
    if (logo && !/^(\/assets\/[a-z0-9/_.-]+|https:\/\/[^\s"'<>]+)$/i.test(logo)) throw json(400, { error: 'Logos must be /assets/… paths or https:// links.' });
    out.logo = logo || null;
  }
  if ('tile' in body) out.tile = ['light', 'dark', 'tint'].includes(body.tile) ? body.tile : 'light';
  if ('sort' in body) out.sort = Math.max(0, Math.min(10000, parseInt(body.sort, 10) || 0));
  if ('active' in body) out.active = Boolean(body.active);
  return out;
}

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  const session = await requireSession(request);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const orgs = await select('frontrow', 'organizations', `select=${ORG_FIELDS}&order=name.asc`) || [];
    const branches = await select('frontrow', 'branches', 'select=id,organization_id,name,clickup_value,logo,tile,sort,active&order=sort.asc') || [];
    const companies = await select('frontrow', 'companies', 'select=organization_id,active&limit=10000') || [];
    return json(200, {
      organizations: orgs.map((o) => ({
        id: o.id, slug: o.slug, name: o.name, clickupLabel: o.clickup_label, customDomain: o.custom_domain,
        branding: safeBranding(o.branding || {}), active: o.active,
        portalUrl: portalBase(o),
        companies: companies.filter((c) => c.organization_id === o.id).length,
        activeCompanies: companies.filter((c) => c.organization_id === o.id && c.active).length,
        branches: branches.filter((b) => b.organization_id === o.id).map((b) => ({
          id: b.id, name: b.name, clickupValue: b.clickup_value, logo: b.logo, tile: b.tile, sort: b.sort, active: b.active
        }))
      }))
    });
  }

  const { body, error } = await readJson(request, 8000);
  if (error) return error;

  if (url.searchParams.has('branch') && request.method === 'POST') {
    requirePower(session, 'manageClients', 'Only managers can change branches.');
    if (!UUID_RE.test(String(body.organizationId || ''))) return json(400, { error: 'Choose an organization.' });
    const row = { organization_id: body.organizationId, ...readBranch({ name: body.name, ...body }) };
    if (!row.name) return json(400, { error: 'Name the branch.' });
    try {
      const created = (await insert('frontrow', 'branches', row))[0];
      await audit(session, 'branch.create', created.id, { name: row.name });
      return json(201, { id: created.id });
    } catch (e) {
      if (e.status === 409) return json(409, { error: 'That ClickUp Sub-Branch value is already used in this organization.' });
      throw e;
    }
  }

  const branchId = url.searchParams.get('branchId');
  if (branchId && request.method === 'PATCH') {
    requirePower(session, 'manageClients', 'Only managers can change branches.');
    if (!UUID_RE.test(branchId)) return json(400, { error: 'Choose a branch.' });
    const changes = readBranch(body);
    const rows = await patch('frontrow', 'branches', `id=eq.${branchId}`, changes);
    if (!rows || !rows[0]) return json(404, { error: 'Branch not found.' });
    await audit(session, 'branch.edit', branchId, { fields: Object.keys(changes) });
    return json(200, { ok: true });
  }

  if (request.method === 'POST') {
    requirePower(session, 'manageTeam', 'Only super admins can add organizations.');
    const slug = clean(body.slug, 31).toLowerCase();
    const name = clean(body.name, 120);
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug) || RESERVED.includes(slug)) return json(400, { error: 'Use 2–31 lower-case letters, numbers or dashes for the link name (and not a reserved word).' });
    if (!name) return json(400, { error: 'Name the organization.' });
    try {
      const created = (await insert('frontrow', 'organizations', {
        slug, name, clickup_label: clean(body.clickupLabel, 60) || null, branding: readBranding(body.branding || {})
      }))[0];
      await audit(session, 'organization.create', created.id, { slug });
      return json(201, { id: created.id });
    } catch (e) {
      if (e.status === 409) return json(409, { error: 'That link name or ClickUp Branch label is already in use.' });
      throw e;
    }
  }

  if (request.method === 'PATCH') {
    requirePower(session, 'manageClients', 'Only managers can change organizations.');
    const id = url.searchParams.get('id');
    if (!UUID_RE.test(String(id || ''))) return json(400, { error: 'Choose an organization.' });
    const rows = await select('frontrow', 'organizations', `select=${ORG_FIELDS}&id=eq.${id}`);
    const org = rows && rows[0];
    if (!org) return json(404, { error: 'Organization not found.' });
    const changes = {};
    if ('name' in body) { changes.name = clean(body.name, 120); if (!changes.name) return json(400, { error: 'Name the organization.' }); }
    if ('customDomain' in body) {
      const d = clean(body.customDomain, 120).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (d && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return json(400, { error: 'Enter a host name like portal.example.com.' });
      changes.custom_domain = d || null;
    }
    if ('branding' in body) changes.branding = readBranding(body.branding, org.branding || {});
    if ('active' in body) changes.active = Boolean(body.active);
    try {
      await patch('frontrow', 'organizations', `id=eq.${id}`, changes);
    } catch (e) {
      if (e.status === 409) return json(409, { error: 'Another organization already uses that domain.' });
      throw e;
    }
    await audit(session, 'organization.edit', id, { fields: Object.keys(changes) });
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed.' });
});
