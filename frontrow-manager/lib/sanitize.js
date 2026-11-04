/* Cleans update HTML before it is stored.
 *
 * This is the SECOND line of defence, not the first. Update pages are only
 * ever served from /api/view with `Content-Security-Policy: sandbox` and no
 * script source, so a page that slips past this filter still cannot run code,
 * submit forms, or reach the portal's origin. No hand-written filter matches
 * a browser's parser in every corner (SVG/MathML foreign content above all),
 * and this one is not relied on as if it did.
 *
 * What it buys: stored content stays clean and predictable, and pages written
 * by any future path (an MCP server, a bulk import) are held to the same rules
 * as pages written in the composer.
 *
 * It is a single left-to-right pass that reads tags the way browsers do —
 * quoted attribute values may contain ">", comments and raw-text elements
 * are skipped as units, and SVG content is tracked with a namespace stack so
 * <style> inside SVG is parsed as markup but HTML breakouts end it. Every
 * forward search ("-->", "</style", …) is cached, so the pass stays linear
 * on hostile input (a 2 MB paste of empty comments or unclosed tags).
 *
 * Links to other sites get target="_blank": pages are shown in a sandbox
 * where a link can't navigate the frame usefully, but may open a new tab.
 */

// Removed together with everything up to their end tag. If the end tag is
// missing, browsers treat the rest of the document as their content, so the
// rest is dropped too.
const DROP_WITH_CONTENT = new Set(['script', 'iframe', 'noscript', 'noembed', 'noframes', 'xmp', 'template',
  'frameset', 'object', 'applet', 'form', 'math', 'portal', 'plaintext']);
// Removed as single tags (void elements, or controls that only work in forms).
const DROP_TAG = new Set(['frame', 'embed', 'base', 'link', 'input', 'button', 'select', 'option', 'keygen', 'param']);
// Contents are text to the browser, not markup (outside SVG).
const RAW_TEXT = new Set(['style', 'textarea', 'title']);
// SVG elements whose children are parsed as HTML again ("integration points").
const SVG_HTML_POINTS = new Set(['foreignobject', 'desc', 'title']);
// HTML start tags that end SVG foreign content when they appear inside it.
const SVG_BREAKOUT = new Set(['b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em',
  'embed', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol',
  'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var']);

// URL-bearing attributes whose value is checked for dangerous schemes.
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'background',
  'poster', 'srcset', 'imagesrcset', 'data', 'cite', 'longdesc', 'usemap', 'ping', 'lowsrc', 'dynsrc']);

// A data: URL is allowed only for raster/vector images.
const SAFE_DATA = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i;
const DANGEROUS_SCHEME = /^(javascript|vbscript|livescript|mocha|data|file|filesystem|blob)\s*:/i;
const TAG_NAME = /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)?$/i;
const ATTR_NAME = /^[a-z_:][a-z0-9_.:-]*$/i;
const WS = /[\t\n\f\r ]/;

function decodeEntities(s) {
  return s
    .replace(/&#x0*([0-9a-f]{1,6});?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#0*(\d{1,7});?/g, (_, d) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
    .replace(/&colon;/gi, ':').replace(/&tab;/gi, '\t').replace(/&newline;/gi, '\n');
}

function unsafeUrl(value) {
  // Browsers decode entities, then ignore control characters and whitespace
  // inside a scheme ("java\tscript:"), so compare the same way.
  const v = decodeEntities(String(value)).replace(/[\u0000- \u007F]+/g, '');
  if (SAFE_DATA.test(v)) return false;
  return DANGEROUS_SCHEME.test(v);
}

function attrAllowed(name, value) {
  const n = name.toLowerCase();
  if (!ATTR_NAME.test(n)) return false;          // "<script", stray quotes etc. are never real attribute names
  if (n.startsWith('on')) return false;          // event handlers
  if (value === null) return true;
  if (n === 'srcset' || n === 'imagesrcset') {
    return !value.split(',').some((part) => unsafeUrl(part.trim().split(/\s+/)[0] || ''));
  }
  if (URL_ATTRS.has(n)) return !unsafeUrl(value);
  return true;
}

const EXTERNAL_LINK = /^\s*(https?:|mailto:|tel:)/i;

/** Reads a start or end tag beginning at s[i] === '<'.
 *  Returns { name, end, attrs:[{name, value, raw}], selfClosing } or null when
 *  the tag never closes (browsers drop an unterminated tag and everything after). */
function readTag(s, i, isEnd) {
  const n = s.length;
  let j = i + (isEnd ? 2 : 1);
  const nameStart = j;
  while (j < n && !WS.test(s[j]) && s[j] !== '/' && s[j] !== '>') j++;
  const name = s.slice(nameStart, j);
  const attrs = [];
  let selfClosing = false;
  while (j < n) {
    const c = s[j];
    if (c === '>') return { name, end: j + 1, attrs, selfClosing };
    if (WS.test(c)) { j++; continue; }
    if (c === '/') { selfClosing = s[j + 1] === '>'; j++; continue; }
    selfClosing = false;
    const aStart = j;
    j++; // the first character belongs to the name even if it is "="
    while (j < n && !WS.test(s[j]) && s[j] !== '/' && s[j] !== '>' && s[j] !== '=') j++;
    const aName = s.slice(aStart, j);
    let k = j;
    while (k < n && WS.test(s[k])) k++;
    let value = null;
    if (s[k] === '=') {
      k++;
      while (k < n && WS.test(s[k])) k++;
      const q = s[k];
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, k + 1);
        if (close < 0) return null;
        value = s.slice(k + 1, close);
        j = close + 1;
      } else {
        let e = k;
        while (e < n && !WS.test(s[e]) && s[e] !== '>') e++;
        value = s.slice(k, e);
        j = e;
      }
    }
    attrs.push({ name: aName, value, raw: s.slice(aStart, j) });
  }
  return null;
}

