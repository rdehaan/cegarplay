// The design guide (guide/*.html) and its examples (group "guide" of the library).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as H from './helpers.mjs';
import { CHAPTERS, EXTRAS } from '../guide/chapters.js';
import { GRAPH, LOOP_KEYWORDS } from '../guide/guide.js';
import { KEYWORDS } from '../js/compiler.js';
import { SMALL_EDGES } from '../tools/guide.mjs';
import { KEYS, format, measureAll, statSpans, checkSpans } from '../tools/guide-numbers.mjs';

const lib = JSON.parse(H.read('examples/library.json'));
const byId = new Map(lib.examples.map((e) => [e.id, e]));
const GUIDE = lib.examples.filter((e) => e.group === 'guide');
const PAGES = fs.readdirSync(H.path('guide/')).filter((f) => f.endsWith('.html')).sort();
const EXTRA_PAGES = new Set(EXTRAS.map((x) => x.file));
const CHAPTER_PAGES = PAGES.filter((f) => f !== 'index.html' && !EXTRA_PAGES.has(f));
const READY = CHAPTERS.filter((c) => c.ready);
const FROM = /^guide\/[a-z0-9-]+\.html(#[a-z0-9-]+)?$/;

// ---- a small HTML reader: elements with their attributes, parents and text -------------------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', larr: '←', rarr: '→' };
export const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e] ?? m));

function parse(html) {
  const root = { tag: '#root', attrs: {}, kids: [], parent: null, start: 0 };
  const all = [];
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let m, last = 0;
  while ((m = re.exec(html))) {
    if (m.index > last) cur.kids.push(html.slice(last, m.index));
    last = re.lastIndex;
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      let e = cur;
      while (e && e.tag !== tag) e = e.parent;
      assert.ok(e, `unmatched </${tag}> at ${m.index}`);
      e.end = m.index;
      cur = e.parent;
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    const el = { tag, attrs, kids: [], parent: cur, start: m.index };
    cur.kids.push(el);
    all.push(el);
    if (!VOID.has(tag) && !m[4]) cur = el;
  }
  return { root, all, html };
}
const text = (el) => decode(el.kids.map((k) => (typeof k === 'string' ? k : text(k))).join(''));
const cls = (el) => (el.attrs.class || '').split(/\s+/);
const has = (el, c) => cls(el).includes(c);
const ancestors = function* (el) { for (let e = el.parent; e; e = e.parent) yield e; };

const page = new Map(PAGES.map((f) => [f, parse(H.read(`guide/${f}`))]));
const ids = (f) => new Set(page.get(f).all.map((e) => e.attrs.id).filter(Boolean));

// The playground links of a page: { el, example, fragment, from }.
function playLinks(f) {
  return page.get(f).all.filter((e) => e.tag === 'a' && e.attrs.href && e.attrs.href.startsWith('../?')).map((el) => {
    const q = new URLSearchParams(el.attrs.href.slice(4));
    return { el, href: el.attrs.href, example: q.get('example'), fragment: q.get('fragment'), from: q.get('from') };
  }).filter((l) => l.example);
}
const fragmentText = (id, name) => {
  const p = H.example(id);
  if (name === 'loop') return p.loop.text;
  const f = p.fragments.find((x) => x.name === name);
  assert.ok(f, `${id} has no fragment ${name}`);
  return f.text;
};
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

