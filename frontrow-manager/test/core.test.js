import test from 'node:test';
import assert from 'node:assert/strict';
import { emailFilter, sameEmail, clean, rateLimited, originAllowed } from '../lib/core.js';

test('email lookups escape LIKE wildcards so j_hn@x.com cannot match john@x.com', () => {
  assert.equal(emailFilter('J_hn@X.com'), `email=ilike.${encodeURIComponent('j\\_hn@x.com')}`);
  assert.equal(emailFilter('a%b@x.com'), `email=ilike.${encodeURIComponent('a\\%b@x.com')}`);
  assert.equal(sameEmail('John@X.com ', 'john@x.com'), true);
  assert.equal(sameEmail('j_hn@x.com', 'john@x.com'), false);
  assert.equal(sameEmail('*@x.com', 'john@x.com'), false);
});

test('clean strips control characters and trims to length', () => {
  assert.equal(clean('  hi\u0000 there\u0007 ', 5), 'hi th');
  assert.equal(clean(42, 5), '');
});

test('rate limiter allows the max then blocks within the window', () => {
  const key = `t-${Math.random()}`;
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(rateLimited(key, 3, 1000, now + i), false);
  assert.equal(rateLimited(key, 3, 1000, now + 5), true);
  assert.equal(rateLimited(key, 3, 1000, now + 5000), false);
});

test('cross-site browser requests are refused; same-site and non-browser pass', () => {
  const req = (origin, host = 'pm.example.com') => new Request(`https://${host}/api/x`, { headers: { ...(origin ? { origin } : {}), host } });
  assert.equal(originAllowed(req(null)), true);
  assert.equal(originAllowed(req('https://pm.example.com')), true);
  assert.equal(originAllowed(req('https://evil.example')), false);
  assert.equal(originAllowed(req('not a url')), false);
});
