import { select, json, UUID_RE } from './core.js';
import { visibleCompanyIds } from './access.js';
import { activeCompaniesFor, orgsByIds, pickOrgId, portalBase } from './directory.js';
import { issueAccountToken, accountLink, TTL } from './tokens.js';
import { setupEmail, resetEmail, sendEmail } from './mail.js';
import { comment } from './clickup.js';
import { audit } from './pipeline.js';

/* Staff-side account links: "Copy setup link" and "Email setup link".
 *
 * A link can only be made for a contact who is eligible right now (linked
 * to at least one active company) and whom this staff member can see. If
 * the contact already has a password, the link is a reset link instead, so
 * "send them a link" always works. Every link is noted on the contact's
 * ClickUp entry and in the audit log.
 *
 * Whoever holds a link can set the password, so a link is only handed to
 * staff (Copy link) when it can't be used to get into someone else's
 * account: never a reset link (those are emailed to the person), and a setup
 * link only when this staff member can see every client the contact
 * belongs to. Emailed links go to the contact's own address, so they're fine
 * for anyone who can see the contact.
 */

export async function loadContact(contactId) {
  if (!UUID_RE.test(String(contactId || ''))) throw json(400, { error: 'Choose a contact.' });
  const rows = await select('frontrow', 'contacts', `select=id,email,full_name,clickup_contact_id,active&id=eq.${contactId}`);
  if (!rows || !rows[0]) throw json(404, { error: 'Contact not found.' });
  return rows[0];
}

/** Throws 404 unless the session can see at least one of the contact's companies. */
export async function requireVisibleContact(session, contactId) {
  const contact = await loadContact(contactId);
  const ids = await visibleCompanyIds(session);
  if (ids !== null) {
    const links = await select('frontrow', 'contact_companies', `select=company_id&contact_id=eq.${contact.id}`) || [];
    if (!links.some((l) => ids.includes(l.company_id))) throw json(404, { error: 'Contact not found.' });
  }
  return contact;
}

export async function accountFor(contactId) {
  const rows = await select('frontrow', 'accounts', `select=contact_id,status,activated_at,last_sign_in_at,locked_until,password_hash&contact_id=eq.${contactId}`);
  const a = rows && rows[0];
  if (!a) return null;
  return { status: a.status, hasPassword: Boolean(a.password_hash), activatedAt: a.activated_at, lastSignInAt: a.last_sign_in_at, lockedUntil: a.locked_until };
}

export async function inviteContact(session, contactId, { companyId = null, send = false } = {}) {
  const contact = await requireVisibleContact(session, contactId);
  if (contact.active === false) throw json(409, { error: 'This contact is switched off.' });
  const companies = await activeCompaniesFor(contact.id);
  if (!companies.length) {
    throw json(409, { error: 'Not eligible yet: this contact isn’t linked to an active account. In ClickUp, link them to an account whose Account Status is Active, then sync.', code: 'not_eligible' });
  }
  const preferred = companyId && companies.find((c) => c.id === companyId) ? companies.find((c) => c.id === companyId).organizationId : null;
  const [org] = await orgsByIds([pickOrgId(companies, preferred)]);
  if (!org) throw json(409, { error: 'This contact’s company has no organization.' });

  const account = await accountFor(contact.id);
  if (account && account.status === 'disabled') throw json(409, { error: 'This account is switched off. Switch it back on first.' });
  const purpose = account && account.hasPassword ? 'reset' : 'setup';
  const visible = await visibleCompanyIds(session);
  const mayCopy = purpose === 'setup' && (visible === null || companies.every((c) => visible.includes(c.id)));
  if (!send && !mayCopy) {
    throw json(purpose === 'reset' ? 409 : 403, {
      error: purpose === 'reset'
        ? 'They already have a password, so the link can only be emailed to them. Use Email reset link.'
        : 'This person is also on clients you don’t manage, so the link can only be emailed to them. Use Email setup link.',
      code: 'email_only'
    });
  }
  const raw = await issueAccountToken(contact.id, purpose, {
    orgId: org.id,
    createdBy: session.personId || null,
    ttlMs: purpose === 'setup' ? TTL.staffSetup : TTL.reset
  });
  const url = accountLink(org, purpose, raw);

  let sent = false;
  if (send) {
    const staffName = session.fullName && !session.fullName.includes('@') ? session.fullName : '';
    const mail = purpose === 'setup'
      ? setupEmail({ org, url, name: contact.full_name, invitedBy: staffName, days: 7 })
      : resetEmail({ org, url });
    const err = await sendEmail({ to: contact.email, ...mail });
    if (err) {
      console.error('invite email failed', err);
      throw json(502, mayCopy
        ? { error: 'The link was made but the email didn’t send. Copy the link instead.', url }
        : { error: 'The email didn’t send. Try again in a few minutes.' });
    }
    sent = true;
  }
  const what = purpose === 'setup' ? 'setup link' : 'password reset link';
  await comment(contact.clickup_contact_id,
    `Frontrow: ${what} ${sent ? `emailed to ${contact.email}` : `created for ${contact.email}`} by ${session.fullName || session.email} (${org.name} portal, ${portalBase(org)}).`);
  await audit(session, sent ? 'account.invite_email' : 'account.invite_link', contact.id, { purpose, organization: org.slug });
  return { url, sent, purpose, organization: org.slug, expiresInDays: purpose === 'setup' ? 7 : null };
}

/** Contacts with their companies and sign-in status, for screens that show
 *  a handful of people (the CRM "Add to Frontrow" landing). */
export async function describeContacts(contactIds) {
  const ids = [...new Set(contactIds)].filter((id) => UUID_RE.test(String(id)));
  if (!ids.length) return [];
  const people = await select('frontrow', 'contacts', `select=id,email,full_name,clickup_contact_id,active&id=in.(${ids.join(',')})`) || [];
  const links = await select('frontrow', 'contact_companies',
    `select=contact_id,source,companies(id,name,active,organization_id,clickup_status)&contact_id=in.(${ids.join(',')})`) || [];
  const out = [];
  for (const p of people) {
    const companies = links.filter((l) => l.contact_id === p.id && l.companies).map((l) => ({
      id: l.companies.id, name: l.companies.name, active: l.companies.active, organizationId: l.companies.organization_id,
      clickupStatus: l.companies.clickup_status, source: l.source
    }));
    out.push({
      contactId: p.id, email: p.email, fullName: p.full_name, clickupContactId: p.clickup_contact_id, active: p.active,
      eligible: p.active !== false && companies.some((c) => c.active),
      companies,
      account: await accountFor(p.id)
    });
  }
  return out;
}
