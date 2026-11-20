// Phase 2: rule refinements, restarts, guards and refinement variants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';

const LEG = 'legacy = true';
const fixed = () => { const f = H.GC6(); f.check += H.FIX; return f; };
const refined = () => { const f = H.GC6(); f.abstraction += H.REFINE_PART; return f; };
const all = (f, extra = {}) => H.projectOf(f, { solutions: 0, ...extra });
const ok = (r) => {
  assert.notEqual(r.status, 'trap', r.err.join('\n'));
  const e = H.last(r, 'E');
  assert.equal(e, undefined, e && e.message + '\n' + e.traceback);
  assert.ok(r.out.at(-1).startsWith('@@D '));
};
const sols = (r) => H.finalStats(r).solutions;

test('row 5: fix, shape 1, all: 10,698', async () => {
  const r = await H.runLua(all(fixed()), H.LUA.shape1(LEG));
  ok(r); assert.equal(sols(r), 10698);
});

test('row 6: refine part, shape 3, all: 10,698', { skip: !H.SLOW && 'slow (SLOW=1)' }, async () => {
  const r = await H.runLua(all(refined()), H.LUA.shape3(LEG));
  ok(r); assert.equal(sols(r), 10698);
  assert.equal(H.done(r).outcome, 'finished');
});

test('row 7: refine part, shape 4, batch 20: 10,698', async () => {
  const r = await H.runLua(all(refined()), H.LUA.shape4(20, LEG));
  ok(r); assert.equal(sols(r), 10698);
  const s = H.finalStats(r);
  assert.ok(s.expansions > 0 && s.restarts > 0 && s.blocks > 0);
  assert.deepEqual(H.done(r), { outcome: 'finished', exhausted: true, detail: '' });
});

test('row 8: #maximize in the abstraction: 9 improving solutions, the last has 15 edges', async () => {
  const f = fixed();
  f.abstraction += '\n#maximize { 1,X,Y : edge(X,Y), X < Y }.\n';
  const r = await H.runLua(all(f), H.LUA.shape1(LEG));
  ok(r);
  const ms = H.ofKind(r, 'M');
  assert.equal(ms.length, 9);
  const edges = (a) => (a.match(/edge\((\d+),(\d+)\)/g) || []).length;
  assert.equal(edges(ms.at(-1).atoms), 15);
  assert.ok(Array.isArray(ms.at(-1).cost));
});

test('a refine part whose heads lack k: no-progress guard in shape 3', async () => {
  const f = H.GC6();
  f.abstraction += H.REFINE_PART.replace(/broken\(k\)/g, 'broken');
  const r = await H.runLua(all(f), H.LUA.shape3(LEG));
  assert.notEqual(r.status, 'trap');
  assert.equal(H.last(r, 'E').message, 'the refinement made no progress: the same candidate came back');
  assert.equal(H.done(r).outcome, 'error');
});

test('several counterexamples per candidate (models, limit 5; list reject): 10,698', async () => {
  const lua = H.LUA.shape1(LEG).replace(
    /local X = C:solve\{ assume = G:of\(M\) \}\n\s*if X then M:reject\(G:clause\(M, X\)\) end/,
    'for _, X in ipairs(C:models{ assume = G:of(M), limit = 5 }) do M:reject(G:clause(M, X)) end');
  assert.ok(lua.includes('C:models'));
  const r = await H.runLua(all(fixed()), lua);
  ok(r); assert.equal(sols(r), 10698);
  const s = H.finalStats(r);
  assert.ok(s.clauses > s.solvers.C.sat, 'more clauses than satisfiable checks');
});

test('a list of clauses in one reject (rt.concat of lists)', async () => {
  const lua = H.LUA.shape1(LEG).replace(
    /local X = C:solve\{ assume = G:of\(M\) \}\n\s*if X then M:reject\(G:clause\(M, X\)\) end/,
    'local xs = C:models{ assume = G:of(M), limit = 3 }\n      if #xs > 0 then local cs = {} for _, X in ipairs(xs) do cs[#cs + 1] = G:clause(M, X) end M:reject(cs) end');
  const r = await H.runLua(all(fixed()), lua);
  ok(r); assert.equal(sols(r), 10698);
});

test('smallest refinement (optimal check): 10,698', async () => {
  const f = fixed();
  f.check += '\n#minimize { 1,T : relevant(T) }.\n';
  const lua = H.LUA.shape1(LEG).replace('C:solve{ assume = G:of(M) }', 'C:solve{ assume = G:of(M), optimal = true }');
  const r = await H.runLua(all(f), lua);
  ok(r); assert.equal(sols(r), 10698);
  // compare: clauses are not longer on average than without optimal
  const r0 = await H.runLua(all(fixed()), H.LUA.shape1(LEG));
  const a = H.finalStats(r), b = H.finalStats(r0);
  assert.ok(a.literals / a.clauses <= b.literals / b.clauses);
});

