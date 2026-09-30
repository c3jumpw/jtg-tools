// api/summarize-email.ts
//
// Vercel Edge Function. Holds the Gemini key server-side. Takes a raw
// pasted email (whatever someone copies straight out of Gmail/Outlook --
// headers, quoted threads, signatures and all) and condenses it into a
// clean, log-worthy summary. Built specifically for manual email logging
// since incoming email isn't auto-captured (Zoho free tier limitation) --
// this makes the manual step fast instead of a chore, not a replacement
// for real inbox automation.

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
      description: 'A concise, plain-language summary of the email suitable for a CRM activity log entry -- who it was from/about, what they said, and any action items or requests. A few sentences, not a full transcript. No markdown.',
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

    // Raw pasted email can be long (signatures, quoted threads) --
    // capped generously since summarizing needs the real content, but
    // still bounded to control cost on an obviously oversized paste.
    const rawEmail = typeof body.rawEmail === 'string' ? body.rawEmail.slice(0, 8000) : '';
    if (!rawEmail.trim()) {
      return jsonResponse({ error: 'rawEmail is required -- paste the email content to summarize.' }, 400);
    }
    const entryName = typeof body.entryName === 'string' ? body.entryName.slice(0, 200) : '';

    const prompt = `Summarize this pasted email into a short, clean CRM activity log entry. The admin pasted this directly from their email client, so it may include headers, quoted reply chains, signatures, and formatting artifacts -- ignore boilerplate (signatures, disclaimers, "On [date] wrote:" quote headers) and focus on the actual substance of the newest message.

${entryName ? `This email relates to CRM entry: "${entryName}"\n` : ''}
RAW PASTED EMAIL:
"""
${rawEmail}
"""

Write a concise summary (2-5 sentences) covering: who it's from/about, what they actually said or asked, and any specific action items, requests, or next steps mentioned. Plain language, no markdown, not a full transcript -- something a teammate could read in five seconds and understand what happened.`;

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
