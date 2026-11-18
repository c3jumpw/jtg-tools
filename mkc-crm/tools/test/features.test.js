// Tier 3 checks: filters, log-job, invoices, assistant. Usage: node t3.js <html>
const { chromium } = require('playwright');
const assert = require('assert');
const { newPage, FX } = require('../harness/mock');
const FILE = process.argv[2] || require('../harness/mock').APP;
const OUT = process.env.SWEEP_OUT || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'crm-test-'));
const PIPE = '901710326878';
const INV = { id: 'inv-field', name: '🧾 Invoice Status', type: 'drop_down', type_config: { options: ['Pending', 'Sent', 'Paid', 'Overdue'].map((n, i) => ({ id: 'io' + i, name: n, orderindex: i })) } };
const SVC = { id: 'svc-field', name: 'Service Date', type: 'date' };
// Invoice fields on the deals (ClickUp returns every list field on every task).
FX.lists[PIPE].forEach((t, i) => { t.custom_fields.push({ ...INV, value: [0, 1, 2, 3, null][i % 5] }, { ...SVC, value: String(Date.now() - (i + 2) * 864e5) }); });
const listFields = { [PIPE]: [INV, SVC, { id: 'relacct-f', name: 'Related Account ID', type: 'short_text' }] };
const accountName = FX.lists['901710481777'][3].name; // Northside Dental Group

const script = [
  { match: 'did another month', resp: { reply: 'How much was it?', ready: false, missing: ['amount'], operations: [{ op: 'create_deal', summary: 'Closed-won deal for Northside', accountName: 'Northside', stage: 'closed_won', service: 'Monthly SEO', serviceDate: '2026-11-06' }] } },
  { match: '450', resp: { reply: 'Creating a closed-won deal for Northside, 450 dollars, invoice pending. Also a task to attach the signed agreement by Friday. Confirm?', ready: true, missing: [], operations: [
    { op: 'create_deal', summary: 'Closed-won deal for Northside, $450, invoice pending', accountName: 'Northside', stage: 'closed_won', service: 'Monthly SEO', serviceDate: '2026-11-06', amount: 450, invoiceStatus: 'Pending' },
    { op: 'add_task', summary: 'Attach signed agreement to the Northside deal, due Friday', recordType: 'deal', recordHint: 'the Northside deal', taskTitle: 'Attach signed agreement', taskDueDate: '2026-11-13', taskKind: 'attach_file' }] } },
  { match: 'mark .*paid', resp: { reply: 'Marking the Peachtree invoice paid. Confirm?', ready: true, missing: [], operations: [{ op: 'update_record', summary: 'Mark Peachtree invoice paid', recordType: 'deal', recordHint: 'Peachtree', changes: [{ field: 'invoiceStatus', value: 'Paid' }] }] } },
  { match: 'note .*(o.malley|omalley)', resp: { reply: 'Adding a note to O’Malley. Confirm?', ready: true, missing: [], operations: [{ op: 'add_note', summary: 'Note on O’Malley', recordType: 'any', recordHint: "O'Malley", noteText: 'Prefers calls after 3pm.' }] } },
];

