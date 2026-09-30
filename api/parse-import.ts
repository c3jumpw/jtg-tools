// api/parse-import.ts
//
// Vercel Edge Function for the Bulk Import feature. Takes a
// natural-language transcript -- typically dictated on the go and
// pasted in -- and returns a structured list of proposed CRM
// operations (create entries, log activities, add tasks, add comments)
// for the person to review before anything is written.
//
// KEY DESIGN DECISIONS, deliberately conservative:
//
// 1. Structured JSON output only -- never generated code. Same pattern
//    as triage-classify and capture-classify. A "paste generated code
//    that runs against your CRM" flow is a security liability, hard to
//    debug, and unnecessary when structured data works fine.
//
// 2. This function CANNOT match to existing entries. It doesn't have
//    the CRM data -- that lives client-side. It produces a
//    contactHint string ("Maurice" or "the guy from Delta") and lets
//    the client-side matcher do the actual resolution against the
//    already-loaded S.entries. Model-based fuzzy matching against
//    names it has never seen is exactly the class of hallucination
//    that would silently create duplicates or log to the wrong record.
//
// 3. Confidence is per-operation, not global. Some items in a
//    transcript may be crystal clear ("create a lead Sarah Chen,
//    phone 470-555-1234, works at Delta") while others in the same
//    transcript may be genuinely ambiguous ("also log something on
//    the Peachtree thing"). Per-item confidence lets the UI surface
//    only the ambiguous ones for close attention.
//
// 4. Bias toward under-extracting, not over-extracting. Missing an
//    operation costs a re-dictation. Fabricating an operation
//    creates bad data that has to be found and cleaned up. Model
//    is told to skip anything genuinely unclear.

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-form-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_MODEL = 'gemini-3.6-flash';

// Schema for what the model is allowed to return. Kept intentionally
// tight -- the CRM's existing surface has many more fields, but this
// covers what's genuinely inferable from a natural-language
// transcript. Anything the transcript doesn't specify should be left
// empty here; the client-side confirm screen lets the person fill in
// details before executing.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      description: 'Ordered list of CRM operations extracted from the transcript. Empty if nothing actionable was found.',
      items: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['create_lead', 'create_contact', 'create_deal', 'create_account', 'log_activity', 'add_task', 'add_comment'],
            description: 'The kind of operation to perform. create_* creates a brand-new entry of that type. log_activity records a comment about an interaction against an existing entry. add_task creates a new task, optionally linked to an entry. add_comment adds a free-text note to an existing entry.',
          },
          contactHint: {
            type: 'string',
            description: 'For log_activity, add_task, and add_comment: the person or entry the operation is about, exactly as the speaker referred to them ("Maurice", "Sarah from Delta", "the Peachtree deal"). Do NOT try to match against known contacts -- the CRM will do that itself. For create_* operations, leave empty (the entry name goes in the entry fields below instead).',
          },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'How clear this operation is from the transcript. "high" = explicit and unambiguous. "medium" = clear intent but some detail (dates, contact, amount) is fuzzy. "low" = you\'re extracting this but you are genuinely unsure the speaker meant to log it as its own item.',
          },
          // Fields for create_lead / create_contact
          firstName: { type: 'string', description: 'First name for create_lead / create_contact. Empty otherwise.' },
          lastName: { type: 'string', description: 'Last name for create_lead / create_contact. Empty if only a first name was given.' },
          email: { type: 'string', description: 'Email for create_lead / create_contact if explicitly stated. Empty otherwise -- do NOT guess or construct.' },
          phone: { type: 'string', description: 'Phone number for create_lead / create_contact if explicitly stated. Empty otherwise. Include as-spoken; the CRM normalizes format.' },
          title: { type: 'string', description: 'Job title / role, e.g. "CEO", "Marketing Director". Empty if not stated.' },
          company: { type: 'string', description: 'Company or organization name if the speaker said the person works at/for one, e.g. "Delta", "Acme Corp".' },
          // Fields for create_deal
          dealName: { type: 'string', description: 'Deal name for create_deal, e.g. "Peachtree Q4 renewal". Empty for other ops.' },
          dealValue: { type: 'string', description: 'Deal value as-stated for create_deal, e.g. "$5,000/mo", "12k annual". Empty if not stated.' },
          // Fields for create_account
          accountName: { type: 'string', description: 'Account/company name for create_account. Empty for other ops.' },
          // Fields for log_activity / add_comment
          activityText: { type: 'string', description: 'The actual content to log -- a summary of what was discussed, what the person said, what happened. Written as a factual log entry ("Discussed pricing, asked for a proposal by Friday"), NOT as a first-person narrative ("I talked to Maurice"). Required for log_activity and add_comment.' },
          activityChannel: {
            type: 'string',
            enum: ['call', 'text', 'email', 'meeting', 'other', ''],
            description: 'For log_activity: the interaction channel if the speaker mentioned it ("I called", "she texted me", "we met"). Empty if not stated.',
          },
          // Fields for add_task
          taskName: { type: 'string', description: 'Task name for add_task, e.g. "Send Maurice the proposal". Required for add_task.' },
          taskDueDate: { type: 'string', description: 'Task due date in YYYY-MM-DD format for add_task, if the speaker said when. Interpret relative dates ("Friday", "next Wednesday") using the referenceDate provided in the prompt. Empty if no due date was stated.' },
          notes: { type: 'string', description: 'Any additional free-form context that doesn\'t fit the other fields but is worth preserving for the human reviewer.' },
        },
        required: ['op', 'confidence'],
      },
    },
    unhandledContent: {
      type: 'string',
      description: 'A brief note about anything in the transcript that was NOT turned into an operation but might have been intended as one -- e.g. "Speaker mentioned following up on the Nashville thing but didn\'t say what to do about it." Empty if everything actionable was captured.',
    },
  },
  required: ['operations'],
};

