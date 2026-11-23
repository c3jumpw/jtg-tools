import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendEmail, clientFrom } from '../lib/mail.js';

// Client emails come from the client app's address; team sign-in links keep
// the Manager's own FROM_EMAIL (lib/emails.js).
test('client emails use CLIENT_FROM_EMAIL, else FROM_EMAIL', async () => {
  assert.equal(clientFrom({ FROM_EMAIL: 'M <signin@frontrow-manager.example>' }), 'M <signin@frontrow-manager.example>');
  const env = { RESEND_API_KEY: 'k', FROM_EMAIL: 'M <signin@frontrow-manager.example>', CLIENT_FROM_EMAIL: 'F <portal@frontrow.example>' };
  let sent;
  const err = await sendEmail({ to: 'pat@acme.test', subject: 's', html: 'h', text: 't' }, env,
    async (_url, opts) => { sent = JSON.parse(opts.body); return { ok: true }; });
  assert.equal(err, null);
  assert.equal(sent.from, 'F <portal@frontrow.example>');
});

test('no sender address means not configured', async () => {
  const err = await sendEmail({ to: 'pat@acme.test', subject: 's', html: 'h', text: 't' }, { RESEND_API_KEY: 'k' }, async () => ({ ok: true }));
  assert.match(err, /not configured/);
});
