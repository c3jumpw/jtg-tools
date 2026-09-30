// api/personalize-message.ts
//
// Vercel Edge Function. Holds the Gemini API key server-side (per the
// non-negotiable rule: never in client-side code) and generates a
// lead-type/source-aware variant of a CRM Action message. Called from the
// MKC CRM's "✨ Personalize with AI" button — the static template stays as
// the reliable fallback if this fails or is slow, nothing here is
// auto-sent to a contact.
//
// Deploy: this file lives in the SAME repo as the CRM (c1jumpw/jtg-tools),
// under /api. Connect that repo as a Vercel project once (Vercel
// auto-detects the /api folder and deploys it as a serverless function on
// every push to main) -- GitHub Pages keeps serving mkc-crm/index.html
// exactly as before, completely independent of this.
//
// Set GEMINI_API_KEY as an Environment Variable in the Vercel project
// settings -- never hardcode it here.

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-form-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Isolated to one constant, per the model-naming guidance in the
// troubleshooting doc -- update here only if Gemini deprecates this string.
const GEMINI_MODEL = 'gemini-3.6-flash';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      description: 'The personalized, ready-to-send CRM outreach message. Plain text only, no markdown formatting, no placeholder brackets left unfilled.',
    },
  },
  required: ['message'],
};

// Defensive caps -- protects against an unexpectedly huge free-text field
// (e.g. someone pastes a wall of text into Lead Source Notes) blowing up
// cost/latency on a single-message endpoint.
const MAX_FIELD_LEN = 800;
const truncate = (s: unknown) => (typeof s === 'string' ? s.slice(0, MAX_FIELD_LEN) : '');

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Constant-time compare. A plain === leaks the secret's length and its
// matching prefix through response timing, which is cheap to avoid on an
// auth path. Deliberately duplicated rather than imported from a shared
// module: each Edge Function stays one self-contained file with no build
// wiring that could fail at deploy time. Same helper as
// team-directory.ts and booking-created.ts.
function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req: Request): Promise<Response> {
  // Every response -- including the preflight -- needs these headers, or
  // the browser-side fetch() fails with a CORS error even though a direct
  // curl/Postman test to this same function works fine.
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Only POST is supported.' }, 405);
    }

    // ── SHARED-SECRET GATE ──────────────────────────────────────────
    // Without this, anyone who knows the URL can use this function:
    // for the Gemini endpoints that means a free, billable proxy to a
    // paid API; for send-message it means an open SMS/email relay on
    // MKC's own Quo number and Resend domain. The browser no longer
    // calls here directly -- the Worker forwards each request after
    // checking the caller's CRM session -- so a missing or wrong
    // secret is a misconfiguration or an outsider, never a real user.
    const formSecret = process.env.FORM_SECRET;
    if (!formSecret) {
      return jsonResponse({ error: 'FORM_SECRET is not set on the server.' }, 500);
    }
    if (!safeEqual(req.headers.get('x-form-secret') || '', formSecret)) {
      return jsonResponse({ error: 'Unauthorized.' }, 401);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return jsonResponse({ error: 'GEMINI_API_KEY environment variable is not set on this project.' }, 500);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
    }

    // Validate BEFORE calling Gemini -- fail fast, don't waste an API call
    // on a malformed request.
    const actionLabel = truncate(body.actionLabel);
    const baseMessage = truncate(body.baseMessage);
    if (!actionLabel || !baseMessage) {
      return jsonResponse({ error: 'actionLabel and baseMessage are required.' }, 400);
    }

    const structure = truncate(body.structure);
    const leadType = truncate(body.leadType) || 'unclassified';
    const leadSource = truncate(body.leadSource) || 'unknown';
    const leadSourceNotes = truncate(body.leadSourceNotes);
    const firstName = truncate(body.firstName);
    const lastAction = truncate(body.lastAction);
    // Recent activity is inherently multi-line (up to 5 condensed comments
    // from the frontend) -- give it a larger cap than the single-line
    // fields above rather than truncating it down to the same 800 chars.
    const recentActivity = typeof body.recentActivity === 'string' ? body.recentActivity.slice(0, 1500) : '';
    const magnetDescription = truncate(body.magnetDescription);

    const prompt = `You are helping a sales/CRM team member personalize an outreach message before they send it themselves. You are NOT sending anything -- you are only drafting text a human will review, edit, and send manually.

ACTION: "${actionLabel}"
${structure ? `MESSAGE STRUCTURE TO PRESERVE: ${structure}` : ''}

BASELINE MESSAGE (already correctly formatted with this contact's real data -- use it as your starting point and reference for tone/length, do not ignore it):
"""
${baseMessage}
"""
${magnetDescription ? `\nWHAT THIS LEAD MAGNET ACTUALLY IS (its own description, from the Lead Magnet list -- use this to make the pitch specific and concrete instead of generic, e.g. reference what it actually covers or the real outcome it delivers):\n"""\n${magnetDescription}\n"""\n` : ''}
CONTEXT ABOUT THIS SPECIFIC CONTACT (use to tailor tone and emphasis, not to invent facts not given):
- Lead/Contact classification: ${leadType}
- Lead source: ${leadSource}
${leadSourceNotes ? `- Lead source notes: ${leadSourceNotes}` : ''}
${firstName ? `- First name: ${firstName}` : ''}
${lastAction ? `- Last recorded action taken: ${lastAction}` : ''}
${recentActivity ? `\nRECENT ACTIVITY LOG on this contact (most recent touches, newest first -- use this so you don't repeat something that already happened or contradict it, but don't quote it verbatim either):\n${recentActivity}` : ''}

Rewrite the baseline message so it feels specifically tailored to a "${leadType}" contact who came in via "${leadSource}", while:
- Keeping the same overall structure/intent noted above
- Keeping roughly the same length (this is a short text/DM-style message, not an email)
- Staying consistent with the recent activity log above where one is given -- e.g. don't invite them to something the log shows they already did, and acknowledge a recent touch naturally if it makes the message land better
${magnetDescription ? `- Grounding the pitch in what the lead magnet actually delivers per its own description above, not just its name\n` : ''}- Never inventing specific claims, numbers, or facts that weren't in the baseline message or context above
- Never leaving any [[bracketed placeholder]] text unfilled -- if the baseline had one, either work around it naturally or leave the same placeholder text, don't invent a fake value
- Writing in plain text only, no markdown, no emoji unless the baseline used one`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return jsonResponse({ error: `Gemini API error (${geminiRes.status})`, detail: errText }, 502);
    }

    const geminiJson = await geminiRes.json();
    const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return jsonResponse({ error: 'Gemini returned no content.', detail: geminiJson }, 502);
    }

    // responseSchema means this should already be clean JSON, no markdown
    // fences to strip -- but parse defensively anyway.
    let parsed: { message?: string };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: 'Gemini response was not valid JSON.', detail: rawText }, 502);
    }

    if (!parsed.message) {
      return jsonResponse({ error: 'Gemini response missing "message" field.', detail: parsed }, 502);
    }

    return jsonResponse({ message: parsed.message }, 200);

  } catch (e) {
    // Never let a raw exception/stack trace leak out -- always valid JSON.
    return jsonResponse({ error: 'Unexpected server error.', detail: String(e) }, 500);
  }
}
