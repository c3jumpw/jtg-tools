// Makes the tour's screenshots: one desktop and one phone picture per slide
// in GUIDE_STEPS (index.html), taken from the app running on invented
// sample data (../harness/fixtures.js), never from real records.
//
//   node guide/make.js            all slides
//   node guide/make.js today job  only these slides
//
// Writes ../../media/guide/d/<id>.jpg (desktop), ../../media/guide/m/<id>.jpg
// (phone) and ../../media/guide/manifest.json, which records the app it was
// made from so guide/check.js can tell when the pictures are out of date.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// Pictures are taken at a fixed moment (sample data is dated relative to
// it), so the same app always gives the same pictures and the GitHub action
// only commits when something on screen really changed.
const FIXED_NOW = Date.parse('2026-11-18T14:30:00Z');
const RealDate = Date;
global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED_NOW])); } static now() { return FIXED_NOW; } };
const { newPage, FX, APP } = require('../harness/mock');
global.Date = RealDate;

const OUT = path.join(__dirname, '..', '..', 'media', 'guide');
const only = process.argv.slice(2);

// ── sample data the slides need on top of the shared fixtures ──────────
const PIPE = '901710326878';
const INV = { id: 'inv-field', name: 'Invoice Status', type: 'drop_down', type_config: { options: ['Pending', 'Sent', 'Paid', 'Overdue'].map((n, i) => ({ id: 'io' + i, name: n, orderindex: i })) } };
const SVC = { id: 'svc-field', name: 'Service Date', type: 'date' };
FX.lists[PIPE].forEach((t, i) => {
  if (!t.custom_fields.some(f => f.id === INV.id)) t.custom_fields.push({ ...INV, value: [0, 1, 2, 3, null][i % 5] }, { ...SVC, value: String(Date.now() - (i + 2) * 864e5) });
});
const listFields = { [PIPE]: [INV, SVC] };
const assistantScript = [
  { match: 'smith', resp: { reply: 'Logging a completed job for Northside Dental Group: $450, service today, invoice pending, plus a task to send the invoice tomorrow. Shall I save it?', ready: true, missing: [], operations: [
    { op: 'create_deal', summary: 'Completed job for Northside Dental Group, $450, invoice pending', accountName: 'Northside Dental Group', stage: 'closed_won', service: 'Monthly SEO', serviceDate: new Date().toISOString().slice(0, 10), amount: 450, invoiceStatus: 'Pending' },
    { op: 'add_task', summary: 'Send the invoice, due tomorrow', recordType: 'deal', recordHint: 'Northside', taskTitle: 'Send invoice', taskDueDate: new Date(Date.now() + 864e5).toISOString().slice(0, 10), taskKind: 'follow_up' }] } },
];

