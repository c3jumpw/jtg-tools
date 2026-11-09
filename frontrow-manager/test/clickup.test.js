// ClickUp helpers against a workspace shaped like the real MKC one (see the
// note on CU in fake-postgrest.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeClickUp, CU } from './fake-postgrest.js';
import { createContact, relateContactToAccount, readAccount, readContact, clickupConfig } from '../lib/clickup.js';

const opts = (cu) => ({ env: { CLICKUP_API_TOKEN: 'test-token' }, fetchImpl: (url, init) => cu.handle(url, init) });

test('createContact sends only fields the Contacts list has (no Branch there)', async () => {
  const cu = fakeClickUp();
  const id = await createContact({ name: 'Nora Newbie', email: 'nora@acme.test', orgLabel: 'JTG' }, opts(cu));
  const sent = cu.created[0].custom_fields.map((f) => f.id);
  assert.equal(cu.created[0].id, id);
  assert.deepEqual(sent.sort(), [CU.f.email, CU.f.first, CU.f.last].sort());
  assert.ok(!sent.includes(CU.f.branch));
});

test('createContact still sends everything when ClickUp won’t list the fields', async () => {
  const cu = fakeClickUp({ listFields: {} });
  await createContact({ name: 'Nora Newbie', email: 'nora@acme.test', orgLabel: 'JTG' }, opts(cu));
  assert.ok(cu.created[0].custom_fields.some((f) => f.id === CU.f.branch));
});

test('relateContactToAccount uses the account’s Main Contact field, never a contact’s first (Deals) field', async () => {
  const cu = fakeClickUp({ tasks: [CU.account('acc1', 'Acme', { contacts: ['con1'] }), CU.contact('con2', 'Lou New', 'lou@acme.test')] });
  assert.equal(await relateContactToAccount('con2', 'acc1', opts(cu)), true);
  assert.deepEqual(cu.relations, [{ taskId: 'acc1', fieldId: CU.mainContact, value: { add: ['con2'], rem: [] } }]);
});

test('relateContactToAccount does nothing when the two are already linked', async () => {
  const cu = fakeClickUp({ tasks: [CU.account('acc1', 'Acme', { contacts: ['con1'] }), CU.contact('con1', 'Pat Client', 'pat@acme.test', { accounts: ['acc1'] })] });
  assert.equal(await relateContactToAccount('con1', 'acc1', opts(cu)), true);
  assert.equal(cu.relations.length, 0);
});

test('relateContactToAccount falls back to the contact’s field that points at Accounts', async () => {
  const acc = CU.account('acc1', 'Acme');
  acc.custom_fields = acc.custom_fields.filter((f) => f.id !== CU.mainContact);
  const cu = fakeClickUp({ tasks: [acc, CU.contact('con2', 'Lou New', 'lou@acme.test')] });
  assert.equal(await relateContactToAccount('con2', 'acc1', opts(cu)), true);
  assert.deepEqual(cu.relations, [{ taskId: 'con2', fieldId: CU.mainContact, value: { add: ['acc1'], rem: [] } }]);
});

test('relateContactToAccount gives up rather than guess when no field joins the lists', async () => {
  const acc = CU.account('acc1', 'Acme');
  acc.custom_fields = acc.custom_fields.filter((f) => f.id !== CU.mainContact);
  const con = CU.contact('con2', 'Lou New', 'lou@acme.test');
  con.custom_fields = con.custom_fields.filter((f) => f.id !== CU.mainContact);
  const cu = fakeClickUp({ tasks: [acc, con] });
  assert.equal(await relateContactToAccount('con2', 'acc1', opts(cu)), false);
  assert.equal(cu.relations.length, 0);
});

test('an account’s contacts and a contact’s accounts ignore linked deals and tasks', () => {
  const cfg = clickupConfig({});
  assert.deepEqual(readAccount(CU.account('acc1', 'Acme', { contacts: ['con1', 'con2'] }), cfg).contactIds, ['con1', 'con2']);
  assert.deepEqual(readContact(CU.contact('con1', 'Pat Client', 'pat@acme.test', { accounts: ['acc1'] }), cfg).accountIds, ['acc1']);
});
