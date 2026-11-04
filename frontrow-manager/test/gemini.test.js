import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiConfig, classifyFailure, extractHtml, draftWithGemini, DEFAULT_MODEL } from '../lib/gemini.js';

const PAGE = '<!doctype html><html><body><h1>Hi</h1></body></html>';
const reply = (text, status = 200) => async () => new Response(
  status === 200 ? JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) : text, { status });

test('no key, or the switch, means paused', () => {
  assert.deepEqual(geminiConfig({}), { key: '', model: DEFAULT_MODEL, available: false, reason: 'no_key' });
  assert.equal(geminiConfig({ GEMINI_API_KEY: 'k', GEMINI_PAUSED: 'true' }).reason, 'switched_off');
  assert.equal(geminiConfig({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-x' }).model, 'gemini-x');
  assert.equal(geminiConfig({ GEMINI_API_KEY: 'k' }).available, true);
});

test('billing and quota failures read as paused; other failures as errors', () => {
  assert.equal(classifyFailure(429, ''), 'paused');
  assert.equal(classifyFailure(403, '{"error":{"status":"PERMISSION_DENIED"}}'), 'paused');
  assert.equal(classifyFailure(400, 'API key not valid'), 'paused');
  assert.equal(classifyFailure(400, 'BILLING_DISABLED'), 'paused');
  assert.equal(classifyFailure(500, 'internal'), 'error');
  assert.equal(classifyFailure(400, 'Invalid JSON payload'), 'error');
});

test('extracts the document from fences and chatter', () => {
  assert.equal(extractHtml('Sure!\n```html\n' + PAGE + '\n```\nEnjoy'), PAGE);
  assert.equal(extractHtml('Here you go: ' + PAGE + ' hope it helps'), PAGE);
});

test('paused without calling Google when there is no key', async () => {
  let called = false;
  const r = await draftWithGemini('p', { env: {}, fetchImpl: async () => { called = true; } });
  assert.equal(r.ok, false); assert.equal(r.paused, true); assert.equal(called, false);
});

test('sends the key in a header, never the URL, and returns the page', async () => {
  let seen;
  const r = await draftWithGemini('prompt', {
    env: { GEMINI_API_KEY: 'secret-key' },
    fetchImpl: async (url, init) => { seen = { url, init }; return reply('```html\n' + PAGE + '\n```')(); }
  });
  assert.equal(r.ok, true); assert.equal(r.html, PAGE);
  assert.doesNotMatch(seen.url, /secret-key/);
  assert.equal(seen.init.headers['x-goog-api-key'], 'secret-key');
  assert.equal(JSON.parse(seen.init.body).contents[0].parts[0].text, 'prompt');
});

test('quota exhaustion comes back as paused; a reply with no page as an error', async () => {
  const env = { GEMINI_API_KEY: 'k' };
  assert.equal((await draftWithGemini('p', { env, fetchImpl: reply('RESOURCE_EXHAUSTED', 429) })).paused, true);
  const r = await draftWithGemini('p', { env, fetchImpl: reply('I cannot help with that.') });
  assert.equal(r.ok, false); assert.equal(r.paused, false);
});

test('a hung request times out with a useful message', async () => {
  const r = await draftWithGemini('p', {
    env: { GEMINI_API_KEY: 'k' }, timeoutMs: 20,
    fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  });
  assert.equal(r.ok, false); assert.match(r.message, /too long/);
});
