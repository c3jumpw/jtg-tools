// Kept in step with frontrow-manager/lib/core.js (same helpers; each Vercel
// project deploys from its own folder, so the file is copied, not shared).
// Talks to the MKC-Admin Supabase project over REST + RPC.
// Same helper as mkc/admin and mkc/booking: raw fetch (no @supabase/supabase-js)
// to keep cold starts small, and every call goes through the service-role key.
// The `frontrow` schema grants nothing to anon/authenticated, so this server is
// the only way in; access control lives in lib/access.js, not in the browser.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireEnv() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    const missing = [!SUPABASE_URL && 'SUPABASE_URL', !SUPABASE_KEY && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean).join(', ');
    throw new Error(`Frontrow backend is not fully configured (missing ${missing}). Set the env vars in Vercel and redeploy.`);
  }
}

async function req(path, init) {
  requireEnv();
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init && init.headers)
    }
  });
  const text = await res.text();
  if (!res.ok) {
    const body = text.slice(0, 400);
    throw Object.assign(new Error(`Supabase ${res.status}: ${body}`), { status: res.status, body });
  }
  return text ? JSON.parse(text) : null;
}

export function insert(schema, table, rows, { onConflict } = {}) {
  const q = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  return req(`/rest/v1/${table}${q}`, {
    method: 'POST',
    body: JSON.stringify(rows),
    headers: {
      'Content-Profile': schema, 'Accept-Profile': schema,
      Prefer: onConflict ? 'return=representation,resolution=merge-duplicates' : 'return=representation'
    }
  });
}

export function patch(schema, table, filter, changes) {
  return req(`/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
    headers: { 'Content-Profile': schema, 'Accept-Profile': schema, Prefer: 'return=representation' }
  });
}

export function remove(schema, table, filter) {
  return req(`/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: { 'Content-Profile': schema, 'Accept-Profile': schema, Prefer: 'return=representation' }
  });
}

export function select(schema, table, query = '') {
  return req(`/rest/v1/${table}${query ? '?' + query : ''}`, {
    method: 'GET',
    headers: { 'Accept-Profile': schema }
  });
}

/* ---------- validation + reply helpers ---------- */

const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export function clean(v, max) {
  return typeof v === 'string' ? v.replace(CTRL, '').trim().slice(0, max) : '';
}
/** Like clean() but keeps newlines and tabs and does not trim inner layout. */
export function cleanBlock(v, max) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max) : '';
}
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Case-insensitive EXACT email match for PostgREST.
 * Plain ilike treats _ and % as wildcards (and PostgREST turns * into %), so
 * `ilike.j_hn@x.com` also matches john@x.com — an access check built on it
 * can hand one person another's role. Escape the LIKE wildcards here, and
 * always re-check rows with sameEmail(), which also covers `*`. */
export function emailFilter(email, column = 'email') {
  const escaped = String(email || '').toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c);
  return `${column}=ilike.${encodeURIComponent(escaped)}`;
}
export const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }
  });
}

// Same-origin check: browsers get one policy; direct API calls (curl, tests) pass.
export function originAllowed(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  let host = '';
  try { host = new URL(origin).host; } catch { return false; }
  if (host === (request.headers.get('host') || new URL(request.url).host)) return true;
  return (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).includes(origin);
}

/* Per-instance, in-memory limits: a speed bump, not a guarantee (each
 * serverless instance counts on its own). When the map grows, the oldest
 * keys are evicted — never all of them at once, which would let a flood of
 * new keys reset everyone's counters. */
const hits = new Map();
export function rateLimited(key, max, windowMs, now = Date.now()) {
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.delete(key);
  hits.set(key, list); // re-insert so Map order is least-recently-used first
  if (hits.size > 5000) {
    let drop = hits.size - 4000;
    for (const k of hits.keys()) { if (drop-- <= 0) break; hits.delete(k); }
  }
  return list.length > max;
}

/** Waits until at least `ms` have passed since `started`, so a route's
 *  response time doesn't reveal which branch it took (e.g. known email or not). */
export async function atLeast(ms, started) {
  const left = ms - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

export function clientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    request.headers.get('x-real-ip') || 'unknown';
}

export async function readJson(request, maxChars = 100000) {
  const text = await request.text();
  if (text.length > maxChars) return { error: json(413, { error: 'That request is too large.' }) };
  try { return { body: JSON.parse(text || '{}') }; } catch { return { error: json(400, { error: 'Bad request.' }) }; }
}

/** Wraps a handler so a thrown Response is returned and anything else becomes a logged 500. */
export function route(handler) {
  return {
    async fetch(request) {
      try {
        return await handler(request);
      } catch (e) {
        if (e instanceof Response) return e;
        console.error('frontrow route failed', e && e.message);
        return json(500, { error: 'Something went wrong on our side. Please try again.' });
      }
    }
  };
}
