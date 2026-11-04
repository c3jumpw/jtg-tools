/* Frontrow client app.
 *
 * One script for every organization's portal. The page shell (rendered by
 * api/page.js) carries the organization's public face in a JSON block; this
 * file draws the sign-in page, the account links, and the signed-in portal.
 *
 * Account links arrive as /<org>#setup=…, #reset=… or #request=…. The token
 * is read, wiped from the address bar at once, checked (read-only), and
 * spent only when the person submits the form — so a mail scanner that
 * opens the link can't use it up.
 *
 * Update pages are only ever shown through /api/view in a sandboxed iframe,
 * never inserted into this page.
 */

const app = document.getElementById('app');
const BOOT = JSON.parse(document.getElementById('fr-boot').textContent || '{}');
const ORG = BOOT.org || null;
const B = (ORG && ORG.branding) || {};
const TYPE_LABELS = { update: 'Update', task: 'Task', guide: 'Guide', report: 'Report', meeting: 'Meeting recap' };
const LINK_ERRORS = {
  badlink: 'That link isn’t valid. Ask for a new one below.',
  used: 'That link has already been used. If you need another, ask for one below.',
  expired: 'That link has expired. Ask for a new one below.',
  slow: 'Too many attempts. Wait a few minutes and try again.'
};
const state = { me: null, companyId: null, updates: null, installEvent: null };

/* ---------- helpers ---------- */

function h(tag, attrs, kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of [].concat(kids == null ? [] : kids)) {
    if (kid == null || kid === false) continue;
    el.append(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return el;
}
const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  let res;
  try { res = await fetch(path, init); } catch {
    throw Object.assign(new Error('We can’t reach the portal right now. Check your connection and try again.'), { status: 0 });
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || 'Something went wrong. Please try again.'), { status: res.status, data });
  return data;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
};

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

const orgPath = (slug) => `/${slug}`;
const homeOf = () => (ORG ? location.pathname.replace(/\/$/, '') || '/' : '/signin');

function setStatus(el, text, kind) {
  el.textContent = text || '';
  el.className = `status${kind ? ` is-${kind}` : ''}`;
}