(async () => {
  const browser = await chromium.launch();
  const r = {};
  for (const mobile of [false, true]) {
    const tag = mobile ? 'm' : 'd';
    const { page, ctx, errors } = await newPage(browser, { mobile, opts: { listFields, assistantScript: script } });
    await page.goto('file://' + FILE);
    await page.waitForFunction(() => /Synced/.test(document.getElementById('sync-label').textContent));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/t3_${tag}_dashboard.png` });
    if (!mobile) {
      // 1) Filters combine and stick
      await page.evaluate(() => switchView('leads')); await page.waitForTimeout(200);
      const all = await page.evaluate(() => S.filtered.leads.length);
      await page.selectOption('#fs-branch-leads', 'JTG');
      const jtg = await page.evaluate(() => S.filtered.leads.length);
      const statusVal = await page.evaluate(() => [...document.querySelectorAll('#fs-status-leads option')].map(o => o.value).find(v => v));
      await page.selectOption('#fs-status-leads', statusVal);
      const both = await page.evaluate(() => S.filtered.leads.length);
      const kept = await page.evaluate(() => [document.getElementById('fs-branch-leads').value, document.getElementById('fs-status-leads').value]);
      await page.evaluate(() => loadAllEntries()); await page.waitForTimeout(300);
      const afterRefresh = await page.evaluate(() => [S.filtered.leads.length, document.getElementById('fs-branch-leads').value]);
      r.filters = { all, jtg, both, kept, afterRefresh };
      assert(jtg < all && both <= jtg && kept[0] === 'JTG' && kept[1] === statusVal && afterRefresh[0] === both && afterRefresh[1] === 'JTG', 'filters: ' + JSON.stringify(r.filters));
      await page.evaluate(() => clearFilters('leads'));
      assert.equal(await page.evaluate(() => S.filtered.leads.length), all);

      // 2) Pipeline: amount + invoice columns, unpaid filter
      await page.evaluate(() => { switchView('pipeline'); setViewMode('pipeline', 'list', document.querySelectorAll('#vt-pipeline .vt-btn')[0]); }); await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/t3_d_pipeline.png` });
      await page.evaluate(() => showUnpaidDeals()); await page.waitForTimeout(200);
      r.unpaid = await page.evaluate(() => S.filtered.pipeline.map(t => invoiceStatusOf(t)));
      assert(r.unpaid.length && r.unpaid.every(i => i && i !== 'paid'), 'unpaid filter');

      // 3) Deal header: invoice select, mark paid
      const deal = FX.lists[PIPE][0];
      await page.evaluate(id => openProfile(id, 'pipeline'), deal.id); await page.waitForSelector('#pf-body .field-grid');
      await page.screenshot({ path: `${OUT}/t3_d_profile_deal.png` });
      r.dealFacts = await page.evaluate(() => [...document.querySelectorAll('#pf-facts .fact-k')].map(e => e.textContent));
      await page.evaluate(() => { window.__calls.length = 0; });
      await page.selectOption('#pf-facts select.fact-select', 'Paid'); await page.waitForTimeout(400);
      r.invoiceWrite = await page.evaluate(() => window.__calls.filter(c => c.method === 'POST').map(c => c.key + ' ' + JSON.stringify(c.b || '')));
      assert(r.invoiceWrite.some(k => /field\/inv-field/.test(k) && /"value":2/.test(k)), 'invoice write ' + r.invoiceWrite);
      await page.evaluate(() => closeProfile());

      // 4) Log completed job (with a reminder task)
      await page.evaluate(() => { window.__calls.length = 0; openJobModal(); });
      await page.fill('#job-account', 'Northside Dental Group');
      await page.fill('#job-service', 'Monthly SEO — October');
      await page.fill('#job-amount', '$450');
      await page.screenshot({ path: `${OUT}/t3_d_job_modal.png` });
      await page.click('#job-modal .modal-footer .btn-primary'); await page.waitForTimeout(800);
      r.job = await page.evaluate(() => window.__calls.filter(c => c.method === 'POST').map(c => c.key + ' ' + JSON.stringify(c.b || '').slice(0, 140)));
      const j = r.job.join('\n');
      assert(/\/list\/901710326878\/task .*CLOSED \/ WON/.test(j), 'deal created closed/won');
      assert(/field\/1d4e9287[^ ]* .*"value":450/.test(j), 'amount set');
      assert(/field\/inv-field .*"value":0/.test(j), 'invoice pending set');
      assert(/field\/svc-field/.test(j) && /field\/b36600d5/.test(j), 'service + close date');
      assert(/field\/relacct-f .*86ac/.test(j), 'related account id');
      assert(/Send invoice/.test(j), 'reminder task');
      assert.equal(await page.evaluate(() => document.getElementById('job-modal').style.display), 'none');
      // Unknown account without the tick → refused
      await page.evaluate(() => openJobModal()); await page.fill('#job-account', 'Nobody Co'); await page.fill('#job-service', 'x'); await page.fill('#job-amount', '10');
      await page.click('#job-modal .modal-footer .btn-primary'); await page.waitForTimeout(200);
      r.jobRefused = await page.textContent('#job-status');
      assert(/no account called/i.test(r.jobRefused));
      await page.evaluate(() => closeModal('job-modal'));
    }

    // 5) Assistant: ambiguity → choice → amount → read-back → confirm
    await page.evaluate(() => { window.__calls.length = 0; openAssistant(); });
    await page.fill('#asst-text', 'I did another month of SEO for Northside on Thursday');
    await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    r[tag + '_asst1'] = await page.evaluate(() => [...document.querySelectorAll('.asst-msg.assistant')].map(e => e.textContent.trim()).slice(-1)[0]);
    await page.screenshot({ path: `${OUT}/t3_${tag}_asst_choice.png` });
    // Northside matches the account (and maybe a deal) → pick the account chip if asked
    const chip = await page.$('.asst-chips .chip-btn');
    if (chip) { await chip.click(); await page.waitForTimeout(300); }
    await page.fill('#asst-text', '450, invoice pending. Remind me to attach the signed agreement by Friday');
    await page.keyboard.press('Enter'); await page.waitForTimeout(600);
    const chip2 = await page.$('.asst-chips .chip-btn');
    if (chip2) { await chip2.click(); await page.waitForTimeout(300); }
    await page.screenshot({ path: `${OUT}/t3_${tag}_asst_ready.png` });
    r[tag + '_draft'] = await page.evaluate(() => AS.draft.map(o => ({ op: o.op, acct: o._account && o._account.name, link: o._linkTo, target: o._target && o._target.name })));
    r[tag + '_ready'] = await page.evaluate(() => !document.querySelector('.asst-draft-actions .btn-primary').disabled);
    assert(r[tag + '_ready'], 'confirm enabled');
    await page.evaluate(() => { window.__calls.length = 0; });
    await page.fill('#asst-text', 'yes'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    r[tag + '_saved'] = await page.evaluate(() => window.__calls.filter(c => c.method === 'POST').map(c => c.key + ' ' + JSON.stringify(c.b || '').slice(0, 110)));
    const sv = r[tag + '_saved'].join('\n');
    assert(/\/list\/901710326878\/task .*CLOSED \/ WON/.test(sv), 'assistant deal');
    assert(/\/list\/901714539764\/task .*Attach signed agreement/.test(sv), 'assistant task in tasks list');
    await page.screenshot({ path: `${OUT}/t3_${tag}_asst_done.png` });
    if (!mobile) {
      // Update with from → to, then a note on an apostrophe name
      await page.fill('#asst-text', 'Mark the Peachtree invoice as paid'); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
      const c3 = await page.$('.asst-chips .chip-btn'); if (c3) { await c3.click(); await page.waitForTimeout(300); }
      r.updateLine = await page.evaluate(() => [...document.querySelectorAll('.asst-op-line')].map(e => e.textContent));
      await page.screenshot({ path: `${OUT}/t3_d_asst_update.png` });
      await page.evaluate(() => { window.__calls.length = 0; });
      await page.click('.asst-draft-actions .btn-primary'); await page.waitForTimeout(900);
      r.updateSaved = await page.evaluate(() => window.__calls.filter(c => c.method === 'POST').map(c => c.key + ' ' + JSON.stringify(c.b || '').slice(0, 120)));
      assert(r.updateSaved.some(k => /field\/inv-field .*"value":2/.test(k)), 'update invoice paid');
      assert(r.updateSaved.some(k => /comment .*\[ASSISTANT\] Updated — Invoice: /.test(k)), 'attribution comment');
      // Cancel by voice-style phrase clears the draft
      await page.fill('#asst-text', 'add a note on omalley: prefers calls after 3'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
      await page.fill('#asst-text', 'cancel'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => AS.draft.length), 0);
      // Worker without the endpoint → clear message
      await page.evaluate(() => closeAssistant());
    }
    // 6) Command bar entries
    await page.evaluate(() => openCmdk('log comp')); await page.waitForTimeout(150);
    r[tag + '_cmdk'] = await page.evaluate(() => CMDK.items.map(i => i.label).slice(0, 3));
    await page.keyboard.press('Escape');
    if (mobile) {
      await page.evaluate(() => closeAssistant());
      await page.click('#bottom-nav .bn-new'); await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/t3_m_create_sheet.png` });
      await page.evaluate(() => closeCreateSheet());
      r.fabHidden = await page.evaluate(() => getComputedStyle(document.getElementById('quick-capture-fab')).display);
    }
    r[tag + '_errors'] = errors.slice();
    await ctx.close();
  }
  // Worker without the "assistant" endpoint
  {
    const { page, ctx } = await newPage(browser, { mobile: false, opts: { assistantStatus: 404 } });
    await page.goto('file://' + FILE); await page.waitForFunction(() => /Synced/.test(document.getElementById('sync-label').textContent));
    await page.evaluate(() => openAssistant('Finished a job for Atlas yesterday, 300 dollars', true)); await page.waitForTimeout(600);
    r.noEndpoint = await page.evaluate(() => [...document.querySelectorAll('.asst-msg.assistant')].map(e => e.textContent.trim()).slice(-1)[0]);
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(r, null, 1));
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
