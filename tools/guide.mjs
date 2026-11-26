// The examples of the design guide (guide/*.html), in reading order. Used by
// tools/make-examples.mjs and tools/guide-numbers.mjs. Every entry has the usual library
// fields plus page (the guide page and anchor that links it), status ('baseline', 'sound' or
// 'unsound') and, unless it is a baseline, baseline (the id of the blocking run of the same
// problem and constants). test/guide.test.mjs checks the statuses.
import fs from 'node:fs';
import { template } from '../js/project.js';
import { GROUPS, project, DUAL } from './library.mjs';

// The library group of the guide's examples (defined with the other groups in library.mjs).
export const GUIDE_GROUP = GROUPS.find((g) => g.id === 'guide');

// ---- the small graph of pages 1-4 -------------------------------------------------------
// Ten nodes: a clique on 1-4 (four triangles) and a chain of triangles 4-5-6, 6-7-8, 8-9-10.
// With k = 3 there are three solutions: delete 4, 8 and one of 1, 2, 3. guide/guide.js draws
// the same edges (a test compares them).
export const SMALL_EDGES = [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4], [4, 5], [4, 6], [5, 6],
  [6, 7], [6, 8], [7, 8], [8, 9], [8, 10], [9, 10]];
const SMALL_GRAPH = `% The graph of the guide's figures: ten nodes, fifteen edges.
node(1..10).
${SMALL_EDGES.map(([u, v]) => `edge(${u},${v}).`).join(' ').replace(/((?:\S+ ){5}\S+) /g, '$1\n')}
`;

const ABSTRACTION = `% A candidate: at most k nodes to delete.
{ del(V) : node(V) } k.
#show del/1.
`;
const GLUE = `% The check sees which nodes are deleted.
glue(del(V)) :- node(V).
`;
const FIND = `% A counterexample: a triangle none of whose nodes is deleted.
3 { q(V) : node(V) } 3.
:- q(V), del(V).
:- q(U), q(V), U < V, not edge(U,V).
#show q/1.
`;
const RELEVANT = {
  none: '',
  triangle: `
% The triangle survives as long as none of its nodes is deleted.
relevant(del(V)) :- q(V).
`,
  all: `
% Every interface atom counts: the refinement blocks the whole candidate.
relevant(del(V)) :- node(V).
`,
  one: `
% Too strong: only the busiest node of the triangle counts, the one with the
% most edges (on a tie, the one with the larger number).
deg(V,D) :- node(V), D = #count { W : edge(V,W) ; W : edge(W,V) }.
busier(V) :- q(V), q(W), deg(V,D), deg(W,E), (E,W) > (D,V).
relevant(del(V)) :- q(V), not busier(V).
`,
};
const ACCEPT_ALL = `% No counterexample ever: every candidate is accepted.
#false.
`;
const DESC = {
  shared: 'The graph. Added to every solver.',
  abstraction: 'Proposes candidates (solver A): at most k deleted nodes.',
  glue: 'The interface atoms: the deleted nodes.',
  check: 'Looks for a triangle that survives the deletions (solver C).',
};

// A project on the small graph. f overrides fragments, desc fragment descriptions.
const small = (title, description, loop, { f = {}, desc = {}, constants = {} } = {}) => project(title, description,
  { shared: SMALL_GRAPH, abstraction: ABSTRACTION, glue: GLUE, check: FIND + RELEVANT.triangle, ...f },
  loop, { constants: { k: '3', ...constants }, solutions: 0, seconds: 60, trace: 200 }, { ...DESC, ...desc });

const PAGE = { 1: '01-why-a-loop', 2: '02-first-loop', 3: '03-learning', 4: '04-soundness' };
const page = (n, anchor) => `guide/${PAGE[n]}.html#${anchor}`;
const SEE = (n, title) => ` See the guide page "${title}".`;

// ---- chapter 13: a random 2QBF (generator qbf-dnf, nx = 12, ny = 5, t = 16, seed 1), one line per term
const QBF_GUIDE = `xvar(1..12).  yvar(1..5).
xlit(1,1,0). xlit(1,8,1). ylit(1,1,0).
xlit(2,4,0). xlit(2,5,0). xlit(2,6,0).
xlit(3,6,1). xlit(3,12,1). ylit(3,4,0).
xlit(4,5,0). xlit(4,6,0). ylit(4,3,1).
xlit(5,4,0). xlit(5,5,0). ylit(5,5,0).
xlit(6,3,1). xlit(6,9,0). xlit(6,11,0).
xlit(7,10,0). ylit(7,3,1). ylit(7,5,1).
ylit(8,1,0). ylit(8,1,1). ylit(8,4,0).
xlit(9,5,1). xlit(9,11,0).
xlit(10,1,1). xlit(10,4,0). ylit(10,2,0).
xlit(11,4,1). ylit(11,2,0). ylit(11,2,1).
xlit(12,5,1). xlit(12,6,0). xlit(12,9,1).
xlit(13,3,0). xlit(13,8,0). ylit(13,4,1).
xlit(14,2,1). xlit(14,4,0). ylit(14,1,0).
xlit(15,10,0). ylit(15,2,1). ylit(15,3,0).
xlit(16,6,0). xlit(16,7,1). xlit(16,10,0).`;

// ---- the Paley graph of pages 5-11 ------------------------------------------------------
// The same fragments as the library example clique-interdiction (examples/contrib/).
const PALEY = `% The Paley graph on n nodes (n a prime of the form 4m + 1): two nodes are joined when
% their difference is a square modulo n.
node(0..n-1).
square((X*X) \\ n) :- X = 1..n-1.
edge(U,V) :- node(U), node(V), U < V, square((V-U) \\ n).
`;
const CLIQUE = `% A counterexample: c nodes that are not deleted and pairwise joined.
c { q(V) : node(V) } c.
:- q(V), del(V).
:- q(U), q(V), U < V, not edge(U,V).
#show q/1.
`;
const CLIQUE_RELEVANT = `
% The clique survives as long as none of its nodes is deleted.
relevant(del(V)) :- q(V).
`;
const TWO_CLIQUES = `% A counterexample: clique 1, c nodes that are not deleted and pairwise joined;
% if possible a second one, clique 2, that differs from it.
clique(1). { clique(2) }.
#heuristic clique(2). [1,true]
c { q(I,V) : node(V) } c :- clique(I).
:- q(I,V), del(V).
:- q(I,U), q(I,V), U < V, not edge(U,V).
:- clique(2), q(2,V) : q(1,V).
#show q/2.

% One clause per clique: one of its nodes must be deleted.
clause(I, del(V), true) :- q(I,V).
`;
const PDESC = {
  shared: 'The Paley graph on n nodes. Added to every solver.',
  abstraction: 'Proposes candidates (solver A): at most k deleted nodes.',
  glue: 'The interface atoms: the deleted nodes.',
  check: 'Looks for a clique of c nodes that survives the deletions (solver C).',
};
const paley = (title, description, loop, { f = {}, desc = {}, constants = {} } = {}) => project(title, description,
  { shared: PALEY, abstraction: ABSTRACTION, glue: GLUE, check: CLIQUE + CLIQUE_RELEVANT, ...f },
  loop, { constants: { n: '13', k: '6', c: '3', ...constants }, solutions: 0, seconds: 60, trace: 200 }, { ...PDESC, ...desc });

