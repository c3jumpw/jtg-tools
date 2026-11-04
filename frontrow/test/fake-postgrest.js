/* An in-memory stand-in for Supabase's REST API (PostgREST), plus fakes for
 * ClickUp, Resend and Gemini, used by the route tests.
 *
 * It reads the real table definitions from the migration, so a query that
 * names a column that doesn't exist fails here exactly as it would against
 * the live database — the bug most likely to slip through otherwise.
 *
 * Supports what Frontrow uses: select with embedded relations (incl.
 * !inner), eq / neq / is / in / ilike / gte filters (also on embedded
 * columns), or=(…), order, limit, insert (with on_conflict merge), patch
 * and delete.
 *
 * Kept identical to the copy in frontrow/test/ (a test checks).
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const CORE = {
  'core.people': ['id', 'auth_user_id', 'email', 'full_name', 'phone', 'active', 'created_at', 'updated_at'],
  'core.tool_access': ['person_id', 'tool', 'role', 'created_at'],
  'core.audit_log': ['id', 'at', 'actor_person_id', 'tool', 'action', 'entity', 'entity_id', 'detail'],
  'core.sessions': ['token_hash', 'email', 'person_id', 'created_at', 'expires_at', 'ip', 'user_agent'],
  'core.magic_links': ['token_hash', 'email', 'created_at', 'expires_at', 'used_at', 'ip']
};

// Views from the migration, computed from the tables on each read.
const VIEWS = {
  'frontrow.company_overview': {
    cols: ['company_id', 'contacts', 'accounts', 'drafts', 'last_published_at'],
    rows: (db) => db['frontrow.companies'].map((c) => {
      const ups = db['frontrow.updates'].filter((u) => u.company_id === c.id);
      const pub = ups.filter((u) => u.status === 'published' && u.published_at).map((u) => u.published_at).sort();
      const people = db['frontrow.contact_companies'].filter((l) => l.company_id === c.id);
      return {
        company_id: c.id,
        contacts: people.length,
        accounts: people.filter((l) => db['frontrow.accounts'].some((a) => a.contact_id === l.contact_id && a.password_hash && a.status === 'active')).length,
        drafts: ups.filter((u) => u.status === 'draft').length,
        last_published_at: pub.length ? pub[pub.length - 1] : null
      };
    })
  }
};

export function schemaFromMigration(sqlPath) {
  const sql = readFileSync(sqlPath, 'utf8');
  const tables = { ...CORE };
  const re = /create table (frontrow\.\w+) \(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(sql))) {
    const cols = [];
    for (const line of m[2].split('\n')) {
      const t = line.trim();
      const w = (t.match(/^([a-z_][a-z0-9_]*)\s+/) || [])[1];
      if (!w || ['constraint', 'primary', 'unique', 'check', 'foreign'].includes(w)) continue;
      cols.push(w);
    }
    tables[m[1]] = cols;
  }
  for (const v of Object.keys(VIEWS)) if (sql.includes(`create view ${v} `)) tables[v] = VIEWS[v].cols;
  return tables;
}

const REL = {
  'core.people': { tool_access: { table: 'core.tool_access', local: 'id', foreign: 'person_id', many: true } },
  'frontrow.contact_companies': {
    companies: { table: 'frontrow.companies', local: 'company_id', foreign: 'id', many: false },
    contacts: { table: 'frontrow.contacts', local: 'contact_id', foreign: 'id', many: false }
  }
};

const UNIQUE = {
  'core.people': [['email:lower']],
  'core.tool_access': [['person_id', 'tool']],
  'core.sessions': [['token_hash']],
  'core.magic_links': [['token_hash']],
  'frontrow.organizations': [['slug'], ['clickup_label'], ['custom_domain']],
  'frontrow.branches': [['organization_id', 'clickup_value']],
  'frontrow.contacts': [['email'], ['clickup_contact_id']],
  'frontrow.companies': [['clickup_account_id']],
  'frontrow.contact_companies': [['contact_id', 'company_id']],
  'frontrow.accounts': [['contact_id']],
  'frontrow.account_tokens': [['token_hash']],
  'frontrow.client_sessions': [['token_hash']],
  'frontrow.access_requests': [['confirm_token_hash']],
  'frontrow.staff_company_assignments': [['person_id', 'company_id']]
};

function splitTop(s) {
  const out = []; let depth = 0; let cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseSelect(sel) {
  return splitTop(sel || '*').map((part) => {
    const m = part.match(/^(\w+)(!inner)?\((.*)\)$/);
    if (m) return { embed: m[1], inner: Boolean(m[2]), cols: parseSelect(m[3]) };
    return { col: part };
  });
}

function likeToRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (c === '%' || c === '*') re += '.*';
    else if (c === '_') re += '.';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

function test(value, op) {
  const [kind, ...rest] = op.split('.');
  const arg = rest.join('.');
  const v = value === undefined ? null : value;
  if (kind === 'eq') return v !== null && String(v) === arg;
  if (kind === 'neq') return v === null || String(v) !== arg;
  if (kind === 'is') return arg === 'null' ? v === null : String(v) === arg;
  if (kind === 'in') return v !== null && arg.replace(/^\(|\)$/g, '').split(',').includes(String(v));
  if (kind === 'ilike') return v !== null && likeToRegex(arg).test(String(v));
  if (kind === 'gte') return v !== null && String(v) >= arg;
  throw new Error(`fake postgrest: unsupported operator ${kind}`);
}

/** or=(email.ilike.*x*,full_name.ilike.*x*) */
function testOr(row, expr) {
  return splitTop(expr.replace(/^\(|\)$/g, '')).some((cond) => {
    const [col, ...op] = cond.split('.');
    return test(row[col], op.join('.'));
  });
}