// ── per-slide set-up: what to open, and what to ring ───────────────────
// `target` is a CSS selector, or "js:<expression>" evaluated in the page to
// find the element; no target means the whole screen is the point.
const firstOf = type => `(S.entries.${type}||[]).find(t=>!t.parent).id`;
const settingsSection = title => `[...document.querySelectorAll('#view-settings h3')].find(h=>h.textContent.trim()===${JSON.stringify(title)}).closest('.settings-section')`;
const inSettings = title => 'js:' + settingsSection(title);
const openRecord = (type, tab) => async p => {
  await p.evaluate(`openProfile(${firstOf(type)},'${type}')`);
  await p.waitForSelector('#profile-panel.open', { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(500);
  if (tab) { await p.evaluate(`switchPfTab('${tab}',document.querySelector(".pf-tab[onclick*='${tab}']"))`); await p.waitForTimeout(400); }
};
// On a phone the list filters fold away behind a Filters button.
const showFilters = (p, type) => p.evaluate(t => { const tb = document.getElementById('tb-' + t); const btn = tb && tb.querySelector('.filter-toggle'); if (btn && btn.offsetParent && !tb.classList.contains('show-filters')) btn.click(); }, type);
const view = v => async p => { await p.evaluate(`switchView('${v}')`); await p.waitForTimeout(450); };
const settings = title => async p => {
  await view('settings')(p);
  await p.evaluate(`(${settingsSection(title)}).scrollIntoView({block:'start'})`);
  await p.evaluate(`document.getElementById('content')&&(document.getElementById('content').scrollTop-=12)`);
  await p.waitForTimeout(300);
};

const STEPS = {
  today: { setup: view('dashboard'), target: '#dash-today' },
  myday: { setup: view('myday') },
  mywork: { setup: view('mywork') },
  lists: { setup: async p => { await view('leads')(p); await p.evaluate("setViewMode('leads','list')"); await showFilters(p, 'leads'); }, target: '#tb-leads' },
  board: { setup: async p => { await view('pipeline')(p); await p.evaluate("setViewMode('pipeline','kanban',document.querySelector(\"#view-pipeline .vt-btn[onclick*='kanban']\"))"); await p.waitForTimeout(300); }, target: "#view-pipeline .view-toggle" },
  bulk: { setup: async p => { await view('leads')(p); await p.evaluate("setViewMode('leads','list')"); await p.click('#tb-leads-body tr:nth-child(1) input[type=checkbox]'); await p.click('#tb-leads-body tr:nth-child(2) input[type=checkbox]'); await p.waitForTimeout(250); }, target: '#bulk-bar-leads' },
  'new-entry': { setup: async p => { await p.evaluate("openNewEntryModal('Lead')"); await p.waitForTimeout(300); }, target: '#entry-modal .modal' },
  record: { setup: openRecord('leads'), target: '#profile-panel .pf-header' },
  'log-activity': { setup: async p => { await openRecord('leads')(p); await p.evaluate('openActivityModal()'); await p.waitForTimeout(350); }, target: '#activity-modal .modal' },
  message: { setup: openRecord('leads', 'actions'), target: '#pf-body' },
  activity: { setup: openRecord('leads', 'activity'), target: '#pf-body' },
  'related-tasks': { setup: openRecord('leads', 'tasks'), target: '#pf-body' },
  catchup: { setup: async p => { await openRecord('leads')(p); await p.evaluate('openCatchUpModal()'); await p.waitForTimeout(900); }, target: '#catchup-modal .modal' },
  'close-deal': { setup: async p => { await openRecord('pipeline')(p); await p.evaluate('openClosedWonModal()'); await p.waitForTimeout(350); }, target: '#closedwon-modal .modal' },
  job: { setup: async p => {
    await p.evaluate('openJobModal()'); await p.waitForTimeout(300);
    await p.evaluate(() => { const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } }; set('job-account', 'Northside Dental Group'); set('job-amount', '450'); set('job-service', 'Monthly SEO'); });
    await p.waitForTimeout(200);
  }, target: '#job-modal .modal' },
  invoices: { setup: view('dashboard'), target: '#dash-invoices' },
  assistant: { setup: async p => {
    await p.evaluate('openAssistant()'); await p.waitForTimeout(300);
    await p.fill('#asst-text', 'Finished the Smith job at Northside Dental, $450, invoice pending, remind me to send the invoice tomorrow');
    await p.evaluate('asstSend()'); await p.waitForTimeout(900);
  }, target: '#assistant-panel' },
  inbox: { setup: view('qcinbox') },
  capture: { setup: async p => { await p.evaluate('openQuickCapture()'); await p.waitForTimeout(300); await p.fill('#qcap-text', 'Ran into Miles at the expo, wants a demo next week').catch(() => {}); }, target: '#quick-capture-modal .modal' },
  'action-hub': { setup: view('tasks') },
  cmdk: { setup: async p => { await p.evaluate('openCmdk()'); await p.waitForTimeout(200); await p.keyboard.type('nor'); await p.waitForTimeout(300); }, target: '#cmdk .cmdk-box' },
  frontrow: { setup: openRecord('contacts'), target: '#pf-frontrow-btn' },
  phone: { setup: async p => { await p.evaluate('openCreateSheet()'); await p.waitForTimeout(350); }, target: '#create-sheet .cs-box' },
  'whats-new': { setup: async p => {
    await p.evaluate("loadChangelog().then(()=>openChanges(CL.entries.filter(e=>['jobs-invoices','assistant','activity-files'].includes(e.id)),'new'))");
    await p.waitForFunction(() => !document.getElementById('changes').hidden);
    await p.waitForTimeout(700);
  }, target: '#changes .chg-dialog' },
  finish: { setup: view('resources'), target: '#guide-cta' },
  changelog: { setup: async p => { await view('changelog')(p); await p.waitForSelector('#changelog-list .cl-entry'); await p.evaluate("clSetFilter('order','newest')"); await p.waitForTimeout(250); }, target: '#view-changelog .cl-tools' },
  'admin-team-view': { setup: async p => { await view('pipeline')(p); await p.evaluate("setViewMode('pipeline','list',document.querySelector(\"#view-pipeline .vt-btn[onclick*='list']\"))"); await showFilters(p, 'pipeline'); await p.waitForTimeout(250); }, target: '#fs-assignee-pipeline' },
  'settings-team': { setup: settings('Team Management'), target: inSettings('Team Management') },
  'settings-dictation': { setup: settings('CRM Dictation Reader'), target: inSettings('CRM Dictation Reader') },
  'settings-templates': { setup: settings('Message Templates'), target: inSettings('Message Templates') },
  'settings-health': { setup: settings('Connection Status'), target: inSettings('Connection Status') },
  'super-templates': { setup: async p => {
    await settings('Message Templates')(p);
    await p.evaluate("(()=>{const row=document.querySelector('#template-editor-list [onclick^=toggleTemplateEditor]');row.click();row.parentElement.scrollIntoView({block:'center'});})()");
    await p.waitForTimeout(300);
  }, target: "js:document.querySelector('#template-editor-list [onclick^=toggleTemplateEditor]').parentElement" },
  'super-access': { setup: async p => { await settings('Team Management')(p); await p.evaluate('openAddTeamMemberModal()'); await p.waitForTimeout(300); await p.evaluate("document.getElementById('atm-access').scrollIntoView({block:'center'})"); }, target: "js:document.getElementById('atm-access').closest('.form-group')" },
  'super-data': { setup: settings('Data Maintenance'), target: inSettings('Data Maintenance') },
};

