// api/_lib/senders.ts
//
// Which Resend account sends for which domain.
//
// A Resend API key can only send from domains verified in its own
// account, and MKC's domains are spread over several accounts. Email
// goes out as the signed-in team member's own address (their MKC Public
// Email), so the key is chosen by that address's domain.
//
// Each account's key is a Vercel environment variable on this project,
// RESEND_KEY_<letter> (mark it Sensitive). The letters are only labels;
// which Resend login each one is lives with whoever manages the keys,
// not in this public repo.
//
// Adding a domain: verify it in one of the accounts in Resend, then add
// it to that account's list below. A brand-new account gets a new letter
// and its own RESEND_KEY_<letter> variable.

export const RESEND_ACCOUNTS: Record<string, string[]> = {
  A: ['jtgworkspace.com', 'befortune5.com', 'buildmystart-up.com'],
  B: ['mkholdinco.com', 'j-tgroup.com', 'wearepartydesigners.com'],
  C: ['bcm.mambaykanu.com', 'apply1234.com', 'mambaykanu.com'],
  D: ['go-unybase.unywebs.com', 'unywebs.com'],
  E: ['fortune5ceo.com'],
};

type Env = Record<string, string | undefined>;

export type SenderKey =
  | { ok: true; key: string; account: string; domain: string; variable: string }
  | { ok: false; status: number; error: string };

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0 ? '' : email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
}

export function accountFor(domain: string): string | null {
  // Exact match only: Resend verifies each subdomain on its own, so
  // verifying unywebs.com does not let x@go-unybase.unywebs.com send.
  for (const [account, domains] of Object.entries(RESEND_ACCOUNTS)) {
    if (domains.includes(domain)) return account;
  }
  return null;
}

/** The Resend key that can send as `email`, or why there isn't one. */
export function resendKeyFor(email: string, env: Env): SenderKey {
  const domain = domainOf(email);
  if (!domain) return { ok: false, status: 400, error: `"${email}" isn't an email address.` };
  const account = accountFor(domain);
  if (!account) {
    return {
      ok: false,
      status: 400,
      error: `Email can't be sent from ${domain} yet: it isn't in any of MKC's Resend accounts. Verify the domain in Resend, then add it to the sender list.`,
    };
  }
  const variable = `RESEND_KEY_${account}`;
  // RESEND_API_KEY is the single key this project used before accounts
  // were split. It stays as a fallback so sends keep working until each
  // account's own key is in place.
  const key = env[variable] || env.RESEND_API_KEY || '';
  if (!key) {
    return { ok: false, status: 500, error: `${variable} is not set on this Vercel project (it sends for ${domain}).` };
  }
  return { ok: true, key, account, domain, variable: env[variable] ? variable : 'RESEND_API_KEY' };
}
