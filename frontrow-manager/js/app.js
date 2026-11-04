/* MKC Frontrow Manager — single-page staff tool.
 *
 * Writes and publishes client portal updates. Every rule about who may see or
 * change what lives on the server (lib/access.js); this file only hides
 * buttons a role can't use, so a stale or edited page still can't do more.
 * Stored client pages are never inserted into this document: they are shown
 * through /api/view in a sandboxed iframe.
 */
import { FORMATS, buildPrompt, formatById, PROMPT_VERSION } from './prompts.js';

const app = document.getElementById('app');
const live = document.getElementById('live');

const state = {
  me: null,
  dirty: false,        // unsaved composer changes
  renderSeq: 0         // guards against a slow response painting over a newer view
};

const AI_LINKS = [
  { label: 'Gemini', url: 'https://gemini.google.com/app' },
  { label: 'Claude', url: 'https://claude.ai/new' },
  { label: 'ChatGPT', url: 'https://chatgpt.com/' }
];

const ROLE_LABELS = {
  super_admin: 'Super admin',
  manager: 'Manager',
  account_manager: 'Account manager',
  supervisor: 'Supervisor'
};
const ROLE_HELP = {
  super_admin: 'Everything, including who has access.',
  manager: 'Every client: write, publish, add clients and assign staff.',
  account_manager: 'Assigned clients only: write and publish.',
  supervisor: 'Assigned clients only: read-only.'
};
const TYPE_LABELS = { update: 'Update', task: 'Task', guide: 'Guide', report: 'Report', meeting: 'Meeting recap' };
// Which prompt suits each update type by default.
const TYPE_FORMAT = { update: 'update', report: 'update', meeting: 'update', task: 'task', guide: 'guide' };
const CONTACT_ROLES = { owner: 'Owner', member: 'Member', viewer: 'Viewer' };
// One-line descriptions for the composer's format picker (the library shows the full blurb).
const FORMAT_SHORT = { update: 'Progress, results and next steps', task: 'One thing the client needs to do', guide: 'A step-by-step how-to' };

const can = (power) => Boolean(state.me && state.me.can && state.me.can[power]);

/* ---------- DOM helpers ---------- */

function h(tag, attrs, kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of [].concat(kids == null ? [] : kids)) {
    if (kid == null || kid === false) continue;
    el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  // Set after children so a <select>'s options exist first.
  if (value !== undefined) el.value = value;
  return el;
}

/** replaceChildren that skips null/false, which replaceChildren would print
 *  as the text "null" (optional sections are written as cond ? el : null). */
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
}

function announce(msg) {
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 30);
}

function toast(msg, kind = 'ok', ms = 4500) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const opts = { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) };
  return d.toLocaleString('en-US', opts);
}

function badge(text, cls) { return h('span', { class: `badge ${cls || ''}` }, text); }

function field(labelText, input, hint, opt) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return h('div', { class: 'field' }, [
    h('label', { for: id }, [labelText, opt ? h('span', { class: 'opt' }, ` ${opt}`) : null]),
    input,
    hint ? h('div', { class: 'hint' }, hint) : null
  ]);
}

/* ---------- clipboard ---------- */

// Synchronous copy, so it still counts as part of the click (some browsers
// refuse clipboard writes once a promise has resolved or focus has moved).
function copySync(text) {
  const ta = h('textarea', { readonly: true, 'aria-hidden': 'true', style: 'position:fixed;top:0;left:-9999px;opacity:0' });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  return copySync(text);
}

/* ---------- API ---------- */

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw Object.assign(new Error('Can’t reach the server. Check your connection and try again.'), { status: 0 });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    throw Object.assign(new Error((data && data.error) || `Request failed (${res.status}).`), { status: res.status, data });
  }
  return data;
}

/** Shows an API failure. A lost session sends you to sign-in — unless there
 *  is unsaved work on screen, which would be thrown away. */
function fail(err) {
  if (err && err.status === 401) {
    if (state.dirty) {
      toast('You’ve been signed out. Copy anything you need, then reload to sign in again.', 'err', 12000);
    } else {
      state.me = null;
      renderLogin('Your session ended. Sign in again to continue.');
    }
    return;
  }
  toast((err && err.message) || 'Something went wrong.', 'err', 7000);
}

/* ---------- router ---------- */

function parseHash() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  return { route: parts[0] || 'clients', a: parts[1] || null, b: parts[2] || null };
}

let current = parseHash();
let lastHash = location.hash;
let ignoreNextHash = false;

window.addEventListener('hashchange', () => {
  if (ignoreNextHash) { ignoreNextHash = false; return; }
  if (state.dirty && !confirm('You have unsaved changes. Leave without saving?')) {
    ignoreNextHash = true;
    location.hash = lastHash;
    return;
  }
  state.dirty = false;
  lastHash = location.hash;
  current = parseHash();
  if (state.me) renderApp();
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

/** Change the URL without re-rendering (after a new draft gets its id). */
function replaceRoute(hash) {
  history.replaceState(null, '', hash);
  lastHash = hash;
  current = parseHash();
}

/* ---------- boot + sign-in ---------- */

const LOGIN_ERRORS = {
  badlink: 'That sign-in link isn’t valid. Ask for a new one.',
  used: 'That link has already been used. Ask for a new one.',
  expired: 'That link expired. Ask for a new one.',
  notallowed: 'That email doesn’t have Frontrow Manager access. Ask a super admin to add you.',
  server: 'Something went wrong signing you in. Try again.'
};

const LINK_CODES = {
  badlink: LOGIN_ERRORS.badlink,
  used: LOGIN_ERRORS.used,
  expired: LOGIN_ERRORS.expired,
  notallowed: LOGIN_ERRORS.notallowed,
  slow: 'Too many sign-in attempts. Wait a few minutes and try again.'
};

/** Arrived from an email link (/#signin=<token>). The token is wiped from the
 *  address bar at once and only spent when the person taps Continue, so a
 *  mail scanner that opens the link can't use it up. */
function renderFinishSignin(token) {
  document.title = 'Sign in · Frontrow Manager';
  const btn = h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%;padding:12px' }, 'Continue to Frontrow Manager');
  const msg = h('div', { class: 'login-msg', role: 'status', 'aria-live': 'polite' });
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true; btn.textContent = 'Signing you in…';
      try {
        await api('/api/auth-callback', { method: 'POST', body: { t: token } });
        boot();
      } catch (err) {
        const code = err.data && err.data.code;
        renderLogin(LINK_CODES[code] || err.message);
      }
    }
  }, [btn]);
  fill(app, h('main', { class: 'login-shell' }, h('div', { class: 'login-card' }, [
    h('div', { class: 'brand' }, h('img', { src: 'assets/brand/frontrow-on-light.png', alt: 'Frontrow', width: 186, height: 41 })),
    h('h1', {}, 'Finish signing in'),
    h('p', {}, 'Tap below to open the Frontrow Manager on this device.'),
    form,
    msg
  ])));
  setTimeout(() => btn.focus(), 0);
}

async function boot() {
  const link = location.hash.match(/^#signin=([A-Za-z0-9_-]{20,64})$/);
  if (link) {
    history.replaceState(null, '', location.pathname);
    lastHash = ''; current = parseHash();
    renderFinishSignin(link[1]);
    return;
  }
  const qs = new URLSearchParams(location.search);
  let loginMsg = null;
  if (qs.get('e')) {
    loginMsg = LOGIN_ERRORS[qs.get('e')] || 'Something went wrong. Try again.';
    history.replaceState(null, '', location.pathname + location.hash);
  }
  try {
    const me = await api('/api/auth-me');
    if (me && me.authenticated) {
      state.me = me;
      await loadOrgs().catch(() => null);
      // Came from the CRM's "Add to Frontrow" while signed out: go there now.
      const next = (() => { try { return localStorage.getItem('frm_next'); } catch { return null; } })();
      if (next) { try { localStorage.removeItem('frm_next'); } catch { /* ignore */ } if (/^#\/add\/[a-z0-9]+$/i.test(next) && location.hash !== next) { location.hash = next; return; } }
      renderApp();
      return;
    }
    if (/^#\/add\/[a-z0-9]+$/i.test(location.hash)) { try { localStorage.setItem('frm_next', location.hash); } catch { /* ignore */ } }
    renderLogin(me && me.revoked ? 'Your Frontrow Manager access has been removed. Ask a super admin if that’s a mistake.' : loginMsg);
  } catch (e) {
    renderLogin(e.message || 'Can’t reach the server right now.');
  }
}

function renderLogin(message) {
  document.title = 'Sign in · Frontrow Manager';
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'you@company.com', inputmode: 'email' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit', style: 'width:100%;padding:12px' }, 'Email me a sign-in link');
  const msg = h('div', { class: `login-msg${message ? ' err' : ''}`, role: 'status', 'aria-live': 'polite' }, message || '');
  let busy = false;
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      const value = email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        msg.className = 'login-msg err'; msg.textContent = 'Please check that email address.'; email.focus(); return;
      }
      busy = true; submit.disabled = true; submit.textContent = 'Sending…';
      try {
        const d = await api('/api/auth-request', { method: 'POST', body: { email: value } });
        msg.className = 'login-msg';
        msg.textContent = (d && d.message) || 'If that email has access, a sign-in link is on the way.';
        submit.textContent = 'Link sent — check your inbox';
      } catch (err) {
        busy = false; submit.disabled = false; submit.textContent = 'Email me a sign-in link';
        msg.className = 'login-msg err'; msg.textContent = err.message;
      }
    }
  }, [field('Work email', email), submit]);
  fill(app, h('main', { class: 'login-shell' }, h('div', { class: 'login-card' }, [
    h('div', { class: 'brand' }, h('img', { src: 'assets/brand/frontrow-on-light.png', alt: 'Frontrow', width: 186, height: 41 })),
    h('h1', {}, 'Frontrow Manager'),
    h('p', {}, 'Manage client portals: people, organizations and updates. We’ll email you a sign-in link — no password needed.'),
    form,
    msg
  ])));
  setTimeout(() => email.focus(), 0);
}

