// api/_lib/clickup.ts
//
// ClickUp helpers for intake endpoints: find the person across the CRM's
// four lists, create a Lead when they're new, fill the CRM's custom fields,
// and log what they did as a comment that is safe to retry.
//
// Matching mirrors api/booking-created.ts (and the CRM's own lookup map):
// every string field is scanned for emails and phone numbers, and a
// Contact beats an older Lead for the same person.
//
// ── CUSTOM FIELDS ─────────────────────────────────────────────────────
// Field IDs are the ones mkc-crm/index.html uses (CU_FIELDS). Each write
// is checked against the fields actually present on that record's list
// (GET /task returns them with their options), so a field a list doesn't
// have is skipped and reported, never written blindly.
//
// Rules, so an automated intake never tramples a rep's work:
//   fill   -> only when the field is empty
//   add    -> label fields: add our label, keep the ones already there
//   always -> Recent Opt-In Action, which by definition is the latest

import type { Action, Brand } from './activities';

export const CU_BASE = 'https://api.clickup.com/api/v2';

export const LISTS = {
  accounts: '901710481777',
  pipeline: '901710326878',
  leads: '901710477809',
  contacts: '901710477009',
} as const;
type ListKey = keyof typeof LISTS;
const RESOLVE_ORDER: ListKey[] = ['accounts', 'pipeline', 'leads', 'contacts'];
const TYPE_LABEL: Record<ListKey, string> = { leads: 'Lead', contacts: 'Contact', pipeline: 'Deal', accounts: 'Account' };

export const F = {
  FIRST_NAME: 'e9a9e94c-88c0-423b-a6db-05669ff5f967',
  LAST_NAME: '55530338-993f-4187-b1fe-e66254971d14',
  PRIMARY_EMAIL: '7e3e1cac-80c3-4424-988c-e66c89b44fe5',
  EMAIL_2: '23f99b05-2a6d-4fa6-b40d-d3be89b892ce',
  PHONE: 'd41f3e8a-c719-4de5-b5d6-00ac496a5e60',
  PHONE_2: '7f7107e4-ec23-4c7e-b8f1-2e0ed8912b2b',
  TITLE: '47f8a29f-1850-4851-b1ca-86994c5c499a',
  COMPANY_NAME: '73785f38-2d0b-424f-b45f-a42d0cd532d0',
  LOCATION: '6b94af83-3a8e-40e3-80ec-fe6fba248079',
  FACEBOOK: '199510c9-56ac-43e3-8657-34d71cc95b47',
  INSTAGRAM: 'c7ab6a88-ecd1-4ff2-b5c3-9fac6d17f73b',
  TIKTOK: 'dbe416b4-f966-489b-998f-dbd9f870641c',
  OTHER_SOCIAL: 'f367ef68-a8b9-40f0-99d5-c4a11d869ca1',
  BRANCH: '6623fa17-7220-4e17-8011-ee6a4a8fe2c7',
  SUB_BRANCH_JTG: '20b50b13-180c-4d35-9b6d-e54d055d1393',
  LEAD_CONTACT_TYPE: '1d69cb4f-928e-4dcb-bf6e-1519519140b4',
  LEAD_SOURCE: '44476ae7-636f-4d0f-973d-3dfe89b6ea80',
  LEAD_SOURCE_NOTES: 'b37db85c-d6a6-4541-b1bc-525b32c2ee7e',
  RECENT_OPTIN: '038eb48b-ffec-49ca-8a16-f5beecd19bff',
  NEXT_ACTION_DATE: '8865a284-7e78-4328-9d3a-c01e2cbfd8c2',
} as const;

export type Person = {
  email?: string; phone?: string; firstName?: string; lastName?: string;
  company?: string; title?: string; website?: string; location?: string;
};
export type Entry = { id: string; type: string; name: string };

function cuAuthHeader(token: string): string {
  const t = String(token || '').trim();
  return t.startsWith('pk_') ? t : `Bearer ${t}`; // see booking-created.ts for why
}
export function cuHeaders(token: string) {
  return { Authorization: cuAuthHeader(token), 'Content-Type': 'application/json' };
}

export function phoneKey(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits.slice(-10);
}
export function phoneForClickUp(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length < 10) return digits;
  return '+1' + digits.slice(-10);
}

