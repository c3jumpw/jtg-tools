// api/compose-message.ts
//
// Vercel Edge Function. Holds the Gemini key server-side, same as
// personalize-message.ts and catchup-summary.ts. This is the "describe
// a situation, get a draft" tool -- different from Personalize with AI,
// which requires an existing CRM Action template to start from. This
// one starts from nothing but the admin's own free-text description of
// what's going on, plus the real entry data already available in the
// app. Same rule as everywhere else: generates a DRAFT only, nothing is
// sent from here -- the draft lands in the same review/Copy/Send/Log
// flow every other CRM Action message already uses.

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
    message: {
      type: 'string',
      description: 'The drafted outbound message body. Plain text only, no markdown, no placeholder brackets left unfilled.',
    },
    subject: {
      type: 'string',
      description: 'A short, specific email subject line for this situation (a few words). Still returned even if the message ends up sent as a text -- the frontend decides whether to use it.',
    },
  },
  required: ['message', 'subject'],
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const truncate = (s: unknown, max = 800) => (typeof s === 'string' ? s.slice(0, max) : '');

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

    const situation = truncate(body.situation, 2000);
    if (!situation) {
      return jsonResponse({ error: 'situation is required -- describe what this message needs to say.' }, 400);
    }

    const entryName = truncate(body.entryName, 200);
    const firstName = truncate(body.firstName, 100);
    const leadType = truncate(body.leadType, 100);
    const leadSource = truncate(body.leadSource, 100);
    const leadSourceNotes = truncate(body.leadSourceNotes);
    const lastAction = truncate(body.lastAction, 200);
    const recentActivity = typeof body.recentActivity === 'string' ? body.recentActivity.slice(0, 1500) : '';
    const channel = truncate(body.channel, 10) === 'email' ? 'email' : 'sms'; // affects expected length/formality

    const TONE_GUIDANCE: Record<string, string> = {
      'Friendly': 'Warm and personable, like talking to someone you genuinely like working with.',
      'Straight Forward': 'Direct, no fluff or hedging -- get to the point in the first sentence.',
      'Urgent': 'Convey real time-sensitivity and prompt quick action, without sounding alarmist or fake-scarce.',
      'Informative/Metric': 'Fact- and data-driven -- lead with specifics/numbers where the situation gives you any, educational rather than salesy.',
      'Quick (2-liner disruptor)': 'EXACTLY one to two short lines, total. A punchy, pattern-interrupting opener designed to make a busy person actually stop and react -- not a full message, a hook.',
      'Funny disruptor': 'Genuinely witty or unexpected in angle -- humor should still clearly relate to the real situation, not be a generic joke bolted on.',
    };
    const MODIFIER_GUIDANCE: Record<string, string> = {
      'Informal': 'Casual language, contractions, relaxed grammar -- like texting a friend, not writing a memo.',
      'Emoji Heavy': 'Include relevant emojis noticeably throughout (not just one at the end) -- but they should fit the content, not feel randomly inserted.',
      'Chat Thread': 'Write as if this continues an ongoing back-and-forth conversation already in progress -- skip a cold-open greeting, jump straight in like the next message in a thread.',
      'Formal': 'Professional and polished -- full sentences, no contractions or slang, appropriate for a business relationship that expects that register.',
    };
    const tonality = truncate(body.tonality, 50);
    const modifiers = Array.isArray(body.modifiers)
      ? body.modifiers.filter((m): m is string => typeof m === 'string' && !!MODIFIER_GUIDANCE[m]).slice(0, 4)
      : [];

    const prompt = `You are drafting an outbound message for a CRM admin to review, edit, and send themselves -- you are NOT sending anything. The admin has described a specific situation in their own words; write the actual message that addresses it.

SITUATION, IN THE ADMIN'S OWN WORDS (this is the primary instruction -- follow it):
"""
${situation}
"""

CONTEXT ABOUT THIS CONTACT (use to personalize, not to invent facts beyond what's given):
${firstName ? `- First name: ${firstName}` : ''}
${entryName ? `- Full name/entry: ${entryName}` : ''}
${leadType ? `- Lead/Contact classification: ${leadType}` : ''}
${leadSource ? `- Lead source: ${leadSource}` : ''}
${leadSourceNotes ? `- Lead source notes: ${leadSourceNotes}` : ''}
${lastAction ? `- Last recorded action: ${lastAction}` : ''}
${recentActivity ? `\nRECENT ACTIVITY LOG (most recent first -- stay consistent with this, don't repeat or contradict something that already happened):\n${recentActivity}` : ''}
${tonality && TONE_GUIDANCE[tonality] ? `\nREQUIRED TONE -- ${tonality}: ${TONE_GUIDANCE[tonality]}` : ''}
${modifiers.length ? `\nSTYLE MODIFIERS TO APPLY:\n${modifiers.map(m => `- ${m}: ${MODIFIER_GUIDANCE[m]}`).join('\n')}` : ''}

INTENDED CHANNEL: ${channel === 'email' ? 'Email -- can be a little longer, include a natural greeting and sign-off.' : 'Text/SMS -- keep it short, one to three sentences, no formal greeting needed.'}

Write:
1. "message" -- the actual message body addressing the situation described above. Plain text, no markdown.
2. "subject" -- a short, specific subject line for this situation (used if sent as email, ignored if sent as text) -- never generic like "Follow Up," name what this message is actually about.

Never invent specific facts, prices, dates, or commitments that weren't in the situation description or context above.`;

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

    let parsed: { message?: string; subject?: string };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: 'Gemini response was not valid JSON.', detail: rawText }, 502);
    }

    if (!parsed.message) {
      return jsonResponse({ error: 'Gemini response missing "message" field.', detail: parsed }, 502);
    }

    return jsonResponse({ message: parsed.message, subject: parsed.subject || '' }, 200);

  } catch (e) {
    return jsonResponse({ error: 'Unexpected server error.', detail: String(e) }, 500);
  }
}