// ---- the examples -------------------------------------------------------------------------
test('guide examples: manifest fields, descriptions, statuses and baselines', () => {
  assert.ok(lib.groups.some((g) => g.id === 'guide'));
  assert.equal(lib.groups.findIndex((g) => g.id === 'guide'), lib.groups.findIndex((g) => g.id === 'tutorial') + 1);
  assert.ok(GUIDE.length >= 1);
  for (const e of GUIDE) {
    assert.match(e.id, /^guide-\d\d-[a-z0-9-]+$/, e.id);
    assert.match(e.page, FROM, `${e.id}.page`);
    // demo: an illustration that is not a loop for the problem (accepts everything, one fixed candidate, ...).
    assert.ok(['sound', 'unsound', 'baseline', 'demo'].includes(e.status), `${e.id}.status`);
    assert.ok(e.tags.includes('fast') && e.expected, `${e.id} must be fast and have expected`);
    if (e.status === 'baseline' || e.status === 'demo') assert.equal(e.baseline, undefined, e.id);
    else {
      const b = byId.get(e.baseline);
      assert.ok(b, `${e.id}: unknown baseline ${e.baseline}`);
      assert.equal(b.status, 'baseline', `${e.id}: ${e.baseline} is not a baseline`);
    }
    const p = H.example(e.id);
    assert.ok(p.description && p.description.length > 40, `${e.id}: no description`);
    for (const f of p.fragments) assert.ok(f.description, `${e.id}: fragment ${f.name} has no description`);
  }
});

test('every guide example is linked from its page, at the anchor its page field names', () => {
  for (const e of GUIDE) {
    const [file, anchor] = e.page.slice('guide/'.length).split('#');
    assert.ok(page.has(file), `${e.id}: no page ${file}`);
    const links = playLinks(file).filter((l) => l.example === e.id);
    assert.ok(links.length, `${e.id} is not linked from ${file}`);
    if (anchor) assert.ok(ids(file).has(anchor), `${e.id}: ${file} has no id ${anchor}`);
  }
});

test('every playground link of the guide names a library example, a fragment of it, and its own place', () => {
  let n = 0;
  for (const f of PAGES) {
    for (const l of playLinks(f)) {
      n++;
      const where = `${f}: ${l.href}`;
      assert.ok(byId.has(l.example), `${where}: unknown example`);
      assert.ok(has(l.el, 'play'), `${where}: not class="play"`);
      assert.equal(l.el.attrs.target, 'cegarplay', `${where}: target`);
      if (l.fragment && l.fragment !== 'loop') {
        assert.ok(H.example(l.example).fragments.some((x) => x.name === l.fragment), `${where}: no fragment ${l.fragment}`);
      }
      assert.ok(l.from, `${where}: no from=`);
      assert.match(l.from, FROM, where);
      const [file, anchor] = l.from.slice('guide/'.length).split('#');
      assert.equal(file, f, `${where}: from= names another page`);
      assert.ok(anchor, `${where}: from= has no anchor`);
      assert.ok([...ancestors(l.el)].some((a) => a.attrs.id === anchor), `${where}: the link is not inside #${anchor}`);
    }
  }
  assert.ok(n >= 1);
});

// One fresh measurement of every guide example, shared by the next tests.
let measured;
const fresh = async () => (measured ??= await measureAll(GUIDE));   // also the variants and QUOTED runs

test('guide examples: sound ones give their baseline\'s count, unsound ones strictly fewer; all finish', async () => {
  const m = await fresh();       // measureAll throws on an error event or an unfinished run (or a missing expected error)
  for (const e of GUIDE) if (e.outcome) assert.equal(e.status, 'demo', `${e.id}: only demos may end with an error`);
  for (const e of GUIDE) {
    assert.equal(m[e.id].solutions, e.expected.solutions, `${e.id}: expected`);
    if (e.status === 'sound') assert.equal(m[e.id].solutions, m[e.baseline].solutions, `${e.id} vs ${e.baseline}`);
    // Unsound: a different count (fewer for a refinement that is too strong; a misused core can give more).
    if (e.status === 'unsound') assert.notEqual(m[e.id].solutions, m[e.baseline].solutions, `${e.id} vs ${e.baseline}`);
    if (e.exhausted === false) assert.equal(e.status, 'demo', `${e.id}: only demos may stop early`);
  }
});

test('guide/numbers.json is reproduced by a fresh run, and every number on a page matches it', async () => {
  const m = await fresh();
  const stored = JSON.parse(H.read('guide/numbers.json'));
  assert.deepEqual(stored, m);
  const spans = statSpans();
  for (const s of spans) assert.ok(s.key in KEYS, `${s.file}: key ${s.key}`);
  assert.deepEqual(checkSpans(stored, spans), []);
  assert.equal(format('candidates', 12345), '12,345');
  assert.equal(format('meanClause', 3), '3.0');
});

