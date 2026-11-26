// Build examples/*.json from reference/declarative-cegar.   node tools/make-examples.mjs
import fs from 'node:fs';
import { importLp, load, save, template } from '../js/project.js';
import { stripAspComments } from '../js/driver.js';
import { GROUPS, PROBLEMS, buildLibrary, GENERATORS, RECIPES, SUITES, VIEWS, PROJECT_CARDS, EXERCISES, levelOf, VOTE_KIT, EXTRAS, SPACES, SYMBOLIC } from './library.mjs';
import { compile } from '../js/compiler.js';
import { boundedPlan } from '../js/driver.js';
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
const VOTE_DEFAULT = 'faith-pareto-neutral-reinf-k4';
const VOTE_NOTES = {
  UNSAT: 'No justification exists with these bounds: the run ends without a solution.',
  'FOR EFFICIENCY, NEEDS 2-STEP PROCEDURE (FIRST FINDING PROFILES)': 'Hard: the original file notes that it needs a two-step procedure (first finding the profiles).',
};
// Measured with node tools/run.mjs voting-justification --instance ID --solutions all.
// Questions whose abstraction has one or two candidates (no refinement at all) are left out
// (VOTE_TRIVIAL); the two k3 questions with thousands of candidates are too large for the
// audit's memory (audit: false).
export const VOTE_TRIVIAL = ['faith-k1', 'condorcet-k1', 'unanimity-k1', 'cancel-k1', 'pareto-k2-v1', 'pareto-k2',
  'pareto-neutral-k2', 'faith-reinf-k2', 'faith-reinf-k3', 'faith-cancel-reinf-k3'];
export const VOTE_INFO = {
  'cancel-posresp-k2': { expected: 2 },
  'faith-cancel-reinf-pareto-condorcet-k3': { expected: 0, tags: ['no-solution'], audit: false },
  'faith-cancel-reinf-pareto-k3': { expected: 1, audit: false }, 'faith-pareto-neutral-reinf-k4': { expected: 1 },
  'pareto-neutral-reinf-k5': { expected: 1 },
  // the question the original file has switched on: the first solution in a second; all 16 with
  // strategy s1 in about 15 minutes (exhausted, Nov 2026), so it is tagged slow. Both hard
  // questions are too large for the audit (audit: false).
  'cancel-reinf-posresp-k4': { expected: 16, tags: ['original', 'slow'], audit: false },
};
// Left out on request: the file's hardest question (k = 8, profiles of up to 5 voters) has no
// ground truth (no loop finished it in 40 minutes), so it tests nothing.
export const VOTE_DROPPED = ['pareto-neutral-cancel-reinf-k8'];

// voting-justification: questions from Nardi, Boixel and Endriss (AAMAS 2022), over the paper's
// corpus of six axioms. Each is [id, ballots, outcome, k, profiles, expected, tags, note]: the
// target profile as ballots ('abc' ranks a over b over c), the target outcome, the exact number
// of axiom instances, the number of profiles. Profiles have at most as many voters as the target
// (the paper's weak reinforcement). k is the smallest with a justification, so every solution is
// a smallest justification; a larger k also counts padded ones (two identical voters: 2 at k = 2,
// 82 at k = 3, 2,429 at k = 4). Counts agree between s1, s6-multi, deepen and profiles-first (and
// the reference run where it finishes), Nov 2026.
const VOTE_CORPUS = ['faithfulness', 'pareto', 'cancellation', 'neutrality2', 'pos_responsiveness', 'reinforcement'];
const VOTE_TWO = 'Two voters, as in the exhaustive rows of the paper\'s Table 1; the target is the Borda outcome.';
const VOTE_FOUR = 'Four alternatives, as in the lower half of the paper\'s Table 1; the target is the Borda outcome.';
export const VOTE_PAPER = [
  ['paper-ex1-k2-p3', ['abc', 'bac'], 'ab', 2, 3, 1, [], 'Example 1 of the paper: Pareto rules c out, neutrality between a and b gives {a, b}.'],
  ['paper-v2-same-k2-p3', ['abc', 'abc'], 'a', 2, 3, 2, [], VOTE_TWO],
  ['paper-v2-acb-k2-p3', ['abc', 'acb'], 'a', 2, 3, 5, [], VOTE_TWO],
  ['paper-v2-bca-k2-p4', ['abc', 'bca'], 'b', 2, 4, 2, [], VOTE_TWO],
  ['paper-v2-cab-k2-p4', ['abc', 'cab'], 'a', 2, 4, 2, [], VOTE_TWO],
  ['paper-v2-cba-k1-p3', ['abc', 'cba'], 'abc', 1, 3, 1, [], VOTE_TWO + ' Cancellation alone.'],
  ['paper-ex4-k3-p3', ['abc', 'abc', 'cba'], 'a', 3, 3, 1, [], 'Example 4 of the paper: a one-voter profile (faithfulness) and a cancelling pair (cancellation), joined by reinforcement.'],
  ['paper-ex4-k3-p4', ['abc', 'abc', 'cba'], 'a', 3, 4, 1, ['bench'], 'Example 4 of the paper with room for one more profile.'],
  ['paper-borda3-k3-p3', ['abc', 'cab', 'cab'], 'ac', 3, 3, 0, ['slow'], 'Section 4.2 of the paper: the Borda outcome {a, c} has no justification with profiles of at most three voters.'],
  ['paper-borda3-k3-p4', ['abc', 'cab', 'cab'], 'ac', 3, 4, 0, ['bench'], 'Section 4.2 of the paper: no justification, with room for one more profile.'],
  ['paper-borda4-k3-p3', ['abc', 'cab', 'cab', 'cab'], 'c', 3, 3, 0, ['slow'], 'Section 4.2 of the paper: the Borda winner c has no justification with profiles of at most four voters.'],
  ['paper-borda4-k3-p4', ['abc', 'cab', 'cab', 'cab'], 'c', 3, 4, 0, ['bench'], 'Section 4.2 of the paper: no justification, with room for one more profile.'],
  ['paper-cycle-k2-p3', ['abc', 'bca', 'cab'], 'abc', 2, 3, 3, [], 'A Condorcet cycle: every candidate wins.'],
  ['paper-v4-k4-p3', ['abc', 'acb', 'bca', 'cab'], 'a', 4, 3, 10, ['slow'], 'Four voters; the target is the Borda winner.'],
  ['paper-c4-v2-k3-p3', ['abcd', 'badc'], 'ab', 3, 3, 4, ['bench'], VOTE_FOUR],
  ['paper-c4-v2b-k3-p3', ['abcd', 'bcda'], 'b', 3, 3, 0, ['slow'], VOTE_FOUR],
  ['paper-c4-v3-k3-p3', ['abcd', 'abcd', 'dcba'], 'a', 3, 3, 1, ['slow'], VOTE_FOUR],
];
// Tags: bench where the default loop (strategy 2) does not finish within a minute (suites only,
// never the tests), slow where it needs more than 5 s (tests with SLOW=1 only).
// Too large for the explicit audit and Fuzz (the symbolic audit needs 20 s to over a minute)
const VOTE_PAPER_HEAVY = ['paper-ex4-k3-p3', 'paper-ex4-k3-p4', 'paper-borda3-k3-p3', 'paper-borda3-k3-p4', 'paper-borda4-k3-p3',
  'paper-borda4-k3-p4', 'paper-v4-k4-p3', 'paper-c4-v2-k3-p3', 'paper-c4-v2b-k3-p3', 'paper-c4-v3-k3-p3'];
