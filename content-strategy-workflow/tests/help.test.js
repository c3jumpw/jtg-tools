/*
 * Browser tests: the Help layer (tour + guide), the tour banner, and the
 * v1.26.0 fixes. Runs the real index.html on demo data for each role.
 * Run from content-strategy-workflow/:  node tests/help.test.js
 */
const H = require('./lib/harness');
const TOUR = require('../tour/steps.js');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
const frameFor = (page, file) => page.frames().find((f) => f.url().includes(file));

async function boot(browser, server, opts) {
  const s = await H.demoPage(browser, server, opts);
  await s.page.goto(server.url + 'index.html');
  await s.page.locator(opts.signedOut ? '.connect-card' : '.topnav').first().waitFor({ timeout: 8000 });
  return s;
}

(async () => {
  const server = await H.startServer();
  const browser = await H.chromium.launch();

  for (const role of ['admin', 'rep', 'client']) {
    console.log('\n' + role);
    const { ctx, page } = await boot(browser, server, { role });
    const layer = page.locator('#guide-layer');

    // "?" opens the tour first, on this role
    await page.locator('.topnav [data-action="open-help"]').click();
    ok(await layer.isVisible(), '? opens the help layer');
    const tourSrc = await page.locator('.guide-frame[data-doc="tour"]').getAttribute('src');
    ok(tourSrc.startsWith('tour.html?embed=1') && tourSrc.includes('role=' + role), 'first time, it opens the tour for this role');
    await page.frameLocator('.guide-frame[data-doc="tour"]').locator('#slide').waitFor({ timeout: 8000 });
    let tour = frameFor(page, 'tour.html');
    const first = await tour.evaluate(() => ({ title: document.getElementById('step-title').textContent, rings: document.querySelectorAll('.ring').length, img: document.getElementById('shot-img').getAttribute('src'), label: document.getElementById('progress-label').textContent, segHidden: document.getElementById('role-seg').hidden }));
    const roleSteps = TOUR.steps.filter((s) => s.roles.includes(role));
    ok(first.title === (typeof roleSteps[0].title === 'string' ? roleSteps[0].title : roleSteps[0].title[role] || roleSteps[0].title.default), 'tour starts at step 1 (' + first.title + ')');
    ok(first.img === 'tour/shots/' + roleSteps[0].id + '-' + role + '.webp', 'step 1 shows the real screenshot for this role');
    ok(first.rings > 0, 'highlight rings drawn (' + first.rings + ')');
    ok(first.label.includes('/ ' + roleSteps.length), 'progress shows ' + roleSteps.length + ' steps');
    ok(first.segHidden === (role === 'client'), 'role switch ' + (role === 'client' ? 'locked for clients' : 'available'));
    const imgOk = await tour.evaluate(() => new Promise((res) => { const i = document.getElementById('shot-img'); if (i.complete) res(i.naturalWidth > 0); else { i.onload = () => res(true); i.onerror = () => res(false); } }));
    ok(imgOk, 'screenshot file loads');
    await tour.locator('#next').click();
    ok((await tour.locator('#step-eyebrow').textContent()).includes('Step 2 of'), 'Next moves to step 2');
    await tour.locator('body').press('ArrowRight');
    ok((await tour.locator('#step-eyebrow').textContent()).includes('Step 3 of'), 'arrow key moves to step 3');

    // Every step renders for this role, and its screenshot exists
    let allOk = true;
    for (let i = 0; i < roleSteps.length; i++) {
      const r = await tour.evaluate((n) => { document.querySelector('[data-tick="' + n + '"]').click(); return { src: document.getElementById('shot-img').getAttribute('src'), missing: !!document.querySelector('.shot-missing') }; }, i);
      if (r.missing || !r.src) { allOk = false; console.log('    missing screenshot at step ' + (i + 1)); }
    }
    ok(allOk, 'all ' + roleSteps.length + ' steps have a screenshot');

    // "More in the full guide" switches tabs, keeping the tour where it was
    await tour.evaluate(() => { document.querySelector('[data-tick="2"]').click(); });
    await tour.locator('#step-more').click();
    await page.waitForTimeout(300);
    ok(await page.locator('.guide-frame[data-doc="guide"]').isVisible(), 'More in the full guide switches to the Full guide tab');
    ok((await page.locator('[data-help-tab="guide"]').getAttribute('aria-pressed')) === 'true', 'Full guide tab marked active');
    await page.frameLocator('.guide-frame[data-doc="guide"]').locator('#how-it-fits').waitFor({ timeout: 8000 });
    const guide = frameFor(page, 'guide.html');
    ok((await guide.evaluate(() => location.hash)) === '#' + roleSteps[2].guide, 'guide opened at #' + roleSteps[2].guide);
    ok((await guide.evaluate(() => document.body.getAttribute('data-role'))) === role, 'guide is on the ' + role + ' view');
    await page.locator('[data-help-tab="tour"]').click();
    tour = frameFor(page, 'tour.html');
    ok((await tour.locator('#step-eyebrow').textContent()).includes('Step 3 of'), 'back on the tour tab, still at step 3');
    // Guide's tour button switches tabs inside ContentFlow
    await page.locator('[data-help-tab="guide"]').click();
    await guide.locator('#tour-cta').click();
    await page.waitForTimeout(200);
    ok(await page.locator('.guide-frame[data-doc="tour"]').isVisible(), "the guide's tour button switches to the tour tab");

    // Close, re-render the app, reopen: same documents (no reload)
    await tour.evaluate(() => { window.__marker = 7; });
    await page.keyboard.press('Escape');
    await tour.locator('body').press('Escape');
    await page.waitForTimeout(150);
    ok(!(await layer.isVisible()), 'Escape inside the tour closes Help');
    await page.locator('.topnav [data-view="list"]').first().click();
    await page.locator('.topnav [data-action="toggle-settings-menu"]').click();
    ok(await page.locator('.settings-menu-version').textContent() === 'ContentFlow v' + H.APP_VERSION, 'Settings shows the version');
    await page.locator('.settings-menu [data-action="open-guide"]').click();
    ok(await page.locator('.guide-frame[data-doc="guide"]').isVisible(), 'Settings > Full guide opens the guide tab');
    ok(await frameFor(page, 'tour.html').evaluate(() => window.__marker === 7), 'tour kept its place across app re-renders');
    await page.locator('.guide-close').click();
    await page.locator('.topnav [data-action="open-help"]').click();
    ok(await page.locator('.guide-frame[data-doc="guide"]').isVisible(), '? reopens the last-used tab (guide)');
    await page.locator('.guide-close').click();
    ok(page.__errors.length === 0, 'no page errors' + (page.__errors.length ? ': ' + page.__errors.join(' | ') : ''));
    await ctx.close();
  }

  console.log('\ntour banner');
  {
    const { ctx, page } = await boot(browser, server, { role: 'rep', freshUser: true });
    ok(await page.locator('.tour-banner').isVisible(), 'first sign-in on a device shows the take-the-tour banner');
    await page.locator('[data-action="dismiss-tour-banner"]').click();
    ok(!(await page.locator('.tour-banner').count()), 'Not now hides it');
    await page.locator('.topnav [data-view="list"]').first().click();
    ok(!(await page.locator('.tour-banner').count()), 'and it stays hidden after re-renders');
    await page.reload();
    await page.locator('.topnav').first().waitFor();
    await page.waitForTimeout(300);
    ok(!(await page.locator('.tour-banner').count()), 'and after a reload');
    await ctx.close();
  }
  {
    const { ctx, page } = await boot(browser, server, { role: 'client', seenVersion: '1.25.0' });
    ok(await page.locator('.tour-banner').isVisible(), "after an update, the banner offers what's new");
    ok((await page.locator('.tour-banner-text').textContent()).includes(TOUR.whatsNew[H.APP_VERSION][0].title), 'banner names the first What\'s new item');
    await page.locator('.tour-banner [data-action="open-tour"]').click();
    await page.frameLocator('.guide-frame[data-doc="tour"]').locator('#news-panel').waitFor({ timeout: 8000 });
    const tour = frameFor(page, 'tour.html');
    const items = await tour.locator('#news-list li').count();
    const expected = TOUR.whatsNew[H.APP_VERSION].filter((n) => !n.roles || n.roles.includes('client')).length;
    ok(items === expected, "What's new lists the " + expected + ' items for clients');
    await page.locator('.guide-close').click();
    ok(!(await page.locator('.tour-banner').count()), 'opening it retires the banner');
    await ctx.close();
  }
  {
    const { ctx, page } = await boot(browser, server, { role: 'admin', signedOut: true });
    await page.locator('[data-action="open-tour"]').click();
    await page.frameLocator('.guide-frame[data-doc="tour"]').locator('#intro').waitFor({ timeout: 8000 });
    ok((await frameFor(page, 'tour.html').locator('.role-card').count()) === 3, 'signed out: Take the tour opens the role chooser');
    await ctx.close();
  }

  console.log('\nv1.26.0 fixes');
  {
    const { ctx, page } = await boot(browser, server, { role: 'admin' });
    await page.locator('.card:has-text("Fall menu launch reel")').click();
    await page.locator('#task-status-select').waitFor();
    const nb = await page.evaluate(() => ({ inputs: [...document.querySelectorAll('.modal input')].filter((i) => (i.value || '').includes('notes.example.com')).length, link: !!document.querySelector('.modal a[href*="notes.example.com"]'), label: [...document.querySelectorAll('.modal .field-label')].filter((l) => l.textContent.trim() === 'Notebook Link').length }));
    ok(nb.inputs === 0 && nb.label === 0, 'admin: Notebook Link is not an editable field');
    ok(nb.link, 'admin: Notebook shows as a read-only link');
    const closeColor = await page.locator('.modal .icon-btn[data-action="close-modal"]').evaluate((el) => getComputedStyle(el).color);
    const rgb = closeColor.match(/\d+/g).map(Number);
    ok(rgb[0] < 160, 'modal close button is dark on the light modal (' + closeColor + ')');
    await page.locator('[data-action="close-modal"] >> nth=0').click();
    // For Review check fires for lowercase ClickUp status names
    let dialogs = 0;
    page.on('dialog', (d) => { dialogs++; d.dismiss(); });
    await page.locator('.card:has-text("Holiday hours announcement")').click();
    await page.locator('#task-status-select').selectOption('for review');
    await page.locator('[data-action="save-task"]').click();
    await page.waitForTimeout(300);
    ok(dialogs === 1, 'moving an entry with no draft into "for review" asks first');
    await page.locator('[data-action="close-modal"] >> nth=0').click();
    // Dashboard status order
    await page.locator('.topnav [data-view="dashboard"]').first().click();
    await page.locator('.dashboard .dash-bars').first().waitFor();
    const labels = (await page.locator('.dashboard .dash-bars').first().locator('.dash-bar-label').allTextContents()).map((t) => t.trim());
    ok(labels[0] === 'idea' && labels[labels.length - 1] === 'published', 'Dashboard By status runs Idea to Published (' + labels.join(', ') + ')');
    await ctx.close();
  }
  {
    const { ctx, page } = await boot(browser, server, { role: 'rep' });
    await page.locator('.card:has-text("Fall menu launch reel")').click();
    await page.locator('#task-status-select').waitFor();
    ok(!(await page.evaluate(() => document.querySelector('.modal').textContent.includes('notes.example.com'))), 'team member: no Notebook link anywhere in the entry');
    await ctx.close();
  }
  {
    const { ctx, page } = await boot(browser, server, { role: 'client' });
    await page.locator('.board .card').first().waitFor();
    const cols = await page.$$eval('.board-column-title', (els) => els.map((e) => e.textContent));
    ok(JSON.stringify(cols) === JSON.stringify(['idea', 'copy - in progress', 'media - in progress', 'for review', 'scheduled', 'published']), 'client Board stages in workflow order (' + cols.join(', ') + ')');
    await page.locator('.card:has-text("Fall menu launch reel")').click();
    await page.locator('#client-comment-form').waitFor();
    const colsCss = await page.locator('.modal-card .modal-body').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    ok(colsCss === 1, 'client entry panel is one column');
    await ctx.close();
  }

  await browser.close();
  await server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