const DECL = `solver A = shared + abstraction
solver C = shared + check          options "--heuristic=Domain"
link   G = A -> C via shared + glue
`;
const withLimit = (n) => DECL + `
# Up to ${n} surviving cliques per candidate; each gives one clause.
search A:
    on candidate M:
        for X in C.models(assume G(M), limit ${n}):
            reject M with G.clause(M, X)
`;
const SHAPE4_CLAUSES = DECL + `
# Search, collect the counterexamples, restart after 10, and add their clauses
# (written by the check with clause/3) between two searches.
pending = []
repeat:
    search A:
        on candidate M:
            X = C.solve(assume G(M))
            if X:
                pending.push(X)
                reject M with G.block(M)
                if pending.size >= 10: restart
    added = pending.size
    for X in pending:
        A.add(G.clauses(X))
    pending.clear()
until A.exhausted and added == 0
`;
const FORGOT_BLOCK = DECL + `
# Shape 2 without the block after accept: the solution comes back.
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
`;
const SPECTRUM = `
% Known in advance: no triangle among the nodes below m survives (c = 3).
:- node(U), node(V), node(W), U < V, V < W, W < m,
   edge(U,V), edge(V,W), edge(U,W), not del(U), not del(V), not del(W).
`;
const SYMMETRY = `
% Too strong: "the Paley graph looks the same from every node, so delete node 0".
:- not del(0).
`;
const NODE0 = `
% Known in advance: no triangle through node 0 survives (c = 3).
:- edge(0,V), edge(0,W), edge(V,W), not del(0), not del(V), not del(W).
`;

// ---- side trips: fragments read from examples/contrib/<id>.json, so they stay identical --------
const contrib = (id) => JSON.parse(fs.readFileSync(new URL(`../examples/contrib/${id}.json`, import.meta.url), 'utf8'));
// A project from a contrib example's fragments; edit(name, text) may change a fragment's text
// (return null to drop the fragment).
const fromContrib = (id, title, description, loop, settings, edit = (n, t) => t) => {
  const src = contrib(id);
  // The guide's projects are self-contained: the facts of the source's instance 'example' go
  // back to the top of its shared fragment, in place of the note that points to the instance.
  const ex = (src.instances || []).find((x) => x.id === 'example');
  const frags = {}, desc = {};
  // fragments that only a variant swaps in stay out of the guide's copy
  const variantOnly = new Set((src.variants || []).flatMap((v) => Object.values(v.swap || {})));
  for (const f of src.fragments) {
    if (variantOnly.has(f.name)) continue;
    const text = ex && f.name === 'shared'
      ? ex.facts + f.text.replace('% The instance (its facts) is in the Instances tab.\n', '') : f.text;
    const t = edit(f.name, text);
    if (t === null) continue;
    frags[f.name] = t;
    desc[f.name] = f.description || 'Part of the library example ' + id + '.';
  }
  return project(title, description, frags, loop, { solutions: 0, seconds: 60, trace: 200, ...settings }, desc);
};
const reason = (title, description, loop, editCheck = (c) => c) => fromContrib('sufficient-reason', title,
  description + ' See the guide page "Getting more out of each check".', loop, { constants: { k: '4' } },
  (n, t) => (n === 'check' ? editCheck(t) : t));

// ---- chapter 9: rule refinements on the running example ---------------------------------
// The parameter of the part is i, not k: k is a constant of the problem, and a constant with
// the parameter's name would replace it (see the manual, Constants).
const CLIQUE_RULES = `#program refine(i).
% cex(i,q(V)): node V is in the i-th surviving clique. One of its nodes must go.
hit(i) :- cex(i,q(V)), del(V).
:- not hit(i).
`;
const MISSING_I = `#program refine(i).
% Wrong: the heads do not contain i, so every later step defines the same atom hit,
% and clingo silently ignores the new rules for it.
hit :- cex(i,q(V)), del(V).
:- not hit.
`;
const NEIGHBOUR = `#program refine(i).
% Is it right? "One node next to the clique, outside it, must go."
hit(i) :- cex(i,q(V)), edge(V,W), not cex(i,q(W)), del(W).
hit(i) :- cex(i,q(V)), edge(W,V), not cex(i,q(W)), del(W).
:- not hit(i).
`;
const shape3 = (atoms) => template('shape3').replace('color/2', atoms)
  .replace('solver A = shared + abstraction', 'solver A = shared + abstraction + refine');
const CHECK_FOR_RULES = CLIQUE + `
% No relevant/1 rules: the loop passes the clique q/1 to the refine part.
`;

// Existing examples (not in the guide group) whose numbers a page quotes, with the constants
// they are run with. tools/guide-numbers.mjs measures them under the key ID or ID@name=value.
export const QUOTED = [
  { id: 'gc-reference' },
  { id: 'graph-coloring' },
  { id: 'clique-interdiction' },
  { id: 'clique-interdiction', constants: { n: '17', k: '9' } },
  { id: 'fair-division' },
  { id: 'lang-core' },
  { id: 'minimal-reasons' },
  { id: 'knapsack-interdiction' },
  { id: 'knapsack-optimum' },
  { id: 'conformant-planning' },
  { id: 'maxsat-ihs', exhausted: false },   // stops at its optimum
  { id: 'marco' },
  { id: 'maxsat-oll', exhausted: false },
  { id: 'benders-tardiness', exhausted: false },
  { id: 'qbf-deep' },
  { id: 'qbf-deep', constants: { depth: '4' } },
  { id: 'qbf-three-blocks' },
  { id: 'knapsack-fortification' },
  { id: 'triangle-free-lazy' },
  { id: 'triangle-free-lazy', variant: 'total-only' },
  { id: 'colourable-partial' },
  { id: 'colourable-partial', variant: 'total-only' },
  { id: 'queens-omission', constants: { n: '6' } },
  { id: 'queens-omission' },
  // B1: the solutions of the fresh-problem exercises (chapters 5-12)
  { id: 'qbf' },
  { id: 'qbf-expansion' },
  { id: 'af-preferred' },
  { id: 'strategic-companies' },
  { id: 'af-semi-stable' },
  { id: 'diagnosis' },
  { id: 'abduction' },
  // chapter 21: the voting case study
  { id: 'voting-justification', instance: 'faith-cancel-reinf-pareto-k3' },
  { id: 'voting-justification', instance: 'faith-cancel-reinf-pareto-k3', variant: 'falsified' },
  { id: 'voting-justification', instance: 'faith-cancel-reinf-pareto-k3', variant: 'reference' },
  { id: 'voting-justification', instance: 'faith-pareto-neutral-reinf-k4' },
  { id: 'voting-justification', instance: 'faith-pareto-neutral-reinf-k4', variant: 'falsified' },
  { id: 'voting-justification', instance: 'random-1' },
  { id: 'voting-justification', instance: 'random-1', variant: 'falsified' },
  { id: 'voting-justification', instance: 'faith-cancel-reinf-pareto-k3', variant: 'profile-free' },
  { id: 'voting-justification', instance: 'faith-cancel-reinf-pareto-k3', variant: 'multi' },
]; 

