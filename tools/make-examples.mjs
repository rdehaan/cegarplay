// Build examples/*.json from reference/declarative-cegar.   node tools/make-examples.mjs
import fs from 'node:fs';
import { importLp, load, save, template } from '../js/project.js';
import { stripAspComments } from '../js/driver.js';
import { GROUPS, PROBLEMS, buildLibrary, GENERATORS, RECIPES } from './library.mjs';
import { buildGuide } from './guide.mjs';

const root = new URL('..', import.meta.url);
const src = (f) => fs.readFileSync(new URL(`reference/declarative-cegar/${f}`, root), 'utf8');

export const FIX = `
% A node that is not a leaf now may become one. Giving it a leaf colour other
% than its colour in the counterexample also breaks the counterexample.
relevant(leaf_color(N,C)) :- node(N), not leaf(N), color(C), not color(N,C).
`;
export const REFINE_PART = `
#program refine(k).
% cex(k,color(N,C)): the k-th counterexample colours node N with C. It stops
% being a counterexample once an edge joins two nodes it colours alike, or a
% leaf gets a different colour.
broken(k) :- edge(N,M), N < M, cex(k,color(N,C)), cex(k,color(M,C)).
broken(k) :- leaf(N), leaf_color(N,C), not cex(k,color(N,C)).
broken(k) :- leaf(N), cex(k,color(N,C)), not leaf_color(N,C).
:- not broken(k).
`;

// Statements of an ASP text (outside comments): [{ start, end }] where end is the index of the final '.'.
function statements(code) {
  const out = [];
  let depth = 0, start = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (start === null && /\S/.test(c)) start = i;
    if (c === '"') { i++; while (i < code.length && code[i] !== '"') { if (code[i] === '\\') i++; i++; } continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '.' && depth === 0 && code[i + 1] !== '.' && code[i - 1] !== '.') {
      out.push({ start, end: i });
      start = null;
    }
  }
  return out;
}
function atomEnd(code, i) {        // i at the predicate name; returns index after the closing ')'
  let j = i;
  while (/[A-Za-z0-9_]/.test(code[j])) j++;
  if (code[j] !== '(') return j;
  let d = 0;
  for (; j < code.length; j++) {
    if (code[j] === '(') d++;
    else if (code[j] === ')') { d--; if (d === 0) return j + 1; }
  }
  return j;
}

