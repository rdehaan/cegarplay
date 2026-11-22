// Phase S1: the audit (docs/directions/soundness.md, reference rows 14-20).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { read, path, SLOW } from './helpers.mjs';
import { auditProject, loadTarget } from '../tools/audit.mjs';
import { auditPlan } from '../js/driver.js';
import { compile } from '../js/compiler.js';

const withConst = (id, consts = {}) => {
  const p = loadTarget(id);
  p.settings = { ...p.settings, constants: { ...p.settings.constants, ...consts } };
  return p;
};
const audit = async (id, consts, opts) => (await auditProject(withConst(id, consts), opts)).verdict;
const pick = (v) => ({ candidates: v.candidates, solutions: v.solutions, counterexamples: v.counterexamples, pairs: v.pairs, unsound: v.unsound, at_risk: v.at_risk });

test('row 14: tutorial-weak-relevant at n = 8', async () => {
  const v = await audit('tutorial-weak-relevant', { n: '8' });
  assert.equal(v.verdict, 'unsound');
  assert.deepEqual(pick(v), { candidates: 256, solutions: 61, counterexamples: 640, pairs: 499, unsound: 499, at_risk: 59 });
  // the witness with the fewest differing atoms names the missing atom
  assert.deepEqual(v.witness.differ, ['pick(2)']);
  assert.deepEqual(v.witness.candidate, ['pick(2)', 'pick(4)']);
  assert.deepEqual(v.witness.relevant, ['pick(4)']);
  assert.deepEqual(v.witness.solution, ['pick(4)']);
  assert.equal(v.witness.counterexample, 'sum(2,2)');
});

test('row 15: tutorial-weak-relevant at n = 2 is unsound, at n = 1 sound', async () => {
  const v2 = await audit('tutorial-weak-relevant', { n: '2' });
  assert.equal(v2.verdict, 'unsound');
  assert.deepEqual([v2.candidates, v2.solutions, v2.pairs, v2.unsound], [4, 3, 1, 1]);
  assert.deepEqual(v2.witness.candidate, ['pick(1)', 'pick(2)']);
  const v1 = await audit('tutorial-weak-relevant', { n: '1' });
  assert.equal(v1.verdict, 'sound');
});

test('row 16: tutorial-first-run is sound', async () => {
  const v = await audit('tutorial-first-run', { n: '8' });
  assert.equal(v.verdict, 'sound');
  assert.equal(v.pairs, 640);
  assert.equal(v.unsound, 0);
});

test('row 17: graph-coloring at n = 5', async () => {
  const v = await audit('graph-coloring', { n: '5' });
  assert.equal(v.verdict, 'sound');
  assert.deepEqual(pick(v), { candidates: 3373, solutions: 101, counterexamples: 13950, pairs: 13950, unsound: 0, at_risk: 0 });
});

test('row 18: graph-coloring-original at n = 5 is sound', async () => {
  const v = await audit('graph-coloring-original', { n: '5' });
  assert.equal(v.verdict, 'sound');
  assert.equal(v.pairs, 3272);
});

test('row 19: graph-coloring-original at n = 6 (slow)', { skip: !SLOW && 'set SLOW=1' }, async () => {
  const v = await audit('graph-coloring-original', { n: '6' });
  assert.deepEqual(pick(v), { candidates: 102508, solutions: 10698, counterexamples: 606030, pairs: 91810, unsound: 44125, at_risk: 1440 });
});

test('row 20: guide-04-one-node', async () => {
  const v = await audit('guide-04-one-node');
  assert.equal(v.verdict, 'unsound');
  assert.deepEqual([v.candidates, v.solutions, v.pairs, v.unsound, v.at_risk], [176, 3, 290, 64, 2]);
  assert.deepEqual(v.witness.differ, ['del(1)']);
  assert.deepEqual(v.witness.candidate, ['del(4)', 'del(8)']);
  assert.deepEqual(v.witness.relevant, ['del(3)']);
});

test('rule refinements: gc-shape3 and qbf-expansion audit as sound', async () => {
  const v = await audit('gc-shape3');
  assert.equal(v.verdict, 'sound');
  assert.deepEqual(v.kinds, ['expand']);
  assert.equal(v.solutions, 101);
  assert.equal((await audit('qbf-expansion')).verdict, 'sound');
});

test('rule refinements: a refine part that demands too much is unsound', async () => {
  const p = withConst('gc-shape3');
  const a = p.fragments.find((f) => f.name === 'abstraction');
  // every counterexample removes every graph: the solutions too
  a.text = a.text.replace(':- not broken(k).', ':- not broken(k).\n:- cex(k,color(1,C)).');
  const v = (await auditProject(p)).verdict;
  assert.equal(v.verdict, 'unsound');
  assert.ok(v.at_risk > 0);
  assert.equal(v.witness.kind, 'expand');
});

test('auditPlan: picks the link, refuses chains and scripts with nothing to audit', () => {
  const plan = (id) => {
    const p = loadTarget(id);
    return auditPlan(compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) }));
  };
  assert.deepEqual(plan('tutorial-first-run'), { link: 'G', clause: true, expand: [] });
  assert.deepEqual(plan('gc-shape3').expand, [{ part: 'refine', facts: [{ name: 'cex', pred: 'color', arity: 2 }] }]);
  assert.match(plan('knapsack-fortification').error, /chain/);
  assert.match(plan('gc-reference').error, /nothing to audit/);
  // an expand from the abstraction's own model (a bound) is not a refinement to audit
  assert.equal(plan('knapsack-optimum').expand.length, 1);
});

test('tools/audit.mjs exit codes', () => {
  const tool = path('tools/audit.mjs').pathname;
  const code = (args) => spawnSync('node', [tool, ...args]).status;
  assert.equal(code(['tutorial-weak-relevant']), 1);
  assert.equal(code(['tutorial-first-run']), 0);
  assert.equal(code([]), 2);
  assert.equal(code(['tutorial-first-run', '--bogus']), 2);
  assert.equal(code(['tutorial-first-run', '--limit', '10']), 3);
  const out = JSON.parse(spawnSync('node', [tool, 'tutorial-weak-relevant', '--json', '-c', 'n=2']).stdout.toString());
  assert.equal(out.verdict, 'unsound');
});

test('sweep: of the fast loop-script examples, exactly the two that teach unsoundness are unsound', async () => {
  const lib = JSON.parse(read('examples/library.json'));
  const unsound = [], audited = [];
  for (const e of lib.examples) {
    if (!(e.tags || []).includes('fast')) continue;
    const p = loadTarget(e.id);
    if (p.loop.language !== 'loop') continue;
    const r = await auditProject(p, { limit: 20000, seconds: 10 });
    if (r.problems.length || !r.verdict || r.verdict.verdict === 'limit') continue;
    audited.push(e.id);
    if (r.verdict.verdict === 'unsound') unsound.push(e.id);
  }
  assert.ok(audited.length >= 45, `audited only ${audited.length}`);
  assert.deepEqual(unsound.sort(), ['guide-04-one-node', 'tutorial-weak-relevant']);
});

