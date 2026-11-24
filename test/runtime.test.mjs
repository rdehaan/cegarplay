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

test('a check without relevant/1 rules: the empty clause ends the search, no error', async () => {
  const f = H.GC6();
  f.check = f.check.replace(/^relevant.*$/gm, '');
  const r = await H.runLua(H.projectOf(f, { solutions: 0 }), H.LUA.shape1(LEG));
  endsWithOneD(r);
  assert.equal(H.ofKind(r, 'E').length, 0);
  assert.equal(H.done(r).outcome, 'finished');
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

test('a clingo location over two lines is mapped at both ends', async () => {
  const p = await H.example('graph-coloring');
  const f = p.fragments.find((x) => x.name === 'abstraction');
  f.text = '% one\n% two\np(X) :- q(X,\n   X).\n' + f.text;
  const r = await H.runProject(p);
  const w = r.events.filter((e) => e.kind === 'W').map((e) => e.data).find((d) => /q\(X,X\)/.test(d.message));
  assert.ok(w, 'warning about q/2');
  assert.match(w.message, /^abstraction:3:\d+-4:\d+: info: /);
});

// TODO review, group A: candidates, captures and assumptions in loop scripts.
import { mapLine } from '../js/driver.js';
const FIRST = H.example('tutorial-first-run');
const DECLS = FIRST.loop.text.split('\n').slice(0, 4).join('\n') + '\n';
const withLoop = (text, settings = {}) => ({ ...FIRST, loop: { language: 'loop', text: DECLS + text }, settings: { ...FIRST.settings, ...settings } });

test('A1: a stored candidate is no longer valid after its step', async () => {
  const src = `saved = []
n = 0
search A:
    on candidate M:
        n = n + 1
        if n <= 3:
            saved.push(M)
            log "live", G.block(M)
        if n > 6: restart
for M in saved:
    log "stale", G.block(M)
`;
  const r = await H.runProject(withLoop(src));
  assert.equal(H.ofKind(r, 'L').length, 3);
  assert.equal(H.done(r).outcome, 'error');
  const e = H.last(r, 'E');
  assert.equal(e.message, 'G.block: the candidate is no longer valid (it belongs to an earlier step); store G(M) or a counterexample instead');
  assert.equal(mapLine(r.assembled, e.line), 4 + 11);
});

test('A1: a stored G(M) keeps the values of its own candidate', async () => {
  const src = `saved = []
search A:
    on candidate M:
        if saved.size < 3:
            saved.push(G(M))
            log G(M)
for a in saved:
    log a
`;
  const r = await H.runProject(withLoop(src));
  const ls = H.ofKind(r, 'L').map((l) => l.text);
  assert.equal(ls.length, 6);
  assert.equal(new Set(ls.slice(0, 3)).size, 3);
  assert.deepEqual(ls.slice(3), ls.slice(0, 3));
});

test('A2: M.atoms(p/n) on a candidate inside search', async () => {
  const r = await H.runProject(withLoop('n = 0\nsearch A:\n    on candidate M:\n        log M.atoms(pick/1)\n        n = n + 1\n        if n >= 5: stop\n'));
  assert.notEqual(H.done(r).outcome, 'error', JSON.stringify(H.last(r, 'E')));
  const ls = H.ofKind(r, 'L').map((l) => l.text);
  assert.equal(ls.length, 5);
  for (const t of ls) assert.match(t, /^\[(pick\(\d+\)(, pick\(\d+\))*)?\]$/);
  assert.ok(ls.some((t) => t !== '[]'));
});

test('A2: M.atoms(p/n) of a candidate agrees with the solution it becomes', async () => {
  const r = await H.runProject(withLoop(`search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
        else:
            log M.atoms(pick/1)
`, { solutions: 3 }));
  const logs = H.ofKind(r, 'L').map((l) => l.text);
  const sols = H.ofKind(r, 'M').map((m) => m.atoms.split(' ').filter((a) => a.startsWith('pick(')).sort().join(', '));
  assert.equal(logs.length, 3);
  assert.deepEqual(logs.map((l) => l.slice(1, -1).split(', ').filter(Boolean).sort().join(', ')), sols);
});

test('A3: G(M) given to the source of G means the same values (phase L1; it was an error before)', async () => {
  const r = await H.runProject(withLoop('M = A.solve()\nX = A.solve(assume G(M))\nif X.atoms(pick/1).size == M.atoms(pick/1).size: log "same"\n'));
  assert.equal(H.done(r).outcome, 'finished', JSON.stringify(H.ofKind(r, 'E')));
  assert.deepEqual(H.ofKind(r, 'L').map((l) => l.text), ['same']);
});

test('A4: the time limit ends a loop without solver calls', async () => {
  const r = await H.runProject(withLoop('loop:\n    x = 1\n', { seconds: 1 }));
  assert.equal(H.done(r).outcome, 'limit');
});

test('accepted solutions are blocked by one clause over all outgoing links (two links, restarts)', async () => {
  // A has two outgoing links with different atoms and no candidate is ever rejected: all 16
  // assignments are solutions. A restart every third candidate makes later searches depend on
  // the queued blocks; a block per link would ask for a difference on each link (6 solutions).
  const project = {
    format: 'cegarplay', version: 1, title: 'two links',
    fragments: [
      { name: 'shared', text: 'i(1..2).\n' },
      { name: 'abstraction', text: '{ p(I) : i(I) }.\n{ q(I) : i(I) }.\n#show p/1.\n#show q/1.\n' },
      { name: 'gluep', text: 'glue(p(I)) :- i(I).\n' },
      { name: 'glueq', text: 'glue(q(I)) :- i(I).\n' },
      { name: 'never', text: ':- not impossible.\n' },
    ],
    loop: { language: 'loop', text: [
      'solver A = shared + abstraction', 'solver C1 = shared + never', 'solver C2 = shared + never',
      'link G1 = A -> C1 via shared + gluep', 'link G2 = A -> C2 via shared + glueq', '',
      'n = []', 'repeat:', '    search A:', '        on candidate M:', '            n.push(1)',
      '            if n.size >= 3:', '                n.clear()', '                restart', 'until A.exhausted', ''].join('\n') },
    settings: { solutions: 0, seconds: 30 },
  };
  const r = await H.runProject(project);
  endsWithOneD(r);
  assert.equal(H.finalStats(r).solutions, 16);
  assert.equal(new Set(H.ofKind(r, 'M').map((m) => m.atoms)).size, 16);
  assert.deepEqual(H.done(r), { outcome: 'finished', exhausted: true, detail: '' });
});

test('settings.randomize: random decisions and signs; a full enumeration still finds every solution', async () => {
  const P = await import('../js/project.js');
  const p = await H.example('tutorial-first-run');
  assert.equal(P.load({ ...p, settings: { ...p.settings, randomize: false } }).settings.randomize, undefined);
  assert.equal(P.load({ ...p, settings: { ...p.settings, randomize: true } }).settings.randomize, true);
  p.settings = { ...p.settings, solutions: 0, randomize: true };
  const counts = [];
  for (const seed of [1, 2, 3]) {
    p.settings.seed = seed;
    const r = await H.runProject(p);
    assert.equal(H.done(r).outcome, 'finished');
    assert.match(r.assembled.program, /randomize = true/);
    counts.push(H.ofKind(r, 'S').at(-1).solutions);
  }
  assert.deepEqual(counts, [61, 61, 61]);
});
