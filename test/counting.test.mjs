// Counting rules (manual: Statistics tab, counting rules): a counterexample is a model that
// refuted a candidate, counted once, the first time a refinement is built from it; refinements are
// counted by source (from counterexamples, from cores, blocks), in total and per link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';
import { refinementCounts } from '../js/driver.js';

// a library example run to all solutions, its final S event
async function stats(id) {
  const p = load(H.read(`examples/${id}.json`));
  p.settings = { ...p.settings, solutions: 0, trace: 0, seconds: 0 };
  const r = await H.runProject(p);
  assert.equal(H.done(r).outcome, 'finished', `${id}: ${JSON.stringify(H.done(r))}`);
  return H.finalStats(r);
}

test('gc-shape1 keeps its counterexample count: every satisfiable check refutes its candidate', async () => {
  const S = await stats('gc-shape1');
  // the count of the runtime that counted every satisfiable solve under assumptions
  assert.equal(S.counterexamples, 1320);
  assert.deepEqual(refinementCounts(S), { total: 1320, from_models: 1320, from_cores: 0, blocks: 0, other: 0, split: true });
  assert.deepEqual(S.links, { G: { counterexamples: 1320, from_models: 1320, from_cores: 0, blocks: 0 } });
});

for (const id of ['lang-core', 'maxsat-ihs']) {
  test(`${id}: a witness check refines by cores, so 0 counterexamples and every refinement under cores`, async () => {
    const S = await stats(id);
    assert.equal(S.counterexamples, 0);
    const r = refinementCounts(S);
    assert.ok(r.total > 0);
    assert.equal(r.from_cores, r.total);
    assert.equal(r.from_models, 0);
    assert.equal(r.blocks, 0);
    assert.equal(r.other, 0);
    // the raw solves stay in the per-solver statistics: the witness check was satisfiable
    assert.ok(Object.values(S.solvers).some((x) => x.sat > 0 && x.unsat > 0));
    for (const x of Object.values(S.links)) assert.equal(x.counterexamples, 0);
  });
}

test('qbf-three-blocks credits each count to the link whose refinement used it', async () => {
  const S = await stats('qbf-three-blocks');
  // C's models refute B's candidates (GXY); C's cores refine A (GXC); GX carries assumptions only
  assert.deepEqual(S.links, {
    GXY: { counterexamples: 14, from_models: 14, from_cores: 0, blocks: 0 },
    GXC: { counterexamples: 0, from_models: 0, from_cores: 8, blocks: 0 },
  });
  assert.equal(S.counterexamples, 14);
  assert.deepEqual(refinementCounts(S), { total: 22, from_models: 14, from_cores: 8, blocks: 0, other: 0, split: true });
});

test('a model listed by C.models is no counterexample; refinements are cores and blocks', async () => {
  // kemeny-rankings lists rankings with C.models (no refinement from them) and refines by cores
  const S = await stats('kemeny-rankings');
  assert.equal(S.counterexamples, 0);
  assert.equal(S.solutions, 2);
  const r = refinementCounts(S);
  assert.equal(r.from_cores + r.blocks, r.total);
});

test('an older S event without the split: refinements are its clauses and expansions', () => {
  assert.deepEqual(refinementCounts({ clauses: 5, expansions: 2, blocks: 3 }), { total: 7, from_models: null, from_cores: null, blocks: null, other: null, split: false });
});
