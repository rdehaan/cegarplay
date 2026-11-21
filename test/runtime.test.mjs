// Phase 1: the runtime core with hand-written Lua loops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';

const LC = 'legacy = true, compat = true', LEG = 'legacy = true';
const solverStat = (r, s) => H.finalStats(r).solvers[s];

function endsWithOneD(r) {
  assert.notEqual(r.status, 'trap', r.err.join('\n'));
  const ds = r.out.filter((l) => l.startsWith('@@D '));
  assert.equal(ds.length, 1);
  assert.ok(r.out.at(-1).startsWith('@@D '), 'D is the last line');
}

test('row 1: graph colouring n=6, legacy compat, shape 1, all', async () => {
  const r = await H.runLua(H.projectOf(H.GC6(), { solutions: 0 }), H.LUA.shape1(LC));
  endsWithOneD(r);
  const s = H.finalStats(r);
  assert.equal(s.solutions, 9270);
  assert.equal(H.ofKind(r, 'M').length, 9270);
  assert.deepEqual([s.solvers.C.calls, s.solvers.C.sat, s.solvers.C.unsat], [16577, 7307, 9270]);
  assert.equal(s.clauses, 7307); assert.equal(s.literals, 55007);
  assert.equal(s.solvers.A.choices, 25512); assert.equal(s.solvers.A.conflicts, 7499);
  assert.equal(s.candidates, 16577); assert.equal(s.counterexamples, 7307);
  assert.deepEqual(H.done(r), { outcome: 'finished', exhausted: true, detail: '' });
});

test('row 2: same without compat', async () => {
  const r = await H.runLua(H.projectOf(H.GC6(), { solutions: 0 }), H.LUA.shape1(LEG));
  endsWithOneD(r);
  const s = H.finalStats(r);
  assert.equal(s.solutions, 9270); assert.equal(s.solvers.C.calls, 16577); assert.equal(s.clauses, 7307);
  assert.equal(s.solvers.A.choices, 25512); assert.equal(s.solvers.A.conflicts, 7499);
});

test('row 3: explain1.lp, compat, shape 1, one solution', async () => {
  const f = H.splitLp(H.read('reference/declarative-cegar/explain1.lp'));
  const r = await H.runLua(H.projectOf(f, { solutions: 1 }), H.LUA.shape1('compat = true'));
  endsWithOneD(r);
  const s = H.finalStats(r);
  assert.equal(s.solutions, 1);
  assert.deepEqual([s.solvers.C.calls, s.solvers.C.sat], [9, 8]);
  assert.equal(s.clauses, 8);
  assert.equal(s.solvers.A.choices, 10269); assert.equal(s.solvers.A.conflicts, 822);
  assert.equal(H.done(r).outcome, 'solutions');
});

test('row 9: graph colouring n=10 as shipped, legacy compat, one solution', async () => {
  const r = await H.runLua(H.projectOf(H.GC(), { solutions: 1 }), H.LUA.shape1(LC));
  endsWithOneD(r);
  const s = H.finalStats(r);
  assert.equal(s.solutions, 1); assert.equal(s.solvers.C.calls, 1); assert.equal(s.clauses, 0);
  assert.equal(s.solvers.A.choices, 65); assert.equal(s.solvers.A.conflicts, 7);
});

test('row 4: reference run (block only), all: 10,698', async () => {
  const r = await H.runLua(H.projectOf(H.GC6(), { solutions: 0 }), H.LUA.reference(LEG));
  endsWithOneD(r);
  const s = H.finalStats(r);
  assert.equal(s.solutions, 10698);
  assert.deepEqual([s.solvers.C.calls, s.solvers.C.sat], [102508, 91810]);
  assert.equal(s.clauses, 91810);
});

test('row 10: original rules, shape 2, all: between 9,270 and 10,697', async () => {
  const r = await H.runLua(H.projectOf(H.GC6(), { solutions: 0 }), H.LUA.shape2(LEG));
  endsWithOneD(r);
  const s = H.finalStats(r);
  assert.ok(s.solutions >= 9270 && s.solutions <= 10697, String(s.solutions));
  assert.equal(H.ofKind(r, 'M').length, s.solutions);
  assert.equal(H.done(r).outcome, 'finished'); assert.equal(H.done(r).exhausted, true);
});