/** A small fake ClickUp: tasks by id, list membership, comments, created tasks. */
export function fakeClickUp({ tasks = [], fields = {} } = {}) {
  const store = new Map(tasks.map((t) => [String(t.id), { ...t }]));
  const comments = [];
  const created = [];
  const relations = [];
  let nextId = 900000;
  async function handle(url, init = {}) {
    const u = new URL(url);
    const path = u.pathname.replace('/api/v2', '');
    const method = init.method || 'GET';
    const send = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    let m;
    if (method === 'GET' && (m = path.match(/^\/task\/([^/]+)$/))) {
      const t = store.get(decodeURIComponent(m[1]));
      return t ? send(200, t) : send(404, { err: 'Task not found', ECODE: 'ITEM_015' });
    }
    if (method === 'GET' && (m = path.match(/^\/list\/([^/]+)\/task$/))) {
      const page = Number(u.searchParams.get('page') || 0);
      const all = [...store.values()].filter((t) => t.list && String(t.list.id) === m[1]);
      const slice = all.slice(page * 100, page * 100 + 100);
      return send(200, { tasks: slice, last_page: (page + 1) * 100 >= all.length });
    }
    if (method === 'POST' && (m = path.match(/^\/task\/([^/]+)\/comment$/))) {
      comments.push({ taskId: decodeURIComponent(m[1]), text: JSON.parse(init.body).comment_text });
      return send(200, { id: String(comments.length) });
    }
    if (method === 'POST' && (m = path.match(/^\/list\/([^/]+)\/task$/))) {
      const body = JSON.parse(init.body);
      const id = String(nextId++);
      const task = { id, name: body.name, list: { id: m[1] }, custom_fields: (body.custom_fields || []).map((f) => ({ id: f.id, value: f.value, type: fields[f.id] || 'short_text' })) };
      store.set(id, task);
      created.push(task);
      return send(200, task);
    }
    if (method === 'POST' && (m = path.match(/^\/task\/([^/]+)\/field\/([^/]+)$/))) {
      relations.push({ taskId: m[1], fieldId: m[2], value: JSON.parse(init.body).value });
      return send(200, {});
    }
    return send(404, { err: `fake clickup: no route for ${method} ${path}` });
  }
  return { handle, store, comments, created, relations };
}