/** Index just past the end tag for `name`, searching from `from`, or -1.
 *  `lower` is the whole input lower-cased once, so each search is linear.
 *  Results are cached per name: once a search for "</script" has failed from
 *  some point, it fails from every later point too — which keeps inputs like
 *  200,000 unclosed <script> tags linear instead of quadratic. */
function closer(lower) {
  const memo = new Map();
  return (from, name) => {
    const hit = memo.get(name);
    if (hit && (hit.at === -1 ? true : hit.at >= from) && hit.from <= from) {
      if (hit.at === -1) return -1;
      const gt = lower.indexOf('>', hit.at);
      return gt < 0 ? -1 : gt + 1;
    }
    const re = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'g');
    re.lastIndex = from;
    const m = re.exec(lower);
    memo.set(name, { from, at: m ? m.index : -1 });
    if (!m) return -1;
    const gt = lower.indexOf('>', m.index);
    return gt < 0 ? -1 : gt + 1;
  };
}

/** Next index of `needle` at or after `from`, cached: the answer for a later
 *  `from` is the same until `from` passes it, so repeated calls stay linear. */
function finder(s, needle) {
  let at = -2; // -2: not searched yet; -1: not present from the last search on
  return (from) => {
    if (at === -1) return -1;
    if (at === -2 || at < from) at = s.indexOf(needle, from);
    return at;
  };
}