async function signOut() {
  if (state.dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
  state.dirty = false;
  try { await api('/api/auth-me?action=logout', { method: 'POST' }); } catch { /* cookie is cleared server-side either way */ }
  state.me = null;
  renderLogin('You’re signed out.');
}

/* ---------- shell ---------- */

function navItems() {
  return [
    { id: 'clients', label: 'Clients', icon: '▤' },
    { id: 'accounts', label: 'Client accounts', icon: '◉' },
    can('manageClients') ? { id: 'requests', label: 'Requests', icon: '✉' } : null,
    { id: 'orgs', label: 'Organizations', icon: '◆' },
    { id: 'prompts', label: 'Prompt library', icon: '✎' },
    (can('manageClients') || can('manageTeam')) ? { id: 'team', label: 'Team', icon: '☰' } : null
  ].filter(Boolean);
}

function activeNav() {
  return ['compose', 'edit', 'add'].includes(current.route) ? (current.route === 'add' ? 'accounts' : 'clients') : current.route;
}

function renderApp() {
  const items = navItems();
  if (current.route !== 'add' && !items.some((i) => i.id === activeNav())) { current = { route: 'clients', a: null, b: null }; }
  const active = activeNav();
  const me = state.me;

  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Main' }, [
    h('a', { class: 'brand', href: '#/clients' }, h('img', { src: 'assets/brand/frontrow-manager-on-dark.png', alt: 'Frontrow Manager', width: 190, height: 28 })),
    h('nav', {}, items.map((i) => h('a', { href: `#/${i.id}`, 'aria-current': i.id === active ? 'page' : null }, [
      h('span', { class: 'icon', 'aria-hidden': 'true' }, i.icon), i.label
    ]))),
    h('div', { class: 'foot' }, [
      h('div', { class: 'who' }, me.fullName || me.email),
      h('div', {}, ROLE_LABELS[me.role] || me.role),
      h('button', { type: 'button', onclick: signOut }, 'Sign out')
    ])
  ]);

  const mobileSelect = h('select', {
    'aria-label': 'Go to',
    onchange: (e) => {
      if (e.target.value === '__signout') { e.target.value = active; signOut(); return; }
      location.hash = `#/${e.target.value}`;
    }
  }, [
    ...items.map((i) => h('option', { value: i.id }, i.label)),
    h('option', { value: '__signout' }, 'Sign out')
  ]);
  mobileSelect.value = active;
  const mobilenav = h('div', { class: 'mobilenav' }, [
    h('a', { href: '#/clients', 'aria-label': 'Frontrow Manager home' }, h('img', { src: 'assets/brand/frontrow-on-dark.png', alt: 'Frontrow', width: 100, height: 22 })),
    mobileSelect
  ]);

  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' }, h('div', { class: 'loading' }, 'Loading…'));
  fill(app, h('div', { class: 'app-shell' }, [sidebar, h('div', {}, [mobilenav, main])]));

  const seq = ++state.renderSeq;
  const views = {
    clients: () => (current.a ? viewClient(main, seq, current.a, current.b || 'updates') : viewClients(main, seq)),
    compose: () => viewComposer(main, seq, { companyId: current.a }),
    edit: () => viewComposer(main, seq, { updateId: current.a }),
    prompts: () => viewPrompts(main, seq, current.a),
    team: () => viewTeam(main, seq),
    accounts: () => viewAccounts(main, seq),
    requests: () => viewRequests(main, seq),
    orgs: () => viewOrgs(main, seq),
    add: () => viewAdd(main, seq, current.a)
  };
  (views[current.route] || views.clients)();
  window.scrollTo(0, 0);
}

const stale = (seq) => seq !== state.renderSeq;

function showError(main, err) {
  if (err && err.status === 401) { fail(err); return; }
  fill(main, 
    h('div', { class: 'err-box', role: 'alert' }, (err && err.message) || 'Something went wrong.'),
    h('p', {}, h('a', { href: '#/clients' }, '← Back to clients'))
  );
}

function pageHead(title, sub, actions, crumbs) {
  return h('div', {}, [
    crumbs ? h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, crumbs) : null,
    h('div', { class: 'page-head' }, [
      h('div', {}, [h('h1', {}, title), sub ? h('div', { class: 'sub' }, sub) : null]),
      actions && actions.length ? h('div', { class: 'actions' }, actions) : null
    ])
  ]);
}

/* ---------- modal ---------- */

function modal({ title, sub, body, submitLabel = 'Save', submitClass = 'btn-primary', onSubmit }) {
  const prevFocus = document.activeElement;
  const errBox = h('div', { class: 'form-err', role: 'alert' });
  const submitBtn = h('button', { class: `btn ${submitClass}`, type: 'submit' }, submitLabel);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const form = h('form', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return;
      errBox.textContent = '';
      submitBtn.disabled = true;
      const label = submitBtn.textContent;
      submitBtn.textContent = 'Working…';
      try {
        await onSubmit();
        close();
      } catch (err) {
        if (err && err.status === 401) { close(); fail(err); return; }
        errBox.textContent = (err && err.message) || 'Something went wrong.';
        submitBtn.disabled = false; submitBtn.textContent = label;
      }
    }
  }, [
    h('h2', { id: 'modal-title' }, title),
    sub ? h('p', { class: 'sub' }, sub) : null,
    h('div', { class: 'form-body' }, body),
    errBox,
    h('div', { class: 'modal-actions' }, [
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: close }, 'Cancel'),
      submitBtn
    ])
  ]);
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } }, form);
  document.body.appendChild(back);
  document.addEventListener('keydown', onKey);
  const first = form.querySelector('input, select, textarea, button[type=submit]');
  setTimeout(() => first && first.focus(), 0);
  return close;
}

/* ---------- organizations (loaded once after sign-in) ---------- */

const ORGS = { list: [], byId: new Map() };
async function loadOrgs() {
  const d = await api('/api/orgs');
  ORGS.list = d.organizations || [];
  ORGS.byId = new Map(ORGS.list.map((o) => [o.id, o]));
}
const orgOf = (id) => ORGS.byId.get(id) || null;
const branchOf = (orgId, branchId) => { const o = orgOf(orgId); return (o && o.branches.find((b) => b.id === branchId)) || null; };
const HEX = /^#[0-9a-f]{6}$/i;

function orgBadge(org) {
  if (!org) return badge('No organization', 'off');
  const accent = HEX.test((org.branding || {}).accent || '') ? org.branding.accent : '#334155';
  return h('span', { class: 'badge org', style: `color:${accent};border-color:${accent}33;background:${accent}12` }, org.clickupLabel || org.name);
}

/** A button that copies `text` and says so. */
function copyButton(text, label = 'Copy link', cls = 'btn btn-secondary btn-sm') {
  const b = h('button', {
    class: cls, type: 'button',
    onclick: async () => {
      const value = typeof text === 'function' ? await text() : text;
      if (!value) return;
      if (await copyText(value)) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = label; }, 2200); }
      else showLinkModal('Copy this link', value);
    }
  }, label);
  return b;
}

function showLinkModal(title, url, sub) {
  const input = h('input', { type: 'text', readonly: true, value: url, onfocus: (e) => e.target.select() });
  input.value = url;
  modal({ title, sub: sub || 'Your browser blocked copying. Select the link and copy it.', body: [input], submitLabel: 'Done', onSubmit: async () => {} });
}

function syncLine(info) {
  if (!info) return null;
  if (!info.connected) return h('div', { class: 'note warn', style: 'margin:-8px 0 16px' }, 'ClickUp isn’t connected yet, so clients and contacts won’t sync. Add CLICKUP_API_TOKEN in Vercel and redeploy.');
  const last = (info.runs || [])[0];
  if (!last) return h('div', { class: 'note', style: 'margin:-8px 0 16px' }, 'Not synced with ClickUp yet. Run a sync to bring in your accounts and contacts.');
  const c = last.counts || {};
  const text = last.status === 'ok'
    ? `Synced with ClickUp ${fmtDate(last.finished_at)} · ${c.activeCompanies || 0} active of ${c.companies || 0} accounts · ${c.contacts || 0} contacts${c.contactsWithoutEmail ? ` (${c.contactsWithoutEmail} without an email)` : ''}${c.accountsWithoutOrganization ? ` · ${c.accountsWithoutOrganization} accounts with no Branch` : ''}`
    : last.status === 'running' ? 'A ClickUp sync is running…' : `Last ClickUp sync failed ${fmtDate(last.started_at)}: ${last.error || 'unknown error'}`;
  return h('div', { class: `note${last.status === 'failed' ? ' warn' : ''}`, style: 'margin:-8px 0 16px' }, text);
}

async function runSyncNow(btn) {
  btn.disabled = true; btn.textContent = 'Syncing…';
  try {
    const r = await api('/api/sync', { method: 'POST', body: {} });
    toast(`Synced: ${r.counts.companies} accounts, ${r.counts.contacts} contacts.`);
    await loadOrgs();
    renderApp();
  } catch (err) { btn.disabled = false; btn.textContent = 'Sync from ClickUp'; fail(err); }
}

/* ---------- Clients ---------- */