// Wrap every rule head h of a glue fragment as glue(h); atoms in bodies whose predicate is
// defined in the fragment are wrapped too, so the rules keep their meaning.
export function wrapGlue(text) {
  const code = stripAspComments(text);
  const sts = statements(code);
  const heads = new Set();
  for (const s of sts) {
    const body = code.slice(s.start, s.end);
    if (/^\s*#/.test(body)) continue;
    const h = /^\s*([a-z_][A-Za-z0-9_]*)/.exec(body.split(':-')[0]);
    if (h) heads.add(h[1]);
  }
  const edits = [];             // [index, insertText]
  for (const s of sts) {
    const st = code.slice(s.start, s.end);
    if (/^\s*#/.test(st)) continue;
    const arrow = st.indexOf(':-');
    const headEnd = s.start + (arrow < 0 ? st.length : arrow);
    const headText = code.slice(s.start, headEnd);
    const hs = s.start + headText.search(/\S/);
    const he = s.start + headText.replace(/\s+$/, '').length;
    edits.push([hs, 'glue('], [he, ')']);
    if (arrow >= 0) {
      const re = /[a-z_][A-Za-z0-9_]*/g;
      re.lastIndex = headEnd + 2;
      let m;
      while ((m = re.exec(code)) && m.index < s.end) {
        if (code[m.index - 1] && /[A-Za-z0-9_]/.test(code[m.index - 1])) continue;
        const e = atomEnd(code, m.index);
        if (heads.has(m[0]) && code[m.index + m[0].length] === '(') {
          edits.push([m.index, 'glue('], [e, ')']);
        }
        re.lastIndex = e;
      }
    }
  }
  edits.sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [i, ins] of edits) out = out.slice(0, i) + ins + out.slice(i);
  return out;
}

const DESC = {
  shared: 'Added to every solver.',
  abstraction: 'Proposes candidates (solver A).',
  glue: 'Says which atoms the abstraction and the check share: every glue(T) makes T an interface atom.',
  check: 'Looks for a counterexample to a candidate (solver C). relevant(T) marks the interface atoms the counterexample depends on.',
};

// The cegar.py files mark their sections with banners (%* *** GUESS PROGRAM *** ... *%); after
// the split at #program they sit at the edge of the wrong fragment, so they are dropped.
const BANNER = /%\*[^%]*?\*\*\* [A-Z]+ PROGRAM \*\*\*[^%]*?\*%/g;
const stripBanners = (t) => t.replace(BANNER, '').replace(/\n[ \t]*(\n[ \t]*){2,}/g, '\n\n').replace(/^\s*\n/, '').replace(/\s*$/, '\n');
// Replace text that must be there: a change in the reference file is then noticed.
function cut(text, old, by = '') {
  if (!text.includes(old)) throw new Error(`make-examples: text not found: ${old.slice(0, 60)}`);
  return text.replace(old, by);
}

function make(file, title, description, edit, settings) {
  const p = importLp(src(file), title);
  for (const f of p.fragments) f.text = stripBanners(f.text);
  p.description = description;
  for (const f of p.fragments) f.description = DESC[f.name];
  edit(p);
  p.settings = { ...p.settings, ...settings, constants: { ...(settings.constants || {}) } };
  return p;
}
const frag = (p, n) => p.fragments.find((f) => f.name === n);

export function buildExamples() {
  const gc = make('graph-coloring.lp', 'Graph colouring',
    'Connected graphs with a leaf colouring that no proper 3-colouring extends. The check rules include the ' +
    'added relevant/1 rule, so Shape 1 finds all 10,698 solutions at n = 6. The abstraction also holds the ' +
    '#program refine(k). part used by Shapes 3 and 4.',
    (p) => {
      frag(p, 'glue').text = wrapGlue(frag(p, 'glue').text);
      frag(p, 'check').text = frag(p, 'check').text.replace(/\s*$/, '\n') + FIX;
      frag(p, 'abstraction').text = frag(p, 'abstraction').text.replace(/\s*$/, '\n') + REFINE_PART;
      p.loop.text = template('shape1');
    }, { constants: { n: '6' }, solutions: 0 });
  // three constants-only instances (docs/spec-instances.md); "" = the project as written (n = 6)
  gc.instances = [
    { id: 'n4', facts: '', constants: { n: '4' }, expected: { solutions: 1 }, tags: ['small'] },
    { id: 'n5', facts: '', constants: { n: '5' }, expected: { solutions: 101 }, tags: [] },
    { id: 'n6', facts: '', constants: { n: '6' }, expected: { solutions: 10698 }, tags: ['slow'] },
  ];
  gc.settings.instance = '';
  gc.version = 2;
  const gco = make('graph-coloring.lp', 'Graph colouring (original rules)',
    'The graph colouring example with the relevant/1 rules of the original prototype. These rules are too ' +
    'weak: a refinement can exclude candidates that are solutions, so Shape 1 reports 9,270 solutions at n = 6 ' +
    'instead of 10,698. Compare with the Reference run template, which blocks one candidate at a time.',
    (p) => { frag(p, 'glue').text = wrapGlue(frag(p, 'glue').text); p.loop.text = template('shape1'); },
    { constants: { n: '6' }, solutions: 0 });
  const nash = make('nash.lp', 'Nash equilibria',
    'Weighted graphs whose colouring game has a Nash equilibrium (guessed by the abstraction) that the check ' +
    'tries to refute.',
    (p) => {
      frag(p, 'glue').text = wrapGlue(frag(p, 'glue').text);
      const a = frag(p, 'abstraction'), c = frag(p, 'check');
      a.text = cut(a.text, `% Optional: require that cumulative size of color sets is large
%:- not #count { P,C : color_available(P,C) } >= 10.

`);
      c.text = cut(c.text, '(for stronger refinement using strategy 2)', '(gives a stronger refinement)');
      c.text = cut(c.text, `%%% Refinement strategy 1:
%%% All glue atoms are relevant (trivial refinement)
% relevant(edge(P,Q,W)) :- player(P), player(Q), weight(W).
% relevant(color_available(P,C)) :- player(P), color(C).
% relevant(plays(P,C)) :- player(P), color(C).

%%% Refinement strategy 2:
%%% Only 'neighborhood' of difference is relevant
% relevant(edge(P,Q,W)) :- player(P), player(Q), weight(W), player_differs(P).
% relevant(color_available(P,C)) :- player(P), color(C), player_differs(P).
% adjacent_to_differing_player(P) :- player(P),
%     player(Q), edge(P,Q,_), player_differs(Q).
% relevant(plays(P,C)) :- player(P), color(C), adjacent_to_differing_player(P).

%%% Refinement strategy 3:
%%% Only 'neighborhood' of difference is relevant
%%% (stricter definition of neighborhood)
`, `% Refinement: only the neighbourhood of the difference is relevant
`);
      p.loop.text = template('shape1');
    },
    { solutions: 1 });
  const vote = make('explain1.lp', 'Voting: justifications',
    'Explaining a voting outcome by axioms: the abstraction guesses axiom instances and profiles, the check ' +
    'looks for a profile where they fail.',
    (p) => { p.loop.text = template('shape1'); }, { solutions: 1 });
  return { 'graph-coloring': gc, 'graph-coloring-original': gco, nash, 'voting-justification': vote };
}

// Contributed examples: examples/contrib/*.json, each a project with a top-level
// 'library' block { id, group, summary, shape, tags, expected }. Returns library entries.
// 'problems' (the older name) is sorted by the loop: raw Lua or more than two solvers ->
// several-solvers, else exists-forall.
export const CONTRIB_GROUPS = ['exists-forall', 'several-solvers', 'problems'];
function contribGroup(group, project) {
  if (group !== 'problems') return group;
  const l = project.loop;
  const solvers = l.language === 'lua' ? Infinity : (l.text.match(/^\s*solver\s/gm) || []).length;
  return solvers > 2 ? 'several-solvers' : 'exists-forall';
}
export function loadContrib(dir = new URL('examples/contrib/', root), taken = new Set()) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const name of names) {
    const where = `examples/contrib/${name}`;
    const fail = (msg) => { throw new Error(`${where}: ${msg}`); };
    let raw;
    try { raw = JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8')); } catch (e) { fail(`not JSON: ${e.message}`); }
    const lib = raw && raw.library;
    if (!lib || typeof lib !== 'object') fail('no "library" block');
    const { id, group = 'exists-forall', summary, shape, tags = [], expected = null } = lib;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) fail(`library.id must match [A-Za-z0-9_-]+, got ${JSON.stringify(id)}`);
    if (taken.has(id)) fail(`library.id '${id}' is already used`);
    if (!CONTRIB_GROUPS.includes(group)) fail(`library.group must be one of ${CONTRIB_GROUPS.join(', ')}`);
    if (typeof summary !== 'string' || !summary) fail('library.summary is missing');
    if (typeof shape !== 'string' || !shape) fail('library.shape is missing');
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) fail('library.tags must be a list of strings');
    if (expected !== null && !(Number.isInteger(expected) && expected >= 0)) fail('library.expected must be a whole number or null');
    const { library, ...rest } = raw;
    let project;
    try { project = load(JSON.stringify(rest)); } catch (e) { fail(e.message); }
    taken.add(id);
    out.push({ id, group: contribGroup(group, project), summary, shape, tags, expected, project });
  }
  return out;
}

