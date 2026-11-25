// Refinery, milestone 1: brute-force cross-checks of removal sets, soundness, forced atoms and
// minimal sound sets on tiny spaces (synthetic ones and the tutorial's), docs/lab-design.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomSpace } from './lab-helpers.mjs';
import * as S from '../js/lab/sets.js';
import * as Lab from '../js/lab/core.js';
import { nodeExec, LUA } from '../tools/lab.mjs';
import { loadTarget } from '../tools/audit.mjs';

const valueOf = (sp, i, j) => ((sp.words[i * sp.W + ((j - 1) >> 5)] >>> ((j - 1) & 31)) & 1) === 1;
// independent of sets.js: scan every candidate
function scan(sp, M, list) {
  let removed = 0, lost = 0;
  for (let i = 0; i < sp.count; i++) {
    if (list.every((j) => valueOf(sp, i, j) === valueOf(sp, M, j))) { removed++; if (sp.sol[i]) lost++; }
  }
  return { removed, sound: lost === 0 };
}
const subsets = (n) => Array.from({ length: 1 << n }, (_, m) => Array.from({ length: n }, (_, j) => j + 1).filter((j) => m & (1 << (j - 1))));
const key = (sets) => sets.map((x) => x.join(',')).sort();

test('synthetic spaces: removal counts, soundness and forced atoms agree with a scan of every subset', () => {
  for (const [n, count, nsol, seed] of [[5, 20, 4, 1], [6, 40, 6, 2], [7, 90, 3, 3], [8, 150, 12, 4], [6, 64, 0, 5], [7, 50, 49, 6]]) {
    const sp = randomSpace(n, count, nsol, seed);
    for (const M of sp.bad.slice(0, 8)) {
      const soundSets = [];
      for (const list of subsets(n)) {
        const r = S.maskOf(list, sp.W), v = S.valuesOf(sp, M, r);
        const want = scan(sp, M, list);
        assert.equal(S.removal(sp, r, v), want.removed, `n=${n} M=${M} S=${list}`);
        assert.equal(S.isSound(sp, r, v), want.sound, `sound n=${n} M=${M} S=${list}`);
        assert.equal(S.hitsAll(S.differFamily(sp, M), r), want.sound, 'sound = hits every D(M, s)');
        if (want.sound) soundSets.push(list);
      }
      // forced: in every sound set
      const forced = Array.from({ length: n }, (_, j) => j + 1).filter((j) => soundSets.every((x) => x.includes(j)));
      assert.deepEqual(S.forcedAtoms(sp, M).map((f) => f.atom), forced, `forced n=${n} M=${M}`);
      for (const f of S.forcedAtoms(sp, M)) assert.equal(S.differCount(sp, M, f.witness), 1, 'the witness differs from M only on the forced atom');
      // minimal sound sets
      const minimal = soundSets.filter((x) => !soundSets.some((y) => y.length < x.length && y.every((j) => x.includes(j))));
      assert.deepEqual(key(S.bruteMinimal(sp, M).minimal), key(minimal));
    }
  }
});

test('synthetic spaces: clingo\'s minimal sound sets are exactly the minimal ones; the cardinality-minimal set is smallest; a cap is reported', async () => {
  for (const [n, count, nsol, seed] of [[6, 40, 6, 2], [8, 150, 12, 4], [9, 300, 20, 7], [6, 64, 0, 5]]) {
    const sp = randomSpace(n, count, nsol, seed);
    const cands = Array.from(sp.bad.slice(0, 25));
    const got = await Lab.minimalFor(nodeExec, sp, cands, { cap: 200 });
    for (const M of cands) {
      const want = S.bruteMinimal(sp, M).minimal;
      const g = got.get(M);
      assert.equal(g.capped, false);
      assert.deepEqual(key(g.sets), key(want), `n=${n} M=${M}`);
      assert.equal(g.min.length, Math.min(...want.map((x) => x.length)));
    }
    const capped = await Lab.minimalFor(nodeExec, sp, cands, { cap: 1 });
    for (const M of cands) {
      const want = S.bruteMinimal(sp, M).minimal;
      const g = capped.get(M);
      assert.equal(g.capped, want.length > 1, `capped n=${n} M=${M}`);
      assert.equal(g.sets.length, 1);
      assert.equal(g.min.length, Math.min(...want.map((x) => x.length)), 'cardinality-minimal under a cap');
    }
  }
});

test('the one-atom neighbourhood and the lattice agree with direct computation', () => {
  const sp = randomSpace(7, 90, 8, 11);
  const M = sp.bad[3];
  const alive = sp.allBits.slice();
  for (let i = 0; i < sp.count; i += 3) alive[i >> 5] &= ~(1 << (i & 31));
  const r = S.maskOf([1, 3, 5], sp.W), v = S.valuesOf(sp, M, r);
  const nb = S.neighbourhood(sp, M, r, v, alive);
  for (const row of nb.rows) {
    const list = row.inS ? [1, 3, 5].filter((j) => j !== row.atom) : [1, 3, 5, row.atom];
    const r2 = S.maskOf(list, sp.W), v2 = S.valuesOf(sp, M, r2);
    assert.equal(row.total, S.removal(sp, r2, v2));
    assert.equal(row.prune, S.pruning(sp, r2, v2, alive));
    assert.equal(row.sound, S.isSound(sp, r2, v2));
    assert.equal(row.dTotal, row.total - S.removal(sp, r, v));
  }
  const lat = S.lattice(sp, M, [2, 4, 6]);
  assert.equal(lat.nodes.length, 8);
  for (const nd of lat.nodes) {
    const list = [2, 4, 6].filter((_, i) => nd.mask & (1 << i));
    assert.equal(nd.total, scan(sp, M, list).removed);
    assert.equal(nd.sound, scan(sp, M, list).sound);
  }
  assert.equal(S.lattice(sp, M, [1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4]).tooLarge, true);
});

test('tutorial examples (8 atoms): every bad candidate\'s minimal sound sets from clingo match brute force; the inspector is consistent', async () => {
  for (const id of ['tutorial-weak-relevant', 'tutorial-first-run']) {
    const ctx = await Lab.prepare(loadTarget(id), {}, nodeExec, LUA);
    const sp = await Lab.computeSpace(ctx);
    assert.equal(sp.n, 8);
    const cands = Array.from(sp.bad);
    const got = await Lab.minimalFor(nodeExec, sp, cands, { cap: 500 });
    for (const M of cands) assert.deepEqual(key(got.get(M).sets), key(S.bruteMinimal(sp, M).minimal), `${id} M=${M}`);
    const M = cands[7];
    const I = Lab.inspect(sp, M, { minimal: got.get(M) });
    assert.ok(I.minimal.every((m) => m.sound));
    assert.ok(I.pareto.length >= 1);
    const fr = I.pareto.map((k) => [...I.minimal, ...I.options, I.block][k]);
    for (let k = 1; k < fr.length; k++) assert.ok(fr[k].size > fr[k - 1].size && fr[k].prune > fr[k - 1].prune, 'the frontier rises');
    assert.equal(I.block.prune, 1, 'a block removes only its candidate');
    for (const o of I.options) assert.equal(o.total, scan(sp, M, o.atoms).removed);
  }
});
