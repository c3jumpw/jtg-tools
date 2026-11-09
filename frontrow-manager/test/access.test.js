import test from 'node:test';
import assert from 'node:assert/strict';
import { CAN, can, visibleCompanyIds, loadVisibleCompany, companyFilter } from '../lib/access.js';
import { fakeDb, IDS, sessions, thrown } from './helpers.js';

test('role table: only super admins manage the team; supervisors are read-only', () => {
  assert.equal(can('super_admin', 'manageTeam'), true);
  assert.equal(can('manager', 'manageTeam'), false);
  assert.equal(can('account_manager', 'publish'), true);
  assert.equal(can('account_manager', 'seeAll'), false);
  for (const p of ['publish', 'edit', 'assist', 'manageClients']) assert.equal(can('supervisor', p), false);
  assert.equal(can('nonsense', 'edit'), false);
  assert.deepEqual(Object.keys(CAN).sort(), ['account_manager', 'manager', 'super_admin', 'supervisor']);
});

test('assigned-only roles see just their assignments; seeAll roles see everything', async () => {
  const db = fakeDb({ 'frontrow.staff_company_assignments': [{ person_id: IDS.am, company_id: IDS.acme }] });
  assert.equal(await visibleCompanyIds(sessions.super, db), null);
  assert.deepEqual(await visibleCompanyIds(sessions.am, db), [IDS.acme]);
  assert.deepEqual(await visibleCompanyIds({ ...sessions.am, personId: null }, db), []);
});

test('a client you are not assigned to answers 404, same as one that does not exist', async () => {
  const db = fakeDb({
    'frontrow.staff_company_assignments': [{ person_id: IDS.am, company_id: IDS.acme }],
    'frontrow.companies': [{ id: IDS.acme, name: 'Acme' }, { id: IDS.other, name: 'Other' }]
  });
  assert.equal((await loadVisibleCompany(sessions.am, IDS.acme, db)).name, 'Acme');
  assert.equal((await thrown(() => loadVisibleCompany(sessions.am, IDS.other, db))).status, 404);
  assert.equal((await thrown(() => loadVisibleCompany(sessions.super, '99999999-9999-4999-8999-999999999999', db))).status, 404);
  assert.equal((await thrown(() => loadVisibleCompany(sessions.super, "x' or 1=1", db))).status, 400);
});

test('companyFilter never produces an empty in() list', () => {
  assert.equal(companyFilter(null), '');
  assert.equal(companyFilter([]), 'company_id=eq.00000000-0000-0000-0000-000000000000');
  assert.equal(companyFilter([IDS.acme], 'id'), `id=in.(${IDS.acme})`);
});
