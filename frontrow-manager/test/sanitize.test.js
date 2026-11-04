import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, asDocument, VIEW_HEADERS } from '../lib/sanitize.js';

const bad = [
  ['script', '<p>a</p><script>alert(1)</script>', /script/i],
  ['spliced script', '<scr<script></script>ipt>alert(1)</script>', /<script/i],
  ['handler', '<img src="x.png" onerror="alert(1)">', /onerror/i],
  ['unquoted handler', '<div onclick=alert(1)>x</div>', /onclick/i],
  ['javascript href', '<a href="javascript:alert(1)">x</a>', /javascript/i],
  ['entity-encoded scheme', '<a href="&#106;avascript&colon;alert(1)">x</a>', /href/i],
  ['tab inside scheme', '<a href="java\tscript:alert(1)">x</a>', /href/i],
  ['srcset', '<img srcset="ok.png 1x, javascript:alert(1) 2x">', /srcset/i],
  ['data html', '<a href="data:text/html,<b>x</b>">x</a>', /href/i],
  ['scheme hidden behind a quoted >', '<a href="javascript:alert(1)//>">x</a>', /javascript/i],
  ['handler after a quoted >', '<img alt=">" src="x.png" onerror="alert(1)">', /onerror/i],
  ['iframe', '<iframe src="https://evil.example"></iframe>', /iframe/i],
  ['form', '<form action="https://evil.example"><input name=p></form>', /<form/i],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">', /http-equiv/i],
  ['svg animate href', '<svg><a><animate attributeName="href" to="javascript:alert(1)"/></a></svg>', /animate/i],
  ['base', '<base href="https://evil.example/">', /<base/i],
  ['tag after a comment that hides a quote', '<!-- <a title=" --><a href="javascript:alert(1)">x</a><!-- " -->', /javascript/i],
  ['tag after CSS with a quote in it', '<style>a[title="</style><a href=\'javascript:alert(1)\'>x</a><style>"]{}</style>', /javascript/i],
  ['tag after a bogus comment', '<!x <a title=">"><a href="javascript:alert(1)">x</a>', /javascript/i],
  ['uppercase and spaced end tag', '<SCRIPT>alert(1)</SCRIPT >after', /alert/i],
  ['unterminated tag', '<p>kept</p><img src=x onerror="alert(1)', /onerror|<img/i],
  // SVG foreign content: <style> there is markup, but these all return to HTML first.
  ['font breakout from svg', '<svg><font color=red><style><a title="</style><img src=x onerror=alert(1)>">', /onerror/i],
  ['</p> breakout from svg', '<svg></p><style><a title="</style><img src=x onerror=alert(1)>">', /onerror/i],
  ['svg desc integration point', '<svg><desc><style><a title="</style><img src=x onerror=alert(1)>">', /onerror/i],
  ['nested svg in foreignObject', '<svg><foreignObject><svg><style><img src=x onerror=alert(1)></style>', /onerror/i]
];

test('linear time on hostile input (2 MB in well under a second each)', () => {
  for (const s of ['<a "'.repeat(500000), '<script>'.repeat(250000), '<!--'.repeat(500000), '<!---->'.repeat(300000),
    '<a b=c '.repeat(250000), '<svg>'.repeat(200000) + '</x>'.repeat(200000), '<style>'.repeat(250000)]) {
    const t = performance.now();
    sanitizeHtml(s);
    assert.ok(performance.now() - t < 1500, 'took too long');
  }
});

test('keeps the doctype, text containing "<", and content before an unterminated tag', () => {
  assert.equal(sanitizeHtml('<!doctype html><p>1 < 2</p>'), '<!doctype html><p>1 < 2</p>');
  assert.equal(sanitizeHtml('<p>kept</p><img src="x'), '<p>kept</p>');
});

for (const [name, input, mustNotMatch] of bad) {
  test(`removes ${name}`, () => assert.doesNotMatch(sanitizeHtml(input), mustNotMatch));
}

test('keeps ordinary page content, inline styles, svg charts and data: images', () => {
  const page = '<!doctype html><html><head><style>h1{color:#2E3192}</style></head><body><h1>Results</h1>' +
    '<p>Leads up <strong>32%</strong> — see <a href="https://example.com/report">report</a>.</p>' +
    '<svg viewBox="0 0 10 10"><rect width="5" height="10" fill="#2E3192"/></svg>' +
    '<img src="data:image/png;base64,iVBORw0KGgo=" alt="chart"></body></html>';
  // The only change: the outbound link opens in a new tab.
  assert.equal(sanitizeHtml(page), page.replace('href="https://example.com/report">', 'href="https://example.com/report" target="_blank" rel="noopener noreferrer">'));
});

test('external links open in a new tab; in-page anchors and explicit targets are left alone', () => {
  assert.equal(sanitizeHtml('<a href="mailto:a@b.co">x</a>'), '<a href="mailto:a@b.co" target="_blank" rel="noopener noreferrer">x</a>');
  assert.equal(sanitizeHtml('<a href="#step-3">x</a>'), '<a href="#step-3">x</a>');
  assert.equal(sanitizeHtml('<a href="https://x.co" target="_self">x</a>'), '<a href="https://x.co" target="_self">x</a>');
});

test('asDocument wraps fragments but leaves full documents alone', () => {
  assert.match(asDocument('<p>Hi</p>', 'T<itle>'), /^<!doctype html>.*<title>Title<\/title>.*<main><p>Hi<\/p><\/main>/s);
  const full = '<!doctype html><html><body>x</body></html>';
  assert.equal(asDocument(full), full);
});

test('view headers sandbox the page and allow only same-origin framing', () => {
  const csp = VIEW_HEADERS['Content-Security-Policy'];
  assert.match(csp, /^sandbox allow-popups allow-popups-to-escape-sandbox;/);
  assert.doesNotMatch(csp, /allow-scripts|allow-same-origin|allow-forms|allow-top-navigation/);
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /script-src/);
  assert.match(csp, /frame-ancestors 'self'/);
});
