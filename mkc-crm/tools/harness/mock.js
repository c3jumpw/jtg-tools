// Shared Playwright setup for the CRM's browser tests and tour screenshots:
// the Worker and ClickUp are stubbed in the page with sample data
// (fixtures.js, all invented), the session is seeded, errors are captured.
const path = require('path');
const fs = require('fs');
const FX = require('./fixtures');
const MEDIA = process.env.CRM_MEDIA || path.join(__dirname, '..', '..', 'media');
const APP = path.join(__dirname, '..', '..', 'index.html');

// Runs inside the page (serialized by addInitScript).
function installMock({ FX, seedSession, opts }) {
  const W = 'https://mkc-crm.c3-jumpw.workers.dev';
  window.__calls = [];
  window.__mockFail = opts.fail || {};          // { 'regex': status }
  const allTasks = () => Object.values(FX.lists).flat();
  const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
  const text = (t, status = 200) => new Response(t, { status, headers: { 'content-type': 'text/plain' } });
  const delay = ms => new Promise(r => setTimeout(r, ms));
  if (seedSession) {
    localStorage.setItem('mkc_session', JSON.stringify({ ...FX.SESSION_USER, ...(opts.user || {}) }));
    localStorage.setItem('mkc_session_token', 'fixture-token');
    // The tour opens itself on a first sign-in; tests that aren't about
    // the tour start as someone who has already seen it.
    // guideSeen seeds once, so a reload in a test sees what the app saved.
    if (opts.guideSeen !== undefined) { const k = 'mkc_guide_' + FX.SESSION_USER.mkcId; if (opts.guideSeen && !localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ version: opts.guideSeen })); }
    else if (!opts.guideFresh) localStorage.setItem('mkc_guide_' + FX.SESSION_USER.mkcId, JSON.stringify({ version: '9999-12-31' }));
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/(^|\/)changelog\.json(\?|$)/.test(url) && opts.changelog) return json(opts.changelog);
    if (!url.startsWith(W)) return realFetch(input, init);
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch (e) { }
    const key = u.pathname + (u.pathname === '/api/clickup' ? ' ' + (body && body.method) + ' ' + (body && body.path) : u.search);
    window.__calls.push({ t: Math.round(performance.now()), method, key, ep: body && body.endpoint, b: body && (body.body !== undefined ? body.body : body) });
    await delay((opts.latencyFor && Object.entries(opts.latencyFor).find(([re]) => new RegExp(re).test(key)) || [0, opts.latency ?? 40])[1]);
    for (const [re, st] of Object.entries(window.__mockFail)) if (new RegExp(re).test(key)) return json({ error: 'injected failure' }, st);
    const p = u.pathname;
    if (p === '/auth/directory') return json(FX.DIRECTORY);
    if (p === '/auth/login') return json({ user: FX.SESSION_USER, token: 'fixture-token' });
    if (p === '/api/sheets') return json({ values: FX.SHEETS[u.searchParams.get('range')] || [] });
    if (p === '/api/sheets/write') return json({ ok: true });
    if (p === '/api/action-templates') return json({});
    if (p.startsWith('/api/action-templates/')) return json({ ok: true });
    if (p === '/api/staging') { const st = u.searchParams.get('status'); return json(st === 'archived' ? [] : FX.STAGING); }
    if (p === '/api/staging/manual') return json({ ok: true, id: 'evt_new' });
    let m;
    if ((m = p.match(/^\/api\/staging\/([^/]+)\/thread$/))) {
      const it = FX.STAGING.find(s => s.id === m[1]);
      if (u.searchParams.get('format') === 'markdown') return text('# Thread\n\n' + (it ? it.body : ''));
      return json(it ? FX.THREADS[it.thread_key] : []);
    }
    if (/^\/api\/staging\/[^/]+\/(archive|assign|correct-call)$/.test(p)) return json({ ok: true, assignedCount: 1 });
    if (p === '/api/scheduled-messages') return json(u.searchParams.get('createdByMkcId') ? FX.SCHEDULED : []);
    if (/^\/api\/scheduled-messages\//.test(p)) return json({ ok: true });
    if (p === '/api/ai') {
      const ep = body && body.endpoint;
      if (ep === 'triage-classify') {
        const raw = (body.body.rawThread || '');
        if (/Missed call|800/.test(raw)) return json({ summary: 'Robocall / spam.', isCrmRelevant: false, confidence: 'high', reason: 'Looks like an automated call.' });
        if (body.body.hasCrmMatch) return json({ summary: 'Wants to move the tasting to Thursday 3pm and see F5 pricing.', isCrmRelevant: true, confidence: 'high', reason: '' });
        return json({ summary: 'Asked about January workshop availability.', isCrmRelevant: true, confidence: 'medium', reason: 'Unknown caller', suggestedName: 'Workshop inquiry' });
      }
      if (ep === 'assistant') {
        const msgs = (body.body && body.body.messages) || [];
        const last = (msgs[msgs.length - 1] || {}).text || '';
        window.__asst = (window.__asst || []).concat([{ last, draft: body.body.draft }]);
        const hit = (opts.assistantScript || []).find(x => new RegExp(x.match, 'i').test(last));
        if (opts.assistantStatus) return json({ error: 'unknown endpoint' }, opts.assistantStatus);
        return json(hit ? hit.resp : { reply: 'Go on.', ready: false, missing: [], operations: (body.body.draft && body.body.draft.operations) || [] });
      }
      if (ep === 'capture-classify') return json({ summary: 'Miles wants a demo next week.', matchedEntryName: 'Miles Whitfield', confidence: 'high', suggestedNextAction: 'Book demo' });
      if (ep === 'catchup-summary') return json({ summary: 'Two calls and a status change this week.' });
      return json({ ok: true, sent: true, text: 'Draft message from fixture.', message: 'Draft message from fixture.' });
    }
    if (p === '/api/clickup') {
      const cp = body.path, cm = body.method || 'GET';
      if ((m = cp.match(/^\/list\/(\d+)\/task/)) && cm === 'GET') {
        const page = Number((cp.match(/page=(\d+)/) || [])[1] || 0);
        return json({ tasks: page ? [] : (FX.lists[m[1]] || []) });
      }
      if ((m = cp.match(/^\/list\/(\d+)\/field/))) return json({ fields: (opts.listFields && opts.listFields[m[1]]) || [] });
      if ((m = cp.match(/^\/list\/(\d+)$/)) && cm === 'GET') return opts.listStatuses && opts.listStatuses[m[1]] ? json({ id: m[1], statuses: opts.listStatuses[m[1]].map((s, i) => ({ status: s, orderindex: i, type: i ? 'custom' : 'open' })) }) : json({ err: 'no statuses in fixture' }, 404);
      if (/^\/list\/\d+\/task$/.test(cp) && cm === 'POST') { window.__newN = (window.__newN || 0) + 1; return json({ id: '86new' + String(window.__newN).padStart(4, '0'), name: body.body && body.body.name, status: { status: (body.body && body.body.status) || 'to do' } }); }
      if (cp === '/team') return json({ teams: [{ id: '90161137399', members: FX.TEAM.map(u => ({ user: u })) }] });
      if (/^\/team\/\d+\/member/.test(cp)) return json({ members: [] });
      if ((m = cp.match(/^\/task\/([^/?]+)\/comment/))) return cm === 'GET' ? json({ comments: (opts.comments && opts.comments[m[1]]) || FX.COMMENTS }) : json({ id: 'cnew' });
      if (/^\/task\/[^/]+\/field\//.test(cp)) return json({});
      if ((m = cp.match(/^\/task\/([^/?]+)/))) {
        if (cm !== 'GET') return json({ id: m[1] });
        const t = allTasks().find(x => x.id === m[1]);
        if (t) return json({ ...t, subtasks: [], attachments: (opts.attachments && opts.attachments[m[1]]) || t.attachments || [] });
        if (m[1] === FX.SESSION_USER.mkcId) return json({ id: m[1], name: 'Dana Reyes', custom_fields: [{ id: 'a', name: 'MKC Public Email', type: 'email', value: 'dana@mkc.example' }, { id: 'b', name: 'MKC Public Phone', type: 'phone', value: '+14705550100' }, { id: 'c', name: 'Personal Email', type: 'email', value: 'dana.home@example.com' }, { id: 'd', name: 'Workspace Passcode', type: 'short_text', value: '1234' }] });
        return json({ err: 'Task not found', ECODE: 'ITEM_013' }, 404);
      }
      return json({});
    }
    return json({ error: 'unmocked ' + p }, 404);
  };
}

