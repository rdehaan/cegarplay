// Refinement lab, milestone 4: recorded runs read onto the space; their length against the exact
// loop-scheme bounds (Shape 2 and the reference run); the unsound tutorial example.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as H from './helpers.mjs';
import * as Lab from '../js/lab/core.js';
import { runReport, ladder, decomposition } from '../js/lab/report.js';
import { mapRun, percentile } from '../js/lab/runs.js';
import { Recording } from '../js/recording.js';
import { runProject, recordingOf } from '../tools/run.mjs';
import { loadTarget, auditProject } from '../tools/audit.mjs';
import { nodeExec, LUA } from '../tools/lab.mjs';

async function recorded(id, instance) {
  const p = loadTarget(id);
  const r = await runProject({ ...p, settings: { ...p.settings, solutions: 0, trace: 0, seconds: 60, record: { steps: 'all', n: 0 } } }, { instance });
  const rec = Recording.fromText(recordingOf({ ...p, instance }, r.events, { instance }).text());
  const ctx = await Lab.prepare(p, { instance }, nodeExec, LUA);
  const sp = await Lab.computeSpace(ctx);
  return { rec, sp, solutions: H.ofKind(r, 'M').length, done: H.last(r, 'D') };
}

for (const id of ['gc-shape2', 'gc-reference']) {
  test(`${id}: a recorded run maps onto the space step by step and its length lies within the exact loop-scheme bounds`, async () => {
    for (const instance of ['n3', 'n4']) {
      const { rec, sp, solutions, done } = await recorded(id, instance);
      const run = mapRun(sp, rec, { clauseSet: Lab.clauseSet });
      assert.deepEqual(run.problems, [], `${instance}: ${run.problems.join('; ')}`);
      assert.ok(run.steps.every((s) => s.cand >= 0), 'every step lands on a candidate of the space');
      const R = await runReport(nodeExec, sp, rec, { minimalCap: 50, seconds: 20 });
      assert.equal(R.lost, 0);
      assert.equal(R.badLeft, 0, 'every bad candidate removed at the end');
      assert.equal(R.notInOptions, 0, 'every clause of the run is one of the space\'s options');
      assert.equal(R.deadCand, 0, 'every refined candidate was alive (the idealised model)');
      const b = await Lab.bounds(nodeExec, sp, 'loop', { seconds: 20 });
      assert.ok(b.best.lower <= R.length && R.length <= b.worst.upper, `${instance}: ${R.length} within ${b.best.lower}..${b.worst.upper}`);
      if (b.best.status === 'proven') assert.ok(R.length >= b.best.value);
      if (b.worst.status === 'proven') assert.ok(R.length <= b.worst.value);
      // |Sol| equals the run's solution count (an exhausted run of a sound loop)
      assert.equal(done.exhausted, true);
      assert.equal(sp.sols.length, solutions, `${instance}: |Sol|`);
      // the ladder and the decomposition
      const sim = await Lab.simulation(nodeExec, sp, 'loop', { runs: 100 });
      const omni = await Lab.bounds(nodeExec, sp, 'omniscient', { seconds: 10 });
      const L = ladder({ sp, run: R, loop: b, omni, sim });
      assert.equal(L.rungs.length, 8);
      assert.equal(L.rungs.find((r) => r.key === 'run').lo, R.length);
      assert.equal(L.rungs.find((r) => r.key === 'bad').lo, sp.bad.length);
      assert.equal(L.percentile, percentile(sim.random.lengths, R.length));
      assert.equal(L.outside, null, 'Shape 2 and the reference run fit the idealised model');
      const D = decomposition({ sp, run: R, loop: b, omni, sim });
      assert.deepEqual(D.map((d) => d.key), ['looseness', 'strength', 'luck']);
      assert.equal(D[0].value, sp.bad.length);
      if (id === 'gc-reference') assert.equal(R.length, sp.bad.length, 'the reference run refines every bad candidate once');
    }
  });
}

test('gc-shape1 (Shape 1): the run is reported against the bounds, not asserted', async () => {
  const { rec, sp } = await recorded('gc-shape1', 'n4');
  const R = await runReport(nodeExec, sp, rec, { minimalCap: 20, seconds: 10 });
  assert.equal(R.shape1, true);
  assert.ok(R.length > 0 && R.rows.length === R.length);
  assert.ok(R.top.length <= 5);
});

test('regret: per step, the best option prunes at least as much as the run\'s clause when the clause is an option', async () => {
  const { rec, sp } = await recorded('gc-shape2', 'n4');
  const R = await runReport(nodeExec, sp, rec, { minimalCap: 50, seconds: 20 });
  for (const r of R.rows) {
    assert.ok(r.bestOpt >= r.prune && r.regret === r.bestOpt - r.prune);
    if (r.bestMin != null) assert.ok(r.bestMin >= 1);
  }
  const sorted = R.rows.slice().sort((a, b) => b.regret - a.regret || a.ref - b.ref).filter((r) => r.regret > 0).slice(0, 5);
  assert.deepEqual(R.top.map((r) => r.ref), sorted.map((r) => r.ref));
  // a step of the run opened in the inspector has the run's alive set and clause
  const at = Lab.stepAt(sp, rec, R.rows[3].i);
  const I = Lab.inspect(sp, at.step.cand, { alive: at.alive, chosen: at.step.set });
  assert.equal(I.run.prune, R.rows[3].prune);
  assert.equal(I.aliveCount, R.rows[3].alive);
});

test('tutorial-weak-relevant: unsound options and lost solutions; the witness agrees with the audit\'s', async () => {
  const p = loadTarget('tutorial-weak-relevant');
  const ctx = await Lab.prepare(p, {}, nodeExec, LUA);
  const sp = await Lab.computeSpace(ctx);
  const s = Lab.loopSoundness(sp);
  const a = (await auditProject(p, {})).verdict;
  assert.equal(s.sound, false);
  assert.equal(s.unsound, a.unsound);
  assert.equal(s.atRisk, a.at_risk);
  const w = s.witness, aw = a.witness;
  assert.deepEqual(w.candidateAtoms, aw.candidate);
  assert.deepEqual(w.relevant, aw.relevant);
  assert.deepEqual(w.solutionAtoms, aw.solution);
  assert.deepEqual(w.differ, aw.differ);
  // the inspector at the witness: the option is unsound and its lost solution differs on the same atoms
  const mins = (await Lab.minimalFor(nodeExec, sp, [w.candidate])).get(w.candidate);
  const I = Lab.inspect(sp, w.candidate, { minimal: mins });
  const op = I.options.find((o) => !o.sound);
  assert.ok(op && op.lost > 0);
  assert.match(I.verdict, /unsound: it removes \d+ solutions?/);
  // the stored recording (17 refinements, refinement 6 the first unsound) loses solutions
  const rec = Recording.fromText(zlib.gunzipSync(fs.readFileSync(H.path('test/fixtures/recordings/tutorial-weak-relevant.cprec'))).toString());
  const R = await runReport(nodeExec, sp, rec, { minimalCap: 50 });
  assert.ok(R.lost > 0, 'the run removes solutions');
  assert.equal(R.rows.findIndex((r) => r.lost > 0) >= 0, true);
});
