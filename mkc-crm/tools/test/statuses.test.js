// Live ClickUp statuses, deal status on create, relationship targeting, owed totals.
// Usage: node t4.js <html>
const { chromium } = require('playwright');
const assert = require('assert');
const { newPage, FX } = require('../harness/mock');
const FILE = process.argv[2] || require('../harness/mock').APP;
const L = { leads: '901710477809', pipe: '901710326878', contacts: '901710477009', accounts: '901710481777', tasks: '901714539764' };
// The real lists as read from ClickUp on 2026-11-09.
const listStatuses = {
  [L.leads]: ['pre-engagement', 'manual outreach cue', 'initial contact made', 'nurturing', 'attention needed', 'churned/disqualified', 'ready for pipeline', 'ready for export'],
  [L.pipe]: ['opportunity', 'scheduled ds / intro', 'qualified lead/prospect', 'demo presented', 'proposal pending', 'offer prsntd / negotiation', 'disqualified', 'closed / won', 'closed / lost', 'archived'],
  [L.contacts]: ['listed', 'burnt', 'archived'],
  [L.accounts]: ['listed', 'burnt', 'complete'],
  [L.tasks]: ['to do', 'in progress', 'for review', 'completed/approved'],
};
const listFields = { [L.pipe]: [
  { id: 'rel-assoc-acct', name: 'Associated Account', type: 'list_relationship', type_config: { subcategory_id: L.accounts } },
  { id: 'rel-main-contact', name: 'Main Contact', type: 'list_relationship', type_config: { subcategory_id: L.contacts } },
] };
// One deal already in the renamed "opportunity" stage; one with a deposit taken.
const deal0 = FX.lists[L.pipe][0]; deal0.status = { status: 'opportunity', color: '#8b5cf6' };
const INV = { id: 'inv-field', name: 'Invoice Status', type: 'drop_down', type_config: { options: ['Pending', 'Sent', 'Paid', 'Overdue'].map((n, i) => ({ id: 'io' + i, name: n, orderindex: i })) } };
const deal1 = FX.lists[L.pipe][1];
deal1.custom_fields = deal1.custom_fields.filter(f => !/^(oppurtunity|remaining balance)$/i.test(f.name));
deal1.custom_fields.push({ ...INV, value: 1 }, { id: 'opp', name: 'Oppurtunity', type: 'currency', value: '1000' }, { id: '17a2ade3-befa-44a2-beca-fb669f44fde4', name: 'Remaining Balance', type: 'currency', value: '600' });

(async () => {
  const browser = await chromium.launch();
  const { page, errors } = await newPage(browser, { mobile: false, opts: { listStatuses, listFields } });
  await page.goto('file://' + FILE);
  await page.waitForFunction(() => /Synced/.test(document.getElementById('sync-label').textContent));
  const r = await page.evaluate(() => ({ pipe: getStatuses('pipeline'), contacts: getStatuses('contacts'), accounts: getStatuses('accounts'), leads: getStatuses('leads') }));
  assert.deepStrictEqual(r.pipe[0], 'OPPORTUNITY');
  assert.deepStrictEqual(r.contacts, ['LISTED', 'BURNT', 'ARCHIVED']);
  assert.deepStrictEqual(r.accounts, ['LISTED', 'BURNT', 'COMPLETE']);
  assert.ok(r.leads.includes('READY FOR EXPORT'));
  // Board: the "opportunity" deal sits in its own column, not "Other".
  await page.evaluate(() => { switchView('pipeline'); S.viewMode.pipeline = 'kanban'; renderKanban('pipeline'); });
  const col = await page.evaluate(id => { const card = [...document.querySelectorAll('#pipeline-kanban-wrap [onclick*="' + id + '"]')][0]; const c = card && card.closest('.kanban-col, [data-status]'); return c ? (c.dataset.status || c.querySelector('.kanban-col-header, h4, .kc-title')?.textContent || '').trim() : null; }, deal0.id);
  assert.ok(col && /opportunit/i.test(col) && !/other/i.test(col), 'deal column: ' + col);
  // Profile status menu offers ClickUp's statuses.
  await page.evaluate(id => openProfile(id, 'contacts'), FX.lists[L.contacts][0].id); await page.waitForTimeout(400);
  const opts = await page.evaluate(() => [...document.querySelectorAll('#pf-status-select option')].map(o => o.value));
  assert.deepStrictEqual(opts, ['LISTED', 'BURNT', 'ARCHIVED']);
  // New open deal uses ClickUp's first stage; relationships go by the list they point at.
  await page.evaluate(() => { window.__calls.length = 0; });
  const acct = FX.lists[L.accounts][0], lead = FX.lists[L.leads][0], contact = FX.lists[L.contacts][0];
  await page.evaluate(({ acct, lead }) => createDealRecord({ name: 'Open deal', stage: 'open', account: { id: acct.id, name: acct.name }, contact: { id: lead.id, name: lead.name, type: 'leads' } }), { acct, lead });
  let calls = await page.evaluate(() => window.__calls.map(c => ({ key: c.key, b: c.b })));
  const created = calls.find(c => / POST \/list\/901710326878\/task$/.test(c.key));
  assert.strictEqual(created.b.status, 'OPPORTUNITY');
  const rels = calls.filter(c => /\/field\/rel-/.test(c.key)).map(c => c.key.split('/field/')[1] + '=' + c.b.value.add[0]);
  assert.deepStrictEqual(rels, ['rel-assoc-acct=' + acct.id], 'a lead must not go into the Contacts-only field');
  await page.evaluate(() => { window.__calls.length = 0; });
  await page.evaluate(({ contact }) => createDealRecord({ name: 'Won job', stage: 'closed_won', amount: 300, invoiceStatus: 'Pending', contact: { id: contact.id, name: contact.name, type: 'contacts' } }), { contact });
  calls = await page.evaluate(() => window.__calls.map(c => ({ key: c.key, b: c.b })));
  assert.strictEqual(calls.find(c => / POST \/list\/901710326878\/task$/.test(c.key)).b.status, 'CLOSED / WON');
  assert.deepStrictEqual(calls.filter(c => /\/field\/rel-/.test(c.key)).map(c => c.key.split('/field/')[1]), ['rel-main-contact']);
  // Unpaid total counts the remaining balance once a deposit was taken.
  const owed = await page.evaluate(id => owedOf(S.entries.pipeline.find(t => t.id === id)), deal1.id);
  assert.strictEqual(owed, 600);
  // ClickUp unreachable for statuses → the built-in list (already updated) is used.
  const fallback = await page.evaluate(() => { for (const k in LIVE_STATUSES) delete LIVE_STATUSES[k]; return getStatuses('pipeline')[0]; });
  assert.strictEqual(fallback, 'OPPORTUNITY');
  assert.deepStrictEqual(errors.filter(e => e.kind !== 'dialog'), []);
  console.log('t4: all checks passed');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
