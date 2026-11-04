import { select, insert, patch, remove } from './core.js';
import { clickupConfig, listTasks, getTask, readAccount, readContact } from './clickup.js';

/* ClickUp → Frontrow.
 *
 * ClickUp decides who may use Frontrow, so this copies it in:
 *   Accounts list  → companies (organization from the Branch label, branch
 *                    from Sub-Branch, active from Account Status)
 *   Contacts list  → contacts (sign-in email from Primary Email)
 *   relationships  → contact_companies with source 'clickup'
 *
 * Links made by hand in Frontrow Manager (source 'manual') are never
 * removed by a sync. Companies that disappear from ClickUp are switched off,
 * not deleted, so their published updates are kept.
 */

const DB = { select, insert, patch, remove };

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function loadMaps(db) {
  const orgs = await db.select('frontrow', 'organizations', 'select=id,slug,name,clickup_label') || [];
  const branches = await db.select('frontrow', 'branches', 'select=id,organization_id,clickup_value') || [];
  const orgByLabel = new Map(orgs.filter((o) => o.clickup_label).map((o) => [o.clickup_label.toLowerCase(), o]));
  const branchByKey = new Map(branches.filter((b) => b.clickup_value).map((b) => [`${b.organization_id}|${b.clickup_value.toLowerCase()}`, b]));
  return { orgs, orgByLabel, branchByKey };
}

/** Company row for an account, or null when its Branch matches no organization. */
function companyRow(acc, maps, now) {
  const org = acc.orgLabels.map((l) => maps.orgByLabel.get(l.toLowerCase())).find(Boolean);
  if (!org) return null;
  const branch = acc.subBranch ? maps.branchByKey.get(`${org.id}|${acc.subBranch.toLowerCase()}`) : null;
  return {
    clickup_account_id: acc.clickupId,
    organization_id: org.id,
    branch_id: branch ? branch.id : null,
    name: acc.name,
    clickup_status: acc.status || null,
    active: acc.active,
    source: 'clickup',
    synced_at: now
  };
}

async function upsertCompanies(rows, db) {
  const out = [];
  for (const part of chunk(rows, 200)) {
    out.push(...(await db.insert('frontrow', 'companies', part, { onConflict: 'clickup_account_id' }) || []));
  }
  return out;
}

async function upsertContacts(rows, db) {
  // Someone whose email changed in ClickUp already has a row under their old
  // email. Move that row to the new email first, so the upsert by email
  // updates it instead of colliding on clickup_contact_id. If the new email
  // already belongs to another row, leave both alone and let the upsert
  // attach ClickUp to the row that owns the email.
  const ids = rows.map((r) => r.clickup_contact_id);
  const current = [];
  for (const part of chunk(ids, 100)) {
    current.push(...(await db.select('frontrow', 'contacts',
      `select=id,email,clickup_contact_id&clickup_contact_id=in.(${part.map((x) => encodeURIComponent(x)).join(',')})`) || []));
  }
  const byCu = new Map(current.map((c) => [c.clickup_contact_id, c]));
  const emails = new Set();
  for (const part of chunk(rows.map((r) => r.email), 100)) {
    for (const c of (await db.select('frontrow', 'contacts',
      `select=email&email=in.(${part.map((e) => encodeURIComponent(e)).join(',')})`) || [])) emails.add(c.email);
  }
  for (const r of rows) {
    const had = byCu.get(r.clickup_contact_id);
    if (had && had.email !== r.email) {
      if (emails.has(r.email)) {
        // The old row is no longer this ClickUp contact: it keeps only the
        // links staff made by hand.
        await db.patch('frontrow', 'contacts', `id=eq.${had.id}`, { clickup_contact_id: null });
        await db.remove('frontrow', 'contact_companies', `contact_id=eq.${had.id}&source=eq.clickup`);
      } else {
        await db.patch('frontrow', 'contacts', `id=eq.${had.id}`, { email: r.email });
        emails.add(r.email);
      }
    }
  }
  const out = [];
  for (const part of chunk(rows, 200)) {
    out.push(...(await db.insert('frontrow', 'contacts', part, { onConflict: 'email' }) || []));
  }
  return out;
}

