// The guide's pages: chapter navigation, code highlighting, graph figures.
// An ES module without dependencies. The exports (GRAPH, LOOP_KEYWORDS, tokenise) are also
// read by test/guide.test.mjs under Node, so the DOM is touched only when there is one.
import { CHAPTERS } from './chapters.js';

// ---- the small graph of pages 1-4 -------------------------------------------------------
// The same edges as SMALL_EDGES in tools/guide.mjs (a test compares them). Coordinates in a
// 100 x 60 box: the clique on 1-4 on the left (3 inside the triangle 1-2-4), then the chain of
// triangles 4-5-6, 6-7-8, 8-9-10.
export const GRAPH = {
  nodes: {
    1: [6, 8], 2: [6, 52], 3: [15, 30], 4: [28, 30], 5: [40, 8],
    6: [52, 30], 7: [64, 8], 8: [76, 30], 9: [90, 8], 10: [90, 52],
  },
  edges: [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4], [4, 5], [4, 6], [5, 6],
    [6, 7], [6, 8], [7, 8], [8, 9], [8, 10], [9, 10]],
};

// ---- highlighting -------------------------------------------------------------------------
// The keywords of the loop language (the same list as KEYWORDS in js/compiler.js).
export const LOOP_KEYWORDS = new Set(('solver link via options legacy compat lift keep def return if elif else loop while repeat until for in ' +
  'search on candidate reject with accept restart stop break continue count by log assume limit optimal and or not ' +
  'true false none').split(' '));
const SPECIAL = new Set(['glue', 'relevant', 'cex', 'clause']);
const DIRECTIVE = /^#(program|show|minimize|maximize|const|external|heuristic|include|project|defined)\b/;

// Split one listing into [class or null, text] pieces. lang is 'asp' or 'loop'.
export function tokenise(text, lang = 'asp') {
  const out = [];
  const RULES = [
    ...(lang === 'asp' ? [[/^%\*[\s\S]*?(?:\*%|$)/, 'comment'], [/^%[^\n]*/, 'comment'], [DIRECTIVE, 'keyword']]
      : [[/^#[^\n]*/, 'comment']]),
    [/^"(?:[^"\\\n]|\\.)*"?/, 'string'],
    [/^\d+/, 'number'],
    [/^[A-Za-z_][A-Za-z0-9_]*/, 'word'],
    [/^[^A-Za-z0-9_"%#]+/, null],
    [/^[\s\S]/, null],
  ];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    for (const [re, kind] of RULES) {
      const m = re.exec(rest);
      if (!m || !m[0]) continue;
      const w = m[0];
      let cls = kind;
      if (kind === 'word') {
        if (lang === 'loop') cls = LOOP_KEYWORDS.has(w) ? 'keyword' : null;
        else if (/^[A-Z_]/.test(w)) cls = 'variable';
        else if (SPECIAL.has(w)) cls = 'special';
        else cls = w === 'not' ? 'keyword' : null;
      }
      const prev = out[out.length - 1];
      if (prev && prev[0] === cls && cls === null) prev[1] += w; else out.push([cls, w]);
      i += w.length;
      break;
    }
  }
  return out;
}

// ---- the page -------------------------------------------------------------------------------
const SVG = 'http://www.w3.org/2000/svg';
const here = () => decodeURIComponent(location.pathname.split('/').pop() || 'index.html');

function highlight(el, lang) {
  const text = el.textContent;
  el.textContent = '';
  for (const [cls, t] of tokenise(text, lang)) {
    if (!cls) { el.append(t); continue; }
    const s = document.createElement('span');
    s.className = 'tok-' + cls;
    s.textContent = t;
    el.append(s);
  }
}

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// <figure class="graph" data-del="1,4" data-clique="2,5,6">: the small graph, deleted nodes
// greyed and crossed, the clique (if any) drawn in the accent colour.
function drawGraph(fig) {
  const list = (k) => new Set((fig.dataset[k] || '').split(',').map((x) => x.trim()).filter(Boolean).map(Number));
  const del = list('del'), clique = list('clique');
  const S = 6;            // scale: the 100 x 60 box becomes 600 x 360
  const svg = svgEl('svg', { viewBox: '-30 18 660 324', class: 'graph-svg', role: 'img' });
  const label = fig.querySelector('figcaption');
  svg.setAttribute('aria-label', label ? label.textContent.trim() : 'The small graph');
  const P = (n) => GRAPH.nodes[n].map((c) => c * S);
  for (const [u, v] of GRAPH.edges) {
    const [x1, y1] = P(u), [x2, y2] = P(v);
    const cls = ['edge'];
    if (clique.has(u) && clique.has(v)) cls.push('in-clique');
    if (del.has(u) || del.has(v)) cls.push('gone');
    svg.append(svgEl('line', { x1, y1, x2, y2, class: cls.join(' ') }));
  }
  for (const n of Object.keys(GRAPH.nodes).map(Number)) {
    const [x, y] = P(n);
    const cls = ['node'];
    if (del.has(n)) cls.push('deleted');
    if (clique.has(n)) cls.push('in-clique');
    const g = svgEl('g', { class: cls.join(' ') });
    g.append(svgEl('circle', { cx: x, cy: y, r: 22 }));
    if (del.has(n)) g.append(svgEl('path', { d: `M${x - 15} ${y - 15}L${x + 15} ${y + 15}M${x + 15} ${y - 15}L${x - 15} ${y + 15}`, class: 'cross' }));
    const t = svgEl('text', { x, y: y + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = String(n);
    g.append(t);
    svg.append(g);
  }
  fig.prepend(svg);
}

// The chapter list in the sidebar; on narrow screens it folds into a button.
function buildNav(nav) {
  const cur = here();
  const ready = CHAPTERS.filter((c) => c.ready);
  const det = document.createElement('details');
  det.className = 'chapters-box';
  det.open = window.matchMedia ? window.matchMedia('(min-width: 900px)').matches : true;
  const sum = document.createElement('summary');
  sum.textContent = 'Chapters';
  det.append(sum);
  const ol = document.createElement('ol');
  const item = (href, text, num) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    if (num) li.dataset.num = num;
    if (href === cur) { a.setAttribute('aria-current', 'page'); li.className = 'current'; }
    li.append(a);
    ol.append(li);
  };
  item('index.html', 'Contents');
  for (const c of ready) item(c.file, c.title, c.file.slice(0, 2));
  det.append(ol);
  nav.append(det);
}

function start() {
  const nav = document.getElementById('chapters');
  if (nav) buildNav(nav);
  for (const el of document.querySelectorAll('pre.code[data-lang]')) highlight(el, el.dataset.lang);
  for (const el of document.querySelectorAll('.changed[data-lang] del, .changed[data-lang] ins, .changed[data-lang] .same')) {
    highlight(el, el.closest('.changed').dataset.lang);
  }
  for (const fig of document.querySelectorAll('figure.graph')) drawGraph(fig);
  // Printing opens every hidden answer.
  addEventListener('beforeprint', () => {
    for (const d of document.querySelectorAll('details')) { d.dataset.wasOpen = d.open ? '1' : ''; d.open = true; }
  });
  addEventListener('afterprint', () => {
    for (const d of document.querySelectorAll('details')) d.open = d.dataset.wasOpen === '1';
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