function votePaperInstance([id, ballots, outcome, k, np, expected, tags, note]) {
  const m = ballots[0].length;
  const num = (c) => c.charCodeAt(0) - 96;
  const lex = (x, y) => { for (let i = 0; i < m; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const sorted = ballots.map((b) => [...b].map(num)).sort(lex);
  const facts = VOTE_CORPUS.map((a) => `use_axiom(${a}).`);
  sorted.forEach((b, v) => b.forEach((c, pos) => facts.push(`target_profile(${v + 1},${c},${pos + 1}).`)));
  for (const o of outcome) facts.push(`target_outcome(${num(o)}).`);
  // every justification of an outcome other than all candidates uses a polarity axiom
  if (outcome.length < m) facts.push('requires_polarity_axiom.');
  const s = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const head = `% ${note}\n% Profile: ${ballots.join(', ')} (letters a, b, ... are candidates 1, 2, ...); outcome {${[...outcome].join(', ')}}.\n` +
    `% Axioms: the paper's corpus. Up to ${s(ballots.length, 'voter')} per profile, ${s(np, 'profile')}, ` +
    `exactly ${s(k, 'axiom instance')}.\n`;
  return { id, facts: head + facts.join('\n') + '\n',
    constants: { num_candidates: String(m), num_voters: String(ballots.length), num_profiles: String(np), num_axiom_instances: String(k) },
    ...(expected !== null ? { expected: { solutions: expected } } : {}), tags: ['paper', ...(expected === 0 ? ['no-solution'] : []), ...tags],
    ...(VOTE_PAPER_HEAVY.includes(id) ? { audit: false } : {}) };
}
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
    if (VOTE_TRIVIAL.includes(id) || VOTE_DROPPED.includes(id)) continue;
    const info = VOTE_INFO[id] || {};
    out.push({ id, facts: head + facts.join('\n') + '\n', constants,
      ...(info.expected !== undefined ? { expected: { solutions: info.expected } } : {}), tags: info.tags || [],
      ...(info.audit === false ? { audit: false } : {}) });
  }
  const key = (x) => [+x.constants.num_axiom_instances, +x.constants.num_profiles, +x.constants.num_voters];
  return out.sort((a, b) => { const p = key(a), q = key(b); return p[0] - q[0] || p[1] - q[1] || p[2] - q[2]; });
}

// voting-justification: the check of explain1.lp ends with five refinement strategies (one
// active, four commented out). The fragment `relevant` (in the check solver) holds the active one,
// strategy 2; strategy 1 becomes relevant_falsified (variant falsified; it was s1 until Nov 2026). Strategies 3, 4 and 5 were dropped on
// request (Nov 2026; s5 is close to blocking), as were the variants shape2 and record. The
// variant reference is the blocking loop.
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