// A dual problem: a candidate (a graph on 5 nodes) is good iff the check is satisfiable
// (it has a proper 3-colouring). Refinement from the unsat core.
const DUAL = {
  shared: 'node(1..5).',
  abstraction: '{ edge(X,Y) : node(X), node(Y), X < Y }.\n#show edge/2.',
  glue: 'glue(edge(X,Y)) :- node(X), node(Y), X < Y.',
  check: '1 { col(N,1..3) } 1 :- node(N).\n:- edge(X,Y), col(X,C), col(Y,C).',
};
const witness = (refinement) => `
    local A = rt.solver("A", {"shared", "abstraction"}, {})
    local C = rt.solver("C", {"shared", "check"}, {})
    local G = rt.link("G", A, C, {"shared", "glue"}, {})
    rt.prepare()
    A:search{ on_candidate = function(M)
      if not C:solve{ assume = G:of(M) } then M:reject(${refinement}) end
    end }
`;
test('unsat core refinement equals the reference run on a dual problem', async () => {
  const ref = await H.runLua(all(DUAL), witness('G:block(M)'));
  ok(ref);
  const r = await H.runLua(all(DUAL), witness('G:core(C)'));
  ok(r);
  assert.equal(sols(r), sols(ref));
  assert.ok(sols(r) > 0 && sols(r) < 1024);
  assert.ok(H.finalStats(r).solvers.C.calls < H.finalStats(ref).solvers.C.calls);
});

test('core of a satisfiable solve is an error', async () => {
  const r = await H.runLua(all(DUAL), witness('G:block(M)').replace('if not C:solve{ assume = G:of(M) } then M:reject(G:block(M)) end',
    'C:solve{ assume = G:of(M) }; M:reject(G:core(C))'));
  assert.match(H.last(r, 'E').message, /was not unsatisfiable/);
});

test('explicit clauses from ASP (G.clauses) equal shape 1 with the fix', async () => {
  const f = H.GC6();
  f.check = f.check.replace(/^relevant.*$/gm, '') + `
clause(1, edge(N,M), true) :- node(N), node(M), N < M, not edge(N,M).
clause(1, leaf_color(N,C), false) :- leaf_color(N,C), leaf(N).
clause(1, leaf_color(N,C), true) :- node(N), not leaf(N), color(C), not color(N,C).
`;
  const lua = H.LUA.shape1(LEG).replace('M:reject(G:clause(M, X))', 'M:reject(G:clauses(X))');
  const r = await H.runLua(all(f), lua);
  ok(r); assert.equal(sols(r), 10698);
});

test('G.clauses with an atom outside the interface is an error', async () => {
  const f = H.GC6();
  f.check += '\nclause(1, foo, true).\n';
  const lua = H.LUA.shape1(LEG).replace('M:reject(G:clause(M, X))', 'M:reject(G:clauses(X))');
  const r = await H.runLua(all(f), lua);
  assert.match(H.last(r, 'E').message, /foo is not an interface atom of link G/);
});

test('refinement computed by a second solver R (links A -> R, C -> R): 10,698', async () => {
  const f = H.GC6();
  f.check = f.check.replace(/^relevant.*$/gm, '');
  f.rglue = 'glue(color(N,C)) :- node(N), C = 1..3.';
  f.refine = `
relevant(edge(N,M)) :- node(N), node(M), N < M, not edge(N,M).
relevant(leaf_color(N,C)) :- leaf_color(N,C), leaf(N).
relevant(leaf_color(N,C)) :- node(N), not leaf(N), color(C), not color(N,C).
`;
  const lua = `
    local A = rt.solver("A", {"shared", "abstraction"}, {})
    local C = rt.solver("C", {"shared", "check"}, {"--heuristic=Domain"})
    local R = rt.solver("R", {"shared", "refine"}, {})
    local G = rt.link("G", A, C, {"shared", "glue"}, {legacy = true})
    local GA = rt.link("GA", A, R, {"shared", "glue"}, {legacy = true})
    local GC = rt.link("GC", C, R, {"shared", "rglue"}, {})
    rt.prepare()
    A:search{ on_candidate = function(M)
      local X = C:solve{ assume = G:of(M) }
      if X then
        local Y = R:solve{ assume = rt.concat(GA:of(M), GC:of(X)) }
        M:reject(GA:clause(M, Y))
      end
    end }
`;
  const r = await H.runLua(all(f), lua);
  ok(r); assert.equal(sols(r), 10698);
});

