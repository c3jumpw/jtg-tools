/*
 * Captures the getting-started tour's screenshots from the REAL app.
 *
 * For every step in tour/steps.js and every role it applies to, this boots
 * index.html on demo data (tests/demo/demo-env.js), performs the step's
 * actions, measures the highlighted elements and saves:
 *   tour/shots/<step>-<role>.webp
 *   tour/manifest.js  (app version + index.html fingerprint it was captured
 *                      from, image sizes, highlight boxes, any problems)
 *
 * Run from content-strategy-workflow/ after ANY change to index.html:
 *   node tests/tour/capture.js            (all steps)
 *   node tests/tour/capture.js board      (just the steps whose id matches)
 * The GitHub Action in .github/workflows/contentflow-tour.yml runs it on
 * every push that touches the app, so the tour can't fall behind.
 *
 * Fails (exit 1) when a step's action or highlight no longer finds its
 * element, the page throws, or the app asks demo-env.js for something it
 * doesn't know: fix the step or the demo data rather than shipping a
 * screenshot of a broken screen.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('../lib/harness');
const TOUR = require('../../tour/steps.js');

let sharp = null;
try { sharp = require('sharp'); } catch (e) { try { sharp = require(path.join(process.env.CF_TOOLS_DIR || '', 'sharp')); } catch (e2) { sharp = null; } }

const SHOTS_DIR = path.join(H.APP_DIR, 'tour', 'shots');
const MANIFEST = path.join(H.APP_DIR, 'tour', 'manifest.js');
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

function pick(v, role) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v[role] !== undefined ? v[role] : v.default;
  return v;
}

function readManifest() {
  if (!fs.existsSync(MANIFEST)) return null;
  const mod = { exports: {} };
  new Function('module', fs.readFileSync(MANIFEST, 'utf8'))(mod);
  return mod.exports;
}

async function runAction(page, a) {
  const [kind, sel, val] = a;
  const T = 6000;
  if (kind === 'click') return page.locator(sel).first().click({ timeout: T });
  if (kind === 'select') return page.locator(sel).first().selectOption(val, { timeout: T });
  if (kind === 'fill') return page.locator(sel).first().fill(val, { timeout: T });
  if (kind === 'wait') return page.locator(sel).first().waitFor({ state: 'visible', timeout: T });
  if (kind === 'waitMs') return page.waitForTimeout(sel);
  if (kind === 'scrollTo') return page.locator(sel).first().scrollIntoViewIfNeeded({ timeout: T });
  throw new Error('Unknown action ' + kind);
}

async function captureOne(browser, server, step, role) {
  const shot = step.shot || {};
  const boot = shot.boot || {};
  const vp = shot.phone ? PHONE : (shot.viewport || DESKTOP);
  const { ctx, page } = await H.demoPage(browser, server, Object.assign({ role, viewport: vp, scale: shot.phone ? 2 : 1.5, mobile: !!shot.phone }, boot));
  try {
    await page.goto(server.url + 'index.html');
    await page.locator(boot.signedOut || boot.noCreds ? '.connect-card' : '.topnav').first().waitFor({ timeout: 8000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(400);
    for (const a of (pick(shot.actions, role) || [])) await runAction(page, a);
    await page.waitForTimeout(250);
    const highlights = [];
    for (const sel of (pick(shot.highlight, role) || [])) {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout: 4000 });
      const b = await loc.boundingBox();
      const x = Math.max(0, b.x), y = Math.max(0, b.y);
      const r = Math.min(vp.width, b.x + b.width), btm = Math.min(vp.height, b.y + b.height);
      if (r <= x || btm <= y) throw new Error('highlight "' + sel + '" is off screen');
      highlights.push({ x: +(x / vp.width * 100).toFixed(2), y: +(y / vp.height * 100).toFixed(2), w: +((r - x) / vp.width * 100).toFixed(2), h: +((btm - y) / vp.height * 100).toFixed(2) });
    }
    const png = await page.screenshot({ type: 'png' });
    const file = step.id + '-' + role + '.webp';
    const img = sharp ? await sharp(png).webp({ quality: 82, effort: 5 }).toBuffer() : png;
    fs.writeFileSync(path.join(SHOTS_DIR, sharp ? file : file.replace(/\.webp$/, '.png')), img);
    const unhandled = await page.evaluate(() => window.__CF_DEMO_UNHANDLED || []);
    const problems = page.__errors.map((e) => 'page error: ' + e).concat(unhandled.map((u) => 'demo data has no answer for ' + u));
    return { key: step.id + '-' + role, entry: { file: sharp ? file : file.replace(/\.webp$/, '.png'), width: vp.width, height: vp.height, phone: !!shot.phone, highlights }, problems };
  } finally {
    await ctx.close();
  }
}

(async () => {
  const only = process.argv[2];
  if (!sharp) console.warn('sharp is not installed: saving PNG instead of WebP (npm install in tests/).');
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const indexHtml = fs.readFileSync(path.join(H.APP_DIR, 'index.html'));
  const previous = readManifest();
  const manifest = {
    appVersion: H.APP_VERSION,
    tourVersion: TOUR.version,
    indexSha256: crypto.createHash('sha256').update(indexHtml).digest('hex'),
    capturedAt: new Date().toISOString(),
    demoClock: H.DEMO_NOW,
    shots: only && previous ? Object.assign({}, previous.shots) : {},
    problems: [],
  };
  const server = await H.startServer();
  const browser = await H.chromium.launch();
  let failed = 0;
  for (const step of TOUR.steps) {
    if (only && step.id.indexOf(only) === -1) continue;
    for (const role of step.roles) {
      try {
        const res = await captureOne(browser, server, step, role);
        manifest.shots[res.key] = res.entry;
        res.problems.forEach((p) => manifest.problems.push(res.key + ': ' + p));
        console.log((res.problems.length ? 'WARN ' : 'ok   ') + res.key + (res.problems.length ? '  ' + res.problems.join('; ') : ''));
        if (res.problems.length) failed++;
      } catch (e) {
        failed++;
        manifest.problems.push(step.id + '-' + role + ': ' + e.message.split('\n')[0]);
        console.log('FAIL ' + step.id + '-' + role + '  ' + e.message.split('\n')[0]);
      }
    }
  }
  await browser.close();
  await server.close();

  // Drop screenshots no step uses any more.
  const keep = new Set(Object.values(manifest.shots).map((s) => s.file));
  fs.readdirSync(SHOTS_DIR).forEach((f) => { if (!keep.has(f)) fs.unlinkSync(path.join(SHOTS_DIR, f)); });

  fs.writeFileSync(MANIFEST,
    '/* Generated by tests/tour/capture.js -- do not edit by hand. */\n' +
    '(function (root) {\n  var M = ' + JSON.stringify(manifest, null, 2).replace(/\n/g, '\n  ') + ';\n' +
    "  if (typeof module !== 'undefined' && module.exports) module.exports = M;\n  else root.CF_TOUR_MANIFEST = M;\n})(this);\n");
  console.log('\n' + Object.keys(manifest.shots).length + ' screenshots for ContentFlow v' + manifest.appVersion + (failed ? ', ' + failed + ' with problems' : ''));
  process.exit(failed ? 1 : 0);
})();
