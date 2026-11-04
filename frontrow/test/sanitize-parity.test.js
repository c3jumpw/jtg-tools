import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Each Vercel project deploys from its own folder, so the helpers both apps
 * use are copied rather than shared. These checks fail the build of either
 * app if the copies drift. */
const here = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const there = (p) => readFileSync(new URL(`../../frontrow-manager/${p}`, import.meta.url), 'utf8');

for (const file of ['lib/sanitize.js', 'lib/clickup.js', 'lib/directory.js', 'lib/tokens.js', 'lib/mail.js', 'test/fake-postgrest.js']) {
  test(`${file} matches the Frontrow Manager copy`, () => {
    assert.equal(here(file), there(file));
  });
}

test('lib/core.js matches the Frontrow Manager copy apart from its name', () => {
  const strip = (s) => s
    .replace(/^\/\/ Kept in step[^\n]*\n\/\/[^\n]*\n/, '')
    .replace(/Frontrow Manager backend|Frontrow backend/g, 'X')
    .replace(/'frontrow-manager route failed'|'frontrow route failed'/g, 'Y');
  assert.equal(strip(here('lib/core.js')), strip(there('lib/core.js')));
});
