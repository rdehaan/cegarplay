// Phase I5: pools of counterexamples, mining (docs/spec-instances.md section 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';
import { validate } from '../js/driver.js';
import { compile } from '../js/compiler.js';
import { mine } from '../js/mine.js';
import { resolveInstance, clearRecipeCache } from '../js/instances.js';
import { parseTerm, termText } from '../js/views.js';

const env = { engineRun: H.engineRun, runtime: H.RUNTIME, luaTexts: H.GEN_LUA,
  modules: { audit: H.read('lua/audit.lua'), ground: H.read('lua/ground.lua'), replay: H.read('lua/replay.lua') } };
const ex = (id) => load(H.read(`examples/${id}.json`));
const WARM = 'for P in pool(cex):\n    A.expand(refine, cex = P)\npending = []';

async function recordPool(seed, consts = {}) {
  const p = ex('gc-shape4');
  p.settings = { ...p.settings, solutions: 0, seed, record: { steps: 'all', n: 0, calls: false }, constants: { ...p.settings.constants, ...consts } };
  const r = await H.runProject(p);
  const E = H.ofKind(r, 'R').filter((s) => s.k === 'e');
  return { name: 'cex', domain: E[0].d, items: E.map((s) => s.f.map((t) => termText(parseTerm(t).args[1]))) };
}

test('compiler: pool(name) compiles to rt.pool', () => {
  const c = compile('solver A = shared\nsolver C = check\nlink G = A -> C via glue\nfor P in pool(cex):\n    A.expand(refine, cex = P)\n', { fragments: ['shared', 'check', 'glue'] });
  assert.ok(c.ok, JSON.stringify(c.errors));
  assert.match(c.lua, /rt\.pool\("cex"\)/);
  const bad = compile('solver A = shared\nsolver C = check\nlink G = A -> C via glue\nx = pool(1)\n', { fragments: ['shared', 'check', 'glue'] });
  assert.match(bad.errors[0].message, /pool takes the name of a pool/);
});

test('gc-shape4 with a pool recorded under another seed gives 101 solutions, with fewer check calls', async () => {
  const pool = await recordPool(7);
  assert.match(pool.domain, /^C:color\/2:[0-9a-f]{8}$/);
  const p = ex('gc-shape4');
  p.pools = [pool];
  p.settings = { ...p.settings, solutions: 0 };
  p.loop.text = p.loop.text.replace('pending = []', WARM);
  const warm = await H.runProject(p);
  const cold = await H.runProject({ ...ex('gc-shape4'), settings: { ...ex('gc-shape4').settings, solutions: 0 } });
  const calls = (r) => H.finalStats(r).solvers.C.calls;
  assert.equal(H.finalStats(warm).solutions, 101);
  assert.equal(H.finalStats(cold).solutions, 101);
  console.log(`# gc-shape4: ${calls(cold)} check calls cold, ${calls(warm)} warm from a pool of ${pool.items.length} counterexamples (seed 7)`);
  assert.ok(calls(warm) < calls(cold));
});

test('a pool with a different domain hash is skipped with a message', async () => {
  const pool = await recordPool(7);
  const p = ex('gc-shape4');
  p.pools = [pool];
  p.settings = { ...p.settings, solutions: 0, constants: { ...p.settings.constants, n: '4' } };
  p.loop.text = p.loop.text.replace('pending = []', WARM);
  const r = await H.runProject(p);
  assert.ok(H.ofKind(r, 'W').some((w) => /pool cex skipped: it was recorded on another domain/.test(w.message)));
  assert.equal(H.finalStats(r).counters['pool items'], undefined);   // nothing was replayed
});

test('a pool item that is not a term is rejected by validate', async () => {
  const p = ex('gc-shape4');
  p.pools = [{ name: 'cex', domain: '', items: [['color(1,2)'], ['color(1,'], ['a :- b']] }];
  const problems = await validate(p, H.engineRun);
  const msgs = problems.filter((x) => x.severity === 'error').map((x) => x.message);
  assert.equal(msgs.length, 2, msgs.join('\n'));
  assert.match(msgs[0], /pool cex, item 2: not a list of atoms/);
});

test('a recipe with mutations: removed facts are gone after generation', async () => {
  clearRecipeCache();
  const p = ex('qbf');
  const base = await resolveInstance(p, 'dnf-1', H.engineRun, H.GEN_LUA);
  const first = base.facts.split(/(?<=\.)\s+/)[0];
  p.instances = [...p.instances, { id: 'm', recipe: p.instances.find((x) => x.id === 'dnf-1').recipe, mutations: [`- ${first}`], constants: {}, tags: [] }];
  const m = await resolveInstance(p, 'm', H.engineRun, H.GEN_LUA);
  assert.ok(!m.facts.split(/(?<=\.)\s+/).includes(first));
  assert.equal(m.facts.split(/(?<=\.)\s+/).length, base.facts.split(/(?<=\.)\s+/).length - 1);
});

test('mining qbf with qbf-dnf: the ten best instances, and the ratio of the best to the median of its grid cell', async () => {
  const p = ex('qbf');
  const r = await mine(p, { source: { generator: 'qbf-dnf', grid: { t: [6, 8, 10, 12] }, seeds: 8 }, objective: 'candidates-per-solution',
    budget: 60, keep: 10, seconds: 2, rounds: 2, mutations: 6, env });
  assert.equal(r.best.length, 10);
  for (let i = 1; i < r.best.length; i++) assert.ok(r.best[i - 1].score >= r.best[i].score);
  assert.ok(r.best.every((b) => b.instance.tags.includes('hard') && b.instance.recipe));
  const b = r.best[0];
  console.log(`# mining qbf: best ${b.id} (${b.score.toFixed(2)} candidates per solution), ${(b.score / b.cellMedian).toFixed(2)}x the median of its cell (t = ${b.params.t}); ${r.runs} runs`);
  assert.ok(b.score / b.cellMedian >= 1);
  assert.ok(r.runs <= 60);
});

test('review of wave 5: pool items that are not ground terms never reach parse_term', async () => {
  const { groundTerm } = await import('../js/driver.js');
  for (const bad of ['a;b', 'a|b', '#const k=1', '#show', 'not a', 'p(1..3)', 'p(1;2)', 'a, b', 'a:b', 'p(X):q(X)', '{a}', '1 {a} 1', 'a %* c *%', 'X', '_x'])
    assert.equal(groundTerm(bad), false, bad);
  for (const good of ['color(1,2)', '"a b"', '(1,2)', '-p(3)', 'f((1,),x)', 'a'])
    assert.equal(groundTerm(good), true, good);
  const p = ex('gc-shape4');
  p.pools = [{ name: 'cex', domain: '', items: [['p(1..3)'], ['not a']] }];
  const problems = (await validate(p, H.engineRun)).filter((x) => x.severity === 'error');
  assert.equal(problems.length, 2);
});
