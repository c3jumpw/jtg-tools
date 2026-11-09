// api/lead-activity.ts
//
// POST /api/lead-activity
//
// One intake for every JTG form (Fortune 5, Build My Startup, the branch
// sites, Party Designers). When someone takes an action, the form's own
// backend saves it first, then posts it here. This endpoint:
//
//   1. ClickUp CRM: finds the person (Contact > Lead > Deal > Account,
//      by email or phone) or creates a Lead, fills the CRM's custom fields
//      (see api/_lib/clickup.ts for the fill/add/always rules) and logs the
//      action as a comment on their record.
//   2. Systeme.io, Jump Tech Group sub-account: adds or updates the contact,
//      creates the "<BRAND> · <Action>" tag if it's new, tags them, and
//      writes a plain-language "Last action" on the contact.
//
// The two run in parallel and fail independently; the response says what
// happened to each so the caller can log it.
//
// GET /api/lead-activity?catalog=1 returns every tag with its descriptor
// (public: names and descriptions only).
//
// ── AUTH ──────────────────────────────────────────────────────────────
// X-Form-Secret must equal INTAKE_SECRET (the JTG sites' secret) or
// FORM_SECRET (the existing CRM secret). Compared in constant time; fails
// closed when neither is configured.
//
// ── IDEMPOTENCY ───────────────────────────────────────────────────────
// `ref` is the caller's id for this event (e.g. "pbb-<briefId>-s2"). As in
// booking-created, the CRM record is the ledger: the comment ends with
// [activity-ref:<ref>|<created|matched>] and a retry with the same ref
// replays the first answer instead of logging twice. Systeme.io steps are
// naturally repeatable (find-or-create, tag-if-missing).
//
// ── PAYLOAD ───────────────────────────────────────────────────────────
// {
//   ref: string,                       required, <= 120 chars
//   brand: "F5" | "BMS" | "F5CEO" | "PD" | "BB" | ... (see _lib/activities)
//   action: "booked_call" | "requested_time" | "discovery_form" | ...
//   person: { email, phone, firstName, lastName, company, title, website, location },
//   details?: [[label, value], ...]    shown in the CRM comment, max 25 rows
//   page?: string                       the page the form was on
// }
// Errors are always {"error": "<flat string>"}, matching booking-created.

import { ACTIONS, BRANDS, catalog, describe, tagName } from './_lib/activities';
import { addComment, applyActivityFields, createLead, findMarker, marker, resolveEntry } from './_lib/clickup';
import type { Entry, FieldReport, Person } from './_lib/clickup';
import { runSysteme } from './_lib/systeme';

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-form-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}
function errorResponse(message: string, status: number) {
  return jsonResponse({ error: String(message) }, status);
}
function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) : '');

function findBrand(raw: unknown) {
  const k = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return BRANDS[k] || Object.values(BRANDS).find((b) => b.code.replace(/[^A-Z0-9]/g, '') === k) || null;
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method === 'GET') {
    if (new URL(req.url).searchParams.get('catalog')) return jsonResponse({ tags: catalog() });
    return errorResponse('Use POST to record an activity, or GET ?catalog=1 for the tag guide.', 405);
  }
  if (req.method !== 'POST') return errorResponse('Only POST is supported.', 405);

  const secrets = [process.env.INTAKE_SECRET, process.env.FORM_SECRET].filter(Boolean) as string[];
  if (!secrets.length) return errorResponse('INTAKE_SECRET is not set on the server.', 500);
  const given = req.headers.get('x-form-secret') || '';
  if (!secrets.some((s) => safeEqual(given, s.trim()))) return errorResponse('Unauthorized.', 401);
  const token = process.env.CLICKUP_TOKEN || '';

  let body: any;
  try { body = await req.json(); } catch { return errorResponse('Request body was not valid JSON.', 400); }

  const action = ACTIONS[String(body?.action || '')];
  if (!action) return errorResponse(`Unknown action "${body?.action}".`, 400);
  const brand = findBrand(body?.brand);
  if (!brand) return errorResponse(`Unknown brand "${body?.brand}".`, 400);
  const ref = str(body?.ref, 120);
  if (!ref) return errorResponse('ref is required (it is what makes retries safe).', 400);

  const pin = body?.person || {};
  const person: Person = {
    email: str(pin.email, 200).toLowerCase(),
    phone: str(pin.phone, 40),
    firstName: str(pin.firstName, 80),
    lastName: str(pin.lastName, 80),
    company: str(pin.company, 160),
    title: str(pin.title, 120),
    website: str(pin.website, 300),
    location: str(pin.location, 120),
  };
  if (!person.firstName && !person.lastName && pin.name) {
    const parts = str(pin.name, 160).split(/\s+/);
    person.firstName = parts.shift() || '';
    person.lastName = parts.join(' ');
  }
  if (!person.email && !person.phone) return errorResponse('person.email or person.phone is required.', 400);
  if (person.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)) return errorResponse('person.email is not a valid email address.', 400);

  const page = str(body?.page, 300);
  const details: Array<[string, string]> = (Array.isArray(body?.details) ? body.details : [])
    .slice(0, 25)
    .map((d: any) => [str(d?.[0], 60), str(d?.[1], 1500)] as [string, string])
    .filter(([k, v]: [string, string]) => k && v);

  const when = new Date();
  const tag = tagName(brand, action);
  const description = describe(brand, action);
  const dateText = when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  const lastAction = `${tag} (${dateText}): ${description}`;
  const notes = `${brand.name} · ${action.label} on ${dateText}${page ? ` via ${page}` : ''}`;

  const crm = (async () => {
    if (!token) return { ok: false, error: 'CLICKUP_TOKEN is not set on the server.' };
    try {
      let entry: Entry | null = await resolveEntry(token, person.email || '', person.phone || '');
      let outcome: 'created' | 'matched' = entry ? 'matched' : 'created';
      if (entry) {
        const prior = await findMarker(token, entry.id, ref);
        if (prior) return { ok: true, replay: true, action: prior, entryId: entry.id, entryType: entry.type, entryName: entry.name };
      } else {
        entry = await createLead(token, person, `First came in through ${tag} on ${dateText}.`);
      }
      const fields: FieldReport = await applyActivityFields(token, entry, { person, brand, action, tag, notes, when });
      const lines = [
        `[ACTIVITY: ${tag}]`,
        description,
        ...details.map(([k, v]) => `${k}: ${v}`),
        page ? `Page: ${page}` : '',
        `Systeme.io tag: ${tag}`,
        marker(ref, outcome),
      ].filter(Boolean);
      await addComment(token, entry.id, lines.join('\n'));
      return { ok: true, action: outcome, entryId: entry.id, entryType: entry.type, entryName: entry.name, fields };
    } catch (e: any) {
      return { ok: false, error: e?.message ? String(e.message) : 'ClickUp request failed.' };
    }
  })();

  const systeme = runSysteme({
    person: { email: person.email || '', firstName: person.firstName, lastName: person.lastName, phone: person.phone, company: person.company, website: person.website },
    tag,
    lastAction,
  });

  const [crmResult, systemeResult] = await Promise.all([crm, systeme]);
  const status = crmResult.ok || systemeResult.ok ? 200 : 502;
  return jsonResponse({ ok: crmResult.ok && systemeResult.ok, tag, crm: crmResult, systeme: systemeResult }, status);
}