async function fetchList(token: string, listId: string): Promise<any[]> {
  const out: any[] = [];
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`${CU_BASE}/list/${listId}/task?page=${page}&subtasks=false&include_closed=true`, { headers: cuHeaders(token) });
    if (!res.ok) throw new Error(`ClickUp list ${listId} returned ${res.status}`);
    const data = await res.json();
    const tasks = data.tasks || [];
    out.push(...tasks);
    if (tasks.length < 100 || data.last_page) break;
  }
  return out;
}

export async function resolveEntry(token: string, email: string, phone: string): Promise<Entry | null> {
  // The four lists are fetched in parallel; the priority order is applied after.
  const lists = await Promise.all(RESOLVE_ORDER.map((k) => fetchList(token, LISTS[k])));
  const byPhone = new Map<string, Entry>();
  const byEmail = new Map<string, Entry>();
  RESOLVE_ORDER.forEach((key, i) => {
    for (const t of lists[i]) {
      if (t.parent) continue;
      const entry = { id: t.id, type: TYPE_LABEL[key], name: t.name || '' };
      for (const f of t.custom_fields || []) {
        const v = f?.value;
        if (typeof v !== 'string' || !v) continue;
        if ((f.name || '').toLowerCase().includes('email')) {
          const e = v.toLowerCase().trim();
          if (e.includes('@')) byEmail.set(e, entry);
          continue;
        }
        if (v.length > 50 || /[a-zA-Z]/.test(v)) continue;
        const k = phoneKey(v);
        if (k) byPhone.set(k, entry);
      }
    }
  });
  const e = (email || '').toLowerCase().trim();
  if (e && byEmail.has(e)) return byEmail.get(e)!;
  const pk = phoneKey(phone || '');
  if (pk && byPhone.has(pk)) return byPhone.get(pk)!;
  return null;
}

