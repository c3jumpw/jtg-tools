/* End-to-end route tests for Frontrow Manager against the fake PostgREST and
 * a fake ClickUp. Each test builds its own world; env is set before routes load. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fakeBackend, fakeClickUp, install, call, seedOrganizations, ORG_IDS, BRANCH_IDS, CU } from './fake-postgrest.js';

const SQL = new URL('../sql/001_frontrow_foundation.sql', import.meta.url).pathname;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const future = () => new Date(Date.now() + 86400000).toISOString();

const P = {
  boss: 'aaaaaaaa-0000-4000-8000-000000000001',
  am: 'aaaaaaaa-0000-4000-8000-000000000002',
  sup: 'aaaaaaaa-0000-4000-8000-000000000003'
};
const C = { acme: 'cccccccc-0000-4000-8000-000000000001', globex: 'cccccccc-0000-4000-8000-000000000002', dormant: 'cccccccc-0000-4000-8000-000000000003' };
const K = { pat: 'bbbbbbbb-0000-4000-8000-000000000001', lou: 'bbbbbbbb-0000-4000-8000-000000000002' };

function world(extra = {}, { clickup = null } = {}) {
  const b = fakeBackend({
    sqlPath: SQL,
    clickup,
    seed: {
      ...seedOrganizations(),
      'core.people': [
        { id: P.boss, email: 'boss@mkc.test', full_name: 'Bea Boss', active: true },
        { id: P.am, email: 'am@mkc.test', full_name: 'Avery Manager', active: true },
        { id: P.sup, email: 'sup@mkc.test', full_name: 'Sam Supervisor', active: true }
      ],
      'core.tool_access': [
        { person_id: P.am, tool: 'frontrow', role: 'account_manager' },
        { person_id: P.sup, tool: 'frontrow', role: 'supervisor' },
        { person_id: P.boss, tool: 'booking', role: 'admin' }
      ],
      'core.sessions': [
        { token_hash: sha('boss-token'), email: 'boss@mkc.test', person_id: P.boss, expires_at: future() },
        { token_hash: sha('am-token'), email: 'am@mkc.test', person_id: P.am, expires_at: future() },
        { token_hash: sha('sup-token'), email: 'sup@mkc.test', person_id: P.sup, expires_at: future() },
        { token_hash: sha('old-token'), email: 'am@mkc.test', person_id: P.am, expires_at: '2020-01-01T00:00:00Z' }
      ],
      'frontrow.companies': [
        { id: C.acme, name: 'Acme', organization_id: ORG_IDS.jtg, branch_id: BRANCH_IDS.f5, active: true, branding: {}, source: 'clickup', clickup_account_id: 'acc1', clickup_status: 'active' },
        { id: C.globex, name: 'Globex', organization_id: ORG_IDS.uny, branch_id: null, active: true, branding: {}, source: 'manual' },
        { id: C.dormant, name: 'Dormant Co', organization_id: ORG_IDS.jtg, branch_id: null, active: false, branding: {}, source: 'clickup', clickup_account_id: 'acc9', clickup_status: 'pre-deal' }
      ],
      'frontrow.contacts': [
        { id: K.pat, email: 'pat@acme.test', full_name: 'Pat Client', clickup_contact_id: 'con1', active: true },
        { id: K.lou, email: 'lou@dormant.test', full_name: 'Lou Waiting', clickup_contact_id: 'con9', active: true }
      ],
      'frontrow.contact_companies': [
        { contact_id: K.pat, company_id: C.acme, role: 'owner', source: 'clickup' },
        { contact_id: K.lou, company_id: C.dormant, role: 'member', source: 'clickup' }
      ],
      'frontrow.staff_company_assignments': [{ person_id: P.am, company_id: C.acme, is_primary: true }, { person_id: P.sup, company_id: C.acme, is_primary: false }],
      ...extra
    },
    gemini: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '```html\n<!doctype html><html><body><h1>Draft</h1><script>x()</script></body></html>\n```' }] } }] }), { status: 200 })
  });
  install(b, { PORTAL_ADMIN_EMAILS: 'boss@mkc.test', GEMINI_API_KEY: '', GEMINI_PAUSED: '', CLICKUP_API_TOKEN: clickup ? 'pk_test' : '', CRON_SECRET: 'cron-secret-123' });
  return b;
}
const as = (who) => `__Host-frontrow_mgr_sid=${who}-token`;

const load = async () => ({
  me: (await import('../api/auth-me.js')).default,
  companies: (await import('../api/companies.js')).default,
  updates: (await import('../api/updates.js')).default,
  view: (await import('../api/view.js')).default,
  assist: (await import('../api/assist.js')).default,
  team: (await import('../api/team.js')).default,
  contacts: (await import('../api/contacts.js')).default,
  assignments: (await import('../api/assignments.js')).default,
  authRequest: (await import('../api/auth-request.js')).default,
  accounts: (await import('../api/accounts.js')).default,
  orgs: (await import('../api/orgs.js')).default,
  sync: (await import('../api/sync.js')).default,
  requests: (await import('../api/requests.js')).default
});

test('who-am-I: signed out, expired, bootstrap owner, and Gemini paused', async () => {
  world();
  const r = await load();
  assert.deepEqual(await (await call(r.me, '/api/auth-me')).json(), { authenticated: false, revoked: false });
  assert.equal((await (await call(r.me, '/api/auth-me', { cookie: as('old') })).json()).authenticated, false);
  const me = await (await call(r.me, '/api/auth-me', { cookie: as('boss') })).json();
  assert.equal(me.role, 'super_admin');
  assert.equal(me.can.manageTeam, true);
  assert.equal(me.gemini.available, false);
  assert.equal(me.gemini.reason, 'no_key');
});

test('account managers see only assigned clients; another client is a 404', async () => {
  world();
  const r = await load();
  const list = await (await call(r.companies, '/api/companies', { cookie: as('am') })).json();
  assert.deepEqual(list.companies.map((c) => c.name), ['Acme']);
  assert.equal(list.companies[0].organizationId, ORG_IDS.jtg);
  assert.equal(list.companies[0].branchId, BRANCH_IDS.f5);
  const boss = await (await call(r.companies, '/api/companies', { cookie: as('boss') })).json();
  assert.deepEqual(boss.companies.map((c) => c.name), ['Acme', 'Dormant Co', 'Globex']);
  assert.equal((await call(r.companies, `/api/companies?id=${C.globex}`, { cookie: as('am') })).status, 404);
  assert.equal((await call(r.companies, '/api/companies', { method: 'POST', cookie: as('am'), body: { name: 'X', organizationId: ORG_IDS.jtg } })).status, 403);
});

test('cross-site requests are refused', async () => {
  world();
  const r = await load();
  assert.equal((await call(r.companies, '/api/companies', { cookie: as('boss'), origin: 'https://evil.example' })).status, 403);
});

test('draft → preview → publish, with the page sanitised and audited', async () => {
  const b = world();
  const r = await load();
  const created = await call(r.updates, '/api/updates', { method: 'POST', cookie: as('am'), body: { companyId: C.acme, type: 'update', title: 'October', notes: 'leads +32%', bodyHtml: '<h1 onclick="x()">Hi</h1><script>steal()</script>' } });
  assert.equal(created.status, 201);
  const { update } = await created.json();
  assert.equal(update.bodyHtml, '<h1>Hi</h1>');

  const preview = await call(r.view, `/api/view?id=${update.id}`, { cookie: as('am') });
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-security-policy'), /^sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'/);
  assert.match(await preview.text(), /<h1>Hi<\/h1>/);
  assert.equal((await call(r.view, `/api/view?id=${update.id}`, { cookie: as('sup') })).status, 200, 'supervisors can read');

  assert.equal((await call(r.updates, `/api/updates?id=${update.id}&action=publish`, { method: 'POST', cookie: as('sup') })).status, 403);
  const pub = await call(r.updates, `/api/updates?id=${update.id}&action=publish`, { method: 'POST', cookie: as('am') });
  assert.equal(pub.status, 200);
  assert.equal((await pub.json()).update.status, 'published');

  const actions = b.db['core.audit_log'].map((a) => a.action);
  assert.deepEqual(actions, ['update.create', 'update.publish']);
  assert.ok(b.db['core.audit_log'].every((a) => a.tool === 'frontrow' && a.actor_person_id === P.am));
});

test('stale saves are refused; status and company cannot be changed by PATCH', async () => {
  const b = world();
  const r = await load();
  const { update } = await (await call(r.updates, '/api/updates', { method: 'POST', cookie: as('am'), body: { companyId: C.acme, title: 'A' } })).json();
  const first = await call(r.updates, `/api/updates?id=${update.id}`, { method: 'PATCH', cookie: as('am'), body: { title: 'B', expectedUpdatedAt: update.updatedAt, status: 'published', companyId: C.globex } });
  assert.equal(first.status, 200);
  const row = b.db['frontrow.updates'][0];
  assert.equal(row.status, 'draft');
  assert.equal(row.company_id, C.acme);
  const second = await call(r.updates, `/api/updates?id=${update.id}`, { method: 'PATCH', cookie: as('am'), body: { title: 'C', expectedUpdatedAt: update.updatedAt } });
  assert.equal(second.status, 409);
});

test('an unassigned client’s update cannot be read, previewed or edited', async () => {
  const b = world({ 'frontrow.updates': [{ id: 'dddddddd-0000-4000-8000-000000000001', company_id: C.globex, title: 'Secret', status: 'draft', body_html: '<p>secret</p>', notes: 'internal', summary: '', updated_at: new Date().toISOString() }] });
  const r = await load();
  const id = 'dddddddd-0000-4000-8000-000000000001';
  assert.equal((await call(r.updates, `/api/updates?id=${id}`, { cookie: as('am') })).status, 404);
  const v = await call(r.view, `/api/view?id=${id}`, { cookie: as('am') });
  assert.equal(v.status, 404);
  assert.doesNotMatch(await v.text(), /secret/);
  assert.equal((await call(r.updates, `/api/updates?id=${id}`, { method: 'PATCH', cookie: as('am'), body: { title: 'x' } })).status, 404);
  assert.equal(b.db['frontrow.updates'][0].title, 'Secret');
});

test('Gemini: paused answers 503 paused; live drafts come back sanitised and are audited', async () => {
  const b = world();
  const r = await load();
  const paused = await call(r.assist, '/api/assist', { method: 'POST', cookie: as('am'), body: { format: 'update', companyId: C.acme, title: 'Oct', notes: 'n' } });
  assert.equal(paused.status, 503);
  assert.equal((await paused.json()).paused, true);
  assert.equal(b.sent.gemini.length, 0);

  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const live = await call(r.assist, '/api/assist', { method: 'POST', cookie: as('am'), body: { format: 'task', companyId: C.acme, title: 'Oct', notes: 'Send logo files by Friday' } });
  assert.equal(live.status, 200);
  const d = await live.json();
  assert.match(d.html, /<h1>Draft<\/h1>/);
  assert.doesNotMatch(d.html, /script/);
  const sentPrompt = JSON.parse(b.sent.gemini[0].init.body).contents[0].parts[0].text;
  assert.match(sentPrompt, /Client: Acme/);
  assert.match(sentPrompt, /a client of Jump Tech Group/);
  assert.match(sentPrompt, /#2E3192/);
  assert.match(sentPrompt, /Their team at Jump Tech Group: Avery Manager/);
  assert.match(sentPrompt, /Send logo files by Friday/);
  assert.equal(b.sent.gemini[0].init.headers['x-goog-api-key'], 'test-gemini-key');
  assert.equal(b.db['core.audit_log'].at(-1).action, 'assist.draft');
  assert.equal((await call(r.assist, '/api/assist', { method: 'POST', cookie: as('sup'), body: { format: 'task', companyId: C.acme, notes: 'n' } })).status, 403);
  assert.equal((await call(r.assist, '/api/assist', { method: 'POST', cookie: as('am'), body: { format: 'task', companyId: C.globex, notes: 'n' } })).status, 404);
  process.env.GEMINI_API_KEY = '';
});

test('people: added lower-cased and linked once; supervisors can’t; ClickUp links can’t be removed here', async () => {
  const b = world();
  const r = await load();
  const add = (cookie, email) => call(r.contacts, '/api/contacts', { method: 'POST', cookie, body: { companyId: C.acme, email, fullName: 'New Person', role: 'member' } });
  assert.equal((await add(as('am'), 'New@Client.COM')).status, 201);
  assert.equal((await add(as('am'), 'new@client.com')).status, 201, 'adding again is idempotent');
  const fresh = b.db['frontrow.contacts'].filter((c) => c.email === 'new@client.com');
  assert.equal(fresh.length, 1);
  assert.equal(b.db['frontrow.contact_companies'].filter((l) => l.contact_id === fresh[0].id).length, 1);
  assert.equal((await add(as('sup'), 'x@client.com')).status, 403);
  const list = await (await call(r.contacts, `/api/contacts?companyId=${C.acme}`, { cookie: as('sup') })).json();
  assert.deepEqual(list.contacts.map((c) => c.email).sort(), ['new@client.com', 'pat@acme.test']);
  assert.equal((await call(r.contacts, `/api/contacts?contactId=${K.pat}&companyId=${C.acme}`, { method: 'DELETE', cookie: as('am') })).status, 409, 'ClickUp-sourced link');
  assert.equal((await call(r.contacts, `/api/contacts?contactId=${fresh[0].id}&companyId=${C.acme}`, { method: 'DELETE', cookie: as('am') })).status, 200);
});

test('team: only super admins change access, and never their own', async () => {
  const b = world();
  const r = await load();
  assert.equal((await call(r.team, '/api/team', { cookie: as('am') })).status, 403);
  const grant = await call(r.team, '/api/team', { method: 'POST', cookie: as('boss'), body: { email: 'New@MKC.test', fullName: 'New Person', role: 'manager' } });
  assert.equal(grant.status, 201);
  const { personId } = await grant.json();
  assert.ok(b.db['core.tool_access'].some((t) => t.person_id === personId && t.tool === 'frontrow' && t.role === 'manager'));
  assert.equal((await call(r.team, `/api/team?personId=${P.boss}`, { method: 'PATCH', cookie: as('boss'), body: { role: 'manager' } })).status, 400);
  const list = await (await call(r.team, '/api/team', { cookie: as('boss') })).json();
  assert.ok(list.team.every((p) => p.role), 'every listed person has a Frontrow role');
  assert.ok(!list.team.some((p) => p.email === 'boss@mkc.test' && p.role === 'admin'), 'booking-only roles are not Frontrow roles');
  assert.equal((await call(r.team, `/api/team?personId=${P.am}`, { method: 'DELETE', cookie: as('boss') })).status, 200);
  assert.equal(b.db['frontrow.staff_company_assignments'].filter((a) => a.person_id === P.am).length, 0);
});

test('assignments: one primary per client', async () => {
  const b = world();
  const r = await load();
  const res = await call(r.assignments, '/api/assignments', { method: 'POST', cookie: as('boss'), body: { companyId: C.acme, personId: P.sup, isPrimary: true } });
  assert.equal(res.status, 201);
  const prim = b.db['frontrow.staff_company_assignments'].filter((a) => a.company_id === C.acme && a.is_primary);
  assert.deepEqual(prim.map((a) => a.person_id), [P.sup]);
  assert.equal(b.db['frontrow.companies'].find((c) => c.id === C.acme).primary_owner_person_id, P.sup);
});

test('sign-in links: only for people with Frontrow access, wildcard-safe', async () => {
  const b = world();
  const r = await load();
  // "a_@mkc.test" must not match "am@mkc.test" through LIKE's "_" wildcard.
  const res = await call(r.authRequest, '/api/auth-request', { method: 'POST', body: { email: 'a_@mkc.test' }, ip: '198.51.100.1' });
  assert.equal(res.status, 200);
  assert.equal(b.sent.emails.length, 0);
  await call(r.authRequest, '/api/auth-request', { method: 'POST', body: { email: 'AM@mkc.test' }, ip: '198.51.100.2' });
  assert.equal(b.sent.emails.length, 1);
  assert.equal(b.db['core.magic_links'].length, 1);
  assert.match(b.sent.emails[0].html, /\/#signin=[A-Za-z0-9_-]{32}/);
  assert.doesNotMatch(b.sent.emails[0].html, /\?t=/, 'token must not be in the query string');
});

test('sign-in exchange: POST only, spent once, access re-checked first', async () => {
  const b = world({
    'core.magic_links': [
      { token_hash: sha('good-staff-link-aaaaaaaaaaaa'), email: 'am@mkc.test', expires_at: future(), used_at: null },
      { token_hash: sha('nobody-link-aaaaaaaaaaaaaaaa'), email: 'nobody@mkc.test', expires_at: future(), used_at: null }
    ]
  });
  const cb = (await import('../api/auth-callback.js')).default;
  const me = (await import('../api/auth-me.js')).default;
  // A mail scanner opening the link does nothing.
  assert.equal((await call(cb, '/api/auth-callback?t=good-staff-link-aaaaaaaaaaaa')).status, 405);
  assert.equal(b.db['core.magic_links'][0].used_at, null);
  const spend = (t) => call(cb, '/api/auth-callback', { method: 'POST', body: { t }, ip: '198.51.100.20' });
  const [one, two] = await Promise.all([spend('good-staff-link-aaaaaaaaaaaa'), spend('good-staff-link-aaaaaaaaaaaa')]);
  assert.deepEqual([one.status, two.status].sort(), [200, 400], 'two taps at once: exactly one wins');
  const winner = one.status === 200 ? one : two;
  const sid = winner.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await call(me, '/api/auth-me', { cookie: sid })).json()).role, 'account_manager');
  const refused = await spend('nobody-link-aaaaaaaaaaaaaaaa');
  assert.equal((await refused.json()).code, 'notallowed');
  assert.equal(b.db['core.magic_links'][1].used_at, null, 'a refused link is not spent');
  assert.ok(b.db['core.audit_log'].some((a) => a.action === 'staff.sign_in'));
});

test('client list counts come from the overview view', async () => {
  world({ 'frontrow.updates': [
    { id: 'dddddddd-0000-4000-8000-000000000011', company_id: C.acme, title: 'a', status: 'draft' },
    { id: 'dddddddd-0000-4000-8000-000000000012', company_id: C.acme, title: 'b', status: 'published', published_at: '2026-11-01T00:00:00Z' }
  ] });
  const r = await load();
  const { companies } = await (await call(r.companies, '/api/companies', { cookie: as('boss') })).json();
  const acme = companies.find((c) => c.name === 'Acme');
  assert.equal(acme.drafts, 1);
  assert.equal(acme.lastPublishedAt, '2026-11-01T00:00:00Z');
});

/* ---------------- Frontrow: organizations, ClickUp, accounts, requests ---------------- */

