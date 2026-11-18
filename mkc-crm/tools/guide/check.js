// Checks that the tour still matches the app. Fails (exit 1) when:
//   - a screen, record tab, record button, pop-up or Settings section has
//     no slide that covers it (so a new feature can't ship without one);
//   - a slide has no picture, or a set-up in guide/make.js is missing;
//   - the pictures were made from an older version of the app
//     (media/guide/manifest.json vs index.html): run `node guide/make.js`;
//   - a slide is missing its title, text, deck or `since` date.
//
//   node guide/check.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { newPage, APP } = require('../harness/mock');

const MEDIA = path.join(__dirname, '..', '..', 'media', 'guide');
const MAKE = fs.readFileSync(path.join(__dirname, 'make.js'), 'utf8');

// Things the app has that aren't found by scanning the page, each named
// the way slides list them in `covers`.
const ALSO_REQUIRED = ['assistant', 'cmdk', 'quick-capture', 'bottom-nav', 'create-sheet', 'dash:invoices', 'bulk', 'filter:owner', 'guide', 'templates:edit', 'team:access-level', 'action:new-entry'];
// Found by the scan but deliberately without a slide of their own.
const EXEMPT = {
  'action:close': 'the record panel’s close button',
};

const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

(async () => {
  const problems = [];
  const browser = await chromium.launch();
  const { page, errors } = await newPage(browser, { mobile: false, opts: {} });
  await page.goto('file://' + APP);
  await page.waitForFunction(() => /Synced/.test(document.getElementById('sync-label').textContent));
  const found = await page.evaluate(async () => {
    const out = new Set();
    document.querySelectorAll('.nav-item[data-view]').forEach(e => out.add('view:' + e.dataset.view));
    document.querySelectorAll('.modal-overlay[id]').forEach(e => out.add('modal:' + e.id));
    document.querySelectorAll('#view-settings h3').forEach(h => out.add('settings:' + h.textContent.trim()));
    // A deal and a contact between them show every record button.
    for (const type of ['pipeline', 'contacts', 'leads']) {
      const t = (S.entries[type] || []).find(x => !x.parent);
      if (!t) continue;
      openProfile(t.id, type);
      await new Promise(r => setTimeout(r, 500));
      document.querySelectorAll('#profile-panel .pf-tab').forEach(e => { const m = (e.getAttribute('onclick') || '').match(/switchPfTab\('([a-z-]+)'/); if (m) out.add('pf:' + m[1]); });
      document.querySelectorAll('#profile-panel button').forEach(b => { if (b.offsetParent || b.id === 'pf-frontrow-btn') out.add('btn:' + (b.textContent.trim() || (b.getAttribute('aria-label') || '').trim())); });
    }
    return [...out];
  });
  const steps = await page.evaluate(() => ({ steps: GUIDE_STEPS.map(s => ({ id: s.id, deck: s.deck, only: s.only || null, since: s.since, title: s.title, body: s.body, covers: s.covers || [], go: typeof s.go })), decks: GUIDE_DECKS.map(d => d.id) }));
  await browser.close();

  const features = new Set(ALSO_REQUIRED);
  for (const f of found) {
    if (f.startsWith('settings:')) features.add('settings:' + slug(f.slice(9)));
    else if (f.startsWith('btn:')) features.add('action:' + slug(f.slice(4).replace(/^[+✨]\s*/, '').replace(/↗/g, '')));
    else features.add(f);
  }
  const covered = new Set(steps.steps.flatMap(s => s.covers));
  for (const f of [...features].sort()) if (!covered.has(f) && !EXEMPT[f]) problems.push(`No slide covers "${f}". Add a slide to GUIDE_STEPS (or add it to an existing slide's covers) and a set-up in guide/make.js.`);

  const ids = new Set();
  for (const s of steps.steps) {
    if (ids.has(s.id)) problems.push(`Slide id "${s.id}" is used twice.`);
    ids.add(s.id);
    if (!steps.decks.includes(s.deck)) problems.push(`${s.id}: unknown deck "${s.deck}".`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.since || '')) problems.push(`${s.id}: "since" must be the date the slide was added or changed (YYYY-MM-DD).`);
    if (!s.title || !s.body) problems.push(`${s.id}: needs a title and text.`);
    if (!new RegExp(`['"]?${s.id.replace(/[-]/g, '\\-')}['"]?\\s*:\\s*\\{\\s*setup`).test(MAKE)) problems.push(`${s.id}: no set-up in guide/make.js.`);
    for (const d of ['d', 'm']) {
      if (s.only && s.only !== (d === 'm' ? 'phone' : 'desktop')) continue;
      const f = path.join(MEDIA, d, s.id + '.jpg');
      if (!fs.existsSync(f) || fs.statSync(f).size < 2000) problems.push(`${s.id}: missing ${d === 'm' ? 'phone' : 'desktop'} picture (${path.relative(process.cwd(), f)}). Run node guide/make.js ${s.id}`);
    }
  }
  for (const d of ['d', 'm']) for (const f of fs.existsSync(path.join(MEDIA, d)) ? fs.readdirSync(path.join(MEDIA, d)) : []) {
    if (!ids.has(f.replace(/\.jpg$/, ''))) problems.push(`media/guide/${d}/${f} belongs to no slide; delete it.`);
  }

  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(MEDIA, 'manifest.json'), 'utf8')); } catch (e) {}
  const appHash = crypto.createHash('sha256').update(fs.readFileSync(APP)).digest('hex');
  if (!manifest) problems.push('media/guide/manifest.json is missing. Run node guide/make.js');
  else if (manifest.appHash !== appHash) problems.push('The tour pictures were made from an older version of the CRM. Run node guide/make.js (the GitHub action does this on every push to main).');

  const bad = errors.filter(e => e.kind !== 'dialog' && !/Failed to load resource|net::ERR/.test(e.msg));
  if (bad.length) problems.push('Script errors while checking: ' + bad.map(e => e.msg).join('; '));

  if (problems.length) { console.error(`Tour check failed (${problems.length}):\n- ` + problems.join('\n- ')); process.exit(1); }
  console.log(`Tour check passed: ${steps.steps.length} slides cover ${features.size} features; pictures match the app.`);
})().catch(e => { console.error(e); process.exit(1); });