async function viewClients(main, seq) {
  document.title = 'Clients · Frontrow Manager';
  let data; let sync = null;
  try {
    [data, sync] = await Promise.all([api('/api/companies'), can('manageClients') ? api('/api/sync').catch(() => null) : Promise.resolve(null)]);
  } catch (e) { if (!stale(seq)) showError(main, e); return; }
  if (stale(seq)) return;
  const companies = data.companies || [];

  const actions = [];
  if (can('manageClients') && sync && sync.connected) {
    const b = h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => runSyncNow(b) }, 'Sync from ClickUp');
    actions.push(b);
  }
  if (can('manageClients')) actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openClientModal() }, '+ Add client'));
  const head = pageHead('Clients', can('seeAll') ? 'Every client, by organization and branch.' : 'The clients assigned to you.', actions);

  if (companies.length === 0) {
    fill(main, head, syncLine(sync), h('div', { class: 'empty' }, can('manageClients')
      ? ['No clients yet. Sync from ClickUp, or add one by hand.']
      : 'No clients are assigned to you yet. Ask a manager to assign you.'));
    return;
  }

  let orgFilter = 'all';
  let branchFilter = 'all';
  let showInactive = false;
  const search = h('input', { type: 'search', placeholder: 'Search clients', 'aria-label': 'Search clients' });
  const branchSel = h('select', { 'aria-label': 'Branch', style: 'max-width:220px', hidden: true, onchange: (e) => { branchFilter = e.target.value; apply(); } });
  const inactiveToggle = h('input', { type: 'checkbox', id: 'show-inactive', onchange: (e) => { showInactive = e.target.checked; apply(); } });
  const inactiveCount = companies.filter((c) => !c.active).length;
  const countLine = h('div', { class: 'muted', role: 'status', style: 'font-size:13px;color:var(--steel)' });

  const groups = [];
  const orgIds = [...new Set(companies.map((c) => c.organizationId))]
    .sort((a, b) => ((orgOf(a) || {}).name || '').localeCompare((orgOf(b) || {}).name || ''));
  for (const orgId of orgIds) {
    const org = orgOf(orgId);
    const list = companies.filter((c) => c.organizationId === orgId).sort((a, b) =>
      (((branchOf(orgId, a.branchId) || {}).sort ?? 999) - ((branchOf(orgId, b.branchId) || {}).sort ?? 999)) || a.name.localeCompare(b.name));
    const rows = list.map((c) => {
      const br = branchOf(orgId, c.branchId);
      const tr = h('tr', { class: 'clickable', onclick: (e) => { if (e.target.closest('a,button')) return; location.hash = `#/clients/${c.id}`; } }, [
        h('td', { class: 'primary-cell' }, [h('a', { href: `#/clients/${c.id}` }, c.name), c.active ? null : [' ', badge(c.clickupStatus || 'Inactive', 'off')]].flat()),
        h('td', { 'data-label': 'Branch' }, br ? br.name : h('span', { class: 'muted' }, '—')),
        h('td', { 'data-label': 'People' }, c.contacts ? `${c.accounts} of ${c.contacts} signed up` : h('span', { class: 'muted' }, 'None yet')),
        h('td', { 'data-label': 'Drafts' }, c.drafts ? badge(`${c.drafts} draft${c.drafts === 1 ? '' : 's'}`, 'draft') : h('span', { class: 'muted' }, '—')),
        h('td', { 'data-label': 'Last published' }, fmtDate(c.lastPublishedAt, false)),
        h('td', { 'data-label': 'Owner' }, c.owner ? c.owner.name : h('span', { class: 'muted' }, 'Unassigned'))
      ]);
      tr._match = `${c.name} ${c.clickupAccountId || ''} ${br ? br.name : ''}`.toLowerCase();
      tr._branch = c.branchId || '';
      tr._active = c.active;
      return tr;
    });
    const section = h('section', { class: 'card group', style: 'padding:6px 8px' }, [
      h('div', { class: 'group-head' }, [
        orgBadge(org), h('h2', {}, org ? org.name : 'Unknown organization'),
        h('span', { class: 'muted group-count' }),
        org ? h('span', { class: 'group-link' }, [h('span', { class: 'muted' }, org.portalUrl.replace(/^https:\/\//, '')), copyButton(org.portalUrl, 'Copy portal link')]) : null
      ]),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data stackable' }, [
        h('thead', {}, h('tr', {}, ['Client', 'Branch', 'People', 'Drafts', 'Last published', 'Owner'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows)
      ]))
    ]);
    groups.push({ orgId, rows, section });
  }

  function apply() {
    const q = search.value.trim().toLowerCase();
    let shown = 0; let total = 0;
    for (const g of groups) {
      let n = 0;
      const orgOk = orgFilter === 'all' || g.orgId === orgFilter;
      for (const tr of g.rows) {
        total++;
        const ok = orgOk && (!q || tr._match.includes(q)) && (branchFilter === 'all' || tr._branch === branchFilter) && (showInactive || tr._active);
        tr.hidden = !ok;
        if (ok) { n++; shown++; }
      }
      g.section.hidden = n === 0;
      g.section.querySelector('.group-count').textContent = `${n} client${n === 1 ? '' : 's'}`;
    }
    countLine.textContent = `Showing ${shown} of ${total}`;
  }
  search.addEventListener('input', apply);

  function setOrg(id) {
    orgFilter = id; branchFilter = 'all';
    const org = orgOf(id);
    if (org && org.branches.length) {
      fill(branchSel, h('option', { value: 'all' }, 'All branches'), org.branches.map((b) => h('option', { value: b.id }, b.name)));
      branchSel.value = 'all'; branchSel.hidden = false;
    } else branchSel.hidden = true;
    apply();
  }
  const seg = orgIds.length > 1 ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Organization' },
    ['all', ...orgIds].map((id) => h('button', {
      type: 'button', 'aria-pressed': id === orgFilter ? 'true' : 'false',
      onclick: (e) => {
        e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'));
        setOrg(id);
      }
    }, id === 'all' ? 'All' : ((orgOf(id) || {}).clickupLabel || (orgOf(id) || {}).name || '?')))) : null;
  if (orgIds.length === 1) setOrg(orgIds[0]);

  fill(main,
    head,
    syncLine(sync),
    h('div', { class: 'toolbar' }, [search, seg, branchSel,
      inactiveCount ? h('label', { for: 'show-inactive', class: 'check' }, [inactiveToggle, ` Show inactive (${inactiveCount})`]) : null,
      countLine]),
    h('div', { class: 'stack' }, groups.map((g) => g.section))
  );
  apply();
}

function orgAndBranchFields(orgId, branchId, { disabled = false } = {}) {
  const org = h('select', { disabled }, [h('option', { value: '' }, 'Choose…'), ...ORGS.list.map((o) => h('option', { value: o.id }, o.name))]);
  const branch = h('select', { disabled });
  function fillBranches(selected) {
    const o = orgOf(org.value);
    fill(branch, h('option', { value: '' }, o && o.branches.length ? 'No branch' : '—'), (o ? o.branches : []).map((b) => h('option', { value: b.id }, b.name)));
    branch.value = selected || '';
    branch.disabled = disabled || !o || !o.branches.length;
  }
  org.value = orgId || '';
  org.addEventListener('change', () => fillBranches(''));
  fillBranches(branchId);
  return { org, branch };
}

function openClientModal() {
  const name = h('input', { type: 'text', maxlength: 200, autocomplete: 'off' });
  const { org, branch } = orgAndBranchFields(ORGS.list.length === 1 ? ORGS.list[0].id : '', '');
  const clickup = h('input', { type: 'text', maxlength: 64, autocomplete: 'off', spellcheck: 'false' });
  modal({
    title: 'Add client',
    sub: 'Most clients arrive from ClickUp on their own. Add one by hand only if it isn’t in ClickUp.',
    body: [field('Client name', name), field('Organization', org, 'Decides which sign-in page their people use.'), field('Branch', branch, null, '(optional)'),
      field('ClickUp account ID', clickup, 'If they do exist in ClickUp, the next sync takes over this client.', '(optional)')],
    submitLabel: 'Add client',
    onSubmit: async () => {
      if (!name.value.trim()) { name.focus(); throw new Error('Enter the client’s name.'); }
      if (!org.value) { org.focus(); throw new Error('Choose an organization.'); }
      const d = await api('/api/companies', { method: 'POST', body: { name: name.value, organizationId: org.value, branchId: branch.value || null, clickupAccountId: clickup.value } });
      toast('Client added. Next: add the people who should see their portal.');
      location.hash = `#/clients/${d.id}/people`;
    }
  });
}

/* ---------- One client ---------- */

async function viewClient(main, seq, companyId, tab) {
  let detail;
  try { detail = await api(`/api/companies?id=${encodeURIComponent(companyId)}`); } catch (e) { if (!stale(seq)) showError(main, e); return; }
  if (stale(seq)) return;
  const c = detail.company;
  const org = orgOf(c.organizationId);
  const br = branchOf(c.organizationId, c.branchId);
  document.title = `${c.name} · Frontrow Manager`;

  const tabs = [
    { id: 'updates', label: 'Updates' },
    { id: 'people', label: 'People' },
    { id: 'staff', label: 'Staff' },
    can('manageClients') ? { id: 'settings', label: 'Settings' } : null
  ].filter(Boolean);
  if (tab === 'contacts') tab = 'people';
  if (!tabs.some((t) => t.id === tab)) tab = 'updates';

  const actions = can('edit') ? [h('a', { class: 'btn btn-primary', href: `#/compose/${c.id}` }, '+ New update')] : [];
  const head = pageHead(c.name, null, actions, [h('a', { href: '#/clients' }, 'Clients'), h('span', { 'aria-hidden': 'true' }, '›'), h('span', {}, c.name)]);
  head.querySelector('h1').append(' ', orgBadge(org), c.active === false ? badge(c.clickupStatus || 'Inactive', 'off') : '');
  const meta = h('div', { class: 'client-meta' }, [
    br ? h('span', {}, `Branch: ${br.name}`) : null,
    c.source === 'clickup' ? h('span', {}, ['From ClickUp', c.syncedAt ? ` · synced ${fmtDate(c.syncedAt)}` : '', ' · ', h('a', { href: `https://app.clickup.com/t/${encodeURIComponent(c.clickupAccountId)}`, target: '_blank', rel: 'noopener noreferrer' }, 'Open in ClickUp ↗')]) : h('span', {}, 'Added by hand'),
    c.portalUrl ? h('span', { class: 'group-link' }, ['Portal: ', h('span', { class: 'muted' }, c.portalUrl.replace(/^https:\/\//, '')), copyButton(c.portalUrl, 'Copy portal link')]) : null
  ]);
  const inactiveNote = c.active === false ? h('div', { class: 'note warn', style: 'margin-bottom:14px' },
    `This client isn’t active${c.source === 'clickup' ? ` in ClickUp (Account Status: ${c.clickupStatus || 'not set'})` : ''}, so its people can’t sign in. ${c.source === 'clickup' ? 'Set the Account Status to Active in ClickUp, then sync.' : 'Switch it on in Settings.'}`) : null;

  const body = h('div', {}, h('div', { class: 'loading' }, 'Loading…'));
  fill(main, head, meta, inactiveNote,
    h('nav', { class: 'tabs', 'aria-label': 'Client sections' }, tabs.map((t) => h('a', { href: `#/clients/${c.id}/${t.id}`, 'aria-current': t.id === tab ? 'page' : null }, t.label))),
    body);

  if (tab === 'updates') return tabUpdates(body, seq, c);
  if (tab === 'people') return tabPeople(body, seq, c);
  if (tab === 'staff') return tabStaff(body, c, detail.staff);
  if (tab === 'settings') return tabSettings(body, c);
}

async function tabUpdates(body, seq, c) {
  let data;
  try { data = await api(`/api/updates?companyId=${c.id}`); } catch (e) { if (!stale(seq)) showError(body, e); return; }
  if (stale(seq)) return;
  const updates = data.updates || [];
  if (updates.length === 0) {
    fill(body, h('div', { class: 'empty' }, [
      `No updates for ${c.name} yet.`,
      can('edit') ? [h('br'), h('a', { class: 'btn btn-primary', href: `#/compose/${c.id}` }, 'Write the first update')] : null
    ].flat()));
    return;
  }
  let filter = 'all';
  const counts = { draft: 0, published: 0, archived: 0 };
  updates.forEach((u) => { counts[u.status] = (counts[u.status] || 0) + 1; });
  const rows = updates.map((u) => {
    const tr = h('tr', { class: 'clickable', onclick: (e) => { if (e.target.closest('a')) return; location.hash = `#/edit/${u.id}`; } }, [
      h('td', { class: 'primary-cell' }, [
        h('a', { href: `#/edit/${u.id}` }, u.title || 'Untitled'),
        u.summary ? h('div', { class: 'muted' }, u.summary.length > 140 ? `${u.summary.slice(0, 140)}…` : u.summary) : null
      ]),
      h('td', { 'data-label': 'Type' }, TYPE_LABELS[u.type] || u.type),
      h('td', { 'data-label': 'Status' }, badge(u.status, u.status)),
      h('td', { 'data-label': 'Last edited' }, fmtDate(u.updatedAt)),
      h('td', { 'data-label': 'Published' }, u.publishedAt ? fmtDate(u.publishedAt) : h('span', { class: 'muted' }, '—'))
    ]);
    tr._status = u.status;
    return tr;
  });
  const apply = () => rows.forEach((tr) => { tr.hidden = filter !== 'all' && tr._status !== filter; });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' }, [
    ['all', `All (${updates.length})`], ['draft', `Drafts (${counts.draft})`], ['published', `Published (${counts.published})`], ['archived', `Archived (${counts.archived})`]
  ].map(([id, label]) => h('button', {
    type: 'button', 'aria-pressed': id === filter ? 'true' : 'false',
    onclick: (e) => {
      filter = id;
      e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'));
      apply();
    }
  }, label)));
  fill(body, 
    h('div', { class: 'toolbar' }, seg),
    h('div', { class: 'card', style: 'padding:6px 8px' }, h('div', { class: 'table-wrap' }, h('table', { class: 'data stackable' }, [
      h('thead', {}, h('tr', {}, ['Update', 'Type', 'Status', 'Last edited', 'Published'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, rows)
    ])))
  );
}

async function tabStaff(body, c, staff) {
  const manage = can('manageClients');
  const list = staff.length === 0
    ? h('div', { class: 'empty' }, 'No staff assigned. Managers and super admins can still see this client.')
    : h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, [
      h('tbody', {}, staff.map((s) => h('tr', {}, [
        h('td', { class: 'primary-cell' }, [s.name, s.isPrimary ? [' ', badge('Primary', 'published')] : null].flat()),
        manage ? h('td', { class: 'row-actions' }, [
          s.isPrimary ? null : h('button', {
            class: 'btn btn-link', type: 'button',
            onclick: async () => {
              try { await api('/api/assignments', { method: 'POST', body: { companyId: c.id, personId: s.personId, isPrimary: true } }); toast(`${s.name} is now the primary contact.`); renderApp(); }
              catch (err) { fail(err); }
            }
          }, 'Make primary'),
          h('button', {
            class: 'btn btn-danger btn-sm', type: 'button',
            onclick: async () => {
              if (!confirm(`Unassign ${s.name} from ${c.name}?`)) return;
              try { await api(`/api/assignments?companyId=${c.id}&personId=${s.personId}`, { method: 'DELETE' }); toast('Unassigned.'); renderApp(); }
              catch (err) { fail(err); }
            }
          }, 'Unassign')
        ]) : null
      ])))
    ]));

  const parts = [h('div', { class: 'card' }, [
    h('h2', {}, 'Staff on this account'),
    h('p', { class: 'sub' }, 'Account managers and supervisors only see clients they are assigned to here.'),
    list
  ])];
  if (manage) {
    let team = [];
    try { team = ((await api('/api/team')).team || []).filter((p) => p.active !== false); } catch (err) { fail(err); }
    const assigned = new Set(staff.map((s) => s.personId));
    const options = team.filter((p) => !assigned.has(p.personId));
    if (options.length) {
      const who = h('select', {}, [h('option', { value: '' }, 'Choose a team member…'), ...options.map((p) => h('option', { value: p.personId }, `${p.fullName || p.email} — ${ROLE_LABELS[p.role] || p.role}`))]);
      const primary = h('input', { type: 'checkbox', id: 'asg-primary' });
      const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Assign');
      parts.push(h('form', {
        class: 'card', novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          if (!who.value) { toast('Choose a team member.', 'err'); who.focus(); return; }
          btn.disabled = true;
          try { await api('/api/assignments', { method: 'POST', body: { companyId: c.id, personId: who.value, isPrimary: primary.checked } }); toast('Assigned.'); renderApp(); }
          catch (err) { btn.disabled = false; fail(err); }
        }
      }, [
        h('h2', {}, 'Assign staff'),
        h('div', { class: 'stack' }, [
          field('Team member', who),
          h('label', { for: 'asg-primary', style: 'display:flex;gap:8px;align-items:center;font-weight:600' }, [primary, 'Primary contact for this client']),
          h('div', {}, btn)
        ])
      ]));
    }
  }
  fill(body, ...parts);
}

/* ---------- People and account links ---------- */

function accountBadge(p) {
  const a = p.account;
  if (!p.eligible && !(a && a.hasPassword)) return badge('Not eligible', 'off');
  if (!a || !a.hasPassword) return badge('Not set up', 'draft');
  if (a.status === 'disabled') return badge('Switched off', 'off');
  return badge('Active', 'published');
}

function accountLine(p) {
  const a = p.account;
  if (a && a.hasPassword) return a.lastSignInAt ? `Last signed in ${fmtDate(a.lastSignInAt)}` : `Set up ${fmtDate(a.activatedAt)}`;
  return p.eligible ? 'Hasn’t set a password yet' : 'Needs an active account in ClickUp';
}

/** "Email link" / "Copy link" for one person. */
function linkButtons(p, companyId) {
  if (!can('edit') || !p.eligible || (p.account && p.account.status === 'disabled')) return [];
  const reset = p.account && p.account.hasPassword;
  const send = h('button', {
    class: 'btn btn-secondary btn-sm', type: 'button',
    onclick: async () => {
      if (!confirm(`Email ${reset ? 'a password reset link' : 'a setup link'} to ${p.email}?`)) return;
      send.disabled = true;
      try {
        await api('/api/accounts?action=invite', { method: 'POST', body: { contactId: p.contactId || p.id, companyId, send: true } });
        toast(`${reset ? 'Reset' : 'Setup'} link emailed to ${p.email}. Noted in ClickUp.`);
      } catch (err) {
        if (err.data && err.data.url) showLinkModal('The email didn’t send', err.data.url, 'Copy the link and send it yourself.');
        else fail(err);
      } finally { send.disabled = false; }
    }
  }, reset ? 'Email reset link' : 'Email setup link');
  // Reset links are only ever emailed to the person, never shown to staff.
  if (reset) return [send];
  const copy = copyButton(async () => {
    try {
      const r = await api('/api/accounts?action=invite', { method: 'POST', body: { contactId: p.contactId || p.id, companyId, send: false } });
      toast('Setup link copied. It works once and lasts 7 days.', 'ok', 6000);
      return r.url;
    } catch (err) { fail(err); return null; }
  }, 'Copy link');
  return [send, copy];
}

async function tabPeople(body, seq, c) {
  let data;
  try { data = await api(`/api/contacts?companyId=${c.id}`); } catch (e) { if (!stale(seq)) showError(body, e); return; }
  if (stale(seq)) return;
  const people = (data.contacts || []).map((p) => ({ ...p, contactId: p.id, eligible: c.active && p.active !== false }));
  const editable = can('edit');

  const list = people.length === 0
    ? h('div', { class: 'empty' }, 'No one is linked to this client yet. Link contacts to this account in ClickUp and sync, or add someone below.')
    : h('div', { class: 'table-wrap' }, h('table', { class: 'data stackable' }, [
      h('thead', {}, h('tr', {}, ['Person', 'Account', 'Role', ''].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, people.map((p) => {
        const role = h('select', {
          'aria-label': `Role for ${p.email}`, disabled: !editable,
          onchange: async (e) => {
            try { await api(`/api/contacts?contactId=${p.id}&companyId=${c.id}`, { method: 'PATCH', body: { role: e.target.value } }); toast('Role updated.'); }
            catch (err) { e.target.value = p.role; fail(err); }
          }
        }, Object.entries(CONTACT_ROLES).map(([v, l]) => h('option', { value: v }, l)));
        role.value = p.role;
        const remove = editable && p.source === 'manual' ? h('button', {
          class: 'btn btn-link', type: 'button',
          onclick: async () => {
            if (!confirm(`Remove ${p.email} from ${c.name}? They will no longer see this client’s portal.`)) return;
            try { await api(`/api/contacts?contactId=${p.id}&companyId=${c.id}`, { method: 'DELETE' }); toast('Removed.'); renderApp(); }
            catch (err) { fail(err); }
          }
        }, 'Remove') : null;
        return h('tr', {}, [
          h('td', { class: 'primary-cell' }, [
            h('div', {}, p.fullName || p.email),
            p.fullName ? h('div', { class: 'muted', style: 'overflow-wrap:anywhere' }, p.email) : null,
            h('div', { class: 'muted' }, p.source === 'clickup' ? 'Linked in ClickUp' : 'Added in Frontrow')
          ]),
          h('td', { 'data-label': 'Account' }, [accountBadge(p), h('div', { class: 'muted' }, accountLine(p))]),
          h('td', { 'data-label': 'Role' }, role),
          h('td', { class: 'row-actions' }, h('div', { class: 'btn-row' }, [...linkButtons(p, c.id), remove]))
        ]);
      }))
    ]));

  let addForm = null;
  if (editable) {
    const email = h('input', { type: 'email', autocomplete: 'off', placeholder: 'name@client.com', required: true });
    const name = h('input', { type: 'text', autocomplete: 'off', maxlength: 120 });
    const role = h('select', {}, Object.entries(CONTACT_ROLES).map(([v, l]) => h('option', { value: v }, l)));
    role.value = 'member';
    const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add person');
    addForm = h('form', {
      class: 'card', novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        if (btn.disabled) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) { toast('Enter a valid email address.', 'err'); email.focus(); return; }
        btn.disabled = true;
        try {
          const r = await api('/api/contacts', { method: 'POST', body: { companyId: c.id, email: email.value, fullName: name.value, role: role.value } });
          toast(r.createdInClickUp ? 'Added, and created as a contact in ClickUp.' : r.clickupConnected ? 'Added. Noted on their ClickUp contact.' : 'Added. (ClickUp isn’t connected, so nothing was written there.)', 'ok', 6000);
          renderApp();
        } catch (err) { btn.disabled = false; fail(err); }
      }
    }, [
      h('h2', {}, 'Add someone'),
      h('p', { class: 'sub' }, 'If they aren’t in ClickUp yet, they’re created there as a contact with a note, so ClickUp stays the one list of your clients.'),
      h('div', { class: 'stack' }, [
        h('div', { class: 'row' }, [field('Email', email), field('Name', name, null, '(optional)')]),
        h('div', { class: 'row' }, [field('Role', role), h('div', { style: 'align-self:end' }, btn)])
      ])
    ]);
  }
  const signedUp = people.filter((p) => p.account && p.account.hasPassword).length;
  fill(body,
    h('div', { class: 'card' }, [
      h('h2', {}, 'Who can see this portal'),
      h('p', { class: 'sub' }, `${people.length} ${people.length === 1 ? 'person' : 'people'} · ${signedUp} signed up. A setup link lets someone choose their password; it works once and lasts 7 days.`),
      list
    ]),
    addForm);
}

function tabSettings(body, c) {
  const fromClickUp = c.source === 'clickup';
  const name = h('input', { type: 'text', maxlength: 200, value: c.name, disabled: fromClickUp });
  name.value = c.name;
  const { org, branch } = orgAndBranchFields(c.organizationId, c.branchId, { disabled: fromClickUp });
  const accentText = h('input', { type: 'text', maxlength: 7, placeholder: 'Organization colour', spellcheck: 'false', style: 'max-width:180px' });
  accentText.value = c.accent || '';
  const active = h('input', { type: 'checkbox', id: 'set-active', disabled: fromClickUp });
  active.checked = c.active !== false;
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save settings');
  fill(body, h('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      const payload = { accent: accentText.value.trim() };
      if (!fromClickUp) Object.assign(payload, { name: name.value, organizationId: org.value, branchId: branch.value || null, active: active.checked });
      try { await api(`/api/companies?id=${c.id}`, { method: 'PATCH', body: payload }); toast('Settings saved.'); renderApp(); }
      catch (err) { btn.disabled = false; fail(err); }
    }
  }, [
    h('h2', {}, 'Client settings'),
    fromClickUp ? h('p', { class: 'note' }, 'This client comes from ClickUp, so its name, organization, branch and active state follow ClickUp on every sync. Change them there.') : null,
    h('div', { class: 'stack', style: 'margin-top:12px' }, [
      field('Client name', name),
      h('div', { class: 'row' }, [field('Organization', org), field('Branch', branch)]),
      field('Accent colour', accentText, 'Used in prompts and AI drafts for this client. Leave empty to use the organization’s colour.', '(optional)'),
      h('label', { for: 'set-active', class: 'check' }, [active, ' Active — its people can sign in and see published updates']),
      h('div', {}, btn)
    ])
  ]));
}