function clickupWorld(extraSeed = {}) {
  const cu = fakeClickUp({
    tasks: [
      CU.account('acc1', 'Acme', { status: 'active', branch: 'JTG', sub: 'F5', contacts: ['con1'] }),
      CU.account('acc2', 'Initech', { status: 'active', branch: 'MCO', sub: 'Anvil', contacts: ['con2', 'con3'] }),
      CU.account('acc3', 'Pending Ltd', { status: 'pre-deal', branch: 'JTG', contacts: ['con4'] }),
      CU.account('acc4', 'Nowhere Inc', { status: 'active', branch: 'Elsewhere' }),
      CU.contact('con1', 'Pat Client', 'Pat@Acme.test', { accounts: ['acc1'] }),
      CU.contact('con2', 'Ira Initech', 'ira@initech.test', { accounts: ['acc2'] }),
      CU.contact('con3', 'No Email', '', { accounts: ['acc2'] }),
      CU.contact('con4', 'Penny Pending', 'penny@pending.test', { accounts: ['acc3'] }),
      { id: 'other1', name: 'A deal', list: { id: '999' }, custom_fields: [] }
    ]
  });
  const b = world(extraSeed, { clickup: cu });
  return { b, cu };
}

test('organizations: everyone signed in sees portal links; only managers edit; branding is checked', async () => {
  const b = world();
  const r = await load();
  const { organizations } = await (await call(r.orgs, '/api/orgs', { cookie: as('sup') })).json();
  const jtg = organizations.find((o) => o.slug === 'jtg');
  assert.equal(jtg.portalUrl, 'https://frontrow.test/jtg');
  assert.equal(jtg.companies, 2);
  assert.equal(jtg.activeCompanies, 1);
  assert.deepEqual(jtg.branches.map((x) => x.name), ['Fortune 5 Agency', 'Build My Start-Up']);
  const edit = (cookie, body) => call(r.orgs, `/api/orgs?id=${ORG_IDS.mco}`, { method: 'PATCH', cookie, body });
  assert.equal((await edit(as('sup'), { name: 'MCO Group' })).status, 403);
  assert.equal((await edit(as('am'), { name: 'MCO Group' })).status, 403, 'account managers can’t edit organizations');
  assert.equal((await edit(as('boss'), { branding: { accent: 'red; background:url(x)' } })).status, 400);
  assert.equal((await edit(as('boss'), { branding: { logo: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await edit(as('boss'), { customDomain: 'https://Portal.MCO.test/path' })).status, 200);
  const mco = b.db['frontrow.organizations'].find((o) => o.id === ORG_IDS.mco);
  assert.equal(mco.custom_domain, 'portal.mco.test');
  const again = await (await call(r.orgs, '/api/orgs', { cookie: as('boss') })).json();
  assert.equal(again.organizations.find((o) => o.slug === 'mco').portalUrl, 'https://portal.mco.test');
  // New organizations: super admins only, reserved words refused.
  const add = (cookie, body) => call(r.orgs, '/api/orgs', { method: 'POST', cookie, body });
  assert.equal((await add(as('am'), { slug: 'acme', name: 'Acme Org' })).status, 403);
  assert.equal((await add(as('boss'), { slug: 'api', name: 'Nope' })).status, 400);
  assert.equal((await add(as('boss'), { slug: 'jtg', name: 'Dup' })).status, 409);
  assert.equal((await add(as('boss'), { slug: 'north', name: 'North Co', clickupLabel: 'NORTH' })).status, 201);
  // Branches.
  assert.equal((await call(r.orgs, '/api/orgs?branch', { method: 'POST', cookie: as('boss'), body: { organizationId: ORG_IDS.jtg, name: 'Dup', clickupValue: 'F5' } })).status, 409);
  assert.equal((await call(r.orgs, '/api/orgs?branch', { method: 'POST', cookie: as('boss'), body: { organizationId: ORG_IDS.jtg, name: 'New Team', clickupValue: 'NT', logo: '/assets/brands/nt.png' } })).status, 201);
});

test('sync: needs ClickUp; managers only; maps organizations, branches, status and links', async () => {
  {
    world();
    const r = await load();
    const res = await call(r.sync, '/api/sync', { method: 'POST', cookie: as('boss') });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'clickup_off');
  }
  const { b } = clickupWorld({ 'frontrow.contact_companies': [
    { contact_id: K.pat, company_id: C.acme, role: 'owner', source: 'clickup' },
    { contact_id: K.pat, company_id: C.globex, role: 'member', source: 'manual' },
    { contact_id: K.lou, company_id: C.dormant, role: 'member', source: 'clickup' }
  ] });
  const r = await load();
  assert.equal((await call(r.sync, '/api/sync', { method: 'POST', cookie: as('am') })).status, 403);
  const res = await call(r.sync, '/api/sync', { method: 'POST', cookie: as('boss') });
  assert.equal(res.status, 200);
  const { counts } = await res.json();
  assert.equal(counts.accounts, 4);
  assert.equal(counts.accountsWithoutOrganization, 1, 'Branch "Elsewhere" matches no organization');
  assert.equal(counts.contactsWithoutEmail, 1);
  const companies = b.db['frontrow.companies'];
  const acme = companies.find((c) => c.clickup_account_id === 'acc1');
  assert.equal(acme.id, C.acme, 'existing company kept its id');
  assert.equal(acme.branch_id, BRANCH_IDS.f5);
  const initech = companies.find((c) => c.clickup_account_id === 'acc2');
  assert.equal(initech.organization_id, ORG_IDS.mco);
  assert.equal(initech.branch_id, BRANCH_IDS.anvil);
  assert.equal(companies.find((c) => c.clickup_account_id === 'acc3').active, false, 'pre-deal is not active');
  assert.equal(companies.find((c) => c.id === C.dormant).active, false, 'gone from ClickUp → switched off');
  assert.equal(companies.find((c) => c.id === C.globex).active, true, 'manual companies are left alone');
  const pat = b.db['frontrow.contacts'].find((c) => c.clickup_contact_id === 'con1');
  assert.equal(pat.id, K.pat);
  assert.equal(pat.email, 'pat@acme.test');
  const links = b.db['frontrow.contact_companies'];
  assert.ok(links.some((l) => l.contact_id === K.pat && l.company_id === C.globex && l.source === 'manual'), 'manual links survive a sync');
  const ira = b.db['frontrow.contacts'].find((c) => c.email === 'ira@initech.test');
  assert.ok(links.some((l) => l.contact_id === ira.id && l.company_id === initech.id && l.source === 'clickup'));
  assert.equal(b.db['frontrow.sync_runs'].at(-1).status, 'ok');
  assert.ok(b.db['core.audit_log'].some((a) => a.action === 'sync.run'));
});

test('nightly sync: only with the cron secret', async () => {
  const { b } = clickupWorld();
  const r = await load();
  assert.equal((await call(r.sync, '/api/sync', { headers: { authorization: 'Bearer wrong-secret-12' } })).status, 401);
  const ok = await call(r.sync, '/api/sync', { headers: { authorization: 'Bearer cron-secret-123' } });
  assert.equal(ok.status, 200);
  assert.equal(b.db['frontrow.sync_runs'].length, 1);
});

test('Add to Frontrow: imports a contact or account with its links; other tasks are refused', async () => {
  const { b } = clickupWorld();
  const r = await load();
  const imp = (cookie, clickupId) => call(r.sync, '/api/sync', { method: 'POST', cookie, body: { clickupId } });
  assert.equal((await imp(as('sup'), 'con2')).status, 403, 'supervisors can’t add');
  assert.equal((await imp(as('am'), 'not a task id!')).status, 400);
  assert.equal((await imp(as('am'), 'other1')).status, 400);
  assert.equal((await imp(as('am'), 'missing9')).status, 404);
  const res = await imp(as('am'), 'con2');
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.kind, 'contact');
  assert.equal(out.contacts.length, 1);
  assert.equal(out.contacts[0].email, 'ira@initech.test');
  assert.equal(out.contacts[0].eligible, true);
  assert.equal(out.contacts[0].companies[0].name, 'Initech');
  const acc = await (await imp(as('am'), 'acc2')).json();
  assert.equal(acc.kind, 'account');
  assert.deepEqual(acc.skipped.contactsWithoutEmail, ['No Email']);
  assert.equal(b.db['frontrow.contacts'].filter((c) => c.email === 'ira@initech.test').length, 1, 'importing twice doesn’t duplicate');
  const pending = await (await imp(as('am'), 'con4')).json();
  assert.equal(pending.contacts[0].eligible, false, 'pre-deal account → not eligible yet');
});

test('accounts: setup links only for eligible contacts the staff member can see; noted in ClickUp', async () => {
  const { b, cu } = clickupWorld();
  const r = await load();
  const invite = (cookie, contactId, send = false) => call(r.accounts, '/api/accounts?action=invite', { method: 'POST', cookie, body: { contactId, send } });
  assert.equal((await invite(as('sup'), K.pat)).status, 403);
  // Lou is linked only to an inactive company.
  const lou = await invite(as('boss'), K.lou);
  assert.equal(lou.status, 409);
  assert.equal((await lou.json()).code, 'not_eligible');
  // Account managers see Pat (Acme is assigned) but not people on other clients.
  const copied = await (await invite(as('am'), K.pat)).json();
  assert.equal(copied.purpose, 'setup');
  assert.equal(copied.sent, false);
  assert.equal(copied.organization, 'jtg');
  assert.match(copied.url, /^https:\/\/frontrow\.test\/jtg#setup=[A-Za-z0-9_-]{32,64}$/);
  const tokens = b.db['frontrow.account_tokens'];
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].token_hash, sha(copied.url.split('#setup=')[1]), 'only the hash is stored');
  assert.ok(Date.parse(tokens[0].expires_at) - Date.now() > 6 * 86400000);
  // Emailing makes a fresh link and expires the copied one.
  const emailed = await (await invite(as('am'), K.pat, true)).json();
  assert.equal(emailed.sent, true);
  assert.deepEqual(b.sent.emails.at(-1).to, ['pat@acme.test']);
  assert.match(b.sent.emails.at(-1).html, /Jump Tech Group/);
  assert.ok(b.sent.emails.at(-1).html.includes(emailed.url.replace(/&/g, '&amp;')));
  const live = b.db['frontrow.account_tokens'].filter((t) => !t.used_at && Date.parse(t.expires_at) > Date.now());
  assert.equal(live.length, 1, 'issuing a new link retires the old one');
  assert.ok(cu.comments.some((c) => c.taskId === 'con1' && /setup link emailed to pat@acme\.test/.test(c.text)));
  // Once they have a password, the same button emails a reset link — and a
  // reset link is never handed to staff.
  b.db['frontrow.accounts'].push({ contact_id: K.pat, password_hash: 'scrypt$16384$8$1$x$y', status: 'active', failed_attempts: 0 });
  const copyReset = await invite(as('boss'), K.pat);
  assert.equal(copyReset.status, 409);
  assert.equal((await copyReset.json()).code, 'email_only');
  const emailedReset = await (await invite(as('am'), K.pat, true)).json();
  assert.deepEqual([emailedReset.purpose, emailedReset.sent], ['reset', true]);
  // Listing: the account manager sees Pat only.
  const { accounts } = await (await call(r.accounts, '/api/accounts', { cookie: as('am') })).json();
  assert.deepEqual(accounts.map((a) => a.email), ['pat@acme.test']);
  assert.equal(accounts[0].account.hasPassword, true);
  assert.equal(accounts[0].eligible, true);
  const search = await (await call(r.accounts, '/api/accounts?q=lou', { cookie: as('boss') })).json();
  assert.deepEqual(search.accounts.map((a) => a.email), ['lou@dormant.test']);
  assert.equal(search.accounts[0].eligible, false);
});