The loops in this project are starting points for an investigation: which loop suits this
problem, and why?

## The loop

- **Abstraction (A)**: guesses up to \`num_profiles\` profiles (profile 1 is the target) and exactly
  \`num_axiom_instances\` applicable axiom instances on them, with symmetry breaking.
- **Check (C)**: looks for outcomes of all profiles that satisfy every chosen axiom instance but
  differ from the target outcome on profile 1. Such outcomes are the counterexample.
- **Refinement**: a clause over the interface atoms that are \`relevant/1\` for the counterexample.
  The default loop is Shape 1 (\`search A\`) with refinement strategy 2.

## Fragments

- \`shared\`, \`abstraction\`, \`glue\`, \`check\`: the encoding of \`explain1.lp\`, split into the solvers.
- \`relevant\` (strategy 2) and \`relevant_falsified\` (strategy 1): two of the five refinement strategies
  of the original file. Both call every profile atom relevant; of the axiom-instance atoms,
  strategy 1 adds the instances the outcomes falsify, strategy 2 those they do not falsify. (The
  file's strategies 3, 4 and 5 add the instances the candidate does not use, those it uses, and
  all of them; they are left out here.)
- \`relevant_profile_free\`: strategy 6, added here. It calls relevant the instances the outcomes falsify,
  and of the profile atoms only the top choice of voter 1 (which faithfulness and unanimity read).
  The idea: whether an outcome assignment falsifies an instance depends on the outcomes of the
  profile numbers, not on what the profiles are, so the clause need not mention the candidate's
  profiles. It reads as "use one of the instances this counterexample falsifies".
- \`fewest\`: a \`#minimize\` for the check, the counterexample that falsifies the fewest instances.
- \`view\`: a domain view for the Observatory tab.

## Variants

| Variant | What changes |
|---|---|
| default | Shape 1 (\`search A\`), strategy 2 |
| falsified | Shape 1 with strategy 1: the falsified instances and every profile atom |
| reference | the blocking loop (\`G.block(M)\`) |
| profile-free | Shape 1 with strategy 6: the falsified instances only |
| fewest | profile-free with an optimal check (\`#minimize\` the falsified instances) |
| multi | profile-free with up to 5 counterexamples per candidate (\`C.models(..., limit 5)\`), one clause each |
| partial | profile-free with checks at partial assignments (\`on partial P every 8\`, open atoms false) |

## Instances

- Questions from \`explain1.lp\` (tags \`original\`, \`no-solution\`). The file's questions with one or
  two candidates (no refinement at all) are left out, and so is its largest one (k = 8, profiles
  of up to 5 voters). \`cancel-reinf-posresp-k4\` is the question the original file has switched
  on. The default instance is \`faith-pareto-neutral-reinf-k4\`.
- Seven generated questions, \`random-1\` … \`random-7\` (generator \`vote-question\`: \`a\` random
  axioms, a sorted random target profile of \`v\` voters, a random outcome).
- 17 questions from Nardi, Boixel and Endriss (tag \`paper\`), over the paper's corpus
  (faithfulness, Pareto, cancellation, neutrality, positive responsiveness, reinforcement), with
  profiles of at most as many voters as the target (the paper's weak reinforcement):
  Example 1 (\`paper-ex1-k2-p3\`), Example 4 (\`paper-ex4-*\`), the six two-voter profiles of
  Table 1 with their Borda outcomes (\`paper-v2-*\`), the two profiles of Section 4.2
  (\`paper-borda3-*\`, \`paper-borda4-*\`), a Condorcet cycle, a four-voter profile and three profiles
  over four alternatives (\`paper-c4-*\`). The id gives k (\`-k3\`) and the number of profiles (\`-p4\`).
- The encoding asks for *exactly* k instances and has no minimality check, so a solution need not
  be a smallest justification, and padded justifications count.
- Each instance records its expected number of solutions where one is known. Instances marked
  \`audit: false\` are skipped by the audit and Fuzz; runs use them.

The runs look for all solutions.

## Suites

- \`questions\`: every question, the default loop (20 s each).
- \`strategies\`: the file's and the generated questions with a count (except the slow one) ×
  every variant (30 s each).
- \`paper\`: the 17 paper questions × default, falsified, reference, profile-free, fewest, multi,
  partial (60 s
  each).
- \`generated\`: 12 generated questions (v = 2, 3; a = 2, 3; three seeds) × default, falsified,
  reference.

Read the instance × variant matrix in the Campaign tab, or run
\`node tools/bench.mjs voting-justification --suite paper --out rows.jsonl\` and
\`node tools/report.mjs rows.jsonl\` (add \`--metric candidates\`).

## Comparing loops

Count candidates (each costs a check), time, and the questions solved within the limit. A variant
that finds a *different* number of justifications than the reference is unsound (or the reference
has not finished): the Campaign tab marks those cells ✗. The audit and the symbolic audit check a
refinement's soundness.

The example \`voting-justification-ihs\` asks the same questions with implicit hitting sets: the
smallest justifications, without a fixed k.

## Open questions

1. Combine loops: multi with partial checks.
2. Can a refinement be *lifted* over permutations of the profile numbers (a counterexample
   permuted is a counterexample), so that one counterexample rules out many candidates?
3. Would an encoding that builds profiles from instances (a neutrality instance determines its
   second profile) instead of guessing them first help? Or a search in two levels, profiles first
   (the "two-step procedure" the original file mentions), or fewest profiles first (the paper's
   breadth-first generation)?
4. The paper's derived axioms and implied instances (Section 3) as variants of the abstraction:
   they change the solution set, so compare first-solution times rather than counts.
5. Explanatoriness: the encoding has no minimality check (exactly k instances). A second check
   (no proper subset suffices) would make larger k meaningful.
6. Which refinement strategies are sound, and why? Strategies 1 and 2 name every profile atom;
   strategy 6 names none. The original file has three more (the instances the candidate does not
   use, those it uses, all of them): are they sound, and are they any different from these?
7. Is strategy 6 the strongest refinement that holds for every candidate? Could a clause leave
   out instances that the outcomes falsify only because others are falsified?
8. Exactly k against at most k: how do the counts and the costs change with "at most k
   instances", and with the smallest size (from \`voting-justification-ihs\`) as k?
9. Symmetry breaking: how much of A's work does it save, and is each of its constraints still
   sound together with a clause that holds for every candidate?
10. Scaling: where do the loops break down as the candidates, voters and profiles grow, and which
    solver (A or C) gives out first?
11. Explanations a person can read: among the smallest justifications, which is the most
    readable (fewest profiles, fewest kinds of axiom)? Can a loop optimise for that?
`;

