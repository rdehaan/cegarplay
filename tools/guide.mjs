// The examples of the design guide (guide/*.html), in reading order. Used by
// tools/make-examples.mjs and tools/guide-numbers.mjs. Every entry has the usual library
// fields plus page (the guide page and anchor that links it), status ('baseline', 'sound' or
// 'unsound') and, unless it is a baseline, baseline (the id of the blocking run of the same
// problem and constants). test/guide.test.mjs checks the statuses.
import fs from 'node:fs';
import { template } from '../js/project.js';
import { GROUPS, project } from './library.mjs';

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

// ---- sufficient reasons (page 6), from the library example sufficient-reason --------------
// The fragments are read from examples/contrib/sufficient-reason.json, so they stay identical.
const SR = JSON.parse(fs.readFileSync(new URL('../examples/contrib/sufficient-reason.json', import.meta.url), 'utf8'));
const srFrag = (n) => SR.fragments.find((f) => f.name === n);
const reason = (title, description, loop, editCheck = (c) => c) => project(title,
  description + ' See the guide page "Getting more out of each check".',
  Object.fromEntries(SR.fragments.map((f) => [f.name, f.name === 'check' ? editCheck(f.text) : f.text])), loop,
  { constants: { k: '4' }, solutions: 0, seconds: 60, trace: 200 },
  Object.fromEntries(SR.fragments.map((f) => [f.name, f.description || srFrag(f.name).description || 'Part of the sufficient-reason example.'])));

// Existing examples (not in the guide group) whose numbers a page quotes, with the constants
// they are run with. tools/guide-numbers.mjs measures them under the key ID or ID@name=value.
export const QUOTED = [
  { id: 'gc-reference' },
  { id: 'gc-shape1' },
  { id: 'graph-coloring-original', constants: { n: '5' } },
  { id: 'graph-coloring' },
  { id: 'graph-coloring-original' },
  { id: 'clique-interdiction' },
  { id: 'clique-interdiction', constants: { n: '17', k: '9' } },
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
    shape: 'reference', expected: 39, page: P(5, 'block'), status: 'baseline', variants: big,
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
  return E;
}
