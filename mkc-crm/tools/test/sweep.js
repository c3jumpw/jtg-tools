// Screen sweep: every view on desktop and phone, checked for script errors,
// sideways overflow and unlabelled icon buttons. Fails if any are found.
// Usage: node test/sweep.js [index.html] [tag]   (screenshots go to $SWEEP_OUT or the OS temp folder)
const { chromium } = require('playwright');
const fs = require('fs');
const { newPage, FX, APP } = require('../harness/mock');
const FILE = process.argv[2] || APP;
const TAG = process.argv[3] || 'sweep';
const OUT = process.env.SWEEP_OUT || fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'crm-sweep-'));

// In-page UX metrics for whatever is currently visible.
async function audit(page) {
  return page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
    const name = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + (el.textContent ? ' "' + el.textContent.trim().replace(/\s+/g, ' ').slice(0, 24) + '"' : '');
    const content = document.getElementById('content');
    const smallInputs = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea')].filter(vis)
      .map(el => ({ el: name(el), fs: parseFloat(getComputedStyle(el).fontSize) })).filter(x => x.fs < 16);
    const tappables = [...document.querySelectorAll('button,a[href],select,input,[onclick],summary,label')].filter(vis).filter(el => !el.closest('table thead'));
    const smallTargets = tappables.map(el => { const r = el.getBoundingClientRect(); return { el: name(el), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.h < 44 || x.w < 44);
    const iconOnly = [...document.querySelectorAll('button')].filter(vis).filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby')).map(b => name(b) + (b.title ? ' [title only]' : ' [NO NAME]'));
    const clickDivs = [...document.querySelectorAll('[onclick]')].filter(vis).filter(el => !/^(BUTTON|A|INPUT|SELECT|LABEL|TEXTAREA|SUMMARY)$/.test(el.tagName) && !el.getAttribute('role') && el.tabIndex < 0).length;
    // Things under the Quick Capture FAB
    const fab = document.getElementById('quick-capture-fab'); let underFab = [];
    if (fab && vis(fab)) { const f = fab.getBoundingClientRect(); fab.style.pointerEvents = 'none'; fab.style.visibility = 'hidden';
      for (let x = f.left + 4; x < f.right; x += 12) for (let y = f.top + 4; y < f.bottom; y += 12) { const el = document.elementFromPoint(x, y); const c = el && el.closest('button,a,select,input,[onclick]'); if (c && !underFab.includes(name(c))) underFab.push(name(c)); }
      fab.style.visibility = ''; fab.style.pointerEvents = ''; }
    const modalOverflow = [];
    document.querySelectorAll('.modal-overlay').forEach(ov => { if (ov.style.display !== 'flex') return; const m = ov.querySelector('.modal').getBoundingClientRect();
      ov.querySelectorAll('input,select,textarea,button').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && (r.right > m.right + 0.5 || r.left < m.left - 0.5)) modalOverflow.push(name(el) + ' +' + Math.round(r.right - m.right) + 'px'); }); });
    const panelOverflow = []; const pp = document.getElementById('profile-panel');
    if (pp && pp.classList.contains('open')) { const m = pp.getBoundingClientRect(); pp.querySelectorAll('input,select,textarea,button').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && r.right > m.right + 0.5) panelOverflow.push(name(el)); }); }
    return {
      modalOverflow, panelOverflow,
      viewport: [innerWidth, innerHeight],
      docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      contentOverflowX: content ? content.scrollWidth - content.clientWidth : 0,
      smallInputs: smallInputs.slice(0, 12), smallInputCount: smallInputs.length,
      smallTargetCount: smallTargets.length, tappableCount: tappables.length, smallTargets: smallTargets.slice(0, 10),
      iconOnly, clickDivs, underFab,
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const metrics = {};
  for (const mobile of [true, false]) {
    const size = mobile ? 'm' : 'd';
    const shot = async (page, view, opts = {}) => { await page.waitForTimeout(opts.wait ?? 350); await page.screenshot({ path: `${OUT}/${TAG}_${size}_${view}.png`, fullPage: false }); metrics[`${size}_${view}`] = { ...(await audit(page)), errors: page.__errors.splice(0) }; };
    // Login screen
    { const { page, ctx } = await newPage(browser, { mobile, seedSession: false });
      await page.goto('file://' + FILE); await page.waitForSelector('#login-id option:nth-child(2)', { state: 'attached' });
      await shot(page, 'login');
      await page.focus('#login-pass'); await shot(page, 'login_focus');
      await ctx.close(); }
    const { page, ctx } = await newPage(browser, { mobile });
    await page.goto('file://' + FILE); await page.waitForFunction(() => /Synced/.test(document.getElementById('sync-label').textContent));
    const go = async v => { if (mobile) await page.evaluate(v => switchView(v), v); else await page.click(`.nav-item[data-view="${v}"]`); };
    await shot(page, 'dashboard');
    await page.evaluate(() => document.getElementById('content').scrollTo(0, 1e6)); await shot(page, 'dashboard_bottom');
    if (mobile) { await page.click('#menu-toggle'); await shot(page, 'sidebar_open'); await page.click('#sidebar-overlay', { position: { x: 370, y: 300 } }); }
    for (const v of ['myday', 'mywork', 'leads', 'pipeline', 'contacts', 'accounts', 'tasks', 'qcinbox', 'export', 'settings', 'resources']) {
      await go(v); await page.evaluate(() => document.getElementById('content').scrollTo(0, 0)); await shot(page, v, { wait: v === 'qcinbox' || v === 'myday' ? 700 : 350 });
    }
    await go('search-view'); await page.fill('#fsearch', 'sha'); await shot(page, 'search');
    await go('leads'); await page.evaluate(() => setViewMode('leads', 'kanban', document.querySelectorAll('#vt-leads .vt-btn')[1])); await shot(page, 'leads_kanban');
    await page.evaluate(() => setViewMode('leads', 'calendar', document.querySelectorAll('#vt-leads .vt-btn')[2])); await shot(page, 'leads_calendar');
    await page.evaluate(() => setViewMode('leads', 'list', document.querySelectorAll('#vt-leads .vt-btn')[0]));
    await go('tasks'); await page.evaluate(m => setTasksView(m ? 'list' : 'kanban', document.querySelectorAll('#vt-tasks .vt-btn')[m ? 0 : 1]), mobile); await shot(page, mobile ? 'tasks_list' : 'tasks_kanban');
    // Entry detail panel, all tabs
    await go('leads');
    await page.evaluate(id => openProfile(id, 'leads'), FX.ids.leadApos); await page.waitForSelector('#pf-body .field-grid');
    await shot(page, 'profile_details');
    await page.evaluate(() => document.getElementById('pf-body').scrollTo(0, 1e6)); await shot(page, 'profile_details_bottom');
    for (const [i, t] of [[1, 'actions'], [2, 'activity'], [3, 'related'], [4, 'tasks']].values()) { await page.click(`.pf-tab:nth-child(${i + 1})`); await shot(page, 'profile_' + t, { wait: 500 }); }
    await page.click('.pf-tab:nth-child(2)'); await page.click('.action-option >> nth=1'); await shot(page, 'profile_actions_selected', { wait: 600 });
    // Modals launched from the panel
    await page.evaluate(() => openActivityModal()); await shot(page, 'modal_activity'); await page.evaluate(() => closeModal('activity-modal'));
    await page.evaluate(() => openCatchUpModal()); await shot(page, 'modal_catchup'); await page.evaluate(() => closeModal('catchup-modal'));
    await page.evaluate(() => openUpdateProfile()); await shot(page, 'modal_update_record', { wait: 600 }); await page.evaluate(() => closeModal('entry-modal'));
    await page.evaluate(() => closeProfile());
    // Deal panel + Closed/Won
    await page.evaluate(id => { S.currentPfTab = 'details'; openProfile(id, 'pipeline'); }, FX.ids.deal0); await page.waitForSelector('#pf-body .field-grid');
    await shot(page, 'profile_deal');
    await page.evaluate(() => openClosedWonModal()); await shot(page, 'modal_closedwon'); await page.evaluate(() => closeModal('closedwon-modal'));
    await page.evaluate(() => closeProfile());
    // Global modals
    await page.evaluate(() => openNewEntryModal('Lead')); await shot(page, 'modal_new_entry'); await page.evaluate(() => closeModal('entry-modal'));
    await page.evaluate(() => openNewTaskModal()); await shot(page, 'modal_new_task', { wait: 600 }); await page.evaluate(() => closeModal('task-modal'));
    if (mobile) { await page.click('#bottom-nav .bn-new'); await shot(page, 'create_sheet'); await page.click('.cs-item:nth-child(3)'); }
    else await page.click('#quick-capture-fab');
    await shot(page, 'modal_quick_capture'); await page.evaluate(() => closeModal('quick-capture-modal'));
    await page.evaluate(() => openEditProfileModal()); await shot(page, 'modal_edit_profile', { wait: 600 }); await page.evaluate(() => closeModal('edit-profile-modal'));
    await page.evaluate(() => openAddTeamMemberModal()); await shot(page, 'modal_add_team'); await page.evaluate(() => closeModal('add-team-modal'));
    await go('qcinbox'); await page.waitForSelector('.qc-item');
    await page.evaluate(() => qcOpenThread('evt_102')); await page.waitForSelector('#qct-body > div > div'); await shot(page, 'modal_qc_thread', { wait: 500 });
    await page.evaluate(() => qcOpenAssign('evt_102', true)); await shot(page, 'modal_qc_assign');
    await page.evaluate(() => { closeModal('qc-assign-modal'); closeModal('qc-thread-modal'); });
    await page.evaluate(() => startSmartTriage()); await page.waitForSelector('#triage-body .pf-section', { timeout: 8000 }); await shot(page, 'modal_triage');
    await page.evaluate(() => closeModal('triage-modal'));
    // Toast stacked over the FAB / bottom actions
    await page.evaluate(() => { showToast('Captured. Review it anytime from Smart Triage in the Activity Inbox.', 'success'); showToast('Failed to load pipeline: Worker 502: Bad Gateway', 'error'); });
    await shot(page, 'toast', { wait: 300 });
    // Bulk selection bar
    await go('leads'); await page.click('#tb-leads-body tr:nth-child(1) input[type=checkbox]'); await page.click('#tb-leads-body tr:nth-child(2) input[type=checkbox]'); await shot(page, 'leads_bulkbar');
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/${TAG}_metrics.json`, JSON.stringify(metrics, null, 1));
  await browser.close();
  console.log('views:', Object.keys(metrics).length);
  const errs = Object.entries(metrics).filter(([, m]) => m.errors.length).map(([k, m]) => k + ': ' + JSON.stringify(m.errors));
  const wide = Object.entries(metrics).filter(([, m]) => m.docOverflowX > 0).map(([k, m]) => `${k}: page is ${m.docOverflowX}px too wide`);
  const unnamed = Object.entries(metrics).flatMap(([k, m]) => m.iconOnly.filter(x => /NO NAME/.test(x)).map(x => `${k}: ${x}`));
  console.log('errors:\n' + (errs.join('\n') || 'none'));
  const problems = [...errs, ...wide, ...unnamed];
  if (problems.length) { console.error('\nSweep found problems:\n' + problems.join('\n')); process.exit(1); }
  console.log('sweep: no problems on ' + Object.keys(metrics).length + ' screens (' + OUT + ')');
})().catch(e => { console.error('RUN FAILED', e); process.exit(1); });
