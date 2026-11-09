// api/_lib/systeme.ts
//
// Systeme.io, Jump Tech Group sub-account. Adds or updates the contact,
// makes sure their brand · action tag exists, tags them, and records a
// plain-language "Last action" on the contact.
//
// SYSTEME_API_KEY must be a key created INSIDE the Jump Tech Group
// sub-account. A main-account key would tag into the wrong workspace, so
// treat a 401/403 as "wrong or missing key", never retry it blindly.
//
// Everything here is best effort from the caller's point of view: it
// returns a result object and never throws past runSysteme().

const BASE = 'https://api.systeme.io/api';
const LAST_ACTION = { slug: 'last_action', name: 'Last action' };

type Person = { email: string; firstName?: string; lastName?: string; phone?: string; company?: string; website?: string };

export type SystemeResult = { ok: boolean; contactId?: number | string; created?: boolean; tag?: string; lastAction?: string; error?: string };

class SystemeError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function call(key: string, method: string, path: string, body?: unknown, contentType = 'application/json') {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'X-API-Key': key.trim(), Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': contentType } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 2, 5);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new SystemeError(`Systeme ${method} ${path.split('?')[0]} returned ${res.status}: ${text.slice(0, 200)}`, res.status);
    return text ? JSON.parse(text) : null;
  }
  throw new SystemeError('Systeme rate limit: gave up after retries', 429);
}

async function listAll(key: string, path: string, max = 20): Promise<any[]> {
  const out: any[] = [];
  let after = '';
  for (let page = 0; page < max; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await call(key, 'GET', `${path}${sep}limit=100${after ? `&startingAfter=${after}` : ''}`);
    const items = Array.isArray(data) ? data : data?.items || [];
    out.push(...items);
    if (!data?.hasMore || !items.length) break;
    after = String(items[items.length - 1].id);
  }
  return out;
}

export async function ensureTag(key: string, name: string): Promise<{ id: number | string; name: string }> {
  const tags = await listAll(key, '/tags');
  const found = tags.find((t) => String(t.name).trim().toLowerCase() === name.toLowerCase());
  if (found) return found;
  return call(key, 'POST', '/tags', { name });
}

// "Last action" is a custom contact field, created on first use, so every
// tagged contact carries a sentence explaining what they did.
// Returns null when the field is ready, or why it isn't. The contact and
// tag matter more than this field, so a failure here is reported, not thrown.
async function ensureLastActionField(key: string): Promise<string | null> {
  try {
    const fields = await listAll(key, '/contact_fields', 3);
    if (fields.some((f) => f.slug === LAST_ACTION.slug)) return null;
    await call(key, 'POST', '/contact_fields', { fieldName: LAST_ACTION.name, slug: LAST_ACTION.slug });
    return null;
  } catch (e: any) {
    return e?.message || 'could not create the field';
  }
}

async function findContact(key: string, email: string) {
  const data = await call(key, 'GET', `/contacts?email=${encodeURIComponent(email)}&limit=10`);
  const items = Array.isArray(data) ? data : data?.items || [];
  return items.find((c: any) => String(c.email || '').toLowerCase() === email) || null;
}

function fieldList(p: Person, lastAction: string | null, existing?: any) {
  const have = new Map<string, string>();
  for (const f of existing?.fields || []) if (f?.slug) have.set(f.slug, String(f.value ?? ''));
  const out: Array<{ slug: string; value: string }> = [];
  // Fill blanks only: never overwrite what someone typed in Systeme.io.
  const fill = (slug: string, value?: string) => { if (value && !have.get(slug)) out.push({ slug, value }); };
  fill('first_name', p.firstName);
  fill('surname', p.lastName);
  fill('phone_number', p.phone);
  fill('company_name', p.company);
  fill('website', p.website);
  if (lastAction) out.push({ slug: LAST_ACTION.slug, value: lastAction.slice(0, 255) });
  return out;
}

export async function runSysteme(input: { person: Person; tag: string; lastAction: string }): Promise<SystemeResult> {
  const key = process.env.SYSTEME_API_KEY || '';
  if (!key.trim()) return { ok: false, error: 'SYSTEME_API_KEY is not set on the CRM project.' };
  const email = (input.person.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'No email address, so nothing to add to Systeme.io.' };

  try {
    const [tag, fieldError] = await Promise.all([ensureTag(key, input.tag), ensureLastActionField(key)]);
    const lastAction = fieldError ? null : input.lastAction;

    let contact = await findContact(key, email);
    let created = false;
    if (!contact) {
      try {
        contact = await call(key, 'POST', '/contacts', { email, locale: 'en', fields: fieldList(input.person, lastAction) });
        created = true;
      } catch (e: any) {
        // Created by a parallel request a moment ago: look it up again.
        if (e?.status !== 422) throw e;
        contact = await findContact(key, email);
        if (!contact) throw e;
      }
    }
    if (!created) {
      const fields = fieldList(input.person, lastAction, contact);
      if (fields.length) await call(key, 'PATCH', `/contacts/${contact.id}`, { fields }, 'application/merge-patch+json');
    }

    const hasTag = (contact.tags || []).some((t: any) => String(t.id) === String(tag.id));
    if (!hasTag) {
      try {
        await call(key, 'POST', `/contacts/${contact.id}/tags`, { tagId: tag.id });
      } catch (e: any) {
        if (e?.status !== 422) throw e; // 422 = already tagged
      }
    }
    return { ok: true, contactId: contact.id, created, tag: tag.name, lastAction: fieldError ? `not written: ${fieldError}` : 'written' };
  } catch (e: any) {
    const status = e?.status;
    const hint = status === 401 || status === 403 ? ' Check SYSTEME_API_KEY is a Jump Tech Group sub-account key.' : '';
    return { ok: false, error: `${e?.message || 'Systeme.io request failed'}${hint}` };
  }
}
