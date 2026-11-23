// Breadth (docs/directions/breadth.md): cores as lists, the for guard, cores as expand facts,
// track, interface atoms grounded as text, and the examples for loops from the literature.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load, applyVariant } from '../js/project.js';
import { compile } from '../js/compiler.js';

const ex = (id) => load(H.read(`examples/${id}.json`));
const all = (p) => ({ ...p, settings: { ...p.settings, solutions: 0, seconds: 0, trace: 0 } });
const logs = (r) => H.ofKind(r, 'L').map((l) => l.text);
const errs = (r) => JSON.stringify(H.ofKind(r, 'E').map((e) => e.message));
const DECL = 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue\n';
const SET = { constants: {}, solutions: 0, seconds: 0, candidates: 0, trace: 0, seed: 0 };
const tiny = (check, loop) => ({ fragments: [
  { name: 'shared', text: 'd(1..3).' },
  { name: 'abstraction', text: '{ q(X) : d(X) }.\n#show q/1.' },
  { name: 'glue', text: 'glue(q(X)) :- d(X).' },
  { name: 'check', text: check }], settings: SET, loop: { language: 'loop', text: DECL + loop } });
// every candidate, with whether the check has a model
const EACH = 'loop:\n    M = A.solve()\n    if not M: stop\n    log M.count(q/1), C.solve(assume G(M)) != none\n    A.add(G.block(M))\n';

test('interface atoms are grounded with the check: a rule that projects them away sees all of them', async () => {
  // clingo 5.8 grounds "b :- q(X)." with one instance when q/1 only comes from the backend;
  // the runtime now also gives the interface as a choice rule (lua/runtime.lua, iface_part)
  for (const check of ['b :- q(X). :- not b.', 'p(X) :- q(X). b :- p(X). :- not b.', 'b :- p(X). p(X) :- q(X), d(X). :- not b.']) {
    const r = await H.runProject(tiny(check, EACH));
    assert.equal(H.done(r).outcome, 'finished', errs(r));
    const seen = logs(r).map((l) => l.split(' '));
    assert.equal(seen.length, 8, check);
    for (const [n, sat] of seen) assert.equal(sat, n === '0' ? 'false' : 'true', `${check}: ${n} atoms -> ${sat}`);
  }
});

test('a core is a list: for a in C.core relaxes it; core.on(G) may be empty; for refuses a non-list', async () => {
  const p = all(ex('maxsat-ihs'));
  const r = await H.runProject(p);
  assert.equal(H.done(r).outcome, 'finished', errs(r));
  assert.equal(H.finalStats(r).solutions, 1);
  assert.ok(logs(r).includes('optimum: 8'), logs(r).join('|'));
  // the hard clauses alone are unsatisfiable: the core lies outside G, core.on(G) is empty
  const u = await H.runProject({ ...p, settings: { ...p.settings, instance: 'hard-unsat' } });
  assert.equal(H.done(u).outcome, 'stopped', errs(u));
  assert.equal(H.done(u).detail, 'the hard clauses are unsatisfiable');
  // for over a model, over none
  for (const [loop, msg] of [['M = A.solve()\nfor a in M: log a\n', 'for: expected a list, got a model (use X.atoms(p/n))'],
    ['x = none\nfor a in x: log a\n', 'for: expected a list, got none']]) {
    const e = await H.runProject(tiny(':- q(1).', loop));
    assert.equal(H.done(e).outcome, 'error');
    assert.equal(H.ofKind(e, 'E')[0].message, msg);
  }
});

test('expand takes a core: OLL finds the optima clingo finds', async () => {
  const p = all(ex('maxsat-oll'));
  for (const [inst, opt] of [['example', 6], ['optimum-3', 3], ['optimum-4', 4]]) {
    const r = await H.runProject({ ...p, settings: { ...p.settings, instance: inst } });
    assert.equal(H.done(r).outcome, 'finished', errs(r));
    assert.ok(logs(r).includes(`optimum: ${opt} violated: ${opt}`), `${inst}: ${logs(r).join('|')}`);
    const lower = H.ofKind(r, 'V').filter((v) => v.n === 'lower').map((v) => v.v);
    assert.deepEqual(lower, Array.from({ length: opt + 1 }, (_, i) => i), inst);
  }
});

