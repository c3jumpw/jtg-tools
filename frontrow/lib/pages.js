import { esc } from './core.js';

/* HTML for the three kinds of page Frontrow serves:
 *
 *   landingPage()       the Frontrow product page at /
 *   appShell(org)       an organization's portal at /<slug> (or its own
 *                       domain): sign-in, setup, and the signed-in app.
 *                       org = null gives the neutral sign-in at /signin.
 *   notFoundPage()      an organization that doesn't exist or is off
 *
 * The shell is rendered on the server so each organization's name, colours,
 * home-screen icon and manifest are right before any script runs — which is
 * what "Add to Home Screen" and link previews read. Values reach the page
 * only as escaped text or as a JSON data block, never as script.
 */

const FONTS = {
  jtg: { display: '"Saira", "Arial Narrow", Arial, sans-serif', body: '"Instrument Sans", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', files: ['saira-latin-var.woff2', 'instrument-sans-latin-var.woff2'] },
  default: { display: '"Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', body: '"Figtree", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', files: ['bricolage-grotesque-latin-var.woff2', 'figtree-latin-var.woff2'] }
};

const HEX = /^#[0-9a-f]{6}$/i;
const color = (v, fallback) => (HEX.test(v || '') ? v : fallback);

/** JSON that is safe inside <script type="application/json">. */
function dataBlock(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function fontPreloads(set) {
  return set.files.map((f) => `<link rel="preload" href="/assets/fonts/${f}" as="font" type="font/woff2" crossorigin>`).join('\n  ');
}

const MARK = `<svg class="fr-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#15161D"/><rect x="13" y="14" width="38" height="7" rx="3.5" fill="#FBF8F3"/><path d="M12 38a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v12H12z" fill="#FBF8F3" opacity=".55"/><path d="M26.5 38a5 5 0 0 1 5-5h1a5 5 0 0 1 5 5v12h-11z" fill="#FF5A36"/><path d="M39 38a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v12H39z" fill="#FBF8F3" opacity=".55"/></svg>`;

export function appShell({ org = null, siteUrl = '' } = {}) {
  const b = (org && org.branding) || {};
  const fonts = FONTS[b.font] || FONTS.default;
  const ink = color(b.ink, '#15161D');
  const accent = color(b.accent, '#15161D');
  const hi = color(b.highlight, '#FF5A36');
  const icon = /^\/assets\/[a-z0-9/_-]+$/i.test(b.icon || '') ? b.icon : '/assets/brand';
  const title = org ? `${org.name} · Client portal` : 'Sign in · Frontrow';
  const short = org ? (org.name.length <= 12 ? org.name : org.slug.toUpperCase()) : 'Frontrow';
  const description = org ? `Sign in to your ${org.name} client portal for updates, tasks and guides from your team.` : 'Sign in to your client portal.';
  const boot = { org, frontrow: { url: siteUrl } };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="${ink}">
  <meta name="robots" content="noindex, nofollow">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="${esc(short)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <link rel="manifest" href="/api/manifest${org ? `?org=${esc(org.slug)}` : ''}">
  <link rel="icon" type="image/png" sizes="32x32" href="${icon}/favicon-32.png">
  <link rel="apple-touch-icon" href="${icon}/apple-touch-icon.png">
  ${fontPreloads(fonts)}
  <link rel="stylesheet" href="/css/app.css">
  <style>:root{--ink:${ink};--accent:${accent};--hi:${hi};--display:${fonts.display};--body:${fonts.body}}</style>
  <script type="application/json" id="fr-boot">${dataBlock(boot)}</script>
  <script type="module" src="/js/app.js"></script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div id="app"><div class="boot" role="status">Loading…</div></div>
  <noscript><p class="noscript">This portal needs JavaScript turned on.</p></noscript>
</body>
</html>`;
}

export function notFoundPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portal not found · Frontrow</title><meta name="robots" content="noindex"><link rel="icon" href="/assets/brand/favicon-32.png"><link rel="stylesheet" href="/css/landing.css"></head>
<body class="nf"><main class="nf-card"><a href="/" class="fr-logo">${MARK}<span>frontrow</span></a>
<h1>We couldn’t find that portal</h1><p>Check the link your team sent you, or sign in and we’ll take you to the right place.</p>
<p><a class="btn btn-ink" href="/signin">Sign in</a></p></main></body></html>`;
}

/** Shown when an organization's page can't be read (database down or not
 *  configured), instead of a bare JSON error in the client's browser. */
export function unavailablePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Back shortly · Frontrow</title><meta name="robots" content="noindex"><link rel="icon" href="/assets/brand/favicon-32.png"><link rel="stylesheet" href="/css/landing.css"></head>
<body class="nf"><main class="nf-card"><a href="/" class="fr-logo">${MARK}<span>frontrow</span></a>
<h1>Your portal will be back shortly</h1><p>We couldn’t load this page just now. Please try again in a few minutes.</p>
<p><a class="btn btn-ink" href="">Try again</a></p></main></body></html>`;
}

export function landingPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Frontrow · Client portals for teams with many brands</title>
  <meta name="description" content="Frontrow gives every client a front-row seat to the work: branded update pages, tasks and guides they read on their phone, kept in step with your CRM.">
  <meta name="theme-color" content="#FBF8F3">
  <meta property="og:title" content="Frontrow — give every client a front-row seat to the work">
  <meta property="og:description" content="Branded client portals with updates, tasks and guides, synced with your CRM.">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/favicon-32.png">
  <link rel="icon" type="image/svg+xml" href="/assets/brand/favicon.svg">
  <link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png">
  <link rel="preload" href="/assets/fonts/bricolage-grotesque-latin-var.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/figtree-latin-var.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/landing.css">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="top">
    <div class="wrap top-in">
      <a href="/" class="fr-logo" aria-label="Frontrow home">${MARK}<span>frontrow</span></a>
      <nav class="top-nav" aria-label="Main">
        <a href="#how">How it works</a>
        <a href="#groups">For groups</a>
        <a class="btn btn-ink btn-sm" href="/signin">Client sign in</a>
      </nav>
    </div>
  </header>

  <main id="main">
    <section class="hero">
      <div class="wrap hero-in">
        <div class="hero-copy">
          <p class="eyebrow">Client portals</p>
          <h1>Give every client a <span class="hl">front-row seat</span> to the work.</h1>
          <p class="lede">Frontrow turns your team’s notes into clear, branded pages your clients read on their phone — progress updates, tasks and how-to guides, kept in step with your CRM.</p>
          <div class="cta">
            <a class="btn btn-ink" href="/signin">Client sign in</a>
            <a class="btn btn-ghost" href="#how">See how it works</a>
          </div>
        </div>
        <div class="hero-art" aria-hidden="true">
          <div class="phone">
            <div class="phone-top"><span class="dot"></span><span class="pt-name">Northwind Bakery</span><span class="pt-badge">Update</span></div>
            <div class="phone-body">
              <p class="pb-kicker">October</p>
              <p class="pb-title">Online orders up 32%</p>
              <div class="pb-stats">
                <div><b>132</b><span>orders</span></div>
                <div><b>+32%</b><span>vs Sept</span></div>
                <div><b>$18</b><span>per lead</span></div>
              </div>
              <div class="pb-bars"><i style="height:46%"></i><i style="height:58%"></i><i style="height:88%"></i></div>
              <div class="pb-task"><span class="box"></span><div><b>Approve November budget</b><span>Due Friday</span></div></div>
              <div class="pb-task"><span class="box"></span><div><b>Send 3 photos of new cakes</b><span>When you can</span></div></div>
            </div>
          </div>
          <div class="seat-row"><i></i><i class="on"></i><i></i></div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="wrap">
        <h2>What your clients see</h2>
        <p class="sub">One link, on their home screen. No logins to remember for every vendor — just what’s happening and what you need from them.</p>
        <div class="cards">
          <article class="card"><span class="ic ic-update"></span><h3>Updates that read like a story</h3><p>What you did, what it changed and what’s next — with the numbers up front and a chart when there’s a trend.</p></article>
          <article class="card"><span class="ic ic-task"></span><h3>Tasks they can’t miss</h3><p>One clear ask at a time: why it matters, when it’s due, and a checklist so they know when they’re done.</p></article>
          <article class="card"><span class="ic ic-guide"></span><h3>Guides they can follow</h3><p>Step-by-step how-tos written for non-technical people, so the same question doesn’t come back next week.</p></article>
        </div>
      </div>
    </section>

    <section class="groups" id="groups">
      <div class="wrap groups-in">
        <div>
          <p class="eyebrow">For groups with many brands</p>
          <h2>Every organization gets its own front door.</h2>
          <p>Frontrow is built for groups that run several agencies or branches. Each organization has its own sign-in page with its logo, colours and brands — Frontrow stays quietly in the background.</p>
          <ul class="ticks">
            <li>Organizations, branches and clients mirror your CRM</li>
            <li>A contact can belong to more than one client account</li>
            <li>Only people on an active account can sign in</li>
          </ul>
        </div>
        <div class="tree" aria-hidden="true">
          <div class="node node-org"><b>Your group</b><span>Organization</span></div>
          <div class="branches">
            <div class="node"><b>Agency A</b><span>Branch</span></div>
            <div class="node"><b>Agency B</b><span>Branch</span></div>
            <div class="node"><b>Agency C</b><span>Branch</span></div>
          </div>
          <div class="clients"><span>Client</span><span>Client</span><span>Client</span><span>Client</span><span>Client</span></div>
        </div>
      </div>
    </section>

    <section class="how" id="how">
      <div class="wrap">
        <h2>How it works</h2>
        <ol class="steps">
          <li><span class="num">1</span><h3>Add from your CRM</h3><p>One button on a contact — <b>Add to Frontrow</b> — checks they’re on an active account and brings them in with their company.</p></li>
          <li><span class="num">2</span><h3>Send a setup link</h3><p>They choose a password and put the portal on their home screen. Every step is noted back on the CRM contact.</p></li>
          <li><span class="num">3</span><h3>Publish updates</h3><p>Paste your notes, copy a ready-made prompt or draft with AI, check the preview, and publish. That’s it.</p></li>
        </ol>
      </div>
    </section>

    <section class="safe">
      <div class="wrap safe-in">
        <h2>Careful by default</h2>
        <ul>
          <li><b>Only active accounts.</b> Access follows your CRM: switch an account off there and its people are out.</li>
          <li><b>Passwords done properly.</b> Stored as one-way hashes; setup and reset links work once and expire.</li>
          <li><b>Pages that can’t misbehave.</b> Every update is shown in a locked-down frame — no scripts, no forms.</li>
        </ul>
      </div>
    </section>
  </main>

  <footer class="foot">
    <div class="wrap foot-in">
      <a href="/" class="fr-logo fr-logo-sm">${MARK}<span>frontrow</span></a>
      <p>A client portal platform by MKC.</p>
      <a href="/signin">Client sign in</a>
    </div>
  </footer>
</body>
</html>`;
}
