/*
 * Release gate for the getting-started tour and the full guide.
 * Run from content-strategy-workflow/:  node tests/tour/check.js
 *
 * Fails (exit 1) when any of these is true, so an update can't ship with
 * help pages that describe an older ContentFlow:
 *   1. tour/steps.js `version` differs from APP_VERSION in index.html.
 *   2. changelog.js has no entry for APP_VERSION, isn't in order, has an item
 *      with a bad type/role/step, or is missing a version that index.html's
 *      version history lists (the change log must stay complete).
 *   3. The screenshots were captured from a different index.html than the
 *      one in the repo (any edit to the app needs a re-capture).
 *   4. A step is missing a screenshot for one of its roles, or has more
 *      highlight rings than notes.
 *   5. The last capture recorded problems (page errors, broken selectors,
 *      requests the demo data couldn't answer).
 *   6. The running app (booted on demo data, per role) shows a top-bar tab,
 *      top-bar control, Settings menu item, Ideas sub-tab or Admin panel tab
 *      that no tour step for that role covers.
 *   7. guide.html's footer doesn't name this release (forces a guide review).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('../lib/harness');
const TOUR = require('../../tour/steps.js');
const CHANGELOG = require('../../changelog.js');

const problems = [];
function fail(msg) { problems.push(msg); }

function readManifest() {
  const file = path.join(H.APP_DIR, 'tour', 'manifest.js');
  if (!fs.existsSync(file)) return null;
  const mod = { exports: {} };
  new Function('module', fs.readFileSync(file, 'utf8'))(mod);
  return mod.exports;
}
function pick(v, role) { return v && typeof v === 'object' && !Array.isArray(v) ? (v[role] !== undefined ? v[role] : v.default) : v; }

function cmp(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function checkChangelog(indexHtml, version) {
  const rel = (CHANGELOG && CHANGELOG.releases) || [];
  if (!rel.length) return fail('changelog.js has no releases.');
  const last = rel[rel.length - 1];
  if (last.version !== version) fail(`changelog.js ends at v${last.version}, but index.html is v${version}. Add a v${version} entry at the end (RELEASING.md step 2).`);
  const stepIds = new Set(TOUR.steps.map((s) => s.id));
  const seen = new Set();
  rel.forEach((r, i) => {
    const where = `changelog.js v${r.version}`;
    if (!/^\d+\.\d+\.\d+$/.test(r.version || '')) fail(`${where}: version must look like 1.2.3.`);
    if (seen.has(r.version)) fail(`${where}: listed twice.`);
    seen.add(r.version);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || isNaN(new Date(r.date))) fail(`${where}: date must be YYYY-MM-DD.`);
    if (i > 0) {
      if (cmp(r.version, rel[i - 1].version) <= 0) fail(`${where}: comes after v${rel[i - 1].version} but isn't newer. Keep the log oldest to newest.`);
      if (r.date < rel[i - 1].date) fail(`${where}: dated before the release above it.`);
    }
    if (!r.title) fail(`${where}: needs a title.`);
    if (!(r.items || []).length) fail(`${where}: has no items.`);
    (r.items || []).forEach((it, n) => {
      const w = `${where} item ${n + 1}`;
      if (!['new', 'improved', 'fixed'].includes(it.type)) fail(`${w}: type must be new, improved or fixed.`);
      if (!it.title || !it.text) fail(`${w}: needs a title and text.`);
      if (!(it.roles || []).length || it.roles.some((ro) => !['admin', 'rep', 'client'].includes(ro))) fail(`${w}: roles must list admin, rep and/or client.`);
      if (it.step && !stepIds.has(it.step)) fail(`${w}: step "${it.step}" isn't a tour step.`);
      if (it.focus !== undefined && (!it.step || !Number.isInteger(it.focus) || it.focus < 0)) fail(`${w}: focus must be a highlight number (0, 1, ...) and needs a step.`);
    });
  });
  // Every version in index.html's version history must be in the change log.
  const history = new Set([...indexHtml.matchAll(/^\s+v(\d+\.\d+\.\d+) \(\d{4}-\d{2}-\d{2}\)/gm)].map((m) => m[1]));
  history.forEach((v) => { if (!seen.has(v)) fail(`index.html's version history has v${v}, but changelog.js doesn't. Add it.`); });
  if (!history.has(version)) fail(`index.html's version history comment has no v${version} entry.`);
}

async function appFeatures(browser, server, role) {
  const { ctx, page } = await H.demoPage(browser, server, { role });
  const feats = new Set(['screen:login']);
  if (role !== 'client') feats.add('screen:connect');
  try {
    await page.goto(server.url + 'index.html');
    await page.locator('.topnav').first().waitFor({ timeout: 8000 });
    (await page.$$eval('.topnav .view-tab[data-view]', (els) => els.map((e) => e.getAttribute('data-view')))).forEach((v) => feats.add('view:' + v));
    (await page.$$eval('.topnav [data-action]', (els) => els.map((e) => e.getAttribute('data-action')))).filter((a) => a !== 'set-view').forEach((a) => feats.add('topnav:' + a));
    await page.locator('.topnav [data-action="toggle-settings-menu"]').click();
    (await page.$$eval('.settings-menu [data-action]', (els) => els.map((e) => e.getAttribute('data-action')))).forEach((a) => feats.add('settings:' + a));
    await page.locator('.topnav [data-action="toggle-settings-menu"]').click(); // close it again
    const filter = page.locator('#account-filter-select');
    if (await filter.count()) await filter.selectOption('86demo101');
    await page.locator('.topnav [data-view="ideas"]').first().click();
    await page.locator('.ideas-subnav').waitFor({ timeout: 6000 });
    (await page.$$eval('.ideas-subnav [data-value]', (els) => els.map((e) => e.getAttribute('data-value')))).forEach((v) => feats.add('ideas:' + v));
    if (role === 'admin') {
      await page.locator('.topnav [data-action="toggle-settings-menu"]').click();
      await page.locator('.settings-menu [data-action="open-admin-panel"]').click();
      await page.locator('[data-action="set-admin-tab"]').first().waitFor({ timeout: 6000 });
      (await page.$$eval('[data-action="set-admin-tab"]', (els) => els.map((e) => e.getAttribute('data-value')))).forEach((v) => feats.add('admin:' + v));
    }
    const unhandled = await page.evaluate(() => window.__CF_DEMO_UNHANDLED || []);
    unhandled.forEach((u) => fail(role + ': demo data has no answer for ' + u + ' (add it to tests/demo/demo-env.js)'));
    page.__errors.forEach((e) => fail(role + ': page error while exploring the app: ' + e));
  } finally {
    await ctx.close();
  }
  return feats;
}

(async () => {
  const indexHtml = fs.readFileSync(path.join(H.APP_DIR, 'index.html'));
  const version = H.APP_VERSION;
  if (!version) fail('index.html has no APP_VERSION constant.');

  // 1 + 2
  if (TOUR.version !== version) fail(`tour/steps.js is for v${TOUR.version} but index.html is v${version}. Review the steps for this release, then set version: '${version}'.`);
  checkChangelog(indexHtml.toString(), version);

  // 3 + 4 + 5
  const M = readManifest();
  if (!M) fail('tour/manifest.js is missing. Run node tests/tour/capture.js.');
  else {
    const sha = crypto.createHash('sha256').update(indexHtml).digest('hex');
    if (M.indexSha256 !== sha) fail('The tour screenshots were captured from a different index.html. Run node tests/tour/capture.js.');
    if (M.appVersion !== version) fail(`The tour screenshots are from v${M.appVersion}, the app is v${version}. Run node tests/tour/capture.js.`);
    (M.problems || []).forEach((p) => fail('capture: ' + p));
    TOUR.steps.forEach((s) => s.roles.forEach((r) => {
      const shot = M.shots[s.id + '-' + r];
      if (!shot) return fail(`No screenshot for step "${s.id}" (${r}). Run node tests/tour/capture.js.`);
      if (!fs.existsSync(path.join(H.APP_DIR, 'tour', 'shots', shot.file))) fail(`tour/shots/${shot.file} is missing.`);
      const points = pick(s.points, r) || [];
      if (shot.highlights.length > points.length) fail(`Step "${s.id}" (${r}) has ${shot.highlights.length} rings but only ${points.length} notes.`);
    }));
    // A change-log close-up must point at a highlight every affected role has.
    CHANGELOG.releases.forEach((rel) => (rel.items || []).forEach((it) => {
      if (it.focus === undefined || !it.step) return;
      it.roles.forEach((r) => {
        const shot = M.shots[it.step + '-' + r];
        if (shot && !shot.highlights[it.focus]) fail(`changelog.js v${rel.version} "${it.title}": focus ${it.focus}, but step "${it.step}" (${r}) has only ${shot.highlights.length} highlights.`);
      });
    }));
    const valid = new Set();
    TOUR.steps.forEach((s) => s.roles.forEach((r) => valid.add(s.id + '-' + r)));
    Object.keys(M.shots).forEach((k) => { if (!valid.has(k)) fail(`tour/manifest.js has a screenshot for "${k}", which no step uses. Re-run the capture.`); });
  }

  // 7
  const guide = fs.readFileSync(path.join(H.APP_DIR, 'guide.html'), 'utf8');
  const majorMinor = version.split('.').slice(0, 2).join('.');
  if (guide.indexOf('matches ContentFlow v' + majorMinor) === -1) fail(`guide.html's footer doesn't say "matches ContentFlow v${majorMinor}". Review the guide for this release, then update its footer.`);

  // 6
  const server = await H.startServer();
  const browser = await H.chromium.launch();
  const covered = {};
  TOUR.steps.forEach((s) => s.roles.forEach((r) => (s.covers || []).forEach((c) => { (covered[r] = covered[r] || new Set()).add(c); })));
  for (const role of ['admin', 'rep', 'client']) {
    try {
      const feats = await appFeatures(browser, server, role);
      feats.forEach((f) => { if (!covered[role] || !covered[role].has(f)) fail(`${role}: the app has "${f}" but no tour step for ${role} covers it. Add a step (or add "${f}" to an existing step's covers) in tour/steps.js.`); });
      console.log(`${role}: ${feats.size} pages, menu items and tabs found, all checked`);
    } catch (e) {
      fail(role + ': could not explore the app: ' + e.message.split('\n')[0]);
    }
  }
  await browser.close();
  await server.close();

  if (problems.length) {
    console.log('\nTour/guide check FAILED:\n' + problems.map((p) => '  - ' + p).join('\n'));
    process.exit(1);
  }
  console.log(`\nTour/guide check passed for ContentFlow v${version}: ${Object.keys(M.shots).length} screenshots, every page and menu covered, change log complete (${CHANGELOG.releases.length} releases).`);
})();
