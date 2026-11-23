// Build examples/*.json from reference/declarative-cegar.   node tools/make-examples.mjs
import fs from 'node:fs';
import { importLp, load, save, template } from '../js/project.js';
import { stripAspComments } from '../js/driver.js';
import { GROUPS, PROBLEMS, buildLibrary, GENERATORS, RECIPES, SUITES, VIEWS, PROJECT_CARDS, EXERCISES, levelOf, VOTE_KIT } from './library.mjs';
import { buildGuide } from './guide.mjs';

const root = new URL('..', import.meta.url);
const src = (f) => fs.readFileSync(new URL(`reference/declarative-cegar/${f}`, root), 'utf8');

export const FIX = `
% A node that is not a leaf now may become one. Giving it a leaf colour other
% than its colour in the counterexample also breaks the counterexample.
relevant(leaf_color(N,C)) :- node(N), not leaf(N), color(C), not color(N,C).
`;
// nash.lp's rules (ii) name edge(P,Q), but edges are edge/3: the rules never fire, and the
// loop loses solutions (the audit finds them from n = 3). The example corrects them.
export function nashFix(text) {
  const bad = 'player(Q), edge(P,Q), plays';
  if (text.split(bad).length !== 3) throw new Error('make-examples: nash rules (ii) not found');
  return text.split(bad).join('player(Q), edge(P,Q,_), plays');
}
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


// voting-justification: explain1.lp keeps its questions as commented-out blocks of facts and
// #const lines (one active). Each block becomes an instance: its facts, its constants, and an
// id from its axioms. VOTE_INFO adds expected counts and tags (measured, see PROGRESS.md).
const VOTE_AXIOMS = `%%% The axioms. An instance switches axioms on with facts use_axiom(A), for A in
%%% pareto, faithfulness, unanimity, cancellation, reinforcement, condorcet,
%%% neutrality2, pos_responsiveness. It also gives the target profile
%%% target_profile(Voter,Candidate,Position) (in lexicographic order), the target
%%% outcome target_outcome(C), optionally requires_polarity_axiom, and the constants
%%% num_candidates, num_voters, num_profiles and num_axiom_instances.
`;
const VOTE_SHORT = { pareto: 'pareto', faithfulness: 'faith', unanimity: 'unanimity', cancellation: 'cancel',
  reinforcement: 'reinf', condorcet: 'condorcet', neutrality2: 'neutral', pos_responsiveness: 'posresp' };
