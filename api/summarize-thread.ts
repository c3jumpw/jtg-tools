// api/summarize-thread.ts
//
// Vercel Edge Function. Holds the Gemini key server-side, same as every
// other AI function in this app. Takes the raw, timestamped play-by-play
// of a bundled activity thread (multiple texts/calls from the same
// conversation, already assembled by the Worker) and condenses it into
// a short, readable summary for the CRM comment -- the full raw
// transcript still gets preserved, just as an attached file instead of
// dominating the comment body itself.

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
    summary: {
      type: 'string',
      description: 'A concise, plain-language summary of this activity thread -- what was discussed, any commitments or next steps agreed on. A few sentences, not a full replay. No markdown.',
    },
  },
  required: ['summary'],
};

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

    // The raw thread text is the timestamped play-by-play the Worker
    // already assembles (multiple texts/calls, oldest first) -- capped
    // generously since summarizing needs the real content, bounded to
    // control cost on an unusually long thread.
    const rawThread = typeof body.rawThread === 'string' ? body.rawThread.slice(0, 8000) : '';
    if (!rawThread.trim()) {
      return jsonResponse({ error: 'rawThread is required.' }, 400);
    }
    const contactName = typeof body.contactName === 'string' ? body.contactName.slice(0, 200) : '';

    const prompt = `Summarize this activity thread -- a timestamped sequence of texts and/or calls with the same contact -- into a short, readable summary for a CRM log entry.

${contactName ? `Contact: ${contactName}\n` : ''}
RAW THREAD (oldest first, -> means outgoing, <- means incoming):
"""
${rawThread}
"""

Write a concise summary (2-4 sentences) covering what was actually discussed and any commitments, next steps, or scheduling agreed on. Plain language, no markdown, not a blow-by-blow replay -- something a teammate could read in a few seconds and understand what happened and what's next. If nothing substantive happened (e.g. a short unanswered call), say so plainly rather than padding it out.`;

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

    let parsed: { summary?: string };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: 'Gemini response was not valid JSON.', detail: rawText }, 502);
    }

    if (!parsed.summary) {
      return jsonResponse({ error: 'Gemini response missing "summary" field.', detail: parsed }, 502);
    }

    return jsonResponse({ summary: parsed.summary }, 200);

  } catch (e) {
    return jsonResponse({ error: 'Unexpected server error.', detail: String(e) }, 500);
  }
}
