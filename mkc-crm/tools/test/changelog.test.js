// Change log and What's new: who sees which changes and when, the admin
// Change Log page, its filters and downloads.
// Usage: node test/changelog.test.js [index.html]
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { newPage, reloadKeepingStorage, APP } = require('../harness/mock');
const FILE = process.argv[2] || APP;
const OUT = process.env.SWEEP_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'crm-changelog-'));
const LOG = JSON.parse(fs.readFileSync(path.join(path.dirname(APP), 'changelog.json'), 'utf8'));
const newest = LOG.entries.reduce((m, e) => (e.date > m ? e.date : m), '');
// "Last signed in" the day before the newest announced change, so there is
// something for What's new to show (quiet entries are never announced).
const newestAnnounced = LOG.entries.filter(e => e.announce).reduce((m, e) => (e.date > m ? e.date : m), '');
const dayBefore = new Date(Date.parse(newestAnnounced) - 864e5).toISOString().slice(0, 10);
const rank = { everyone: 0, admin: 1, super: 2 };
const expectFor = (level, since) => LOG.entries.filter(e => e.announce && e.date > since && rank[e.audience] <= level).map(e => e.title).sort();

const ready = page => page.waitForFunction(() => /Synced/.test(document.getElementById('sync-label').textContent));
const popup = page => page.evaluate(() => ({
  open: !document.getElementById('changes').hidden,
  titles: [...document.querySelectorAll('#changes .chg-card h3')].map(h => h.textContent).sort(),
  pics: [...document.querySelectorAll('#changes .chg-pic img')].length,
  logBtn: getComputedStyle(document.getElementById('changes-log-btn')).display !== 'none',
  sub: document.getElementById('changes-sub').textContent,
}));
const errorsOf = errs => errs.filter(e => e.kind !== 'dialog' && !/Failed to load resource|net::ERR/.test(e.msg));

