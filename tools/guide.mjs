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
const CHECK = `% A counterexample: a triangle none of whose nodes is deleted.
3 { q(V) : node(V) } 3.
:- q(V), del(V).
:- q(U), q(V), U < V, not edge(U,V).
#show q/1.

% The triangle survives as long as none of its nodes is deleted.
relevant(del(V)) :- q(V).
`;
const DESC = {
  shared: 'The graph. Added to every solver.',
  abstraction: 'Proposes candidates (solver A): at most k deleted nodes.',
  glue: 'The interface atoms: the deleted nodes.',
  check: 'Looks for a triangle that survives the deletions (solver C).',
};

const small = (title, description, loop) => project(title, description,
  { shared: SMALL_GRAPH, abstraction: ABSTRACTION, glue: GLUE, check: CHECK },
  loop, { constants: { k: '3' }, solutions: 0, seconds: 60, trace: 200 }, DESC);

// Every entry: id, summary, shape, tags, expected, page, status, baseline, project.
export function buildGuide() {
  const E = [];
  const add = (e) => E.push({ group: GUIDE_GROUP.id, tags: ['fast'], ...e });

  // Placeholders of phase G0 (replaced in G1): one blocking run and one clause run.
  add({ id: 'guide-01-demo-block', summary: 'The small graph with k = 3, each wrong candidate blocked on its own.',
    shape: 'reference', expected: 3, page: 'guide/01-why-a-loop.html#demo-block', status: 'baseline',
    project: small('Guide: blocking one candidate at a time',
      'Delete at most k = 3 nodes of the small graph so that no triangle is left; every wrong candidate is ' +
      'blocked on its own. See the guide page "Why a loop".', template('reference')) });
  add({ id: 'guide-01-demo-clause', summary: 'The small graph with k = 3, refined with one clause per surviving triangle.',
    shape: 'shape1', expected: 3, page: 'guide/01-why-a-loop.html#demo-clause', status: 'sound',
    baseline: 'guide-01-demo-block',
    project: small('Guide: learning from a triangle',
      'The same problem; a surviving triangle now teaches that one of its nodes must be deleted, which rules out ' +
      'many candidates at once. See the guide page "Why a loop".', template('shape1')) });
  return E;
}
