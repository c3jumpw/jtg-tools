// api/capture-classify.ts
//
// Vercel Edge Function for Quick Capture. A manual note has no phone or
// email to match against deterministically (unlike Smart Triage's
// Quo-sourced items), so this does the one thing that genuinely needs a
// model: read the freeform text and figure out which existing CRM
// entry, if any, it's actually about -- by matching against the real
// list of entry names, not by guessing a name out of thin air.
//
// The candidate list is the actual, current CRM entry names (computed
// client-side from already-loaded data) -- the model picks from that
// list or says no match, it never invents a name that isn't already a
// real record.

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
      description: 'A concise 1-3 sentence summary of what this note describes -- what happened, what was discussed, any commitments.',
    },
    matchedEntryName: {
      type: 'string',
      description: 'The exact name, copied verbatim from the candidate list, that this note is most likely about. Empty string if no candidate is a clear match -- do not guess or pick the closest one if it is not actually a reasonable match.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'low'],
      description: 'How confident you are in matchedEntryName. Use "low" whenever the note is ambiguous, mentions no clear name, or could plausibly refer to more than one candidate.',
    },
    suggestedNextAction: {
      type: 'string',
      description: 'A brief next step if one is implied by the note (e.g. "Follow up on pricing next week", "Send the proposal"). Empty string if nothing concrete is implied.',
    },
  },
  required: ['summary', 'matchedEntryName', 'confidence', 'suggestedNextAction'],
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

    const rawText = typeof body.rawText === 'string' ? body.rawText.slice(0, 4000) : '';
    if (!rawText.trim()) {
      return jsonResponse({ error: 'rawText is required.' }, 400);
    }
    // The real, current list of CRM entry names -- capped generously to
    // control prompt size on a very large CRM. The model can ONLY pick
    // from this list (or say no match); it never invents a name.
    const candidateNames = Array.isArray(body.candidateNames)
      ? (body.candidateNames as unknown[]).filter((n): n is string => typeof n === 'string').slice(0, 500)
      : [];

    const prompt = `A user of a small business CRM just typed a freeform note about something that happened outside the system -- a conversation, a call, an idea. Figure out what it's about and, if possible, which existing CRM entry it refers to.

NOTE:
"""
${rawText}
"""

CANDIDATE ENTRY NAMES (pick matchedEntryName from this list EXACTLY as written, or leave it empty if none clearly match):
${candidateNames.length ? candidateNames.map(n => `- ${n}`).join('\n') : '(no entries exist yet)'}

Be conservative on the match: only pick a name if the note clearly refers to that specific person/entry (by name, or unambiguous context). If the note could plausibly refer to more than one candidate, or mentions no identifiable name at all, leave matchedEntryName empty and confidence "low" rather than guessing.`;

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
    const rawResponseText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawResponseText) {
      return jsonResponse({ error: 'Gemini returned no content.', detail: geminiJson }, 502);
    }

    let parsed: { summary?: string; matchedEntryName?: string; confidence?: string; suggestedNextAction?: string };
    try {
      parsed = JSON.parse(rawResponseText);
    } catch {
      return jsonResponse({ error: 'Gemini response was not valid JSON.', detail: rawResponseText }, 502);
    }

    if (parsed.summary == null || parsed.matchedEntryName == null || !parsed.confidence) {
      return jsonResponse({ error: 'Gemini response missing required fields.', detail: parsed }, 502);
    }

    // Defense in depth: even though the prompt constrains the model to
    // the candidate list, verify the returned name is actually in it
    // before trusting it as a real match -- a hallucinated name here
    // would otherwise silently fail to resolve to any real entry ID
    // downstream anyway, but better to catch it explicitly.
    if (parsed.matchedEntryName && !candidateNames.includes(parsed.matchedEntryName)) {
      parsed.matchedEntryName = '';
      parsed.confidence = 'low';
    }

    return jsonResponse(parsed, 200);

  } catch (e) {
    return jsonResponse({ error: 'Unexpected server error.', detail: String(e) }, 500);
  }
}