// Puts the app back to a neutral state between slides.
async function reset(page) {
  await page.evaluate(() => {
    try { if (typeof closeGuide === 'function') closeGuide(); } catch (e) {}
    try { if (typeof closeChanges === 'function') closeChanges(); } catch (e) {}
    try { if (typeof clSetFilter === 'function') { CL.filter = { q: '', type: '', audience: '', order: 'oldest' }; } } catch (e) {}
    document.querySelectorAll('.modal-overlay').forEach(o => { o.style.display = 'none'; });
    try { if (document.getElementById('profile-panel')?.classList.contains('open')) closeProfile(); } catch (e) {}
    try { if (typeof closeAssistant === 'function') closeAssistant(); } catch (e) {}
    try { if (typeof closeCmdk === 'function') closeCmdk(); } catch (e) {}
    try { if (typeof closeCreateSheet === 'function') closeCreateSheet(); } catch (e) {}
    document.querySelectorAll('input[type=checkbox]:checked').forEach(c => { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
    try { S._selected && Object.values(S._selected).forEach(s => s.clear && s.clear()); } catch (e) {}
    document.getElementById('__guide_ring')?.remove();
    document.querySelectorAll('.toast').forEach(t => t.remove());
  });
  await page.evaluate("switchView('dashboard')");
  await page.waitForTimeout(150);
}

async function ring(page, target) {
  if (!target) return false;
  return page.evaluate(t => {
    // eslint-disable-next-line no-new-func
    const el = t.startsWith('js:') ? new Function('return (' + t.slice(3) + ')')() : document.querySelector(t);
    if (!el) return false;
    el.scrollIntoView({ block: el.getBoundingClientRect().height < innerHeight * 0.7 ? 'center' : 'start', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const pad = 6;
    const box = document.createElement('div');
    box.id = '__guide_ring';
    const x = Math.max(2, r.left - pad), y = Math.max(2, r.top - pad);
    const w = Math.min(innerWidth - x - 2, r.width + pad * 2), h = Math.min(innerHeight - y - 2, r.height + pad * 2);
    Object.assign(box.style, { position: 'fixed', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', border: '3px solid #2297F9', borderRadius: '12px', boxShadow: '0 0 0 9999px rgba(15,23,42,.22)', zIndex: 2147483646, pointerEvents: 'none' });
    document.body.appendChild(box);
    return true;
  }, target);
}

(async () => {
  const html = fs.readFileSync(APP);
  const browser = await chromium.launch();
  // No timestamp: the file only changes when the app or a picture does, so
  // the GitHub action has nothing to commit when nothing changed.
  const manifest = { app: 'mkc-crm/index.html', appHash: crypto.createHash('sha256').update(html).digest('hex'), slides: {} };
  const old = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')); } catch (e) { return null; } })();
  if (only.length && old) manifest.slides = old.slides || {};
  const problems = [];
  for (const device of ['d', 'm']) {
    const mobile = device === 'm';
    fs.mkdirSync(path.join(OUT, device), { recursive: true });
    const { page, ctx, errors } = await newPage(browser, { mobile, opts: mobile ? { scale: 2, listFields, assistantScript } : { viewport: { width: 1280, height: 800 }, listFields, assistantScript } });
    await page.clock.setFixedTime(FIXED_NOW);
    await page.goto('file://' + APP);
    await page.waitForFunction(() => /Synced/.test(document.getElementById('sync-label').textContent));
    await page.waitForTimeout(500);
    const steps = await page.evaluate(() => GUIDE_STEPS.map(s => ({ id: s.id, only: s.only || null })));
    for (const s of steps) {
      if (only.length && !only.includes(s.id)) continue;
      if (s.only && s.only !== (mobile ? 'phone' : 'desktop')) continue;
      const def = STEPS[s.id];
      if (!def) { problems.push(`${s.id}: no set-up in guide/make.js`); continue; }
      await reset(page);
      errors.length = 0;
      try { await def.setup(page); } catch (e) { problems.push(`${s.id} (${device}): set-up failed: ${e.message.split('\n')[0]}`); continue; }
      const ringed = await ring(page, def.target).catch(() => false);
      if (def.target && !ringed) problems.push(`${s.id} (${device}): nothing to highlight for ${def.target}`);
      await page.waitForTimeout(150);
      const file = path.join(OUT, device, s.id + '.jpg');
      await page.screenshot({ path: file, type: 'jpeg', quality: 76 });
      const bad = errors.filter(e => e.kind !== 'dialog' && !/Failed to load resource|net::ERR/.test(e.msg));
      if (bad.length) problems.push(`${s.id} (${device}): ${bad.map(e => e.msg).join('; ')}`);
      manifest.slides[s.id] = { ...(manifest.slides[s.id] || {}), [device]: fs.statSync(file).size };
      process.stdout.write(`${device}/${s.id} `);
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log('\n' + (problems.length ? 'Problems:\n' + problems.join('\n') : 'All slides made.'));
  if (problems.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
