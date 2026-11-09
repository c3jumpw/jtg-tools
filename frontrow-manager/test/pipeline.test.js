import test from 'node:test';
import assert from 'node:assert/strict';
import { readFields, createDraft, saveUpdate, transition } from '../lib/pipeline.js';
import { fakeDb, IDS, sessions, thrown } from './helpers.js';

function world() {
  return fakeDb({
    'frontrow.companies': [{ id: IDS.acme, name: 'Acme', organization_id: 'o1' }, { id: IDS.other, name: 'Other', organization_id: 'o2' }],
    'frontrow.staff_company_assignments': [{ person_id: IDS.am, company_id: IDS.acme }],
    'frontrow.updates': [{ id: IDS.update, company_id: IDS.acme, title: 'Draft', summary: '', body_html: '', status: 'draft', updated_at: '2026-11-04T10:00:00.000Z' }]
  });
}

test('readFields validates and sanitises', async () => {
  assert.equal((await thrown(() => readFields({ title: '' }))).status, 400);
  assert.equal((await thrown(() => readFields({ type: 'memo' }))).status, 400);
  const f = readFields({ title: ' Hi ', bodyHtml: '<p onclick="x()">a</p><script>1</script>' });
  assert.equal(f.title, 'Hi');
  assert.equal(f.body_html, '<p>a</p>');
  assert.deepEqual(Object.keys(readFields({})), []);
});

test('an account manager can draft for an assigned client, with an audit row', async () => {
  const db = world();
  const u = await createDraft(sessions.am, { companyId: IDS.acme, title: 'October', notes: 'n' }, db);
  assert.equal(u.status, 'draft');
  assert.equal(u.company_id, IDS.acme);
  const audit = db.calls.find((c) => c[0] === 'insert' && c[2] === 'audit_log');
  assert.equal(audit[3].tool, 'frontrow');
  assert.equal(audit[3].action, 'update.create');
  assert.equal(audit[3].entity, 'update');
  assert.equal(audit[3].detail.actor_email, sessions.am.email);
});

test('…but not for a client they are not assigned to, and supervisors not at all', async () => {
  assert.equal((await thrown(() => createDraft(sessions.am, { companyId: IDS.other, title: 'x' }, world()))).status, 404);
  assert.equal((await thrown(() => createDraft(sessions.sup, { companyId: IDS.acme, title: 'x' }, world()))).status, 403);
});

test('publishing an empty update is refused; with a page it stamps who and when', async () => {
  const db = world();
  assert.equal((await thrown(() => transition(sessions.am, IDS.update, 'publish', db))).status, 400);
  await saveUpdate(sessions.am, IDS.update, { bodyHtml: '<h1>Hi</h1>' }, db);
  const u = await transition(sessions.am, IDS.update, 'publish', db);
  assert.equal(u.status, 'published');
  assert.equal(u.published_by, IDS.am);
  assert.ok(u.published_at);
  const back = await transition(sessions.am, IDS.update, 'unpublish', db);
  assert.equal(back.status, 'draft');
  assert.equal(back.published_at, null);
});

test('a save based on an older version is refused instead of overwriting', async () => {
  const db = world();
  await saveUpdate(sessions.am, IDS.update, { title: 'A', expectedUpdatedAt: '2026-11-04T10:00:00.000Z' }, db);
  const e = await thrown(() => saveUpdate(sessions.am, IDS.update, { title: 'B', expectedUpdatedAt: '2026-11-04T10:00:00.000Z' }, db));
  assert.equal(e.status, 409);
});

test('archived updates are read-only until restored; unknown actions are rejected', async () => {
  const db = world();
  await transition(sessions.super, IDS.update, 'archive', db);
  assert.equal((await thrown(() => saveUpdate(sessions.super, IDS.update, { title: 'x' }, db))).status, 409);
  assert.equal((await thrown(() => transition(sessions.super, IDS.update, 'publish', db))).status, 409);
  assert.equal((await transition(sessions.super, IDS.update, 'restore', db)).status, 'draft');
  assert.equal((await thrown(() => transition(sessions.super, IDS.update, 'delete', db))).status, 400);
});
