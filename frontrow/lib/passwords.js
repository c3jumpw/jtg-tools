import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';

/* Client passwords.
 *
 * scrypt (memory-hard, in Node's standard library — no dependency) with a
 * random 16-byte salt per password. Stored as
 *   scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>
 * so the cost can be raised later without breaking existing passwords.
 */

const N = 16384, R = 8, P = 1, KEYLEN = 32;

function scrypt(password, salt, n, r, p) {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password).normalize('NFKC'), salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  let key;
  try {
    key = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
  } catch { return false; }
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Hash of a random password, made once per instance. Checking a guess for
// an email that has no account against it takes the same time as a real
// check, so response time doesn't reveal which emails have accounts.
let dummy = null;
export async function burnTime(password) {
  if (!dummy) dummy = await hashPassword(randomBytes(18).toString('base64'));
  await verifyPassword(password, dummy);
  return false;
}

const COMMON = new Set(['password', 'password1', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'iloveyou12',
  'letmein123', 'welcome123', 'abc1234567', 'passw0rd123', 'qwerty1234', '1q2w3e4r5t', 'admin12345', 'changeme123']);

/** A plain-English reason the password won't do, or null when it's fine. */
export function passwordProblem(password, email = '') {
  const pw = String(password || '');
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'Keep it under 200 characters.';
  if (/^(.)\1+$/.test(pw)) return 'Use more than one repeated character.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Pick something only you would use.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'Don’t include your email address in your password.';
  return null;
}
