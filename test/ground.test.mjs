// Phase S2: ground-program capture, level 2 and level 3 (docs/spec-soundness.md sections 2-3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';
import { compile } from '../js/compiler.js';
import { assemble, auditPlan, modulesFor } from '../js/driver.js';
import { Recording, hexBits } from '../js/recording.js';
import { auditProject } from '../tools/audit.mjs';

const lib = JSON.parse(H.read('examples/library.json'));
const ex = (id, settings = {}) => {
  const p = load(H.read(`examples/${id}.json`));
  p.settings = { ...p.settings, trace: 0, seconds: 0, solutions: 0, ...settings };
  return p;
};
const certRun = async (id, consts = {}, extra = {}) => {
  const p = ex(id, { certify: 'report', ...extra });
  p.settings.constants = { ...p.settings.constants, ...consts };
  return H.runProject(p);
};
const levels = (r) => {
  const by = {};
  for (const k of H.ofKind(r, 'K')) { const key = k.level === null ? k.verdict : `l${k.level}`; by[key] = (by[key] || 0) + 1; }
  return by;
};

test('certify off: no module, the same program text', () => {
  assert.deepEqual(modulesFor({}), []);
  assert.deepEqual(modulesFor({ certify: 'off' }), []);
  assert.deepEqual(modulesFor({ certify: 'report' }), ['ground']);
  const p = ex('tutorial-first-run');
  const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
  const a = assemble(p, c, 'return rt').program;
  assert.equal(assemble({ ...p, settings: { ...p.settings, certify: 'off' } }, c, 'return rt').program, a);
  assert.ok(!a.includes('certify'));
});

test('row 21: every refinement of tutorial-first-run is certified at level 2', async () => {
  const r = await certRun('tutorial-first-run');
  assert.deepEqual(levels(r), { l2: 46 });
  assert.equal(H.finalStats(r).certificates.l2, 46);
  assert.equal(H.finalStats(r).solutions, 61);
});

test('row 22: no refinement of tutorial-weak-relevant is certified at level 2 or 3', async () => {
  const r = await certRun('tutorial-weak-relevant');
  const by = levels(r);
  assert.equal(by.l2, undefined);
  assert.equal(by.l3, undefined);
  assert.ok(by.none > 0);
  // its blocks are level 0
  assert.equal(by.l0, H.finalStats(r).solutions);
});

test('row 24: graph-coloring n = 5: level 2 certifies none, level 3 all', async () => {
  const r = await certRun('graph-coloring', { n: '5' });
  const by = levels(r);
  assert.deepEqual(Object.keys(by), ['l3']);
  assert.equal(by.l3, H.finalStats(r).clauses);
  assert.equal(H.finalStats(r).solutions, 101);
});

test('cores are level 1, blocks level 0; the S event counts them', async () => {
  const r = await certRun('lang-core');
  const by = levels(r);
  assert.ok(by.l1 > 0, JSON.stringify(by));
  const c = H.finalStats(r).certificates;
  assert.equal(c.l1, by.l1);
});

test('fewest-clues: level 2 takes under 10 ms per refinement', async () => {
  const r = await certRun('fewest-clues');
  const c = H.finalStats(r).certificates;
  assert.ok(c.l2 > 100);
  assert.ok(c.t2 / c.l2 < 0.010, `${(1000 * c.t2 / c.l2).toFixed(2)} ms`);
});

test('capture: the store of a small check holds its rules', async () => {
  const p = ex('tutorial-first-run', { certify: 'report' });
  const lua = `
    local A = rt.solver("A", {"shared", "abstraction"}, {})
    local C = rt.solver("C", {"shared", "check"}, {})
    local G = rt.link("G", A, C, {"shared", "glue"}, {})
    rt.prepare()
    local st = C.store
    local n, choice, constraints = 0, 0, 0
    for _, r in ipairs(st.rules) do n = n + 1; if r.choice then choice = choice + 1 end; if #r.head == 0 then constraints = constraints + 1 end end
    rt.log(n, choice, constraints, tostring(st.disjunctive), tostring(st.error))`;
  p.loop = { language: 'lua', text: lua };
  const r = await H.runProject(p);
  const [n, choice, constraints, disj, err] = H.ofKind(r, 'L')[0].text.split(' ');
  assert.equal(disj, 'false');
  assert.equal(err, 'nil');
  // the 8 interface choices {pick(i)} of the link, the 8 compat-free relevant atoms are rules, the
  // choice of sum/2 and the three constraints per sum
  assert.ok(Number(choice) >= 9, choice);
  assert.ok(Number(constraints) >= 3, constraints);
  assert.ok(Number(n) > Number(choice));
});

// The safety property: a refinement that the audit shows to remove a solution is never
// certified at level 2 or 3.
test('safety: over the fast single-link clause examples, no unsound refinement is certified', async () => {
  let checked = 0, certified = 0;
  for (const e of lib.examples) {
    if (!(e.tags || []).includes('fast')) continue;
    const p = load(H.read(`examples/${e.id}.json`));
    if (p.loop.language !== 'loop') continue;
    const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
    const plan = auditPlan(c);
    if (plan.error || !plan.clause) continue;
    const a = await auditProject(p, { limit: 20000, seconds: 10, vectors: true });
    if (!a.verdict || a.verdict.verdict === 'limit') continue;
    p.settings = { ...p.settings, trace: 0, seconds: 20, certify: 'report', record: { steps: 'all', n: 0, calls: false } };
    const r = await H.runProject(p);
    const rec = new Recording({});
    for (const ev of r.events) rec.add(ev.kind, ev.data);
    if (!rec.I) continue;
    const li = rec.I.links.findIndex((L) => L.link === plan.link) + 1;
    const n = rec.I.links[li - 1].atoms.length;
    const sols = a.vectors.solutions.map((h) => hexBits(h, n));
    const steps = new Map(rec.steps.map((s) => [s.i, s]));
    for (const k of H.ofKind(r, 'K')) {
      if (k.level !== 2 && k.level !== 3) continue;
      const st = steps.get(k.i);
      if (!st || st.l !== li || !st.q) continue;
      certified++;
      const lost = sols.find((b) => st.q.every((x) => (x > 0 ? !b[x] : b[-x])));
      assert.equal(lost, undefined, `${e.id}: step ${k.i} is certified at level ${k.level} but removes a solution`);
    }
    checked++;
  }
  assert.ok(checked >= 35, `checked ${checked} examples`);
  assert.ok(certified > 1000, `${certified} certified refinements`);
});
