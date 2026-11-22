// Phase L1: values in the loop language (docs/directions/generality.md, G1-G3).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';
import { compile } from '../js/compiler.js';

const ex = (id) => load(H.read(`examples/${id}.json`));
const all = (p) => ({ ...p, settings: { ...p.settings, solutions: 0, seconds: 0, trace: 0 } });
const FR = ['shared', 'abstraction', 'glue', 'check'];
const DECL = 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue\n';
const SUM = { fragments: [
  { name: 'shared', text: 'num(1..4).' },
  { name: 'abstraction', text: '{ pick(X) : num(X) }.\n#show pick/1.' },
  { name: 'glue', text: 'glue(pick(X)) :- num(X).' },
  { name: 'check', text: '1 { sum(X,Y) : num(X), num(Y), X <= Y, X + Y <= 4 } 1.\n:- sum(X,Y), not pick(X).\n:- sum(X,Y), not pick(Y).\n:- sum(X,Y), not pick(X+Y).\nrelevant(pick(X)) :- sum(X,Y).\nrelevant(pick(Y)) :- sum(X,Y).\nrelevant(pick(X+Y)) :- sum(X,Y).' }],
  settings: { constants: {}, solutions: 0, seconds: 0, candidates: 0, trace: 0, seed: 0 } };
const withLoop = (body) => ({ ...SUM, loop: { language: 'loop', text: DECL + body } });

test('the examples of phase L1: loop scripts, no helper solver, no always atom, counts unchanged', async () => {
  for (const [id, want] of [['reasons-by-shrinking', 4], ['knapsack-bounds', 2], ['reasons-by-size', 4], ['qbf', 5]]) {
    const p = ex(id);
    assert.equal(p.loop.language, 'loop', id);
    const r = await H.runProject(all(p));
    assert.equal(H.done(r).outcome, 'finished', `${id}: ${JSON.stringify(H.ofKind(r, 'E'))}`);
    assert.equal(H.finalStats(r).solutions, want, id);
  }
  assert.ok(!ex('reasons-by-size').loop.text.includes('solver B'));
  assert.ok(!ex('qbf').fragments.some((f) => /\balways\b/.test(f.text)));
  const kb = await H.runProject(all(ex('knapsack-bounds')));
  assert.deepEqual(H.ofKind(kb, 'L').map((l) => l.text), ['bounds: 0 to 28', 'bounds: 0 to 28', 'bounds: 0 to 27', 'bounds: 0 to 26', 'bounds: 0 to 25', 'bounds: 0 to 25', 'optimum: 25']);
});

test('G1: G.above and G.below; G.clause(X); C.core.on(G)', async () => {
  // all sum-free sets of 1..4 by above-blocking of each solution's subsets... (below) is the same count
  const r1 = await H.runProject(withLoop('loop:\n    M = A.solve()\n    if not M: stop\n    X = C.solve(assume G(M))\n    if X: A.add(G.clause(X))\n    else:\n        accept M\n        A.add(G.below(M))\n'));
  assert.equal(H.done(r1).outcome, 'finished', JSON.stringify(H.ofKind(r1, 'E')));
  assert.ok(H.finalStats(r1).solutions >= 1);
  const ref = await H.runProject(withLoop('loop:\n    M = A.solve()\n    if not M: stop\n    X = C.solve(assume G(M))\n    if X: A.add(G.clause(M, X))\n    else:\n        accept M\n        A.add(G.block(M))\n'));
  assert.equal(H.finalStats(ref).solutions, 9);              // the sum-free subsets of 1..4
  assert.equal(H.finalStats(r1).solutions <= 9, true);
  const core = await H.runProject(withLoop('M = A.solve(assume G.block(A.solve()))\nX = C.solve(assume G(M))\nif not X: log "none"\nelse:\n    Y = C.solve(assume G(M), G(M))\n    log "ok"\n'));
  assert.notEqual(H.done(core).outcome, undefined);
  const c = compile(DECL + 'M = A.solve()\nif not C.solve(assume G(M)): A.add(C.core.on(G))\nA.add(G.above(M))\nA.add(G.clause(M))\n', { fragments: FR });
  assert.ok(c.ok, JSON.stringify(c.errors));
  assert.match(c.lua, /\(C:core\(\)\):on\(G\)/);
  assert.match(c.lua, /G:above\(M\)/);
  assert.match(c.lua, /G:clause\(nil, M\)/);
});