/** Makes the 'clickup' links for these contacts exactly `pairs`. */
async function replaceLinks(contactIds, pairs, db) {
  const want = new Set(pairs.map((p) => `${p.contact_id}|${p.company_id}`));
  const existing = [];
  for (const part of chunk(contactIds, 100)) {
    existing.push(...(await db.select('frontrow', 'contact_companies',
      `select=contact_id,company_id,source&contact_id=in.(${part.join(',')})`) || []));
  }
  const have = new Set(existing.map((l) => `${l.contact_id}|${l.company_id}`));
  const stale = existing.filter((l) => l.source === 'clickup' && !want.has(`${l.contact_id}|${l.company_id}`));
  for (const l of stale) {
    await db.remove('frontrow', 'contact_companies', `contact_id=eq.${l.contact_id}&company_id=eq.${l.company_id}&source=eq.clickup`);
  }
  const fresh = pairs.filter((p) => !have.has(`${p.contact_id}|${p.company_id}`)).map((p) => ({ ...p, source: 'clickup' }));
  for (const part of chunk(fresh, 200)) await db.insert('frontrow', 'contact_companies', part);
  return { added: fresh.length, removed: stale.length };
}

function contactRows(contacts, now) {
  const seen = new Set();
  const rows = [];
  for (const c of contacts) {
    if (!c.email || seen.has(c.email)) continue; // first ClickUp entry wins a shared email
    seen.add(c.email);
    rows.push({ email: c.email, full_name: c.name, clickup_contact_id: c.clickupId, synced_at: now });
  }
  return rows;
}

function linkPairs(accounts, contacts, companyIdByAccount, contactIdByClickup) {
  const pairs = new Map();
  const add = (contactCu, accountCu) => {
    const contactId = contactIdByClickup.get(contactCu);
    const companyId = companyIdByAccount.get(accountCu);
    if (contactId && companyId) pairs.set(`${contactId}|${companyId}`, { contact_id: contactId, company_id: companyId });
  };
  for (const a of accounts) for (const cid of a.contactIds) add(cid, a.clickupId);
  for (const c of contacts) for (const aid of c.accountIds) add(c.clickupId, aid);
  return [...pairs.values()];
}

/** Full sync. Records a frontrow.sync_runs row either way. */
export async function runSync({ startedBy = null, db = DB, opts = {} } = {}) {
  const run = (await db.insert('frontrow', 'sync_runs', { started_by: startedBy }))[0];
  const now = new Date().toISOString();
  try {
    const cfg = clickupConfig(opts.env);
    const maps = await loadMaps(db);
    const accounts = (await listTasks(cfg.lists.accounts, opts)).map((t) => readAccount(t, cfg));
    const contacts = (await listTasks(cfg.lists.contacts, opts)).map((t) => readContact(t, cfg));

    const companyRows = [];
    let noOrg = 0;
    for (const a of accounts) {
      const row = companyRow(a, maps, now);
      if (row) companyRows.push(row); else noOrg++;
    }
    const companies = await upsertCompanies(companyRows, db);
    const companyIdByAccount = new Map(companies.map((c) => [c.clickup_account_id, c.id]));

    // Companies that came from ClickUp but are gone from it: switch off.
    const known = await db.select('frontrow', 'companies', 'select=id,clickup_account_id&source=eq.clickup&active=eq.true') || [];
    const vanished = known.filter((c) => c.clickup_account_id && !companyIdByAccount.has(c.clickup_account_id));
    for (const c of vanished) await db.patch('frontrow', 'companies', `id=eq.${c.id}`, { active: false, synced_at: now });

    const rows = contactRows(contacts, now);
    const saved = await upsertContacts(rows, db);
    const contactIdByClickup = new Map(saved.map((c) => [c.clickup_contact_id, c.id]));
    const pairs = linkPairs(accounts, contacts, companyIdByAccount, contactIdByClickup);
    const links = await replaceLinks(saved.map((c) => c.id), pairs, db);

    // Contacts that came from ClickUp but weren't in this fetch (deleted or
    // archived there) or lost their email: their ClickUp links go, so they
    // lose access. Links staff made by hand stay. Skipped if the fetch looks
    // partial, so a ClickUp hiccup can't lock everyone out.
    const fetched = new Set(saved.map((c) => c.clickup_contact_id));
    const fromClickUp = (await db.select('frontrow', 'contacts', 'select=id,clickup_contact_id&limit=50000') || []).filter((c) => c.clickup_contact_id);
    const gone = fromClickUp.filter((c) => !fetched.has(c.clickup_contact_id));
    const partial = saved.length < fromClickUp.length * 0.5;
    let pruned = 0;
    if (!partial) {
      for (const part of chunk(gone.map((c) => c.id), 100)) {
        const stale = await db.select('frontrow', 'contact_companies', `select=contact_id&source=eq.clickup&contact_id=in.(${part.join(',')})`) || [];
        if (stale.length) await db.remove('frontrow', 'contact_companies', `source=eq.clickup&contact_id=in.(${part.join(',')})`);
        pruned += stale.length;
      }
    }

    const counts = {
      accounts: accounts.length,
      companies: companies.length,
      activeCompanies: companies.filter((c) => c.active).length,
      accountsWithoutOrganization: noOrg,
      switchedOff: vanished.length,
      contacts: contacts.length,
      contactsWithoutEmail: contacts.filter((c) => !c.email).length,
      links: pairs.length,
      linksAdded: links.added,
      linksRemoved: links.removed + pruned,
      contactsGoneFromClickUp: gone.length,
      ...(partial ? { goneCheckSkipped: true } : {})
    };
    await db.patch('frontrow', 'sync_runs', `id=eq.${run.id}`, { status: 'ok', finished_at: new Date().toISOString(), counts });
    return { ok: true, runId: run.id, counts };
  } catch (e) {
    await db.patch('frontrow', 'sync_runs', `id=eq.${run.id}`, { status: 'failed', finished_at: new Date().toISOString(), error: String(e.message).slice(0, 500) });
    throw e;
  }
}

