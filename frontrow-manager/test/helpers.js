/* A fake PostgREST-ish db: enough of select/insert/patch for the pipeline
 * and access rules, with every call recorded so tests can assert on them. */
export function fakeDb(tables = {}) {
  const calls = [];
  const db = {
    calls,
    tables,
    async select(schema, table, query = '') {
      calls.push(['select', schema, table, query]);
      const rows = tables[`${schema}.${table}`] || [];
      const id = (query.match(/(?:^|&)id=eq\.([^&]+)/) || [])[1];
      const person = (query.match(/person_id=eq\.([^&]+)/) || [])[1];
      return rows.filter((r) => (!id || r.id === id) && (!person || r.person_id === person));
    },
    async insert(schema, table, row) {
      calls.push(['insert', schema, table, row]);
      const stored = { id: row.id || `00000000-0000-4000-8000-${String(calls.length).padStart(12, '0')}`, updated_at: '2026-11-04T10:00:00.000Z', ...row };
      (tables[`${schema}.${table}`] ||= []).push(stored);
      return [stored];
    },
    async patch(schema, table, filter, changes) {
      calls.push(['patch', schema, table, filter, changes]);
      // Honour every col=eq.value in the filter, like PostgREST.
      const conds = [...filter.matchAll(/(?:^|&)(\w+)=eq\.([^&]+)/g)].map((m) => [m[1], decodeURIComponent(m[2])]);
      const rows = (tables[`${schema}.${table}`] || []).filter((r) => conds.every(([c, v]) => String(r[c]) === v));
      rows.forEach((r) => Object.assign(r, changes, { updated_at: '2026-11-04T11:00:00.000Z' }));
      return rows;
    }
  };
  return db;
}

export const IDS = {
  acme: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  update: '33333333-3333-4333-8333-333333333333',
  am: '44444444-4444-4444-8444-444444444444',
  boss: '55555555-5555-4555-8555-555555555555'
};

export const sessions = {
  super: { email: 'boss@mkc.test', personId: IDS.boss, role: 'super_admin', fullName: 'Boss' },
  am: { email: 'am@mkc.test', personId: IDS.am, role: 'account_manager', fullName: 'Avery Manager' },
  sup: { email: 'sup@mkc.test', personId: IDS.am, role: 'supervisor', fullName: 'Sam Supervisor' }
};

/** Runs fn and returns the thrown Response (the routes' error convention). */
export async function thrown(fn) {
  try { await fn(); } catch (e) { return e; }
  throw new Error('expected a throw');
}
