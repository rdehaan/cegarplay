// Build examples/*.json from reference/declarative-cegar.   node tools/make-examples.mjs
import fs from 'node:fs';
import { importLp, save, template } from '../js/project.js';
import { stripAspComments } from '../js/driver.js';
import { GROUPS, PROBLEMS, buildLibrary } from './library.mjs';

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

function make(file, title, description, edit, settings) {
  const p = importLp(src(file), title);
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
  const gco = make('graph-coloring.lp', 'Graph colouring (original rules)',
    'The graph colouring example with the relevant/1 rules of the original prototype. These rules are too ' +
    'weak: a refinement can exclude candidates that are solutions, so Shape 1 reports 9,270 solutions at n = 6 ' +
    'instead of 10,698. Compare with the Reference run template, which blocks one candidate at a time.',
    (p) => { frag(p, 'glue').text = wrapGlue(frag(p, 'glue').text); p.loop.text = template('shape1'); },
    { constants: { n: '6' }, solutions: 0 });
  const nash = make('nash.lp', 'Nash equilibria',
    'Weighted graphs whose colouring game has a Nash equilibrium (guessed by the abstraction) that the check ' +
    'tries to refute.',
    (p) => { frag(p, 'glue').text = wrapGlue(frag(p, 'glue').text); p.loop.text = template('shape1'); },
    { solutions: 1 });
  const vote = make('explain1.lp', 'Voting: justifications',
    'Explaining a voting outcome by axioms: the abstraction guesses axiom instances and profiles, the check ' +
    'looks for a profile where they fail.',
    (p) => { p.loop.text = template('shape1'); }, { solutions: 1 });
  return { 'graph-coloring': gc, 'graph-coloring-original': gco, nash, 'voting-justification': vote };
}

// All examples and the manifest: { files: { id: project }, manifest }.
export function buildAll() {
  const problems = buildExamples();
  const entries = buildLibrary(problems['graph-coloring']);
  for (const e of PROBLEMS) entries.push({ ...e, group: 'problems', project: problems[e.id] });
  const files = {};
  const examples = [];
  for (const g of GROUPS) {
    for (const e of entries.filter((x) => x.group === g.id)) {
      files[e.id] = e.project;
      examples.push({ id: e.id, title: e.project.title, group: e.group, summary: e.summary, shape: e.shape,
        tags: e.tags, expected: e.expected == null ? null : { solutions: e.expected } });
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