export function fakeBackend({ sqlPath, seed = {}, gemini, resend, clickup } = {}) {
  const schema = schemaFromMigration(sqlPath);
  const db = {};
  for (const t of Object.keys(schema)) if (!VIEWS[t]) db[t] = [];
  for (const [t, rows] of Object.entries(seed)) db[t] = rows.map((r) => ({ ...r }));
  const sent = { emails: [], gemini: [] };
  let auditId = 0;

  const fail = (status, message) => new Response(JSON.stringify({ message }), { status, headers: { 'Content-Type': 'application/json' } });
  const ok = (rows, status = 200) => new Response(JSON.stringify(rows), { status, headers: { 'Content-Type': 'application/json' } });

  function checkCols(table, cols) {
    const known = schema[table];
    if (!known) return `relation "${table}" does not exist`;
    const bad = cols.filter((c) => c !== '*' && !known.includes(c));
    return bad.length ? `column ${table}.${bad[0]} does not exist` : null;
  }

  function project(table, row, sel) {
    const out = {};
    for (const s of sel) {
      if (s.col === '*') Object.assign(out, row);
      else if (s.col) out[s.col] = row[s.col] === undefined ? null : row[s.col];
      else {
        const rel = REL[table] && REL[table][s.embed];
        const kids = db[rel.table].filter((k) => k[rel.foreign] === row[rel.local]);
        out[s.embed] = rel.many ? kids.map((k) => project(rel.table, k, s.cols)) : (kids[0] ? project(rel.table, kids[0], s.cols) : null);
      }
    }
    return out;
  }

  function filterRows(table, params, sel) {
    let rows = VIEWS[table] ? VIEWS[table].rows(db) : db[table];
    const embedFilters = {};
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
      if (k === 'or') { rows = rows.filter((r) => testOr(r, v)); continue; }
      if (k.includes('.')) { const [rel, col] = k.split('.'); (embedFilters[rel] ||= []).push([col, v]); continue; }
      const err = checkCols(table, [k]);
      if (err) throw fail(400, err);
      rows = rows.filter((r) => test(r[k], v));
    }
    for (const e of (sel || []).filter((s) => s.embed)) {
      const rel = REL[table] && REL[table][e.embed];
      if (!rel) throw fail(400, `no relationship between ${table} and ${e.embed}`);
      const err = checkCols(rel.table, e.cols.filter((c) => c.col).map((c) => c.col));
      if (err) throw fail(400, err);
      const f = embedFilters[e.embed] || [];
      for (const [col] of f) { const ce = checkCols(rel.table, [col]); if (ce) throw fail(400, ce); }
      if (e.inner) rows = rows.filter((r) => db[rel.table].some((k) => k[rel.foreign] === r[rel.local] && f.every(([col, v]) => test(k[col], v))));
    }
    return { rows, embedFilters };
  }

  function uniqueClash(table, row, ignore) {
    for (const key of UNIQUE[table] || []) {
      const val = (r, k) => { const [c, mod] = k.split(':'); const x = r[c]; return mod === 'lower' && typeof x === 'string' ? x.toLowerCase() : x; };
      if (key.some((k) => val(row, k) == null)) continue;
      const hit = db[table].find((r) => r !== ignore && key.every((k) => val(r, k) === val(row, k)));
      if (hit) return { hit, key };
    }
    return null;
  }

  function defaults(table, row) {
    const cols = schema[table];
    const now = new Date().toISOString();
    const d = {};
    if (cols.includes('id') && table !== 'core.audit_log') d.id = randomUUID();
    if (table === 'core.audit_log') { d.id = ++auditId; d.at = now; d.detail = {}; }
    for (const c of ['created_at', 'updated_at']) if (cols.includes(c)) d[c] = now;
    if (cols.includes('active')) d.active = true;
    if (table === 'core.magic_links') { d.expires_at = new Date(Date.now() + 15 * 60_000).toISOString(); d.used_at = null; }
    if (table === 'frontrow.updates') Object.assign(d, { status: 'draft', summary: '', notes: '', body_html: '', published_at: null, published_by: null });
    if (table === 'frontrow.companies') Object.assign(d, { branding: {}, clickup_account_id: null, primary_owner_person_id: null, branch_id: null, source: 'manual', clickup_status: null });
    if (table === 'frontrow.contacts') Object.assign(d, { full_name: '', clickup_contact_id: null });
    if (table === 'frontrow.contact_companies') Object.assign(d, { role: 'member', source: 'manual' });
    if (table === 'frontrow.accounts') Object.assign(d, { status: 'active', failed_attempts: 0, locked_until: null, activated_at: null, last_sign_in_at: null, password_hash: null });
    if (table === 'frontrow.account_tokens') Object.assign(d, { used_at: null });
    if (table === 'frontrow.access_requests') Object.assign(d, { status: 'unconfirmed', full_name: '', company_name: '', message: '', clickup_task_id: null });
    if (table === 'frontrow.sync_runs') Object.assign(d, { started_at: now, status: 'running', counts: {} });
    return { ...d, ...row };
  }

  async function rest(url, init) {
    const u = new URL(url);
    const table = `${(init.headers['Content-Profile'] || init.headers['Accept-Profile'])}.${u.pathname.replace('/rest/v1/', '')}`;
    if (!schema[table]) return fail(404, `relation "${table}" does not exist`);
    const method = init.method || 'GET';
    const params = [...u.searchParams.entries()];
    const sel = parseSelect(u.searchParams.get('select'));
    try {
      if (VIEWS[table] && method !== 'GET') return fail(405, `cannot write to view ${table}`);
      if (method === 'GET') {
        const err = checkCols(table, sel.filter((s) => s.col).map((s) => s.col));
        if (err) return fail(400, err);
        let { rows, embedFilters } = filterRows(table, params, sel);
        const order = u.searchParams.get('order');
        if (order) {
          const [col, dir] = order.split('.');
          // Numbers compare as numbers (like Postgres ints); everything else as text.
          const cmp = (x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '') < String(y ?? '') ? -1 : String(x ?? '') > String(y ?? '') ? 1 : 0);
          rows = [...rows].sort((a, b) => cmp(a[col], b[col]) * (dir === 'desc' ? -1 : 1));
        }
        const limit = Number(u.searchParams.get('limit')) || rows.length;
        return ok(rows.slice(0, limit).map((r) => {
          const p = project(table, r, sel);
          for (const [rel, f] of Object.entries(embedFilters)) {
            if (Array.isArray(p[rel])) p[rel] = p[rel].filter((k) => f.every(([col, v]) => test(k[col], v)));
          }
          return p;
        }));
      }
      if (method === 'POST') {
        const body = JSON.parse(init.body);
        const list = Array.isArray(body) ? body : [body];
        const merge = (init.headers.Prefer || '').includes('merge-duplicates');
        const onConflict = u.searchParams.get('on_conflict');
        const out = [];
        for (const row of list) {
          const err = checkCols(table, Object.keys(row));
          if (err) return fail(400, err);
          const full = defaults(table, row);
          let clash = uniqueClash(table, full);
          // PostgREST merges only on the on_conflict columns; any other
          // unique clash is still an error.
          if (clash && merge && onConflict && clash.key.map((k) => k.split(':')[0]).join(',') !== onConflict) {
            return fail(409, `duplicate key value violates unique constraint (${clash.key.join(',')})`);
          }
          if (clash) {
            if (!merge) return fail(409, `duplicate key value violates unique constraint (${clash.key.join(',')})`);
            const next = { ...clash.hit, ...row };
            const other = uniqueClash(table, next, clash.hit);
            if (other) return fail(409, `duplicate key value violates unique constraint (${other.key.join(',')})`);
            Object.assign(clash.hit, row);
            out.push(clash.hit);
          } else { db[table].push(full); out.push(full); }
        }
        return ok(out.map((r) => ({ ...r })), 201);
      }
      if (method === 'PATCH') {
        const changes = JSON.parse(init.body);
        const err = checkCols(table, Object.keys(changes));
        if (err) return fail(400, err);
        if (table === 'core.audit_log') return fail(403, 'core.audit_log is append-only');
        const { rows } = filterRows(table, params, []);
        for (const r of rows) {
          const next = { ...r, ...changes };
          const clash = uniqueClash(table, next, r);
          if (clash) return fail(409, 'duplicate key value violates unique constraint');
        }
        for (const r of rows) Object.assign(r, changes, schema[table].includes('updated_at') ? { updated_at: new Date(Date.now() + 1).toISOString() } : {});
        return ok(rows.map((r) => ({ ...r })));
      }
      if (method === 'DELETE') {
        if (table === 'core.audit_log') return fail(403, 'core.audit_log is append-only');
        const { rows } = filterRows(table, params, []);
        db[table] = db[table].filter((r) => !rows.includes(r));
        return ok(rows);
      }
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
    return fail(405, 'method');
  }

  async function fetchImpl(url, init = {}) {
    const href = String(url);
    if (href.startsWith('https://fake.supabase.test/rest/v1/')) return rest(href, { ...init, headers: init.headers || {} });
    if (href.startsWith('https://api.resend.com/')) {
      sent.emails.push(JSON.parse(init.body));
      return resend ? resend(init) : new Response('{"id":"x"}', { status: 200 });
    }
    if (href.startsWith('https://generativelanguage.googleapis.com/')) {
      sent.gemini.push({ url: href, init });
      return gemini ? gemini(href, init) : new Response('{}', { status: 500 });
    }
    if (href.startsWith('https://api.clickup.com/')) {
      if (!clickup) throw new Error('unexpected ClickUp call in test');
      return clickup.handle(href, init);
    }
    throw new Error(`unexpected network call in test: ${href}`);
  }

  return { db, sent, fetch: fetchImpl, schema, clickup };
}

