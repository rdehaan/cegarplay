// Phase I4: fuzz, shrink and diagnose.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';
import { fuzz, shrinkInstance, diagnose, defaultSource, auditOf } from '../js/fuzz.js';
import { shrink, normaliseFacts } from '../js/shrink.js';
import { Recording } from '../js/recording.js';

const env = { engineRun: H.engineRun, runtime: H.RUNTIME, luaTexts: H.GEN_LUA,
  modules: { audit: H.read('lua/audit.lua'), ground: H.read('lua/ground.lua'), replay: H.read('lua/replay.lua') } };
const ex = (id) => load(H.read(`examples/${id}.json`));

test('ddmin: a 1-minimal subset; normalised facts', async () => {
  const r = await shrink([1, 2, 3, 4, 5, 6, 7, 8], async (s) => s.includes(3) && s.includes(6), { jobs: 3 });
  assert.deepEqual(r.items, [3, 6]);
  const n = await normaliseFacts('num(1..3). edge(X,X+1) :- num(X), X < 3.', H.engineRun);
  assert.deepEqual(n.facts, ['num(1).', 'num(2).', 'num(3).', 'edge(1,2).', 'edge(2,3).']);
});

test('fuzz on tutorial-weak-relevant over n = 1 to 8 stops at n = 2: candidate pick(1) pick(2), lost solution pick(2)', async () => {
  const p = ex('tutorial-weak-relevant');
  assert.deepEqual(defaultSource(p), { constants: { n: [1, 2, 3, 4, 5, 6, 7, 8] } });
  const r = await fuzz(p, { env });
  assert.equal(r.mode, 'audit');
  assert.equal(r.found.instance.id, 'n2');
  assert.equal(r.tried, 2);
  assert.deepEqual(r.found.verdict.witness.candidate, ['pick(1)', 'pick(2)']);
  assert.deepEqual(r.found.verdict.witness.solution, ['pick(2)']);
  // at n = 2 this loop finds pick(2) before the weak clause: the diagnosis reports the witness alone
  const dg = await diagnose(r.found.project, r.found.verdict, env);
  assert.equal(dg.lostInRun, false);
  assert.equal(dg.step, undefined);
  assert.deepEqual(dg.witness.relevant, ['pick(2)']);
});

test('firstViolated: at n = 8 a solution the loop loses falsifies the returned step and satisfies every earlier clause', async () => {
  const { countOf } = await import('../js/fuzz.js');
  const { derive } = await import('../js/project.js');
  const p = ex('tutorial-weak-relevant');
  const run = await countOf(derive(p, {}), env, { record: { steps: 'all', n: 0, calls: false } });
  const ref = await countOf(derive(p, { variant: 'reference' }), env);
  assert.deepEqual([run.solutions, ref.solutions], [11, 61]);
  const rec = new Recording({});
  for (const e of run.events) rec.add(e.kind, e.data);
  const got = new Set(rec.solutions.map((m) => m.atoms));
  const lost = ref.events.filter((e) => e.kind === 'M').map((e) => e.data.atoms).filter((a) => !got.has(a));
  assert.equal(lost.length, 50);
  for (const sol of lost.slice(0, 10)) {
    const atoms = sol.split(/\s+/).filter(Boolean);
    const st = rec.firstViolated(atoms);
    assert.ok(st, sol);
    const bits = [false, ...rec.I.links[0].atoms.map((a) => atoms.includes(a))];
    const holds = (x) => x.q.some((q) => (q > 0 ? bits[q] : !bits[-q]));
    assert.equal(holds(st), false, sol);
    for (const x of rec.steps) { if (x.i >= st.i) break; if (x.q && (x.k === 'r' || x.k === 'a')) assert.equal(holds(x), true, sol); }
  }
});

test('fuzz on tutorial-first-run over n = 1 to 8 reports no unsound instance', async () => {
  const r = await fuzz(ex('tutorial-first-run'), { env, source: { constants: { n: [1, 2, 3, 4, 5, 6, 7, 8] } } });
  assert.equal(r.found, null);
  assert.equal(r.tried, 8);
});

test('shrinking the sum-free fixture (num/1 as eight instance facts) ends with two facts, still unsound', async () => {
  const p = ex('tutorial-weak-relevant');
  p.fragments.find((f) => f.name === 'shared').text = '% num/1 comes from the instance\n';
  p.instances = [{ id: 'eight', facts: 'num(1). num(2). num(3). num(4). num(5). num(6). num(7). num(8).\n', constants: {}, tags: [] }];
  const r = await fuzz(p, { env, source: { ids: ['eight'] } });
  assert.equal(r.found.instance.id, 'eight');
  const s = await shrinkInstance(r.found.project, env, { jobs: 2 });
  assert.equal(s.from, 8);
  assert.deepEqual(s.facts, ['num(1).', 'num(2).']);
  assert.equal(s.constants.n, '2');
  assert.equal(s.verdict.verdict, 'unsound');
  console.log(`# shrink: 8 facts -> ${s.facts.length}, n = 8 -> ${s.constants.n}, ${s.tests} audits`);
});

test('a rule refinement: the replay names the expansion that removes the lost solution', async () => {
  // gc-shape3 with an unsound refine part (it also forbids colour C of node 1 that the counterexample uses)
  const p = ex('gc-shape3');
  p.settings.constants = { ...p.settings.constants, n: '4' };
  const f = p.fragments.find((x) => /#program refine/.test(x.text));
  f.text += '\n:- cex(k,color(1,C)).\n';
  const a = await auditOf(p, env);
  assert.equal(a.verdict.verdict, 'unsound');
  assert.equal(a.verdict.witness.kind, 'expand');
  const dg = await diagnose(p, a.verdict, env);
  assert.equal(dg.lostInRun, true);
  assert.equal(dg.culprit, 1);
  assert.ok(Number.isInteger(dg.culprit) && dg.culprit >= 1, JSON.stringify({ culprit: dg.culprit, w: a.verdict.witness }));
});
