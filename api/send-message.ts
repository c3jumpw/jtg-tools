// api/send-message.ts
//
// Vercel Edge Function. Holds the Quo and Resend API keys server-side
// (same non-negotiable rule as the Gemini key -- never in client-side
// code) and sends a CRM Action draft AS the specific team member who's
// logged in and sending it, not a shared/generic identity.
//
// This function ONLY sends. It does not write anything to ClickUp --
// logging stays exactly as it already works via logActionSent() in the
// CRM itself, which the frontend calls automatically after a confirmed
// successful send here.
//
// Deploy: lives in the same /api folder as personalize-message.ts, same
// repo, same Vercel project -- auto-deploys on push, nothing extra to
// configure in Vercel beyond the two Environment Variables below.
//
// Env vars needed (Vercel Project Settings -> Environment Variables):
//   QUO_API_KEY      -- from Quo Settings -> API
//   RESEND_API_KEY   -- from Resend Settings -> API Keys
//
// Migrated from SendGrid to Resend: Resend verifies at the DOMAIN level
// (SPF/DKIM), not per-address like SendGrid's Single Sender Verification
// -- once a domain is verified in Resend, ANY address @that domain can
// send with zero further per-person setup. No frontend changes were
// needed for this migration; the request/response contract this
// function exposes is identical to the SendGrid version it replaces.

export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-form-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