/* ---------- Accounts (everyone, across clients) ---------- */

async function viewAccounts(main, seq) {
  document.title = 'Accounts · Frontrow Manager';
  const search = h('input', { type: 'search', placeholder: 'Search by name or email', 'aria-label': 'Search people' });
  const results = h('div', {}, h('div', { class: 'loading' }, 'Loading…'));
  let companies = [];
  fill(main,
    pageHead('Client accounts', 'Everyone who can — or could — sign in, across the clients you can see.'),
    h('div', { class: 'toolbar' }, [search]),
    results);
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  try { companies = (await api('/api/companies')).companies || []; } catch { companies = []; }
  load();

  async function load() {
    let data;
    try { data = await api(`/api/accounts?q=${encodeURIComponent(search.value.trim())}`); } catch (e) { if (!stale(seq)) showError(results, e); return; }
    if (stale(seq)) return;
    const people = data.accounts || [];
    if (!people.length) { fill(results, h('div', { class: 'empty' }, search.value ? 'No one matches that search.' : 'No people yet. Sync from ClickUp, or add people on a client’s People tab.')); return; }
    const active = people.filter((p) => p.account && p.account.hasPassword && p.account.status === 'active').length;
    const waiting = people.filter((p) => p.eligible && !(p.account && p.account.hasPassword)).length;
    fill(results,
      h('p', { class: 'muted', style: 'margin:0 0 10px' }, `${people.length} people · ${active} signed up · ${waiting} eligible but not set up${people.length === 500 ? ' · showing the first 500 — search to narrow' : ''}`),
      h('div', { class: 'card', style: 'padding:6px 8px' }, h('div', { class: 'table-wrap' }, h('table', { class: 'data stackable' }, [
        h('thead', {}, h('tr', {}, ['Person', 'Clients', 'Account', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, people.map((p) => h('tr', {}, [
          h('td', { class: 'primary-cell' }, [h('div', {}, p.fullName || p.email), p.fullName ? h('div', { class: 'muted', style: 'overflow-wrap:anywhere' }, p.email) : null]),
          h('td', { 'data-label': 'Clients' }, h('div', { class: 'chips' }, p.companies.map((co) => h('a', { class: `chip-link${co.active ? '' : ' off'}`, href: `#/clients/${co.id}/people`, title: co.active ? 'Active' : 'Not active' }, co.name)))),
          h('td', { 'data-label': 'Account' }, [accountBadge(p), h('div', { class: 'muted' }, accountLine(p))]),
          h('td', { class: 'row-actions' }, h('div', { class: 'btn-row' }, [
            ...linkButtons(p, null),
            can('edit') ? h('button', { class: 'btn btn-link', type: 'button', onclick: () => linkToClient(p, companies) }, 'Link to client') : null,
            can('manageClients') && p.account && p.account.hasPassword ? h('button', {
              class: 'btn btn-link', type: 'button',
              onclick: async () => {
                const off = p.account.status === 'active';
                if (!confirm(off ? `Switch off ${p.email}? They’ll be signed out everywhere.` : `Switch ${p.email} back on?`)) return;
                try { await api('/api/accounts?action=status', { method: 'POST', body: { contactId: p.contactId, status: off ? 'disabled' : 'active' } }); toast(off ? 'Switched off.' : 'Switched back on.'); load(); }
                catch (err) { fail(err); }
              }
            }, p.account.status === 'active' ? 'Switch off' : 'Switch on') : null
          ]))
        ])))
      ]))));
  }
}

function linkToClient(p, companies) {
  const options = companies.filter((co) => !p.companies.some((x) => x.id === co.id)).sort((a, b) => a.name.localeCompare(b.name));
  const sel = h('select', {}, [h('option', { value: '' }, 'Choose a client…'), ...options.map((co) => h('option', { value: co.id }, `${co.name}${co.active ? '' : ' (not active)'} — ${(orgOf(co.organizationId) || {}).clickupLabel || ''}`))]);
  modal({
    title: `Link ${p.fullName || p.email} to a client`,
    sub: 'They’ll see that client’s published updates. The link is also added to ClickUp so the next sync agrees.',
    body: [field('Client', sel)],
    submitLabel: 'Link',
    onSubmit: async () => {
      if (!sel.value) throw new Error('Choose a client.');
      const r = await api('/api/accounts?action=link', { method: 'POST', body: { contactId: p.contactId, companyId: sel.value } });
      toast(r.clickupRelated ? 'Linked, here and in ClickUp.' : 'Linked. Add the relationship in ClickUp too, so the CRM shows it.', 'ok', 6000);
      renderApp();
    }
  });
}

/* ---------- Access requests ---------- */

async function viewRequests(main, seq) {
  document.title = 'Requests · Frontrow Manager';
  let data; let companies = [];
  try { [data, companies] = await Promise.all([api('/api/requests'), api('/api/companies').then((d) => d.companies || [])]); }
  catch (e) { if (!stale(seq)) showError(main, e); return; }
  if (stale(seq)) return;
  const waiting = (data.requests || []).filter((r) => r.status === 'confirmed');
  const handled = (data.requests || []).filter((r) => r.status !== 'confirmed').slice(0, 30);
  const card = (r) => h('article', { class: 'card request' }, [
    h('div', { class: 'request-head' }, [h('h2', {}, r.fullName || r.email), r.organization ? badge(r.organization, 'blue') : null, h('span', { class: 'muted' }, fmtDate(r.confirmedAt || r.createdAt))]),
    h('p', { class: 'muted', style: 'margin:0 0 6px;overflow-wrap:anywhere' }, [r.email, r.companyName ? ` · ${r.companyName}` : '']),
    r.message ? h('blockquote', {}, r.message) : null,
    h('div', { class: 'btn-row' }, [
      r.status === 'confirmed' ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => approve(r) }, 'Approve…') : badge(r.status, r.status === 'approved' ? 'published' : 'archived'),
      r.status === 'confirmed' ? h('button', {
        class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: async () => {
          if (!confirm(`Dismiss the request from ${r.email}?`)) return;
          try { await api(`/api/requests?action=dismiss&id=${r.id}`, { method: 'POST', body: {} }); toast('Dismissed.'); renderApp(); } catch (err) { fail(err); }
        }
      }, 'Dismiss') : null,
      r.clickupUrl ? h('a', { class: 'btn btn-link', href: r.clickupUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Open in ClickUp ↗') : null
    ])
  ]);
  function approve(r) {
    const pool = companies.filter((co) => co.active && (!r.organizationId || co.organizationId === r.organizationId));
    const sel = h('select', {}, [h('option', { value: '' }, 'Choose their client…'), ...pool.sort((a, b) => a.name.localeCompare(b.name)).map((co) => h('option', { value: co.id }, co.name))]);
    modal({
      title: `Approve ${r.fullName || r.email}`,
      sub: 'They’re linked to the client you choose (here and in ClickUp) and emailed a setup link.',
      body: [field('Client', sel, pool.length ? null : 'No active clients in this organization. Activate the account in ClickUp first.')],
      submitLabel: 'Approve and email link',
      onSubmit: async () => {
        if (!sel.value) throw new Error('Choose a client.');
        await api(`/api/requests?action=approve&id=${r.id}`, { method: 'POST', body: { companyId: sel.value } });
        toast(`Approved. Setup link emailed to ${r.email}.`);
        renderApp();
      }
    });
  }
  fill(main,
    pageHead('Access requests', 'People who asked for a portal from a sign-in page and confirmed their email. Each one is also noted in ClickUp.'),
    waiting.length ? h('div', { class: 'stack' }, waiting.map(card)) : h('div', { class: 'empty' }, 'No requests waiting.'),
    handled.length ? h('details', { class: 'card', style: 'margin-top:16px' }, [h('summary', { style: 'cursor:pointer;font-weight:700' }, `Handled (${handled.length})`), h('div', { class: 'stack', style: 'margin-top:12px' }, handled.map(card))]) : null);
}

/* ---------- Organizations ---------- */

async function viewOrgs(main, seq) {
  document.title = 'Organizations · Frontrow Manager';
  try { await loadOrgs(); } catch (e) { if (!stale(seq)) showError(main, e); return; }
  if (stale(seq)) return;
  const actions = can('manageTeam') ? [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => editOrg(null) }, '+ Add organization')] : [];
  fill(main,
    pageHead('Organizations', 'Each organization has its own branded sign-in page. Share its link with clients.', actions),
    h('div', { class: 'stack' }, ORGS.list.map((o) => {
      const b = o.branding || {};
      return h('section', { class: 'card org-card' }, [
        h('div', { class: 'org-top' }, [
          b.logo ? h('img', { class: 'org-logo', src: frontrowAsset(b.logo), alt: '' }) : h('span', { class: 'org-mono', style: `background:${b.ink || '#15161D'}` }, (o.clickupLabel || o.name).slice(0, 3)),
          h('div', { class: 'org-titles' }, [h('h2', {}, o.name), h('div', { class: 'muted' }, `${o.activeCompanies} active of ${o.companies} clients · ClickUp Branch: ${o.clickupLabel || '—'}${o.active ? '' : ' · switched off'}`)]),
          can('manageClients') ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => editOrg(o) }, 'Edit') : null
        ]),
        h('div', { class: 'org-link' }, [
          h('span', { class: 'label' }, 'Client sign-in page'),
          h('a', { href: o.portalUrl, target: '_blank', rel: 'noopener noreferrer' }, o.portalUrl.replace(/^https:\/\//, '')),
          copyButton(o.portalUrl, 'Copy link')
        ]),
        h('div', { class: 'swatches', 'aria-label': 'Colours' }, ['ink', 'accent', 'highlight'].map((k) => b[k] ? h('span', { class: 'swatch', title: `${k} ${b[k]}` }, [h('i', { style: `background:${b[k]}` }), k]) : null)),
        h('h3', { class: 'branches-title' }, ['Branches ', h('span', { class: 'muted' }, `(${o.branches.length})`)]),
        o.branches.length ? h('ul', { class: 'branch-list' }, o.branches.map((br) => h('li', { class: br.active ? '' : 'off' }, [
          br.logo ? h('span', { class: `btile btile-${br.tile}` }, h('img', { src: frontrowAsset(br.logo), alt: '' })) : h('span', { class: 'btile btile-text' }, br.name.slice(0, 2)),
          h('span', { class: 'branch-name' }, [br.name, h('span', { class: 'muted' }, br.clickupValue ? ` · ClickUp: ${br.clickupValue}` : ' · not linked to ClickUp')]),
          can('manageClients') ? h('button', { class: 'btn btn-link', type: 'button', onclick: () => editBranch(o, br) }, 'Edit') : null
        ]))) : h('p', { class: 'muted' }, 'No branches.'),
        can('manageClients') ? h('button', { class: 'btn btn-link', type: 'button', onclick: () => editBranch(o, null) }, '+ Add branch') : null
      ]);
    })));
}

