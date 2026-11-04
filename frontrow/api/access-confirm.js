import { select, patch, json, clean, readJson, originAllowed, rateLimited, clientIp, route } from '../lib/core.js';
import { hashToken, TOKEN_RE } from '../lib/tokens.js';
import { contactByEmail, orgsByIds } from '../lib/directory.js';
import { clickupAvailable, createContact, comment } from '../lib/clickup.js';

/* POST { t, fullName, companyName, message } — confirm an access request.
 *
 * Reached only from the link in the "we couldn't find an active account"
 * email, so the mailbox is proven to be theirs before anything reaches the
 * CRM. Then, in ClickUp: a note on their existing contact entry, or a new
 * contact entry with the note. The request also appears in Frontrow
 * Manager → Requests, where staff can approve it in one step.
 */

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (rateLimited(`fr-confirm:${clientIp(request)}`, 10, 60 * 60_000)) return json(429, { error: 'Too many requests. Please try again later.' });
  const { body, error } = await readJson(request, 6000);
  if (error) return error;
  const raw = typeof body.t === 'string' ? body.t : '';
  if (!TOKEN_RE.test(raw)) return json(400, { ok: false, code: 'badlink', error: 'That link isn’t valid.' });
  const fullName = clean(body.fullName, 120);
  const companyName = clean(body.companyName, 200);
  const message = clean(body.message, 2000);
  if (!fullName) return json(400, { error: 'Please add your name.' });

  const hash = hashToken(raw);
  const rows = await select('frontrow', 'access_requests', `select=*&confirm_token_hash=eq.${hash}`);
  const req = rows && rows[0];
  if (!req) return json(400, { ok: false, code: 'badlink', error: 'That link isn’t valid.' });
  if (req.status !== 'unconfirmed') return json(400, { ok: false, code: 'used', error: 'This request has already been sent.' });
  if (new Date(req.confirm_expires_at).getTime() <= Date.now()) return json(400, { ok: false, code: 'expired', error: 'That link has expired. Ask again from the sign-in page.' });

  // Claim it first so a double tap can't create two CRM entries.
  const claimed = await patch('frontrow', 'access_requests', `id=eq.${req.id}&status=eq.unconfirmed`, {
    status: 'confirmed', confirmed_at: new Date().toISOString(), full_name: fullName, company_name: companyName, message
  });
  if (!claimed || !claimed.length) return json(400, { ok: false, code: 'used', error: 'This request has already been sent.' });

  const [org] = req.organization_id ? await orgsByIds([req.organization_id]) : [null];
  const note = `Frontrow access request${org ? ` (${org.name} portal)` : ''}: ${fullName}${companyName ? `, ${companyName}` : ''} <${req.email}>.` +
    `${message ? ` Message: "${message}"` : ''} Not linked to an active account yet — approve it in Frontrow Manager → Requests, or link them to an active account in ClickUp.`;

  let taskId = null;
  if (clickupAvailable()) {
    const existing = await contactByEmail(req.email);
    try {
      taskId = existing && existing.clickup_contact_id
        ? existing.clickup_contact_id
        : await createContact({ name: fullName, email: req.email, orgLabel: org && org.clickup_label });
    } catch (e) {
      console.error('clickup create contact failed', e.message);
    }
    if (taskId) {
      await comment(taskId, note);
      await patch('frontrow', 'access_requests', `id=eq.${req.id}`, { clickup_task_id: taskId });
    }
  }
  return json(200, { ok: true });
});
