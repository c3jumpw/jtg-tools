// Checks the CRM's change log (mkc-crm/changelog.json). Fails (exit 1) when:
//   - an entry is malformed: missing title/summary, unknown type or audience,
//     a date that isn't YYYY-MM-DD, a repeated id, or out of date order;
//   - an entry points at a tour slide that doesn't exist;
//   - the CRM changed after the newest entry: the last commit touching
//     mkc-crm/index.html, mkc-crm/changelog.json's app or api/ is newer than
//     the newest entry. Add an entry (see CLAUDE.md), or put
//     "[no changelog]" in the commit message for a change nobody would
//     notice (a comment, a typo in code).
//
//   node changelog/check.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const FILE = path.join(ROOT, 'mkc-crm', 'changelog.json');
const APP = path.join(ROOT, 'mkc-crm', 'index.html');
const TYPES = ['new', 'improved', 'fixed', 'security', 'baseline'];
const AUDIENCES = ['everyone', 'admin', 'super'];
const problems = [];

let data;
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { console.error('changelog.json is not valid JSON: ' + e.message); process.exit(1); }
const entries = data.entries || [];
if (!entries.length) problems.push('changelog.json has no entries.');

const slides = new Set([...fs.readFileSync(APP, 'utf8').matchAll(/\{id:'([a-z0-9-]+)',deck:'/g)].map(m => m[1]));
const ids = new Set();
let prev = '';
for (const [i, e] of entries.entries()) {
  const at = `entry ${i + 1}${e.id ? ` (${e.id})` : ''}`;
  if (!e.id || !/^[a-z0-9-]+$/.test(e.id)) problems.push(`${at}: needs an id of lower-case letters, digits and dashes.`);
  else if (ids.has(e.id)) problems.push(`${at}: id is used twice.`);
  ids.add(e.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') || isNaN(Date.parse(e.date))) problems.push(`${at}: date must be YYYY-MM-DD.`);
  else { if (e.date < prev) problems.push(`${at}: dated ${e.date}, before the entry above it (${prev}); keep the file oldest first.`); prev = e.date; }
  if (!TYPES.includes(e.type)) problems.push(`${at}: type must be one of ${TYPES.join(', ')}.`);
  if (!AUDIENCES.includes(e.audience)) problems.push(`${at}: audience must be one of ${AUDIENCES.join(', ')}.`);
  if (typeof e.announce !== 'boolean') problems.push(`${at}: announce must be true or false.`);
  if (!e.title || !e.summary) problems.push(`${at}: needs a title and a summary.`);
  if (e.details && !Array.isArray(e.details)) problems.push(`${at}: details must be a list.`);
  for (const s of e.slides || []) if (!slides.has(s)) problems.push(`${at}: slide "${s}" isn't in GUIDE_STEPS.`);
}

// Has the CRM changed since the newest entry?
const newest = entries.reduce((m, e) => (e.date > m ? e.date : m), '');
try {
  const out = execFileSync('git', ['log', '-1', '--format=%cs%x09%h%x09%s', '--', 'mkc-crm/index.html', 'api/'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (out) {
    const [when, sha, subject] = out.split('\t');
    // A day's grace: commits are stamped in UTC, entries in local dates.
    const grace = new Date(Date.parse(newest) + 864e5).toISOString().slice(0, 10);
    if (when > grace && !/\[no changelog\]/i.test(subject)) problems.push(`The CRM changed on ${when} (${sha} "${subject}") but the newest change-log entry is from ${newest}. Add an entry to mkc-crm/changelog.json.`);
  }
} catch (e) {
  console.warn('(git history not available; skipped the "changed since the newest entry" check)');
}

if (problems.length) { console.error(`Change-log check failed (${problems.length}):\n- ` + problems.join('\n- ')); process.exit(1); }
console.log(`Change-log check passed: ${entries.length} entries, newest ${newest}.`);
