// api/team-directory/[clickupId].ts
//
// PATCH /api/team-directory/:clickupId
//
// Writes a rep's booking link back onto their Team Directory record, so
// every CRM surface that already renders Discovery Call Link keeps
// working and points at the live native booking page -- instead of a
// second, parallel store that drifts.
//
// ── WRITE ALLOWLIST (read before editing) ─────────────────────────────
// The Team Directory holds Workspace Passcodes (real CRM login
// credentials), Access Level, personal phones/emails and addresses. A
// PATCH endpoint here is a privilege-escalation surface if it is
// written permissively: anyone holding FORM_SECRET could otherwise
// rewrite their own Access Level to Super Admin, or change a
// colleague's passcode.
//
// So WRITABLE_FIELDS below is exhaustive and deliberately tiny. Any key
// in the request body that is not in it is REJECTED with a 400 naming
// the offending key -- not ignored. Silently dropping unknown keys
// would let a caller believe a write succeeded when nothing happened,
// which is the same silent-failure class this CRM already had to fix
// once. Adding a field here is a deliberate act; make sure it is never
// a credential or an authorization field.
//
// Auth and error shape match /api/booking-created exactly:
// X-Form-Secret in constant time, and always a FLAT {"error": "..."}.

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-form-secret',
  'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
};

const CU_BASE = 'https://api.clickup.com/api/v2';

// The ONLY fields this endpoint may ever write. UUIDs taken from a live
// getListFields('901711759484') dump, not from memory.
const WRITABLE_FIELDS: Record<string, { id: string; type: 'url' }> = {
  discoveryCallLink: { id: '2af84401-1644-4e38-b64d-730d50e2b483', type: 'url' },
  introCallLink:     { id: '09d21e83-22e6-420e-bded-a463803794c4', type: 'url' },
  walkthroughLink:   { id: 'b5ea2c1c-d90d-4328-ad3b-ab0f5aa34de7', type: 'url' },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
function errorResponse(message: string, status: number) {
  return jsonResponse({ error: String(message) }, status);
}

function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Only https/http URLs. Blocks javascript: and data: payloads, which
// would otherwise be stored and later rendered by CRM surfaces.
function isSafeUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'PATCH') return errorResponse('Only PATCH is supported.', 405);

  const formSecret = process.env.FORM_SECRET;
  const token = process.env.CLICKUP_TOKEN;
  if (!formSecret) return errorResponse('FORM_SECRET is not set on the server.', 500);
  if (!token) return errorResponse('CLICKUP_TOKEN is not set on the server.', 500);
  if (!safeEqual(req.headers.get('x-form-secret') || '', formSecret)) {
    return errorResponse('Unauthorized.', 401);
  }

  // Parsed from the path rather than a framework params object, so this
  // behaves the same regardless of runtime wiring.
  const pathname = new URL(req.url).pathname;
  const clickupId = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
  if (!clickupId || clickupId === 'team-directory') {
    return errorResponse('A Team Directory clickupId is required in the path.', 400);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Request body was not valid JSON.', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse('Request body must be a JSON object.', 400);
  }

  // Reject unknown keys loudly -- see the allowlist note above.
  const keys = Object.keys(body);
  const rejected = keys.filter((k) => !(k in WRITABLE_FIELDS));
  if (rejected.length) {
    return errorResponse(
      `These fields are not writable through this endpoint: ${rejected.join(', ')}. Writable: ${Object.keys(WRITABLE_FIELDS).join(', ')}.`,
      400
    );
  }
  if (!keys.length) {
    return errorResponse(`Nothing to update. Writable fields: ${Object.keys(WRITABLE_FIELDS).join(', ')}.`, 400);
  }

  for (const k of keys) {
    const v = body[k];
    if (typeof v !== 'string') return errorResponse(`"${k}" must be a string URL.`, 400);
    if (v !== '' && !isSafeUrl(v)) {
      return errorResponse(`"${k}" must be an http(s) URL (got "${v.slice(0, 80)}").`, 400);
    }
  }

  try {
    // Confirm the task exists and is actually on the Team Directory
    // list before writing -- otherwise a wrong ID would silently write
    // a booking link onto some unrelated Lead or Deal.
    const check = await fetch(`${CU_BASE}/task/${clickupId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (check.status === 404) return errorResponse(`No task found with id "${clickupId}".`, 404);
    if (!check.ok) {
      const detail = await check.text();
      return errorResponse(`ClickUp lookup failed (${check.status}): ${detail.slice(0, 200)}`, 502);
    }
    const task = await check.json();
    if (task?.list?.id !== '901711759484') {
      return errorResponse(
        `Task "${clickupId}" is not on the Team Directory list (it is on list ${task?.list?.id || 'unknown'}).`,
        400
      );
    }

    const updated: string[] = [];
    for (const k of keys) {
      const field = WRITABLE_FIELDS[k];
      const res = await fetch(`${CU_BASE}/task/${clickupId}/field/${field.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: String(body[k]) }),
      });
      if (!res.ok) {
        const detail = await res.text();
        return errorResponse(`Could not write "${k}" (${res.status}): ${detail.slice(0, 200)}`, 502);
      }
      updated.push(k);
    }

    return jsonResponse({ ok: true, clickupId, updated }, 200);
  } catch (e: any) {
    return errorResponse(e?.message ? String(e.message) : 'Unexpected server error.', 500);
  }
}
