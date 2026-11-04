import { randomBytes } from 'node:crypto';
import { insert, json, clean, EMAIL_RE, rateLimited, clientIp, originAllowed, readJson, route, atLeast } from '../lib/core.js';
import { hashToken, getAccessRole } from '../lib/auth.js';
import { magicLinkEmail, sendEmail } from '../lib/emails.js';

const SITE_URL = () => (process.env.SITE_URL || 'https://frontrow-manager.jtgworkspace.com').replace(/\/$/, '');

export default route(async (request) => {
  if (!originAllowed(request)) return json(403, { error: 'Not allowed.' });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const ip = clientIp(request);
  if (rateLimited(`pm-al:${ip}`, 6, 60 * 60_000)) return json(429, { error: 'Too many requests. Please try again later.' });

  const { body, error } = await readJson(request, 4096);
  if (error) return error;
  const email = clean(body.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return json(400, { error: 'Please check your email address.' });
  if (rateLimited(`pm-ale:${email}`, 5, 60 * 60_000)) return json(429, { error: 'Too many links requested for that address. Try again in an hour.' });

  // Same answer, in about the same time, whether or not the address has
  // access, so this form cannot be used to discover who is on the team.
  const started = Date.now();
  const generic = async () => { await atLeast(1500, started); return json(200, { ok: true, message: 'If that email has Frontrow Manager access, a sign-in link is on the way.' }); };
  if (!(await getAccessRole(email))) return generic();

  const raw = randomBytes(24).toString('base64url');
  // Token in the #fragment: never sent to a server, so it stays out of logs
  // and link scanners can't spend it (see api/auth-callback.js).
  const link = `${SITE_URL()}/#signin=${raw}`;
  try {
    await insert('core', 'magic_links', { token_hash: hashToken(raw), email, ip });
  } catch (e) {
    console.error('magic_links insert failed', e.message);
    return json(500, { error: 'Couldn’t send a link right now. Please try again.' });
  }
  const err = await sendEmail({
    to: email,
    ...magicLinkEmail({ url: link, siteUrl: SITE_URL(), email, ip }),
    key: `pm-ml-${hashToken(raw).slice(0, 24)}`
  });
  if (err) { console.error('magic link email failed', err); return json(500, { error: 'Couldn’t send the email. Please try again.' }); }
  return generic();
});