test('accounts: switching off ends sessions; managers only; linking writes back to ClickUp', async () => {
  const { b, cu } = clickupWorld({
    'frontrow.accounts': [{ contact_id: K.pat, password_hash: 'scrypt$16384$8$1$x$y', status: 'active', failed_attempts: 3 }],
    'frontrow.client_sessions': [{ token_hash: sha('pat-session'), contact_id: K.pat, expires_at: future() }]
  });
  const r = await load();
  const status = (cookie, s) => call(r.accounts, '/api/accounts?action=status', { method: 'POST', cookie, body: { contactId: K.pat, status: s } });
  assert.equal((await status(as('am'), 'disabled')).status, 403);
  assert.equal((await status(as('boss'), 'disabled')).status, 200);
  assert.equal(b.db['frontrow.accounts'][0].status, 'disabled');
  assert.equal(b.db['frontrow.client_sessions'].length, 0);
  const blocked = await call(r.accounts, '/api/accounts?action=invite', { method: 'POST', cookie: as('boss'), body: { contactId: K.pat } });
  assert.equal(blocked.status, 409);
  assert.equal((await status(as('boss'), 'active')).status, 200);
  assert.equal(b.db['frontrow.accounts'][0].failed_attempts, 0);
  assert.equal((await call(r.accounts, '/api/accounts?action=status', { method: 'POST', cookie: as('boss'), body: { contactId: K.lou, status: 'disabled' } })).status, 404, 'no account yet');
  // Link Lou to Acme (active) → now eligible; ClickUp gets the relationship.
  assert.equal((await call(r.accounts, '/api/accounts?action=link', { method: 'POST', cookie: as('am'), body: { contactId: K.lou, companyId: C.acme } })).status, 404, 'am can’t see Lou');
  const linked = await (await call(r.accounts, '/api/accounts?action=link', { method: 'POST', cookie: as('boss'), body: { contactId: K.lou, companyId: C.acme } })).json();
  assert.equal(linked.ok, true);
  assert.ok(b.db['frontrow.contact_companies'].some((l) => l.contact_id === K.lou && l.company_id === C.acme && l.source === 'manual'));
  assert.ok(cu.comments.some((c) => c.taskId === 'con9' && /linked to Acme/.test(c.text)));
});

