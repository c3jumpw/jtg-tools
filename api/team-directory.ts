// api/team-directory.ts
//
// GET /api/team-directory
//
// Returns the MKC Team Member roster for external tools (booking pages,
// discovery forms, entity sites) so they can populate a rep list
// without anyone re-typing it.
//
// ── SECURITY MODEL (read before editing) ──────────────────────────────
//
// The Team Directory ClickUp list holds Workspace Passcodes -- the
// actual login credentials for the CRM -- alongside home addresses,
// personal phones/emails, and hire/termination dates. An endpoint that
// returns "the Team Directory" is therefore a credential-disclosure
// risk if it is written carelessly.
//
// Three deliberate defenses, in order of importance:
//
// 1. ALLOWLIST, NOT DENYLIST. Only the field IDs in SAFE_FIELDS below
//    are ever read out of the ClickUp response. Everything else is
//    dropped, including fields that do not exist yet. If someone adds
//    "SSN" or "Bank Account" to this list in ClickUp next month, this
//    endpoint keeps ignoring it with no code change. A denylist would
//    silently start leaking it.
//
// 2. SHARED SECRET REQUIRED. Every request must carry X-Form-Secret
//    matching the FORM_SECRET env var, compared in constant time.
//    Without this the roster (names, work emails, access levels) is
//    world-readable, which is both a privacy problem and a gift to
//    anyone probing for admin accounts to target.
//
// 3. ACTIVE MEMBERS ONLY by default. Terminated staff should not show
//    up on a public booking page. ?includeInactive=true is available
//    but must be asked for explicitly.
//
// Field IDs below were taken from a live getListFields('901711759484')
// console dump, not from memory. Do not "tidy" them into name-based
// lookups -- ClickUp field names are not stable identifiers.

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-form-secret',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const TEAM_DIR_LIST_ID = '901711759484';
const CU_BASE = 'https://api.clickup.com/api/v2';

// The ONLY fields that can ever leave this endpoint. See defense #1.
const SAFE_FIELDS = {
  mkcId:             '283bb059-1ab3-42ac-a004-c428840adc28', // short_text
  firstName:         'e9a9e94c-88c0-423b-a6db-05669ff5f967', // short_text
  lastName:          '55530338-993f-4187-b1fe-e66254971d14', // short_text
  knownAs:           '2e7b9ad6-456e-4aa5-a1a6-166e4267ceb0', // short_text
  title:             '1d178589-7a1f-4929-9466-6f9a8604bb57', // short_text
  branch:            '6623fa17-7220-4e17-8011-ee6a4a8fe2c7', // labels
  workspaceEmail:    'b7efdfbb-f273-4bf4-a3cc-70ca32cbc25d', // email  -- work identity / CRM login ID
  publicEmail:       'ac459ce5-c8e4-4e2c-a94f-d113051f1238', // email  -- the address meant to be given out
  publicPhone:       '25052cbb-de85-4d75-9a46-208bc5135c73', // phone  -- ditto
  accessLevel:       'e75be9a5-8c59-4a68-b265-80944de37c91', // drop_down: Super Admin | Admin | Staff
  // Booking links already live on each rep's record -- the booking
  // system should prefer these over inventing a parallel store.
  introCallLink:     '09d21e83-22e6-420e-bded-a463803794c4', // url
  discoveryCallLink: '2af84401-1644-4e38-b64d-730d50e2b483', // url
  walkthroughLink:   'b5ea2c1c-d90d-4328-ad3b-ab0f5aa34de7', // url
} as const;

