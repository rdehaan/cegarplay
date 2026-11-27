// A small Markdown renderer for the manual. No DOM, no Node APIs, no dependency.
//
// Supported: ATX headings (# to ####) with stable ids, paragraphs, fenced code blocks,
// nested lists (-, *, 1.), pipe tables, block quotes, horizontal rules, and inline code,
// **bold**, *italic*, [links](url) and <br>. All other HTML is escaped.
//
// Fenced code with the language loop, asp (or gringo, lp) becomes a read-only ACE block on the
// page: <div class="example-code" data-mode="...">. Other languages become <pre><code>.
// A link to ?example=<id> also carries data-load-example="<id>", so a click loads that example.
import { escapeHtml } from './util.js';

const ACE_MODES = { loop: 'loop', asp: 'gringo', gringo: 'gringo', lp: 'gringo' };

export { escapeHtml };

// "Loop language: grammar" -> "loop-language-grammar"
export function slugify(text) {
  return String(text).toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;|&#\d+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

// An allowlist: http(s), mailto, or a relative link without a scheme. A URL with a control
// character or whitespace anywhere is dropped: the browser's URL parser strips or ignores
// those, so "\x01javascript:" or "java\tscript:" would otherwise reach the href as a scheme.
export function safeUrl(url) {
  const u = String(url).trim();
  if (!u || /[\u0000-\u0020\u007f-\u009f\\]/.test(u)) return null;
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null;        // javascript:, data:, ...
  if (u.startsWith('//')) return null;                      // protocol-relative: another origin
  return u;
}

// Inline markup of one block of text (already joined lines).
export function renderInline(text) {
  const codes = [];
  // code spans first: their content is literal
  let s = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, ticks, body) => {
    codes.push(`<code>${escapeHtml(body.replace(/^ (.*) $/, '$1'))}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  // links: [text](url)
  s = s.replace(/\[([^\[\]]{1,500})\]\(([^)\s]{1,2000})\)/g, (m, label, href) => {
    const raw = href.replace(/&amp;/g, '&');
    const url = safeUrl(raw);
    if (url === null) return label;
    const ex = /^\?(?:.*&)?example=([A-Za-z0-9_-]+)/.exec(url);
    const extra = ex ? ` data-load-example="${ex[1]}"` : /^https?:/i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(url)}"${extra}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<i>$2</i>');
  s = s.replace(/&lt;br\s*\/?&gt;/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells = [];
  let cur = '', inCode = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') inCode = !inCode;
    if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const LIST_ITEM = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;
const isSeparator = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
const indentOf = (l) => l.match(/^ */)[0].length;

// Render a list starting at lines[i]; returns [html, next index].
function renderList(lines, i, base) {
  const ordered = /\d/.test(LIST_ITEM.exec(lines[i])[2]);
  const items = [];
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i]);
    if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
    const text = [m[3]];
    let sub = '';
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        // a blank line ends the list unless the next line continues it
        const n = lines[i + 1];
        if (n !== undefined && n.trim() && indentOf(n) > base) { i++; continue; }
        if (n !== undefined && LIST_ITEM.test(n) && indentOf(n) === base) { i++; continue; }
        break;
      }
      const lm = LIST_ITEM.exec(l);
      if (lm && lm[1].length > base) { const [h, j] = renderList(lines, i, lm[1].length); sub += h; i = j; continue; }
      if (lm || indentOf(l) <= base) break;
      text.push(l.trim());
      i++;
    }
    items.push(`<li>${renderInline(text.join(' '))}${sub}</li>`);
  }
  const tag = ordered ? 'ol' : 'ul';
  return [`<${tag}>${items.join('')}</${tag}>`, i];
}

// opts.idPrefix (default "manual-"); opts.headings: an array that receives {level, text, id}.
export function renderMarkdown(text, opts = {}) {
  const prefix = opts.idPrefix ?? 'manual-';
  const headings = opts.headings || [];
  const used = new Map();
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${renderInline(para.join(' '))}</p>`);
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    const fence = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[2])) {
        body.push(lines[i].slice(Math.min(fence[1].length, indentOf(lines[i]))));
        i++;
      }
      i++;
      const lang = fence[3].toLowerCase();
      const code = escapeHtml(body.join('\n'));
      if (ACE_MODES[lang]) out.push(`<div class="example-code" data-mode="${ACE_MODES[lang]}">${code}</div>`);
      else out.push(`<pre class="code-block"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${code}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    // headings
    const h = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      const inner = renderInline(h[2]);
      let id = prefix + slugify(inner);
      const n = (used.get(id) || 0) + 1;
      used.set(id, n);
      if (n > 1) id += '-' + n;
      headings.push({ level, text: inner.replace(/<[^>]*>/g, ''), html: inner, id });
      out.push(`<h${level} id="${id}">${inner}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flush(); out.push('<hr>'); i++; continue;
    }
    // tables: a row followed by a separator line
    if (line.includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++; }
      const th = head.map((c) => `<th>${renderInline(c)}</th>`).join('');
      const trs = rows.map((r) => `<tr>${head.map((_, j) => `<td>${renderInline(r[j] ?? '')}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="table-wrapper"><table class="internals-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`);
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flush();
      const [html, j] = renderList(lines, i, LIST_ITEM.exec(line)[1].length);
      out.push(html);
      i = j;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { body.push(lines[i].replace(/^\s*> ?/, '')); i++; }
      const depth = (opts.depth || 0) + 1;
      const inner = depth > 16 ? `<p>${renderInline(body.join(' '))}</p>`
        : renderMarkdown(body.join('\n'), { idPrefix: prefix + 'q-', depth });
      out.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join('\n');
}