test('people: someone new to ClickUp gets a ClickUp contact first', async () => {
  const { b, cu } = clickupWorld();
  const r = await load();
  const res = await call(r.contacts, '/api/contacts', { method: 'POST', cookie: as('am'), body: { companyId: C.acme, email: 'Newbie@Acme.test', fullName: 'Nora Newbie' } });
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(out.createdInClickUp, true);
  assert.equal(cu.created.length, 1);
  assert.equal(cu.created[0].list.id, CU.contactsList);
  assert.ok(cu.created[0].custom_fields.some((f) => f.id === CU.f.email && f.value === 'newbie@acme.test'));
  const row = b.db['frontrow.contacts'].find((c) => c.email === 'newbie@acme.test');
  assert.equal(row.clickup_contact_id, cu.created[0].id);
  assert.ok(cu.comments.some((c) => c.taskId === cu.created[0].id && /contact created and added to Acme/.test(c.text)));
});

test('access requests: approve links, emails a setup link and notes ClickUp; dismiss; handled once', async () => {
  const REQ = { a: 'eeeeeeee-0000-4000-8000-000000000001', d: 'eeeeeeee-0000-4000-8000-000000000002', u: 'eeeeeeee-0000-4000-8000-000000000003' };
  const { b, cu } = clickupWorld({ 'frontrow.access_requests': [
    { id: REQ.a, organization_id: ORG_IDS.jtg, email: 'quinn@acme.test', full_name: 'Quinn Asker', company_name: 'Acme', status: 'confirmed', clickup_task_id: 'con77' },
    { id: REQ.d, organization_id: ORG_IDS.jtg, email: 'spam@x.test', full_name: 'Spam', status: 'confirmed' },
    { id: REQ.u, organization_id: ORG_IDS.jtg, email: 'notyet@x.test', full_name: 'Unconfirmed', status: 'unconfirmed' }
  ] });
  const r = await load();
  assert.equal((await call(r.requests, '/api/requests', { cookie: as('am') })).status, 403);
  const { requests } = await (await call(r.requests, '/api/requests', { cookie: as('boss') })).json();
  assert.deepEqual(requests.map((x) => x.email).sort(), ['quinn@acme.test', 'spam@x.test'], 'unconfirmed requests are hidden');
  assert.equal((await call(r.requests, `/api/requests?action=approve&id=${REQ.a}`, { method: 'POST', cookie: as('boss'), body: { companyId: C.dormant } })).status, 409, 'inactive company');
  const ok = await call(r.requests, `/api/requests?action=approve&id=${REQ.a}`, { method: 'POST', cookie: as('boss'), body: { companyId: C.acme } });
  assert.equal(ok.status, 200);
  const { invite } = await ok.json();
  assert.equal(invite.sent, true);
  assert.equal(invite.purpose, 'setup');
  const quinn = b.db['frontrow.contacts'].find((c) => c.email === 'quinn@acme.test');
  assert.ok(b.db['frontrow.contact_companies'].some((l) => l.contact_id === quinn.id && l.company_id === C.acme));
  assert.deepEqual(b.sent.emails.at(-1).to, ['quinn@acme.test']);
  assert.equal(b.db['frontrow.access_requests'].find((x) => x.id === REQ.a).status, 'approved');
  assert.equal((await call(r.requests, `/api/requests?action=approve&id=${REQ.a}`, { method: 'POST', cookie: as('boss'), body: { companyId: C.acme } })).status, 409, 'handled once');
  assert.equal((await call(r.requests, `/api/requests?action=dismiss&id=${REQ.d}`, { method: 'POST', cookie: as('boss'), body: {} })).status, 200);
  assert.equal(b.db['frontrow.access_requests'].find((x) => x.id === REQ.d).status, 'dismissed');
  assert.equal(quinn.clickup_contact_id, 'con77', 'the ClickUp entry made when they confirmed');
  assert.ok(cu.comments.some((c) => c.taskId === 'con77' && /setup link emailed to quinn@acme\.test/.test(c.text)));
  // A request whose ClickUp entry already belongs to someone else doesn't steal it.
  b.db['frontrow.access_requests'].push({ id: 'eeeeeeee-0000-4000-8000-000000000004', organization_id: ORG_IDS.jtg, email: 'pat.new@acme.test', full_name: 'Pat New', status: 'confirmed', clickup_task_id: 'con1' });
  assert.equal((await call(r.requests, '/api/requests?action=approve&id=eeeeeeee-0000-4000-8000-000000000004', { method: 'POST', cookie: as('boss'), body: { companyId: C.acme } })).status, 200);
  assert.equal(b.db['frontrow.contacts'].find((c) => c.email === 'pat.new@acme.test').clickup_contact_id, null);
});