// Access Level is a drop_down; ClickUp returns an orderindex, not a
// label. Order confirmed from the live field's type_config.options.
const ACCESS_LEVELS = ['Super Admin', 'Admin', 'Staff'];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Constant-time string compare. A plain === leaks secret length and
// prefix via timing; this is cheap insurance on an auth path.
function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Pulls one custom field's value off a ClickUp task, by ID, and
// normalizes it to a plain string. Mirrors the CRM's own getCF()
// behavior for each type so both sides agree on what a value "is".
function readField(task: any, fieldId: string, opts: { type?: string } = {}): string {
  const f = (task.custom_fields || []).find((cf: any) => cf.id === fieldId);
  if (!f || f.value === undefined || f.value === null || f.value === '') return '';
  if (opts.type === 'drop_down') {
    const idx = Number(f.value);
    return ACCESS_LEVELS[idx] ?? '';
  }
  if (Array.isArray(f.value)) {
    // labels type -- map option IDs back to their display labels
    const options = f.type_config?.options || [];
    return f.value
      .map((v: any) => {
        const o = options.find((o: any) => o.id === v || o.label === v);
        return o?.label || o?.name || v;
      })
      .join(', ');
  }
  if (typeof f.value === 'object') return '';
  return String(f.value);
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'GET') return jsonResponse({ error: 'Only GET is supported.' }, 405);

  const formSecret = process.env.FORM_SECRET;
  const clickupToken = process.env.CLICKUP_TOKEN;

  // Fail closed and loudly if the server isn't configured -- an
  // unconfigured secret must never mean "no auth required".
  if (!formSecret) return jsonResponse({ error: 'FORM_SECRET not set on the server.' }, 500);
  if (!clickupToken) return jsonResponse({ error: 'CLICKUP_TOKEN not set on the server.' }, 500);

  const provided = req.headers.get('x-form-secret') || '';
  if (!safeEqual(provided, formSecret)) {
    return jsonResponse({ error: 'Unauthorized.' }, 401);
  }

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get('includeInactive') === 'true';

  try {
    // ClickUp caps page size at 100; the Team Directory is far smaller
    // than that today, but page anyway so this doesn't silently
    // truncate if the team grows.
    const members: any[] = [];
    for (let page = 0; page < 10; page++) {
      const res = await fetch(
        `${CU_BASE}/list/${TEAM_DIR_LIST_ID}/task?page=${page}&subtasks=false&include_closed=true`,
        {
          // 'Bearer ' prefix is required -- CLICKUP_TOKEN is an OAuth
          // app token (MKC Dispatch app). Personal pk_ tokens use the
          // header bare. Getting this wrong fails as a silent 401.
          headers: { Authorization: `Bearer ${clickupToken}`, 'Content-Type': 'application/json' },
        }
      );
      if (!res.ok) {
        const detail = await res.text();
        return jsonResponse({ error: `ClickUp API error (${res.status})`, detail: detail.slice(0, 500) }, 502);
      }
      const data = await res.json();
      const tasks = data.tasks || [];
      members.push(...tasks);
      if (tasks.length < 100 || data.last_page) break;
    }

    const roster = members
      .map((t: any) => {
        const status = (t.status?.status || '').toLowerCase();
        const first = readField(t, SAFE_FIELDS.firstName);
        const last = readField(t, SAFE_FIELDS.lastName);
        return {
          // clickupId is the Team Directory TASK id -- this is what
          // /api/booking-created should send back as repMkcId, and
          // what the CRM stores as S.user.mkcId.
          clickupId: t.id,
          mkcId: readField(t, SAFE_FIELDS.mkcId) || t.id,
          status,
          firstName: first,
          lastName: last,
          fullName: [first, last].filter(Boolean).join(' ') || t.name || '',
          knownAs: readField(t, SAFE_FIELDS.knownAs),
          title: readField(t, SAFE_FIELDS.title),
          branch: readField(t, SAFE_FIELDS.branch),
          email: readField(t, SAFE_FIELDS.workspaceEmail),
          publicEmail: readField(t, SAFE_FIELDS.publicEmail),
          publicPhone: readField(t, SAFE_FIELDS.publicPhone),
          accessLevel: readField(t, SAFE_FIELDS.accessLevel, { type: 'drop_down' }),
          bookingLinks: {
            intro: readField(t, SAFE_FIELDS.introCallLink),
            discovery: readField(t, SAFE_FIELDS.discoveryCallLink),
            walkthrough: readField(t, SAFE_FIELDS.walkthroughLink),
          },
        };
      })
      .filter((m) => includeInactive || m.status === 'active')
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    return jsonResponse({ count: roster.length, members: roster }, 200);
  } catch (e) {
    return jsonResponse({ error: 'Unexpected server error.', detail: String(e) }, 500);
  }
}