test('track: V events per round, the last value in S, a compile error without a value', async () => {
  const r = await H.runProject(all(ex('knapsack-bounds')));
  const v = H.ofKind(r, 'V');
  const series = (n) => v.filter((x) => x.n === n).map((x) => x.v);
  assert.deepEqual(series('upper'), [28, 28, 27, 26, 25, 25, 25]);
  assert.deepEqual(v.filter((x) => x.n === 'upper').map((x) => x.i), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(H.finalStats(r).tracked, { lower: 25, upper: 25 });
  // a run without track has no tracked field (recordings and final statistics stay as before)
  const g = await H.runProject(all(ex('gc-shape2')));
  assert.equal(H.finalStats(g).tracked, undefined);
  const c = compile('loop:\n    track x = 1\n    track y\n    break\n', { fragments: [] });
  assert.deepEqual(c.errors.map((e) => [e.line, e.message]), [[3, 'track needs a value, as in track y = e']]);
  assert.match(compile('track lower = 2 + 3\n', { fragments: [] }).lua, /rt\.track\("lower", rt\.plus\(2, 3\)\)/);
  const bad = await H.runProject(tiny(':- q(1).', 'track x = "a"\n'));
  assert.equal(H.ofKind(bad, 'E')[0].message, 'track x: the value must be a number, got string');
});

test('the loops from the literature: each example agrees with brute force or direct clingo', async () => {
  // counts and optima measured independently (docs/directions/breadth.md, "Examples")
  const want = {
    'maxsat-ihs': { example: 'optimum: 8', 'small-opt': 'optimum: 3', 'opt-6': 'optimum: 6' },
    'benders-tardiness': { example: 'optimum: 20', tight: 'optimum: 16', 'three-machines': 'optimum: 18' },
  };
  for (const [id, cases] of Object.entries(want)) {
    const p = all(ex(id));
    for (const [inst, line] of Object.entries(cases)) {
      const r = await H.runProject({ ...p, settings: { ...p.settings, instance: inst } });
      assert.ok(logs(r).includes(line), `${id}/${inst}: ${logs(r).join('|')}`);
    }
  }
  // MARCO: MUSes are the solutions, MSSes are counted (brute force over all subsets)
  const m = all(ex('marco'));
  for (const [inst, mus, mss] of [['example', 7, 12], ['nine-mus', 9, 3], ['four-mus', 4, 6], ['satisfiable', 0, 1]]) {
    const r = await H.runProject({ ...m, settings: { ...m.settings, instance: inst } });
    assert.equal(H.finalStats(r).solutions, mus, inst);
    assert.equal(H.finalStats(r).counters.mss, mss, inst);
    assert.equal(H.done(r).exhausted, true, inst);
  }
});

test('C.core.minimal: unsatisfiable, every proper subset satisfiable, and .on(G) uses its own literals', async () => {
  const p = all(ex('lang-core'));
  const loop = p.loop.text.split('\nsearch A:')[0] + `
search A:
    on candidate M:
        if not C.solve(assume G(M)):
            full = C.core.size
            linked = C.core.on(G).size
            K = C.core.minimal
            bad = 0
            if C.solve(assume K): bad = bad + 1
            for a in K:
                if not C.solve(assume K.without(a)): bad = bad + 1
            log full, K.size, linked, K.on(G).size, bad
            reject M with K.on(G)
`;
  const r = await H.runProject({ ...p, loop: { language: 'loop', text: loop } });
  assert.equal(H.done(r).outcome, 'finished', errs(r));
  assert.equal(H.finalStats(r).solutions, 958);
  const rows = logs(r).map((l) => l.split(' ').map(Number));
  assert.ok(rows.length > 0);
  for (const [full, min, linked, minLinked, bad] of rows) {
    assert.equal(bad, 0, 'not minimal');
    assert.ok(min <= full && minLinked <= linked && minLinked === min, JSON.stringify([full, min, linked, minLinked]));
  }
  assert.ok(rows.some(([full, min]) => min < full), 'some core shrinks');
  assert.equal(H.finalStats(r).minimised, rows.length);
  // only a core can be minimised; it is a value, not a method
  const e = await H.runProject({ ...p, loop: { language: 'loop', text: p.loop.text.split('\nsearch A:')[0] + '\nM = A.solve()\nlog M.minimal\n' } });
  assert.equal(H.ofKind(e, 'E')[0].message, 'minimal: expected a core, as in C.core.minimal');
  assert.deepEqual(compile('solver C = shared\nx = C.core.minimal()\n', { fragments: ['shared'] }).errors.map((x) => x.message),
    ["'minimal' is not a method: write C.core.minimal"]);
});

test('minimal cores: maxsat-ihs needs 5 rounds instead of 57, colourable-partial a third of the candidates', async () => {
  const ihs = all(ex('maxsat-ihs'));
  const a = await H.runProject(ihs);
  const b = await H.runProject(applyVariant(ihs, 'plain-cores'));
  assert.ok(logs(a).includes('optimum: 8') && logs(b).includes('optimum: 8'));
  assert.equal(H.finalStats(a).candidates, 5);
  assert.equal(H.finalStats(b).candidates, 57);
  const col = all(ex('colourable-partial'));
  const c = await H.runProject(col);
  const d = await H.runProject(applyVariant(col, 'plain-cores'));
  assert.equal(H.finalStats(c).solutions, 105);
  assert.equal(H.finalStats(d).solutions, 105);
  assert.ok(H.finalStats(c).candidates * 2 < H.finalStats(d).candidates, `${H.finalStats(c).candidates} vs ${H.finalStats(d).candidates}`);
});