function field(label, input, hint) {
  const id = input.id || `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h('div', { class: 'field' }, [h('label', { for: id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null]);
}

function passwordInput(attrs) {
  const input = h('input', { type: 'password', autocomplete: 'current-password', spellcheck: 'false', autocapitalize: 'off', ...attrs });
  const btn = h('button', {
    type: 'button', 'aria-label': 'Show password', 'aria-pressed': 'false',
    onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    }
  }, 'Show');
  return { input, wrap: h('div', { class: 'pw' }, [input, btn]) };
}

function logo(onDark = false) {
  if (!ORG) return h('img', { class: 'org-logo', src: '/assets/brand/frontrow-on-light.png', alt: 'Frontrow', width: '186', height: '41' });
  const src = onDark ? (B.logo_on_dark || B.logo) : B.logo;
  return src ? h('img', { class: 'org-logo', src, alt: ORG.name }) : h('span', { class: 'org-name' }, ORG.name);
}

/* ---------- the sign-in page frame ---------- */

function gate(content, { focus } = {}) {
  document.title = ORG ? `${ORG.name} · Client portal` : 'Sign in · Frontrow';
  const foot = h('footer', { class: 'gate-foot' }, [
    ORG && B.home_url ? h('a', { class: 'home-link', href: B.home_url }, B.home_url.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '')) : h('span', {}),
    h('a', { class: 'powered', href: BOOT.frontrow && BOOT.frontrow.url ? BOOT.frontrow.url : '/' }, [
      h('img', { src: '/assets/brand/favicon-32.png', alt: '', width: '16', height: '16' }), 'Powered by ', h('b', {}, 'frontrow')
    ])
  ]);
  const main = h('main', { class: 'gate-main', id: 'main' }, [
    h('header', { class: 'gate-top' }, logo()),
    h('div', { class: 'gate-body' }, content),
    foot
  ]);
  const panel = ORG ? h('aside', { class: 'panel', 'aria-labelledby': 'panel-title' }, h('div', { class: 'panel-in' }, [
    h('h2', { id: 'panel-title' }, B.tagline || `Your ${ORG.name} team, all in one place.`),
    h('p', {}, ORG.branches && ORG.branches.length ? 'Whichever of our teams you work with, your updates live here.' : 'Updates, tasks and guides from your team — on any device.'),
    ORG.branches && ORG.branches.length
      ? h('ul', { class: 'tiles' }, ORG.branches.map((br) => h('li', {}, h('span', { class: `tile${br.tile === 'dark' ? ' tile-dark' : br.tile === 'tint' ? ' tile-tint' : ''}` },
        br.logo ? h('img', { src: br.logo, alt: br.name, loading: 'lazy', decoding: 'async' }) : br.name))))
      : h('div', { class: 'seats', 'aria-hidden': 'true' }, [h('i'), h('i', { class: 'on' }), h('i')])
  ])) : null;
  put(app, h('div', { class: `gate${ORG ? '' : ' solo'}` }, [main, panel]));
  if (focus) setTimeout(() => focus.focus(), 0);
}

/* ---------- sign in ---------- */

function signInView(message, kind = 'error') {
  const email = h('input', { type: 'email', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', required: true, placeholder: 'you@yourcompany.com' });
  const pw = passwordInput({ required: true });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in');
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  if (message) setStatus(status, message, kind);
  let busy = false;
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) { email.setAttribute('aria-invalid', 'true'); setStatus(status, 'Please check your email address.', 'error'); email.focus(); return; }
      if (!pw.input.value) { setStatus(status, 'Enter your password.', 'error'); pw.input.focus(); return; }
      email.removeAttribute('aria-invalid');
      busy = true; submit.disabled = true; submit.textContent = 'Signing in…'; setStatus(status, '');
      try {
        const r = await api('/api/login', { method: 'POST', body: { email: email.value.trim(), password: pw.input.value, org: ORG ? ORG.slug : '' } });
        if (r.org && (!ORG || r.org !== ORG.slug)) { location.replace(orgPath(r.org)); return; }
        await start();
      } catch (err) {
        busy = false; submit.disabled = false; submit.textContent = 'Sign in';
        pw.input.value = '';
        setStatus(status, err.message, 'error');
      }
    }
  }, [
    field('Email address', email),
    field('Password', pw.wrap),
    submit,
    status,
    h('div', { class: 'alt' }, [
      h('button', { type: 'button', class: 'link', onclick: () => accessView('setup', email.value) }, 'First time here? Set up your account'),
      h('button', { type: 'button', class: 'link', onclick: () => accessView('reset', email.value) }, 'Forgot password?')
    ])
  ]);
  gate([
    h('p', { class: 'eyebrow' }, 'Client portal'),
    h('h1', {}, 'Sign in to see your updates'),
    h('p', { class: 'lede' }, ORG ? `Progress updates, tasks and how-to guides from your ${ORG.name} team, all in one place.` : 'Progress updates, tasks and how-to guides from your team, all in one place.'),
    form
  ], { focus: email });
}

/* ---------- set up / forgot password (by email) ---------- */

function accessView(kind, prefill = '') {
  const email = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', required: true, placeholder: 'you@yourcompany.com', value: prefill || '' });
  if (prefill) email.value = prefill;
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Email me a link');
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  let busy = false;
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) { email.setAttribute('aria-invalid', 'true'); setStatus(status, 'Please check your email address.', 'error'); email.focus(); return; }
      busy = true; submit.disabled = true; submit.textContent = 'Sending…'; setStatus(status, '');
      try {
        const r = await api('/api/access', { method: 'POST', body: { email: email.value.trim(), org: ORG ? ORG.slug : '' } });
        submit.textContent = 'Link sent — check your inbox'; submit.classList.add('btn-ok');
        setStatus(status, r.message, 'ok');
        setTimeout(() => { busy = false; submit.disabled = false; submit.classList.remove('btn-ok'); submit.textContent = 'Send another link'; }, 30000);
      } catch (err) {
        busy = false; submit.disabled = false; submit.textContent = 'Email me a link';
        setStatus(status, err.message, 'error');
      }
    }
  }, [
    field('Email address', email, 'Use the email your team has on file.'),
    submit,
    status,
    h('div', { class: 'alt' }, [h('button', { type: 'button', class: 'link', onclick: () => signInView() }, '← Back to sign in')])
  ]);
  gate([
    h('p', { class: 'eyebrow' }, kind === 'reset' ? 'Forgot password' : 'First time here'),
    h('h1', {}, kind === 'reset' ? 'Reset your password' : 'Set up your account'),
    h('p', { class: 'lede' }, kind === 'reset'
      ? 'Enter your email and we’ll send you a link to choose a new password.'
      : 'Enter your email. If your company has a portal with us, we’ll send you a link to choose a password — it takes a minute.'),
    form
  ], { focus: email });
}

/* ---------- links from emails ---------- */

async function tokenFlow(kind, token) {
  gate([h('p', { class: 'boot', role: 'status' }, 'Checking your link…')]);
  let info;
  try {
    info = await api('/api/token', { method: 'POST', body: { t: token, kind } });
  } catch (err) {
    const code = err.data && err.data.code;
    return linkProblem(LINK_ERRORS[code] || err.message, kind);
  }
  if (kind === 'request') return requestForm(token, info);
  return passwordForm(kind, token, info);
}

function linkProblem(message, kind) {
  gate([
    h('p', { class: 'eyebrow' }, 'Link problem'),
    h('h1', {}, 'This link can’t be used'),
    h('p', { class: 'lede' }, message),
    h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => accessView(kind === 'reset' ? 'reset' : 'setup') }, 'Get a new link'),
    h('div', { class: 'alt' }, [h('button', { type: 'button', class: 'link', onclick: () => signInView() }, 'Sign in instead')])
  ]);
}

function passwordForm(kind, token, info) {
  const first = (info.name || '').split(' ')[0];
  const pw = passwordInput({ autocomplete: 'new-password', required: true, minlength: '10' });
  const again = passwordInput({ autocomplete: 'new-password', required: true });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, kind === 'setup' ? 'Create my account' : 'Save new password');
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  // Lets password managers save the login against the right email.
  const user = h('input', { type: 'email', autocomplete: 'username', value: info.email, readonly: true, class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
  user.value = info.email;
  let busy = false;
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      if (pw.input.value.length < 10) { setStatus(status, 'Use at least 10 characters.', 'error'); pw.input.focus(); return; }
      if (pw.input.value !== again.input.value) { setStatus(status, 'The two passwords don’t match.', 'error'); again.input.focus(); return; }
      busy = true; submit.disabled = true; submit.textContent = 'Saving…'; setStatus(status, '');
      try {
        const r = await api('/api/set-password', { method: 'POST', body: { t: token, password: pw.input.value } });
        if (r.firstTime) return welcomeView(r.org, first);
        location.replace(r.org ? orgPath(r.org) : homeOf());
      } catch (err) {
        busy = false; submit.disabled = false; submit.textContent = kind === 'setup' ? 'Create my account' : 'Save new password';
        const code = err.data && err.data.code;
        if (['badlink', 'used', 'expired'].includes(code)) return linkProblem(LINK_ERRORS[code], kind);
        setStatus(status, err.message, 'error');
      }
    }
  }, [
    user,
    h('div', { class: 'field' }, [h('label', {}, 'Email'), h('div', { class: 'hint', style: 'font-size:1rem;color:inherit' }, info.email)]),
    field(kind === 'setup' ? 'Choose a password' : 'New password', pw.wrap, 'At least 10 characters. A short sentence is easy to remember and hard to guess.'),
    field('Type it again', again.wrap),
    submit,
    status
  ]);
  gate([
    h('p', { class: 'eyebrow' }, kind === 'setup' ? 'Set up your account' : 'Reset your password'),
    h('h1', {}, kind === 'setup' ? (first ? `Welcome, ${first}` : 'Welcome') : 'Choose a new password'),
    h('p', { class: 'lede' }, kind === 'setup' ? 'Choose a password and you’re in. You’ll stay signed in on this device for 30 days.' : 'Your other devices will be signed out.'),
    form
  ], { focus: pw.input });
}

function welcomeView(orgSlug, first) {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /android/i.test(navigator.userAgent);
  const go = h('a', { class: 'btn btn-primary btn-block', href: orgSlug ? orgPath(orgSlug) : homeOf() }, 'Open my portal');
  gate([
    h('div', { class: 'done-icon', 'aria-hidden': 'true' }),
    h('h1', {}, first ? `You’re all set, ${first}` : 'You’re all set'),
    h('p', { class: 'lede' }, 'Your account is ready. We’ve emailed you these steps too.'),
    h('div', { class: 'howto' }, [
      h('h3', {}, 'Put it on your home screen'),
      h('ol', { class: 'steps-list' }, ios
        ? [h('li', {}, 'Open this page in Safari.'), h('li', {}, 'Tap the Share button (the square with an arrow).'), h('li', {}, 'Choose Add to Home Screen, then Add.')]
        : android
          ? [h('li', {}, 'Open this page in Chrome.'), h('li', {}, 'Tap the ⋮ menu.'), h('li', {}, 'Choose Install app or Add to Home screen.')]
          : [h('li', {}, 'On iPhone: Safari → Share → Add to Home Screen.'), h('li', {}, 'On Android: Chrome → ⋮ → Install app.'), h('li', {}, 'On a computer: bookmark this page.')])
    ]),
    go
  ], { focus: go });
}

function requestForm(token, info) {
  const name = h('input', { type: 'text', autocomplete: 'name', required: true, maxlength: '120' });
  const company = h('input', { type: 'text', autocomplete: 'organization', maxlength: '200' });
  const message = h('textarea', { maxlength: '2000', placeholder: 'Who you work with, or anything that helps us find your account.' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Send request');
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  let busy = false;
  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      if (!name.value.trim()) { setStatus(status, 'Please add your name.', 'error'); name.focus(); return; }
      busy = true; submit.disabled = true; submit.textContent = 'Sending…';
      try {
        await api('/api/access-confirm', { method: 'POST', body: { t: token, fullName: name.value, companyName: company.value, message: message.value } });
        gate([
          h('div', { class: 'done-icon', 'aria-hidden': 'true' }),
          h('h1', {}, 'Request sent'),
          h('p', { class: 'lede' }, `Thanks. Your team has your request and will be in touch at ${info.email}. Once you’re added, use “Set up your account” on the sign-in page.`),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => signInView() }, 'Back to sign in')
        ]);
      } catch (err) {
        busy = false; submit.disabled = false; submit.textContent = 'Send request';
        const code = err.data && err.data.code;
        if (['badlink', 'used', 'expired'].includes(code)) return linkProblem(LINK_ERRORS[code], 'setup');
        setStatus(status, err.message, 'error');
      }
    }
  }, [
    h('div', { class: 'field' }, [h('label', {}, 'Email'), h('div', { style: 'font-size:1rem' }, info.email)]),
    field('Your name', name),
    field('Company', company),
    field('Anything else?', message),
    submit, status
  ]);
  gate([
    h('p', { class: 'eyebrow' }, 'Request access'),
    h('h1', {}, 'Ask for a portal account'),
    h('p', { class: 'lede' }, 'We couldn’t find an active account for your email. Tell us who you are and your team will set you up.'),
    form
  ], { focus: name });
}

/* ---------- signed in ---------- */

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvent = e; });

function installCard() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /android/i.test(navigator.userAgent);
  const key = `fr_install_dismissed_${ORG ? ORG.slug : 'x'}`;
  if (standalone || (!ios && !android) || store.get(key)) return null;
  const card = h('div', { class: 'install', role: 'note' });
  const close = h('button', { class: 'x', type: 'button', 'aria-label': 'Dismiss', onclick: () => { store.set(key, '1'); card.remove(); } }, '×');
  const action = state.installEvent && !ios
    ? h('button', { class: 'link', type: 'button', onclick: async () => { state.installEvent.prompt(); await state.installEvent.userChoice.catch(() => null); state.installEvent = null; card.remove(); } }, 'Install now')
    : null;
  put(card, [
    h('img', { src: `${B.icon || '/assets/brand'}/icon-192.png`, alt: '' }),
    h('div', {}, [
      h('b', {}, `Add ${ORG ? ORG.name : 'your portal'} to your home screen`),
      h('p', {}, ios ? 'Tap Share, then “Add to Home Screen”.' : 'Tap ⋮, then “Install app”.'),
      action
    ]),
    close
  ]);
  return card;
}

function shell(content) {
  const me = state.me;
  const orgs = me.organizations || [];
  put(app, h('div', { class: 'portal' }, [
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' }, [
      h('a', { href: '#/', 'aria-label': 'Your updates' }, logo()),
      h('span', { class: 'spacer' }),
      h('span', { class: 'who', title: me.email }, me.fullName || me.email),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: signOut }, 'Sign out')
    ])),
    h('main', { class: 'wrap', id: 'main', tabindex: '-1' }, [
      orgs.length > 1 ? h('nav', { class: 'orgs', 'aria-label': 'Organizations', style: 'margin-bottom:16px' },
        orgs.map((o) => h('a', { href: orgPath(o.slug), 'aria-current': ORG && o.slug === ORG.slug ? 'page' : null }, o.name))) : null,
      ...[].concat(content)
    ]),
    h('footer', { class: 'portal-foot' }, h('a', { class: 'powered', href: (BOOT.frontrow && BOOT.frontrow.url) || '/' }, [
      h('img', { src: '/assets/brand/favicon-32.png', alt: '', width: '16', height: '16' }), 'Powered by ', h('b', {}, 'frontrow')
    ]))
  ]));
}

async function signOut() {
  try { await api('/api/me?action=logout', { method: 'POST' }); } catch { /* cookie is cleared server-side either way */ }
  state.me = null;
  history.replaceState(null, '', location.pathname);
  signInView('You’re signed out.', 'ok');
}

function myCompanies() {
  return (state.me.companies || []).filter((c) => !ORG || c.org === ORG.slug);
}

async function listView() {
  const companies = myCompanies();
  const company = companies.find((c) => c.id === state.companyId) || companies[0];
  state.companyId = company.id;
  document.title = `${company.name} · ${ORG ? ORG.name : 'Client portal'}`;
  const list = h('div', {}, h('p', { class: 'boot', role: 'status' }, 'Loading your updates…'));
  const switcher = companies.length > 1 ? (() => {
    const s = h('select', { onchange: (e) => { state.companyId = e.target.value; state.updates = null; listView(); } }, companies.map((c) => h('option', { value: c.id }, c.name)));
    s.value = company.id;
    return h('div', { class: 'bar' }, field('Company', s));
  })() : null;
  shell([
    installCard(),
    h('h1', { class: 'page-title' }, company.name),
    h('p', { class: 'page-sub' }, `Updates, tasks and guides from your ${ORG ? ORG.name : ''} team.`.replace('  ', ' ')),
    switcher,
    list
  ]);
  try {
    const d = await api(`/api/updates?companyId=${encodeURIComponent(company.id)}`);
    if (state.companyId !== company.id) return;
    state.updates = d.updates || [];
  } catch (err) {
    if (err.status === 401) return signInView('Your session has ended. Sign in again to continue.');
    return put(list, h('p', { class: 'error', role: 'alert' }, err.message));
  }
  if (!state.updates.length) {
    return put(list, h('div', { class: 'empty' }, [h('strong', {}, 'Nothing here yet'), 'Your team will post updates here as work progresses.']));
  }
  put(list, h('ul', { class: 'updates' }, state.updates.map((u) => h('li', {}, h('a', { class: 'card', href: `#/u/${u.id}` }, [
    h('div', { class: 'card-meta' }, [h('span', { class: 'chip' }, TYPE_LABELS[u.type] || 'Update'), h('time', { datetime: u.publishedAt }, fmtDate(u.publishedAt))]),
    h('h2', { class: 'card-title' }, u.title),
    u.summary ? h('p', { class: 'card-sum' }, u.summary) : null
  ])))));
}