const VOTE_DEFAULT = 'cancel-reinf-posresp-k4';
const VOTE_NOTES = {
  UNSAT: 'No justification exists with these bounds: the run ends without a solution.',
  'FOR EFFICIENCY, NEEDS 2-STEP PROCEDURE (FIRST FINDING PROFILES)': 'Hard: the original file notes that it needs a two-step procedure (first finding the profiles).',
};
// Measured with node tools/run.mjs voting-justification --instance ID --solutions all.
export const VOTE_INFO = {
  'faith-k1': { expected: 1 }, 'condorcet-k1': { expected: 1 }, 'unanimity-k1': { expected: 1 },
  'cancel-k1': { expected: 1 }, 'pareto-k2-v1': { expected: 1 }, 'pareto-k2': { expected: 1 },
  'pareto-neutral-k2': { expected: 1 }, 'faith-reinf-k2': { expected: 1 }, 'cancel-posresp-k2': { expected: 2 },
  'faith-reinf-k3': { expected: 2 }, 'faith-cancel-reinf-k3': { expected: 1 },
  'faith-cancel-reinf-pareto-condorcet-k3': { expected: 0, tags: ['no-solution'] },
  'faith-cancel-reinf-pareto-k3': { expected: 1 }, 'faith-pareto-neutral-reinf-k4': { expected: 1 },
  'pareto-neutral-reinf-k5': { expected: 1 },
  // the question the original file has switched on: the first solution in a second; all 16 with
  // strategy s1 in about 15 minutes (exhausted, Nov 2026), so it is tagged slow. Both hard
  // questions are too large for the audit (audit: false).
  'cancel-reinf-posresp-k4': { expected: 16, tags: ['original', 'slow'], audit: false },
  'pareto-neutral-cancel-reinf-k8': { tags: ['hard'], audit: false },
};
function voteInstances(blocks) {
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const comment = lines.filter((l) => /^% %/.test(l)).map((l) => l.replace(/^% %\s*/, '')).join(' ');
    const body = lines.filter((l) => !/^% %/.test(l)).map((l) => l.replace(/^%\s*/, ''));
    if (!body.length) continue;
    const constants = {}, facts = [];
    for (const l of body) {
      const m = l.match(/^#const\s+(\w+)\s*=\s*(\w+)\s*\.$/);
      if (m) constants[m[1]] = m[2];
      else if (/^[a-z_]+(\(.*\))?\.$/.test(l)) facts.push(l);
      else throw new Error(`make-examples: unexpected line in a voting block: ${l}`);
    }
    const axioms = facts.map((f) => (f.match(/^use_axiom\((\w+)\)\.$/) || [])[1]).filter(Boolean);
    const outcome = facts.map((f) => (f.match(/^target_outcome\((\d+)\)\.$/) || [])[1]).filter(Boolean);
    let id = `${axioms.map((a) => VOTE_SHORT[a]).join('-')}-k${constants.num_axiom_instances}`;
    if (out.some((x) => x.id === id)) id += `-v${constants.num_voters}`;
    const voters = new Set(facts.map((f) => (f.match(/^target_profile\((\d+),/) || [])[1]).filter(Boolean)).size;
    const s = (n, w) => `${n} ${w}${n === '1' || n === 1 ? '' : 's'}`;
    const note = VOTE_NOTES[comment.toUpperCase()];
    if (comment && !note) throw new Error(`make-examples: no note for the voting comment ${comment}`);
    const head = `% Axioms: ${axioms.join(', ')}. Target: a profile of ${s(voters, 'voter')} with outcome ` +
      `{${outcome.join(', ')}}. Up to ${s(constants.num_voters, 'voter')} per profile, ` +
      `${s(constants.num_profiles, 'profile')}, exactly ${s(constants.num_axiom_instances, 'axiom instance')}.\n` +
      (note ? `% ${note}\n` : '');
    const info = VOTE_INFO[id] || {};
    out.push({ id, facts: head + facts.join('\n') + '\n', constants,
      ...(info.expected !== undefined ? { expected: { solutions: info.expected } } : {}), tags: info.tags || [],
      ...(info.audit === false ? { audit: false } : {}) });
  }
  const key = (x) => [+x.constants.num_axiom_instances, +x.constants.num_profiles, +x.constants.num_voters];
  return out.sort((a, b) => { const p = key(a), q = key(b); return p[0] - q[0] || p[1] - q[1] || p[2] - q[2]; });
}

// voting-justification: the check of explain1.lp ends with five refinement strategies (one
// active, four commented out). Each becomes a fragment relevant_sN; the fragment `relevant`
// (in the check solver) holds the active one, strategy 2, and a variant per other strategy swaps
// its text in. Two more variants change the loop: Shape 2, and the Reference run.
const VOTE_STRATEGY = {
  1: 'the axiom instances the outcomes falsify',
  2: 'the axiom instances the outcomes do not falsify',
  3: 'the axiom instances the candidate does not use',
  4: 'the axiom instances the candidate uses',
  5: 'every possible axiom instance',
};
const VOTE_LOOP_HEAD = `solver A = shared + abstraction
solver C = shared + check + relevant   options "--heuristic=Domain"
link   G = A -> C via shared + glue
`;
// The project kit of voting-justification (FUTURE-DIRECTIONS E1, E2): the readme field.
const VOTE_README = `# Explaining a voting outcome by axioms

## Background

A *justification* of an election outcome explains it from normative principles (axioms) such
as Pareto, faithfulness or reinforcement: given a target profile and its outcome, find a small set
of *axiom instances* (an axiom applied to one, two or three concrete profiles) such that every
voting rule that satisfies them must give the target profile that outcome. The idea is from
Boixel and Endriss (AAMAS 2020) and Nardi, Boixel and Endriss (AAMAS 2022); the ASP encoding is
\`explain1.lp\` of the declarative-cegar repository.

The problem is Σ2P-shaped: *there is* a set of axiom instances (with the profiles they need) such
that *every* outcome assignment that satisfies them gives the target outcome. That is a CEGAR loop.

## The loop

- **Abstraction (A)**: guesses up to \`num_profiles\` profiles (profile 1 is the target) and exactly
  \`num_axiom_instances\` applicable axiom instances on them, with symmetry breaking.
- **Check (C)**: looks for outcomes of all profiles that satisfy every chosen axiom instance but
  differ from the target outcome on profile 1. Such outcomes are the counterexample.
- **Refinement**: a clause over the interface atoms that are \`relevant/1\` for the counterexample.
  The five strategies differ in which axiom-instance atoms they call relevant (fragments
  \`relevant\`, \`relevant_s1\` … \`relevant_s5\`). Strategy 2 is the default.

## Baseline and variants

| Variant | What changes |
|---|---|
| default | Shape 1 (\`search A\`), strategy 2 |
| s1, s3, s4, s5 | another refinement strategy |
| record | Shape 1 with \`--enum-mode=record\` on A: blocked candidates stay as nogoods |
| shape2 | a Shape 2 loop (solve A again after each refinement) |
| reference | the blocking loop: the ground truth on small questions |

## Instances and ground truth

- 17 questions from \`explain1.lp\` (tags: \`original\`, \`hard\`, \`no-solution\`). The 15 with an
  expected count finish in seconds; the counts agree with the reference variant and with
  \`tools/cegarcheck.py\`.
- Three generated questions (\`random-1\` … \`random-3\`, generator \`vote-question\`: \`a\` random
  axioms, a sorted random target profile of \`v\` voters, a random outcome). Most random questions
  have no justification within small bounds, which is itself a useful test of soundness.
- The two hard questions are marked \`audit: false\`: their candidate spaces are far too large to
  enumerate, so the audit (and Fuzz) skip them; runs still use them. \`cancel-reinf-posresp-k4\` (the
  question the original file has switched on) finds its first justification in about a second;
  with strategy s1 the loop finishes after about 95,000 candidates and 15 minutes with
  **16 justifications**, its expected count (tag \`slow\`). \`pareto-neutral-cancel-reinf-k8\` has
  no ground truth yet: neither the default strategy, s1 nor Python clingo's \`tools/cegarcheck.py\`
  finished it within 40 minutes.

## Suites

- \`questions\`: every question, the default loop (20 s each).
- \`strategies\`: the 15 questions with a count × every variant (30 s each). Read the
  instance × variant matrix in the Campaign tab, or run
  \`node tools/bench.mjs voting-justification --suite strategies --out rows.jsonl\` and
  \`node tools/report.mjs rows.jsonl\`.
- \`generated\`: 12 generated questions (v = 2, 3; a = 2, 3; three seeds) × default, s1, record,
  reference.

## What "better" means

Fewer candidates (each costs a check), less time, and more questions solved within the limit.
A variant that finds a *different* number of justifications than the reference is unsound
(or the reference has not finished): the Campaign tab marks those cells ✗.

## Measured (tools/bench.mjs, one machine, Nov 2026)

Suite \`strategies\` (15 questions × 8 variants, 30 s limit): every cell finishes and every variant
agrees with the reference. Eleven questions need at most 9 candidates in every variant; the four
others separate the strategies (candidates):

| question | default | s1 | s3 | s4 | s5 | shape2 | record | reference |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| faith-cancel-reinf-pareto-condorcet-k3 | 2,132 | **770** | 2,117 | 2,134 | 2,123 | 2,093 | 2,132 | 2,123 |
| faith-cancel-reinf-pareto-k3 | 1,364 | **405** | 1,415 | 1,341 | 1,407 | 1,329 | 1,329 | 1,407 |
| faith-pareto-neutral-reinf-k4 | 146 | **44** | 146 | 146 | 146 | 146 | 146 | 146 |
| pareto-neutral-reinf-k5 | 48 | **38** | 48 | 48 | 48 | 48 | 48 | 48 |

Total time: s1 4.2 s, default 6.1 s, reference 6.0 s, shape2 19.9 s. Strategy 1 (the axiom
instances the outcomes falsify) is the only one that beats blocking; the default strategy 2 is
no better than the reference run here. Suite \`generated\` (12 questions): s1 9.8 s in total,
reference 36.9 s, record 43.0 s, default 49.6 s. Why strategy 2 gains nothing over blocking is a
good first question.

## Open questions

1. Which strategy wins on which kind of question, and why? Relate the matrix to the axioms each
   question uses (instances whose axioms link two or three profiles behave differently).
2. Can a refinement be *lifted* over symmetric profiles (permuting voters or candidates), so that
   one counterexample rules out many candidates? Measure the clause lengths (Statistics tab).
3. Does Shape 2, or a rule refinement (\`G.rule\`), pay on the hard questions?
4. The hard questions (\`cancel-reinf-posresp-k4\`, \`pareto-neutral-cancel-reinf-k8\`): what
   change to the abstraction (symmetry breaking, a bound on the profiles, a two-step search that
   first fixes the profiles, as the original file suggests) makes them finish?
5. Is every strategy sound? Run the audit (Audit button, or \`node tools/audit.mjs
   voting-justification --instance ID\`) on small questions and grow them with Fuzz.
`;

function voteStrategies(p) {
  const c = frag(p, 'check');
  const at = c.text.indexOf('% %%% REFINEMENT STRATEGY 1');
  if (at < 0) throw new Error('make-examples: voting strategies not found');
  const tail = c.text.slice(at);
  c.text = c.text.slice(0, at).replace(/\s*$/, '\n');
  const parts = tail.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 5) throw new Error(`make-examples: ${parts.length} voting strategies, expected 5`);
  const text = {};
  for (const part of parts) {
    const lines = part.split('\n').map((l) => l.replace(/^% ?/, ''));
    const n = Number((lines[0].match(/REFINEMENT STRATEGY (\d)/) || [])[1]);
    if (!VOTE_STRATEGY[n]) throw new Error(`make-examples: bad voting strategy header ${lines[0]}`);
    text[n] = `% Refinement strategy ${n}: every profile atom is relevant, and of the axiom-instance\n` +
      `% atoms ${VOTE_STRATEGY[n]}.\n` + lines.slice(1).join('\n') + '\n';
  }
  const idx = p.fragments.indexOf(c);
  const desc = (n) => `Refinement strategy ${n} for the check (relevant/1). ` +
    (n === 2 ? 'Used by the default loop.' : `Swapped in by the variant s${n}.`);
  p.fragments.splice(idx + 1, 0,
    { name: 'relevant', text: text[2], description: 'The relevant/1 rules of the check: strategy 2 (the variants s1, s3, s4, s5 swap in another).' },
    ...[1, 3, 4, 5].map((n) => ({ name: `relevant_s${n}`, text: text[n], description: desc(n) })));
  p.loop.text = VOTE_LOOP_HEAD + `
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
`;
  p.variants = [
    ...[1, 3, 4, 5].map((n) => ({ name: `s${n}`, swap: { relevant: `relevant_s${n}` }, constants: {} })),
    { name: 'shape2', swap: {}, constants: {}, loop: { language: 'loop', text: VOTE_LOOP_HEAD + `
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        A.add(G.block(M))
` } },
    // Shape 1 with clasp's record enumeration: blocked candidates are kept as nogoods, so the
    // abstraction prunes more (manual, "Shape 1")
    { name: 'record', swap: {}, constants: {}, loop: { language: 'loop', text: VOTE_LOOP_HEAD.replace('solver A = shared + abstraction', 'solver A = shared + abstraction   options "--enum-mode=record"') + `
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
` } },
    { name: 'reference', swap: {}, constants: {}, loop: { language: 'loop', text: VOTE_LOOP_HEAD + `
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.block(M)
` } },
  ];
}