test('account managers can’t reach accounts on clients they don’t manage', async () => {
  const VIC = 'bbbbbbbb-0000-4000-8000-000000000003';
  const { b } = clickupWorld({
    'frontrow.contacts': [
      { id: K.pat, email: 'pat@acme.test', full_name: 'Pat Client', clickup_contact_id: 'con1', active: true },
      { id: VIC, email: 'vic@globex.test', full_name: 'Vic Victim', clickup_contact_id: null, active: true }
    ],
    'frontrow.contact_companies': [
      { contact_id: K.pat, company_id: C.acme, role: 'owner', source: 'clickup' },
      { contact_id: K.pat, company_id: C.globex, role: 'member', source: 'manual' },
      { contact_id: VIC, company_id: C.globex, role: 'owner', source: 'manual' }
    ],
    'frontrow.accounts': [{ contact_id: VIC, password_hash: 'scrypt$16384$8$1$x$y', status: 'active', failed_attempts: 0 }]
  });
  const r = await load();
  // Adding someone who belongs to another client: refused for an account manager…
  const add = await call(r.contacts, '/api/contacts', { method: 'POST', cookie: as('am'), body: { companyId: C.acme, email: 'vic@globex.test' } });
  assert.equal(add.status, 403);
  assert.equal((await add.json()).code, 'other_client');
  assert.ok(!b.db['frontrow.contact_companies'].some((l) => l.contact_id === VIC && l.company_id === C.acme));
  // …so Vic stays invisible to them.
  assert.equal((await call(r.accounts, '/api/accounts?action=invite', { method: 'POST', cookie: as('am'), body: { contactId: VIC, send: true } })).status, 404);
  // Pat is on Acme (theirs) and Globex (not theirs): the setup link can be
  // emailed to Pat, but not copied by this account manager.
  const copy = await call(r.accounts, '/api/accounts?action=invite', { method: 'POST', cookie: as('am'), body: { contactId: K.pat, send: false } });
  assert.equal(copy.status, 403);
  assert.equal((await copy.json()).code, 'email_only');
  assert.equal((await call(r.accounts, '/api/accounts?action=invite', { method: 'POST', cookie: as('am'), body: { contactId: K.pat, send: true } })).status, 200);
  // A manager sees every client, so they can add Vic and copy setup links.
  assert.equal((await call(r.contacts, '/api/contacts', { method: 'POST', cookie: as('boss'), body: { companyId: C.acme, email: 'vic@globex.test' } })).status, 201);
});

