// Refinement lab, milestone 3: exact best and worst runs against a brute-force enumeration of every
// idealised run on tiny spaces; invariants of the schemes, the simulation and the greedy policies.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Lab from '../js/lab/core.js';
import { schemeOptions, incidence, exactBounds, boundsProgram, cheapBounds } from '../js/lab/bounds.js';
import { simulate, greedy, stats, rng } from '../js/lab/simulate.js';
import { agrees } from '../js/lab/sets.js';
import { nodeExec, LUA } from '../tools/lab.mjs';
import { loadTarget } from '../tools/audit.mjs';
import { randomSpace } from './lab-helpers.mjs';

// Every idealised run, by memoised search over the set of alive bad candidates (a bitmask):
// the shortest and longest number of refinements. Independent of bounds.js.
function bruteRuns(sp, so) {
  const bad = Array.from(sp.bad), pos = new Map(bad.map((c, k) => [c, k]));
  assert.ok(bad.length <= 18, 'tiny space');
  const removes = bad.map((M) => so.opts[M].map((s) => {
    let m = 0;
    for (const c of bad) if (agrees(sp, c, s.r, s.v)) m |= 1 << pos.get(c);
    return m;
  }));
  const memo = new Map();
  const go = (alive) => {
    if (alive === 0) return [0, 0];
    if (memo.has(alive)) return memo.get(alive);
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < bad.length; k++) {
      if (!(alive & (1 << k))) continue;
      for (const m of removes[k]) {
        const [a, b] = go(alive & ~m);
        lo = Math.min(lo, a + 1); hi = Math.max(hi, b + 1);
      }
    }
    memo.set(alive, [lo, hi]);
    return [lo, hi];
  };
  return go((1 << bad.length) - 1);
}

test('the exact program gives the brute-force best and worst on synthetic spaces (loop, block and omniscient schemes)', async () => {
  let checked = 0;
  for (const [n, count, nsol, seed] of [[5, 14, 4, 1], [6, 16, 4, 2], [6, 18, 6, 3], [5, 12, 0, 4], [7, 20, 5, 5], [6, 15, 3, 6], [7, 22, 8, 7]]) {
    const sp = randomSpace(n, count, nsol, seed);
    const minimal = await Lab.minimalFor(nodeExec, sp, Array.from(sp.bad), { cap: 50 });
    for (const scheme of ['loop', 'block', 'omniscient']) {
      const so = schemeOptions(sp, scheme, { minimal });
      const inc = incidence(sp, so);
      const [lo, hi] = bruteRuns(sp, so);
      const cb = cheapBounds(inc);
      assert.ok(cb.lower <= lo && cb.upper >= hi, `cheap bounds ${cb.lower}..${cb.upper} around ${lo}..${hi}`);
      const r = await exactBounds(nodeExec, sp, inc, { seconds: 20 });
      assert.equal(r.best.status, 'proven', `${scheme} n=${n} seed=${seed}`);
      assert.equal(r.worst.status, 'proven');
      assert.equal(r.best.value, lo, `best ${scheme} n=${n} seed=${seed}`);
      assert.equal(r.worst.value, hi, `worst ${scheme} n=${n} seed=${seed}`);
      assert.ok(r.best.valid && r.worst.valid, 'the selections order into valid runs');
      if (scheme === 'block') assert.deepEqual([lo, hi], [sp.bad.length, sp.bad.length]);
      // every simulated run and both greedy runs lie within the bounds
      const sim = simulate(sp, so, { runs: 200, seed });
      assert.ok(sim.min >= lo && sim.max <= hi, `simulation ${sim.min}..${sim.max} within ${lo}..${hi}`);
      for (const g of [greedy(sp, inc, 'best'), greedy(sp, inc, 'worst')]) assert.ok(g.length >= lo && g.length <= hi);
      checked++;
    }
  }
  assert.equal(checked, 21);
});

test('the bounds program stops at its budget with what it knows', async () => {
  const ctx = await Lab.prepare(loadTarget('tutorial-first-run'), {}, nodeExec, LUA);
  const sp = await Lab.computeSpace(ctx);
  const so = schemeOptions(sp, 'loop');
  const inc = incidence(sp, so);
  const t0 = Date.now();
  const r = await exactBounds(nodeExec, sp, inc, { seconds: 1 });
  assert.ok(Date.now() - t0 < 30000);
  for (const b of [r.best, r.worst]) {
    assert.ok(['proven', 'budget'].includes(b.status));
    if (b.status === 'budget') assert.match(b.text, /not proven within the budget of 1 s/);
    assert.ok(b.lower <= b.upper);
  }
  assert.ok(boundsProgram(inc).includes('#edge (C,D)'));
});

