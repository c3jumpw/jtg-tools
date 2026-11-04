import { createHash, randomBytes } from 'node:crypto';
import { insert, patch, UUID_RE } from './core.js';

/* One-time account links. Shared by Frontrow and Frontrow Manager (copied).
 *
 *   setup  create a password. Staff-generated links last 7 days (they are
 *          often sent in a welcome message); self-requested ones 60 minutes.
 *   reset  forgot password, 60 minutes.
 *
 * Issuing a new link cancels any unused link of the same kind for that
 * contact, so only the latest one works. Only SHA-256 hashes are stored.
 * The raw token travels in the URL #fragment, which never reaches a server
 * log, and is spent by a POST from the page — not by opening the link.
 */

export const TTL = {
  staffSetup: 7 * 24 * 60 * 60 * 1000,
  selfSetup: 60 * 60 * 1000,
  reset: 60 * 60 * 1000
};

export const hashToken = (raw) => createHash('sha256').update(raw).digest('hex');
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export async function issueAccountToken(contactId, purpose, { orgId = null, createdBy = null, ttlMs, ip = null } = {}, db = { insert, patch }) {
  if (!UUID_RE.test(String(contactId || ''))) throw new Error('issueAccountToken: bad contact id');
  if (!['setup', 'reset'].includes(purpose)) throw new Error('issueAccountToken: bad purpose');
  const now = Date.now();
  await db.patch('frontrow', 'account_tokens',
    `contact_id=eq.${contactId}&purpose=eq.${purpose}&used_at=is.null`,
    { expires_at: new Date(now - 1000).toISOString() });
  const raw = randomBytes(32).toString('base64url');
  await db.insert('frontrow', 'account_tokens', {
    token_hash: hashToken(raw),
    contact_id: contactId,
    purpose,
    organization_id: orgId,
    created_by_person_id: createdBy,
    expires_at: new Date(now + (ttlMs || TTL.selfSetup)).toISOString(),
    ip
  });
  return raw;
}

/** The link a contact opens: the organization's sign-in page with the token
 *  in the fragment (#setup=…, #reset=…, #request=…).
 *
 *  Always on Frontrow's own address (FRONTROW_URL/<slug>), never an
 *  organization's custom domain: a custom domain is typed in by staff, and a
 *  wrong or hostile one must not be able to receive account tokens. */
export function accountLink(org, kind, raw, env = process.env) {
  const site = (env.FRONTROW_URL || 'https://frontrow.jtgworkspace.com').replace(/\/$/, '');
  return `${org ? `${site}/${org.slug}` : `${site}/signin`}#${kind}=${raw}`;
}