test('G1: an empty clause: added, the solver has no model left; rejected, the search ends', async () => {
  const add = await H.runProject(withLoop('M = A.solve()\nA.add(G.above(A.solve(assume A.atom("pick", 9))))\n'));
  assert.equal(H.done(add).outcome, 'error');               // pick(9) does not exist
  assert.match(H.last(add, 'E').message, /solver A has no atom pick\(9\)/);
  const r = await H.runProject({ ...SUM, fragments: SUM.fragments.map((f) => (f.name === 'check' ? { ...f, text: 'cx.' } : f)),
    loop: { language: 'loop', text: DECL + 'search A:\n    on candidate M:\n        X = C.solve(assume G(M))\n        if X: reject M with G.clause(X)\nlog "after"\nM = A.solve()\nif not M: log "no model"\n' } });
  assert.equal(H.done(r).outcome, 'finished', JSON.stringify(H.ofKind(r, 'E')));
  assert.equal(H.finalStats(r).solutions, 0);
  assert.equal(H.finalStats(r).candidates, 1);
  assert.deepEqual(H.ofKind(r, 'L').map((l) => l.text), ['after', 'no model']);
});

test('G2: lists as values (a.true, E.flip(a), E.without(a)), S.atom, G(M) given back to its source', async () => {
  const r = await H.runProject(withLoop('M = A.solve(assume A.atom("pick", 1), A.atom("pick", 2))\nE = G(M)\nn = 0\nF = E\nW = E\nfor a in E:\n    if a.true:\n        n = n + 1\n        F = E.flip(a)\n        W = E.without(a)\nlog "true", n\nlog "size", F.size, W.size\nM2 = A.solve(assume F)\nlog "picked", M2.count(pick/1)\n'));
  assert.equal(H.done(r).outcome, 'finished', JSON.stringify(H.ofKind(r, 'E')));
  const L = H.ofKind(r, 'L').map((l) => l.text);
  assert.equal(L[1], 'size 4 3');
  assert.match(L[2], /^picked \d$/);
});

test('G3: X.value, X.count, X.cost, a.arg, with the messages of the spec', async () => {
  const r = await H.runProject(withLoop('M = A.solve(assume A.atom("pick", 3))\nlog M.count(pick/1) >= 1\nfor a in M.atoms(pick/1):\n    log a.arg(1)\nlog M.value(pick/1)\n'));
  const L = H.ofKind(r, 'L').map((l) => l.text);
  assert.equal(L[0], 'true');
  if (H.done(r).outcome === 'error') assert.match(H.last(r, 'E').message, /X.value\(pick\/1\): expected one true atom, found \d/);
  const kb = await H.runProject(all(ex('knapsack-bounds')));
  assert.equal(H.finalStats(kb).solutions, 2);
});

test('final review: an empty clause after an earlier reject (no trap); a dead solver ends exhausted; nested-search clauses keep their signs', async () => {
  const r1 = await H.runProject(withLoop('search A:\n    on candidate M:\n        reject M with G.block(M)\n        reject M with G.above(M)\n'));
  assert.equal(H.done(r1).outcome, 'finished', JSON.stringify({ E: H.ofKind(r1, 'E'), status: r1.status }));
  const r2 = await H.runProject(withLoop('loop:\n    M = A.solve()\n    if not M: break\n    A.add(G.above(M))\n'));
  assert.equal(H.done(r2).exhausted, true);
  // negative solver literals: q(X) is the choice, p(X) its complement
  const p = H.projectOf({ shared: '', abstraction: '{ q(1..2) }.\np(X) :- X = 1..2, not q(X).\n#show p/1.', glue: 'glue(p(1..2)).', check: 'x.\n:- x, p(1), not p(2).' });
  p.loop = { language: 'loop', text: `solver A = shared + abstraction
solver C = shared + check
link G = A -> C via shared + glue
solver D = shared + check
link H = C -> D via shared + glue
Y = none
search A keep Y:
    on candidate M:
        if M.count(p/1) == 2: reject M with G.block(M)
for M in A.models():
    log M.count(p/1)
` };
  const r3 = await H.runProject(p);
  assert.equal(H.done(r3).outcome, 'finished', JSON.stringify(H.ofKind(r3, 'E')));
  const counts = H.ofKind(r3, 'L').map((l) => l.text).sort();
  assert.deepEqual(counts, ['0', '1', '1'], 'only {p1,p2} is removed (the empty set stays)');
});
