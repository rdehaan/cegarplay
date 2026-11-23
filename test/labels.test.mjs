// accept M as NAME: a second kind of solution (FUTURE-DIRECTIONS, Loop language).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { compile } from '../js/compiler.js';
import { Reducer } from '../js/campaign.js';

const DECL = 'solver A = shared + abstraction\nsolver C = shared + check\nlink   G = A -> C via shared + glue\n';

test('accept M as NAME compiles to rt.accept(M, "NAME"); as is a keyword', () => {
  const fragments = ['shared', 'abstraction', 'check', 'glue'];
  const c = compile(DECL + 'loop:\n    M = A.solve()\n    if not M: stop\n    accept M as mss\n    A.add(G.block(M))\n', { fragments });
  assert.ok(c.ok, JSON.stringify(c.errors));
  assert.match(c.lua, /rt\.accept\(M, "mss"\)/);
  const bad = compile(DECL + 'loop:\n    M = A.solve()\n    accept M as\n', { fragments });
  assert.match(bad.errors[0].message, /expected a name for this kind of solution/);
});

test('marco: 7 MUSes as solutions and 12 MSSes accepted as mss', async () => {
  const p = H.example('marco');
  p.settings = { ...p.settings, solutions: 0, trace: 0 };
  const r = await H.runProject(p);
  const S = H.finalStats(r);
  assert.equal(S.solutions, 7);
  assert.deepEqual(S.labels, { mss: 12 });
  const N = H.ofKind(r, 'N');
  assert.equal(N.length, 12);
  assert.deepEqual(N.map((x) => x.n), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.ok(N.every((x) => x.label === 'mss' && /pick\(/.test(x.atoms)));
  // a labelled solution does not end a run at the solution limit
  const q = H.example('marco');
  q.settings = { ...q.settings, solutions: 1, trace: 0 };
  const r1 = await H.runProject(q);
  assert.equal(H.finalStats(r1).solutions, 1);
  // campaign rows carry the labels
  const red = new Reducer();
  for (const e of r.events) red.add(e.kind, e.data);
  assert.deepEqual(red.result('ok').labels, { mss: 12 });
});

test('accept ... as NAME refuses the candidate of a search', async () => {
  const p = H.example('tutorial-first-run');
  p.loop.text = DECL + 'search A:\n    on candidate M:\n        accept M as odd\n';
  p.settings = { ...p.settings, solutions: 0, trace: 0 };
  const r = await H.runProject(p);
  assert.match(H.last(r, 'E').message, /accept \.\.\. as odd: inside a search/);
});
