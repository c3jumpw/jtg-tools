// api/assistant.ts
//
// Vercel Edge Function behind the CRM's voice/text Assistant. Each turn
// the CRM sends the whole conversation so far plus the current draft of
// operations; this returns what to say next and the updated draft.
//
// How it fits together (see "Assistant" in mkc-crm/index.html):
//   1. The browser turns speech into text (Web Speech API) or the person
//      types. Either way this endpoint only ever sees text.
//   2. Gemini reads the conversation and returns structured operations
//      (create/update a lead, contact, account or deal; add a note; add a
//      task). This is the same idea as Gemini function calling, using a
//      response schema so the output is always one well-formed object.
//   3. The CRM matches the names against its own records (this function
//      never sees CRM data, so it can't invent a match), asks "which one?"
//      when a name fits several records, and reads back a summary.
//   4. Nothing is written until the person confirms. The writes go
//      through the CRM's existing ClickUp calls, not through here.
//
// Stateless on purpose: the draft lives in the browser and comes back on
// every turn, so a dropped request never loses what was said.

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-form-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_MODEL = 'gemini-3.6-flash';
const MAX_TURNS = 30;
const MAX_TURN_CHARS = 4000;
const MAX_OPS = 15;

const OPS = ['create_lead', 'create_contact', 'create_account', 'create_deal', 'update_record', 'add_note', 'add_task'];
const RECORD_TYPES = ['lead', 'contact', 'account', 'deal', 'any'];
const FIELDS = ['status', 'amount', 'invoiceStatus', 'serviceDate', 'nextActionDate', 'email', 'phone', 'title', 'name'];
const INVOICE = ['', 'Pending', 'Sent', 'Paid', 'Overdue'];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'What to say to the person next, in at most two short sentences that read well aloud. Either ONE question for the most important missing essential, or -- when ready is true -- a plain-English read-back of every operation ending with "Confirm?". No markdown, no lists.',
    },
    ready: {
      type: 'boolean',
      description: 'True only when every operation has its essentials and the person has not said they are still adding details.',
    },
    missing: {
      type: 'array',
      items: { type: 'string' },
      description: 'Short labels for essentials still missing, e.g. "which account", "amount", "due date". Empty when ready.',
    },
    operations: {
      type: 'array',
      description: 'The COMPLETE updated draft: every operation discussed so far that has not been discarded, in the order they should run. Carry forward operations from the previous draft, applying any corrections the person made.',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: OPS },
          summary: { type: 'string', description: 'One short read-back line for just this operation, e.g. "Closed-won deal for Henderson Roofing, $450, invoice pending".' },
          recordType: { type: 'string', enum: RECORD_TYPES, description: 'For update_record, add_note and add_task: the kind of record it is about ("any" if unclear). For create_* use the type being created.' },
          recordHint: { type: 'string', description: 'For update_record, add_note and add_task: the record exactly as the person referred to it ("Henderson", "the Henderson deal", "Sarah from Delta"). Empty for create_* and for tasks not about a record.' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string', description: 'Only if stated. Never guess or construct.' },
          phone: { type: 'string', description: 'Only if stated, as spoken.' },
          title: { type: 'string' },
          company: { type: 'string', description: 'For create_lead/create_contact: the company they work at, if stated.' },
          accountName: { type: 'string', description: 'For create_account: the company name. For create_deal: the account (client company) the deal belongs to.' },
          contactHint: { type: 'string', description: 'For create_deal: the person at the client, if mentioned.' },
          dealName: { type: 'string', description: 'For create_deal: a short name for the job or opportunity, e.g. "Monthly SEO — October". Leave empty if the person gave nothing better than the service.' },
          service: { type: 'string', description: 'For create_deal: what was sold or done, if stated.' },
          amount: { type: 'number', description: 'Money amount in dollars, 0 if not stated.' },
          serviceDate: { type: 'string', description: 'YYYY-MM-DD the work was done, if stated or clearly implied. Empty otherwise.' },
          invoiceStatus: { type: 'string', enum: INVOICE, description: 'Only for deals: Pending (not sent yet), Sent, Paid or Overdue.' },
          stage: { type: 'string', enum: ['', 'open', 'closed_won', 'closed_lost'], description: 'For create_deal: closed_won for work already done or sold; open for a new opportunity.' },
          changes: {
            type: 'array',
            description: 'For update_record: the fields to change and their new values.',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string', enum: FIELDS },
                value: { type: 'string', description: 'New value as text. Dates as YYYY-MM-DD, amounts as plain numbers, invoiceStatus as Pending/Sent/Paid/Overdue, status as the stage name the person said.' },
              },
              required: ['field', 'value'],
            },
          },
          noteText: { type: 'string', description: 'For add_note: the note, written clearly in third person.' },
          taskTitle: { type: 'string', description: 'For add_task: a short imperative title, e.g. "Attach signed agreement to Henderson deal".' },
          taskDueDate: { type: 'string', description: 'For add_task: YYYY-MM-DD, empty if not given yet.' },
          taskKind: { type: 'string', enum: ['follow_up', 'attach_file', 'finish_details', 'other'] },
          incomplete: { type: 'boolean', description: 'True when the person said more details will come later for this record.' },
        },
        required: ['op', 'summary'],
      },
    },
  },
  required: ['reply', 'ready', 'missing', 'operations'],
};