// voting-justification, strategy 6 and the loops built on it (Nov 2026). A counterexample is an
// outcome for every profile number; whether it falsifies an axiom instance depends on those
// outcomes alone (faithfulness and unanimity also read voter 1's top choice). So the profile atoms
// need not be relevant, and the clause says: use one of the instances this outcome falsifies. It
// holds for every candidate, whatever its profiles (the symbolic audit proves it sound).
const VOTE_S6 = `% Refinement strategy 6: the axiom instances the outcomes falsify, and of the profile atoms
% only the top choice of voter 1 (read by faithfulness and unanimity). Whether an outcome
% falsifies an instance depends on the outcomes alone, so the clause holds for every candidate,
% whatever its profiles: some instance this counterexample falsifies must be used.
relevant(profile(Prof,1,C,1)) :- profile_num(Prof), candidate(C), use_axiom(faithfulness).
relevant(profile(Prof,1,C,1)) :- profile_num(Prof), candidate(C), use_axiom(unanimity).
relevant(use_axiom_instance(Profiles,Axiom)) :-
    falsified(pos_axiom_instance(Profiles,Axiom)),
    pos_axiom_instance(Profiles,Axiom).
`;
const VOTE_CHOICE = `num_axiom_instances { use_axiom_instance(Profiles,Axiom) :
    axiom_applicable(Profiles,Axiom) } num_axiom_instances.`;
const vloop = (text) => ({ language: 'loop', text });
const VOTE_SHAPE1 = (cheader, body) => `solver A = shared + abstraction
solver C = ${cheader}   options "--heuristic=Domain"
link   G = A -> C via shared + glue

search A:
    on candidate M:
${body}`;
function voteLoops(p) {
  if (!frag(p, 'abstraction').text.includes(VOTE_CHOICE)) throw new Error('make-examples: the choice of axiom instances not found');
  const at = p.fragments.indexOf(frag(p, 'relevant_falsified')) + 1;
  p.fragments.splice(at, 0,
    { name: 'relevant_profile_free', text: VOTE_S6, description: 'Refinement strategy 6 for the check (relevant/1): the falsified instances and voter 1\'s top choices only. Swapped in by the variants profile-free, fewest, multi and partial.' },
    { name: 'fewest', text: `% The smallest refinement (variant fewest): an outcome assignment that falsifies as few
% axiom instances as possible, so the clause of strategy 6 is as short as possible.
#minimize { 1,Profiles,Axiom : falsified(pos_axiom_instance(Profiles,Axiom)) }.
`, description: 'A #minimize for the check: the counterexample that falsifies the fewest instances (variant fewest, with an optimal solve).' });
  const s6 = { relevant: 'relevant_profile_free' };
  p.variants.push(
    { name: 'profile-free', swap: s6, constants: {} },
    { name: 'fewest', swap: s6, constants: {}, loop: vloop(VOTE_SHAPE1('shared + check + relevant + fewest', `        X = C.solve(assume G(M), optimal)
        if X:
            reject M with G.clause(M, X)
`)) },
    { name: 'multi', swap: s6, constants: {}, loop: vloop(VOTE_SHAPE1('shared + check + relevant', `        for X in C.models(assume G(M), limit 5):
            reject M with G.clause(M, X)
`)) },
    // a clause of strategy 6 holds for every candidate, so a check at a partial assignment (the
    // open atoms taken as false) may reject the whole subtree
    { name: 'partial', swap: s6, constants: {}, loop: vloop(VOTE_SHAPE1('shared + check + relevant', `        X = C.solve(assume G(M))
        if X: reject M with G.clause(M, X)
`).replace('search A:\n', `search A:
    on partial P every 8:
        X = C.solve(assume G(P, false))
        if X: reject P with G.clause(X)
`)) });
}

