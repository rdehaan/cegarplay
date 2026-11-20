// Phase 3: the loop language compiler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { compile } from '../js/compiler.js';
import { mapLine } from '../js/driver.js';
import { template, TEMPLATES, DEFAULT_FRAGMENTS } from '../js/project.js';

const FR = DEFAULT_FRAGMENTS;
const C = (src, fragments = FR) => compile(src, { fragments });
const errorsOf = (src, fragments) => { const r = C(src, fragments); assert.equal(r.ok, false, 'expected errors'); return r.errors; };
const DECL = template('shape1').split('\n').slice(0, 3).join('\n') + '\n';
const DECLL = DECL.replace('glue\n', 'glue legacy\n');
const one = (src, line, col, re) => {
  const es = errorsOf(src);
  const e = es.find((x) => re.test(x.message));
  assert.ok(e, `no error matching ${re}: ${JSON.stringify(es)}`);
  assert.deepEqual([e.line, e.col], [line, col], JSON.stringify(e));
};

const fixed = () => { const f = H.GC6(); f.check += H.FIX; return f; };
const refined = () => { const f = H.GC6(); f.abstraction += H.REFINE_PART; return f; };
const proj = (frags, text, settings = {}) => ({ ...H.projectOf(frags, { solutions: 0, ...settings }), loop: { language: 'loop', text } });

test('every template compiles', () => {
  for (const k of Object.keys(TEMPLATES)) {
    for (const legacy of [false, true]) {
      const r = C(template(k, { legacy }));
      assert.ok(r.ok, k + JSON.stringify(r.errors));
      assert.deepEqual(r.solvers.map((s) => s.name), ['A', 'C']);
      assert.deepEqual(r.solvers[1].options, ['--heuristic=Domain']);
      assert.equal(r.links[0].legacy, legacy);
    }
  }
  assert.deepEqual(C(template('shape4')).captures, [{ pred: 'color', arity: 2 }]);
  assert.deepEqual(C(template('shape3')).parts.map((p) => [p.solver, p.part]), [['A', 'refine']]);
});

// Row 13: compiled templates give the same statistics as the hand-written Lua.
const ROW13 = [
  ['shape1', fixed, H.LUA.shape1, {}],
  ['shape2', fixed, H.LUA.shape2, {}],
  ['shape3', refined, H.LUA.shape3, {}],
  ['shape4', refined, (l) => H.LUA.shape4(20, l), {}],
  ['reference', H.GC6, H.LUA.reference, {}],
];
for (const [k, frags, lua] of ROW13) {
  test(`row 13: template ${k} equals the hand-written Lua`, async () => {
    const settings = { candidates: 1500 };
    const a = await H.runProject(proj(frags(), template(k, { legacy: true }), settings));
    const b = await H.runLua(H.projectOf(frags(), { solutions: 0, ...settings }), lua('legacy = true'));
    assert.equal(H.last(a, 'E'), undefined, JSON.stringify(H.last(a, 'E')));
    assert.equal(H.stripTimes(H.finalStats(a)), H.stripTimes(H.finalStats(b)));
    assert.deepEqual(H.done(a), H.done(b));
    assert.ok(H.finalStats(a).candidates > 0);
  });
}

test('row 13, full run: template shape 1 gives row 1 numbers', async () => {
  const r = await H.runProject(proj(H.GC6(), template('shape1', { legacy: true }).replace('glue legacy', 'glue legacy compat')));
  const s = H.finalStats(r);
  assert.equal(s.solutions, 9270); assert.equal(s.solvers.C.calls, 16577); assert.equal(s.literals, 55007);
  assert.equal(s.solvers.A.choices, 25512); assert.equal(s.solvers.A.conflicts, 7499);
});

