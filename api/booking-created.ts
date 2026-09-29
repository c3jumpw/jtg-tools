// api/booking-created.ts
//
// POST /api/booking-created
//
// Called by the native booking system (start.befortune5.com) when
// someone books a slot. Resolves the attendee against the CRM, creates
// a Lead if they're new, and logs the booking as a comment on their
// record so it shows up in their history.
//
// ── AUTH ──────────────────────────────────────────────────────────────
// Same as /api/team-directory: X-Form-Secret compared in constant time
// against FORM_SECRET, failing closed with a 500 if FORM_SECRET is unset
// (an unconfigured secret must never mean "no auth required").
//
// ── IDEMPOTENCY (read before editing) ─────────────────────────────────
// The caller retries on transient failures and asked not to get a
// duplicate Lead or comment. Vercel edge functions are stateless and
// this project has no shared cache, so there is nowhere to keep a
// "seen bookingIds" set. Instead the CRM record itself is the ledger:
//
//   Every booking comment ends with [booking-ref:<uuid>|<action>].
//
// On a retry the attendee now resolves to the entry created by the
// first call, we read that entry's comments, find the marker, and
// replay the original response verbatim -- no second Lead, no second
// comment. The action is embedded in the marker so the replayed
// response matches the first one exactly.
//
// HONEST LIMITATION: this is retry-safe, not concurrency-safe. Two
// genuinely simultaneous requests for the same bookingId could both
// miss the marker and both create. Sequential retries -- which is what
// the caller actually does -- are fully covered. Closing the remaining
// gap needs a real lock (Vercel KV/Upstash); say so rather than
// pretending this is stronger than it is.
//
// ── ERROR SHAPE ───────────────────────────────────────────────────────
// Every failure returns {"error": "<string>"} with a FLAT string value.
// The caller renders it verbatim in their admin UI and already got
// bitten by Vercel's own 404 body, which nests {error:{code,message}}
// and renders as "[object Object]". Never nest an object under "error".

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-form-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CU_BASE = 'https://api.clickup.com/api/v2';

const LISTS = {
  accounts: '901710481777',
  pipeline: '901710326878',
  leads: '901710477809',
  contacts: '901710477009',
};
// Resolution priority, lowest to highest. Built in this order with
// last-write-wins, so an established Contact beats an older Lead for
// the same phone/email. Mirrors the CRM's own buildContactLookupMap.
const RESOLVE_ORDER: Array<keyof typeof LISTS> = ['accounts', 'pipeline', 'leads', 'contacts'];
const TYPE_LABEL: Record<string, string> = {
  leads: 'Lead',
  contacts: 'Contact',
  pipeline: 'Deal',
  accounts: 'Account',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
// Guarantees the flat {"error": "..."} shape the caller depends on.
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

// ClickUp accepts two kinds of credential and they are presented
// DIFFERENTLY. A personal token (pk_...) goes in the header bare; an
// OAuth app access token (e.g. MKC Dispatch) requires the 'Bearer '
// scheme. Send the wrong one and every call fails as
//   401 {"err":"Oauth token not found","ECODE":"OAUTH_019"}
// which reads like a revoked credential and is not one -- it cost an
// evening of the c1 -> c3 migration to find. Detect instead of assume,
// so swapping token types later is a config change, not a code change.
// trim() also absorbs the trailing newline a dashboard paste adds,
// which produces an identical-looking 401.
function cuAuthHeader(token: string): string {
  const t = String(token || '').trim();
  return t.startsWith('pk_') ? t : `Bearer ${t}`;
}

function cuHeaders(token: string) {
  return { Authorization: cuAuthHeader(token), 'Content-Type': 'application/json' };
}

// US-centric: last 10 digits is the identity. "+1 973-460-0257",
// "(973) 460-0257" and "9734600257" all key to "9734600257".
function phoneKey(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits.slice(-10);
}
// ClickUp's phone field rejects bare digits (FIELD_016) and mis-stores
// a "+1 " prefix with a space. +1XXXXXXXXXX, no space, is what works.
function phoneForClickUp(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length < 10) return digits;
  return '+1' + digits.slice(-10);
}
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Tolerant read, matching the CRM's own fix: scan EVERY string custom
// field rather than three hardcoded names, because historical records
// keep phones in assorted fields and formats. The length/letter guards
// stop ZIP codes, revenue figures and phone numbers buried in notes
// from becoming false matches.
function indexTask(task: any, label: string, byPhone: Map<string, any>, byEmail: Map<string, any>) {
  const entry = { id: task.id, type: label, name: task.name || '' };
  for (const f of task.custom_fields || []) {
    const v = f?.value;
    if (typeof v !== 'string' || !v) continue;
    const name = (f.name || '').toLowerCase();
    if (name.includes('email')) {
      const e = v.toLowerCase().trim();
      if (e.includes('@')) byEmail.set(e, entry);
      continue;
    }
    if (v.length > 50) continue;      // notes/descriptions
    if (/[a-zA-Z]/.test(v)) continue; // titles, addresses
    const k = phoneKey(v);
    if (k) byPhone.set(k, entry);
  }
}

