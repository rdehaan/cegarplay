// PLAN3 phase S6: the symbolic audit (lua/bounded.lua, docs/spec-soundness.md section 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { read, path, SLOW } from './helpers.mjs';
import { auditProject, loadTarget } from '../tools/audit.mjs';
import { boundedPlan, auditPlan, modulesFor, boundedBody } from '../js/driver.js';
import { compile } from '../js/compiler.js';

const withConst = (id, consts = {}) => {
  const p = loadTarget(id);
  p.settings = { ...p.settings, constants: { ...p.settings.constants, ...consts } };
  return p;
};
const symbolic = async (p, opts = {}) => (await auditProject(typeof p === 'string' ? loadTarget(p) : p, { symbolic: true, seconds: 60, ...opts })).verdict;
const enumerate = async (p, opts = {}) => (await auditProject(typeof p === 'string' ? loadTarget(p) : p, { limit: 200000, ...opts })).verdict;
const plan = (id) => { const p = loadTarget(id); return boundedPlan(compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) })); };

// A witness is consistent: differ is the symmetric difference of candidate and solution, and the
// solution agrees with the candidate on every relevant atom (or falsifies the picked clause).
function consistent(w) {
  const c = new Set(w.candidate), s = new Set(w.solution);
  const d = [...new Set([...c, ...s])].filter((a) => c.has(a) !== s.has(a)).sort();
  assert.deepEqual([...w.differ].sort(), d);
  if (w.kind === 'clause') for (const a of w.relevant) assert.equal(c.has(a), s.has(a), `relevant ${a}`);
  else for (const l of w.clause) assert.equal(l.startsWith('-') ? s.has(l.slice(1)) : !s.has(l), true, `clause literal ${l}`);
}

test('S6: tutorial-weak-relevant and guide-04-one-node are unsound with one differing atom, as the audit', async () => {
  const v = await symbolic('tutorial-weak-relevant');
  assert.equal(v.verdict, 'unsound');
  assert.equal(v.mode, 'symbolic');
  assert.deepEqual(v.kinds, ['clause', 'block']);
  assert.equal(v.witness.differ.length, 1);
  consistent(v.witness);
  const g = await symbolic('guide-04-one-node');
  assert.equal(g.verdict, 'unsound');
  assert.equal(g.witness.differ.length, 1);
  consistent(g.witness);
  // without the witness order: any lost solution
  const any = await symbolic('guide-04-one-node', { fewest: false });
  assert.equal(any.verdict, 'unsound');
  consistent(any.witness);
});

test('S6: tutorial-first-run and graph-coloring n = 5 are sound', async () => {
  assert.equal((await symbolic('tutorial-first-run')).verdict, 'sound');
  const v = await symbolic(withConst('graph-coloring', { n: '5' }));
  assert.equal(v.verdict, 'sound');
  assert.ok(v.rounds >= 1);
});

test('S6: G.clauses, also in the enumerative audit (af-preferred and a weakened copy)', async () => {
  assert.deepEqual(plan('af-preferred'), { link: 'G', clause: false, clauses: true, kinds: ['clauses'] });
  const p = loadTarget('af-preferred');
  assert.equal((await symbolic(p)).verdict, 'sound');
  assert.equal((await enumerate(p)).verdict, 'sound');
  // drop the literal "N comes in": a larger admissible set now removes itself
  const q = structuredClone(p);
  const c = q.fragments.find((f) => f.name === 'check');
  c.text = c.text.replace('clause(N, in(N), true) :- new(N).', '');
  const s = await symbolic(q), a = await enumerate(q);
  assert.equal(a.verdict, 'unsound');
  assert.deepEqual(a.kinds, ['clauses']);
  assert.equal(s.verdict, 'unsound');
  assert.equal(s.witness.kind, 'clauses');
  assert.equal(s.witness.differ.length, a.witness.differ.length);
  consistent(s.witness);
});

test('S6: a check that is not stratified goes through the block fallback and agrees with the audit', async () => {
  // the check guesses its counterexample through an even loop over negation
  const p = loadTarget('tutorial-weak-relevant');
  const c = p.fragments.find((f) => f.name === 'check');
  c.text = c.text.replace('1 { sum(X,Y) : num(X), num(Y), X <= Y, X + Y <= n } 1.',
    'sum(X,Y) :- num(X), num(Y), X <= Y, X + Y <= n, not other(X,Y).\nother(X,Y) :- num(X), num(Y), X <= Y, X + Y <= n, not sum(X,Y).\n:- not 1 { sum(X,Y) } 1.');
  for (const n of ['3', '5']) {
    p.settings.constants.n = n;
    const s = await symbolic(p), a = await enumerate(p);
    assert.equal(s.verdict, a.verdict, `n = ${n}`);
    assert.ok(s.fallback > 0, 'blocks were used');
    if (a.verdict === 'unsound') assert.equal(s.witness.differ.length, a.witness.differ.length);
  }
});

