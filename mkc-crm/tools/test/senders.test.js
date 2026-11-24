// Which Resend key the CRM's email route uses (api/_lib/senders.ts).
// Node 22 runs the TypeScript file directly (types are stripped).
// Usage: node test/senders.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../../api/_lib/senders.ts')).href);

// A fake Resend: each key's account and whether the key may list domains.
function fakeResend(accounts) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const key = init.headers.Authorization.replace('Bearer ', '');
    calls.push(key);
    const a = accounts[key];
    if (!a) return new Response('{}', { status: 401 });
    if (a.sendingOnly) return new Response('{"name":"restricted_api_key"}', { status: 401 });
    if (a.status) return new Response('{}', { status: a.status });
    return new Response(JSON.stringify({ data: a.domains.map((name) => ({ name, status: 'verified' })) }), { status: 200 });
  };
  return { fetchImpl, calls };
}

test('finds the account from Resend, with the RESEND_API_KEY_<letter> names', async () => {
  const s = await load(); s.clearSenderCache();
  const env = { RESEND_API_KEY_A: 'ka', RESEND_API_KEY_F: 'kf' };
  const { fetchImpl } = fakeResend({ ka: { domains: ['mkcworkspace.com'] }, kf: { domains: ['newbrand.com'] } });
  const r = await s.resendKeyFor('pat@newbrand.com', env, fetchImpl);
  assert.equal(r.ok, true); assert.equal(r.key, 'kf'); assert.equal(r.account, 'F'); assert.equal(r.how, 'resend');
});

test('the older RESEND_KEY_<letter> names still work', async () => {
  const s = await load(); s.clearSenderCache();
  const { fetchImpl } = fakeResend({ kb: { domains: ['j-tgroup.com'] } });
  const r = await s.resendKeyFor('dana@j-tgroup.com', { RESEND_KEY_B: 'kb' }, fetchImpl);
  assert.equal(r.ok, true); assert.equal(r.variable, 'RESEND_KEY_B');
});

test('a sending-only key falls back to the list in senders.ts', async () => {
  const s = await load(); s.clearSenderCache();
  const { fetchImpl } = fakeResend({ kb: { sendingOnly: true } });
  const r = await s.resendKeyFor('dana@j-tgroup.com', { RESEND_API_KEY_B: 'kb' }, fetchImpl);
  assert.equal(r.ok, true); assert.equal(r.key, 'kb'); assert.equal(r.how, 'list');
});

test('lookups are cached; a rate limit is not', async () => {
  const s = await load(); s.clearSenderCache();
  const { fetchImpl, calls } = fakeResend({ ka: { domains: ['mkcworkspace.com'] }, kz: { status: 429 } });
  const env = { RESEND_API_KEY_A: 'ka', RESEND_API_KEY_Z: 'kz' };
  await s.resendKeyFor('a@mkcworkspace.com', env, fetchImpl);
  await s.resendKeyFor('b@mkcworkspace.com', env, fetchImpl);
  assert.equal(calls.filter((k) => k === 'ka').length, 1, 'cached');
  assert.equal(calls.filter((k) => k === 'kz').length, 2, 'rate-limited lookups are retried');
});

test('subdomains are separate; unknown domains get a clear message', async () => {
  const s = await load(); s.clearSenderCache();
  const { fetchImpl } = fakeResend({ kd: { domains: ['unywebs.com'] } });
  const r = await s.resendKeyFor('x@shop.unywebs.com', { RESEND_API_KEY_D: 'kd' }, fetchImpl);
  assert.equal(r.ok, false); assert.equal(r.status, 400); assert.match(r.error, /RESEND_API_KEY_<letter>/);
});

test('the old single RESEND_API_KEY is the last resort', async () => {
  const s = await load(); s.clearSenderCache();
  const r = await s.resendKeyFor('x@somewhere.com', { RESEND_API_KEY: 'old' }, async () => new Response('{}', { status: 401 }));
  assert.equal(r.ok, true); assert.equal(r.key, 'old'); assert.equal(r.how, 'fallback');
});

test('no key for a listed domain says which variable is missing', async () => {
  const s = await load(); s.clearSenderCache();
  const r = await s.resendKeyFor('dana@j-tgroup.com', {}, async () => new Response('{}', { status: 401 }));
  assert.equal(r.ok, false); assert.match(r.error, /RESEND_API_KEY_B is not set/);
});