test('listings and "what changed" blocks quote their fragments', () => {
  for (const f of PAGES) {
    for (const el of page.get(f).all) {
      if (el.tag === 'pre' && has(el, 'code')) {
        assert.ok(el.attrs['data-from'], `${f}: a listing without data-from`);
        assert.ok(['asp', 'loop'].includes(el.attrs['data-lang']), `${f}: data-lang`);
        const [id, name] = el.attrs['data-from'].split(':');
        const src = lines(fragmentText(id, name));
        const want = lines(text(el));
        const at = src.findIndex((_, i) => want.every((w, j) => src[i + j] === w));
        assert.ok(at >= 0, `${f}: the listing from ${id}:${name} is not in the fragment:\n${want.join('\n')}`);
      }
      if (has(el, 'changed')) {
        const before = lines(fragmentText(...el.attrs['data-before'].split(':')));
        const after = lines(fragmentText(...el.attrs['data-after'].split(':')));
        const parts = el.kids.filter((k) => typeof k !== 'string');
        assert.ok(parts.some((k) => k.tag === 'del' || k.tag === 'ins'), `${f}: an empty "changed" block`);
        for (const k of parts) {
          const t = text(k).trim();
          if (k.tag === 'del') assert.ok(before.includes(t), `${f}: <del>${t}</del> is not in ${el.attrs['data-before']}`);
          else if (k.tag === 'ins') assert.ok(after.includes(t), `${f}: <ins>${t}</ins> is not in ${el.attrs['data-after']}`);
          else assert.ok(before.includes(t) && after.includes(t), `${f}: context line ${t} is not in both fragments`);
        }
      }
    }
  }
});

test('the graph drawn by guide.js is the graph of the small-graph examples', () => {
  const norm = (es) => es.map(([u, v]) => (u < v ? `${u}-${v}` : `${v}-${u}`)).sort();
  assert.deepEqual(norm(GRAPH.edges), norm(SMALL_EDGES));
  for (const [u, v] of GRAPH.edges) assert.ok(GRAPH.nodes[u] && GRAPH.nodes[v]);
  let n = 0;
  for (const e of GUIDE) {
    const shared = H.example(e.id).fragments.find((f) => f.name === 'shared');
    if (!shared || !shared.text.includes("The graph of the guide's figures")) continue;
    n++;
    const edges = [...shared.text.matchAll(/\bedge\((\d+),(\d+)\)\./g)].map((m) => [+m[1], +m[2]]);
    assert.deepEqual(norm(edges), norm(GRAPH.edges), e.id);
  }
  assert.ok(n >= 1);
});

test('guide.js knows the keywords of the loop language', () => {
  assert.deepEqual([...LOOP_KEYWORDS].sort(), [...KEYWORDS].sort());
});

// ---- the pages ------------------------------------------------------------------------------
test('chapters.js and the pages agree; the contents page lists every chapter', () => {
  assert.deepEqual(CHAPTER_PAGES, READY.map((c) => c.file).sort(), 'the written pages are the ready chapters');
  CHAPTERS.forEach((c, i) => assert.ok(c.file.startsWith(String(i + 1).padStart(2, '0') + '-'), c.file));
  const idx = page.get('index.html');
  const items = idx.all.filter((e) => e.tag === 'li' && e.parent && has(e.parent, 'chapter-list'));
  assert.equal(items.length, CHAPTERS.length);
  items.forEach((li, i) => {
    const c = CHAPTERS[i];
    const a = li.kids.find((k) => typeof k !== 'string' && k.tag === 'a');
    if (c.ready) { assert.ok(a, `${c.file} is not linked`); assert.equal(a.attrs.href, c.file); assert.equal(text(a).trim(), c.title); }
    else { assert.ok(!a, `${c.file} is linked but not ready`); assert.ok(text(li).includes(c.title), c.title); }
    assert.ok(text(li).replace(/\s+/g, ' ').includes(c.summary), `summary of ${c.file}`);
  });
});