async function fetchList(token: string, listId: string): Promise<any[]> {
  const out: any[] = [];
  for (let page = 0; page < 10; page++) {
    const res = await fetch(
      `${CU_BASE}/list/${listId}/task?page=${page}&subtasks=false&include_closed=true`,
      { headers: cuHeaders(token) }
    );
    if (!res.ok) throw new Error(`ClickUp list ${listId} returned ${res.status}`);
    const data = await res.json();
    const tasks = data.tasks || [];
    out.push(...tasks);
    if (tasks.length < 100 || data.last_page) break;
  }
  return out;
}

async function resolveAttendee(token: string, email: string, phone: string) {
  const byPhone = new Map<string, any>();
  const byEmail = new Map<string, any>();
  // Lowest-priority list first; later writes overwrite, so Contacts win.
  for (const key of RESOLVE_ORDER) {
    const tasks = await fetchList(token, LISTS[key]);
    for (const t of tasks) {
      if (t.parent) continue; // subtasks aren't entries
      indexTask(t, TYPE_LABEL[key], byPhone, byEmail);
    }
  }
  const e = (email || '').toLowerCase().trim();
  if (e && byEmail.has(e)) return byEmail.get(e);
  const pk = phoneKey(phone || '');
  if (pk && byPhone.has(pk)) return byPhone.get(pk);
  return null;
}

// Field UUIDs on the Leads list are not hardcoded here on purpose:
// this endpoint has no way to verify a hardcoded ID is still correct,
// and a wrong ID fails silently. Resolve by exact name at write time,
// fall back to a contains-match, and report anything that could not be
// set instead of pretending the write was complete.
async function getListFieldMap(token: string, listId: string): Promise<any[]> {
  const res = await fetch(`${CU_BASE}/list/${listId}/field`, { headers: cuHeaders(token) });
  if (!res.ok) throw new Error(`ClickUp field lookup returned ${res.status}`);
  const data = await res.json();
  return data.fields || [];
}
function findField(fields: any[], name: string) {
  const n = name.toLowerCase();
  return (
    fields.find((f) => (f.name || '').toLowerCase() === n) ||
    fields.find((f) => (f.name || '').toLowerCase().includes(n))
  );
}

async function setField(token: string, taskId: string, field: any, value: string): Promise<boolean> {
  if (!field || value === '' || value == null) return true;
  try {
    const res = await fetch(`${CU_BASE}/task/${taskId}/field/${field.id}`, {
      method: 'POST',
      headers: cuHeaders(token),
      body: JSON.stringify({ value: String(value) }),
    });
    if (res.ok) return true;
    const body = await res.text();
    // FIELD_115 = this field isn't configured on this list at all.
    // Nothing is being lost, so it isn't a real failure.
    if (body.includes('FIELD_115')) return true;
    return false;
  } catch {
    return false;
  }
}

function marker(bookingId: string, action: string) {
  return `[booking-ref:${bookingId}|${action}]`;
}

