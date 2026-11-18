/*
 * Shared browser harness: a tiny static server for content-strategy-workflow/
 * and a Playwright page factory that boots the real app on demo data
 * (tests/demo/demo-env.js) for a given role.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..', '..');
const DEMO_ENV = fs.readFileSync(path.join(__dirname, '..', 'demo', 'demo-env.js'), 'utf8');
// The moment every demo session is frozen at, so screenshots don't drift day to day.
const DEMO_NOW = '2026-11-18T10:00:00-05:00';
const DEMO_TZ = 'America/New_York';
const APP_VERSION = (fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8').match(/var APP_VERSION = '([^']+)'/) || [])[1];

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright')); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      const file = path.join(APP_DIR, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(APP_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + server.address().port + '/', close: () => new Promise((r) => server.close(r)) }));
  });
}

// Optional: serve Fraunces / Inter / JetBrains Mono from local @fontsource
// packages when Google Fonts isn't reachable (CF_FONTS_DIR = a node_modules
// folder that contains @fontsource/*). In CI the real Google Fonts load.
function localFontsCss(origin) {
  const faces = [
    ['Fraunces', 'fraunces', 'normal', [500, 600, 700]], ['Fraunces', 'fraunces', 'italic', [500, 600]],
    ['Inter', 'inter', 'normal', [400, 500, 600, 700]], ['JetBrains Mono', 'jetbrains-mono', 'normal', [400, 500]],
  ];
  return faces.map(([family, pkg, style, weights]) => weights.map((w) =>
    `@font-face{font-family:'${family}';font-style:${style};font-weight:${w};font-display:block;src:url(${origin}__fonts/${pkg}/${pkg}-latin-${w}-${style}.woff2) format('woff2');}`).join('\n')).join('\n');
}

/**
 * opts: { role, signedOut, noCreds, freshUser, seenVersion, noRhythm, viewport, scheme, scale, mobile }
 *   freshUser: never seen the tour on this device (shows the welcome banner)
 *   seenVersion: last ContentFlow version this user saw (older = What's new banner)
 */
async function demoPage(browser, server, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 800 },
    deviceScaleFactor: opts.scale || 1,
    colorScheme: opts.scheme || 'light',
    timezoneId: DEMO_TZ,
    isMobile: !!opts.mobile,
    hasTouch: !!opts.mobile,
    reducedMotion: 'reduce',
  });
  const fontsDir = process.env.CF_FONTS_DIR;
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(server.url + '__fonts/') && fontsDir) {
      const [pkg, file] = u.slice((server.url + '__fonts/').length).split('/');
      return route.fulfill({ path: path.join(fontsDir, '@fontsource', pkg, 'files', file), contentType: 'font/woff2' });
    }
    if (u.startsWith(server.url)) return route.continue();
    if (u.includes('supabase-js')) return route.fulfill({ contentType: 'text/javascript', body: '/* blocked: demo-env.js provides window.supabase */' });
    if (u.includes('fonts.googleapis.com')) {
      if (fontsDir) return route.fulfill({ contentType: 'text/css', body: localFontsCss(server.url) });
      return route.continue();
    }
    if (u.includes('fonts.gstatic.com') && !fontsDir) return route.continue();
    return route.abort();
  });
  const role = opts.role || 'admin';
  const boot = {
    role,
    signedOut: !!opts.signedOut,
    noRhythm: !!opts.noRhythm,
  };
  // Freeze the clock BEFORE the demo data's init script is registered: init
  // scripts run in registration order, and demo-env.js dates everything
  // relative to Date.now() the moment it runs.
  await ctx.clock.setFixedTime(new Date(DEMO_NOW));
  await ctx.addInitScript({ content: 'window.__CF_DEMO = ' + JSON.stringify(boot) + ';\n' + DEMO_ENV });
  await ctx.addInitScript({ content: `(function(){try{
    ${role !== 'client' && !opts.noCreds && !opts.signedOut ? "localStorage.setItem('contentflow.credentials', JSON.stringify({token:'demo-token', listId:'901715762648'}));" : ''}
    ${opts.freshUser ? '' : "localStorage.setItem('contentflow.tour.seen.demo-' + " + JSON.stringify(role) + ", " + JSON.stringify(opts.seenVersion || APP_VERSION) + ");"}
  }catch(e){}})();` });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(e.message));
  return { ctx, page };
}

module.exports = { chromium, startServer, demoPage, APP_DIR, DEMO_NOW, APP_VERSION };
