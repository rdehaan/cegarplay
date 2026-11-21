// The examples of the design guide (guide/*.html), in reading order. Used by
// tools/make-examples.mjs and tools/guide-numbers.mjs. Every entry has the usual library
// fields plus page (the guide page and anchor that links it), status ('baseline', 'sound' or
// 'unsound') and, unless it is a baseline, baseline (the id of the blocking run of the same
// problem and constants). test/guide.test.mjs checks the statuses.
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

// Existing examples (not in the guide group) whose numbers a page quotes, with the constants
// they are run with. tools/guide-numbers.mjs measures them under the key ID or ID@name=value.
export const QUOTED = [
  { id: 'gc-reference' },
  { id: 'gc-shape1' },
  { id: 'graph-coloring-original', constants: { n: '5' } },
  { id: 'graph-coloring' },
  { id: 'graph-coloring-original' },
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
  return E;
}