async function newPage(browser, { mobile, seedSession = true, opts = {} }) {
  const { devices } = require('playwright');
  const ctxOpts = mobile ? { ...devices['iPhone 14'], timezoneId: 'America/New_York' }
    : { viewport: { width: 1440, height: 900 }, timezoneId: 'America/New_York' };
  if (opts.viewport) ctxOpts.viewport = opts.viewport;
  if (opts.scale) ctxOpts.deviceScaleFactor = opts.scale;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push({ kind: 'pageerror', msg: e.message }));
  page.on('console', m => { if (m.type() === 'error') errors.push({ kind: 'console.error', msg: m.text() }); });
  page.on('dialog', d => { errors.push({ kind: 'dialog', msg: d.type() + ': ' + d.message() }); (page.__dialogAnswer === false ? d.dismiss() : d.accept()); });
  // Serve the app's images from the local media folder; block any other network.
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file:')) return route.continue();
    const mm = url.match(/mkc-crm\/media\/(.+)$/);
    if (mm) { const f = path.join(MEDIA, decodeURIComponent(mm[1])); if (fs.existsSync(f)) return route.fulfill({ path: f }); }
    return route.fulfill({ status: 404, body: '' });
  });
  // The page reads changelog.json next to it; serve the repo's copy.
  if (opts.changelog === undefined) { try { opts = { ...opts, changelog: JSON.parse(fs.readFileSync(path.join(path.dirname(APP), 'changelog.json'), 'utf8')) }; } catch (e) {} }
  await page.addInitScript(installMock, { FX, seedSession, opts });
  page.__errors = errors;
  return { ctx, page, errors };
}

// "Sign in again": reload, keeping what the app saved in localStorage.
// Chromium sometimes drops localStorage written by a file:// page in these
// throwaway test browsers when the page reloads (about 1 reload in 10, even
// after a pause; a real browser keeps it). This carries over exactly what
// the app had saved before the reload, for this and any later load of the
// page, so a test still fails if the app never saved it.
async function reloadKeepingStorage(page) {
  const saved = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
  await page.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, saved);
  await page.reload();
}

module.exports = { newPage, reloadKeepingStorage, FX, APP };
