import { select, esc, route } from '../lib/core.js';
import { requireSession } from '../lib/auth.js';
import { loadVisibleCompany } from '../lib/access.js';
import { loadUpdate } from '../lib/pipeline.js';
import { asDocument, VIEW_HEADERS } from '../lib/sanitize.js';

/* Staff preview of a stored page, drafts included.
 *
 * Stored HTML is only ever served from this route, never inlined into the
 * app, and always under VIEW_HEADERS: a CSP `sandbox` gives it an opaque
 * origin with no scripts, forms or navigation, so even a page that slipped
 * past the sanitiser cannot read the session or act as the signed-in user.
 * vercel.json keeps the site-wide headers off this path so they don't fight.
 * Errors come back as small HTML pages because this loads inside an iframe. */

function page(status, title, message) {
  const html = asDocument(`<h1 style="font-size:20px">${esc(title)}</h1><p>${esc(message)}</p>`, title);
  return new Response(html, { status, headers: VIEW_HEADERS });
}

export default route(async (request) => {
  if (request.method !== 'GET') return page(405, 'Not available', 'Use the preview button in the Frontrow Manager.');
  let session;
  try {
    session = await requireSession(request);
  } catch (e) {
    return page(401, 'Signed out', 'Sign in to the Frontrow Manager again to preview this page.');
  }
  const id = new URL(request.url).searchParams.get('id');
  let u;
  try {
    u = await loadUpdate(id, { select });
    await loadVisibleCompany(session, u.company_id);
  } catch (e) {
    if (e instanceof Response) return page(e.status === 400 ? 400 : 404, 'Not found', 'This update does not exist or is not one of your clients.');
    throw e;
  }
  const body = String(u.body_html || '').trim();
  if (!body) {
    const summary = String(u.summary || '').trim();
    return new Response(asDocument(
      `<h1 style="font-size:22px">${esc(u.title || 'Untitled')}</h1>` +
      (summary ? `<p>${esc(summary)}</p>` : '<p style="color:#6b7280">No page yet. Paste or draft the HTML, then save.</p>'),
      u.title), { status: 200, headers: VIEW_HEADERS });
  }
  return new Response(asDocument(body, u.title), { status: 200, headers: VIEW_HEADERS });
});