/** Imports one ClickUp task — a contact or an account — with what it links
 *  to, for the CRM's "Add to Frontrow" button. Returns the contacts and
 *  companies touched. */
export async function importFromClickUp(clickupId, { db = DB, opts = {} } = {}) {
  const cfg = clickupConfig(opts.env);
  const now = new Date().toISOString();
  const maps = await loadMaps(db);
  const task = await getTask(clickupId, opts);
  const listId = task.list && task.list.id ? String(task.list.id) : '';

  let accounts = [];
  let contacts = [];
  if (listId === cfg.lists.accounts) {
    const acc = readAccount(task, cfg);
    accounts = [acc];
    const people = await Promise.all(acc.contactIds.slice(0, 40).map((id) => getTask(id, opts).catch(() => null)));
    contacts = people.filter((t) => t && String((t.list || {}).id) === cfg.lists.contacts).map((t) => readContact(t, cfg));
  } else if (listId === cfg.lists.contacts) {
    const person = readContact(task, cfg);
    contacts = [person];
    const accs = await Promise.all(person.accountIds.slice(0, 40).map((id) => getTask(id, opts).catch(() => null)));
    accounts = accs.filter((t) => t && String((t.list || {}).id) === cfg.lists.accounts).map((t) => readAccount(t, cfg));
  } else {
    const e = new Error('That ClickUp entry is not in the Contacts or Accounts list. Open the contact (or account) and try again.');
    e.status = 400;
    throw e;
  }

  const rows = accounts.map((a) => companyRow(a, maps, now)).filter(Boolean);
  const companies = rows.length ? await upsertCompanies(rows, db) : [];
  const companyIdByAccount = new Map(companies.map((c) => [c.clickup_account_id, c.id]));
  const saved = contactRows(contacts, now).length ? await upsertContacts(contactRows(contacts, now), db) : [];
  const contactIdByClickup = new Map(saved.map((c) => [c.clickup_contact_id, c.id]));

  // Only add links here; a full sync is what removes stale ones.
  const pairs = linkPairs(accounts, contacts, companyIdByAccount, contactIdByClickup);
  if (pairs.length) {
    const existing = await db.select('frontrow', 'contact_companies',
      `select=contact_id,company_id&contact_id=in.(${[...new Set(pairs.map((p) => p.contact_id))].join(',')})`) || [];
    const have = new Set(existing.map((l) => `${l.contact_id}|${l.company_id}`));
    const fresh = pairs.filter((p) => !have.has(`${p.contact_id}|${p.company_id}`)).map((p) => ({ ...p, source: 'clickup' }));
    if (fresh.length) await db.insert('frontrow', 'contact_companies', fresh);
  }

  return {
    kind: listId === cfg.lists.accounts ? 'account' : 'contact',
    contactIds: saved.map((c) => c.id),
    companyIds: companies.map((c) => c.id),
    skipped: {
      contactsWithoutEmail: contacts.filter((c) => !c.email).map((c) => c.name),
      accountsWithoutOrganization: accounts.filter((a) => !companyRow(a, maps, now)).map((a) => a.name)
    }
  };
}