async function findExistingMarker(token: string, taskId: string, bookingId: string) {
  try {
    const res = await fetch(`${CU_BASE}/task/${taskId}/comment`, { headers: cuHeaders(token) });
    if (!res.ok) return null;
    const data = await res.json();
    for (const c of data.comments || []) {
      const text = c.comment_text || '';
      for (const action of ['created', 'matched']) {
        if (text.includes(marker(bookingId, action))) return action;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── OPTIONAL REP TASK ─────────────────────────────────────────────────
// Creates a task in Master CRM Tasks so the booking shows up in the
// rep's normal workflow, not only on their calendar.
//
// The Master Tasks list ID is an ENV VAR, not a constant, for a real
// reason: it is configured per-session in the CRM (S.creds.listTasks)
// and is not a value this endpoint can verify. Hardcoding a guessed
// list ID would write tasks into some unrelated list -- exactly the
// anti-pattern this integration is trying to avoid. So:
//
//   MASTER_TASKS_LIST_ID unset  -> task creation is skipped silently
//   MASTER_TASKS_LIST_ID set    -> tasks are created
//
// That means this feature can be switched on later by adding one env
// var, with no code change and no redeploy of this file.
//
// Everything here is BEST EFFORT. A booking that logged correctly must
// never fail because its follow-up task didn't -- the booking is the
// record that matters. Failures come back as a `warning` string rather
// than being swallowed (silent field-write failures were a real bug
// class in this CRM) or thrown.
const TEAM_DIR_LIST_ID = '901711759484';
const WORKSPACE_NAME_FIELD = 'b5b1ccc3-f07b-44a6-afeb-a11d204cd2ba'; // type: users

// repMkcId is a Team Directory TASK id. Assigning a ClickUp task needs
// the rep's ClickUp USER id, which lives on that record's "Workspace
// Name" people-field. Returns null whenever the rep has no ClickUp seat
// linked yet -- a normal state, not an error.
async function repClickUpUserId(token: string, repMkcId: string): Promise<number | null> {
  try {
    const res = await fetch(`${CU_BASE}/task/${repMkcId}`, { headers: cuHeaders(token) });
    if (!res.ok) return null;
    const task = await res.json();
    if (task?.list?.id !== TEAM_DIR_LIST_ID) return null; // wrong record type; don't guess
    const f = (task.custom_fields || []).find((cf: any) => cf.id === WORKSPACE_NAME_FIELD);
    const v = f?.value;
    if (Array.isArray(v) && v.length) {
      const id = Number(v[0]?.id);
      return Number.isFinite(id) ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function createRepTask(
  token: string,
  listId: string,
  opts: { topic: string; attendeeName: string; startTime: string; repMkcId: string | null; entryId: string; entryType: string }
): Promise<string | null> {
  const body: Record<string, unknown> = {
    name: `Booking: ${opts.topic} — ${opts.attendeeName}`,
    status: 'TO DO',
  };
  const ms = Date.parse(opts.startTime || '');
  if (Number.isFinite(ms)) {
    body.due_date = ms;
    body.due_date_time = true; // a booking has a real time, not a date-only placeholder
  }
  if (opts.repMkcId) {
    const userId = await repClickUpUserId(token, opts.repMkcId);
    // ClickUp's CREATE-task API takes a plain array of user IDs (the
    // {add,rem} diff shape is for UPDATE only -- nothing to diff yet).
    if (userId) body.assignees = [userId];
  }

  const res = await fetch(`${CU_BASE}/list/${listId}/task`, {
    method: 'POST',
    headers: cuHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`task create returned ${res.status}`);
  const task = await res.json();

  // Link the task back to the entry. Target the plain-text "Related X
  // ID" field, NEVER the native list_relationship field of the same
  // name -- ClickUp's API cannot set those (FIELD_349 "Invalid
  // relationship"), and a bare name match is ambiguous between the two.
  try {
    const fRes = await fetch(`${CU_BASE}/list/${listId}/field`, { headers: cuHeaders(token) });
    if (fRes.ok) {
      const fields = ((await fRes.json()).fields || []) as any[];
      const partial =
        opts.entryType === 'Deal' ? 'related deal'
        : opts.entryType === 'Account' ? 'related account'
        : opts.entryType === 'Contact' ? 'related contact'
        : 'related lead';
      const f =
        fields.find((x) => (x.name || '').toLowerCase().includes(partial) && (x.name || '').toLowerCase().includes('id')) ||
        fields.find((x) => (x.name || '').toLowerCase().includes(partial) && x.type !== 'list_relationship' && x.type !== 'relationship');
      if (f) {
        await fetch(`${CU_BASE}/task/${task.id}/field/${f.id}`, {
          method: 'POST',
          headers: cuHeaders(token),
          body: JSON.stringify({ value: opts.entryId }),
        });
      }
    }
  } catch {
    // Linking is a nice-to-have; the task still exists and is assigned.
  }
  return task.id || null;
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return errorResponse('Only POST is supported.', 405);

  const formSecret = process.env.FORM_SECRET;
  const token = process.env.CLICKUP_TOKEN;
  if (!formSecret) return errorResponse('FORM_SECRET is not set on the server.', 500);
  if (!token) return errorResponse('CLICKUP_TOKEN is not set on the server.', 500);
  if (!safeEqual(req.headers.get('x-form-secret') || '', formSecret)) {
    return errorResponse('Unauthorized.', 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Request body was not valid JSON.', 400);
  }

  const attendee = body?.attendee || {};
  const meeting = body?.meeting || {};
  const bookingId = typeof body?.bookingId === 'string' ? body.bookingId.trim() : '';
  const repName = (body?.repName || '').trim() || 'a team member';
  // Documented as nullable by the caller -- a rep may not be linked yet.
  const repMkcId = typeof body?.repMkcId === 'string' && body.repMkcId.trim() ? body.repMkcId.trim() : null;

  const email = (attendee.email || '').trim();
  const phone = (attendee.phone || '').trim();
  if (!email && !phone) {
    return errorResponse('attendee.email or attendee.phone is required.', 400);
  }
  if (email && !isValidEmail(email)) {
    return errorResponse(`attendee.email "${email}" is not a valid email address.`, 400);
  }
  if (!bookingId) {
    return errorResponse('bookingId is required (it is what makes retries idempotent).', 400);
  }

  const firstName = (attendee.firstName || '').trim();
  const lastName = (attendee.lastName || '').trim();
  const company = (attendee.company || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || email || phone || 'Unknown';

  try {
    let entry = await resolveAttendee(token, email, phone);
    let action: 'created' | 'matched' = entry ? 'matched' : 'created';

    // Replay check -- see the idempotency note in the header.
    if (entry) {
      const prior = await findExistingMarker(token, entry.id, bookingId);
      if (prior) {
        return jsonResponse(
          { action: prior, entryId: entry.id, entryType: entry.type, entryName: entry.name },
          200
        );
      }
    }

    const unsetFields: string[] = [];

    if (!entry) {
      const created = await fetch(`${CU_BASE}/list/${LISTS.leads}/task`, {
        method: 'POST',
        headers: cuHeaders(token),
        body: JSON.stringify({
          name: fullName,
          description: company ? `Company: ${company}` : '',
        }),
      });
      if (!created.ok) {
        const detail = await created.text();
        return errorResponse(`Could not create Lead in ClickUp (${created.status}): ${detail.slice(0, 300)}`, 502);
      }
      const task = await created.json();
      entry = { id: task.id, type: 'Lead', name: fullName };
      action = 'created';

      const fields = await getListFieldMap(token, LISTS.leads);
      const writes: Array<[string, string]> = [
        ['first name', firstName],
        ['last name', lastName],
        ['email', email],
        ['phone', phoneForClickUp(phone)],
      ];
      for (const [name, value] of writes) {
        if (!value) continue;
        const f = findField(fields, name);
        if (!f) { unsetFields.push(name); continue; }
        const ok = await setField(token, entry.id, f, value);
        if (!ok) unsetFields.push(name);
      }
    }

    const when = meeting.startTime ? String(meeting.startTime) : 'an unspecified time';
    const topic = (meeting.topic || 'Booking').trim();
    const lines = [
      `[BOOKING: ${topic} with ${repName} on ${when}]`,
      meeting.endTime ? `Ends: ${meeting.endTime}` : '',
      meeting.mode ? `Mode: ${meeting.mode}` : '',
      meeting.locationText ? `Location: ${meeting.locationText}` : '',
      meeting.meetingUrl ? `Link: ${meeting.meetingUrl}` : '',
      company ? `Company: ${company}` : '',
      meeting.notes ? `Notes: ${meeting.notes}` : '',
      body?.bookingSource ? `Source: ${body.bookingSource}` : '',
      marker(bookingId, action),
    ].filter(Boolean);

    const commented = await fetch(`${CU_BASE}/task/${entry.id}/comment`, {
      method: 'POST',
      headers: cuHeaders(token),
      body: JSON.stringify({ comment_text: lines.join('\n'), notify_all: false }),
    });
    if (!commented.ok) {
      const detail = await commented.text();
      // The entry exists either way, so report partial success honestly
      // rather than a bare 502 that hides what did happen.
      return errorResponse(
        `Entry ${action} (${entry.id}) but the booking comment failed (${commented.status}): ${detail.slice(0, 200)}`,
        502
      );
    }

    // Best-effort follow-up task. Deliberately AFTER the comment: the
    // booking record is what must not be lost. Note that on a retry the
    // marker short-circuits above, so a task that failed here is not
    // retried -- accepted on purpose, because a duplicate task is worse
    // clutter than a missing one, and the warning below says so.
    const warnings: string[] = [];
    if (unsetFields.length) {
      warnings.push(`these fields could not be set: ${unsetFields.join(', ')}`);
    }
    const tasksListId = process.env.MASTER_TASKS_LIST_ID;
    let repTaskId: string | null = null;
    if (tasksListId) {
      try {
        repTaskId = await createRepTask(token, tasksListId, {
          topic,
          attendeeName: entry.name,
          startTime: meeting.startTime ? String(meeting.startTime) : '',
          repMkcId,
          entryId: entry.id,
          entryType: entry.type,
        });
      } catch (e: any) {
        warnings.push(`follow-up task was not created (${e?.message || 'unknown error'}) -- add it manually`);
      }
    }

    const payload: Record<string, unknown> = {
      action,
      entryId: entry.id,
      entryType: entry.type,
      entryName: entry.name,
    };
    if (repTaskId) payload.taskId = repTaskId;
    // Surfaced rather than swallowed -- silent field-write failures were
    // a real bug class in this CRM. Absent when everything wrote.
    if (warnings.length) payload.warning = `Entry ${action}, but ${warnings.join('; ')}.`;
    return jsonResponse(payload, 200);
  } catch (e: any) {
    return errorResponse(e?.message ? String(e.message) : 'Unexpected server error.', 500);
  }
}
