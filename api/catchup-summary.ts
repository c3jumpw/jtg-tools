// api/catchup-summary.ts
//
// Vercel Edge Function. Holds the Gemini API key server-side, same as
// personalize-message.ts. Powers the CRM's "✨ Catch Up" modal: given a
// pre-filtered, already-scoped activity log (the frontend does the time-
// window filtering before calling this -- this function only summarizes
// what it's handed), returns a plain-language recap plus a short bulleted
// list of next steps. Nothing here is stored or logged -- purely
// on-demand, per the feature spec.

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-form-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_MODEL = 'gemini-3.6-flash';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    recap: {
      type: 'string',
      description: 'A short, plain-language paragraph summarizing what happened in the given activity log. No markdown, no bullet points -- prose only.',
    },
    nextSteps: {
      type: 'array',
      items: { type: 'string' },
      description: 'A short bulleted list (2-5 items) of concrete, specific follow-up actions suggested by the activity log. Each item is one concise sentence, no markdown formatting.',
    },
  },
  required: ['recap', 'nextSteps'],
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const truncate = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : '');

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
      return jsonResponse({ error: 'GEMINI_API_KEY is not set on this Vercel project.' }, 500);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
    }

    const entryName = truncate(body.entryName, 200);
    const scopeLabel = truncate(body.scopeLabel, 100) || 'the selected period';
    // The frontend already caps this to a handful of comments at ~400
    // chars each before sending -- this is a defensive backstop, not the
    // primary control on prompt size.
    const activityLog = truncate(body.activityLog, 6000);

    if (!activityLog) {
      return jsonResponse({ error: 'activityLog is required.' }, 400);
    }

    const prompt = `You are helping a CRM admin quickly catch up on a contact/deal without reading through the full activity log themselves.

ENTRY: "${entryName || 'this entry'}"
TIME SCOPE: ${scopeLabel}

ACTIVITY LOG for this scope (each line is one logged event, newest first, in the format "[date] who: what happened"):
"""
${activityLog}
"""

Based ONLY on the activity log above (never invent details not present in it):
1. Write a short "recap" -- 2-4 sentences of plain-language summary of what actually happened in this window. No markdown, no bullet points, just prose someone could read in 5 seconds.
2. List 2-5 concrete "next steps" -- specific, actionable follow-ups suggested by what's in the log (e.g. a message that was sent but never followed up on, a stalled stage, a promised callback). If the log doesn't clearly suggest any next step, it's fine to return fewer items or a single general one like "No clear action needed based on this window -- monitor for a response." Never invent urgency or claims the log doesn't support.`;

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

    let parsed: { recap?: string; nextSteps?: string[] };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: 'Gemini response was not valid JSON.', detail: rawText }, 502);
    }

    if (!parsed.recap) {
      return jsonResponse({ error: 'Gemini response missing "recap" field.', detail: parsed }, 502);
    }

    return jsonResponse({ recap: parsed.recap, nextSteps: parsed.nextSteps || [] }, 200);

  } catch (e) {
    return jsonResponse({ error: 'Unexpected server error.', detail: String(e) }, 500);
  }
}