// voting-justification-ihs: the same questions as implicit hitting sets. With strategy 6 a
// counterexample's clause says "use one of the instances these outcomes falsify", whatever the
// candidate, so a set of instances is a justification exactly when it hits the falsified set of
// every counterexample. A proposes a smallest set (with its profiles) that hits every set found so
// far; the first one that survives the check is a smallest justification. No k is given:
// num_axiom_instances is not read. Expected counts: the number of smallest justifications
// (measured with every variant, Nov 2026); they agree with the paper questions' counts where k
// is the smallest, and differ where a smaller justification exists (random-4 ... random-7) or
// where none exists at k but one does at a larger size (paper-c4-v2b-k3-p3: one, of size 4).
// paper-borda3-k3-p4 and paper-borda4-k3-p4 have none of any size within 4 profiles (variant
// ascending: 46 s and 7 min).
const VOTE_IHS_EXPECTED = { 'random-4': 1, 'random-5': 1, 'random-6': 2, 'random-7': 1, 'paper-c4-v2b-k3-p3': 1 };
const VOTE_IHS_SLOW = ['faith-cancel-reinf-pareto-condorcet-k3', 'paper-borda4-k3-p3', 'paper-v4-k4-p3', 'paper-c4-v2-k3-p3',
  'paper-c4-v2b-k3-p3', 'paper-c4-v3-k3-p3'];