// Organization images live in the client app; show them from there.
function frontrowAsset(path) {
  if (/^https:\/\//.test(path)) return path;
  return `${(state.me && state.me.frontrowUrl) || ''}${path}`;
}

function editOrg(o) {
  const b = (o && o.branding) || {};
  const input = (v, attrs = {}) => { const el = h('input', { type: 'text', spellcheck: 'false', autocomplete: 'off', ...attrs }); el.value = v || ''; return el; };
  const name = input(o && o.name, { maxlength: 120 });
  const slug = input('', { maxlength: 31, placeholder: 'e.g. jtg' });
  const label = input('', { maxlength: 60, placeholder: 'e.g. JTG' });
  const domain = input(o && o.customDomain, { placeholder: 'portal.example.com' });
  const ink = input(b.ink, { placeholder: '#16185A', maxlength: 7 });
  const accent = input(b.accent, { placeholder: '#2E3192', maxlength: 7 });
  const hi = input(b.highlight, { placeholder: '#00AEEF', maxlength: 7 });
  const logo = input(b.logo, { placeholder: '/assets/orgs/… or https://…' });
  const logoDark = input(b.logo_on_dark, { placeholder: '/assets/orgs/… or https://…' });
  const home = input(b.home_url, { placeholder: 'https://…' });
  const tagline = input(b.tagline, { maxlength: 120 });
  const active = h('input', { type: 'checkbox', id: 'org-active' }); active.checked = !o || o.active;
  modal({
    title: o ? `Edit ${o.name}` : 'Add organization',
    sub: o ? 'Changes show on its sign-in page straight away.' : 'Its sign-in page will be at /<link name>.',
    body: [
      field('Name', name),
      o ? null : h('div', { class: 'row' }, [field('Link name', slug, 'Lower-case letters, numbers, dashes.'), field('ClickUp Branch label', label, 'Accounts with this Branch label belong here.')]),
      field('Own domain', domain, 'Only once its DNS points at Frontrow. Setup links will use it.', '(optional)'),
      h('div', { class: 'row3' }, [field('Dark colour', ink), field('Button colour', accent), field('Highlight', hi)]),
      field('Logo (on white)', logo, null, '(optional)'),
      field('Logo (on dark)', logoDark, 'Used in emails.', '(optional)'),
      field('Main website', home, 'A small link back to it on the sign-in page.', '(optional)'),
      field('Tagline', tagline, null, '(optional)'),
      o ? h('label', { for: 'org-active', class: 'check' }, [active, ' Active — its sign-in page works']) : null
    ],
    submitLabel: o ? 'Save' : 'Add organization',
    onSubmit: async () => {
      const branding = { ink: ink.value.trim(), accent: accent.value.trim(), highlight: hi.value.trim(), logo: logo.value.trim(), logo_on_dark: logoDark.value.trim(), home_url: home.value.trim(), tagline: tagline.value.trim(), font: b.font || 'default', icon: b.icon };
      if (o) await api(`/api/orgs?id=${o.id}`, { method: 'PATCH', body: { name: name.value, customDomain: domain.value, branding, active: active.checked } });
      else await api('/api/orgs', { method: 'POST', body: { name: name.value, slug: slug.value, clickupLabel: label.value, branding } });
      toast('Saved.');
      renderApp();
    }
  });
}

function editBranch(o, br) {
  const name = h('input', { type: 'text', maxlength: 120 }); name.value = br ? br.name : '';
  const value = h('input', { type: 'text', maxlength: 60, spellcheck: 'false', placeholder: 'e.g. F5' }); value.value = br ? br.clickupValue || '' : '';
  const logo = h('input', { type: 'text', spellcheck: 'false', placeholder: '/assets/brands/… or https://…' }); logo.value = br ? br.logo || '' : '';
  const tile = h('select', {}, [['light', 'White tile'], ['dark', 'Dark tile'], ['tint', 'Tinted tile']].map(([v, l]) => h('option', { value: v }, l))); tile.value = br ? br.tile : 'light';
  const active = h('input', { type: 'checkbox', id: 'br-active' }); active.checked = !br || br.active;
  modal({
    title: br ? `Edit ${br.name}` : `Add a branch to ${o.name}`,
    body: [field('Name', name), field('ClickUp Sub-Branch value', value, 'Accounts with this Sub-Branch land in this branch on sync.'), h('div', { class: 'row' }, [field('Logo', logo, null, '(optional)'), field('Tile', tile)]),
      br ? h('label', { for: 'br-active', class: 'check' }, [active, ' Show on the sign-in page']) : null],
    submitLabel: br ? 'Save' : 'Add branch',
    onSubmit: async () => {
      const payload = { name: name.value, clickupValue: value.value, logo: logo.value, tile: tile.value };
      if (br) await api(`/api/orgs?branchId=${br.id}`, { method: 'PATCH', body: { ...payload, active: active.checked } });
      else await api('/api/orgs?branch=1', { method: 'POST', body: { ...payload, organizationId: o.id } });
      toast('Saved.');
      renderApp();
    }
  });
}

/* ---------- Add to Frontrow (from the CRM) ---------- */

async function viewAdd(main, seq, clickupId) {
  document.title = 'Add to Frontrow · Frontrow Manager';
  fill(main, pageHead('Add to Frontrow', 'Bringing this ClickUp entry in…'), h('div', { class: 'loading' }, 'Checking ClickUp…'));
  let r;
  try { r = await api('/api/sync', { method: 'POST', body: { clickupId } }); }
  catch (e) { if (!stale(seq)) { fill(main, pageHead('Add to Frontrow'), h('div', { class: 'err-box', role: 'alert' }, e.message)); } return; }
  if (stale(seq)) return;
  await loadOrgs().catch(() => null);
  const people = r.contacts || [];
  const skipped = r.skipped || {};
  fill(main,
    pageHead('Add to Frontrow', r.kind === 'account' ? 'This account and its contacts are now in Frontrow.' : 'This contact is now in Frontrow.'),
    people.length ? h('div', { class: 'stack' }, people.map((p) => h('section', { class: 'card' }, [
      h('div', { class: 'request-head' }, [h('h2', {}, p.fullName || p.email), accountBadge(p)]),
      h('p', { class: 'muted', style: 'margin:0 0 10px;overflow-wrap:anywhere' }, p.email),
      p.companies.length ? h('div', { class: 'chips', style: 'margin-bottom:12px' }, p.companies.map((co) => h('a', { class: `chip-link${co.active ? '' : ' off'}`, href: `#/clients/${co.id}/people` }, `${co.name}${co.active ? '' : ` (${co.clickupStatus || 'not active'})`}`))) : null,
      p.eligible
        ? h('div', { class: 'btn-row' }, linkButtons(p, null))
        : h('div', { class: 'note warn' }, p.companies.length
          ? 'Not eligible yet: none of their accounts is Active in ClickUp. Set the account’s Account Status to Active, then come back.'
          : 'Not eligible yet: this contact isn’t linked to an account in ClickUp. Link them to their company’s account, then come back.')
    ]))) : h('div', { class: 'empty' }, r.kind === 'account' ? 'This account has no linked contacts with an email in ClickUp.' : 'This contact has no email in ClickUp. Add a Primary Email there, then try again.'),
    (skipped.contactsWithoutEmail || []).length ? h('div', { class: 'note warn', style: 'margin-top:14px' }, `No email in ClickUp, so not added: ${skipped.contactsWithoutEmail.join(', ')}. Add a Primary Email there.`) : null,
    (skipped.accountsWithoutOrganization || []).length ? h('div', { class: 'note warn', style: 'margin-top:14px' }, `These accounts have no Branch (JTG, MCO, UNY, MKC SA) in ClickUp, so they weren’t added: ${skipped.accountsWithoutOrganization.join(', ')}.`) : null);
}

/* ---------- Composer ---------- */

async function viewComposer(main, seq, { companyId, updateId }) {
  let doc;
  let detail;
  try {
    if (updateId) {
      doc = (await api(`/api/updates?id=${encodeURIComponent(updateId)}`)).update;
      companyId = doc.companyId;
    } else {
      doc = { id: null, status: 'draft', type: 'update', title: '', summary: '', notes: '', bodyHtml: '', updatedAt: null };
    }
    detail = await api(`/api/companies?id=${encodeURIComponent(companyId)}`);
  } catch (e) { if (!stale(seq)) showError(main, e); return; }
  if (stale(seq)) return;
  const company = detail.company;
  const readOnly = !can('edit') || doc.status === 'archived';
  document.title = `${doc.id ? (doc.title || 'Untitled') : 'New update'} · ${company.name}`;

  // ----- inputs -----
  const type = h('select', { disabled: readOnly }, Object.entries(TYPE_LABELS).map(([v, l]) => h('option', { value: v }, l)));
  type.value = doc.type;
  const title = h('input', { type: 'text', maxlength: 200, value: doc.title, disabled: readOnly, placeholder: 'e.g. October results: leads up 32%' });
  const summary = h('textarea', { maxlength: 1000, rows: 2, value: doc.summary, disabled: readOnly, style: 'min-height:64px', placeholder: 'One or two sentences shown above the page in the client’s list.' });
  const notes = h('textarea', { class: 'notes', maxlength: 20000, value: doc.notes, disabled: readOnly, placeholder: 'Paste call notes, numbers, dates, links — anything the client needs to know. Rough is fine.' });
  const notesCount = h('div', { class: 'count', 'aria-live': 'off' });
  const bodyHtml = h('textarea', { class: 'code', value: doc.bodyHtml, disabled: readOnly, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', placeholder: '<!doctype html>\n<html>…the page from Gemini, Claude or ChatGPT…</html>' });
  const bodyCount = h('div', { class: 'count' });

  let format = TYPE_FORMAT[doc.type] || 'update';
  let formatChosen = false;

  function updateCounts() {
    notesCount.textContent = `${notes.value.length.toLocaleString('en-US')} / 20,000`;
    notesCount.classList.toggle('over', notes.value.length > 20000);
    const kb = new Blob([bodyHtml.value]).size / 1024;
    bodyCount.textContent = bodyHtml.value ? `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB` : '';
  }

  // ----- prompt helpers -----
  const promptCtx = () => ({
    company: { name: company.name, orgName: company.organization ? company.organization.name : '', accent: company.accent, orgAccent: company.orgAccent },
    title: title.value,
    notes: notes.value,
    sender: state.me.fullName && !state.me.fullName.includes('@') ? state.me.fullName : '',
    date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  });
  const promptPre = h('pre', {});
  const refreshPeek = () => { promptPre.textContent = buildPrompt(format, promptCtx()); };

  const formatCards = h('div', { class: 'format-cards', role: 'group', 'aria-label': 'Page format' }, FORMATS.map((f) => h('button', {
    type: 'button', class: 'format-card', 'aria-pressed': f.id === format ? 'true' : 'false', 'data-format': f.id,
    onclick: () => { format = f.id; formatChosen = true; syncFormatCards(); refreshPeek(); }
  }, [h('strong', {}, f.label), h('span', {}, FORMAT_SHORT[f.id] || f.blurb)])));
  function syncFormatCards() {
    formatCards.querySelectorAll('.format-card').forEach((b) => b.setAttribute('aria-pressed', b.dataset.format === format ? 'true' : 'false'));
  }

  const copyBtn = h('button', {
    class: 'btn btn-primary', type: 'button',
    onclick: async () => {
      if (!notes.value.trim() && !confirm('Your notes are empty, so the prompt will only have a placeholder. Copy it anyway?')) return;
      const ok = await copyText(buildPrompt(format, promptCtx()));
      if (ok) {
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { copyBtn.textContent = 'Copy prompt'; }, 2500);
        toast('Prompt copied. Paste it into Gemini, Claude or ChatGPT, then paste the page it writes into Page HTML.');
      } else {
        peek.open = true;
        toast('Your browser blocked copying. Select the prompt under “See the full prompt” and copy it by hand.', 'err', 7000);
      }
    }
  }, 'Copy prompt');

  const gemini = state.me.gemini || { available: false };
  const gemBtn = h('button', {
    class: 'btn btn-gem', type: 'button',
    disabled: !gemini.available || !can('assist'),
    title: gemini.available ? `Drafts with ${gemini.model}` : 'Gemini drafting is paused',
    onclick: () => draftWithGemini()
  }, '✦ Draft with Gemini');
  const gemNote = h('div', { class: 'note gem', hidden: gemini.available });
  function setGemPaused(message) {
    gemBtn.disabled = true;
    gemNote.hidden = false;
    gemNote.textContent = message || 'Gemini drafting is paused until the subscription is renewed. Copy prompt does the same job: paste it into Gemini, Claude or ChatGPT, then paste the page it writes below.';
  }
  if (!gemini.available) setGemPaused(gemini.reason === 'switched_off' ? 'Gemini drafting is switched off for now. Copy prompt does the same job by hand.' : null);

  const peek = h('details', { class: 'prompt-peek', ontoggle: () => { if (peek.open) refreshPeek(); } }, [h('summary', {}, 'See the full prompt'), promptPre]);

  async function draftWithGemini() {
    if (!notes.value.trim()) { toast('Add your notes first — Gemini only writes from what you give it.', 'err'); notes.focus(); return; }
    if (bodyHtml.value.trim() && !confirm('Replace the current page HTML with a new Gemini draft?')) return;
    gemBtn.disabled = true;
    gemBtn.textContent = 'Drafting… (up to a minute)';
    announce('Drafting with Gemini');
    try {
      const d = await api('/api/assist', { method: 'POST', body: { format, companyId: company.id, title: title.value, notes: notes.value } });
      bodyHtml.value = d.html;
      markDirty();
      updateCounts();
      if (doc.status === 'draft') {
        // save() shows its own error (e.g. no title yet); only claim success if it saved.
        if (await save({ quiet: true })) toast('Draft ready and saved. Check the preview, fix any [to confirm] gaps, then publish.');
      } else {
        // A live page is never overwritten by an unreviewed draft.
        toast('Draft ready but NOT saved — this update is live. Review it, then save.', 'ok', 8000);
      }
    } catch (err) {
      if (err.data && err.data.paused) {
        state.me.gemini = { ...gemini, available: false };
        setGemPaused(err.message + ' Copy prompt still works.');
      } else fail(err);
    } finally {
      gemBtn.textContent = '✦ Draft with Gemini';
      if (state.me.gemini && state.me.gemini.available !== false) gemBtn.disabled = !can('assist');
    }
  }

  // ----- preview -----
  let previewMode = 'phone';
  // Same sandbox as the server's CSP: no scripts or forms; links may open a new tab.
  const frame = h('iframe', { class: 'preview-frame phone', title: 'Client page preview', sandbox: 'allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer', loading: 'lazy' });
  const previewEmpty = h('div', { class: 'preview-empty' }, 'Save to see the page exactly as the client will.');
  const previewBox = h('div', {});
  function refreshPreview() {
    if (!doc.id) { fill(previewBox, previewEmpty); return; }
    frame.src = `/api/view?id=${doc.id}&v=${Date.now()}`;
    if (!frame.isConnected) fill(previewBox, frame);
  }
  const modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Preview width' }, [['phone', 'Phone'], ['full', 'Full width']].map(([id, label]) => h('button', {
    type: 'button', 'aria-pressed': id === previewMode ? 'true' : 'false',
    onclick: (e) => {
      previewMode = id;
      frame.classList.toggle('phone', id === 'phone');
      e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'));
    }
  }, label)));

  // ----- status + actions -----
  const statusText = h('span', {});
  const statusBadge = h('span', {});
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => save() });
  const publishBtn = h('button', { class: 'btn btn-go', type: 'button', onclick: () => publish() }, 'Publish…');
  const unpublishBtn = h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => doTransition('unpublish') }, 'Unpublish');
  const archiveBtn = h('button', { class: 'btn btn-link', type: 'button', onclick: () => doTransition('archive') }, 'Archive');
  const restoreBtn = h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => doTransition('restore') }, 'Restore as draft');

  function renderStatus() {
    fill(statusBadge, badge(doc.id ? doc.status : 'new draft', doc.id ? doc.status : 'draft'));
    if (state.dirty) statusText.textContent = doc.status === 'published' ? 'Unsaved — this update is live, saving changes what the client sees' : 'Unsaved changes';
    else if (doc.updatedAt) statusText.textContent = `Saved ${fmtDate(doc.updatedAt)}`;
    else statusText.textContent = '';
    saveBtn.textContent = doc.status === 'published' ? 'Save live changes' : 'Save draft';
    saveBtn.hidden = readOnly;
    publishBtn.hidden = readOnly || !can('publish') || doc.status !== 'draft';
    unpublishBtn.hidden = !can('publish') || doc.status !== 'published';
    archiveBtn.hidden = !can('publish') || !doc.id || doc.status === 'archived';
    restoreBtn.hidden = !can('edit') || doc.status !== 'archived';
  }

  function markDirty() { if (!state.dirty) { state.dirty = true; renderStatus(); } }

  let saving = false;
  async function save({ quiet = false } = {}) {
    if (saving) return false;
    if (!title.value.trim()) { toast('Add a title before saving.', 'err'); title.focus(); return false; }
    saving = true;
    saveBtn.disabled = true;
    const body = { type: type.value, title: title.value, summary: summary.value, notes: notes.value, bodyHtml: bodyHtml.value };
    try {
      if (!doc.id) {
        doc = (await api('/api/updates', { method: 'POST', body: { companyId: company.id, ...body } })).update;
        replaceRoute(`#/edit/${doc.id}`);
      } else {
        doc = (await api(`/api/updates?id=${doc.id}`, { method: 'PATCH', body: { ...body, expectedUpdatedAt: doc.updatedAt } })).update;
      }
      // The server sanitises the page; show what was actually stored.
      if (doc.bodyHtml !== undefined && doc.bodyHtml !== bodyHtml.value) {
        bodyHtml.value = doc.bodyHtml;
        if (!quiet) toast('Saved. Scripts, forms or embeds were removed from the page — they can’t run in the portal.', 'ok', 7000);
      } else if (!quiet) toast(doc.status === 'published' ? 'Saved — the client now sees this version.' : 'Draft saved.');
      state.dirty = false;
      document.title = `${doc.title || 'Untitled'} · ${company.name}`;
      renderStatus();
      updateCounts();
      refreshPreview();
      announce('Saved');
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  }

  async function doTransition(action) {
    const confirmText = {
      unpublish: `Take “${doc.title}” off ${company.name}’s portal? It goes back to draft.`,
      archive: doc.status === 'published' ? `Archive “${doc.title}”? It will disappear from ${company.name}’s portal.` : `Archive “${doc.title}”?`
    }[action];
    if (confirmText && !confirm(confirmText)) return;
    if (state.dirty && action !== 'restore' && !(await save({ quiet: true }))) return;
    try {
      doc = { ...doc, ...(await api(`/api/updates?id=${doc.id}&action=${action}`, { method: 'POST' })).update };
      toast({ unpublish: 'Unpublished — back to draft.', archive: 'Archived.', restore: 'Restored as a draft.' }[action]);
      state.dirty = false;
      renderApp();
    } catch (err) { fail(err); }
  }

  async function publish() {
    if (state.dirty || !doc.id) { if (!(await save({ quiet: true }))) return; }
    let people = [];
    try { people = (await api(`/api/contacts?companyId=${company.id}`)).contacts || []; } catch { people = []; }
    const n = people.filter((p) => p.account && p.account.hasPassword && p.account.status === 'active').length;
    const waiting = people.filter((p) => !(p.account && p.account.hasPassword)).length;
    modal({
      title: `Publish to ${company.name}?`,
      sub: !company.active
        ? `${company.name} isn’t active, so nobody can sign in to see this until it is.`
        : n
          ? `${n} ${n === 1 ? 'person' : 'people'} will see “${doc.title}” in their portal straight away${waiting ? `, and ${waiting} more once they set up their account` : ''}.`
          : `Nobody at ${company.name} has set up their account yet${waiting ? ` (${waiting} can — send them a setup link from the People tab)` : ''}. They’ll see this once they do.`,
      body: [h('p', { style: 'margin:0;font-size:14px;color:var(--steel)' }, 'Check the preview for any [to confirm] gaps first — that marker means the notes didn’t say.')],
      submitLabel: 'Publish now',
      submitClass: 'btn-go',
      onSubmit: async () => {
        doc = { ...doc, ...(await api(`/api/updates?id=${doc.id}&action=publish`, { method: 'POST' })).update };
        toast(`Published to ${company.name}.`);
        state.dirty = false;
        renderStatus();
        refreshPreview();
      }
    });
  }

  // ----- wire-up -----
  for (const el of [type, title, summary, notes, bodyHtml]) el.addEventListener('input', () => { markDirty(); updateCounts(); });
  type.addEventListener('change', () => {
    markDirty();
    if (!formatChosen) { format = TYPE_FORMAT[type.value] || 'update'; syncFormatCards(); }
  });
  let peekTimer;
  for (const el of [title, notes]) el.addEventListener('input', () => { clearTimeout(peekTimer); if (peek.open) peekTimer = setTimeout(refreshPeek, 300); });
  // Ctrl/Cmd+S saves.
  main.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !readOnly) { e.preventDefault(); save(); }
  });

  const crumbs = [
    h('a', { href: '#/clients' }, 'Clients'), h('span', { 'aria-hidden': 'true' }, '›'),
    h('a', { href: `#/clients/${company.id}` }, company.name), h('span', { 'aria-hidden': 'true' }, '›'),
    h('span', {}, doc.id ? 'Edit update' : 'New update')
  ];

  const left = h('div', { class: 'stack' }, [
    h('section', { class: 'card', 'aria-labelledby': 'c-details' }, [
      h('h2', { id: 'c-details' }, 'Details'),
      h('div', { class: 'stack', style: 'margin-top:10px' }, [
        h('div', { class: 'row-3' }, [field('Type', type), field('Title', title)]),
        field('Summary', summary, null, '(optional)')
      ])
    ]),
    h('section', { class: 'card', 'aria-labelledby': 'c-notes' }, [
      h('h2', { id: 'c-notes' }, 'Your notes'),
      h('p', { class: 'sub' }, 'Internal — clients never see these. They’re what the prompt turns into a page.'),
      notes, notesCount
    ]),
    readOnly ? null : h('section', { class: 'card', 'aria-labelledby': 'c-assist' }, [
      h('h2', { id: 'c-assist' }, 'Turn your notes into a page'),
      h('p', { class: 'sub' }, 'Pick a format. Copy prompt fills in your notes, the client and their colours.'),
      formatCards,
      h('div', { class: 'assist-actions' }, [copyBtn, can('assist') ? gemBtn : null]),
      h('div', { class: 'paste-into' }, ['Paste into:', ...AI_LINKS.map((l) => h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, `${l.label} ↗`))]),
      can('assist') ? gemNote : null,
      peek
    ]),
    h('section', { class: 'card', 'aria-labelledby': 'c-html' }, [
      h('h2', { id: 'c-html' }, 'Page HTML'),
      h('p', { class: 'sub' }, readOnly ? 'The stored page.' : 'Paste the complete page here. Scripts, forms and embeds are stripped when you save.'),
      bodyHtml, bodyCount
    ])
  ]);

  const right = h('section', { class: 'preview-col card', 'aria-labelledby': 'c-preview' }, [
    h('div', { class: 'preview-head' }, [
      h('h2', { id: 'c-preview', style: 'margin:0' }, 'Preview'),
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
        modeSeg,
        h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => (state.dirty && !readOnly ? save() : refreshPreview()) }, state.dirty ? 'Save & refresh' : 'Refresh')
      ])
    ]),
    previewBox
  ]);

  const archivedNote = doc.status === 'archived' ? h('div', { class: 'note warn', style: 'margin-bottom:14px' }, 'This update is archived and read-only. Restore it as a draft to edit or republish.') : null;
  const roNote = !can('edit') ? h('div', { class: 'note', style: 'margin-bottom:14px' }, 'Your role can read updates but not change them.') : null;

  fill(main, 
    pageHead(doc.id ? (doc.title || 'Untitled') : 'New update', `For ${company.name}`, [], crumbs),
    archivedNote, roNote,
    h('div', { class: 'composer' }, [left, right]),
    h('div', { class: 'action-bar' }, [
      h('div', { class: 'status', role: 'status' }, [statusBadge, statusText]),
      archiveBtn, restoreBtn, unpublishBtn, saveBtn, publishBtn
    ])
  );
  renderStatus();
  updateCounts();
  refreshPreview();
  if (!doc.id) setTimeout(() => title.focus(), 0);
}

