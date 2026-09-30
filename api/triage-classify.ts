// api/triage-classify.ts
//
// Vercel Edge Function for Smart Triage. Given a thread's raw content
// and whether it already matched a known CRM contact (a DETERMINISTIC
// signal computed client-side via phone/email matching -- never guessed
// by the model), answers one question: is this a genuine CRM-relevant
// business relationship (a lead/client communication worth tracking),
// or something else entirely -- a scam/spam call, a personal
// conversation, a tech support call, an appointment booking, or any
// other legitimate-but-not-CRM-relevant contact.
//
// Bias is deliberately conservative: when genuinely unsure, this should
// say so (confidence: "low") rather than confidently guessing wrong in
// either direction -- a false "not relevant" costs real visibility into
// a lead, a false "low confidence" only costs one extra human glance.

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
      description: 'A concise 2-4 sentence summary of this thread -- what was actually discussed/said, and any commitments or next steps.',
    },
    isCrmRelevant: {
      type: 'boolean',
      description: 'True if this is a genuine business communication with a lead/client/prospect worth tracking in a CRM. False for scam/spam calls, personal conversations, tech support calls, appointment bookings, vendor calls, or any other legitimate-but-not-CRM-relevant contact.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'low'],
      description: 'How confident you are in the isCrmRelevant judgment. Use "low" whenever the content is ambiguous, too short to tell, or could reasonably go either way -- do not force a confident guess.',
    },
    reason: {
      type: 'string',
      description: 'One short sentence explaining the isCrmRelevant judgment, so a human reviewer can quickly sanity-check it (e.g. "Generic scripted sales pitch with no real dialogue" or "Contact confirmed an appointment time, unrelated to any business deal").',
    },
    suggestedName: {
      type: 'string',
      description: 'The likely name of the person on the other end of this thread, if it can be reasonably inferred from the actual content (a signature, a self-introduction like "this is John from...", or how they sign off a text). Empty string if no name is mentioned or inferable -- do not guess from a business name, a generic greeting, or anything not clearly a person\u2019s name.',
    },
  },
  required: ['summary', 'isCrmRelevant', 'confidence', 'reason', 'suggestedName'],
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

    const rawThread = typeof body.rawThread === 'string' ? body.rawThread.slice(0, 8000) : '';
    if (!rawThread.trim()) {
      return jsonResponse({ error: 'rawThread is required.' }, 400);
    }
    const contactName = typeof body.contactName === 'string' ? body.contactName.slice(0, 200) : '';
    // hasCrmMatch is computed client-side via deterministic phone/email
    // matching against the actual CRM data -- passed in as known fact,
    // never left for the model to guess. A confirmed match is strong
    // (though not certain -- e.g. a real lead calling about something
    // personal) evidence toward isCrmRelevant.
    const hasCrmMatch = body.hasCrmMatch === true;

    const prompt = `You are triaging an activity feed for a small business CRM. Decide whether this thread is a genuine business communication with a lead/client/prospect that should be tracked in the CRM, or something else -- a scam/spam call, a personal conversation, a tech support call, an appointment booking, a vendor call, or anything else not about an actual business relationship with this contact.

${contactName ? `Contact name (from caller ID or prior records): ${contactName}\n` : ''}This contact ${hasCrmMatch ? 'IS ALREADY a known contact in the CRM' : 'was NOT found as an existing contact in the CRM'} (this was determined by exact phone/email matching, not a guess).

RAW THREAD (oldest first, -> outgoing, <- incoming):
"""
${rawThread}
"""

Be conservative: if the content is ambiguous or too short to really tell, say so with confidence "low" rather than forcing a guess. A known CRM contact having an unrelated personal conversation is still NOT CRM-relevant for this specific thread, even though they're a known contact overall.

${hasCrmMatch ? 'This contact already has a CRM record, so suggestedName can be left empty.' : 'Since no CRM record exists yet, also look for the actual person\u2019s name if it appears anywhere in the content -- a text signature, someone introducing themselves on a call, or how they sign off. Leave it empty if no real name is mentioned.'}`;

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

    let parsed: { summary?: string; isCrmRelevant?: boolean; confidence?: string; reason?: string; suggestedName?: string };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: 'Gemini response was not valid JSON.', detail: rawText }, 502);
    }

    if (parsed.summary == null || parsed.isCrmRelevant == null || !parsed.confidence || !parsed.reason) {
      return jsonResponse({ error: 'Gemini response missing required fields.', detail: parsed }, 502);
    }

    return jsonResponse(parsed, 200);

  } catch (e) {
    return jsonResponse({ error: 'Unexpected server error.', detail: String(e) }, 500);
  }
}
