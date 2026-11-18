// The getting-started tour: who sees which slides, when it opens itself,
// What's new, keyboard and phone use, Show me, and the ways back in.
// Usage: node test/guide.test.js [index.html]
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { newPage, APP } = require('../harness/mock');
const FILE = process.argv[2] || APP;
const OUT = process.env.SWEEP_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'crm-guide-'));

const ready = page => page.waitForFunction(() => /Synced/.test(document.getElementById('sync-label').textContent));
const state = page => page.evaluate(() => ({
  open: !document.getElementById('guide').hidden,
  kicker: document.getElementById('guide-kicker').textContent,
  count: document.getElementById('guide-count').textContent,
  title: document.getElementById('guide-title').textContent,
  img: document.getElementById('guide-img').getAttribute('src'),
  imgOk: document.getElementById('guide-img').naturalWidth > 0,
  ids: G.steps.map(s => s.id),
  focusInside: document.getElementById('guide').contains(document.activeElement),
}));

(async () => {
  const browser = await chromium.launch();
  const results = {};

  // 1) First sign-in as a super admin on a computer: the whole tour opens by itself.
  {
    const { page, errors } = await newPage(browser, { mobile: false, opts: { guideFresh: true } });
    await page.goto('file://' + FILE); await ready(page);
    await page.waitForFunction(() => !document.getElementById('guide').hidden, null, { timeout: 4000 });
    await page.waitForFunction(() => document.getElementById('guide-img').complete);
    let s = await state(page);
    const all = await page.evaluate(() => GUIDE_STEPS.filter(x => x.only !== 'phone').map(x => x.id));
    assert.deepStrictEqual(s.ids, all, 'a super admin gets every computer slide');
    assert.strictEqual(s.kicker, 'Getting started');
    assert.strictEqual(s.count, `1 of ${all.length}`);
    assert.ok(s.img.startsWith('media/guide/d/') && s.imgOk, 'desktop picture loads: ' + s.img);
    assert.ok(s.focusInside, 'focus moves into the tour');
    assert.strictEqual(await page.getAttribute('#guide', 'role'), 'dialog');
    await page.screenshot({ path: `${OUT}/guide_d_first.png` });
    // Keyboard: right/left move, Tab stays inside.
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    s = await state(page); assert.strictEqual(s.count, `3 of ${all.length}`);
    await page.keyboard.press('ArrowLeft'); s = await state(page); assert.strictEqual(s.count, `2 of ${all.length}`);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    assert.ok((await state(page)).focusInside, 'Tab stays in the tour');
    // Walk every slide: each picture loads.
    const broken = [];
    for (let i = 0; i < all.length; i++) {
      await page.evaluate(n => { G.i = n; guideRender(); }, i);
      await page.waitForFunction(() => document.getElementById('guide-img').complete);
      const st = await state(page); if (!st.imgOk) broken.push(st.img);
    }
    assert.deepStrictEqual(broken, [], 'every slide has a picture');
    assert.strictEqual(await page.textContent('#guide-next'), 'Done');
    // Show me on the board slide goes to the pipeline board.
    await page.evaluate(() => { G.i = G.steps.findIndex(x => x.id === 'board'); guideRender(); });
    await page.click('#guide-show');
    s = await state(page); assert.strictEqual(s.open, false);
    assert.strictEqual(await page.evaluate(() => S.currentView || document.querySelector('.nav-item.active')?.dataset.view), 'pipeline');
    // Closing marks it seen: a reload doesn't open it again.
    await page.reload(); await ready(page); await page.waitForTimeout(1200);
    assert.strictEqual((await state(page)).open, false, 'not shown again once seen');
    // Ways back in: Resources, the ? button, and the command bar.
    await page.evaluate(() => switchView('resources')); await page.waitForTimeout(200);
    assert.match(await page.textContent('#guide-cta'), /Take the tour/);
    await page.click('#guide-cta .btn-primary'); assert.strictEqual((await state(page)).open, true);
    await page.keyboard.press('Escape'); assert.strictEqual((await state(page)).open, false, 'Esc closes');
    await page.click('#guide-btn'); assert.strictEqual((await state(page)).open, true, 'the ? button opens it');
    await page.keyboard.press('Escape');
    await page.evaluate(() => openCmdk()); await page.keyboard.type('tour'); await page.waitForTimeout(200); await page.keyboard.press('Enter');
    assert.strictEqual((await state(page)).open, true, 'searching "tour" opens it');
    await page.keyboard.press('Escape');
    results.desktop_errors = errors.filter(e => e.kind !== 'dialog' && !/Failed to load resource|net::ERR/.test(e.msg));
  }

  // 2) Staff see only the everyone slides; admins add theirs.
  for (const [level, decks] of [['staff', ['start']], ['admin', ['start', 'admin']]]) {
    const { page } = await newPage(browser, { mobile: false, opts: { guideFresh: true, user: { accessLevel: level === 'staff' ? 'Staff' : 'Admin' } } });
    await page.goto('file://' + FILE); await ready(page);
    await page.waitForFunction(() => !document.getElementById('guide').hidden, null, { timeout: 4000 });
    const got = await page.evaluate(() => [...new Set(G.steps.map(s => s.deck))]);
    assert.deepStrictEqual(got, decks, level + ' decks');
    results[level] = (await state(page)).ids.length;
    await page.context().close();
  }

  // 3) Someone who took the tour before the newest slides: What's new, only those.
  {
    const { page } = await newPage(browser, { mobile: false, opts: { guideSeen: '2026-01-01' } });
    await page.goto('file://' + FILE); await ready(page);
    await page.waitForFunction(() => !document.getElementById('guide').hidden, null, { timeout: 4000 });
    const s = await state(page);
    assert.strictEqual(s.kicker, 'What’s new');
    const expected = await page.evaluate(() => GUIDE_STEPS.filter(x => x.since > '2026-01-01' && x.only !== 'phone').map(x => x.id));
    assert.deepStrictEqual(s.ids, expected);
    await page.context().close();
  }

  // 4) Phone: phone pictures, the phone-only slide, buttons on screen, swipe.
  {
    const { page, errors } = await newPage(browser, { mobile: true, opts: { guideFresh: true } });
    await page.goto('file://' + FILE); await ready(page);
    await page.waitForFunction(() => !document.getElementById('guide').hidden, null, { timeout: 4000 });
    await page.waitForFunction(() => document.getElementById('guide-img').complete);
    const s = await state(page);
    assert.ok(s.ids.includes('phone'), 'phone-only slide included');
    assert.ok(s.img.startsWith('media/guide/m/') && s.imgOk, 'phone picture loads');
    const fit = await page.evaluate(() => {
      const r = id => document.getElementById(id).getBoundingClientRect();
      return { next: r('guide-next').bottom <= innerHeight && r('guide-next').right <= innerWidth, title: r('guide-title').top < innerHeight, wide: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(fit.next && fit.title && fit.wide <= 0, 'fits the phone screen: ' + JSON.stringify(fit));
    assert.strictEqual(await page.isVisible('#guide-btn'), false, 'no ? button in the phone top bar');
    await page.screenshot({ path: `${OUT}/guide_m_first.png` });
    const box = await page.locator('#guide-figure').boundingBox();
    await page.touchscreen.tap(box.x + 5, box.y + 5);
    await page.evaluate(({ x, y }) => {
      const f = document.getElementById('guide-figure');
      const t = (type, cx) => f.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { touches: [{ clientX: cx, clientY: y }], changedTouches: [{ clientX: cx, clientY: y }] }));
      t('touchstart', x + 250); t('touchend', x + 50);
    }, { x: box.x, y: box.y + 50 });
    assert.strictEqual((await state(page)).count.split(' ')[0], '2', 'swiping left goes to the next slide');
    await page.evaluate(() => { G.i = G.steps.findIndex(x => x.id === 'assistant'); guideRender(); });
    await page.waitForFunction(() => document.getElementById('guide-img').complete);
    await page.screenshot({ path: `${OUT}/guide_m_assistant.png` });
    results.phone_errors = errors.filter(e => e.kind !== 'dialog' && !/Failed to load resource|net::ERR/.test(e.msg));
  }
  await browser.close();
  assert.deepStrictEqual(results.desktop_errors, []);
  assert.deepStrictEqual(results.phone_errors, []);
  console.log(`guide: all checks passed (staff ${results.staff} slides, admin ${results.admin}; pictures in ${OUT})`);
})().catch(e => { console.error(e); process.exit(1); });
