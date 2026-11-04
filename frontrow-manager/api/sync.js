import { timingSafeEqual } from 'node:crypto';
import { select, json, originAllowed, route } from '../lib/core.js';
import { requireSession } from '../lib/auth.js';
import { requirePower } from '../lib/access.js';
import { audit } from '../lib/pipeline.js';
import { runSync, importFromClickUp } from '../lib/sync.js';
import { clickupAvailable } from '../lib/clickup.js';
import { describeContacts } from '../lib/invites.js';

/* ClickUp sync.
 *
 *   GET                       recent runs and whether ClickUp is connected
 *   POST                      full sync now (managers and super admins)
 *   POST { clickupId }        import one contact or account (the CRM's
 *                             "Add to Frontrow" button lands here)
 *   GET  with Authorization: Bearer $CRON_SECRET   nightly full sync
 */

export default route(async (request) => {
  const auth = Buffer.from(request.headers.get('authorization') || '');
  const cron = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${cron || ''}`);
  if (request.method === 'GET' && cron && auth.length === expected.length && timingSafeEqual(auth, expected)) {
    if (!clickupAvailable()) return json(503, { error: 'ClickUp is not connected.' });
    return json(200, await runSync({}));
  }

  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  const session = await requireSession(request);

  if (request.method === 'GET') {
    const runs = await select('frontrow', 'sync_runs', 'select=id,started_at,finished_at,status,counts,error&order=started_at.desc&limit=5') || [];
    return json(200, { connected: clickupAvailable(), runs });
  }
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  if (!clickupAvailable()) return json(503, { error: 'ClickUp isn’t connected yet. Add CLICKUP_API_TOKEN in Vercel, then redeploy.', code: 'clickup_off' });

  const text = await request.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { return json(400, { error: 'Bad request.' }); }

  if (body.clickupId) {
    requirePower(session, 'edit', 'Your role can’t add people to Frontrow.');
    const id = String(body.clickupId).trim();
    if (!/^[a-z0-9]{4,20}$/i.test(id)) return json(400, { error: 'That doesn’t look like a ClickUp task ID.' });
    let result;
    try {
      result = await importFromClickUp(id);
    } catch (e) {
      // Our own "not a contact or account" error carries a readable message;
      // ClickUp's raw errors don't, so they get a plain one.
      if (e.status === 400 && !String(e.message).startsWith('ClickUp ')) return json(400, { error: e.message });
      if (e.status === 404 || e.status === 400 || e.status === 401) return json(404, { error: 'ClickUp couldn’t find that entry (or the Frontrow token can’t see it).' });
      if (e.status === 429) return json(503, { error: 'ClickUp is busy. Try again in a minute.' });
      throw e;
    }
    await audit(session, 'sync.import', id, { kind: result.kind, contacts: result.contactIds.length, companies: result.companyIds.length });
    return json(200, { ...result, contacts: await describeContacts(result.contactIds) });
  }

  requirePower(session, 'manageClients', 'Only managers can run a full ClickUp sync.');
  const result = await runSync({ startedBy: session.personId || null });
  await audit(session, 'sync.run', result.runId, result.counts);
  return json(200, result);
});