const VOTE_IHS_BENCH = ['cancel-reinf-posresp-k4', 'paper-ex4-k3-p4', 'paper-borda3-k3-p4', 'paper-borda4-k3-p4'];
const VOTE_IHS_HEAD = (a) => `solver A = shared + ${a}
solver C = shared + check + relevant   options "--heuristic=Domain"
link   G = A -> C via shared + glue
`;
const VOTE_IHS_LOOP = VOTE_IHS_HEAD('abstraction + smallest') + `
# Implicit hitting sets: A proposes a smallest set of axiom instances (with the profiles they
# need) that hits the falsified set of every counterexample so far. The first set that survives
# the check is a smallest justification; then A keeps to that size and lists the others.
best = none
loop:
    M = A.solve(optimal)
    if not M: stop
    track lower = M.cost
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        if best == none:
            log "smallest justification: instances", M.cost
            best = M.cost
            A.ground(bound, best)
        accept M
        A.add(G.block(M))
`;
const VOTE_IHS_ASCENDING = VOTE_IHS_HEAD('abstraction + sizes') + `
# Sizes in ascending order, without optimisation: at size k, A looks for exactly k instances;
# every clause holds at every size, so it carries over to the next k. The first size with a
# justification is the smallest; then A is fixed to it and lists the other justifications of it.
k = 1
found = false
while not found:
    if A.models(limit 1).size == 0: stop    # no hitting set of any size: no justification
    A.ground(size, k)
    loop:
        M = A.solve(assume A.atom("size", k))
        if not M: break
        X = C.solve(assume G(M))
        if X:
            A.add(G.clause(M, X))
        else:                          # a justification of size k: the smallest size
            found = true
            accept M
            A.add(G.block(M))
            break
    track lower = k
    if not found: k = k + 1
log "smallest justification: instances", k
A.ground(exactly, k)
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        A.add(G.block(M))
`;
const VOTE_IHS_README = `# Smallest justifications by implicit hitting sets

## Background

The questions of \`voting-justification\` (explaining a voting outcome by axiom instances; Boixel
and Endriss, AAMAS 2020; Nardi, Boixel and Endriss, AAMAS 2022), asked another way: not "is there
a justification with exactly k instances?" but "what are the smallest justifications?".

A counterexample is an outcome for every profile number that differs from the target outcome on
profile 1. It falsifies some axiom instances. Whether it falsifies an instance depends on the
outcomes alone (faithfulness and unanimity also read the top choice of voter 1), not on what the
profiles are. A set of instances is a justification exactly when it *hits* the falsified set of
every counterexample: a counterexample that falsifies none of the chosen instances satisfies them
all. This is the duality behind implicit hitting sets (IHS): the falsified sets play the part of
correction sets, the justifications that of the sets that hit them all, as in the smallest-MUS
algorithm of Ignatiev, Previti, Liffiton and Marques-Silva (2015).

Unlike a textbook IHS, the universe of the hitting set is not fixed: which instances are
applicable depends on the profiles, and A guesses those too.

## The loop

- **Abstraction (A)**: profiles and applicable axiom instances as in \`voting-justification\`,
  but any number of instances, with \`#minimize\` on their number (fragment \`smallest\`).
- **Check (C)**: the check of \`voting-justification\`: outcomes that satisfy every chosen instance
  and differ from the target outcome on profile 1.
- **Refinement**: strategy 6 (fragment \`relevant\`): the instances the counterexample falsifies,
  and of the profile atoms only voter 1's top choices.
- The loop solves A optimally; a candidate that survives the check is a smallest justification.
  Then \`A.ground(bound, best)\` keeps A at that size, and the loop lists the others.

The constant \`num_axiom_instances\` of the instances is not read; \`num_profiles\` still bounds
the number of profiles.

## Fragments

- \`shared\`, \`abstraction\`, \`glue\`, \`check\`: from \`voting-justification\`, with the choice of
  exactly \`num_axiom_instances\` instances replaced by a free choice.
- \`smallest\`: the \`#minimize\` on the number of instances and \`#program bound(b)\` (exactly b).
- \`sizes\`: \`#program size(k)\`, an assumable atom \`size(k)\` for exactly k instances, and
  \`#program exactly(b)\` (variant \`ascending\`).
- \`relevant\`: refinement strategy 6.
- \`fewest\`: a \`#minimize\` for the check: the counterexample that falsifies the fewest instances.
- \`view\`: a domain view for the Observatory tab.

## Variants

| Variant | What changes |
|---|---|
| default | IHS: an optimal A, one counterexample per candidate |
| mcs | an optimal check (\`fewest\`): each counterexample falsifies as few instances as possible, a minimum correction set |
| multi | up to 5 counterexamples per candidate (\`C.models(..., limit 5)\`), one clause each |
| ascending | no optimisation: sizes k = 1, 2, ... in turn, each a search under the assumption \`size(k)\` |
| reference | the counterexample's clause replaced by \`G.block(M)\` |

## Instances

The instances of \`voting-justification\` (see its readme): the questions of \`explain1.lp\`, seven
generated ones and 17 from Nardi, Boixel and Endriss. The \`-k\` in an id is the k of the original
question; here it is not used. The expected count of an instance is its number of smallest
justifications, where it is known.

## Suites

- \`questions\`: every question, the default loop (60 s each).
- \`loops\`: the questions that are not tagged \`bench\` × every variant (60 s each).

## Open questions

1. Is the first justification found a smallest one only because strategy 6's clause holds for
   every candidate? What happens with strategy 2 of \`voting-justification\` in this loop?
2. IHS solvers for MaxSAT find disjoint cores first to raise the lower bound cheaply. What is the
   analogue here: counterexamples with pairwise disjoint falsified sets?
3. A correction set is minimal when no falsified instance can be satisfied without falsifying
   another. \`mcs\` asks for a minimum one, which costs an optimisation per check. Would a cheaper
   *minimal* one do as well?
4. When does an optimal A pay, and when do the satisfiability calls of \`ascending\`?
5. Without a fixed k the loop can prove that a question has no justification at all within
   \`num_profiles\` profiles. How large must \`num_profiles\` be before that says something about
   all profiles?
6. The paper's breadth-first generation (fewest profiles first) against fewest instances first:
   do they find the same justifications?
7. Explanations a person can read: among the smallest justifications, which is the most
   readable (fewest profiles, fewest kinds of axiom)? Add it as a second level of the
   \`#minimize\` and compare.
`;
function voteIhs(vote) {
  const f = (n) => structuredClone(frag(vote, n));
  const ab = f('abstraction');
  if (!ab.text.includes(VOTE_CHOICE)) throw new Error('make-examples: the choice of axiom instances not found');
  ab.text = ab.text.replace(VOTE_CHOICE, `% Any number of applicable instances; the fragment smallest (or sizes) says how many.
{ use_axiom_instance(Profiles,Axiom) : axiom_applicable(Profiles,Axiom) }.`);
  ab.description = 'Proposes candidates (solver A): profiles and any set of applicable axiom instances on them.';
  const rel = f('relevant_profile_free');
  rel.name = 'relevant';
  rel.description = 'Refinement strategy 6 (relevant/1): the instances the counterexample falsifies, and voter 1\'s top choices.';
  const fewest = f('fewest');
  fewest.description = 'A #minimize for the check: the counterexample that falsifies the fewest instances (variant mcs, with an optimal check).';
  const count = '#count { Profiles,Axiom : use_axiom_instance(Profiles,Axiom) }';
  const fragments = [f('shared'), ab,
    { name: 'smallest', description: 'For solver A: as few axiom instances as possible; #program bound(b) fixes the number once the optimum is known.',
      text: `% As few axiom instances as possible.
#minimize { 1,Profiles,Axiom : use_axiom_instance(Profiles,Axiom) }.

#program bound(b).
% Once the smallest size b is known (A.ground(bound, b)): exactly b instances.
:- ${count} != b.
` },
    { name: 'sizes', description: 'For solver A in the variant ascending: the atom size(k), assumed, asks for exactly k instances; #program exactly(b) fixes the number.',
      text: `#program size(k).
% Assumed by the loop (A.atom("size", k)): exactly k instances.
{ size(k) }.
:- size(k), ${count} != k.

#program exactly(b).
% Once the smallest size b is known (A.ground(exactly, b)): exactly b instances.
:- ${count} != b.
` },
    f('glue'), f('check'), rel, fewest, f('view')];
  const V = (name, text, note) => ({ name, swap: {}, constants: {}, note, loop: vloop(text) });
  const p = {
    format: vote.format, version: 2, title: 'Voting: smallest justifications (IHS)',
    description: 'The questions of Voting: justifications by implicit hitting sets: A proposes a smallest set of axiom instances that ' +
      'hits the falsified instances of every counterexample so far; the first that survives the check is a smallest justification.',
    readme: VOTE_IHS_README,
    fragments,
    loop: vloop(VOTE_IHS_LOOP),
    settings: { ...structuredClone(vote.settings) },
    instances: structuredClone(vote.instances).map((x) => {
      const y = { ...x, tags: (x.tags || []).filter((t) => t !== 'slow' && t !== 'bench' && t !== 'no-solution') };
      delete y.symbolic;
      if (x.id in VOTE_IHS_EXPECTED) y.expected = { solutions: VOTE_IHS_EXPECTED[x.id] };
      if (y.expected && y.expected.solutions === 0) y.tags.push('no-solution');
      if (VOTE_IHS_SLOW.includes(x.id)) y.tags.push('slow');
      if (VOTE_IHS_BENCH.includes(x.id)) y.tags.push('bench');
      return y;
    }),
    generators: structuredClone(vote.generators),
    runs: [],
    views: structuredClone(vote.views),
    variants: [
      V('mcs', VOTE_IHS_LOOP.replace('check + relevant', 'check + relevant + fewest').replace('C.solve(assume G(M))', 'C.solve(assume G(M), optimal)'),
        'The counterexample that falsifies the fewest instances: a minimum correction set, a shorter clause.'),
      V('multi', VOTE_IHS_LOOP.replace(`    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:`, `    refuted = false
    for X in C.models(assume G(M), limit 5):
        A.add(G.clause(M, X))
        refuted = true
    if not refuted:`), 'Up to five counterexamples, and clauses, per candidate: more sets to hit per solve of A.'),
      V('ascending', VOTE_IHS_ASCENDING, 'Satisfiability calls at sizes 1, 2, ... instead of an optimal solve of A.'),
      V('reference', VOTE_IHS_LOOP.replace('A.add(G.clause(M, X))', 'A.add(G.block(M))'), 'Block each refuted candidate on its own: the ground truth on small questions.'),
    ],
  };
  if (!p.variants.every((v) => v.loop.text !== VOTE_IHS_LOOP)) throw new Error('make-examples: an IHS variant did not change the loop');
  const ids = p.instances.map((i) => i.id);
  p.suites = [
    { name: 'questions', instances: { ids: 'all' }, limits: { seconds: 60 } },
    { name: 'loops', instances: { ids: p.instances.filter((i) => !i.tags.includes('bench')).map((i) => i.id) },
      variants: ['default', 'mcs', 'multi', 'ascending', 'reference'], limits: { seconds: 60 } },
  ];
  if (!ids.length) throw new Error('make-examples: no voting instances');
  return p;
}

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
    { name: 'relevant', text: text[2], description: 'The relevant/1 rules of the check: strategy 2 (the variants falsified and profile-free swap in another).' },
    { name: 'relevant_falsified', text: text[1], description: 'Refinement strategy 1 for the check (relevant/1): every profile atom and the falsified instances. Swapped in by the variant falsified.' });
  p.loop.text = VOTE_LOOP_HEAD + `
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
`;
  p.variants = [
    { name: 'falsified', swap: { relevant: 'relevant_falsified' }, constants: {} },
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
  // three constants-only instances; "" = the project as written (n = 6)
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
      voteLoops(p);
    }, { solutions: 0 });
  vote.settings.constants = { ...vote.instances.find((i) => i.id === VOTE_DEFAULT).constants };
  // one line per variant: its main idea (shown in the Variants block)
  const VOTE_VARIANT_NOTES = {
    falsified: 'Clause from the instances the outcomes falsify (with every profile atom).',
    reference: 'Block each refuted candidate on its own: the ground truth on small questions.',
    'profile-free': 'Drop the profile atoms: the clause "use one of the falsified instances" holds for every candidate.',
    fewest: 'Strategy 6 with the counterexample that falsifies the fewest instances: shorter clauses.',
    multi: 'Strategy 6 with up to five counterexamples, and clauses, per candidate.',
    partial: 'Strategy 6 checked on partial candidates, so one clause can cut a whole subtree.',
  };
  for (const v of vote.variants) {
    if (!VOTE_VARIANT_NOTES[v.name]) throw new Error(`make-examples: no note for the voting variant ${v.name}`);
    v.note = VOTE_VARIANT_NOTES[v.name];
  }
  vote.readme = VOTE_README;
  vote.generators = structuredClone(VOTE_KIT.generators);
  vote.instances.push(...structuredClone(VOTE_KIT.recipes).map((x) => ({ constants: {}, ...x })));
  vote.instances.push(...VOTE_PAPER.map(votePaperInstance));
  vote.fragments.push({ name: 'view', text: VIEWS['voting-justification'], description: 'A domain view (Observatory tab): the scene part draws what stays, the frame part one step, as draw/1 marks.' });
  vote.views = [{ name: 'view', fragments: ['shared', 'view'] }];
  const paper = vote.instances.filter((i) => i.tags.includes('paper'));
  vote.suites = [
    { name: 'questions', instances: { ids: 'all' }, limits: { seconds: 20 } },
    // every refinement strategy and loop on the file's and the generated questions that finish
    { name: 'strategies', instances: { ids: vote.instances.filter((i) => i.expected && !i.tags.includes('slow') && !i.tags.includes('paper')).map((i) => i.id) },
      variants: ['default', ...vote.variants.map((v) => v.name)], limits: { seconds: 30 } },
    // the paper's questions: the best of the original strategies against the loops of strategy 6
    { name: 'paper', instances: { ids: paper.map((i) => i.id) },
      variants: ['default', 'falsified', 'reference', 'profile-free', 'fewest', 'multi', 'partial'], limits: { seconds: 60 } },
    // generated questions (the generator vote-question) with small bounds
    { name: 'generated', instances: { generator: 'vote-question', grid: { v: [2, 3], a: [2, 3] }, seeds: 3,
      constants: { num_candidates: 3, num_voters: 3, num_profiles: 3, num_axiom_instances: 3 } },
      variants: ['default', 'falsified', 'reference'], limits: { seconds: 30 } },
  ];
  // Constants-only instances, run with all solutions (the project as written, n = 5 and w = 3,
  // stops at its first candidate, which is a solution at every size). Counts agree with the
  // reference variant (blocking loop), and the audit is sound on each within 15 s.
  nash.instances = [
    { id: 'n2-w1', facts: '', constants: { n: '2', w: '1' }, expected: { solutions: 12 }, tags: ['small'] },
    { id: 'n2-w2', facts: '', constants: { n: '2', w: '2' }, expected: { solutions: 24 }, tags: [] },
    { id: 'n2', facts: '', constants: { n: '2' }, expected: { solutions: 36 }, tags: [] },
    { id: 'n3-w1', facts: '', constants: { n: '3', w: '1' }, expected: { solutions: 576 }, tags: [] },
  ];
  nash.settings.solutions = 0;
  // a wider refinement: every interface atom of a deviating player (a superset of the rules
  // above, so still sound, and weaker)
  nash.fragments.push({ name: 'relevant_wide', description: 'The check with a wider refinement: every edge, colour and move of a deviating player (variant wide).',
    text: frag(nash, 'check').text + `
% Variant wide: every interface atom of a deviating player is relevant.
relevant(edge(P,Q,W)) :- player_differs(P), player(Q), weight(W).
relevant(color_available(P,C)) :- player_differs(P), color(C).
relevant(plays(P,C)) :- player_differs(P), color(C).
` });
  const nashLoop = nash.loop.text;
  nash.variants = [
    { name: 'reference', swap: {}, constants: {}, loop: { language: 'loop', text: nashLoop.replace('G.clause(M, X)', 'G.block(M)') } },
    { name: 'shape2', swap: {}, constants: {}, loop: { language: 'loop', text: template('shape2') } },
    { name: 'wide', swap: { check: 'relevant_wide' }, constants: {} },
  ];
  nash.version = 2;
  nash.readme = PROJECT_CARDS.nash;
  return { 'graph-coloring': gc, nash, 'voting-justification': vote, 'voting-justification-ihs': voteIhs(vote) };
}