test('trace = 5 sends exactly 5 T events with candidate and literals or facts', async () => {
  const r = await H.runLua(all(fixed(), { trace: 5 }), H.LUA.shape1(LEG));
  ok(r);
  const ts = H.ofKind(r, 'T');
  assert.equal(ts.length, 5);
  for (const t of ts) {
    assert.ok(t.candidate && t.candidate.length > 0);
    if (t.kind !== 'accept') assert.ok((t.literals && t.literals.length) || (t.facts && t.facts.length));
  }
  assert.deepEqual(ts.map((t) => t.i), [1, 2, 3, 4, 5]);
  const rj = ts.find((t) => t.kind === 'reject');
  assert.ok(rj.counterexample.includes('color('));
  const r3 = await H.runLua(all(refined(), { trace: 30, candidates: 200 }), H.LUA.shape3(LEG));
  const t3 = H.ofKind(r3, 'T');
  assert.equal(t3.length, 30);
  const ex = t3.find((t) => t.kind === 'expand');
  assert.ok(ex && ex.facts.length > 0 && ex.facts[0].startsWith('cex(1,color('));
  assert.ok(ex.candidate.length > 0 && ex.counterexample.includes('color('));
});

test('same non-zero seed gives identical statistics (row 5, seed 1)', async () => {
  const strip = (s) => JSON.stringify(s, (k, v) => (['t', 'time', 'ground'].includes(k) ? undefined : v));
  const a = await H.runLua(all(fixed(), { seed: 1 }), H.LUA.shape1(LEG));
  const b = await H.runLua(all(fixed(), { seed: 1 }), H.LUA.shape1(LEG));
  ok(a); ok(b);
  assert.equal(sols(a), 10698);
  assert.equal(strip(H.finalStats(a)), strip(H.finalStats(b)));
});

test('plain output for standalone exports', async () => {
  const r = await H.runLua(H.projectOf(fixed(), { solutions: 2 }), H.LUA.shape1(LEG), { plain: true });
  assert.equal(r.events.length, 0);
  assert.equal(r.out.filter((l) => l.startsWith('Answer: ')).length, 2);
  assert.ok(r.out.some((l) => /^Outcome\s+: solutions/.test(l)));
});

test('reject outside a search and add inside a search are errors', async () => {
  const r1 = await H.runLua(all(fixed()), H.LUA.shape2(LEG).replace('A:add(G:clause(M, X))', 'M:reject(G:clause(M, X))'));
  assert.match(H.last(r1, 'E').message, /reject works only on a candidate inside search/);
  const r2 = await H.runLua(all(fixed()), H.LUA.shape1(LEG).replace('M:reject(G:clause(M, X))', 'A:add(G:clause(M, X))'));
  assert.match(H.last(r2, 'E').message, /searching/);
  const r3 = await H.runLua(all(fixed()), H.LUA.shape1(LEG).replace('if X then M:reject', 'rt.restart(); if X then M:reject').replace('rt.prepare()', 'rt.prepare(); rt.restart()'));
  assert.match(H.last(r3, 'E').message, /restart works only inside on candidate/);
});

test('pause poll: stop from stdin ends with outcome stopped', async () => {
  const { assemble } = await import('../js/driver.js');
  const a = assemble(all(fixed()), H.LUA.shape1(LEG), H.RUNTIME, { poll: true });
  let n = 0;
  const r = await H.run(a.program, '--outf=3', { stdin: () => (++n > 30 ? 'stop' : 'go') });
  assert.deepEqual(H.done(r), { outcome: 'stopped', exhausted: false, detail: 'stopped by user' });
  assert.equal(H.finalStats(r).candidates, 30);
});

test('the runtime reads no undeclared global (strict _G) on the main paths', async () => {
  const { assemble } = await import('../js/driver.js');
  const strict = 'local __ok = { rt = true, LOOP_LINES = true }\n' +
    'setmetatable(_G, { __index = function(_, k) if not __ok[k] then error("undeclared global " .. tostring(k), 2) end end })\n' + H.RUNTIME;
  const cases = [
    [all(fixed(), { candidates: 300, trace: 20 }), H.LUA.shape1(LEG).replace('local X = C:solve{ assume = G:of(M) }\n      if X then M:reject(G:clause(M, X)) end',
      'for _, X in ipairs(C:models{ assume = G:of(M), limit = 3 }) do M:reject(G:clause(M, X)) end')],
    [all(refined(), { candidates: 300, trace: 20 }), H.LUA.shape4(5, LEG)],
    [all(refined(), { candidates: 100, trace: 20 }), H.LUA.shape3(LEG)],
    [all(fixed(), { candidates: 100, solutions: 3 }), H.LUA.shape2(LEG)],
    [all(DUAL, { trace: 20 }), witness('G:core(C)')],
  ];
  for (const [p, lua] of cases) {
    const r = await H.run(assemble(p, lua, strict, { plain: false }).program);
    ok(r);
    const r2 = await H.run(assemble(p, lua, strict, { plain: true }).program);
    assert.notEqual(r2.status, 'trap');
    assert.ok(!r2.out.some((l) => l.startsWith('Error')), r2.out.join('\n'));
  }
});
