/*
 * Browser checks for the in-app Guide (v1.25.0). Kept inside the repo so it
 * survives sandbox resets (the earlier jsdom suite lived outside and was lost).
 *
 * Run from content-strategy-workflow/:
 *   python3 -m http.server 8765 --bind 127.0.0.1 &
 *   node tests/guide.test.js
 * Needs Playwright (npm i -D playwright, or a global install). Supabase is
 * replaced by tests/supa-stub.js; every other network request is blocked.
 */
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright')); }
const fs = require('fs');
const BASE = 'http://127.0.0.1:8765/index.html';
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } }
async function setup(browser, role, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 860 }, colorScheme: opts.scheme || 'light' });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('supabase-js')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(__dirname + '/supa-stub.js', 'utf8') });
    if (u.startsWith('http://127.0.0.1:8765/')) return route.continue();
    if (u.includes('contentflow-oauth')) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"offline test"}' });
    return route.abort();
  });
  await ctx.addInitScript(`window.__ROLE=${JSON.stringify(role)};${opts.loggedOut ? 'window.__LOGGED_OUT=true;' : ''}` +
    (role !== 'client' && !opts.noCreds ? `try{localStorage.setItem('contentflow.credentials', JSON.stringify({token:'x'}))}catch(e){}` : ''));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE);
  return { ctx, page, errs };
}
(async () => {
  const browser = await chromium.launch();
  for (const role of ['admin', 'rep', 'client']) {
    console.log('role ' + role);
    const { ctx, page, errs } = await setup(browser, role);
    const btn = page.locator('.topnav [data-action="open-guide"]').first();
    await btn.waitFor({ timeout: 8000 });
    ok(await btn.isVisible(), 'topnav shows the Guide button');
    await btn.click();
    const layer = page.locator('#guide-layer');
    ok(await layer.isVisible(), 'guide layer opens');
    const src = await page.locator('#guide-layer iframe').getAttribute('src');
    ok(src.includes('embed=1') && src.includes('role=' + role), 'iframe src carries embed + role (' + src + ')');
    const frame = page.frameLocator('#guide-layer iframe');
    await frame.locator('#how-it-fits').waitFor({ timeout: 8000 });
    const fr = page.frames().find(f => f.url().includes('guide.html'));
    const inner = await fr.evaluate(() => ({ embed: document.body.classList.contains('embed'), role: document.body.getAttribute('data-role'), switchHidden: document.getElementById('role-switch-wrap').hidden, adminVisible: !document.getElementById('admin-panel').hidden }));
    ok(inner.embed, 'guide is in embed mode');
    ok(inner.role === role, 'guide opened on the ' + role + ' view');
    ok(inner.switchHidden === (role === 'client'), 'role switch ' + (role === 'client' ? 'locked for client' : 'available'));
    ok(inner.adminVisible === (role === 'admin'), 'admin sections ' + (role === 'admin' ? 'shown' : 'hidden'));
    // Leave a marker in the guide, re-render the app underneath, reopen: same document means no reload.
    await fr.evaluate(() => { window.__marker = 42; });
    await page.locator('.guide-close').click();
    ok(!(await layer.isVisible()), 'Back to ContentFlow closes it');
    await page.locator('.topnav [data-action="set-view"][data-view="list"]').click();
    await page.locator('.topnav [data-action="toggle-settings-menu"]').click();
    await page.locator('.settings-menu [data-action="open-guide"]').click();
    ok(await layer.isVisible(), 'Settings > Open the guide opens it');
    ok(!(await page.locator('.settings-menu').count()), 'settings menu closed behind it');
    const fr2 = page.frames().find(f => f.url().includes('guide.html'));
    ok(await fr2.evaluate(() => window.__marker === 42), 'guide kept its place across app re-renders (no reload)');
    // Escape from inside the guide document
    await fr2.locator('body').click({ position: { x: 5, y: 400 } });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    ok(!(await layer.isVisible()), 'Escape inside the guide closes the layer');
    // Theme follows the app via the storage event
    await page.locator('.topnav [data-action="toggle-settings-menu"]').click();
    await page.locator('.settings-menu [data-action="toggle-theme"]').click();
    const appTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await page.waitForTimeout(150);
    const guideTheme = await fr2.evaluate(() => document.documentElement.getAttribute('data-theme'));
    ok(appTheme && appTheme === guideTheme, 'theme toggle reaches the guide (' + appTheme + '/' + guideTheme + ')');
    if (role === 'admin') {
      if (!(await page.locator('.settings-menu').count())) await page.locator('.topnav [data-action="toggle-settings-menu"]').click();
      await page.locator('.settings-menu [data-action="open-admin-panel"]').click();
      await page.locator('.topnav [data-action="open-guide"][data-anchor="admin-panel"]').click();
      await page.waitForTimeout(300);
      const h = await fr2.evaluate(() => location.hash);
      ok(h === '#admin-panel', 'admin panel Guide button jumps to #admin-panel');
      await page.keyboard.press('Escape');
    }
    ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }
  // Signed-out: sign-in screen link
  console.log('signed out');
  {
    const { ctx, page, errs } = await setup(browser, 'admin', { loggedOut: true, noCreds: true });
    const link = page.locator('[data-action="open-guide"][data-anchor="getting-in"]');
    await link.waitFor({ timeout: 8000 });
    await link.click();
    ok(await page.locator('#guide-layer').isVisible(), 'sign-in screen link opens the guide');
    const src = await page.locator('#guide-layer iframe').getAttribute('src');
    ok(!src.includes('role='), 'no role passed when signed out');
    ok(errs.length === 0, 'no page errors');
    await ctx.close();
  }
  // Phone screenshot, client, dark
  {
    const { ctx, page } = await setup(browser, 'client', { viewport: { width: 390, height: 844 }, scheme: 'dark' });
    await page.locator('.topnav [data-action="open-guide"]').first().waitFor();
    
    await page.locator('.topnav [data-action="open-guide"]').first().click();
    await page.frameLocator('#guide-layer iframe').locator('#how-it-fits').waitFor();
    await page.waitForTimeout(200);
    
    await ctx.close();
  }
  {
    const { ctx, page } = await setup(browser, 'admin');
    await page.locator('.topnav [data-action="open-guide"]').first().waitFor();
    await page.locator('.topnav [data-action="open-guide"]').first().click();
    await page.frameLocator('#guide-layer iframe').locator('#how-it-fits').waitFor();
    await page.waitForTimeout(200);
    
    await page.locator('.guide-close').click();
    
    await ctx.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