/** Sets the env, installs the fake as global fetch. */
export function install(backend, env = {}) {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://fake.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    RESEND_API_KEY: 'test-resend',
    FROM_EMAIL: 'Test <test@example.com>',
    FRONTROW_URL: 'https://frontrow.test',
    ...env
  });
  globalThis.fetch = backend.fetch;
}

export function call(handler, path, { method = 'GET', body, cookie, origin, host = 'app.test', ip = '203.0.113.9', headers = {} } = {}) {
  const h = { host, 'user-agent': 'node-test', 'x-forwarded-for': ip, ...headers };
  if (cookie) h.cookie = cookie;
  if (origin) h.origin = origin;
  if (body !== undefined) h['content-type'] = 'application/json';
  return handler.fetch(new Request(`https://${host}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
}

/* ---------- ClickUp task builders for tests ---------- */

export const CU = {
  contactsList: '901710477009',
  accountsList: '901710481777',
  f: {
    email: '7e3e1cac-80c3-4424-988c-e66c89b44fe5', first: 'e9a9e94c-88c0-423b-a6db-05669ff5f967', last: '55530338-993f-4187-b1fe-e66254971d14',
    branch: '6623fa17-7220-4e17-8011-ee6a4a8fe2c7', subJtg: '20b50b13-180c-4d35-9b6d-e54d055d1393', status: 'c5315bbe-aada-489b-8efd-d48f75cda9d5'
  },
  account(id, name, { status = 'active', branch = 'JTG', sub = null, contacts = [] } = {}) {
    const statuses = ['active', 'inactive', 'under review', 'pre-deal', 'onboarding cue'];
    return {
      id, name, list: { id: CU.accountsList },
      custom_fields: [
        { id: CU.f.status, type: 'drop_down', value: statuses.indexOf(status), type_config: { options: statuses.map((n, i) => ({ id: `st-${i}`, name: n, orderindex: i })) } },
        { id: CU.f.branch, type: 'labels', value: [`br-${branch}`], type_config: { options: ['JTG', 'UNY', 'MCO', 'MKC SA'].map((l) => ({ id: `br-${l}`, label: l })) } },
        ...(sub ? [{ id: CU.f.subJtg, type: 'drop_down', value: 0, type_config: { options: [{ id: 'sb-0', name: sub, orderindex: 0 }] } }] : []),
        { id: 'rel-acc-contacts', name: 'Contacts', type: 'list_relationship', value: contacts.map((c) => ({ id: c })) }
      ]
    };
  },
  contact(id, name, email, { accounts = [] } = {}) {
    const [first, ...rest] = name.split(' ');
    return {
      id, name, list: { id: CU.contactsList },
      custom_fields: [
        { id: CU.f.email, type: 'email', value: email },
        { id: CU.f.first, type: 'short_text', value: first },
        { id: CU.f.last, type: 'short_text', value: rest.join(' ') },
        { id: 'rel-con-accounts', name: 'Related Accounts', type: 'list_relationship', value: accounts.map((a) => ({ id: a })) }
      ]
    };
  }
};

/* ---------- organizations and branches as the migration seeds them ---------- */

export const ORG_IDS = {
  jtg: '0a000000-0000-4000-8000-000000000001',
  mco: '0a000000-0000-4000-8000-000000000002',
  uny: '0a000000-0000-4000-8000-000000000003',
  mkc: '0a000000-0000-4000-8000-000000000004'
};
export const BRANCH_IDS = { f5: '0b000000-0000-4000-8000-000000000001', bms: '0b000000-0000-4000-8000-000000000002', anvil: '0b000000-0000-4000-8000-000000000003' };

export function seedOrganizations() {
  return {
    'frontrow.organizations': [
      { id: ORG_IDS.jtg, slug: 'jtg', name: 'Jump Tech Group', clickup_label: 'JTG', custom_domain: null, active: true,
        branding: { accent: '#2E3192', ink: '#16185A', highlight: '#00AEEF', font: 'jtg', logo: '/assets/orgs/jtg/logo.png', logo_on_dark: '/assets/orgs/jtg/logo-light.png', icon: '/assets/orgs/jtg', home_url: 'https://j-tgroup.com/', tagline: 'One group. Twelve specialist teams.' } },
      { id: ORG_IDS.mco, slug: 'mco', name: 'MCO', clickup_label: 'MCO', custom_domain: null, active: true, branding: { accent: '#1F3A5F', ink: '#14243A', icon: '/assets/orgs/mco' } },
      { id: ORG_IDS.uny, slug: 'uny', name: 'UNY', clickup_label: 'UNY', custom_domain: null, active: true, branding: {} },
      { id: ORG_IDS.mkc, slug: 'mkc', name: 'MKC', clickup_label: 'MKC SA', custom_domain: null, active: true, branding: {} }
    ],
    'frontrow.branches': [
      { id: BRANCH_IDS.f5, organization_id: ORG_IDS.jtg, name: 'Fortune 5 Agency', clickup_value: 'F5', logo: '/assets/brands/f5.png', tile: 'light', sort: 10, active: true },
      { id: BRANCH_IDS.bms, organization_id: ORG_IDS.jtg, name: 'Build My Start-Up', clickup_value: 'BMS', logo: '/assets/brands/bms.png', tile: 'light', sort: 20, active: true },
      { id: BRANCH_IDS.anvil, organization_id: ORG_IDS.mco, name: 'Anvil', clickup_value: 'Anvil', logo: null, tile: 'light', sort: 20, active: true }
    ]
  };
}