/* ---------- Prompt library ---------- */

function viewPrompts(main, seq, focusId) {
  document.title = 'Prompt library · Frontrow Manager';
  const sender = state.me.fullName && !state.me.fullName.includes('@') ? state.me.fullName : '';
  const cards = FORMATS.map((f) => {
    const text = buildPrompt(f.id, { sender });
    const btn = h('button', {
      class: 'btn btn-primary', type: 'button',
      onclick: async () => {
        const ok = await copyText(text);
        if (ok) { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = 'Copy prompt'; }, 2500); toast('Copied. Replace the [placeholders] and paste your notes at the end.'); }
        else toast('Your browser blocked copying. Select the prompt below and copy it by hand.', 'err', 7000);
      }
    }, 'Copy prompt');
    const linkBtn = h('button', {
      class: 'btn btn-secondary', type: 'button',
      onclick: async () => {
        const url = `${location.origin}${location.pathname}#/prompts/${f.id}`;
        if (await copyText(url)) toast('Link to this prompt copied.'); else toast(url, 'ok', 8000);
      }
    }, 'Copy link');
    return h('section', { class: 'card prompt-card', id: `prompt-${f.id}`, 'aria-labelledby': `ph-${f.id}`, tabindex: '-1', style: focusId === f.id ? 'box-shadow:0 0 0 3px var(--blue)' : null }, [
      h('h2', { id: `ph-${f.id}` }, f.label),
      h('p', { class: 'sub' }, f.blurb),
      h('div', { class: 'assist-actions' }, [btn, linkBtn]),
      h('div', { class: 'paste-into' }, ['Paste into:', ...AI_LINKS.map((l) => h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, `${l.label} ↗`))]),
      h('pre', {}, text)
    ]);
  });
  fill(main, 
    pageHead('Prompt library', `Three prompts that turn rough notes into a client-ready page. Version ${PROMPT_VERSION}.`),
    h('section', { class: 'card', style: 'margin-bottom:16px' }, [
      h('h2', {}, 'Fastest way: from inside an update'),
      h('ol', { class: 'steps', style: 'margin-top:8px' }, [
        h('li', {}, 'Open a client and start a new update. Paste your notes.'),
        h('li', {}, 'Pick a format and press Copy prompt — the client, their colours, your name and your notes are filled in.'),
        h('li', {}, 'Paste it into Gemini, Claude or ChatGPT and copy the HTML page it writes.'),
        h('li', {}, 'Paste that into Page HTML, save, check the preview, then publish.')
      ]),
      h('div', { class: 'note' }, 'Copying from this page gives the bare template: replace the [placeholders] and put your notes between <notes> and </notes>.')
    ]),
    h('div', { class: 'prompt-grid' }, cards)
  );
  if (focusId && formatById(focusId)) {
    const el = document.getElementById(`prompt-${focusId}`);
    if (el) setTimeout(() => { el.scrollIntoView({ block: 'start' }); el.focus({ preventScroll: true }); }, 0);
  }
}