// Every entry: id, summary, shape, tags, expected, page, status, baseline, project; optionally
// variants: constants to measure the example with as well (key ID@name=value).
// status 'demo': an illustration that is not a CEGAR loop for the problem (no baseline).
export function buildGuide() {
  const E = [];
  const add = (e) => E.push({ group: GUIDE_GROUP.id, tags: ['fast'], ...e });
  const T1 = 'Why a loop', T2 = 'The first loop: guess, check, block', T3 = 'Learning from a counterexample',
    T4 = 'Soundness: when a refinement says too much';

  // ---- 01 Why a loop
  add({ id: 'guide-01-one-program', summary: 'The tempting single program: it finds deletion sets that hit some triangle, not every one.',
    shape: 'custom', expected: 175, page: page(1, 'one-program'), status: 'demo',
    project: small('Guide: one program is not enough',
      'Guess the deletions and a triangle in one program and demand that the triangle is hit: the answer sets are the ' +
      'deletion sets that hit some triangle, not every triangle.' + SEE(1, T1),
      template('reference').replace('abstraction\n', 'abstraction    options "--project"\n'),
      { f: { abstraction: `% A candidate: at most k nodes to delete.
{ del(V) : node(V) } k.

% The tempting test: guess a triangle and demand that a deleted node hits it.
3 { q(V) : node(V) } 3.
:- q(U), q(V), U < V, not edge(U,V).
hit :- q(V), del(V).
:- not hit.
#show del/1.
`, check: ACCEPT_ALL }, desc: { abstraction: 'Guesses the deletions and a triangle in one program (wrong on purpose).',
        check: 'Accepts every candidate.' } }) });
  add({ id: 'guide-01-guess', summary: 'Only the guess: every set of at most k nodes is accepted.', shape: 'reference',
    expected: 176, page: page(1, 'guess'), status: 'demo', variants: [{ k: '2' }, { k: '4' }],
    project: small('Guide: the guess alone',
      'The abstraction proposes every set of at most k nodes and the check accepts them all, so the number of ' +
      'solutions is the number of candidates.' + SEE(1, T1), template('reference'),
      { f: { check: ACCEPT_ALL }, desc: { check: 'Accepts every candidate.' } }) });
  add({ id: 'guide-01-one-candidate', summary: 'One fixed candidate, deleting 4 and 8; the check finds the triangle 1, 2, 3.',
    shape: 'reference', expected: 0, page: page(1, 'one-candidate'), status: 'demo',
    project: small('Guide: checking one candidate',
      'The abstraction proposes one candidate only, the deletion of nodes 4 and 8. The check finds a triangle that ' +
      'survives it; the Output tab shows it in the trace.' + SEE(1, T1), template('reference'),
      { f: { abstraction: `% One candidate only: delete nodes 4 and 8, nothing else.
{ del(V) : node(V) } k.
:- not del(4).
:- not del(8).
:- del(V), V != 4, V != 8.
#show del/1.
`, check: FIND }, desc: { abstraction: 'Proposes one fixed candidate (solver A).' } }) });

  // ---- 02 The first loop
  add({ id: 'guide-02-block', summary: 'The first loop: every wrong candidate is blocked on its own (k = 3).',
    shape: 'reference', expected: 3, page: page(2, 'block'), status: 'baseline', variants: [{ k: '4' }, { k: '5' }],
    project: small('Guide: blocking one candidate at a time',
      'Delete at most k nodes of the small graph so that no triangle is left. Every candidate with a surviving ' +
      'triangle is blocked on its own, which is always correct and always slow.' + SEE(2, T2), template('reference'),
      { f: { check: FIND } }) });
  add({ id: 'guide-02-ex1', summary: 'A glue that misses nodes 8 to 10: the check never sees them deleted, and no solution is left.',
    shape: 'reference', expected: 0, page: page(2, 'exercise-1-solution'), status: 'unsound', baseline: 'guide-02-block',
    project: small('Guide: a glue that misses nodes',
      'The same loop with a glue written for nodes 1 to 7 only. In the check, del(8), del(9) and del(10) are ' +
      'always false, so the triangle 8, 9, 10 survives every candidate and the run ends without a solution.' + SEE(2, T2),
      template('reference'), { f: { glue: `% Written for an earlier graph with seven nodes.
glue(del(1..7)).
`, check: FIND }, desc: { glue: 'The interface atoms: the deletion of nodes 1 to 7 only (wrong on purpose).' } }) });
  add({ id: 'guide-02-ex2', summary: 'Cliques of c = 4 nodes instead of triangles, blocking each wrong candidate.',
    shape: 'reference', expected: 134, page: page(2, 'exercise-2-solution'), status: 'baseline',
    project: small('Guide: cliques of four',
      'The check looks for a clique of c nodes, here c = 4, that survives the deletions. Fewer candidates are ' +
      'wrong, so more are solutions.' + SEE(2, T2), template('reference'),
      { f: { check: `% A counterexample: c nodes, pairwise joined, none of them deleted.
c { q(V) : node(V) } c.
:- q(V), del(V).
:- q(U), q(V), U < V, not edge(U,V).
#show q/1.
` }, constants: { c: '4' }, desc: { check: 'Looks for a clique of c nodes that survives the deletions (solver C).' } }) });

  // ---- 03 Learning
  add({ id: 'guide-03-relevant-all', summary: 'relevant/1 marks every interface atom: the same run as blocking.',
    shape: 'shape1', expected: 3, page: page(3, 'relevant-all'), status: 'sound', baseline: 'guide-02-block',
    project: small('Guide: everything relevant',
      'The check marks every deleted-or-not node as relevant, so each refinement says exactly what blocking says. ' +
      'The numbers equal those of the blocking run.' + SEE(3, T3), template('shape1'),
      { f: { check: FIND + RELEVANT.all } }) });
  add({ id: 'guide-03-hit-clique', summary: 'A surviving triangle teaches that one of its three nodes must be deleted.',
    shape: 'shape1', expected: 3, page: page(3, 'hit-clique'), status: 'sound', baseline: 'guide-02-block',
    variants: [{ k: '4' }, { k: '5' }],
    project: small('Guide: learning from a triangle',
      'A surviving triangle teaches that one of its nodes must be deleted; one clause rules out every candidate ' +
      'that keeps this triangle.' + SEE(3, T3), template('shape1')) });

  // ---- 04 Soundness
  add({ id: 'guide-04-one-node', summary: 'Too strong: only the busiest node of the triangle is marked, and solutions are lost.',
    shape: 'shape1', expected: 1, page: page(4, 'one-node'), status: 'unsound', baseline: 'guide-02-block',
    project: small('Guide: one node of the triangle (unsound)',
      'The check marks only the busiest node of the surviving triangle, so each refinement says "this node must ' +
      'go". That is too strong: the run finishes without a warning and reports too few solutions.' + SEE(4, T4),
      template('shape1'), { f: { check: FIND + RELEVANT.one } }) });
  // ---- 05 Reading a run
  const T5 = 'Reading a run', T6 = 'Getting more out of each check', T7 = 'Designing the abstraction', T8 = 'Loop shapes';
  const P = (n, anchor) => `guide/${{ 5: '05-reading-a-run', 6: '06-more-per-check', 7: '07-abstraction', 8: '08-loop-shapes' }[n]}.html#${anchor}`;
  const big = [{ n: '17', k: '9' }];
  add({ id: 'guide-05-paley-block', summary: 'The Paley graph (n = 13, k = 6, c = 3), every wrong candidate blocked on its own.',
    shape: 'reference', expected: 39, page: P(5, 'block'), status: 'baseline', variants: [...big, { k: '5' }],
    project: paley('Guide: the Paley graph, blocking',
      'Delete at most k nodes of the Paley graph on n nodes so that no clique of c nodes survives; every wrong ' +
      'candidate is blocked on its own. The ground truth for chapters 5 to 8.' + SEE(5, T5), template('reference'),
      { f: { check: CLIQUE } }) });
  add({ id: 'guide-05-paley-clause', summary: 'The Paley graph, one clause per surviving clique (Shape 1).',
    shape: 'shape1', expected: 39, page: P(5, 'clause'), status: 'sound', baseline: 'guide-05-paley-block',
    variants: [...big, { n: '29', c: '4', k: '13' }],
    project: paley('Guide: the Paley graph, learning',
      'The learning loop of chapter 3 on the Paley graph: a surviving clique teaches that one of its nodes must ' +
      'be deleted.' + SEE(5, T5), template('shape1')) });
  add({ id: 'guide-05-paley-record', summary: 'The same with --enum-mode=record on the abstraction: refinements are kept firmly.',
    shape: 'shape1', expected: 39, page: P(5, 'record'), status: 'sound', baseline: 'guide-05-paley-block', variants: big,
    project: paley('Guide: the Paley graph, enum-mode record',
      'The learning loop with the clingo option --enum-mode=record on solver A, which keeps the refinement ' +
      'clauses firmly during the search.' + SEE(5, T5),
      template('shape1').replace('solver A = shared + abstraction', 'solver A = shared + abstraction    options "--enum-mode=record"')) });

  // ---- 06 More per check
  add({ id: 'guide-06-ex1', summary: 'Up to 30 surviving cliques per candidate.',
    shape: 'custom', expected: 39, page: P(6, 'exercise-1-solution'), status: 'sound', baseline: 'guide-05-paley-block',
    variants: big,
    project: paley('Guide: thirty counterexamples per candidate',
      'The learning loop with up to 30 counterexamples per candidate instead of 3.' + SEE(6, T6), withLimit(30)) });
  add({ id: 'guide-06-clauses', summary: 'The check writes the clauses itself (clause/3): up to two cliques in one counterexample.',
    shape: 'custom', expected: 39, page: P(6, 'clauses'), status: 'sound', baseline: 'guide-05-paley-block', variants: big,
    project: paley('Guide: two clauses from one counterexample',
      'The check finds up to two surviving cliques in one answer set and writes one clause for each with ' +
      'clause/3; a #heuristic, honoured because of --heuristic=Domain, makes it look for the second.' + SEE(6, T6),
      DECL + `
# The check derives the clauses itself: clause(Id, Atom, Value).
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clauses(X)
`, { f: { check: TWO_CLIQUES }, desc: { check: 'Looks for up to two surviving cliques and writes one clause per clique (solver C).' } }) });
  add({ id: 'guide-06-reason-block', summary: 'Sufficient reasons of at most k = 4 features, blocking each wrong candidate.',
    shape: 'reference', expected: 13, page: P(6, 'reasons'), status: 'baseline',
    project: reason('Guide: sufficient reasons, blocking', 'Every wrong set of kept features is blocked on its own.', template('reference')) });
  add({ id: 'guide-06-reason-clause', summary: 'Sufficient reasons: keep one of the features on which the counterexample differs.',
    shape: 'shape1', expected: 13, page: P(6, 'reasons'), status: 'sound', baseline: 'guide-06-reason-block',
    project: reason('Guide: sufficient reasons, learning', 'A counterexample input refutes every set of kept features ' +
      'on which it agrees with the given input, so one of the features on which it differs must be kept.', template('shape1')) });
  add({ id: 'guide-06-reason-smallest', summary: 'Sufficient reasons: the check returns a counterexample that differs on as few features as possible.',
    shape: 'custom', expected: 13, page: P(6, 'smallest'), status: 'sound', baseline: 'guide-06-reason-block',
    project: reason('Guide: sufficient reasons, smallest counterexample', 'The check minimises the number of features on ' +
      'which its input differs (optimal solve), which gives the shortest clauses.',
    template('shape1').replace('X = C.solve(assume G(M))', 'X = C.solve(assume G(M), optimal)'),
    (c) => c + '\n% Prefer a counterexample that differs on few features.\n#minimize { 1,F : differs(F) }.\n') });

  // ---- 07 The abstraction
  add({ id: 'guide-07-spectrum', summary: 'The triangles among the first m nodes are excluded in the abstraction already.',
    shape: 'shape1', expected: 39, page: P(7, 'spectrum'), status: 'sound', baseline: 'guide-05-paley-block',
    variants: [{ m: '0' }, { m: '5' }, { m: '13' }],
    project: paley('Guide: what the abstraction knows',
      'The abstraction knows in advance that no triangle among the nodes below m may survive; the loop learns the ' +
      'rest. m = 0 is the plain loop, m = n needs no loop at all.' + SEE(7, T7), template('shape1'),
      { f: { abstraction: ABSTRACTION + SPECTRUM }, constants: { m: '9' },
        desc: { abstraction: 'Proposes candidates (solver A); triangles below node m are excluded in advance.' } }) });
  add({ id: 'guide-07-too-strong', summary: 'Symmetry breaking in the abstraction: "delete node 0" cuts solutions.',
    shape: 'shape1', expected: 18, page: P(7, 'too-strong'), status: 'unsound', baseline: 'guide-05-paley-block',
    project: paley('Guide: an abstraction that cuts solutions',
      'Every node of the Paley graph looks the same, so one may demand that node 0 is deleted. For the question ' +
      '"is there a solution" that is fine; for the list of all solutions it is too strong.' + SEE(7, T7), template('shape1'),
      { f: { abstraction: ABSTRACTION + SYMMETRY } }) });
  add({ id: 'guide-07-ex1', summary: 'The triangles through node 0 are excluded in the abstraction.',
    shape: 'shape1', expected: 39, page: P(7, 'exercise-1-solution'), status: 'sound', baseline: 'guide-05-paley-block',
    project: paley('Guide: triangles through node 0 in advance',
      'The abstraction excludes in advance every triangle through node 0 that survives.' + SEE(7, T7), template('shape1'),
      { f: { abstraction: ABSTRACTION + NODE0 } }) });

  // ---- 08 Loop shapes
  const scale = [{ n: '29', c: '4', k: '13' }];
  add({ id: 'guide-08-shape2', summary: 'Shape 2: solve, check, add the clause, solve again.',
    shape: 'shape2', expected: 39, page: P(8, 'shape2'), status: 'sound', baseline: 'guide-05-paley-block', variants: scale,
    project: paley('Guide: Shape 2 on the Paley graph',
      'One solve of A per candidate; every refinement and every solution is added between two solves.' + SEE(8, T8),
      template('shape2')) });
  add({ id: 'guide-08-shape4', summary: 'Batches: collect counterexamples, restart after 10, add their clauses.',
    shape: 'custom', expected: 39, page: P(8, 'shape4'), status: 'sound', baseline: 'guide-05-paley-block', variants: scale,
    project: paley('Guide: batches and restarts',
      'A search of A that blocks wrong candidates and collects their counterexamples; after 10 it restarts and ' +
      'adds the clauses the check wrote with clause/3.' + SEE(8, T8), SHAPE4_CLAUSES,
      { f: { check: CLIQUE + `
% One clause: one of the clique's nodes must be deleted.
clause(1, del(V), true) :- q(V).
` }, desc: { check: 'Looks for a surviving clique and writes the clause with clause/3 (solver C).' } }) });
  add({ id: 'guide-08-forgot-block', summary: 'Shape 2 without blocking the solution: the no-progress guard stops the run.',
    shape: 'custom', expected: 1, page: P(8, 'forgot-block'), status: 'demo', outcome: 'error',
    project: paley('Guide: a solution that is not blocked',
      'Shape 2 without the block after accept: the solver proposes the same solution again and the run ends with ' +
      'the error "the refinement made no progress".' + SEE(8, T8), FORGOT_BLOCK) });
  // ---- 09 Rule refinements
  const T9 = 'Refinements that are rules', T10 = 'Checks that look for a witness, and cores', T11 = 'Optimisation';
  const Q = (n, anchor) => `guide/${{ 9: '09-rule-refinements', 10: '10-witness-and-cores', 11: '11-optimisation' }[n]}.html#${anchor}`;
  const RDESC = { refine: 'Rules grounded once per counterexample (#program refine(i)).', check: 'Looks for a clique of c nodes that survives the deletions (solver C).' };
  add({ id: 'guide-09-clique-rules', summary: 'The clique lesson as a rule, grounded once per counterexample (Shape 3).',
    shape: 'shape3', expected: 39, page: Q(9, 'clique-rules'), status: 'sound', baseline: 'guide-05-paley-block',
    project: paley('Guide: the clique lesson as a rule',
      'The refinement "delete one of the clique\'s nodes" written as rules of a program part refine(i), grounded for ' +
      'every counterexample.' + SEE(9, T9), shape3('q/1'),
      { f: { refine: CLIQUE_RULES, check: CHECK_FOR_RULES }, desc: RDESC }) });
  add({ id: 'guide-09-missing-k', summary: 'A refine part whose heads lack the parameter: the second step changes nothing.',
    shape: 'shape3', expected: 0, page: Q(9, 'missing-k'), status: 'demo', outcome: 'error',
    project: paley('Guide: a refine part without its parameter',
      'The heads of the refine part do not contain the parameter, so the second expansion defines the same atoms ' +
      'again; clingo ignores the new rules and the loop stops with the no-progress guard.' + SEE(9, T9), shape3('q/1'),
      { f: { refine: MISSING_I, check: CHECK_FOR_RULES }, desc: RDESC }) });
  add({ id: 'guide-09-ex1', summary: 'Exercise: "delete a neighbour of the clique" as a refine part. Is it right?',
    shape: 'shape3', expected: 0, page: Q(9, 'exercise-1-solution'), status: 'demo', outcome: 'error',
    project: paley('Guide: a neighbour of the clique',
      'A refine part that demands the deletion of a node next to the counterexample clique. It need not exclude the ' +
      'candidate it was made from, and the loop stops with the no-progress guard.' + SEE(9, T9), shape3('q/1'),
      { f: { refine: NEIGHBOUR, check: CHECK_FOR_RULES }, desc: RDESC }) });
  const FAIR = 'Three agents divide seven goods; the solutions are the envy-free allocations that no other ' +
    'allocation dominates. ';
  const noRefine = (n, t) => (n === 'refine' ? null : t);
  add({ id: 'guide-09-fair-block', summary: 'Fair division, blocking each dominated allocation.',
    shape: 'reference', expected: 3, page: Q(9, 'fair'), status: 'baseline',
    project: fromContrib('fair-division', 'Guide: fair division, blocking', FAIR + 'Every dominated candidate is ' +
      'blocked on its own.' + SEE(9, T9), template('reference'), {}, noRefine) });
  add({ id: 'guide-09-fair-clause', summary: 'Fair division with the best clause available: one of the candidate\'s assignments must change.',
    shape: 'shape1', expected: 3, page: Q(9, 'fair'), status: 'sound', baseline: 'guide-09-fair-block',
    project: fromContrib('fair-division', 'Guide: fair division, clauses', FAIR + 'The best a clause can say: one ' +
      'of the candidate\'s assignments must change.' + SEE(9, T9), template('shape1'), {},
    (n, t) => (n === 'refine' ? null : n === 'check' ? t.replace(
      '% No relevant/1 rules: the loop passes the allocation alt/2 to the refine part.',
      '% Domination depends on sums over the whole allocation: the best clause says that\n' +
      '% one of the candidate\'s assignments must change.\nrelevant(gets(A,G)) :- gets(A,G).') : t)) });

  // ---- 10 Witnesses and cores
  add({ id: 'guide-10-core-block', summary: '3-colourable graphs on n = 5 nodes, blocking each graph without a colouring.',
    shape: 'custom', expected: 958, page: Q(10, 'core'), status: 'baseline',
    project: project('Guide: 3-colourable graphs, blocking',
      'Graphs on n nodes that can be 3-coloured; the check looks for a colouring (a witness), and a graph without ' +
      'one is blocked on its own.' + SEE(10, T10), DUAL, `solver A = shared + abstraction
solver C = shared + check
link   G = A -> C via shared + glue

# The check looks for a witness: a candidate without one is wrong.
search A:
    on candidate M:
        if not C.solve(assume G(M)):
            reject M with G.block(M)
`, { constants: { n: '5' }, solutions: 0, seconds: 60, trace: 200 }, {
      shared: 'Graphs on n nodes.', abstraction: 'Proposes candidates (solver A): any graph.',
      glue: 'The interface atoms: the edges.', check: 'Looks for a proper 3-colouring of the candidate, a witness (solver C).' }) });
  add({ id: 'guide-10-core-misused', summary: 'A core taken from a check whose failure means the candidate is good.',
    shape: 'custom', expected: 4057, page: Q(10, 'misused'), status: 'unsound', baseline: 'guide-05-paley-block',
    project: paley('Guide: a core from the wrong check',
      'The clique check looks for a counterexample, so its failure means the candidate is good. Treating it like a ' +
      'witness check rejects every solution with its core and accepts every wrong candidate.' + SEE(10, T10),
      DECL + `
# Wrong: C looks for a counterexample, not a witness.
search A:
    on candidate M:
        if not C.solve(assume G(M)):
            reject M with G.core(C)
`, { f: { check: CLIQUE } }) });
  add({ id: 'guide-10-minimal-block', summary: 'Minimal sufficient reasons, blocking every candidate that one of the two checks refutes.',
    shape: 'custom', expected: 4, page: Q(10, 'two-checks'), status: 'baseline',
    project: fromContrib('minimal-reasons', 'Guide: minimal sufficient reasons, blocking',
      'Sufficient reasons without a redundant feature; a candidate that either check refutes is blocked on its ' +
      'own.' + SEE(10, T10), contrib('minimal-reasons').loop.text
        .replace('reject M with G.clause(M, X)', 'reject M with G.block(M)')
        .replace('reject M with GD.core(D)', 'reject M with G.block(M)'), {}) });

  // ---- 11 Optimisation
  const FEWEST = `% A candidate: any set of nodes to delete, as few as possible.
{ del(V) : node(V) }.
#minimize { 1,V : del(V) }.
#show del/1.
`;
  add({ id: 'guide-11-fewest-deletions', summary: 'Fewest deletions: candidates smallest first; the first one that survives the check is optimal.',
    shape: 'custom', expected: 1, page: Q(11, 'fewest'), status: 'demo', exhausted: false,
    project: paley('Guide: as few deletions as possible',
      'No bound k: the abstraction proposes deletion sets smallest first (A.solve with optimal), and the first one ' +
      'without a surviving clique has the fewest deletions.' + SEE(11, T11), DECL + `
# Smallest candidate first; the first one without a counterexample is optimal.
loop:
    M = A.solve(optimal)
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        stop
`, { f: { abstraction: FEWEST }, desc: { abstraction: 'Proposes candidates (solver A): any deletion set, fewest deletions first.' } }) });
  add({ id: 'guide-11-ex1', summary: 'All deletion sets of the smallest size: after the first, a cap forbids larger ones.',
    shape: 'custom', expected: 39, page: Q(11, 'exercise-1-solution'), status: 'sound', baseline: 'guide-05-paley-block',
    project: paley('Guide: every optimal deletion set',
      'As the fewest-deletions loop, but after the first solution a program part cap forbids larger deletion sets, ' +
      'and the loop lists every optimal one.' + SEE(11, T11), `solver A = shared + abstraction + cap
solver C = shared + check          options "--heuristic=Domain"
link   G = A -> C via shared + glue

# After the first solution, the part cap forbids larger deletion sets; the loop goes
# on and lists the others of the same size.
capped = false
loop:
    M = A.solve(optimal)
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        A.add(G.block(M))
        if not capped:
            A.expand(cap, best = M.atoms(size/1))
            capped = true
`, { f: { abstraction: FEWEST.replace('#show del/1.\n', '% The number of deletions.\nsize(N) :- N = #count { V : del(V) }.\n#show del/1.\n'),
        cap: `#program cap(i).
% best(i,size(B)): the fewest deletions are B. No larger set is of interest.
:- best(i,size(B)), size(N), N > B.
` }, desc: { abstraction: 'Proposes candidates (solver A): any deletion set, fewest deletions first.',
        cap: 'Grounded once, after the first solution: forbids larger deletion sets.' } }) });
  // ---- 12 Your own loop: conformant planning in a 3 x 3 room (the library example
  // conformant-planning has a 4 x 4 room with a pillar, too slow for a blocking run).
  const T12 = 'Your own loop: a walkthrough and a checklist';
  const R = (anchor) => `guide/12-your-own-loop.html#${anchor}`;
  const ROOM = (n, t) => (n === 'shared' ? t.replace(
    '% A robot in a 4 x 4 room with one pillar. It does not know where it starts.\ncell(1..4,1..4).\npillar(2,3).',
    '% A robot in a 3 x 3 room. It does not know where it starts.\ncell(1..3,1..3).\npillar(0,0).   % no pillar') : t);
  const plan = (title, description, loop, edit = (n, t) => t) => fromContrib('conformant-planning', title,
    'A plan of t moves that takes a robot to the goal from every start cell of a 3 x 3 room. ' + description + SEE(12, T12),
    loop, { constants: { t: '6' } }, (n, t) => edit(n, ROOM(n, t)));
  const noRelevant = '% No relevant/1 rules: the loop passes the start cell to the refine part.';
  const dropRefine = (n, t) => (n === 'refine' ? null : t);
  add({ id: 'guide-12-step1-guess', summary: 'Step 1: the guess alone, every sequence of t moves accepted.',
    shape: 'reference', expected: 4096, page: R('step-guess'), status: 'demo',
    project: plan('Guide: plans, the guess alone', 'The check is #false: every candidate is accepted, which shows the ' +
      'size of the candidate space.', template('reference'),
    (n, t) => (n === 'refine' ? null : n === 'check' ? '% Step 1: no counterexample yet; every candidate is accepted.\n#false.\n' : t)) });
  add({ id: 'guide-12-step2-block', summary: 'Step 2: the real check, every failing plan blocked on its own.',
    shape: 'reference', expected: 80, page: R('step-block'), status: 'baseline',
    project: plan('Guide: plans, blocking', 'The check looks for a start cell from which the plan misses the goal; ' +
      'every failing plan is blocked on its own: the ground truth.', template('reference'), dropRefine) });
  add({ id: 'guide-12-step3-clause', summary: 'Step 3: the best clause marks every move, and is a block in disguise.',
    shape: 'shape1', expected: 80, page: R('step-clause'), status: 'sound', baseline: 'guide-12-step2-block',
    project: plan('Guide: plans, clauses', 'The robot\'s path from the failing start cell can change with any move, so ' +
      'every move is relevant: the clause is as weak as a block.', template('shape1'),
    (n, t) => (n === 'refine' ? null : n === 'check' ? t.replace(noRelevant,
      '% Any move can change the path from this start cell: every move is relevant.\nrelevant(do(T,D)) :- do(T,D).') : t)) });
  add({ id: 'guide-12-step4-rules', summary: 'Step 4: each failing start cell becomes a copy of the robot inside the abstraction (Shape 3).',
    shape: 'shape3', expected: 80, page: R('step-rules'), status: 'sound', baseline: 'guide-12-step2-block',
    variants: [{ t: '7' }],
    project: plan('Guide: plans, rules', 'Each counterexample start cell is grounded into the abstraction as a copy ' +
      'of the robot that must reach the goal too (Shape 3).', contrib('conformant-planning').loop.text) });

  // ==== Part II: loops from the literature =================================================
  const P2 = { 13: '13-qbf', 14: '14-hitting-sets', 15: '15-marco', 16: '16-cegis', 17: '17-oll', 18: '18-benders', 19: '19-more-levels', 20: '20-lazy-and-omission', 21: '21-voting-case-study' };
  const RP = (n, anchor) => `guide/${P2[n]}.html#${anchor}`;
  const T13 = '2QBF, by clauses and by expansion', T14 = 'Implicit hitting sets', T15 = 'MARCO: two kinds of answer';
  const T16 = 'CEGIS: synthesis from counterexamples', T17 = 'Core-guided optimisation: OLL', T18 = 'Benders decomposition',
    T19 = 'More than two quantifier levels', T20 = 'Lazy constraints and omission';

  // ---- 13 2QBF: one random formula, 12 x-variables, 5 y-variables, 16 terms
  const qbfFacts = '% A random 2QBF: exists x1..x12 forall y1..y5 : T1 v ... v T16, three literals per\n' +
    '% term (generator qbf-dnf of the library example qbf, nx = 12, ny = 5, t = 16, seed 1).\n' + QBF_GUIDE + '\n';
  const qbfShared = (t) => t.replace(/^[\s\S]*?(term\(T\) :- xlit)/, qbfFacts + '$1');
  const qbfFrom = (id, title, description, loop, edit = (n, t) => t) => fromContrib(id, title, description + SEE(13, T13), loop, {},
    (n, t) => (n === 'view' ? null : n === 'shared' ? qbfShared(t) : edit(n, t)));
  const qbfLoop = contrib('qbf').loop.text;
  add({ id: 'guide-13-qbf-block', summary: '2QBF on a random formula: every x-assignment that a y-assignment refutes is blocked.',
    shape: 'shape1', expected: 2448, page: RP(13, 'block'), status: 'baseline',
    project: qbfFrom('qbf', 'Guide: 2QBF, blocking', 'Exists x forall y: the abstraction guesses the x-variables, the check a ' +
      'y-assignment that falsifies every term, and a refuted candidate is blocked on its own.', qbfLoop.replace('G.clause(X)', 'G.block(M)')) });
  add({ id: 'guide-13-qbf-clause', summary: '2QBF with a clause over the x-literals that keep the open terms false.',
    shape: 'shape1', expected: 2448, page: RP(13, 'clause'), status: 'sound', baseline: 'guide-13-qbf-block',
    project: qbfFrom('qbf', 'Guide: 2QBF, clauses', 'The same loop with the refinement of the library example qbf: one ' +
      'of the x-literals that keep an open term false must flip.', qbfLoop) });
  add({ id: 'guide-13-qbf-expansion', summary: '2QBF by expansion: each counterexample adds a copy of the formula, instantiated with its y-values.',
    shape: 'shape3', expected: 2448, page: RP(13, 'expansion'), status: 'sound', baseline: 'guide-13-qbf-block',
    project: qbfFrom('qbf-expansion', 'Guide: 2QBF by expansion', 'Each counterexample y-assignment instantiates the ' +
      'formula in the abstraction (#program refine(k)): later candidates must make a term true that the assignment leaves open.',
    contrib('qbf-expansion').loop.text) });
  add({ id: 'guide-13-ex1', summary: 'Exercise: one false x-literal per open term is enough for a sound clause.',
    shape: 'shape1', expected: 2448, page: RP(13, 'exercise-1-solution'), status: 'sound', baseline: 'guide-13-qbf-block',
    project: qbfFrom('qbf', 'Guide: 2QBF, one literal per open term', 'The clause names, for each open term, only the ' +
      'false x-literal with the smallest index: while it stays false, the term stays false.', qbfLoop,
    (n, t) => (n === 'check' ? t.replace('relevant(x(I)) :- bad(T,I), not closed(T).',
      '% One false x-literal per open term is enough: the smallest one.\nrelevant(x(I)) :- bad(T,I), not closed(T), I = #min { J : bad(T,J) }.') : t)) });

  // ---- 14 Implicit hitting sets: the instance 'example' of maxsat-ihs (optimum 8)
  const ihsHead = `solver A = shared + abstraction
solver C = shared + check
link   G = A -> C via shared + glue
`;
  const ihs = (title, description, body) => fromContrib('maxsat-ihs', title, description + SEE(14, T14), ihsHead + body,
    {}, (n, t) => (n === 'check' ? t.replace(/% Not needed for correctness[\s\S]*?#minimize[^\n]*\n/, '') : t));
  add({ id: 'guide-14-ihs-block', summary: 'MaxSAT: the cheapest set of soft clauses to give up, blocking every set the SAT check refutes.',
    shape: 'custom', expected: 1, page: RP(14, 'block'), status: 'demo', exhausted: false,
    project: ihs('Guide: MaxSAT, blocking', 'The abstraction proposes the cheapest set of soft clauses to give up ' +
      '(A.solve(optimal)); the check looks for an assignment that satisfies the rest. A refuted set is blocked; the first set ' +
      'with a witness is optimal.', `
# The cheapest drop set first; the first one the check satisfies is optimal.
loop:
    M = A.solve(optimal)
    if not M: stop "the hard clauses are unsatisfiable"
    if C.solve(assume G(M)):
        accept M
        stop
    A.add(G.block(M))
`) });
  add({ id: 'guide-14-ihs-core', summary: 'The same loop refined by the unsat core: the next drop set must hit it.',
    shape: 'custom', expected: 1, page: RP(14, 'core'), status: 'demo', exhausted: false,
    project: ihs('Guide: MaxSAT, cores', 'A refuted drop set is refined by the core of the failed check: at least one ' +
      'soft clause of the core must be dropped. The abstraction becomes an optimal hitting set of the cores.', `
# A refuted drop set: its core is a set of soft clauses that cannot all hold.
loop:
    M = A.solve(optimal)
    if not M: stop "the hard clauses are unsatisfiable"
    if C.solve(assume G(M)):
        accept M
        stop
    A.add(G.core(C))
`) });
  add({ id: 'guide-14-ihs-minimal', summary: 'Minimal cores: each core shrunk until no clause can be left out, and the lower bound tracked.',
    shape: 'custom', expected: 1, page: RP(14, 'minimal'), status: 'demo', exhausted: false,
    project: ihs('Guide: MaxSAT, minimal cores', 'Each core is made subset-minimal (C.core.minimal) before it refines the ' +
      'hitting-set solver; the cost of each hitting set is a lower bound (track).', `
# A minimal core is a short clause: fewer hitting sets to try.
loop:
    M = A.solve(optimal)
    if not M: stop "the hard clauses are unsatisfiable"
    track lower = M.cost
    if C.solve(assume G(M)):
        accept M
        stop
    A.add(C.core.minimal.on(G))
`) });
  // ---- 15 MARCO: the instance 'example' of marco (7 MUSes, 12 MSSes)
  const marcoHead = `solver A = shared + abstraction    options "--heuristic=Domain"
solver C = shared + check
link   G = A -> C via shared + glue
`;
  const marco = (title, description, body, edit) => fromContrib('marco', title, description + SEE(15, T15), marcoHead + body, {}, edit);
  add({ id: 'guide-15-mus-block', summary: 'Every MUS of a CNF formula, looking at every subset of its clauses once.',
    shape: 'custom', expected: 7, page: RP(15, 'block'), status: 'baseline',
    project: marco('Guide: MUSes, every subset', 'The map proposes any set of clauses; an unsatisfiable set is a MUS when ' +
      'every set with one clause less is satisfiable. Every set is blocked after its check.', `
# Every seed is looked at once: an unsatisfiable seed is a MUS when every seed with one
# clause less is satisfiable.
loop:
    M = A.solve()
    if not M: stop
    E = G(M)
    if not C.solve(assume E):
        minimal = true
        for a in E:
            if a.true and not C.solve(assume E.flip(a)): minimal = false
        if minimal: accept M
    A.add(G.block(M))
`) });
  add({ id: 'guide-15-mus-above', summary: 'Shrink an unsatisfiable seed to a MUS and block all its supersets (G.above).',
    shape: 'custom', expected: 7, page: RP(15, 'shrink'), status: 'sound', baseline: 'guide-15-mus-block',
    project: marco('Guide: MUSes by shrinking', 'An unsatisfiable seed is shrunk to a MUS by dropping clauses while the check ' +
      'still fails; the MUS and every superset leave the map. Satisfiable seeds are still blocked one at a time.', `
# Unsatisfiable: shrink to a MUS, report it, and remove it and its supersets from the map.
loop:
    M = A.solve()
    if not M: stop
    E = G(M)
    if C.solve(assume E):
        A.add(G.block(M))
    else:
        for a in E:
            if a.true and not C.solve(assume E.flip(a)): E = E.flip(a)
        accept A.solve(assume E)
        A.add(G.above(E))
`) });
  add({ id: 'guide-15-ex1', summary: 'Exercise: MARCO with the smallest seeds first.',
    shape: 'custom', expected: 7, page: RP(15, 'exercise-1-solution'), status: 'sound', baseline: 'guide-15-mus-block',
    project: fromContrib('marco', 'Guide: MARCO, smallest seeds first', 'The MARCO loop with the map deciding every clause ' +
      'to false first: unexplored seeds come smallest first.' + SEE(15, T15), contrib('marco').loop.text, {},
    (n, t) => (n === 'abstraction' ? t.replace('#heuristic pick(C) : cl(C). [1,true]', '#heuristic pick(C) : cl(C). [1,false]')
      .replace("% Maximal seeds first (Liffiton and Malik's getUnexploredMax): with --heuristic=Domain the\n% solver decides every pick to true first.",
        '% Minimal seeds first: with --heuristic=Domain the solver decides every pick to false first.') : t)) });

  // ---- 16 CEGIS: majority circuits of g gates over m = 3 inputs
  const cegisLoop = contrib('cegis-circuit').loop.text;
  const cegisBlock = `solver A = shared + abstraction
solver C = shared + check
link   G = A -> C via shared + glue

# Every circuit that is wrong on some input is blocked on its own.
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.block(M))
    else:
        accept M
        A.add(G.block(M))
`;
  const cegis = (title, description, loop, settings, edit) => fromContrib('cegis-circuit', title, description + SEE(16, T16), loop, settings, edit);
  add({ id: 'guide-16-cegis-block', summary: 'Majority circuits of three gates: every circuit the verifier refutes is blocked.',
    shape: 'custom', expected: 0, page: RP(16, 'block'), status: 'baseline',
    project: cegis('Guide: circuit synthesis, blocking', 'The synthesiser proposes any circuit of g gates; the verifier looks for an input ' +
      'where it differs from the majority function; a wrong circuit is blocked on its own.', cegisBlock, { constants: { m: '3', g: '3' } }) });
  add({ id: 'guide-16-cegis', summary: 'CEGIS: each counterexample input is simulated in the synthesiser from then on.',
    shape: 'shape3', expected: 0, page: RP(16, 'cegis'), status: 'sound', baseline: 'guide-16-cegis-block', variants: [{ g: '4' }],
    project: cegis('Guide: circuit synthesis by CEGIS', 'Each input on which a circuit is wrong is grounded in the synthesiser ' +
      '(refine(k)), which from then on simulates every circuit on it: the synthesiser learns examples, not circuits.', cegisLoop, { constants: { m: '3', g: '3' } }) });
  add({ id: 'guide-16-ex1', summary: 'Exercise: CEGIS for the parity of two inputs.',
    shape: 'shape3', expected: 2, page: RP(16, 'exercise-1-solution'), status: 'demo', variants: [{ g: '2' }],
    project: cegis('Guide: parity circuits by CEGIS', 'The CEGIS loop with another specification: the parity (exclusive or) of ' +
      'm = 2 inputs.', cegisLoop, { constants: { m: '2', g: '3' } },
    (n, t) => (n === 'check' ? t.replace('% The specification (only the verifier knows it): the majority of the inputs.', '% The specification (only the verifier knows it): the parity of the inputs.')
      .replace('spec :- ones(N), 2 * N > m.', 'spec :- ones(N), N \\ 2 == 1.') : t)) });

  // ---- 17 OLL: the instance 'example' of maxsat-oll (unweighted, optimum 6), here as IHS
  const ollFacts = contrib('maxsat-oll').instances.find((x) => x.id === 'example').facts.replace(/soft\((\d+)\)\./g, 'soft($1,1).')
    .replace('% Random MaxSAT:', '% Random MaxSAT (every soft clause has weight 1):');
  const ihsLoop = contrib('maxsat-ihs').loop.text;
  add({ id: 'guide-17-ihs', summary: 'The unweighted MaxSAT instance of the OLL chapter, solved by the implicit hitting set loop of chapter 14.',
    shape: 'custom', expected: 1, page: RP(17, 'ihs'), status: 'demo', exhausted: false,
    project: fromContrib('maxsat-ihs', 'Guide: MaxSAT by hitting sets, for comparison', 'The MaxHS loop of chapter 14 on the ' +
      'instance of maxsat-oll (every weight 1).' + SEE(17, T17), ihsLoop, {},
    (n, t) => (n === 'shared' ? ollFacts + t.slice(t.indexOf('% The instance (Instances tab)')) : t)) });

  // ---- 18 Benders: the instance 'example' of benders-tardiness (optimum 20)
  const bendersLoop = contrib('benders-tardiness').loop.text;
  add({ id: 'guide-18-benders-exact', summary: 'Benders with weak cuts: a cut applies only when a machine gets exactly the same jobs again.',
    shape: 'custom', expected: 1, page: RP(18, 'exact'), status: 'demo', exhausted: false,
    project: fromContrib('benders-tardiness', 'Guide: Benders with exact-set cuts', 'The Benders loop of benders-tardiness, but ' +
      'a cut raises the estimate only for an assignment that gives the machine exactly the jobs of the subproblem, not a superset.' +
      SEE(18, T18), bendersLoop, {},
    (n, t) => (n === 'abstraction' ? t.replace('covered(k,M) :- need(k,M,_), assign(J,M) : cut(k,has(M,J)).',
      '% Weak: only exactly these jobs (no other job on M).\ncovered(k,M) :- need(k,M,_), assign(J,M) : cut(k,has(M,J)); not assign(J,M) : job(J,_,_), not cut(k,has(M,J)).') : t)) });

  // ---- 19 More levels: knapsack fortification, blocking at both inner levels
  const fortLoop = contrib('knapsack-fortification').loop.text;
  add({ id: 'guide-19-fortify-block', summary: 'Trilevel knapsack: every attack and every fortification that fails is blocked on its own.',
    shape: 'custom', expected: 2, page: RP(19, 'block'), status: 'baseline',
    project: fromContrib('knapsack-fortification', 'Guide: fortification, blocking', 'Three solvers in a chain; a refuted attack ' +
      'and a refuted fortification are each blocked on their own.' + SEE(19, T19),
    fortLoop.replace('                B.add(GA.clause(Y, K))', '                B.add(GA.block(Y))')
      .replace('                reject M with GF.clause(M, Y)', '                reject M with GF.block(M)')
      .slice(0, fortLoop.indexOf('# The reference run blocks')).trimEnd() + '\n',
    { constants: { ...contrib('knapsack-fortification').settings.constants, ...(contrib('knapsack-fortification').instances.find((x) => x.id === 'example').constants || {}) } }) });

  // ---- 20 Lazy constraints and omission: n queens without the diagonals, blocking
  const queensHead = contrib('queens-omission').loop.text.split('loop:')[0];
  add({ id: 'guide-20-queens-block', summary: 'n queens: the abstraction knows rows and columns only; a placement on a shared diagonal is blocked.',
    shape: 'custom', expected: 4, page: RP(20, 'omission'), status: 'baseline',
    project: fromContrib('queens-omission', 'Guide: n queens, blocking', 'The abstraction of queens-omission with every diagonal ' +
      'constraint off; a placement that the full program rejects is blocked on its own.' + SEE(20, T20), queensHead.replace(/# Omission-based[\s\S]*$/, '') + `loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.block(M))
    else:
        accept M
        A.add(G.block(M))
`, { constants: { n: '6' } }) });

  // ---- B1: an exercise on a fresh problem in chapters 5-12, each with a blocking starter
  const blockLoop = (id) => contrib(id).loop.text.replace(/G\.clauses?\([^)]*\)/g, 'G.block(M)').replace(/A\.expand\([^\n]*\)/g, 'A.add(G.block(M))');
  const FRESH = [
    [5, 'qbf', 'guide-05-ex2-qbf-block', '2QBF, blocking', 5, 'Reading a run'],
    [6, 'af-preferred', 'guide-06-ex2-af-block', 'preferred extensions, blocking', 3, 'Getting more out of each check'],
    [7, 'strategic-companies', 'guide-07-ex2-companies-block', 'strategic companies, blocking', 2, 'Designing the abstraction'],
    [8, 'af-semi-stable', 'guide-08-ex2-semistable-block', 'semi-stable extensions, blocking', 2, 'Loop shapes'],
    [10, 'diagnosis', 'guide-10-ex2-diagnosis-block', 'diagnosis, blocking', 2, 'Checks that look for a witness, and cores'],
    [12, 'abduction', 'guide-12-ex2-abduction-block', 'abduction, blocking', 17, 'Your own loop: a walkthrough and a checklist'],
  ];
  const CH = { 5: '05-reading-a-run', 6: '06-more-per-check', 7: '07-abstraction', 8: '08-loop-shapes', 10: '10-witness-and-cores', 12: '12-your-own-loop' };
  for (const [n, src, id, what, sols, title] of FRESH) {
    add({ id, summary: `Exercise starter: ${what}; write the refinement yourself (the library example ${src} is a solution).`,
      shape: 'custom', expected: sols, page: `guide/${CH[n]}.html#exercise-fresh-start`, status: 'baseline',
      project: fromContrib(src, `Guide exercise: ${what}`, `A starter on a fresh problem: the loop of the library example ${src} with every ` +
        `refinement replaced by a block. Find the interface, write a refinement, and compare with ${src}.` + SEE(n, title), blockLoop(src),
      { constants: { ...(contrib(src).settings.constants || {}), ...(((contrib(src).instances || []).find((x) => x.id === 'example') || {}).constants || {}) } },
      (name, t) => (name === 'view' ? null : t)) });
  }
  return E;
}
