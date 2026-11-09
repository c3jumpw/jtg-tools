/* End-to-end route tests for the Frontrow client app against the fake
 * PostgREST and a fake ClickUp. Rate limits live in module memory, so each
 * test signs in from its own IP. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fakeBackend, fakeClickUp, install, call, seedOrganizations, ORG_IDS, BRANCH_IDS, CU } from './fake-postgrest.js';
import { hashPassword } from '../lib/passwords.js';

const SQL = new URL('../../frontrow-manager/sql/001_frontrow_foundation.sql', import.meta.url).pathname;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const future = (ms = 86400000) => new Date(Date.now() + ms).toISOString();
const past = () => new Date(Date.now() - 60000).toISOString();

const K = {
  pat: 'bbbbbbbb-0000-4000-8000-000000000001', // Acme (JTG) + Initech (MCO) + a closed company; has a password
  lou: 'bbbbbbbb-0000-4000-8000-000000000002', // only a closed company → not eligible
  off: 'bbbbbbbb-0000-4000-8000-000000000003', // contact switched off
  mia: 'bbbbbbbb-0000-4000-8000-000000000004', // Initech; account disabled
  nia: 'bbbbbbbb-0000-4000-8000-000000000005'  // Acme; no account yet
};
const C = { acme: 'cccccccc-0000-4000-8000-000000000001', initech: 'cccccccc-0000-4000-8000-000000000002', closed: 'cccccccc-0000-4000-8000-000000000003' };
const U = { pub: 'dddddddd-0000-4000-8000-000000000001', draft: 'dddddddd-0000-4000-8000-000000000002', mco: 'dddddddd-0000-4000-8000-000000000003', closed: 'dddddddd-0000-4000-8000-000000000004' };
const PASSWORD = 'correct horse 42 battery';
let hashed;

async function world(extra = {}) {
  hashed = hashed || await hashPassword(PASSWORD);
  const cu = fakeClickUp({ tasks: [CU.contact('con1', 'Pat Client', 'pat@acme.test', { accounts: ['acc1'] }), CU.contact('con5', 'Nia New', 'nia@acme.test', { accounts: ['acc1'] })] });
  const b = fakeBackend({
    sqlPath: SQL,
    clickup: cu,
    seed: {
      ...seedOrganizations(),
      'frontrow.companies': [
        { id: C.acme, name: 'Acme', organization_id: ORG_IDS.jtg, branch_id: BRANCH_IDS.f5, active: true, branding: {}, source: 'clickup', clickup_account_id: 'acc1' },
        { id: C.initech, name: 'Initech', organization_id: ORG_IDS.mco, branch_id: null, active: true, branding: { accent: '#0F766E' }, source: 'clickup', clickup_account_id: 'acc2' },
        { id: C.closed, name: 'Closed Co', organization_id: ORG_IDS.jtg, branch_id: null, active: false, branding: {}, source: 'clickup', clickup_account_id: 'acc3' }
      ],
      'frontrow.contacts': [
        { id: K.pat, email: 'pat@acme.test', full_name: 'Pat Client', clickup_contact_id: 'con1', active: true },
        { id: K.lou, email: 'lou@closed.test', full_name: 'Lou', clickup_contact_id: null, active: true },
        { id: K.off, email: 'off@acme.test', full_name: 'Off', clickup_contact_id: null, active: false },
        { id: K.mia, email: 'mia@initech.test', full_name: 'Mia', clickup_contact_id: null, active: true },
        { id: K.nia, email: 'nia@acme.test', full_name: 'Nia New', clickup_contact_id: 'con5', active: true }
      ],
      'frontrow.contact_companies': [
        { contact_id: K.pat, company_id: C.acme, role: 'owner', source: 'clickup' },
        { contact_id: K.pat, company_id: C.initech, role: 'member', source: 'clickup' },
        { contact_id: K.pat, company_id: C.closed, role: 'member', source: 'clickup' },
        { contact_id: K.lou, company_id: C.closed, role: 'member', source: 'clickup' },
        { contact_id: K.off, company_id: C.acme, role: 'member', source: 'manual' },
        { contact_id: K.mia, company_id: C.initech, role: 'member', source: 'clickup' },
        { contact_id: K.nia, company_id: C.acme, role: 'member', source: 'clickup' }
      ],
      'frontrow.accounts': [
        { contact_id: K.pat, password_hash: hashed, status: 'active', activated_at: past(), failed_attempts: 0 },
        { contact_id: K.off, password_hash: hashed, status: 'active', activated_at: past(), failed_attempts: 0 },
        { contact_id: K.mia, password_hash: hashed, status: 'disabled', activated_at: past(), failed_attempts: 0 }
      ],
      'frontrow.updates': [
        { id: U.pub, company_id: C.acme, type: 'update', title: 'October results', summary: 'Leads up', notes: 'INTERNAL NOTE', body_html: '<h1>Leads up 32%</h1>', status: 'published', published_at: '2026-11-01T10:00:00Z' },
        { id: U.draft, company_id: C.acme, type: 'update', title: 'Draft', summary: '', notes: '', body_html: '<p>secret</p>', status: 'draft' },
        { id: U.mco, company_id: C.initech, type: 'guide', title: 'Initech guide', summary: '', notes: '', body_html: '<p>guide</p>', status: 'published', published_at: '2026-10-01T10:00:00Z' },
        { id: U.closed, company_id: C.closed, type: 'update', title: 'Old news', summary: '', notes: '', body_html: '<p>closed</p>', status: 'published', published_at: '2026-09-01T10:00:00Z' }
      ],
      ...extra
    }
  });
  install(b, { CLICKUP_API_TOKEN: 'pk_test' });
  return { b, cu };
}

const load = async () => ({
  page: (await import('../api/page.js')).default,
  manifest: (await import('../api/manifest.js')).default,
  login: (await import('../api/login.js')).default,
  access: (await import('../api/access.js')).default,
  token: (await import('../api/token.js')).default,
  setPassword: (await import('../api/set-password.js')).default,
  confirm: (await import('../api/access-confirm.js')).default,
  me: (await import('../api/me.js')).default,
  updates: (await import('../api/updates.js')).default,
  view: (await import('../api/view.js')).default
});

const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
const signIn = async (r, ip, email = 'pat@acme.test', org = 'jtg') =>
  call(r.login, '/api/login', { method: 'POST', body: { email, password: PASSWORD, org }, ip });
const tokenRow = (b, purpose, contactId) => b.db['frontrow.account_tokens'].filter((t) => t.purpose === purpose && t.contact_id === contactId).at(-1);
const linkIn = (html, kind) => (html.match(new RegExp(`#${kind}=([A-Za-z0-9_-]{32,64})`)) || [])[1];

test('pages: landing, an organization’s sign-in, its own domain, and unknown links', async () => {
  const { b } = await world();
  const r = await load();
  const landing = await call(r.page, '/api/page');
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /Frontrow/);
  const jtg = await (await call(r.page, '/api/page?org=jtg')).text();
  const boot = JSON.parse(jtg.match(/<script type="application\/json" id="fr-boot">([\s\S]*?)<\/script>/)[1]);
  assert.equal(boot.org.name, 'Jump Tech Group');
  assert.ok(boot.org.branches.some((x) => x.name === 'Fortune 5 Agency'));
  assert.ok(!jtg.includes('clickup'), 'no CRM details on a public page');
  assert.match(jtg, /\/api\/manifest\?org=jtg/);
  assert.equal((await call(r.page, '/api/page?org=nope')).status, 404);
  assert.equal((await call(r.page, '/api/page?view=signin')).status, 200);
  // On its own domain, an organization's portal is the home page.
  b.db['frontrow.organizations'].find((o) => o.slug === 'mco').custom_domain = 'portal.mco.test';
  const own = await (await call(r.page, '/api/page', { host: 'portal.mco.test' })).text();
  assert.match(own, /"slug":"mco"/);
  // Branding can't break out of the boot block.
  b.db['frontrow.organizations'].find((o) => o.slug === 'jtg').branding.tagline = '</script><script>alert(1)</script>';
  const hostile = await (await call(r.page, '/api/page?org=jtg')).text();
  assert.ok(!hostile.includes('<script>alert(1)'));
});

test('pages: with the database down, the landing page still works and portals say so in plain words', async () => {
  const { b } = await world();
  const r = await load();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://fake.supabase.test') ? new Response('{"message":"down"}', { status: 503 }) : realFetch(url, init));
  try {
    assert.equal((await call(r.page, '/api/page')).status, 200);
    const res = await call(r.page, '/api/page?org=jtg');
    assert.equal(res.status, 503);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /back shortly/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(b);
});

test('manifest: each organization installs under its own name and icon', async () => {
  await world();
  const r = await load();
  const m = await (await call(r.manifest, '/api/manifest?org=jtg')).json();
  assert.equal(m.name, 'Jump Tech Group Client Portal');
  assert.equal(m.start_url, '/jtg');
  assert.ok(m.icons.every((i) => i.src.startsWith('/assets/orgs/jtg/')));
  const plain = await (await call(r.manifest, '/api/manifest?org=nope')).json();
  assert.equal(plain.name, 'Frontrow');
  assert.equal(plain.start_url, '/signin');
});

test('sign-in: one answer for unknown, no password and wrong password; lands in the right organization', async () => {
  const { b } = await world();
  const r = await load();
  const bad = await call(r.login, '/api/login', { method: 'POST', body: { email: 'pat@acme.test', password: 'wrong password!!' }, ip: '198.51.100.11' });
  const unknown = await call(r.login, '/api/login', { method: 'POST', body: { email: 'who@x.test', password: PASSWORD }, ip: '198.51.100.11' });
  const nopw = await call(r.login, '/api/login', { method: 'POST', body: { email: 'nia@acme.test', password: PASSWORD }, ip: '198.51.100.11' });
  assert.deepEqual([bad.status, unknown.status, nopw.status], [401, 401, 401]);
  const bodies = await Promise.all([bad.json(), unknown.json(), nopw.json()]);
  assert.ok(bodies.every((x) => x.code === 'invalid' && x.error === bodies[0].error));
  assert.equal(b.db['frontrow.accounts'].find((a) => a.contact_id === K.pat).failed_attempts, 1);

  const ok = await signIn(r, '198.51.100.11', 'PAT@acme.test', 'mco');
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).org, 'mco', 'Pat has a company in MCO, so the MCO page keeps them there');
  assert.match(ok.headers.get('set-cookie'), /^__Host-frontrow_sid=[A-Za-z0-9_-]+; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  assert.equal(b.db['frontrow.accounts'].find((a) => a.contact_id === K.pat).failed_attempts, 0);
  assert.equal((await (await signIn(r, '198.51.100.11', 'pat@acme.test', 'uny')).json()).org !== 'uny', true, 'no companies in UNY → their own organization');

  const off = await signIn(r, '198.51.100.12', 'off@acme.test');
  assert.equal(off.status, 403);
  assert.equal((await off.json()).code, 'disabled');
  const mia = await signIn(r, '198.51.100.12', 'mia@initech.test');
  assert.equal((await mia.json()).code, 'disabled');
});

test('sign-in: ten wrong passwords pause the account, with the same answer as a wrong password', async () => {
  const { b } = await world();
  const r = await load();
  b.db['frontrow.accounts'].push({ contact_id: K.nia, password_hash: hashed, status: 'active', activated_at: past(), failed_attempts: 0 });
  let first;
  for (let i = 0; i < 10; i++) {
    const res = await call(r.login, '/api/login', { method: 'POST', body: { email: 'nia@acme.test', password: `nope-${i}-password` }, ip: '198.51.100.13' });
    first = first || await res.json();
  }
  const acc = b.db['frontrow.accounts'].find((a) => a.contact_id === K.nia);
  assert.ok(Date.parse(acc.locked_until) > Date.now() + 14 * 60000);
  const locked = await signIn(r, '198.51.100.13', 'nia@acme.test');
  assert.equal(locked.status, 401, 'a locked account answers like a wrong password');
  assert.deepEqual(await locked.json(), first);
  // When the pause runs out, the count starts again and the right password works.
  acc.locked_until = past();
  assert.equal((await signIn(r, '198.51.100.13', 'nia@acme.test')).status, 200);
  assert.equal(b.db['frontrow.accounts'].find((a) => a.contact_id === K.nia).failed_attempts, 0);
});

test('sign-in: guesses sent in parallel are each counted (or refused unchecked)', async () => {
  const { b } = await world();
  const r = await load();
  b.db['frontrow.accounts'].push({ contact_id: K.lou, password_hash: hashed, status: 'active', activated_at: past(), failed_attempts: 0 });
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    call(r.login, '/api/login', { method: 'POST', body: { email: 'lou@closed.test', password: `parallel-${i}-guess` }, ip: '198.51.100.15' })));
  assert.ok(results.every((x) => x.status === 401));
  const acc = b.db['frontrow.accounts'].find((a) => a.contact_id === K.lou);
  assert.ok(acc.failed_attempts >= 4, `counted ${acc.failed_attempts}`);
});

test('signing in with no active company says so (only after the right password)', async () => {
  const { b } = await world();
  const r = await load();
  b.db['frontrow.accounts'].push({ contact_id: K.lou, password_hash: hashed, status: 'active', activated_at: past(), failed_attempts: 0 });
  const res = await signIn(r, '198.51.100.14', 'lou@closed.test');
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'no_access');
});

test('set up / forgot password: the same answer for everyone; the right email behind it', async () => {
  const { b, cu } = await world();
  const r = await load();
  const ask = (email, org = 'jtg') => call(r.access, '/api/access', { method: 'POST', body: { email, org }, ip: '198.51.100.21' });
  const results = await Promise.all([ask('nia@acme.test'), ask('pat@acme.test'), ask('lou@closed.test'), ask('stranger@x.test', 'mco'), ask('mia@initech.test'), ask('off@acme.test')]);
  const bodies = await Promise.all(results.map((x) => x.json()));
  assert.ok(results.every((x) => x.status === 200));
  assert.ok(bodies.every((x) => x.message === bodies[0].message), 'one message for all');
  const mail = (to) => b.sent.emails.filter((e) => e.to[0] === to);

  // Eligible, no password → 60-minute setup link to their organization's page, noted in ClickUp.
  assert.equal(mail('nia@acme.test').length, 1);
  const setup = linkIn(mail('nia@acme.test')[0].html, 'setup');
  assert.ok(mail('nia@acme.test')[0].html.includes(`https://frontrow.test/jtg#setup=${setup}`));
  const t = tokenRow(b, 'setup', K.nia);
  assert.equal(t.token_hash, sha(setup));
  assert.ok(Date.parse(t.expires_at) - Date.now() <= 60 * 60000);
  assert.ok(cu.comments.some((c) => c.taskId === 'con5' && /asked for a setup link/.test(c.text)));
  // Has a password → reset link.
  assert.ok(linkIn(mail('pat@acme.test')[0].html, 'reset'));
  // Not eligible or unknown → "request access" email; nothing reaches ClickUp yet.
  for (const who of ['lou@closed.test', 'stranger@x.test']) {
    assert.equal(mail(who).length, 1);
    assert.ok(linkIn(mail(who)[0].html, 'request'));
  }
  assert.ok(mail('stranger@x.test')[0].html.includes('https://frontrow.test/mco#request='));
  assert.equal(b.db['frontrow.access_requests'].length, 2);
  assert.ok(b.db['frontrow.access_requests'].every((x) => x.status === 'unconfirmed'));
  assert.equal(cu.created.length, 0);
  // Switched off → nothing at all.
  assert.equal(mail('mia@initech.test').length + mail('off@acme.test').length, 0);
  // Asking again within a day doesn't send another request email.
  await ask('lou@closed.test');
  assert.equal(mail('lou@closed.test').length, 1);
});

test('links: checking never spends; used, expired and wrong-kind links are told apart', async () => {
  const { b } = await world({
    'frontrow.account_tokens': [
      { token_hash: sha('A'.repeat(43)), contact_id: K.nia, purpose: 'setup', organization_id: ORG_IDS.jtg, expires_at: future() },
      { token_hash: sha('B'.repeat(43)), contact_id: K.nia, purpose: 'setup', organization_id: ORG_IDS.jtg, expires_at: past() },
      { token_hash: sha('C'.repeat(43)), contact_id: K.nia, purpose: 'setup', organization_id: ORG_IDS.jtg, expires_at: future(), used_at: past() }
    ]
  });
  const r = await load();
  const check = (t, kind) => call(r.token, '/api/token', { method: 'POST', body: { t, kind }, ip: '198.51.100.31' });
  const good = await (await check('A'.repeat(43), 'setup')).json();
  assert.deepEqual([good.ok, good.email, good.org], [true, 'nia@acme.test', 'jtg']);
  assert.equal(b.db['frontrow.account_tokens'][0].used_at, undefined);
  assert.equal((await (await check('A'.repeat(43), 'reset')).json()).code, 'badlink');
  assert.equal((await (await check('B'.repeat(43), 'setup')).json()).code, 'expired');
  assert.equal((await (await check('C'.repeat(43), 'setup')).json()).code, 'used');
  assert.equal((await (await check('short', 'setup')).json()).code, 'badlink');
});

test('first password: link spent once, account made, welcome email with home-screen steps, ClickUp note', async () => {
  const { b, cu } = await world({
    'frontrow.account_tokens': [{ token_hash: sha('S'.repeat(43)), contact_id: K.nia, purpose: 'setup', organization_id: ORG_IDS.jtg, expires_at: future() }]
  });
  const r = await load();
  const set = (password) => call(r.setPassword, '/api/set-password', { method: 'POST', body: { t: 'S'.repeat(43), password }, ip: '198.51.100.41' });
  const weak = await set('short');
  assert.equal((await weak.json()).code, 'weak');
  assert.ok(!b.db['frontrow.account_tokens'][0].used_at, 'a refused password doesn’t spend the link');
  const [one, two] = await Promise.all([set(PASSWORD), set(PASSWORD)]);
  assert.deepEqual([one.status, two.status].sort(), [200, 400], 'two taps: exactly one wins');
  const win = one.status === 200 ? one : two;
  const out = await win.json();
  assert.deepEqual([out.org, out.firstTime], ['jtg', true]);
  const acc = b.db['frontrow.accounts'].find((a) => a.contact_id === K.nia);
  assert.match(acc.password_hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(acc.activated_at);
  const welcome = b.sent.emails.find((e) => e.to[0] === 'nia@acme.test');
  assert.match(welcome.html, /Add to Home Screen/);
  assert.match(welcome.html, /https:\/\/frontrow\.test\/jtg/);
  assert.ok(cu.comments.some((c) => c.taskId === 'con5' && /set up their Jump Tech Group portal account and can now see Acme/.test(c.text)));
  // The new session works.
  const me = await (await call(r.me, '/api/me', { cookie: cookieOf(win) })).json();
  assert.equal(me.email, 'nia@acme.test');
  assert.ok(b.db['core.audit_log'].some((a) => a.action === 'client.activate' && a.tool === 'frontrow'));
});

test('reset: signs out other devices, no welcome email; a link for someone no longer eligible is refused unspent', async () => {
  const { b } = await world({
    'frontrow.account_tokens': [
      { token_hash: sha('R'.repeat(43)), contact_id: K.pat, purpose: 'reset', organization_id: ORG_IDS.jtg, expires_at: future() },
      { token_hash: sha('L'.repeat(43)), contact_id: K.lou, purpose: 'setup', organization_id: ORG_IDS.jtg, expires_at: future() }
    ],
    'frontrow.client_sessions': [{ token_hash: sha('pat-old-device'), contact_id: K.pat, expires_at: future() }]
  });
  const r = await load();
  const res = await call(r.setPassword, '/api/set-password', { method: 'POST', body: { t: 'R'.repeat(43), password: 'a brand new password 7' }, ip: '198.51.100.42' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).firstTime, false);
  assert.ok(!b.db['frontrow.client_sessions'].some((s) => s.token_hash === sha('pat-old-device')));
  assert.equal(b.sent.emails.length, 0);
  const lou = await call(r.setPassword, '/api/set-password', { method: 'POST', body: { t: 'L'.repeat(43), password: PASSWORD }, ip: '198.51.100.42' });
  assert.equal((await lou.json()).code, 'no_access');
  assert.ok(!b.db['frontrow.account_tokens'].find((t) => t.contact_id === K.lou).used_at);
});

test('access request: confirming creates the ClickUp contact with a note, once', async () => {
  const { b, cu } = await world({
    'frontrow.access_requests': [
      { id: 'eeeeeeee-0000-4000-8000-000000000001', organization_id: ORG_IDS.mco, email: 'quinn@new.test', status: 'unconfirmed', confirm_token_hash: sha('Q'.repeat(43)), confirm_expires_at: future() },
      { id: 'eeeeeeee-0000-4000-8000-000000000002', organization_id: ORG_IDS.jtg, email: 'pat@acme.test', status: 'unconfirmed', confirm_token_hash: sha('P'.repeat(43)), confirm_expires_at: future() }
    ]
  });
  const r = await load();
  const confirm = (t, extra = {}) => call(r.confirm, '/api/access-confirm', { method: 'POST', body: { t, fullName: 'Quinn Asker', companyName: 'New Co', message: 'Hi', ...extra }, ip: '198.51.100.51' });
  assert.equal((await confirm('Q'.repeat(43), { fullName: '' })).status, 400);
  const ok = await confirm('Q'.repeat(43));
  assert.equal(ok.status, 200);
  assert.equal(cu.created.length, 1);
  assert.equal(cu.created[0].list.id, CU.contactsList);
  const req = b.db['frontrow.access_requests'][0];
  assert.deepEqual([req.status, req.clickup_task_id, req.full_name], ['confirmed', cu.created[0].id, 'Quinn Asker']);
  assert.ok(cu.comments.some((c) => c.taskId === cu.created[0].id && /Frontrow access request \(MCO portal\): Quinn Asker, New Co <quinn@new\.test>/.test(c.text)));
  assert.equal((await (await confirm('Q'.repeat(43))).json()).code, 'used');
  assert.equal(cu.created.length, 1, 'no second CRM entry');
  // Someone already in ClickUp gets a note on their existing entry instead.
  await confirm('P'.repeat(43), { fullName: 'Pat Client' });
  assert.equal(cu.created.length, 1);
  assert.ok(cu.comments.some((c) => c.taskId === 'con1' && /Frontrow access request/.test(c.text)));
});

test('signed in: only active companies, only published updates, pages under the sandbox', async () => {
  const { b } = await world();
  const r = await load();
  const sid = cookieOf(await signIn(r, '198.51.100.61'));
  const me = await (await call(r.me, '/api/me', { cookie: sid })).json();
  assert.deepEqual(me.companies.map((c) => [c.name, c.org]).sort(), [['Acme', 'jtg'], ['Initech', 'mco']]);
  assert.deepEqual(me.organizations.map((o) => o.slug).sort(), ['jtg', 'mco']);
  assert.ok(!JSON.stringify(me).includes('clickup'));

  const list = await (await call(r.updates, `/api/updates?companyId=${C.acme}`, { cookie: sid })).json();
  assert.deepEqual(list.updates.map((u) => u.title), ['October results']);
  assert.ok(!JSON.stringify(list).includes('INTERNAL NOTE'));
  assert.equal((await call(r.updates, `/api/updates?companyId=${C.closed}`, { cookie: sid })).status, 404);
  assert.equal((await call(r.updates, `/api/updates?companyId=${C.acme}`)).status, 401);

  const page = await call(r.view, `/api/view?id=${U.pub}`, { cookie: sid });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /sandbox/);
  assert.match(await page.text(), /Leads up 32%/);
  for (const id of [U.draft, U.closed, 'eeeeeeee-0000-4000-8000-00000000dead']) {
    assert.equal((await call(r.view, `/api/view?id=${id}`, { cookie: sid })).status, 404);
  }
  assert.equal((await call(r.view, `/api/view?id=${U.pub}`)).status, 401);

  // Switching the account off ends access on the next request.
  b.db['frontrow.accounts'].find((a) => a.contact_id === K.pat).status = 'disabled';
  assert.equal((await (await call(r.me, '/api/me', { cookie: sid })).json()).authenticated, false);
  b.db['frontrow.accounts'].find((a) => a.contact_id === K.pat).status = 'active';
  // Signing out ends the session.
  const out = await call(r.me, '/api/me?action=logout', { method: 'POST', cookie: sid });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await (await call(r.me, '/api/me', { cookie: sid })).json()).authenticated, false);
});

test('cross-site requests are refused', async () => {
  await world();
  const r = await load();
  assert.equal((await call(r.login, '/api/login', { method: 'POST', body: { email: 'pat@acme.test', password: PASSWORD }, origin: 'https://evil.example', ip: '198.51.100.71' })).status, 403);
  assert.equal((await call(r.access, '/api/access', { method: 'POST', body: { email: 'pat@acme.test' }, origin: 'https://evil.example', ip: '198.51.100.71' })).status, 403);
});