test('a Lua error inside on_candidate is an E event, not a trap', async () => {
  const lua = H.LUA.shape1(LEG).replace('local X = C:solve', 'local y = nil + 1\n      local X = C:solve');
  const r = await H.runLua(H.projectOf(H.GC6()), lua);
  endsWithOneD(r);
  const e = H.last(r, 'E');
  assert.match(e.message, /arithmetic on a nil value/);
  assert.equal(H.done(r).outcome, 'error');
  // the line points into the loop
  assert.ok(e.line >= r.assembled.loopStartLine && e.line <= r.assembled.loopEndLine);
});

test('a check without relevant/1 rules: E event', async () => {
  const f = H.GC6();
  f.check = f.check.replace(/^relevant.*$/gm, '');
  const r = await H.runLua(H.projectOf(f, { solutions: 0 }), H.LUA.shape1(LEG));
  endsWithOneD(r);
  assert.equal(H.last(r, 'E').message, 'relevant/1 derived nothing for link G');
  assert.equal(H.done(r).outcome, 'error');
});

test('candidate limit 100 ends row 1 early', async () => {
  const r = await H.runLua(H.projectOf(H.GC6(), { solutions: 0, candidates: 100 }), H.LUA.shape1(LC));
  endsWithOneD(r);
  assert.equal(H.done(r).outcome, 'limit');
  assert.equal(H.finalStats(r).candidates, 100);
});

for (const shape of ['shape1', 'shape2']) {
  test(`solutions = 5 ends ${shape} with exactly 5 M events`, async () => {
    const r = await H.runLua(H.projectOf(H.GC6(), { solutions: 5 }), H.LUA[shape](LEG));
    endsWithOneD(r);
    assert.equal(H.ofKind(r, 'M').length, 5);
    assert.equal(H.done(r).outcome, 'solutions');
    assert.equal(H.done(r).exhausted, false);
  });
}

test('an error in a declaration is reported, unknown fragment', async () => {
  const r = await H.runLua(H.projectOf(H.GC6()), 'local A = rt.solver("A", {"nope"}, {})\nrt.prepare()');
  endsWithOneD(r);
  assert.match(H.last(r, 'E').message, /unknown fragment 'nope'/);
});

test('H event lists solvers and links', async () => {
  const r = await H.runLua(H.projectOf(H.GC6(), { solutions: 1 }), H.LUA.shape1(LEG));
  const h = H.last(r, 'H');
  assert.deepEqual(h.solvers.map((s) => s.name), ['A', 'C']);
  assert.deepEqual(h.links, [{ name: 'G', from: 'A', to: 'C', atoms: 54 }]);
});

test('log, count and stop', async () => {
  const lua = 'rt.count("x"); rt.count("x", 2); rt.log("a", 1, {1, 2}); rt.stop("enough")';
  const r = await H.runLua(H.projectOf(H.GC6()), lua);
  endsWithOneD(r);
  assert.equal(H.last(r, 'L').text, 'a 1 [1, 2]');
  assert.deepEqual(H.finalStats(r).counters, { x: 3 });
  assert.deepEqual(H.done(r), { outcome: 'stopped', exhausted: false, detail: 'enough' });
});

test('clingo messages carry the fragment and the line within it', async () => {
  const p = await H.example('graph-coloring');
  p.fragments.find((f) => f.name === 'abstraction').text = 'a :- not b.\nb :- not a.\n';
  const r = await H.runProject(p);
  const W = r.events.filter((e) => e.kind === 'W').map((e) => e.data);
  assert.ok(W.length > 0);
  const check = p.fragments.find((f) => f.name === 'check').text.split('\n');
  for (const w of W) {
    assert.ok(!/<block>/.test(w.message), w.message);
    assert.ok(w.fragment, w.message);
    assert.ok(w.message.startsWith(`${w.fragment}:${w.line}:${w.col}`), w.message);
    if (w.fragment === 'check') {
      const atom = w.message.split('\n')[1].trim();
      const name = atom.replace(/\(.*$/, '');
      assert.ok(check[w.line - 1].includes(name), `${atom} on line ${w.line}: ${check[w.line - 1]}`);
    }
  }
});
