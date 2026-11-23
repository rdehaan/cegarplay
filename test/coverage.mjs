// Coverage of the example library (outside the guide and the tutorial): every example has
// several instances and several variants (loops or refinements), and every variant gives each
// instance's expected count (every variant with SLOW=1). Sharded over coverage-[1-4].test.mjs so the runs go in parallel.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load, expectedCheck, costTracker } from '../js/project.js';

const LIB = JSON.parse(H.read('examples/library.json')).examples;
export const COVERED = LIB.filter((e) => !['guide', 'tutorial'].includes(e.group)).map((e) => e.id).sort();
// Exceptions, with the reason (also in PROGRESS.md):
// - exercise-triangles: its loop is the blocking loop the reader replaces; a finished variant would give the answer away.
const FEW_VARIANTS = { 'exercise-triangles': 0, 'exercise-sum-free': 1 };
const SLOW_TAGS = ['slow', 'hard', 'original'];

const project = (id) => load(H.read(`examples/${id}.json`));

export function structure() {
  test('every covered example has three or more instances and two or more variants', () => {
    const bad = [];
    for (const id of COVERED) {
      const p = project(id);
      const n = (p.instances || []).length, v = (p.variants || []).length;
      if (n < 3) bad.push(`${id}: ${n} instances`);
      if (v < (FEW_VARIANTS[id] ?? 2)) bad.push(`${id}: ${v} variants`);
    }
    assert.deepEqual(bad, []);
  });
}

async function check(p, inst, variant) {
  const x = p.instances.find((y) => y.id === inst);
  const r = await H.runProject({ ...p, settings: { ...p.settings, seconds: 60, trace: 0 } }, { instance: inst, variant });
  const S = H.finalStats(r) || {};
  const D = H.done(r);
  const t = costTracker();
  for (const m of H.ofKind(r, 'M')) t.add(m.cost);
  const c = expectedCheck(x.expected, D && { outcome: D.outcome, exhausted: D.exhausted === true, solutions: S.solutions, cost: t.cost, same: t.same });
  const err = H.last(r, 'E');
  return err ? `error ${err.message}` : c.checked && !c.ok ? `${S.solutions} solutions, expected ${c.want}` : null;
}

export function shard(k, of = 4) {
  for (const id of COVERED.filter((_, i) => i % of === k)) {
    const p = project(id);
    const insts = (p.instances || []).filter((x) => x.expected && (H.SLOW || !(x.tags || []).some((t) => SLOW_TAGS.includes(t))));
    // the normal suite runs the default loop and the reference variant (or the first one);
    // SLOW=1 runs every variant
    const names = (p.variants || []).map((v) => v.name);
    const picked = H.SLOW ? names : names.includes('reference') ? ['reference'] : names.slice(0, 1);
    const variants = [...(p.exercise ? [] : [undefined]), ...picked];
    test(`${id}: ${H.SLOW ? 'every variant gives' : 'the default loop and one variant give'} each instance's expected count`, async () => {
      const bad = [];
      for (const x of insts) for (const v of variants) {
        const why = await check(p, x.id, v);
        if (why) bad.push(`${x.id} / ${v ?? 'default'}: ${why}`);
      }
      assert.deepEqual(bad, []);
    });
  }
}
