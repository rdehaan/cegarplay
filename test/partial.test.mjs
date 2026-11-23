// G5: checks on partial candidates (docs/directions/generality.md, G5; manual, "Checks on
// partial candidates").
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load, applyVariant } from '../js/project.js';
import { compile } from '../js/compiler.js';

const ex = (id) => load(H.read(`examples/${id}.json`));
const all = (p) => ({ ...p, settings: { ...p.settings, solutions: 0, seconds: 0, trace: 0 } });
const errs = (r) => JSON.stringify(H.ofKind(r, 'E').map((e) => e.message));
const DECL = 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue\n';
const SET = { constants: {}, solutions: 0, seconds: 0, candidates: 0, trace: 0, seed: 0 };
// graphs on 4 nodes without a triangle (41 of the 64), with a counterexample check
const TRI = (loop) => ({ settings: SET, loop: { language: 'loop', text: DECL + loop }, fragments: [
  { name: 'shared', text: 'node(1..4).\npair(X,Y) :- node(X), node(Y), X < Y.' },
  { name: 'abstraction', text: '{ edge(X,Y) : pair(X,Y) }.\n#show edge/2.' },
  { name: 'glue', text: 'glue(edge(X,Y)) :- pair(X,Y).' },
  { name: 'check', text: '1 { tri(X,Y,Z) : node(X), node(Y), node(Z), X < Y, Y < Z } 1.\n:- tri(X,Y,Z), not edge(X,Y).\n:- tri(X,Y,Z), not edge(X,Z).\n:- tri(X,Y,Z), not edge(Y,Z).\nrelevant(edge(X,Y)) :- tri(X,Y,Z).\nrelevant(edge(X,Z)) :- tri(X,Y,Z).\nrelevant(edge(Y,Z)) :- tri(X,Y,Z).' }] });
const TOTAL = '    on candidate M:\n        X = C.solve(assume G(M))\n        if X: reject M with G.clause(M, X)\n';

