import { select, UUID_RE } from './core.js';

/* Who is who in Frontrow: organizations, their public branding, and which
 * companies a contact may see. Shared by Frontrow and Frontrow Manager
 * (copied; a test keeps the copies identical).
 *
 * The one eligibility rule lives here: a contact may use Frontrow while it
 * is active and linked to at least one ACTIVE company. Sign-in, setup links
 * and every client page call activeCompaniesFor() — never their own check.
 */

const HEX = /^#[0-9a-f]{6}$/i;
const PATH_OR_HTTPS = /^(\/assets\/[a-z0-9/_.-]+|https:\/\/[^\s"'<>]+)$/i;

export const ORG_FIELDS = 'id,slug,name,clickup_label,custom_domain,branding,active';

export async function orgBySlug(slug, db = { select }) {
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(String(slug || ''))) return null;
  const rows = await db.select('frontrow', 'organizations', `select=${ORG_FIELDS}&slug=eq.${slug}&active=eq.true`);
  return (rows && rows[0]) || null;
}

export async function orgByHost(host, db = { select }) {
  const h = String(host || '').toLowerCase().split(':')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return null;
  const rows = await db.select('frontrow', 'organizations', `select=${ORG_FIELDS}&custom_domain=eq.${h}&active=eq.true`);
  return (rows && rows[0]) || null;
}

export async function orgsByIds(ids, db = { select }) {
  const list = [...new Set(ids)].filter((id) => UUID_RE.test(String(id)));
  if (!list.length) return [];
  return await db.select('frontrow', 'organizations', `select=${ORG_FIELDS}&id=in.(${list.join(',')})`) || [];
}

export async function branchesFor(orgId, db = { select }) {
  if (!UUID_RE.test(String(orgId || ''))) return [];
  return await db.select('frontrow', 'branches',
    `select=id,name,clickup_value,logo,tile,sort&organization_id=eq.${orgId}&active=eq.true&order=sort.asc`) || [];
}

/** Branding safe to put into a page: only known keys, colours as #rrggbb,
 *  images as /assets/… paths or https URLs. Everything else is dropped. */
export function safeBranding(b = {}) {
  const out = {};
  for (const k of ['accent', 'ink', 'highlight']) if (HEX.test(b[k] || '')) out[k] = b[k];
  for (const k of ['logo', 'logo_on_dark', 'icon']) if (PATH_OR_HTTPS.test(b[k] || '')) out[k] = b[k];
  if (b.home_url && /^https:\/\/[^\s"'<>]+$/i.test(b.home_url)) out.home_url = b.home_url;
  if (typeof b.tagline === 'string') out.tagline = b.tagline.slice(0, 120);
  out.font = b.font === 'jtg' ? 'jtg' : 'default';
  return out;
}

/** The public face of an organization: what its sign-in page may show. */
export function publicOrg(org, branches = []) {
  if (!org) return null;
  return {
    slug: org.slug,
    name: org.name,
    branding: safeBranding(org.branding || {}),
    branches: branches.map((b) => ({
      name: b.name,
      logo: PATH_OR_HTTPS.test(b.logo || '') ? b.logo : null,
      tile: ['light', 'dark', 'tint'].includes(b.tile) ? b.tile : 'light'
    }))
  };
}

export async function contactByEmail(email, db = { select }) {
  const em = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return null;
  // Emails are stored lower-case (the table enforces it), so eq is exact.
  const rows = await db.select('frontrow', 'contacts', `select=id,email,full_name,clickup_contact_id,active&email=eq.${encodeURIComponent(em)}`);
  return (rows && rows[0]) || null;
}

/** Active companies this contact may see, optionally inside one organization.
 *  An inactive contact sees nothing. */
export async function activeCompaniesFor(contactId, { orgId = null } = {}, db = { select }) {
  if (!UUID_RE.test(String(contactId || ''))) return [];
  const people = await db.select('frontrow', 'contacts', `select=id,active&id=eq.${contactId}`);
  if (!people || !people[0] || people[0].active === false) return [];
  const orgFilter = orgId && UUID_RE.test(String(orgId)) ? `&companies.organization_id=eq.${orgId}` : '';
  const rows = await db.select('frontrow', 'contact_companies',
    `select=role,companies!inner(id,name,active,organization_id,branch_id,branding)&contact_id=eq.${contactId}&companies.active=eq.true${orgFilter}`) || [];
  return rows
    .filter((r) => r.companies && r.companies.active !== false && (!orgId || r.companies.organization_id === orgId))
    .map((r) => ({
      id: r.companies.id,
      name: r.companies.name,
      organizationId: r.companies.organization_id,
      branchId: r.companies.branch_id,
      role: r.role,
      accent: HEX.test((r.companies.branding || {}).accent || '') ? r.companies.branding.accent : null
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The organization a contact should land in: the requested one if they
 *  have a company there, else the organization of their first company. */
export function pickOrgId(companies, preferredOrgId) {
  if (preferredOrgId && companies.some((c) => c.organizationId === preferredOrgId)) return preferredOrgId;
  return companies.length ? companies[0].organizationId : null;
}

/** Base URL of the client app for an organization. */
export function portalBase(org, env = process.env) {
  if (org && org.custom_domain) return `https://${org.custom_domain}`;
  const site = (env.FRONTROW_URL || 'https://frontrow.jtgworkspace.com').replace(/\/$/, '');
  return org ? `${site}/${org.slug}` : `${site}/signin`;
}