test('invariants on gc-shape2 n3 and n4: block best = worst = |Bad|; omniscient best <= loop best; simulation and greedy within proven bounds', async () => {
  const ctx = await Lab.prepare(loadTarget('gc-shape2'), { instance: 'n3' }, nodeExec, LUA);
  const sp = await Lab.computeSpace(ctx);
  const block = await Lab.bounds(nodeExec, sp, 'block', { seconds: 20 });
  assert.deepEqual([block.best.value, block.worst.value, block.proven], [sp.bad.length, sp.bad.length, true]);
  const loop = await Lab.bounds(nodeExec, sp, 'loop', { seconds: 20 });
  const omni = await Lab.bounds(nodeExec, sp, 'omniscient', { seconds: 20 });
  assert.ok(loop.proven && omni.proven);
  assert.ok(omni.best.value <= loop.best.value, 'a sound scheme is no better than the omniscient one');
  const sim = await Lab.simulation(nodeExec, sp, 'loop', { runs: 300 });
  for (const x of [sim.random.min, sim.random.max, sim.first.min, sim.first.max, sim.greedyBest.length, sim.greedyWorst.length]) {
    assert.ok(x >= loop.best.value && x <= loop.worst.value, `${x} within ${loop.best.value}..${loop.worst.value}`);
  }
  // n4: block proven at |Bad| also for 153 bad candidates
  const ctx4 = await Lab.prepare(loadTarget('gc-shape2'), { instance: 'n4' }, nodeExec, LUA);
  const sp4 = await Lab.computeSpace(ctx4);
  const b4 = await Lab.bounds(nodeExec, sp4, 'block', { seconds: 30 });
  assert.deepEqual([b4.best.value, b4.worst.value], [153, 153]);
  const s4 = await Lab.simulation(nodeExec, sp4, 'block', { runs: 20 });
  assert.deepEqual([s4.random.min, s4.random.max], [153, 153]);
});

test('above the exact threshold the bounds are skipped with a reason; the simulation still runs', async () => {
  const ctx = await Lab.prepare(loadTarget('gc-shape2'), { instance: 'n4' }, nodeExec, LUA);
  const sp = await Lab.computeSpace(ctx);
  const b = await Lab.bounds(nodeExec, sp, 'loop', { exact: 100 });
  assert.match(b.skipped, /153 bad candidates, above the exact-bounds threshold of 100/);
  const s = await Lab.simulation(nodeExec, sp, 'loop', { runs: 50, seed: 3 });
  assert.equal(s.random.runs, 50);
  const again = await Lab.simulation(nodeExec, sp, 'loop', { runs: 50, seed: 3 });
  assert.deepEqual(again.random.lengths, s.random.lengths, 'the same seed gives the same runs');
  assert.ok(stats([3, 1, 2]).median === 2 && typeof rng(1)() === 'number');
});

test('an unsound scheme: tutorial-weak-relevant loses solutions in the simulation and the bounds say so', async () => {
  const ctx = await Lab.prepare(loadTarget('tutorial-weak-relevant'), {}, nodeExec, LUA);
  const sp = await Lab.computeSpace(ctx);
  const sim = await Lab.simulation(nodeExec, sp, 'loop', { runs: 200 });
  assert.ok(sim.unsound > 0 && sim.random.lostRuns > 0 && sim.random.lost > 0);
  const b = await Lab.bounds(nodeExec, sp, 'loop', { seconds: 3 });
  assert.match(b.note, /the scheme is unsound: 499 options remove a solution/);
  assert.ok(b.best.atRisk > 0, 'the best run puts solutions at risk');
});

test('the simulation handles the audit\'s full cap of 200,000 candidates, and a budget stops it with what it has', () => {
  const sp = randomSpace(18, 200000, 500, 3);
  const so = schemeOptions(sp, 'loop');
  const r = simulate(sp, so, { runs: 3, seed: 1, budgetMs: 60000 });
  assert.equal(r.runs, 3);
  assert.ok(r.min > 0 && r.max <= sp.bad.length);
  const cut = simulate(sp, so, { runs: 1000, seed: 1, budgetMs: 300 });
  assert.ok(cut.runs < 1000 && /budget of 0\.3 s: \d+ of 1000 runs/.test(cut.stopped));
});

test('the packing bound proves the best runs of the tutorial examples at once (14 and 4)', async () => {
  for (const [id, best] of [['tutorial-first-run', 14], ['tutorial-weak-relevant', 4]]) {
    const ctx = await Lab.prepare(loadTarget(id), {}, nodeExec, LUA);
    const sp = await Lab.computeSpace(ctx);
    const inc = incidence(sp, schemeOptions(sp, 'loop'));
    assert.equal(cheapBounds(inc).packing, best);
    const t0 = Date.now();
    const r = await exactBounds(nodeExec, sp, inc, { seconds: 30 });
    assert.deepEqual([r.best.status, r.best.value, r.best.by], ['proven', best, 'bound'], id);
    assert.match(r.best.text, /proven: no run is shorter than the packing bound/);
    assert.ok(r.worst.upper <= sp.bad.length);
    void t0;
  }
});