// All examples and the manifest: { files: { id: project }, manifest }.
export function buildAll({ contribDir } = {}) {
  const problems = buildExamples();
  const entries = buildLibrary(problems['graph-coloring']);
  for (const e of PROBLEMS) entries.push({ ...e, group: 'problems', project: problems[e.id] });
  entries.push(...buildGuide());
  entries.push(...loadContrib(contribDir, new Set(entries.map((e) => e.id))));
  for (const e of entries) {
    if (GENERATORS[e.id]) { e.project.generators = structuredClone(GENERATORS[e.id]); e.project.version = 2; }
    if (RECIPES[e.id]) e.project.instances = [...(e.project.instances || []), ...structuredClone(RECIPES[e.id]).map((x) => ({ constants: {}, ...x }))];
  }
  const files = {};
  const examples = [];
  for (const g of GROUPS) {
    for (const e of entries.filter((x) => x.group === g.id)) {
      files[e.id] = e.project;
      examples.push({ id: e.id, title: e.project.title, group: e.group, summary: e.summary, shape: e.shape,
        tags: e.tags, expected: e.expected == null ? null : { solutions: e.expected },
        ...(e.page ? { page: e.page, status: e.status } : {}), ...(e.baseline ? { baseline: e.baseline } : {}),
        ...(e.variants ? { variants: e.variants } : {}), ...(e.outcome ? { outcome: e.outcome } : {}),
        ...(e.exhausted === false ? { exhausted: false } : {}) });
    }
  }
  return { files, manifest: { format: 'cegarplay-library', version: 1, groups: GROUPS, examples } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = new URL('examples/', root);
  fs.mkdirSync(dir, { recursive: true });
  const { files, manifest } = buildAll();
  for (const [name, p] of Object.entries(files)) {
    fs.writeFileSync(new URL(`${name}.json`, dir), save(p));
  }
  fs.writeFileSync(new URL('library.json', dir), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${Object.keys(files).length} examples and examples/library.json written`);
}