export function buildExamples() {
  const gc = make('graph-coloring.lp', 'Graph colouring',
    'Connected graphs with a leaf colouring that no proper 3-colouring extends. Shape 1 finds all 10,698 ' +
    'solutions at n = 6. The abstraction also holds the #program refine(k). part used by Shapes 3 and 4.',
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
  const nash = make('nash.lp', 'Nash equilibria',
    'Weighted graphs whose colouring game has a Nash equilibrium (guessed by the abstraction) that the check ' +
    'tries to refute. Instances: the number of players n and of edge weights w.',
    (p) => {
      frag(p, 'glue').text = wrapGlue(frag(p, 'glue').text);
      frag(p, 'check').text = nashFix(frag(p, 'check').text);
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
    'looks for outcomes that satisfy them but differ from the target outcome. Each instance is one question: ' +
    'a set of axioms, a target profile and its outcome (Instances tab).',
    (p) => {
      const sh = frag(p, 'shared');
      sh.text = cut(sh.text, `%%% Declare axioms
% #external use_axiom(pareto).
% #external use_axiom(faithfulness).
% #external use_axiom(cancellation).
% #external use_axiom(reinforcement).
% #external use_axiom(condorcet).
% #external use_axiom(neutrality2).
% #external use_axiom(pos_responsiveness).

% use_axiom(pareto).
% use_axiom(faithfulness).
% use_axiom(cancellation).
% use_axiom(reinforcement).
% use_axiom(condorcet).
% use_axiom(neutrality2).
% use_axiom(pos_responsiveness).
`, VOTE_AXIOMS);
      const at = sh.text.indexOf('%* *******************************\n*** Target profile');
      if (at < 0) throw new Error('make-examples: voting target section not found');
      const blocks = sh.text.slice(at).split(/\n\s*\n/).slice(1);
      sh.text = sh.text.slice(0, at).replace(/\s*$/, '\n');
      for (const c of ['num_candidates', 'num_voters', 'num_profiles', 'num_axiom_instances'])
        sh.text = cut(sh.text, `% #const ${c}=3.\n`, '');
      p.instances = voteInstances(blocks);
      p.settings.instance = VOTE_DEFAULT;
      p.version = 2;
      voteStrategies(p);
      // drop the source's notes to itself: paper links, a to-do list, a commented-out
      // constraint and a commented-out glue rule
      const ab = frag(p, 'abstraction');
      ab.text = cut(ab.text, `% https://staff.fnwi.uva.nl/u.endriss/pubs/files/BoixelEndrissAAMAS2020.pdf
% https://staff.fnwi.uva.nl/u.endriss/pubs/files/NardiEtAlAAMAS2022.pdf

%* *** TODO's ***
- finish comments
- 'Borda' constraints on choices, also for plurality, etc.
- neutrality/3
*************** *%

`);
      ab.text = cut(ab.text, `% %%% Redundant constraint: provide upper bound on number of profiles to use
% %%% (SEEMS NOT TO GIVE A GOOD TRADEOFF)
% max_num_profiles(S) :-
%     S2 = #sum { 1,Prof1,Prof2,Axiom :
%         use_axiom_instance(double(Prof1,Prof2),Axiom) },
%     S3 = #sum { 2,Prof1,Prof2,Prof3,Axiom :
%         use_axiom_instance(triple(Prof1,Prof2,Prof3),Axiom) },
%     S = 1 + S2 + S3.
% :- max_num_profiles(S), profile_used(S+1).

`);
      const gl = frag(p, 'glue');
      gl.text = cut(gl.text, `
% glue(axiom_applicable(Profiles,Axiom) :- pos_axiom_instance(Profiles,Axiom).
`);
    }, { solutions: 1 });
  vote.settings.constants = { ...vote.instances.find((i) => i.id === VOTE_DEFAULT).constants };
  vote.readme = VOTE_README;
  vote.generators = structuredClone(VOTE_KIT.generators);
  vote.instances.push(...structuredClone(VOTE_KIT.recipes).map((x) => ({ constants: {}, ...x })));
  vote.fragments.push({ name: 'view', text: VIEWS['voting-justification'], description: 'A domain view (Observatory tab): the scene part draws what stays, the frame part one step, as draw/1 marks.' });
  vote.views = [{ name: 'view', fragments: ['shared', 'view'] }];
  vote.suites = [
    { name: 'questions', instances: { ids: 'all' }, limits: { seconds: 20 } },
    // every refinement strategy and loop on the questions that finish
    { name: 'strategies', instances: { ids: vote.instances.filter((i) => i.expected && !i.tags.includes('slow')).map((i) => i.id) },
      variants: ['default', ...vote.variants.map((v) => v.name)], limits: { seconds: 30 } },
    // generated questions (the generator vote-question) with small bounds
    { name: 'generated', instances: { generator: 'vote-question', grid: { v: [2, 3], a: [2, 3] }, seeds: 3,
      constants: { num_candidates: 3, num_voters: 3, num_profiles: 3, num_axiom_instances: 3 } },
      variants: ['default', 's1', 'record', 'reference'], limits: { seconds: 30 } },
  ];
  // constants-only instances; "" = the project as written (n = 5, w = 3). Counts agree with the
  // Reference loop (cegarcheck --mode block) and the audit is sound on each.
  nash.instances = [
    { id: 'n2-w1', facts: '', constants: { n: '2', w: '1' }, expected: { solutions: 12 }, tags: ['small'] },
    { id: 'n2', facts: '', constants: { n: '2' }, expected: { solutions: 36 }, tags: [] },
    { id: 'n3-w1', facts: '', constants: { n: '3', w: '1' }, expected: { solutions: 576 }, tags: [] },
    { id: 'n3-w2', facts: '', constants: { n: '3', w: '2' }, expected: { solutions: 4080 }, tags: ['slow'] },
  ];
  nash.settings.instance = '';
  nash.version = 2;
  nash.readme = PROJECT_CARDS.nash;
  return { 'graph-coloring': gc, nash, 'voting-justification': vote };
}

// Contributed examples: examples/contrib/*.json, each a project with a top-level
// 'library' block { id, group, summary, shape, tags, expected }. Returns library entries.
// The group is a category (CATEGORIES). The older names exists-forall, problems and
// several-solvers still load, into the group other.
export const CATEGORIES = ['logic', 'reasoning', 'graphs', 'games', 'planning', 'puzzles'];
export const CONTRIB_GROUPS = [...CATEGORIES, 'other', 'exists-forall', 'problems', 'several-solvers'];
function contribGroup(group) {
  return CATEGORIES.includes(group) ? group : 'other';
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
    const { id, group = 'other', summary, shape, tags = [], expected = null, optimum = null, level = null, after = null } = lib;
    if (level !== null && !(Number.isInteger(level) && level >= 1 && level <= 4)) fail('library.level must be 1, 2, 3 or 4');
    if (after !== null && !(Number.isInteger(after) && after >= 1)) fail('library.after must be a guide chapter number or null');
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) fail(`library.id must match [A-Za-z0-9_-]+, got ${JSON.stringify(id)}`);
    if (taken.has(id)) fail(`library.id '${id}' is already used`);
    if (!CONTRIB_GROUPS.includes(group)) fail(`library.group must be one of ${CONTRIB_GROUPS.join(', ')}`);
    if (typeof summary !== 'string' || !summary) fail('library.summary is missing');
    if (typeof shape !== 'string' || !shape) fail('library.shape is missing');
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) fail('library.tags must be a list of strings');
    if (expected !== null && !(Number.isInteger(expected) && expected >= 0)) fail('library.expected must be a whole number or null');
    if (optimum !== null && !(Number.isInteger(optimum) || (Array.isArray(optimum) && optimum.length && optimum.every(Number.isInteger)))) fail('library.optimum must be a whole number, a list of them, or null');
    const { library, ...rest } = raw;
    let project;
    try { project = load(JSON.stringify(rest)); } catch (e) { fail(e.message); }
    taken.add(id);
    out.push({ id, group: contribGroup(group), summary, shape, tags, expected, optimum, project, ...(level !== null ? { level } : {}), ...(after !== null ? { after } : {}) });
  }
  return out;
}