// Section 6 variants
const VARIANTS = {
  'several counterexamples': `search A:
    on candidate M:
        for X in C.models(assume G(M), limit 5): reject M with G.clause(M, X)
`,
  'smallest refinement': `search A:
    on candidate M:
        X = C.solve(assume G(M), optimal)
        if X: reject M with G.clause(M, X)
`,
  'two-stage check': `search A:
    on candidate M:
        X = C.solve(assume G(M))
        if not X: X = C2.solve(assume G2(M))
        if X: reject M with G.clause(M, X)
`,
  'explicit clauses': `search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.clauses(X)
`,
};
test('section 6 variants compile and run to 10,698', async () => {
  for (const [name, body] of Object.entries(VARIANTS)) {
    const f = fixed();
    let decl = DECL.replace('glue\n', 'glue legacy\n');
    if (name === 'smallest refinement') f.check += '\n#minimize { 1,T : relevant(T) }.\n';
    if (name === 'two-stage check') {
      decl += 'solver C2 = shared + check\nlink G2 = A -> C2 via shared + glue legacy\n';
    }
    if (name === 'explicit clauses') {
      f.check = f.check.replace(/^relevant.*$/gm, '') + `
clause(1, edge(N,M), true) :- node(N), node(M), N < M, not edge(N,M).
clause(1, leaf_color(N,C), false) :- leaf_color(N,C), leaf(N).
clause(1, leaf_color(N,C), true) :- node(N), not leaf(N), color(C), not color(N,C).
`;
    }
    const p = proj(f, decl + '\n' + body);
    p.fragments = p.fragments.map((x) => x);
    const r = await H.runProject(p);
    assert.equal(H.last(r, 'E'), undefined, name + ': ' + JSON.stringify(H.last(r, 'E')));
    assert.equal(H.finalStats(r).solutions, 10698, name);
  }
});

test('variant: refine from an unsat core', async () => {
  const dual = {
    shared: 'node(1..5).', abstraction: '{ edge(X,Y) : node(X), node(Y), X < Y }.\n#show edge/2.',
    glue: 'glue(edge(X,Y)) :- node(X), node(Y), X < Y.', check: '1 { col(N,1..3) } 1 :- node(N).\n:- edge(X,Y), col(X,C), col(Y,C).',
  };
  const d = 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue\n';
  const core = await H.runProject(proj(dual, d + 'search A:\n    on candidate M:\n        if not C.solve(assume G(M)): reject M with G.core(C)\n'));
  const ref = await H.runProject(proj(dual, d + 'search A:\n    on candidate M:\n        if not C.solve(assume G(M)): reject M with G.block(M)\n'));
  assert.equal(H.finalStats(core).solutions, H.finalStats(ref).solutions);
});

test('variant: refinement computed by its own solver', async () => {
  const f = H.GC6();
  f.check = f.check.replace(/^relevant.*$/gm, '');
  f.rglue = 'glue(color(N,C)) :- node(N), C = 1..3.';
  f.refine = `relevant(edge(N,M)) :- node(N), node(M), N < M, not edge(N,M).
relevant(leaf_color(N,C)) :- leaf_color(N,C), leaf(N).
relevant(leaf_color(N,C)) :- node(N), not leaf(N), color(C), not color(N,C).`;
  const src = `solver A = shared + abstraction
solver C = shared + check options "--heuristic=Domain"
solver R = shared + refine
link G = A -> C via shared + glue legacy
link GA = A -> R via shared + glue legacy
link GC = C -> R via shared + rglue

search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            Y = R.solve(assume GA(M), GC(X))
            reject M with GA.clause(M, Y)
`;
  const r = await H.runProject(proj(f, src));
  assert.match(r.compiled.lua, /assume = rt\.concat\(GA:of\(M\), GC:of\(X\)\)/);
  assert.equal(H.finalStats(r).solutions, 10698);
});

test('expressions, lists, counters, log, while, continue, break', async () => {
  const src = DECLL + `
n = 0
total = 0
l = []
while n < 10:
    n = n + 1
    if n == 3: continue
    if n > 7 and not n == 9: break
    l.push(n * 2)
    total = total + n
count steps by total - 1
count calls
log "list", l.size, l, -n, (1 + 2) * 3, 7 / 2, n != 4, none == none
stop "done"
`;
  const r = await H.runProject(proj(H.GC6(), src));
  assert.equal(H.last(r, 'E'), undefined, JSON.stringify(H.last(r, 'E')));
  assert.equal(H.last(r, 'L').text, 'list 6 [2, 4, 8, 10, 12, 14] -8 9 3.5 true true');
  assert.deepEqual(H.finalStats(r).counters, { steps: 24, calls: 1 });
  assert.deepEqual(H.done(r), { outcome: 'stopped', exhausted: false, detail: 'done' });
});

test('repeat with continue; for over a list; elif/else', async () => {
  const src = DECLL + `
i = 0
out = []
repeat:
    i = i + 1
    if i == 2:
        continue
    elif i == 4:
        out.push(40)
    else:
        out.push(i)
until i >= 5
for x in out:
    log x
`;
  const r = await H.runProject(proj(H.GC6(), src));
  assert.deepEqual(H.ofKind(r, 'L').map((l) => l.text), ['1', '3', '40', '5']);
});

