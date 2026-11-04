import { patch, json, route, originAllowed } from '../lib/core.js';
import { readCookie, hashToken, sessionCookie, COOKIE_NAME, requireSession } from '../lib/auth.js';
import { CAN } from '../lib/access.js';
import { geminiConfig } from '../lib/gemini.js';

export default route(async (request) => {
  const action = (new URL(request.url).searchParams.get('action') || '').toLowerCase();

  if (request.method === 'POST' && action === 'logout') {
    // Cross-site pages may not sign people out.
    if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
    const token = readCookie(request, COOKIE_NAME);
    if (token) {
      // Expire rather than delete, so the session stays in the record.
      try { await patch('core', 'sessions', `token_hash=eq.${hashToken(token)}`, { expires_at: new Date(Date.now() - 1000).toISOString() }); }
      catch (e) { /* signing out still clears the cookie */ }
    }
    return json(200, { ok: true }, { 'Set-Cookie': sessionCookie('', { clear: true }) });
  }

  if (request.method !== 'GET') return json(405, { error: 'Method not allowed.' });

  let session;
  try {
    session = await requireSession(request);
  } catch (e) {
    if (e instanceof Response && (e.status === 401 || e.status === 403)) {
      return json(200, { authenticated: false, revoked: e.status === 403 });
    }
    throw e;
  }
  const g = geminiConfig();
  return json(200, {
    authenticated: true,
    email: session.email,
    fullName: session.fullName,
    personId: session.personId,
    role: session.role,
    can: CAN[session.role],
    gemini: { available: g.available, model: g.model, reason: g.reason },
    frontrowUrl: (process.env.FRONTROW_URL || 'https://frontrow.jtgworkspace.com').replace(/\/$/, '')
  });
});
