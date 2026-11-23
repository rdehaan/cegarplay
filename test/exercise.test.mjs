// Self-checking exercises (FUTURE-DIRECTIONS F1): the exercise block, gradeItem, tools/grade.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as H from './helpers.mjs';
import * as P from '../js/project.js';
import { gradeProject, withReference } from '../tools/grade.mjs';

const ex = (id) => P.load(H.read(`examples/${id}.json`));
const frag = (p, n) => p.fragments.find((f) => f.name === n);

// the worked solutions of the two starter exercises
function sumFreeSolution() {
  const p = ex('exercise-sum-free');
  frag(p, 'check').text = frag(p, 'check').text.replace('relevant(pick(X+Y)) :- sum(X,Y).',
    'relevant(pick(X)) :- sum(X,Y).\nrelevant(pick(Y)) :- sum(X,Y).\nrelevant(pick(X+Y)) :- sum(X,Y).');
  return p;
}
function trianglesSolution() {
  const p = ex('exercise-triangles');
  frag(p, 'check').text += '\nrelevant(del(V)) :- q(V).\n';
  p.loop.text = p.loop.text.replace('reject M with G.block(M)', 'reject M with G.clause(M, X)');
  return p;
}

test('the exercise block is validated', () => {
  const base = { format: 'cegarplay', fragments: [], instances: [{ id: 'a', facts: '', expected: { solutions: 1 } }] };
  const L = (exercise) => P.load(JSON.stringify({ ...base, exercise }));
  assert.doesNotThrow(() => L({ instances: ['a'], audit: true, budgets: [{ instance: 'a', candidates: 3 }] }));
  assert.throws(() => L({ instances: ['b'] }), /names no instance 'b'/);
  assert.throws(() => L({ audit: 'yes' }), /exercise.audit must be/);
  assert.throws(() => L({ budgets: [{ instance: 'a' }] }), /give candidates or refinements/);
  assert.throws(() => L({ budgets: [{ instance: 'a', candidates: 1.5 }] }), /whole number/);
  const items = P.exerciseItems(L({ audit: true, budgets: [{ instance: 'a', candidates: 3, refinements: 2 }] }));
  assert.deepEqual(items.map((i) => [i.kind, i.instance, i.key || null]), [['expected', 'a', null], ['audit', 'a', null], ['budget', 'a', 'candidates'], ['budget', 'a', 'refinements']]);
});

test('gradeItem never passes an item it could not check', () => {
  const inst = { id: 'a', expected: { solutions: 2 } };
  const exp = { kind: 'expected', instance: 'a' };
  assert.equal(P.gradeItem(exp, inst, null).ok, false);
  assert.match(P.gradeItem(exp, inst, { outcome: 'limit' }).detail, /not checked/);
  assert.match(P.gradeItem(exp, inst, { outcome: 'finished', exhausted: false, solutions: 1 }).detail, /stopped before all solutions/);
  assert.equal(P.gradeItem(exp, inst, { outcome: 'finished', exhausted: true, solutions: 2 }).ok, true);
  assert.equal(P.gradeItem({ kind: 'audit' }, inst, { outcome: 'error' }).ok, false);
  assert.equal(P.gradeItem({ kind: 'audit' }, inst, { verdict: 'limit' }).ok, false);
  assert.equal(P.gradeItem({ kind: 'budget', key: 'candidates', max: 5 }, inst, { outcome: 'finished', candidates: 5 }).ok, true);
  assert.equal(P.gradeItem({ kind: 'budget', key: 'candidates', max: 5 }, inst, { outcome: 'finished', candidates: 6 }).ok, false);
  assert.deepEqual(P.exerciseSummary([]), { n: 0, ok: 0, pass: false, text: 'Nothing to check.' });
});

test('the starter exercises fail and their worked solutions pass', async () => {
  for (const [id, solve] of [['exercise-sum-free', sumFreeSolution], ['exercise-triangles', trianglesSolution]]) {
    const start = await gradeProject(ex(id));
    assert.equal(start.summary.pass, false, `${id}: the starter must not pass`);
    const done = await gradeProject(solve());
    assert.deepEqual(done.items.filter((i) => !i.ok).map((i) => `${i.label}: ${i.detail}`), [], id);
    assert.equal(done.summary.pass, true);
  }
});

test('tools/grade.mjs grades a folder against a reference exercise', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-'));
  const good = trianglesSolution();
  // a submission that weakened its own expectations is graded against the reference's
  const cheat = trianglesSolution();
  cheat.loop.text = cheat.loop.text.replace('G.clause(M, X)', 'G.block(M)');
  cheat.exercise = { instances: 'all' };
  fs.writeFileSync(path.join(dir, 'a-good.json'), P.save(good));
  fs.writeFileSync(path.join(dir, 'b-cheat.json'), P.save(cheat));
  const tool = H.path('tools/grade.mjs').pathname;
  const r = spawnSync('node', [tool, dir, '--exercise', 'exercise-triangles', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  const rows = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => [path.basename(x.file), x.pass, x.n]), [['a-good.json', true, 7], ['b-cheat.json', false, 7]]);
  assert.deepEqual(withReference(cheat, ex('exercise-triangles')).exercise, ex('exercise-triangles').exercise);
  const one = spawnSync('node', [tool, path.join(dir, 'a-good.json')], { encoding: 'utf8' });
  assert.equal(one.status, 0, one.stdout);
  assert.match(one.stdout, /All 7 checks pass\./);
  assert.equal(spawnSync('node', [tool]).status, 2);
});
