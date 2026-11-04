import { json, clean, cleanBlock, readJson, originAllowed, rateLimited, route } from '../lib/core.js';
import { requireSession } from '../lib/auth.js';
import { requirePower, loadVisibleCompany } from '../lib/access.js';
import { audit } from '../lib/pipeline.js';
import { sanitizeHtml } from '../lib/sanitize.js';
import { geminiConfig, draftWithGemini } from '../lib/gemini.js';
import { buildPrompt, formatById, PROMPT_VERSION } from '../js/prompts.js';
import { orgsByIds } from '../lib/directory.js';

/* "Draft with Gemini" in the composer.
 *
 *   GET   availability — the composer asks before showing the button as live
 *   POST  { format, companyId, title, notes } -> { html }
 *
 * The prompt is built by js/prompts.js, the same module the browser uses
 * for "Copy prompt", so the copied prompt and the Gemini draft never drift
 * apart. The result is sanitised before it leaves the server and is NOT
 * saved: it fills the composer, and the person reviews and saves it like
 * anything they pasted. While the subscription is paused this answers 503
 * { paused: true } and the composer points at Copy prompt instead. */

const MAX_NOTES = 20000;

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  const session = await requireSession(request);

  if (request.method === 'GET') {
    const g = geminiConfig();
    return json(200, { available: g.available, model: g.model, reason: g.reason, promptVersion: PROMPT_VERSION });
  }
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  requirePower(session, 'assist', 'Your role cannot draft client pages.');
  // Each draft costs money once the subscription is back; keep a person to a
  // sensible pace (20 an hour) so a stuck button can't run up a bill.
  if (rateLimited(`pm-assist:${session.personId || session.email}`, 20, 60 * 60 * 1000)) {
    return json(429, { error: 'That’s a lot of drafts in an hour. Wait a little, or copy the prompt instead.' });
  }

  const { body, error } = await readJson(request, 60000);
  if (error) return error;
  const format = formatById(body.format);
  if (!format) return json(400, { error: 'Choose update, task or guide.' });
  const notes = cleanBlock(body.notes, MAX_NOTES + 1);
  if (!notes.trim()) return json(400, { error: 'Add your notes first — Gemini only writes from what you give it.' });
  if (notes.length > MAX_NOTES) return json(400, { error: `Notes are limited to ${MAX_NOTES.toLocaleString('en-US')} characters.` });
  const company = await loadVisibleCompany(session, body.companyId);

  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  const [org] = await orgsByIds([company.organization_id]);
  const prompt = buildPrompt(format.id, {
    company: {
      name: company.name,
      orgName: org ? org.name : '',
      accent: company.branding && company.branding.accent,
      orgAccent: org && org.branding && org.branding.accent
    },
    title: clean(body.title, 200),
    notes,
    sender: session.fullName && !session.fullName.includes('@') ? session.fullName : '',
    date
  });

  const result = await draftWithGemini(prompt);
  if (!result.ok) {
    return json(result.paused ? 503 : 502, { error: result.message, paused: Boolean(result.paused) });
  }
  const html = sanitizeHtml(result.html);
  await audit(session, 'assist.draft', company.id, {
    company_id: company.id, format: format.id, model: result.model, prompt_version: PROMPT_VERSION,
    notes_chars: notes.length, html_chars: html.length
  });
  return json(200, { html, model: result.model, format: format.id });
});