// Contributed examples: examples/contrib/*.json, each a project with a top-level
// 'library' block { id, group, summary, shape, tags, expected }. Returns library entries.
// The group is a category (CATEGORIES). The older names exists-forall, problems and
// several-solvers still load, into the group other.
export const CATEGORIES = ['logic', 'reasoning', 'graphs', 'games', 'voting', 'judgment', 'planning', 'puzzles'];
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
  for (const k of ['instances', 'generators', 'suites', 'views', 'spaces']) if ((p[k] || []).length) has[k] = p[k].length;
  if (typeof p.readme === 'string' && p.readme.trim()) has.readme = 1;
  return Object.keys(has).length ? { has } : {};
}

// All examples and the manifest: { files: { id: project }, manifest }.
// Whether the symbolic audit covers a project's loop (G.clause or G.clauses on one link).
function symbolicTarget(p) {
  if (!p.loop || p.loop.language !== 'loop') return false;
  const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
  const b = boundedPlan(c);
  return !b.error && !b.unsupported && !!(b.clause || b.clauses);
}

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
  const built = Object.fromEntries(entries.map((e) => [e.id, e.project]));
  for (const e of entries) {
    if (EXTRAS[e.id]) {
      const x = EXTRAS[e.id](e.project, built);
      if (x.fragments) e.project.fragments = [...e.project.fragments, ...x.fragments];
      if (x.instances) e.project.instances = x.instances;
      if (x.variants) e.project.variants = [...(e.project.variants || []), ...x.variants];
      e.project.version = 2;
    }
  }
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
    // PLAN3: spaces (S7) and the expected symbolic-audit verdict of every instance (S6)
    if (SPACES[e.id]) { e.project.spaces = structuredClone(SPACES[e.id]); e.project.version = 2; }
    if ((e.project.instances || []).length && symbolicTarget(e.project)) {
      const table = SYMBOLIC[e.id] || {};
      e.project.instances = e.project.instances.map((x) => (table[x.id] === null ? x : { ...x, symbolic: table[x.id] || 'sound' }));
    }
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