test('every page has the skeleton, a recap, an exercise with a solution, and the right neighbours', () => {
  for (const f of PAGES) {
    const { all, html } = page.get(f);
    const find = (p) => all.find(p);
    assert.match(html, /<script src="\.\.\/js\/theme\.js"><\/script>/, `${f}: theme.js`);
    for (const css of ['../css/theme.css', 'guide.css', '../vendor/fonts/fonts.css']) assert.ok(find((e) => e.tag === 'link' && e.attrs.href === css), `${f}: ${css}`);
    assert.ok(find((e) => e.tag === 'meta' && e.attrs.name === 'color-scheme'), `${f}: color-scheme`);
    assert.ok(find((e) => e.tag === 'script' && e.attrs.src === 'guide.js' && e.attrs.type === 'module'), `${f}: guide.js`);
    const header = find((e) => e.tag === 'header' && has(e, 'guide-header'));
    assert.ok(header, `${f}: header`);
    assert.ok(find((e) => e.tag === 'a' && e.attrs.href === 'index.html' && [...ancestors(e)].includes(header)), `${f}: title link`);
    assert.ok(find((e) => e.tag === 'a' && e.attrs.href === '../' && [...ancestors(e)].includes(header)), `${f}: playground link`);
    assert.ok(find((e) => e.attrs['data-theme-toggle'] !== undefined), `${f}: theme toggle`);
    assert.ok(find((e) => e.tag === 'nav' && e.attrs.id === 'chapters'), `${f}: chapter nav`);
    assert.ok(find((e) => e.tag === 'main') && find((e) => e.tag === 'article'), `${f}: main/article`);
    assert.equal(all.filter((e) => e.tag === 'h1').length, 1, `${f}: one h1`);
    const pager = find((e) => e.tag === 'nav' && has(e, 'pager'));
    assert.ok(pager, `${f}: pager`);
    if (EXTRA_PAGES.has(f)) {
      // a page that is not a chapter: the skeleton, its title, and a link back to the contents
      const x = EXTRAS.find((e) => e.file === f);
      assert.equal(text(find((e) => e.tag === 'h1')).trim(), x.title, `${f}: h1`);
      assert.ok(all.some((e) => e.tag === 'a' && e.attrs.href === 'index.html' && [...ancestors(e)].includes(pager)), `${f}: back to the contents`);
      assert.ok(ids('index.html') && page.get('index.html').all.some((e) => e.tag === 'a' && e.attrs.href === f), `${f}: not linked from the contents page`);
      continue;
    }
    const link = (c) => all.find((e) => e.tag === 'a' && has(e, c) && [...ancestors(e)].includes(pager));
    const order = ['index.html', ...READY.map((c) => c.file)];
    const i = order.indexOf(f);
    assert.ok(i >= 0, `${f} is not in chapters.js`);
    assert.equal(link('prev') && link('prev').attrs.href, i > 0 ? order[i - 1] : undefined, `${f}: previous`);
    assert.equal(link('next') && link('next').attrs.href, order[i + 1], `${f}: next`);
    if (f === 'index.html') continue;
    const c = READY[i - 1];
    assert.equal(text(find((e) => e.tag === 'h1')).trim(), c.title, `${f}: h1`);
    assert.match(text(find((e) => e.tag === 'title')), new RegExp('^' + c.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · '), `${f}: title`);
    const recap = find((e) => e.tag === 'section' && has(e, 'recap'));
    assert.ok(recap, `${f}: recap`);
    const rules = all.filter((e) => e.tag === 'li' && [...ancestors(e)].includes(recap));
    assert.ok(rules.length >= 1 && rules.every((r) => r.attrs.id), `${f}: recap items need ids`);
    const ex = all.filter((e) => e.tag === 'section' && has(e, 'exercise'));
    assert.ok(ex.length >= 1, `${f}: no exercise`);
    for (const s of ex) {
      const sol = all.find((e) => e.tag === 'details' && has(e, 'solution') && [...ancestors(e)].includes(s));
      assert.ok(sol, `${f}: exercise ${s.attrs.id} has no solution`);
      assert.ok(all.some((e) => e.tag === 'a' && has(e, 'play') && [...ancestors(e)].includes(sol)), `${f}: solution of ${s.attrs.id} has no playground link`);
    }
    for (const fig of all.filter((e) => e.tag === 'figure' && has(e, 'graph'))) {
      assert.ok(fig.kids.some((k) => typeof k !== 'string' && k.tag === 'noscript'), `${f}: graph figure without <noscript>`);
      for (const k of ['del', 'clique']) {
        for (const n of (fig.attrs['data-' + k] || '').split(',').filter(Boolean)) assert.ok(GRAPH.nodes[n.trim()], `${f}: node ${n}`);
      }
    }
  }
});

test('the guide loads nothing from another origin and has no dangling link or anchor', () => {
  for (const f of PAGES) {
    const { all, html } = page.get(f);
    for (const e of all) {
      for (const a of ['src', 'href']) {
        const v = e.attrs[a];
        if (v === undefined) continue;
        assert.doesNotMatch(v, /^(https?:)?\/\//, `${f}: ${a}="${v}"`);
        if (/^(data|mailto):/.test(v)) continue;
        const [pathq, anchor] = v.split('#');
        const p = pathq.split('?')[0];
        const target = p === '' ? `guide/${f}` : new URL(p, H.path(`guide/${f}`)).pathname.slice(H.ROOT.pathname.length);
        const file = target === '' || target.endsWith('/') ? target + 'index.html' : target;
        assert.ok(fs.existsSync(H.path(file)), `${f}: ${a}="${v}" points to a missing ${file}`);
        if (anchor && file.startsWith('guide/') && !pathq.includes('?')) {
          assert.ok(ids(file.slice(6)).has(anchor), `${f}: ${v}: no id ${anchor} in ${file}`);
        }
      }
    }
    assert.doesNotMatch(html.replace(/<a [^>]*>/g, ''), /\bhttps?:\/\/(?!www\.w3\.org)/, `${f}: an absolute URL`);
  }
});

test('page 12 collects recap rules that exist', { skip: !PAGES.includes('12-your-own-loop.html') && 'no page 12 yet' }, () => {
  const p12 = page.get('12-your-own-loop.html');
  const refs = p12.all.filter((e) => e.tag === 'a' && /^\d\d-[a-z0-9-]+\.html#rule-/.test(e.attrs.href || ''));
  assert.ok(refs.length >= 1);
  for (const a of refs) {
    const [file, id] = a.attrs.href.split('#');
    assert.ok(ids(file).has(id), `${a.attrs.href}`);
  }
});

test('trace literals are signed by the value they ask for, also for atoms the solver has fixed', async () => {
  // guide-01-one-candidate fixes del(4) and del(8) true and the others false: the block clause
  // asks for every other value.
  const p = H.example('guide-01-one-candidate');
  p.settings = { ...p.settings, trace: 5 };
  const r = await H.runProject(p);
  const t = H.ofKind(r, 'T')[0];
  assert.deepEqual(t.literals, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (v === 4 || v === 8 ? '-' : '') + `del(${v})`));
  const q = H.example('guide-02-block');
  q.settings = { ...q.settings, trace: 5 };
  const t2 = H.ofKind(await H.runProject(q), 'T')[1];
  assert.equal(t2.candidate, 'del(1)');
  assert.deepEqual(t2.literals.slice(0, 2), ['-del(1)', 'del(2)']);
});

test('guide-11-fewest-deletions reports the smallest k for which the blocking loop has a solution', async () => {
  const m = await fresh();
  const p = H.example('guide-11-fewest-deletions');
  p.settings = { ...p.settings, solutions: 0, trace: 0 };
  const r = await H.runProject(p);
  const sols = H.ofKind(r, 'M');
  assert.equal(sols.length, 1);
  const size = JSON.stringify(sols[0]).match(/del\(/g).length;
  const k = Number(H.example('guide-05-paley-block').settings.constants.k);
  assert.equal(size, k);
  assert.ok(m['guide-05-paley-block'].solutions > 0);
  assert.equal(m[`guide-05-paley-block@k=${k - 1}`].solutions, 0);
});
