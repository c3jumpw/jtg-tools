/* Gemini drafting for portal pages.
 *
 * The subscription is paused at the time of writing, so "paused" is a normal,
 * expected state rather than an error. Three things mean paused:
 *   - GEMINI_API_KEY is not set,
 *   - GEMINI_PAUSED=1 is set (a switch to turn drafting off without removing
 *     the key), or
 *   - Google answers in a way that means billing or quota, not a bad request.
 * In every paused case the route answers 503 with { paused: true }, and the
 * composer points the user at the copy-prompt path, which needs no key.
 */

export const DEFAULT_MODEL = 'gemini-3.6-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export function geminiConfig(env = process.env) {
  const key = env.GEMINI_API_KEY || '';
  const forcedOff = /^(1|true|yes|on)$/i.test(String(env.GEMINI_PAUSED || '').trim());
  return {
    key,
    model: (env.GEMINI_MODEL || DEFAULT_MODEL).trim(),
    available: Boolean(key) && !forcedOff,
    reason: !key ? 'no_key' : forcedOff ? 'switched_off' : null
  };
}

/** Distinguishes "the subscription is paused" from "something broke". */
export function classifyFailure(status, bodyText) {
  const body = String(bodyText || '');
  if (status === 429) return 'paused';
  if (/RESOURCE_EXHAUSTED|quota|billing|BILLING_DISABLED|SERVICE_DISABLED|has not been used|is disabled|suspended/i.test(body)) return 'paused';
  if (status === 403 && /PERMISSION_DENIED|API_KEY|api key/i.test(body)) return 'paused';
  if (status === 400 && /API key not valid|API_KEY_INVALID|expired/i.test(body)) return 'paused';
  return 'error';
}

/** Pulls the HTML document out of a model reply that may include fences or a preamble. */
export function extractHtml(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:html)?[ \t]*\r?\n([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  const end = t.search(/<\/html>\s*/i);
  if (end >= 0) t = t.slice(0, end + '</html>'.length);
  return t.trim();
}

/**
 * @returns {Promise<{ok:true, html:string, model:string} | {ok:false, paused:boolean, message:string}>}
 */
export async function draftWithGemini(prompt, { env = process.env, fetchImpl = fetch, timeoutMs = 50000 } = {}) {
  const cfg = geminiConfig(env);
  if (!cfg.available) {
    return { ok: false, paused: true, message: cfg.reason === 'switched_off'
      ? 'Gemini drafting is switched off for now.'
      : 'Gemini drafting is paused until the subscription is renewed.' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      // Key in a header rather than the URL, so it never lands in request logs.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 16384 }
      })
    });
  } catch (e) {
    clearTimeout(timer);
    const timedOut = e && e.name === 'AbortError';
    return { ok: false, paused: false, message: timedOut
      ? 'Gemini took too long to answer. Try again, or copy the prompt instead.'
      : 'Could not reach Gemini. Try again, or copy the prompt instead.' };
  }
  clearTimeout(timer);
  const bodyText = await res.text();
  if (!res.ok) {
    const kind = classifyFailure(res.status, bodyText);
    console.error('gemini failed', res.status, bodyText.slice(0, 300));
    return kind === 'paused'
      ? { ok: false, paused: true, message: 'Gemini is unavailable on the current subscription. Copy the prompt instead.' }
      : { ok: false, paused: false, message: `Gemini returned an error (${res.status}). Try again, or copy the prompt instead.` };
  }
  let data;
  try { data = JSON.parse(bodyText); } catch { data = null; }
  const cand = data && data.candidates && data.candidates[0];
  const text = cand && cand.content && Array.isArray(cand.content.parts)
    ? cand.content.parts.map((p) => p.text || '').join('')
    : '';
  const html = extractHtml(text);
  if (!html || !/<html[\s>]|<!doctype html/i.test(html)) {
    const reason = cand && cand.finishReason ? ` (${cand.finishReason})` : '';
    return { ok: false, paused: false, message: `Gemini did not return a usable page${reason}. Try again or adjust the notes.` };
  }
  return { ok: true, html, model: cfg.model };
}