function systemPrompt(referenceDate: string, userName: string) {
  return `You are the assistant inside MKC's CRM. ${userName ? `You are talking with ${userName}, a member of the MKC team.` : 'You are talking with a member of the MKC team.'} They describe what happened with clients -- often by voice, in pieces -- and you turn it into CRM operations they will confirm before anything is saved.

Today is ${referenceDate}. Resolve relative dates ("Friday", "last Tuesday", "in two weeks") to YYYY-MM-DD.

Records: leads (new prospects), contacts (established people), accounts (client companies) and deals (any revenue opportunity, including repeat work for an existing client).

How to work:
- Keep a running draft. Every turn, return the COMPLETE updated list of operations, carrying forward everything from the previous draft and applying corrections ("actually it was 500", "make that Sent").
- Ask only for essentials, one at a time, most important first: for a deal, which account and the amount; for a completed job also the date of service if it isn't obvious; for a task, a due date if none was given; for an update, which record. Do not ask about optional details (email, phone, title, notes).
- Work already done for a client is a deal with stage closed_won, the amount, the date of service and an invoice status (Pending unless they say it was sent or paid). One deal per completed job.
- If they say more details will come later, set incomplete to true on that record and add an add_task with taskKind finish_details due the next working day, so it isn't forgotten.
- Files cannot be attached by voice. When they mention attaching a file, add an add_task with taskKind attach_file linked to the record, and ask for a due date if none was given.
- Never invent names, emails, phone numbers or amounts. Put people and companies exactly as said in recordHint, contactHint or accountName -- the CRM matches them to its records itself.
- Use update_record for changes to an existing record (status, amount, invoice status, service date, next action date, email, phone, title, name), add_note for information to remember, add_task for to-dos and reminders.
- If the person says "cancel", "start over" or "forget it", return an empty operations list.
- Keep reply short and natural for speaking aloud. When ready, reply is a read-back of all operations ending with "Confirm?" (for example: "Creating a closed-won deal for Henderson, 450 dollars, invoice pending. Confirm?").
- If what they said isn't about the CRM, say briefly what you can help with and keep the draft unchanged.`;
}

type Turn = { role: 'user' | 'assistant'; text: string };

function cleanTurns(raw: unknown): Turn[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const turns: Turn[] = [];
  for (const t of raw.slice(-MAX_TURNS)) {
    if (!t || typeof t !== 'object') return null;
    const role = (t as any).role === 'assistant' ? 'assistant' : 'user';
    const text = typeof (t as any).text === 'string' ? (t as any).text.slice(0, MAX_TURN_CHARS).trim() : '';
    if (!text) continue;
    // Gemini wants the conversation to start with the person and to
    // alternate; the CRM can add its own "which one?" lines, so merge
    // back-to-back turns from the same side.
    if (!turns.length && role === 'assistant') continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text = `${last.text}\n${text}`.slice(0, MAX_TURN_CHARS * 2);
    else turns.push({ role, text });
  }
  if (!turns.length || turns[turns.length - 1].role !== 'user') return null;
  return turns;
}

