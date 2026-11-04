/* ClickUp, as Frontrow uses it. Shared by Frontrow and Frontrow Manager
 * (each Vercel project deploys from its own folder, so this file is copied;
 * a test fails if the copies drift).
 *
 * ClickUp is the source of truth for who may use Frontrow:
 *   - an Accounts-list task is a company; its "Account Status" dropdown
 *     decides whether it is active, its "Branch" label the organization and
 *     its "Sub-Branch" the branch;
 *   - a Contacts-list task is a person; "Primary Email" is their sign-in;
 *   - contacts and accounts are linked by ClickUp relationship fields
 *     (either side may hold the link — both are read).
 *
 * The IDs below are the ones the MKC CRM already uses (mkc-crm/index.html,
 * CU_FIELDS / BRANCH_UUIDS). They are not secrets; each can be overridden by
 * an env var if a list or field is ever replaced.
 */

const API = 'https://api.clickup.com/api/v2';

export function clickupConfig(env = process.env) {
  return {
    token: env.CLICKUP_API_TOKEN || '',
    lists: {
      contacts: env.CLICKUP_LIST_CONTACTS || '901710477009',
      accounts: env.CLICKUP_LIST_ACCOUNTS || '901710481777'
    },
    fields: {
      primaryEmail: env.CLICKUP_FIELD_PRIMARY_EMAIL || '7e3e1cac-80c3-4424-988c-e66c89b44fe5',
      email2: env.CLICKUP_FIELD_EMAIL_2 || '23f99b05-2a6d-4fa6-b40d-d3be89b892ce',
      firstName: env.CLICKUP_FIELD_FIRST_NAME || 'e9a9e94c-88c0-423b-a6db-05669ff5f967',
      lastName: env.CLICKUP_FIELD_LAST_NAME || '55530338-993f-4187-b1fe-e66254971d14',
      branch: env.CLICKUP_FIELD_BRANCH || '6623fa17-7220-4e17-8011-ee6a4a8fe2c7',
      subBranches: (env.CLICKUP_FIELD_SUB_BRANCHES || '20b50b13-180c-4d35-9b6d-e54d055d1393,b9b66ef7-08e1-405f-b3ca-6c2bcc93ed46').split(','),
      accountStatus: env.CLICKUP_FIELD_ACCOUNT_STATUS || 'c5315bbe-aada-489b-8efd-d48f75cda9d5'
    },
    // Label option ids of the "Branch" field, used when creating a contact.
    branchLabelIds: {
      'JTG': 'a842dfdd-2da9-4a0c-8c8f-eb27543d598d',
      'UNY': '3bf70234-24f3-47b4-99a7-6fe33287aa6b',
      'MCO': 'c919face-ad76-4489-b76c-6433fd574dfc',
      'MKC SA': 'bdcde1f5-8652-4512-9dfe-933e0663c9cb'
    },
    activeStatuses: (env.CLICKUP_ACTIVE_STATUSES || 'active').split(',').map((s) => s.trim().toLowerCase()),
    workspaceUrl: 'https://app.clickup.com/t/'
  };
}

export const clickupAvailable = (env = process.env) => Boolean(env.CLICKUP_API_TOKEN);

/** One ClickUp call. Retries once on a rate limit, honouring Retry-After. */
export async function cu(path, { method = 'GET', body, env = process.env, fetchImpl = fetch } = {}) {
  const token = env.CLICKUP_API_TOKEN;
  if (!token) throw Object.assign(new Error('ClickUp is not connected (CLICKUP_API_TOKEN is not set).'), { status: 503, code: 'clickup_off' });
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 2, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`ClickUp ${res.status}: ${text.slice(0, 200)}`), { status: res.status, body: text });
    return text ? JSON.parse(text) : null;
  }
  throw Object.assign(new Error('ClickUp is busy. Try again in a minute.'), { status: 429 });
}

export const getTask = (id, opts) => cu(`/task/${encodeURIComponent(id)}`, opts);

/** Every task in a list (open and closed), 100 per page. */
export async function listTasks(listId, opts = {}) {
  const all = [];
  for (let page = 0; page < 60; page++) {
    const data = await cu(`/list/${encodeURIComponent(listId)}/task?page=${page}&include_closed=true&subtasks=false&archived=false`, opts);
    const tasks = (data && data.tasks) || [];
    all.push(...tasks);
    if (data && data.last_page === false) continue;
    if (tasks.length < 100 || (data && data.last_page)) break;
  }
  return all;
}

/* ---------- reading custom fields ---------- */

const field = (task, id) => (task.custom_fields || []).find((f) => f.id === id);

/** Dropdown value → option name. ClickUp reports the value as the option's
 *  orderindex or its id depending on endpoint; both are handled. */
export function dropdownName(f) {
  if (!f || f.value === undefined || f.value === null || f.value === '') return '';
  const opts = (f.type_config && f.type_config.options) || [];
  const hit = opts.find((o) => o.id === f.value || String(o.orderindex) === String(f.value));
  return hit ? String(hit.name || hit.label || '') : '';
}