(async () => {
  const browser = await chromium.launch();

  // 1) A super admin who last signed in before the newest changes: What's new,
  //    with every announced change since, once.
  {
    const { page, errors } = await newPage(browser, { mobile: false, opts: { guideSeen: dayBefore } });
    await page.goto('file://' + FILE); await ready(page);
    await page.waitForFunction(() => !document.getElementById('changes').hidden, null, { timeout: 5000 });
    const p = await popup(page);
    assert.deepStrictEqual(p.titles, expectFor(2, dayBefore));
    assert.ok(p.titles.length >= 1 && p.logBtn, 'admins get the Full change log link');
    assert.match(p.sub, /Since you last signed in/);
    assert.strictEqual(await page.getAttribute('#changes', 'role'), 'dialog');
    await page.screenshot({ path: `${OUT}/whatsnew_d.png` });
    await page.click('#changes-ok');
    assert.strictEqual((await popup(page)).open, false);
    await page.waitForFunction(() => /"changes":/.test(localStorage.getItem(guideKey()) || ''));
    await reloadKeepingStorage(page); await ready(page);
    await page.waitForFunction(() => typeof CL !== 'undefined' && CL.loaded);
    await page.waitForTimeout(1200);
    assert.strictEqual((await popup(page)).open, false, 'shown once');
    assert.deepStrictEqual(errorsOf(errors), []);
    await page.context().close();
  }

  // 2) Staff: only what applies to everyone; no admin link, no Change Log.
  {
    const { page, errors } = await newPage(browser, { mobile: false, opts: { guideSeen: dayBefore, user: { accessLevel: 'Staff' } } });
    await page.goto('file://' + FILE); await ready(page);
    const expected = expectFor(0, dayBefore);
    if (expected.length) {
      await page.waitForFunction(() => !document.getElementById('changes').hidden, null, { timeout: 5000 });
      const p = await popup(page);
      assert.deepStrictEqual(p.titles, expected);
      assert.strictEqual(p.logBtn, false);
      await page.keyboard.press('Escape');
    }
    assert.strictEqual(await page.isVisible('.nav-item[data-view="changelog"]'), false, 'no Change Log in the menu');
    await page.evaluate(() => switchView('changelog'));
    assert.strictEqual(await page.evaluate(() => document.querySelector('.view.active').id), 'view-dashboard', 'staff are sent back to the dashboard');
    assert.deepStrictEqual(errorsOf(errors), []);
    await page.context().close();
  }

  // 3) First sign-in ever: the tour, not a backlog of changes; afterwards nothing pending.
  {
    const { page } = await newPage(browser, { mobile: false, opts: { guideFresh: true } });
    await page.goto('file://' + FILE); await ready(page);
    await page.waitForFunction(() => !document.getElementById('guide').hidden, null, { timeout: 5000 });
    assert.strictEqual((await popup(page)).open, false);
    await page.keyboard.press('Escape');
    await reloadKeepingStorage(page); await ready(page); await page.waitForTimeout(1200);
    assert.strictEqual((await popup(page)).open, false, 'no backlog after the tour');
    assert.strictEqual(await page.evaluate(() => document.getElementById('guide').hidden), true);
    await page.context().close();
  }

  // 4) The admin Change Log page: everything, oldest first; filters; downloads.
  {
    const { page, errors } = await newPage(browser, { mobile: false, opts: { user: { accessLevel: 'Admin' } } });
    await page.goto('file://' + FILE); await ready(page);
    await page.click('.nav-item[data-view="changelog"]');
    await page.waitForSelector('#changelog-list .cl-entry');
    const all = await page.evaluate(() => ({ n: document.querySelectorAll('#changelog-list .cl-entry').length, first: document.querySelector('#changelog-list .cl-day h3').textContent, title: document.getElementById('page-title').textContent }));
    assert.strictEqual(all.n, LOG.entries.length);
    assert.strictEqual(all.title, 'Change Log');
    assert.match(all.first, /Sep 19, 2026/, 'oldest first by default');
    await page.selectOption('#cl-type', 'security');
    assert.strictEqual(await page.locator('#changelog-list .cl-entry').count(), LOG.entries.filter(e => e.type === 'security').length);
    await page.selectOption('#cl-type', '');
    await page.fill('#cl-q', 'assistant');
    const hits = await page.locator('#changelog-list .cl-entry').count();
    assert.ok(hits >= 1 && hits < LOG.entries.length, 'search narrows the list');
    await page.fill('#cl-q', '');
    await page.selectOption('#cl-order', 'newest');
    assert.match(await page.textContent('#changelog-list .cl-day h3'), new RegExp(new Date(newest + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })));
    const [csv] = await Promise.all([page.waitForEvent('download'), page.click('text=Download CSV')]);
    const csvText = fs.readFileSync(await csv.path(), 'utf8');
    assert.strictEqual(csvText.trim().split(/\r\n/).length, LOG.entries.length + 1, 'CSV has a row per change');
    const [js] = await Promise.all([page.waitForEvent('download'), page.click('text=Download JSON')]);
    const exported = JSON.parse(fs.readFileSync(await js.path(), 'utf8'));
    assert.strictEqual(exported.entries.length, LOG.entries.length);
    assert.ok(!('_seq' in exported.entries[0]));
    await page.screenshot({ path: `${OUT}/changelog_d.png` });
    assert.deepStrictEqual(errorsOf(errors), []);
    await page.context().close();
  }

  // 5) Phone: the pop-up fits.
  {
    const { page, errors } = await newPage(browser, { mobile: true, opts: { guideSeen: dayBefore } });
    await page.goto('file://' + FILE); await ready(page);
    await page.waitForFunction(() => !document.getElementById('changes').hidden, null, { timeout: 5000 });
    const fit = await page.evaluate(() => { const r = document.getElementById('changes-ok').getBoundingClientRect(); return { ok: r.bottom <= innerHeight && r.right <= innerWidth, wide: document.documentElement.scrollWidth - innerWidth }; });
    assert.ok(fit.ok && fit.wide <= 0, 'fits: ' + JSON.stringify(fit));
    await page.screenshot({ path: `${OUT}/whatsnew_m.png` });
    assert.deepStrictEqual(errorsOf(errors), []);
    await page.context().close();
  }
  await browser.close();
  console.log(`changelog: all checks passed (pictures in ${OUT})`);
})().catch(e => { console.error(e); process.exit(1); });