// Keeps only known keys and sane values, so whatever comes back from the
// browser (or the model) can't smuggle extra structure into the next turn.
function cleanOperations(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const out: Record<string, unknown>[] = [];
  for (const o of raw.slice(0, MAX_OPS)) {
    if (!o || typeof o !== 'object' || !OPS.includes((o as any).op)) continue;
    const a = o as any;
    const changes = Array.isArray(a.changes)
      ? a.changes.filter((c: any) => c && FIELDS.includes(c.field)).slice(0, 10).map((c: any) => ({ field: c.field, value: str(c.value, 200) }))
      : [];
    out.push({
      op: a.op,
      summary: str(a.summary, 240),
      recordType: RECORD_TYPES.includes(a.recordType) ? a.recordType : 'any',
      recordHint: str(a.recordHint, 120),
      firstName: str(a.firstName, 80), lastName: str(a.lastName, 80),
      email: str(a.email, 200), phone: str(a.phone, 40), title: str(a.title, 120), company: str(a.company, 160),
      accountName: str(a.accountName, 160), contactHint: str(a.contactHint, 120),
      dealName: str(a.dealName, 160), service: str(a.service, 160),
      amount: typeof a.amount === 'number' && isFinite(a.amount) && a.amount >= 0 && a.amount < 1e9 ? Math.round(a.amount * 100) / 100 : 0,
      serviceDate: date(a.serviceDate),
      invoiceStatus: INVOICE.includes(a.invoiceStatus) ? a.invoiceStatus : '',
      stage: ['', 'open', 'closed_won', 'closed_lost'].includes(a.stage) ? a.stage : '',
      changes,
      noteText: str(a.noteText, 2000),
      taskTitle: str(a.taskTitle, 200), taskDueDate: date(a.taskDueDate),
      taskKind: ['follow_up', 'attach_file', 'finish_details', 'other'].includes(a.taskKind) ? a.taskKind : 'other',
      incomplete: a.incomplete === true,
    });
  }
  return out;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

// Constant-time compare, same helper as the other functions here.
function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req: Request, deps: { fetchImpl?: typeof fetch } = {}) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  const fetchImpl = deps.fetchImpl || fetch;
  try {
    const formSecret = process.env.FORM_SECRET;
    if (!formSecret) return jsonResponse({ error: 'FORM_SECRET is not set on the server.' }, 500);
    if (!safeEqual(req.headers.get('x-form-secret') || '', formSecret)) return jsonResponse({ error: 'Unauthorized.' }, 401);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return jsonResponse({ error: 'GEMINI_API_KEY not set on the server.' }, 500);

    const body = await req.json().catch(() => null);
    const turns = cleanTurns(body && body.messages);
    if (!turns) return jsonResponse({ error: 'Send "messages": the conversation so far, ending with the person\'s latest message.' }, 400);
    const draft = cleanOperations(body.draft && body.draft.operations);
    const referenceDate = typeof body.referenceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.referenceDate)
      ? body.referenceDate : new Date().toISOString().slice(0, 10);
    const userName = typeof body.userName === 'string' ? body.userName.replace(/[^\p{L}\p{M} .'-]/gu, '').slice(0, 60) : '';

    // The draft goes in as the last piece of context, so the model edits
    // it rather than starting over.
    const contents = turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] }));
    contents[contents.length - 1].parts.push({ text: `\n\n[Current draft operations, JSON — update and return the complete list]\n${JSON.stringify(draft)}` });

    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(referenceDate, userName) }] },
        contents,
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.2 },
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      const paused = res.status === 429 || /quota|billing|RESOURCE_EXHAUSTED/i.test(detail);
      return jsonResponse({ error: paused ? 'The assistant is out of Gemini quota right now. Try again later, or type it in the usual forms.' : `Gemini API error (${res.status})`, code: paused ? 'paused' : 'upstream' }, 502);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { return jsonResponse({ error: 'The assistant gave an unreadable answer. Please say that again.' }, 502); }
    return jsonResponse({
      reply: typeof parsed.reply === 'string' ? parsed.reply.slice(0, 600) : '',
      ready: parsed.ready === true,
      missing: Array.isArray(parsed.missing) ? parsed.missing.filter((m: unknown) => typeof m === 'string').slice(0, 8).map((m: string) => m.slice(0, 60)) : [],
      operations: cleanOperations(parsed.operations),
    });
  } catch (e) {
    return jsonResponse({ error: 'Unexpected server error.' }, 500);
  }
}
