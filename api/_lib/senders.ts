// api/_lib/senders.ts
//
// Which Resend account sends for which domain.
//
// A Resend API key can only send from domains verified in its own
// account, and MKC's domains are spread over several accounts (each
// holds a few). Email goes out as the signed-in team member's own
// address (their MKC Public Email), so the key is chosen by that
// address's domain.
//
// Keys: one Vercel environment variable per Resend account on this
// project, RESEND_API_KEY_<letter> (RESEND_KEY_<letter> is read too),
// marked Sensitive. The letters are only labels.
//
// Finding the right key: the CRM asks Resend which domains each key's
// account has verified (GET /domains), so adding a domain or a whole
// new account needs no code change:
//   - new domain: verify it in any account whose key is set here.
//   - new account: add its key as the next RESEND_API_KEY_<letter> in
//     Vercel, then redeploy.
// That lookup needs keys with "Full access" in Resend. A "Sending
// access" key can't list domains; for those accounts the list below is
// used instead, so keep it current for them.

export const RESEND_ACCOUNTS: Record<string, string[]> = {
  // jtgworkspace.com was retired on 2026-11-22; mkcworkspace.com replaced it in the same account.
  // Only domains people's MKC emails use belong here. Frontrow's sending
  // subdomains (frontrow. / frontrow-manager.mkcworkspace.com) are set on the
  // Frontrow projects, not here.
  A: ['mkcworkspace.com', 'befortune5.com', 'buildmystart-up.com'],
  B: ['mkholdinco.com', 'j-tgroup.com', 'wearepartydesigners.com'],
  C: ['bcm.mambaykanu.com', 'apply1234.com', 'mambaykanu.com'],
  D: ['go-unybase.unywebs.com', 'unywebs.com'],
  E: ['fortune5ceo.com'],
  // F, G, H: keys are set; their domains are found from Resend.
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const CACHE_MS = 10 * 60_000;

type Env = Record<string, string | undefined>;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type SenderKey =
  | { ok: true; key: string; account: string; domain: string; variable: string; how: 'resend' | 'list' | 'fallback' }
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

/** Every Resend key set on this project, by account letter. */
export function configuredKeys(env: Env): { account: string; variable: string; key: string }[] {
  const out: { account: string; variable: string; key: string }[] = [];
  for (const L of LETTERS) {
    for (const variable of [`RESEND_API_KEY_${L}`, `RESEND_KEY_${L}`]) {
      const key = (env[variable] || '').trim();
      if (key) { out.push({ account: L, variable, key }); break; }
    }
  }
  return out;
}

// key -> { at, domains }  (domains null when the key can't list them)
const cache = new Map<string, { at: number; domains: string[] | null }>();

/** Verified domains of the key's Resend account, or null if it can't say. */
export async function verifiedDomains(key: string, fetchImpl: Fetch = fetch, now = Date.now()): Promise<string[] | null> {
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.domains;
  try {
    const res = await fetchImpl('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) {
      const body = await res.json() as { data?: { name?: string; status?: string }[] };
      const domains = (body.data || [])
        .filter((d) => d && d.name && (!d.status || d.status === 'verified'))
        .map((d) => String(d.name).toLowerCase());
      cache.set(key, { at: now, domains });
      return domains;
    }
    // A sending-only key can't list domains: remember that. Anything else
    // (rate limit, outage) is retried next time.
    if (res.status === 401 || res.status === 403) cache.set(key, { at: now, domains: null });
  } catch {
    // network trouble: fall through to the list
  }
  return null;
}

export function clearSenderCache(): void { cache.clear(); }

/** The Resend key that can send as `email`, or why there isn't one. */
export async function resendKeyFor(email: string, env: Env, fetchImpl: Fetch = fetch): Promise<SenderKey> {
  const domain = domainOf(email);
  if (!domain) return { ok: false, status: 400, error: `"${email}" isn't an email address.` };
  const keys = configuredKeys(env);

  // 1) Ask Resend which account has the domain verified.
  const lists = await Promise.all(keys.map((k) => verifiedDomains(k.key, fetchImpl)));
  const found = keys.findIndex((_, i) => (lists[i] || []).includes(domain));
  if (found >= 0) {
    const k = keys[found];
    return { ok: true, key: k.key, account: k.account, domain, variable: k.variable, how: 'resend' };
  }

  // 2) The list above, for accounts whose key can't list domains.
  const account = accountFor(domain);
  if (account) {
    const k = keys.find((x) => x.account === account);
    if (k) return { ok: true, key: k.key, account, domain, variable: k.variable, how: 'list' };
  }

  // 3) RESEND_API_KEY: the single key from before accounts were split.
  if (env.RESEND_API_KEY) {
    return { ok: true, key: env.RESEND_API_KEY, account: account || '?', domain, variable: 'RESEND_API_KEY', how: 'fallback' };
  }

  if (account) {
    return { ok: false, status: 500, error: `RESEND_API_KEY_${account} is not set on this Vercel project (it sends for ${domain}).` };
  }
  return {
    ok: false,
    status: 400,
    error: `Email can't be sent from ${domain} yet: none of MKC's Resend accounts on this project has it verified. Verify the domain in Resend, in an account whose key is set here as RESEND_API_KEY_<letter>.`,
  };
}