test('sync: people deleted or archived in ClickUp lose their ClickUp links (hand-made links stay)', async () => {
  const GONE = 'bbbbbbbb-0000-4000-8000-000000000004';
  const { b } = clickupWorld({
    'frontrow.contacts': [
      { id: K.pat, email: 'pat@acme.test', full_name: 'Pat Client', clickup_contact_id: 'con1', active: true },
      { id: GONE, email: 'gone@acme.test', full_name: 'Gone Person', clickup_contact_id: 'conGone', active: true }
    ],
    'frontrow.contact_companies': [
      { contact_id: K.pat, company_id: C.acme, role: 'owner', source: 'clickup' },
      { contact_id: GONE, company_id: C.acme, role: 'member', source: 'clickup' },
      { contact_id: GONE, company_id: C.globex, role: 'member', source: 'manual' }
    ]
  });
  const r = await load();
  const { counts } = await (await call(r.sync, '/api/sync', { method: 'POST', cookie: as('boss') })).json();
  assert.equal(counts.contactsGoneFromClickUp, 1);
  const links = b.db['frontrow.contact_companies'].filter((l) => l.contact_id === GONE);
  assert.deepEqual(links.map((l) => [l.company_id, l.source]), [[C.globex, 'manual']]);
  assert.ok(b.db['frontrow.contact_companies'].some((l) => l.contact_id === K.pat && l.company_id === C.acme), 'people still in ClickUp keep theirs');
});