export async function createLead(token: string, person: Person, description: string): Promise<Entry> {
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ') || person.email || person.phone || 'Unknown';
  const res = await fetch(`${CU_BASE}/list/${LISTS.leads}/task`, {
    method: 'POST',
    headers: cuHeaders(token),
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) throw new Error(`Could not create Lead in ClickUp (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const task = await res.json();
  return { id: task.id, type: 'Lead', name };
}

// ── activity comments, retry-safe ────────────────────────────────────
export function marker(ref: string, action: string) {
  return `[activity-ref:${ref}|${action}]`;
}
export async function findMarker(token: string, taskId: string, ref: string): Promise<string | null> {
  try {
    const res = await fetch(`${CU_BASE}/task/${taskId}/comment`, { headers: cuHeaders(token) });
    if (!res.ok) return null;
    const data = await res.json();
    for (const c of data.comments || []) {
      const text = c.comment_text || '';
      for (const a of ['created', 'matched']) if (text.includes(marker(ref, a))) return a;
    }
  } catch { /* treat as not found */ }
  return null;
}
export async function addComment(token: string, taskId: string, text: string) {
  const res = await fetch(`${CU_BASE}/task/${taskId}/comment`, {
    method: 'POST',
    headers: cuHeaders(token),
    body: JSON.stringify({ comment_text: text, notify_all: false }),
  });
  if (!res.ok) throw new Error(`comment failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

// ── custom fields ────────────────────────────────────────────────────
function socialField(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('instagram.com')) return F.INSTAGRAM;
  if (u.includes('facebook.com') || u.includes('fb.com')) return F.FACEBOOK;
  if (u.includes('tiktok.com')) return F.TIKTOK;
  return F.OTHER_SOCIAL;
}

function isEmpty(v: unknown): boolean {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0);
}

function optionId(field: any, want: string): string | null {
  const opts: any[] = field?.type_config?.options || [];
  const w = want.toLowerCase();
  const name = (o: any) => String(o.label ?? o.name ?? '').toLowerCase().trim();
  const hit =
    opts.find((o) => name(o) === w) ||
    // ClickUp spells one Lead Source option "Inquriy"; accept any spelling of inquiry.
    (w === 'inquiry' ? opts.find((o) => name(o).startsWith('inq')) : null) ||
    (w === 'opted-in' ? opts.find((o) => name(o).replace(/[^a-z]/g, '') === 'optedin') : null);
  return hit ? String(hit.id) : null;
}

async function writeField(token: string, taskId: string, field: any, value: unknown): Promise<boolean> {
  const payload: Record<string, unknown> = { value };
  if (field.type === 'date') payload.value_options = { time: false };
  const res = await fetch(`${CU_BASE}/task/${taskId}/field/${field.id}`, {
    method: 'POST',
    headers: cuHeaders(token),
    body: JSON.stringify(payload),
  });
  if (res.ok) return true;
  const body = await res.text();
  return body.includes('FIELD_115'); // not on this list: nothing lost
}

export type FieldReport = { set: string[]; skipped: string[]; failed: string[] };

export async function applyActivityFields(
  token: string,
  entry: Entry,
  ctx: { person: Person; brand: Brand; action: Action; tag: string; notes: string; when: Date }
): Promise<FieldReport> {
  const report: FieldReport = { set: [], skipped: [], failed: [] };
  const res = await fetch(`${CU_BASE}/task/${entry.id}`, { headers: cuHeaders(token) });
  if (!res.ok) { report.failed.push(`read record (${res.status})`); return report; }
  const task = await res.json();
  const fields = new Map<string, any>((task.custom_fields || []).map((f: any) => [f.id, f]));
  const p = ctx.person;

  const jobs: Array<[string, string, unknown]> = []; // [label, fieldId, value]
  const fill = (label: string, id: string, value: unknown) => {
    const f = fields.get(id);
    if (!f) { if (!isEmpty(value)) report.skipped.push(label); return; }
    if (isEmpty(value) || !isEmpty(f.value)) return;
    jobs.push([label, id, value]);
  };
  const addLabel = (label: string, id: string, want: string) => {
    const f = fields.get(id);
    if (!f) { report.skipped.push(label); return; }
    const opt = optionId(f, want);
    if (!opt) { report.failed.push(`${label} (no "${want}" option)`); return; }
    const current: string[] = Array.isArray(f.value) ? f.value.map((v: any) => String(v?.id ?? v)) : [];
    if (current.includes(opt)) return;
    jobs.push([label, id, [...current, opt]]);
  };
  const fillLabel = (label: string, id: string, want: string) => {
    const f = fields.get(id);
    if (!f) { report.skipped.push(label); return; }
    if (!isEmpty(f.value)) return;
    const opt = optionId(f, want);
    if (!opt) { report.failed.push(`${label} (no "${want}" option)`); return; }
    jobs.push([label, id, [opt]]);
  };

  fill('First name', F.FIRST_NAME, p.firstName);
  fill('Last name', F.LAST_NAME, p.lastName);
  const primaryEmail = fields.get(F.PRIMARY_EMAIL)?.value;
  if (p.email && primaryEmail && String(primaryEmail).toLowerCase() !== p.email.toLowerCase()) fill('Email 2', F.EMAIL_2, p.email);
  else fill('Email', F.PRIMARY_EMAIL, p.email);
  const phone = phoneForClickUp(p.phone || '');
  const primaryPhone = fields.get(F.PHONE)?.value;
  if (phone && primaryPhone && phoneKey(String(primaryPhone)) !== phoneKey(phone)) fill('Phone 2', F.PHONE_2, phone);
  else fill('Phone', F.PHONE, phone);
  fill('Title', F.TITLE, p.title);
  fill('Company', F.COMPANY_NAME, p.company);
  fill('Location', F.LOCATION, p.location);
  if (p.website) fill('Website / social', socialField(p.website), p.website);

  addLabel('Branch', F.BRANCH, ctx.brand.branch);
  if (ctx.brand.subBranch) {
    const f = fields.get(F.SUB_BRANCH_JTG);
    if (!f) report.skipped.push('Sub-Branch');
    else if (isEmpty(f.value)) {
      const opt = optionId(f, ctx.brand.subBranch);
      if (opt) jobs.push(['Sub-Branch', F.SUB_BRANCH_JTG, opt]);
      else report.failed.push(`Sub-Branch (no "${ctx.brand.subBranch}" option)`);
    }
  }
  addLabel('Lead/Contact type', F.LEAD_CONTACT_TYPE, ctx.action.contactType);
  fillLabel('Lead source', F.LEAD_SOURCE, ctx.action.leadSource);
  fill('Lead source notes', F.LEAD_SOURCE_NOTES, ctx.notes);
  const stamp = ctx.when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  const optin = fields.get(F.RECENT_OPTIN);
  if (optin) jobs.push(['Recent opt-in action', F.RECENT_OPTIN, `${ctx.tag} (${stamp})`]);
  else report.skipped.push('Recent opt-in action');
  // A new inbound lead should land in "Needs you today", so give it a
  // next action date of today, unless someone has already scheduled one.
  fill('Next action date', F.NEXT_ACTION_DATE, ctx.when.getTime());

  for (const [label, id, value] of jobs) {
    const ok = await writeField(token, entry.id, fields.get(id), value).catch(() => false);
    (ok ? report.set : report.failed).push(label);
  }
  return report;
}