export function sanitizeHtml(input) {
  const s = String(input == null ? '' : input);
  const lower = s.toLowerCase();
  const findClose = closer(lower);
  const n = s.length;
  let out = '';
  let i = 0;
  // Open SVG elements, innermost last. Inside SVG (and not inside an HTML
  // integration point) <style> is markup, not raw text.
  let ns = [];
  const inSvg = () => ns.length > 0 && !SVG_HTML_POINTS.has(ns[ns.length - 1]);
  const nextCommentEnd = finder(s, '-->');
  const nextCommentBangEnd = finder(s, '--!>');

  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out += s.slice(i); break; }
    out += s.slice(i, lt);
    const next = s[lt + 1] || '';

    // Comments: <!-- ... -->, including the abrupt <!--> and <!--->. Dropped.
    if (s.startsWith('<!--', lt)) {
      if (s.startsWith('<!-->', lt)) { i = lt + 5; continue; }
      if (s.startsWith('<!--->', lt)) { i = lt + 6; continue; }
      const endA = nextCommentEnd(lt + 4);
      const endB = nextCommentBangEnd(lt + 4);
      const end = Math.min(endA < 0 ? Infinity : endA + 3, endB < 0 ? Infinity : endB + 4);
      if (end === Infinity) { i = n; break; } // unterminated comment runs to the end
      i = end;
      continue;
    }
    // <!doctype ...> stays; every other <!...>, <?...> and malformed </...> is a
    // "bogus comment" that browsers end at the first ">". Drop those.
    if (next === '!' || next === '?' || (next === '/' && !/[a-z]/i.test(s[lt + 2] || ''))) {
      const gt = s.indexOf('>', lt + 1);
      if (/^<!doctype[\t\n\f\r >]/i.test(s.slice(lt, lt + 10))) out += s.slice(lt, gt < 0 ? n : gt + 1);
      i = gt < 0 ? n : gt + 1;
      continue;
    }
    const isEnd = next === '/';
    if (!/[a-z]/i.test(isEnd ? (s[lt + 2] || '') : next)) {
      out += '<'; // a "<" that does not start a tag is text
      i = lt + 1;
      continue;
    }

    const tag = readTag(s, lt, isEnd);
    if (!tag) break; // unterminated tag: browsers drop it and the rest
    const name = tag.name.toLowerCase();
    i = tag.end;

    if (!TAG_NAME.test(name)) continue; // "<scr<script>" and similar are dropped whole

    if (isEnd) {
      if (DROP_WITH_CONTENT.has(name) || DROP_TAG.has(name)) continue;
      if (inSvg() && (name === 'p' || name === 'br')) ns = []; // </p> and </br> leave SVG
      else {
        const at = ns.lastIndexOf(name);
        if (at >= 0) ns = ns.slice(0, at);
      }
      out += `</${tag.name}>`; // attributes on end tags mean nothing; drop them
      continue;
    }

    const foreign = inSvg();
    if (foreign && (SVG_BREAKOUT.has(name) ||
        (name === 'font' && tag.attrs.some((a) => /^(color|face|size)$/i.test(a.name))))) ns = [];

    if (DROP_WITH_CONTENT.has(name)) {
      const close = findClose(i, name);
      i = close < 0 ? n : close;
      continue;
    }
    if (DROP_TAG.has(name)) continue;
    if (name === 'meta' && tag.attrs.some((a) => a.name.toLowerCase() === 'http-equiv')) continue;
    if (/^(set|animate|animatemotion|animatetransform)$/.test(name) &&
        tag.attrs.some((a) => a.name.toLowerCase() === 'attributename' && /^(xlink:)?href$/i.test(String(a.value || '').trim()))) continue;

    const kept = tag.attrs.filter((a) => attrAllowed(a.name, a.value));
    // Links out of the page open in a new tab (see the header comment).
    const href = name === 'a' && kept.find((a) => /^(xlink:)?href$/i.test(a.name));
    const addTarget = href && EXTERNAL_LINK.test(href.value || '') && !kept.some((a) => /^target$/i.test(a.name));
    out += kept.length === tag.attrs.length && !addTarget
      ? s.slice(lt, tag.end)
      : `<${tag.name}${kept.map((a) => ' ' + a.raw).join('')}${addTarget ? ' target="_blank" rel="noopener noreferrer"' : ''}${tag.selfClosing ? ' />' : '>'}`;

    const nowSvg = inSvg();
    // Browsers stop nesting at a few hundred levels; capping the stack keeps
    // end-tag lookups bounded so deep nesting can't make this quadratic.
    if (!tag.selfClosing && (nowSvg || name === 'svg') && ns.length < 512) ns.push(name);

    // Raw text (in HTML context): copy verbatim to the end tag, so a quote
    // inside CSS can't make the rest of the page read as one long attribute.
    if (RAW_TEXT.has(name) && !nowSvg && !tag.selfClosing) {
      const close = findClose(i, name);
      if (close < 0) { out += s.slice(i); i = n; break; }
      const endTagStart = lower.lastIndexOf(`</${name}`, close);
      out += s.slice(i, endTagStart) + `</${tag.name}>`;
      i = close;
    }
  }
  return out;
}

/** Wraps a fragment in a minimal document so pasted partial HTML still renders. */
export function asDocument(html, title = 'Update') {
  const body = String(html || '').trim();
  if (/^<!doctype html|^<html[\s>]/i.test(body)) return body;
  const safeTitle = String(title).replace(/[<>&"]/g, '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safeTitle}</title><style>body{margin:0;padding:24px 16px;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2937;background:#fff}main{max-width:720px;margin:0 auto}img{max-width:100%;height:auto}</style></head><body><main>${body}</main></body></html>`;
}

/* Headers for serving a stored page. `sandbox` with no flags gives the page an
 * opaque origin with scripts, forms, popups and top navigation all disabled.
 * Images and fonts may load over https so a page can show a screenshot or a
 * hosted chart; nothing else may load at all. */
export const VIEW_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': [
    // No allow-scripts, allow-forms or allow-same-origin: the page stays inert
    // with an opaque origin. Popups are allowed (and escape the sandbox) only
    // so a link can open the real site in a new tab.
    'sandbox allow-popups allow-popups-to-escape-sandbox',
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    'img-src data: https:',
    'font-src data: https:',
    'media-src https:',
    "frame-ancestors 'self'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store'
};