const truncate = (s: unknown, max = 2000) => (typeof s === 'string' ? s.slice(0, max) : '');

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Builds the email as simple HTML (needed for the bolded signature name --
// Resend's plain `text` field can't bold anything) with a matching plain-
// text fallback for clients/spam filters that prefer it. Signature is
// deliberately NOT a stored field anywhere -- it's assembled here from
// data that already exists (name/role from the login session, phone/
// email from the same Team Directory lookup that already resolves send
// identity), so there's nothing new to keep in sync or forget to update.
function buildEmailContent(message: string, signature?: { name?: string; role?: string; phone?: string; email?: string }) {
  const bodyHtml = escapeHtml(message).replace(/\n/g, '<br>');
  const bodyText = message;
  let sigHtml = '';
  let sigText = '';
  if (signature && (signature.name || signature.role || signature.phone || signature.email)) {
    const htmlLines: string[] = [];
    const textLines: string[] = [];
    if (signature.name) { htmlLines.push(`<strong>${escapeHtml(signature.name)}</strong>`); textLines.push(signature.name); }
    if (signature.role) { htmlLines.push(escapeHtml(signature.role)); textLines.push(signature.role); }
    if (signature.phone) { htmlLines.push(escapeHtml(signature.phone)); textLines.push(signature.phone); }
    if (signature.email) { htmlLines.push(escapeHtml(signature.email)); textLines.push(signature.email); }
    sigHtml = `<br><br>${htmlLines.join('<br>')}`;
    sigText = `\n\n${textLines.join('\n')}`;
  }
  return {
    html: `<div style="font-family:sans-serif;font-size:14px;color:#111;line-height:1.5">${bodyHtml}${sigHtml}</div>`,
    text: `${bodyText}${sigText}`,
  };
}

// Deliberately well under Resend's documented 40MB total-request limit --
// this runs on a Vercel Edge Function, which has its own (tighter, and
// not precisely documented for every plan/config) request body ceiling.
// Safer to promise a smaller number that reliably works than advertise
// Resend's full limit and have it fail unpredictably for a bigger file.
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB raw file size

// Very loose E.164-ish check -- good enough to fail fast on an obviously
// empty/malformed number before spending a Quo credit on a call that will
// just reject it anyway. Not trying to be a full phone validator here.
function looksLikePhone(s: string) {
  return /^\+?[1-9]\d{7,14}$/.test(s.replace(/[\s()-]/g, ''));
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


    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Request body must be valid JSON.' }, 400);
    }

    const channel = truncate(body.channel, 10); // 'sms' | 'email'
    const message = truncate(body.message, 3000);
    if (!message) {
      return jsonResponse({ error: 'message is required.' }, 400);
    }

    // ───────────────────────── SMS via Quo ─────────────────────────
    if (channel === 'sms') {
      const quoKey = process.env.QUO_API_KEY;
      if (!quoKey) {
        return jsonResponse({ error: 'QUO_API_KEY is not set on this Vercel project.' }, 500);
      }

      const recipientPhone = truncate(body.recipientPhone, 30);
      // Column L on the Team Directory sheet ("MKC Public Phone") is the
      // sender's real number -- normalized to E.164 client-side before
      // this ever gets here. (Column S, "Quo Phone ID", is Quo's own
      // internal Phone Number ID / resource ID for something else
      // entirely -- an earlier version of this function wrongly used
      // that field; corrected.)
      const senderQuoFrom = truncate(body.senderQuoFrom, 30);
      if (!recipientPhone || !looksLikePhone(recipientPhone)) {
        return jsonResponse({ error: 'This entry has no valid phone number on file to send an SMS to.' }, 400);
      }
      if (!senderQuoFrom || !looksLikePhone(senderQuoFrom)) {
        return jsonResponse({ error: 'Your Quo number could not be found (check the Team Directory sheet, column L) -- cannot send as you specifically.' }, 400);
      }

      const quoRes = await fetch('https://api.quo.com/v1/messages', {
        method: 'POST',
        headers: {
          // Quo's docs show the raw key as the Authorization header value,
          // no "Bearer " prefix.
          'Authorization': quoKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: message,
          from: senderQuoFrom,
          to: [recipientPhone],
        }),
      });

      const quoText = await quoRes.text();
      let quoJson: unknown;
      try { quoJson = JSON.parse(quoText); } catch { quoJson = quoText; }

      // Quo returns 202 Accepted on a successfully queued send.
      if (quoRes.status !== 202) {
        return jsonResponse({ error: `Quo API error (${quoRes.status})`, detail: quoJson }, 502);
      }

      return jsonResponse({ sent: true, channel: 'sms', detail: quoJson }, 200);
    }

    // ─────────────────────── Email via Resend ───────────────────────
    if (channel === 'email') {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) {
        return jsonResponse({ error: 'RESEND_API_KEY is not set on this Vercel project.' }, 500);
      }

      const recipientEmail = truncate(body.recipientEmail, 200);
      const senderEmail = truncate(body.senderEmail, 200); // must be @ a domain verified in Resend
      const senderName = truncate(body.senderName, 100) || 'MKC';
      const subject = truncate(body.subject, 200) || 'A quick note';

      if (!recipientEmail || !recipientEmail.includes('@')) {
        return jsonResponse({ error: 'This entry has no valid email address on file to send to.' }, 400);
      }
      if (!senderEmail || !senderEmail.includes('@')) {
        return jsonResponse({ error: 'Your sender email could not be found (check the Team Directory sheet, column Q) -- cannot send as you specifically.' }, 400);
      }

      // Signature is optional and entirely assembled from data the
      // frontend already has (login session + the same sheet lookup that
      // resolves send identity) -- nothing new to store or keep in sync.
      const sig = body.signature as { name?: unknown; role?: unknown; phone?: unknown; email?: unknown } | undefined;
      const signature = sig ? {
        name: truncate(sig.name, 100),
        role: truncate(sig.role, 100),
        phone: truncate(sig.phone, 30),
        email: truncate(sig.email, 200),
      } : undefined;
      const { html, text } = buildEmailContent(message, signature);

      // Single attachment only, base64-encoded by the frontend, capped
      // well under Resend's own limit for the reason noted above.
      let attachments: { filename: string; content: string }[] | undefined;
      const att = body.attachment as { filename?: unknown; contentBase64?: unknown } | undefined;
      if (att && typeof att.contentBase64 === 'string' && att.contentBase64) {
        const approxBytes = Math.floor(att.contentBase64.length * 0.75); // base64 -> raw byte estimate
        if (approxBytes > MAX_ATTACHMENT_BYTES) {
          return jsonResponse({ error: `Attachment is too large (max ${(MAX_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0)}MB) -- for bigger files, send through a regular mail client instead.` }, 400);
        }
        attachments = [{
          filename: truncate(att.filename, 200) || 'attachment',
          content: att.contentBase64,
        }];
      }

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${senderName} <${senderEmail}>`,
          to: [recipientEmail],
          subject,
          html,
          text,
          ...(attachments ? { attachments } : {}),
        }),
      });

      const resendText = await resendRes.text();
      let resendJson: unknown;
      try { resendJson = JSON.parse(resendText); } catch { resendJson = resendText; }

      // Resend always returns a real JSON body (an {id} on success),
      // unlike SendGrid's empty-202 -- simpler to check resendRes.ok
      // directly rather than a specific status code.
      if (resendRes.ok) {
        return jsonResponse({ sent: true, channel: 'email', detail: resendJson }, 200);
      }

      // Most likely real-world failure: the sender's DOMAIN isn't
      // verified in Resend yet -- surfaced distinctly, same spirit as
      // the old SendGrid Single Sender Verification 403 case, just a
      // per-domain check instead of per-address now.
      if (resendRes.status === 403) {
        return jsonResponse({
          error: `Resend rejected this send (403) -- most likely the domain on "${senderEmail}" isn't verified yet. Check Resend -> Domains.`,
          detail: resendJson,
        }, 502);
      }
      if (resendRes.status === 401) {
        return jsonResponse({ error: 'Resend rejected the API key (401) -- check RESEND_API_KEY in Vercel.', detail: resendJson }, 502);
      }

      return jsonResponse({ error: `Resend API error (${resendRes.status})`, detail: resendJson }, 502);
    }

    return jsonResponse({ error: 'channel must be "sms" or "email".' }, 400);

  } catch (e) {
    return jsonResponse({ error: 'Unexpected server error.', detail: String(e) }, 500);
  }
}