test('S6: plans the verifier does not cover are unsupported, with a reason', async () => {
  assert.match(plan('gc-shape3').unsupported, /expand/);
  assert.match(plan('knapsack-fortification').unsupported, /chain/);
  assert.match(plan('gc-reference').kinds.join(), /block/);
  const lift = loadTarget('graph-coloring');
  lift.loop.text = lift.loop.text.replace(/^(link\s+G\s*=.*)$/m, '$1 lift');
  const v = await symbolic(lift);
  assert.equal(v.verdict, 'unsupported');
  assert.match(v.reason, /lift link: certified per clause/);
  // a loop refined by blocks only is sound by construction
  assert.equal((await symbolic('gc-reference')).verdict, 'sound');
});

test('S6: tools/audit.mjs --symbolic exit codes', () => {
  const tool = path('tools/audit.mjs').pathname;
  const code = (args) => spawnSync('node', [tool, ...args]).status;
  assert.equal(code(['tutorial-weak-relevant', '--symbolic']), 1);
  assert.equal(code(['tutorial-first-run', '--symbolic']), 0);
  assert.equal(code(['gc-shape3', '--symbolic']), 4);
  const out = JSON.parse(spawnSync('node', [tool, 'tutorial-weak-relevant', '--symbolic', '--json', '-c', 'n=2']).stdout.toString());
  assert.equal(out.verdict, 'unsound');
  assert.equal(out.mode, 'symbolic');
});

test('S6: a normal run loads neither bounded.lua nor its program; the audit plans are unchanged', () => {
  assert.deepEqual(modulesFor({}), []);
  assert.deepEqual(modulesFor({}, { mode: 'bounded' }), ['ground', 'bounded']);
  assert.deepEqual(modulesFor({ certify: 'report' }, { mode: 'bounded' }), ['ground', 'bounded']);
  const p = loadTarget('tutorial-first-run');
  const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
  assert.deepEqual(auditPlan(c), { link: 'G', clause: true, expand: [] });
  assert.match(boundedBody(c, boundedPlan(c)), /rt\.bounded\{ link = G, clause = true, clauses = false/);
});

// Every clause-based library instance that has an expected symbolic verdict reaches it.
test('S6: the library instances reach their expected symbolic verdicts', async () => {
  const lib = JSON.parse(read('examples/library.json'));
  let checked = 0;
  const wrong = [];
  for (const e of lib.examples) {
    const p = loadTarget(e.id);
    for (const x of p.instances || []) {
      if (!x.symbolic) continue;
      const slow = (x.tags || []).some((t) => ['slow', 'hard', 'original'].includes(t)) || x.audit === false;
      if (slow && !SLOW) continue;
      const v = await symbolic(p, { instance: x.id });
      checked++;
      if (!v || v.verdict !== x.symbolic) wrong.push(`${e.id}/${x.id}: ${v ? v.verdict : 'none'} (expected ${x.symbolic})`);
    }
  }
  assert.deepEqual(wrong, []);
  assert.ok(checked >= 150, `checked only ${checked}`);
});

test('row 31: graph-coloring n6 (audit: false) gets a symbolic verdict at once', async () => {
  const v = await symbolic('graph-coloring', { instance: 'n6' });
  assert.equal(v.verdict, 'sound');
  assert.equal(v.rounds, 1);
  assert.equal(v.refinements, 0);
});

test('S8: Fuzz gives an audit: false instance the symbolic audit instead of skipping it', async () => {
  const H = await import('./helpers.mjs');
  const { fuzz } = await import('../js/fuzz.js');
  const modules = { audit: H.read('lua/audit.lua'), ground: H.read('lua/ground.lua'), replay: H.read('lua/replay.lua') };
  const p = loadTarget('graph-coloring');
  const env = (extra) => ({ engineRun: H.engineRun, runtime: H.RUNTIME, luaTexts: H.GEN_LUA, modules: { ...modules, ...extra } });
  // without lua/bounded.lua (as before): n6 is not even tried
  const old = await fuzz(p, { source: { ids: ['n6'] }, env: env({}) });
  assert.equal(old.tried, 0);
  const r = await fuzz(p, { source: { ids: ['n6'] }, env: env({ bounded: H.read('lua/bounded.lua') }) });
  assert.equal(r.tried, 1);
  assert.equal(r.skipped, 0);
  assert.equal(r.found, null);
  // an unsound loop is found on an instance marked audit: false
  const w = loadTarget('tutorial-weak-relevant');
  w.instances = [{ id: 'big', facts: '', constants: { n: '9' }, audit: false, tags: [] }];
  const u = await fuzz(w, { source: { ids: ['big'] }, env: env({ bounded: H.read('lua/bounded.lua') }) });
  assert.equal(u.found.instance.id, 'big');
  assert.equal(u.found.verdict.mode, 'symbolic');
});