/* ---------- Team ---------- */

async function viewTeam(main, seq) {
  document.title = 'Team · Frontrow Manager';
  let data;
  try { data = await api('/api/team'); } catch (e) { if (!stale(seq)) showError(main, e); return; }
  if (stale(seq)) return;
  const team = data.team || [];
  const manage = can('manageTeam');

  const roleSelect = (value, attrs = {}) => {
    const s = h('select', attrs, Object.entries(ROLE_LABELS).map(([v, l]) => h('option', { value: v }, l)));
    s.value = value;
    return s;
  };

  const rows = team.map((p) => {
    const self = p.personId === state.me.personId;
    const locked = !manage || self || p.bootstrap;
    const sel = roleSelect(p.role, {
      'aria-label': `Role for ${p.fullName || p.email}`, disabled: locked,
      onchange: async (e) => {
        try { await api(`/api/team?personId=${p.personId}`, { method: 'PATCH', body: { role: e.target.value } }); toast('Role updated.'); }
        catch (err) { e.target.value = p.role; fail(err); }
      }
    });
    return h('tr', {}, [
      h('td', { class: 'primary-cell' }, [p.fullName || p.email, self ? ' (you)' : '', p.bootstrap ? [' ', badge('Owner', 'blue')] : null, p.active === false ? [' ', badge('Inactive', 'off')] : null].flat()),
      h('td', { 'data-label': 'Email', style: 'overflow-wrap:anywhere' }, p.email),
      h('td', { 'data-label': 'Role' }, locked ? (ROLE_LABELS[p.role] || p.role) : sel),
      manage ? h('td', { class: 'row-actions' }, locked ? (p.bootstrap ? h('span', { class: 'muted', title: 'Set in the PORTAL_ADMIN_EMAILS setting' }, 'Set in Vercel') : null) : h('button', {
        class: 'btn btn-danger btn-sm', type: 'button',
        onclick: async () => {
          if (!confirm(`Remove ${p.fullName || p.email}’s Frontrow Manager access? Their client assignments are removed too.`)) return;
          try { await api(`/api/team?personId=${p.personId}`, { method: 'DELETE' }); toast('Access removed.'); renderApp(); }
          catch (err) { fail(err); }
        }
      }, 'Remove')) : null
    ]);
  });

  const actions = manage ? [h('button', {
    class: 'btn btn-primary', type: 'button',
    onclick: () => {
      const email = h('input', { type: 'email', autocomplete: 'off' });
      const name = h('input', { type: 'text', maxlength: 120, autocomplete: 'off' });
      const role = roleSelect('account_manager');
      const help = h('div', { class: 'hint' }, ROLE_HELP.account_manager);
      role.addEventListener('change', () => { help.textContent = ROLE_HELP[role.value]; });
      modal({
        title: 'Add team member',
        sub: 'They sign in with a link sent to this email.',
        body: [field('Email', email), field('Name', name, null, '(optional)'), h('div', { class: 'field' }, [h('label', { for: role.id = 'tm-role' }, 'Role'), role, help])],
        submitLabel: 'Add',
        onSubmit: async () => {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) { email.focus(); throw new Error('Enter a valid email address.'); }
          await api('/api/team', { method: 'POST', body: { email: email.value, fullName: name.value, role: role.value } });
          toast('Added. Assign them to clients from each client’s Staff tab.');
          renderApp();
        }
      });
    }
  }, '+ Add team member')] : [];

  fill(main, 
    pageHead('Team', 'Who can use the Frontrow Manager, and what each role can do.', actions),
    h('div', { class: 'card', style: 'padding:6px 8px' }, team.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data stackable' }, [
      h('thead', {}, h('tr', {}, ['Name', 'Email', 'Role', manage ? '' : null].filter((t) => t !== null).map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, rows)
    ])) : h('div', { class: 'empty' }, 'No one yet.')),
    h('section', { class: 'card' }, [
      h('h2', {}, 'Roles'),
      h('table', { class: 'data' }, h('tbody', {}, Object.entries(ROLE_LABELS).map(([k, l]) => h('tr', {}, [h('td', { style: 'font-weight:700;white-space:nowrap' }, l), h('td', {}, ROLE_HELP[k])]))))
    ])
  );
}

boot();