test('map: a run-time error is reported on its script line', async () => {
  const src = DECLL + `
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            y = none + 1
            reject M with G.clause(M, X)
`;
  const r = await H.runProject(proj(fixed(), src));
  const e = H.last(r, 'E');
  assert.match(e.message, /arithmetic on a nil value/);
  assert.equal(mapLine(r.assembled, e.line), 9);
  const src2 = DECLL + '\nx = 1\nlog x\nl = []\nlog l.size\nreject_me = C.solve(assume G(none))\n';
  const r2 = await H.runProject(proj(fixed(), src2));
  assert.equal(mapLine(r2.assembled, H.last(r2, 'E').line), 9);
});

// Static checks: line, column, message
test('static check: unknown fragment', () => one('solver A = shared + abstrction\n', 1, 21, /unknown fragment 'abstrction'/));
test('static check: undeclared solver in a link', () => one('solver A = shared\nlink G = A -> B via glue\n', 2, 15, /'B' is not a declared solver/));
test('static check: undeclared solver as a receiver', () => one(DECL + 'X = B.solve()\n', 4, 5, /'B' is not a declared solver/));
test('static check: undeclared link as a receiver', () => one(DECL + 'search A:\n    on candidate M:\n        reject M with H.block(M)\n', 6, 23, /'H' is not a declared link/));
test('static check: solver as assignment target', () => one(DECL + 'A = 1\n', 4, 1, /'A' is a solver and cannot be assigned/));
test('static check: duplicate declaration', () => one(DECL + 'solver A = shared\n', 4, 8, /duplicate declaration of 'A'/));
test('static check: reserved name', () => {
  one('solver rt = shared\n', 1, 8, /'rt' is a reserved name/);
  one(DECL + 'end = 1\n', 4, 1, /'end' is a reserved name/);
  one(DECL + '__x = 1\n', 4, 1, /'__x' is a reserved name/);
});
test('static check: reject outside on candidate', () => one(DECL + 'M = A.solve()\nreject M with G.block(M)\n', 5, 1, /'reject' works only inside 'on candidate'/));
test('static check: reject naming another variable', () => one(DECL + 'search A:\n    on candidate M:\n        X = C.solve(assume G(M))\n        reject X with G.block(M)\n', 7, 16, /must name the candidate variable 'M'/));
test('static check: restart outside on candidate', () => one(DECL + 'loop:\n    restart\n', 5, 5, /'restart' works only inside 'on candidate'/));
test('static check: S.add inside on candidate of S', () => one(DECL + 'search A:\n    on candidate M:\n        A.add(G.block(M))\n', 6, 11, /A.add cannot be used inside 'on candidate' of A/));
test('static check: S.expand inside on candidate of S', () => one(DECL + 'search A:\n    on candidate M:\n        A.expand(refine, cex = M.atoms(color/2))\n', 6, 11, /A.expand cannot be used inside 'on candidate' of A/));
test('static check: nested search', () => one(DECL + 'search A:\n    on candidate M:\n        search C:\n            on candidate N:\n                stop\n', 6, 9, /'search' cannot be nested/));
test('static check: break and continue outside a loop', () => {
  one(DECL + 'break\n', 4, 1, /'break' outside a loop/);
  one(DECL + 'search A:\n    on candidate M:\n        continue\n', 6, 9, /'continue' outside a loop/);
});
test('static check: compound statement after a colon', () => one(DECL + 'loop: if true: stop\n', 4, 7, /compound statement \('if'\) cannot follow ':'/));
test('static check: inconsistent indentation and tabs', () => {
  one(DECL + 'loop:\n    x = 1\n  y = 2\n', 6, 3, /inconsistent indentation/);
  one(DECL + 'loop:\n\tx = 1\n', 5, 1, /tabs are not allowed/);
});
test('static check: unknown member lists the valid ones', () => {
  one(DECL + 'X = A.sovle()\n', 4, 7, /unknown member 'sovle' of solver A; valid: solve, models, add, expand, exhausted, step/);
  one(DECL + 'search A:\n    on candidate M:\n        reject M with G.clase(M)\n', 6, 25, /valid: clause, block, core, clauses/);
});
test('static check: several errors in one pass', () => {
  const es = errorsOf('solver A = nope\nsolver A = shared\nbreak\nrestart\n');
  assert.ok(es.length >= 4, JSON.stringify(es));
});
test('static check: declarations after statements; unknown names', () => {
  one(DECL + 'x = 1\nsolver B = shared\n', 5, 1, /declarations must come before/);
  one(DECL + 'x = y + 1\n', 4, 5, /unknown name 'y'/);
});