function jsonResponse(body: unknown, status = 200) {
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

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
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
    if (!apiKey) return jsonResponse({ error: 'GEMINI_API_KEY not set on the server.' }, 500);

    const body = await req.json().catch(() => null);
    if (!body || typeof body.transcript !== 'string') {
      return jsonResponse({ error: 'Missing or invalid "transcript" in request body.' }, 400);
    }
    const transcript = body.transcript.trim();
    if (!transcript) return jsonResponse({ error: 'Transcript is empty.' }, 400);
    if (transcript.length > 20000) {
      // Guardrail: extremely long transcripts blow up cost, latency,
      // and the confirm-screen UX. 20k chars is ~4000 words, more
      // than any realistic dictation session.
      return jsonResponse({ error: 'Transcript is too long (max 20,000 characters). Split it into smaller batches.' }, 400);
    }

    // Client passes today's date in the user's local timezone -- so
    // relative dates like "Friday" or "next Wednesday" resolve
    // correctly regardless of where the Vercel edge instance runs.
    const referenceDate = typeof body.referenceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.referenceDate)
      ? body.referenceDate
      : new Date().toISOString().slice(0, 10);

    const prompt = `You are parsing a natural-language voice memo or note into structured CRM operations. The person speaking is a business owner recapping recent interactions with leads, contacts, and deals.

Today's date is ${referenceDate}. Use it to resolve any relative dates ("Friday", "next Wednesday", "in two weeks") into YYYY-MM-DD.

Extract each distinct operation the speaker describes. Available operations:
- create_lead / create_contact: A person the speaker is meeting/knowing for the first time (create_lead) or already established (create_contact). Only create these when the speaker clearly gives a name AND at least one detail (phone, email, company, or context of who they are). Do not create an entry from a bare name mention like "I mentioned this to Maurice".
- create_deal: A business opportunity or engagement the speaker describes as new.
- create_account: A company/organization the speaker describes as new.
- log_activity: A specific interaction with an existing (already-mentioned or already-existing) person or entity. Use contactHint to identify who -- exactly as the speaker said, do NOT guess a full name.
- add_task: A to-do item the speaker wants recorded, usually with a deadline.
- add_comment: A note to attach to an existing entry that isn't really an interaction ("mark them as high priority", "note that they prefer email").

CRITICAL RULES:
1. Be conservative. If the speaker mentions someone in passing without a clear operation ("saw Bob at the store"), do NOT create anything. Missing an operation is cheaper than fabricating one.
2. Never invent details. If a phone number, email, or company isn't stated, leave it empty. The reviewer can fill it in.
3. For contact references, put EXACTLY what the speaker said in contactHint ("Maurice", "the guy at Delta"). Do not try to guess a full name or match to a known contact -- the CRM does that itself.
4. Use confidence honestly. "high" means you'd bet money the speaker meant this. "low" means you're extracting it but genuinely unsure the speaker intended it as a distinct operation.
5. Order matters -- return operations in the order they appear in the transcript, since a create_lead + log_activity pair may refer to the same new person.

TRANSCRIPT:
"""
${transcript}
"""

If nothing actionable was said, return an empty operations array -- do not force operations that aren't there.`;

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
            temperature: 0.1, // low temp -- extraction task, not creative writing
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

    let parsed: { operations?: Array<Record<string, unknown>>; unhandledContent?: string };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: 'Gemini response was not valid JSON.', detail: rawText }, 502);
    }

    if (!Array.isArray(parsed.operations)) {
      return jsonResponse({ error: 'Gemini response missing required "operations" array.', detail: parsed }, 502);
    }

    return jsonResponse(parsed, 200);
  } catch (e) {
    return jsonResponse({ error: 'Unexpected server error.', detail: String(e) }, 500);
  }
}