export function labelNames(f) {
  if (!f || !Array.isArray(f.value)) return [];
  const opts = (f.type_config && f.type_config.options) || [];
  return f.value.map((v) => {
    const id = typeof v === 'object' && v ? v.id : v;
    const hit = opts.find((o) => o.id === id);
    return hit ? String(hit.label || hit.name || '') : '';
  }).filter(Boolean);
}

/** Ids of tasks referenced by the task's relationship fields. */
export function relatedIds(task) {
  const ids = new Set();
  for (const f of task.custom_fields || []) {
    if (!['list_relationship', 'relationship', 'tasks'].includes(f.type) || !Array.isArray(f.value)) continue;
    for (const v of f.value) if (v && v.id) ids.add(String(v.id));
  }
  return [...ids];
}

const textValue = (f) => (f && typeof f.value === 'string' ? f.value.trim() : '');

export function readAccount(task, cfg = clickupConfig()) {
  const status = dropdownName(field(task, cfg.fields.accountStatus)).toLowerCase();
  const sub = cfg.fields.subBranches.map((id) => dropdownName(field(task, id))).find(Boolean) || '';
  return {
    clickupId: String(task.id),
    name: String(task.name || '').trim().slice(0, 200) || 'Unnamed account',
    status,
    active: cfg.activeStatuses.includes(status),
    orgLabels: labelNames(field(task, cfg.fields.branch)),
    subBranch: sub,
    contactIds: relatedIds(task)
  };
}

export function readContact(task, cfg = clickupConfig()) {
  const email = (textValue(field(task, cfg.fields.primaryEmail)) || textValue(field(task, cfg.fields.email2))).toLowerCase();
  const first = textValue(field(task, cfg.fields.firstName));
  const last = textValue(field(task, cfg.fields.lastName));
  return {
    clickupId: String(task.id),
    name: ([first, last].filter(Boolean).join(' ') || String(task.name || '')).trim().slice(0, 120),
    // Plain addresses only: no commas, quotes or brackets, which would also
    // break PostgREST in.(…) filters.
    email: /^[^\s@,()"]+@[^\s@,()"]+\.[^\s@,()"]{2,}$/.test(email) ? email : '',
    orgLabels: labelNames(field(task, cfg.fields.branch)),
    accountIds: relatedIds(task),
    listId: task.list && task.list.id ? String(task.list.id) : ''
  };
}

/* ---------- writing ---------- */

/** Posts a comment on a task. Never throws: a CRM note must not break sign-in. */
export async function comment(taskId, text, opts = {}) {
  if (!taskId || !clickupAvailable(opts.env)) return false;
  try {
    await cu(`/task/${encodeURIComponent(taskId)}/comment`, { ...opts, method: 'POST', body: { comment_text: text, notify_all: false } });
    return true;
  } catch (e) {
    console.error('clickup comment failed', taskId, e.message);
    return false;
  }
}

/** Creates a contact entry in the ClickUp Contacts list. Returns its id. */
export async function createContact({ name, email, orgLabel }, opts = {}) {
  const cfg = clickupConfig(opts.env);
  const [first, ...rest] = String(name || '').trim().split(/\s+/);
  const custom = [{ id: cfg.fields.primaryEmail, value: email }];
  if (first) custom.push({ id: cfg.fields.firstName, value: first });
  if (rest.length) custom.push({ id: cfg.fields.lastName, value: rest.join(' ') });
  if (orgLabel && cfg.branchLabelIds[orgLabel]) custom.push({ id: cfg.fields.branch, value: [cfg.branchLabelIds[orgLabel]] });
  const task = await cu(`/list/${cfg.lists.contacts}/task`, {
    ...opts, method: 'POST',
    body: { name: String(name || email).slice(0, 200), custom_fields: custom }
  });
  return String(task.id);
}

/** Links a contact task to an account task through the contact's first
 *  relationship field that points at accounts. Best effort: returns false
 *  when there is no such field or ClickUp refuses. */
export async function relateContactToAccount(contactTaskId, accountTaskId, opts = {}) {
  try {
    const task = await getTask(contactTaskId, opts);
    const rel = (task.custom_fields || []).find((f) => f.type === 'list_relationship' && /account|compan/i.test(f.name || ''))
      || (task.custom_fields || []).find((f) => f.type === 'list_relationship');
    if (!rel) return false;
    await cu(`/task/${encodeURIComponent(contactTaskId)}/field/${rel.id}`, { ...opts, method: 'POST', body: { value: { add: [accountTaskId], rem: [] } } });
    return true;
  } catch (e) {
    console.error('clickup relate failed', contactTaskId, accountTaskId, e.message);
    return false;
  }
}

export const taskUrl = (id) => `https://app.clickup.com/t/${encodeURIComponent(id)}`;