function viewerView(id) {
  const known = (state.updates || []).find((u) => u.id === id);
  document.title = `${known ? known.title : 'Update'} · ${ORG ? ORG.name : 'Client portal'}`;
  shell([
    h('a', { class: 'back', href: '#/' }, '← All updates'),
    h('h1', { class: 'sr-only' }, known ? known.title : 'Update'),
    // Same sandbox as the server's CSP: no scripts or forms; links may open a new tab.
    h('iframe', { class: 'viewer', src: `/api/view?id=${encodeURIComponent(id)}`, title: known ? known.title : 'Update', sandbox: 'allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer' })
  ]);
}

function route() {
  if (!state.me) return;
  const m = location.hash.match(/^#\/u\/([0-9a-f-]{36})$/i);
  if (m) viewerView(m[1]); else listView();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => { if (state.me && !/^#(setup|reset|request)=/.test(location.hash)) route(); });

/* ---------- start ---------- */

async function start() {
  const link = location.hash.match(/^#(setup|reset|request)=([A-Za-z0-9_-]{32,64})$/);
  if (link) {
    history.replaceState(null, '', location.pathname);
    return tokenFlow(link[1], link[2]);
  }
  let me;
  try { me = await api('/api/me'); } catch (err) { return signInView(err.message); }
  if (!me || !me.authenticated) return signInView();
  state.me = me;
  const companies = me.companies || [];
  if (!companies.length) return signInView('Your account isn’t linked to an active client right now. Contact your account manager.');
  if (!ORG || !companies.some((c) => c.org === ORG.slug)) { location.replace(orgPath(companies[0].org)); return; }
  route();
}

start();