test('compiler: on partial before on candidate, with every; errors for the wrong order and inner searches', () => {
  const ok = compile(DECL + 'search A:\n    on partial P every 4:\n        X = C.solve(assume G(P, false))\n        if X: reject P with G.clause(X)\n' + TOTAL, { fragments: ['shared', 'abstraction', 'check', 'glue'] });
  assert.equal(ok.errors, undefined, JSON.stringify(ok.errors));
  assert.match(ok.lua, /A:search\{ on_partial = function\(P\)/);
  assert.match(ok.lua, /end, every = 4, on_candidate = function\(M\)/);
  assert.match(ok.lua, /G:of\(P, false\)/);
  const msgs = (src) => (compile(src, { fragments: ['shared'] }).errors || []).map((e) => e.message);
  assert.deepEqual(msgs('solver A = shared\nsearch A:\n    on candidate M: log 1\n    on partial P: log 2\n'), ["'on partial' must come before 'on candidate'"]);
  assert.deepEqual(msgs('solver A = shared\nsolver B = shared\nsearch A:\n    on partial P:\n        search B:\n            on candidate Y: log 1\n    on candidate M: log 2\n'),
    ["'search' cannot stand inside 'on partial'"]);
  assert.deepEqual(msgs('solver A = shared\nsearch A:\n    on partial P:\n        reject M with 1\n    on candidate M: log 2\n'), ["'reject' must name the candidate variable 'P'"]);
});

test('partial candidates: the same solutions, fewer total candidates; G(P) lists the decided atoms only', async () => {
  const total = await H.runProject(TRI('search A:\n' + TOTAL));
  const part = await H.runProject(TRI('search A:\n    on partial P:\n        X = C.solve(assume G(P, false))\n        if X: reject P with G.clause(X)\n' + TOTAL));
  for (const r of [total, part]) assert.equal(H.done(r).outcome, 'finished', errs(r));
  assert.equal(H.finalStats(total).solutions, 41);
  assert.equal(H.finalStats(part).solutions, 41);
  assert.equal(H.finalStats(total).partials, undefined);
  assert.ok(H.finalStats(part).partials > 0);
  assert.ok(H.finalStats(part).candidates < H.finalStats(total).candidates, `${H.finalStats(part).candidates} < ${H.finalStats(total).candidates}`);
  // G(P) has fewer atoms than the link while edges are open; G(P, false) has all of them
  const sizes = await H.runProject(TRI('search A:\n    on partial P:\n        log G(P).size, G(P, false).size\n' + TOTAL));
  const seen = H.ofKind(sizes, 'L').map((l) => l.text.split(' ').map(Number));
  assert.ok(seen.length > 0);
  assert.ok(seen.every(([a, b]) => b === 6 && a <= 6) && seen.some(([a]) => a < 6), JSON.stringify(seen.slice(0, 5)));
});

test('partial candidates refuse clauses that speak about the candidate itself', async () => {
  for (const [body, msg] of [
    ['reject P with G.block(P)', 'G.block needs a total candidate; on a partial candidate use G.clause(X), G.clauses(X) or a core'],
    ['X = C.solve(assume G(P, false))\n        if X: reject P with G.clause(P, X)', 'G.clause needs a total candidate; on a partial candidate use G.clause(X), G.clauses(X) or a core'],
    ['reject P with G.above(P)', 'G.above needs a total candidate; on a partial candidate use G.clause(X), G.clauses(X) or a core'],
  ]) {
    const r = await H.runProject(TRI(`search A:\n    on partial P:\n        ${body}\n` + TOTAL));
    assert.equal(H.done(r).outcome, 'error');
    assert.equal(H.ofKind(r, 'E')[0].message, msg);
  }
});

test('the check mode follows the search: a partial search after a plain one is still called', async () => {
  // the propagator's init runs for every solve, so a later search can switch to fixpoint checks
  const loop = 'search A:\n    on candidate M:\n        restart\n' +
    'search A:\n    on partial P:\n        count q\n' + TOTAL + 'search A:\n    on candidate M:\n        count r\n';
  const r = await H.runProject(TRI(loop));
  assert.equal(H.done(r).outcome, 'finished', errs(r));
  const c = H.finalStats(r).counters;
  assert.ok(c.q > 0, JSON.stringify(c));
});

test('the G5 examples: each instance and the total-only variant give the same counts', async () => {
  for (const [id, inst, want] of [['triangle-free-lazy', 'n8', 35], ['triangle-free-lazy', 'n7-none', 0], ['triangle-free-lazy', 'n6', 115],
    ['colourable-partial', 'n7', 105], ['colourable-partial', 'n6', 15]]) {
    const p = all(ex(id));
    const counts = [];
    for (const variant of [null, 'total-only']) {
      const q = variant ? applyVariant(p, variant) : p;
      const r = await H.runProject({ ...q, settings: { ...q.settings, instance: inst } });
      assert.equal(H.done(r).outcome, 'finished', `${id}/${inst}/${variant}: ${errs(r)}`);
      assert.equal(H.done(r).exhausted, true);
      counts.push([H.finalStats(r).solutions, H.finalStats(r).candidates, H.finalStats(r).partials || 0]);
    }
    assert.equal(counts[0][0], want, `${id}/${inst}`);
    assert.equal(counts[1][0], want, `${id}/${inst} total-only`);
    assert.ok(counts[0][2] > 0 && counts[1][2] === 0);
  }
});

test('the spec test of G5: lang-core with an on partial hook keeps its solutions', async () => {
  const p = all(ex('lang-core'));
  const base = await H.runProject(p);
  const hooked = await H.runProject({ ...p, loop: { language: 'loop', text: p.loop.text.replace('search A:\n',
    'search A:\n    on partial P:\n        if not C.solve(assume G(P)):\n            reject P with G.core(C)\n') } });
  assert.equal(H.done(hooked).outcome, 'finished', errs(hooked));
  assert.equal(H.finalStats(hooked).solutions, H.finalStats(base).solutions);
  assert.ok(H.finalStats(hooked).partials > 0);
  assert.ok(H.finalStats(hooked).candidates <= H.finalStats(base).candidates);
});