test('sync: a fetch that looks partial doesn’t remove anyone', async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `bbbbbbbb-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, email: `p${i}@acme.test`, full_name: `P${i}`, clickup_contact_id: `old${i}`, active: true }));
  const { b } = clickupWorld({
    'frontrow.contacts': many,
    'frontrow.contact_companies': many.map((c) => ({ contact_id: c.id, company_id: C.acme, role: 'member', source: 'clickup' }))
  });
  const r = await load();
  const { counts } = await (await call(r.sync, '/api/sync', { method: 'POST', cookie: as('boss') })).json();
  assert.equal(counts.goneCheckSkipped, true);
  assert.equal(b.db['frontrow.contact_companies'].filter((l) => l.contact_id.startsWith('bbbbbbbb-0000-4000-8000-0000000001')).length, 10);
});

test('access requests: two approvals at once → one wins', async () => {
  const REQ = 'eeeeeeee-0000-4000-8000-000000000009';
  const { b } = clickupWorld({ 'frontrow.access_requests': [
    { id: REQ, organization_id: ORG_IDS.jtg, email: 'twice@acme.test', full_name: 'Twice', status: 'confirmed' }
  ] });
  const r = await load();
  const approve = () => call(r.requests, `/api/requests?action=approve&id=${REQ}`, { method: 'POST', cookie: as('boss'), body: { companyId: C.acme } });
  const [one, two] = await Promise.all([approve(), approve()]);
  assert.deepEqual([one.status, two.status].sort(), [200, 409]);
  assert.equal(b.sent.emails.filter((e) => e.to[0] === 'twice@acme.test').length, 1);
});
