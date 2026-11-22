// Phase L2: control (docs/directions/generality.md, G4 and G8).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';
import { compile } from '../js/compiler.js';

const ex = (id) => load(H.read(`examples/${id}.json`));
const all = (p) => ({ ...p, settings: { ...p.settings, solutions: 0, seconds: 0, trace: 0 } });
const RESOLVE = `search A:
    on candidate M:
        loop:
            Y = B.solve(assume GX(M))
            if not Y: break
            W = C.solve(assume GXY(Y))
            if W:
                B.add(GXY.clause(Y, W))
            else:
                reject M with GXC.core(C)
                break
`;

test('G4: qbf-three-blocks with an inner search of B: 4 solutions, fewer solves of B than re-solving', async () => {
  const p = ex('qbf-three-blocks');
  assert.match(p.loop.text, /search B assume GX\(M\) keep Y:/);
  const inner = await H.runProject(all(p));
  const q = structuredClone(p);
  q.loop.text = q.loop.text.replace(/search A:[\s\S]*$/, RESOLVE);
  const resolve = await H.runProject(all(q));
  const calls = (r) => H.finalStats(r).solvers.B.calls;
  assert.equal(H.finalStats(inner).solutions, 4);
  assert.equal(H.finalStats(resolve).solutions, 4);
  console.log(`# qbf-three-blocks: ${calls(inner)} solves of B with an inner search, ${calls(resolve)} re-solving`);
  assert.ok(calls(inner) < calls(resolve));
});

test('G8: knapsack-interdiction with #minimize and search A optimal: one solution, lock(3) lock(4); a plain search with optN lists it twice', async () => {
  const run = async (opt) => {
    const p = ex('knapsack-interdiction');
    p.fragments.find((f) => f.name === 'abstraction').text += '\n#minimize { 1,I : lock(I) }.\n';
    if (opt) p.loop.text = p.loop.text.replace('search A:', 'search A optimal:');
    else p.loop.text = p.loop.text.replace(/^(solver A = .*)$/m, '$1 options "--opt-mode=optN"');
    return H.ofKind(await H.runProject(all(p)), 'M').map((m) => m.atoms);
  };
  assert.deepEqual(await run(true), ['lock(3) lock(4)']);
  assert.deepEqual(await run(false), ['lock(3) lock(4)', 'lock(3) lock(4)']);
});

test('static errors of phase L2', () => {
  const FR = { fragments: ['a', 'b', 'c'] };
  const D = 'solver A = a\nsolver B = b\nlink G = A -> B via c\n';
  const e1 = compile(D + 'search A keep:\n    on candidate M:\n        log 1\n', FR);
  assert.match(e1.errors[0].message, /'keep' needs a name, as in: search B assume E keep Y:/);
  const e2 = compile(D + 'search A:\n    on candidate M:\n        search A:\n            on candidate N:\n                log 1\n', FR);
  assert.match(e2.errors[0].message, /search A: solver A is already searching/);
  const ok = compile(D + 'search A optimal:\n    on candidate M:\n        search B assume G(M) keep Y:\n            on candidate Z:\n                log 1\n        if Y: log 2\n', FR);
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.match(ok.lua, /Y = B:search\{ assume = G:of\(M\), keep = true, on_candidate = function\(Z\)/);
  assert.match(ok.lua, /A:search\{ optimal = true, on_candidate/);
});