// What a project has beyond fragments and a loop, for the library list: { has: { instances: 3, ... } }.
function features(p) {
  const has = {};
  for (const k of ['instances', 'generators', 'suites', 'views']) if ((p[k] || []).length) has[k] = p[k].length;
  if (typeof p.readme === 'string' && p.readme.trim()) has.readme = 1;
  return Object.keys(has).length ? { has } : {};
}

// All examples and the manifest: { files: { id: project }, manifest }.
export function buildAll({ contribDir } = {}) {
  const problems = buildExamples();
  const entries = buildLibrary(problems['graph-coloring']);
  for (const e of PROBLEMS) entries.push({ ...e, project: problems[e.id] });
  entries.push(...buildGuide());
  for (const x of EXERCISES) {
    const base = entries.find((e) => e.id === x.base);
    const p = structuredClone(base.project);
    p.title = x.title;
    p.description = x.description;
    p.fragments = p.fragments.filter((f) => f.name !== 'view');
    p.instances = structuredClone(x.instances);
    p.settings = { ...p.settings, instance: x.instances[0].id };
    p.exercise = { text: x.text, ...structuredClone(x.exercise) };
    p.version = 2;
    entries.push({ id: x.id, group: 'exercises', summary: x.summary, shape: 'shape1', tags: ['exercise'], expected: null, project: p });
  }
  entries.push(...loadContrib(contribDir, new Set(entries.map((e) => e.id))));
  for (const e of entries) {
    if (GENERATORS[e.id]) { e.project.generators = structuredClone(GENERATORS[e.id]); e.project.version = 2; }
    if (SUITES[e.id]) {
      const x = structuredClone(SUITES[e.id]);
      for (const v of x.variants || []) if (v.loop && v.loop.text === 'REFERENCE') v.loop.text = template('reference');
      if (x.variants) e.project.variants = [...(e.project.variants || []), ...x.variants.map((v) => ({ swap: {}, constants: {}, ...v }))];
      e.project.suites = [...(e.project.suites || []), ...x.suites];
      e.project.version = 2;
    }
    if (VIEWS[e.id] && !e.project.fragments.some((f) => f.name === 'view')) {
      e.project.fragments.push({ name: 'view', text: VIEWS[e.id], description: 'A domain view (Observatory tab): the scene part draws what stays, the frame part one step, as draw/1 marks.' });
      const base = e.project.fragments.some((f) => f.name === 'shared') ? ['shared', 'view'] : ['view'];
      e.project.views = [{ name: 'view', fragments: base }];
      e.project.version = 2;
    }
    if (PROJECT_CARDS[e.id]) e.project.readme = PROJECT_CARDS[e.id];
    if (e.project.readme && !(e.tags || []).includes('project')) e.tags = [...(e.tags || []), 'project'];
    if (RECIPES[e.id]) e.project.instances = [...(e.project.instances || []), ...structuredClone(RECIPES[e.id]).map((x) => ({ constants: {}, ...x }))];
  }
  const files = {};
  const examples = [];
  for (const g of GROUPS) {
    for (const e of entries.filter((x) => x.group === g.id)) {
      files[e.id] = e.project;
      examples.push({ id: e.id, title: e.project.title, group: e.group, summary: e.summary, shape: e.shape,
        tags: e.tags, expected: e.expected == null && e.optimum == null ? null : { solutions: e.expected ?? null, ...(e.optimum != null ? { optimum: e.optimum } : {}) },
        ...(e.page ? { page: e.page, status: e.status } : {}), ...(e.baseline ? { baseline: e.baseline } : {}),
        ...(e.variants ? { variants: e.variants } : {}), ...(e.outcome ? { outcome: e.outcome } : {}),
        ...(e.exhausted === false ? { exhausted: false } : {}), ...features(e.project), ...levelOf(e) });
    }
  }
  // a group without examples (such as the fallback 'other') is left out
  const groups = GROUPS.filter((g) => examples.some((e) => e.group === g.id));
  return { files, manifest: { format: 'cegarplay-library', version: 1, groups, examples } };
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
