// Phase L4: procedures and solver families, and the coverage
// of the 18 loop families.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';
import { compile } from '../js/compiler.js';

const ex = (id) => load(H.read(`examples/${id}.json`));
const all = (p, extra = {}) => ({ ...p, settings: { ...p.settings, solutions: 0, seconds: 0, trace: 0, ...extra } });

// a deterministic generator for test formulas
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 2 ** 32; }; }
function formula(depth, r) {
  const blocks = []; let v = 1;
  for (let b = 0; b < depth; b++) { const n = 2 + Math.floor(r() * 2); blocks.push(Array.from({ length: n }, () => v++)); }
  const nv = v - 1;
  const clauses = Array.from({ length: 4 + Math.floor(r() * (2 * depth + 1)) }, () =>
    Array.from({ length: 2 + Math.floor(r() * 2) }, () => [1 + Math.floor(r() * nv), Math.floor(r() * 2)]));
  return { blocks, clauses };
}
function brute({ blocks, clauses }) {
  const depth = blocks.length;
  const holds = (a) => clauses.every((c) => c.some(([v, s]) => a[v] === !!s));
  function win(i, a) {
    if (i > depth) return holds(a);
    const vs = blocks[i - 1];
    for (let m = 0; m < 1 << vs.length; m++) {
      const b = { ...a };
      vs.forEach((v, k) => { b[v] = !!((m >> k) & 1); });
      const res = win(i + 1, b);
      if (i % 2 === 1 && res) return true;
      if (i % 2 === 0 && !res) return false;
    }
    return i % 2 === 0;
  }
  const sols = [];
  const vs = blocks[0];
  for (let m = 0; m < 1 << vs.length; m++) {
    const a = {};
    vs.forEach((v, k) => { a[v] = !!((m >> k) & 1); });
    if (win(2, a)) sols.push(vs.filter((v) => a[v]).map((v) => `val(${v})`).sort().join(' '));
  }
  return sols.sort();
}
function project({ blocks, clauses }) {
  const p = ex('qbf-deep');
  let facts = blocks.flatMap((vs, b) => vs.map((v) => `var(${v},${b + 1}).`)).join(' ');
  clauses.forEach((c, k) => { facts += `\nclause(${k + 1}). ` + c.map(([v, s]) => `lit(${k + 1},${v},${s}).`).join(' '); });
  p.fragments.find((f) => f.name === 'shared').text = facts + '\n';
  p.instances = [];          // the formula above replaces the instance 'example'
  return all(p, { constants: { depth: String(blocks.length) } });
}

test('G7: one script (a solver family, a link family, a recursive def) solves QBFs at depths 2, 3 and 4 like brute force', async () => {
  const r = rng(2026);
  let nontrivial = 0;
  for (const depth of [2, 3, 4]) {
    for (let k = 0; k < 40; k++) {
      const f = formula(depth, r);
      const want = brute(f);
      if (want.length && want.length < 2 ** f.blocks[0].length) nontrivial++;
      const run = await H.runProject(project(f));
      assert.equal(H.done(run).outcome, 'finished', `depth ${depth}, #${k}: ${JSON.stringify(H.ofKind(run, 'E'))}`);
      const got = H.ofKind(run, 'M').map((m) => m.atoms.split(' ').filter(Boolean).sort().join(' ')).sort();
      assert.deepEqual(got, want, `depth ${depth}, formula ${JSON.stringify(f)}`);
    }
  }
  console.log(`# qbf-deep: 120 formulas at depths 2 to 4 agree with brute force (${nontrivial} non-trivial)`);
  assert.ok(nontrivial >= 5);
});

test('static errors of phase L4', () => {
  const FR = { fragments: ['a', 'b', 'c'] };
  const D = 'solver S[i in 1..3] = a\nlink G[i in 1..2] = S[i] -> S[i+1] via c\nsolver P = b\n';
  const ok = compile(D + 'def f(x):\n    return x + 1\nlog f(1)\nY = S[2].solve(assume G[1](S[1].solve()))\nlog S.size\n', FR);
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.match(ok.lua, /local S = \{\}; for i = 1, 3 do S\[i\] = rt\.solver\("S" \.\. i, \{"a"\}, \{"-c", "level=" \.\. i\}\) end/);
  assert.match(ok.lua, /local function f\(x\)/);
  assert.match(ok.lua, /S\[2\]:solve\{ assume = G\[1\]:of\(S\[1\]:solve\{\}\) \}/);
  const one = (src, re) => { const c = compile(D + src, FR); assert.ok(c.errors.some((e) => re.test(e.message)), `${src}: ${JSON.stringify(c.errors)}`); };
  one('return 1\n', /'return' outside 'def'/);
  one('log 1\ndef f():\n    return 1\n', /'def' must come before the first statement/);
  one('P[1].solve()\n', /'P' is not a solver family/);
  one('S.solve()\n', /'S' is a solver family: write S\[i\]/);
  const bad = compile('solver S[i in 1..n + x()] = a\n', FR);
  assert.ok(bad.errors.length);
});

// The 18 loop families of the generality study (PLAN2, in the git history), each with a fast example or script.
const FAMILIES = [
  ['Clause learning for exists-forall problems', 'qbf', 5],
  ['Expansion and CEGIS', 'qbf-expansion', 5],
  ['Core-guided refinement after a failed witness check', 'lang-core', null],
  ['Lazy constraints written in ASP', 'lang-clauses', null],
  ['Staged checks', 'lang-two-stage', null],
  ['Refinement computed by a separate solver', 'lang-second-solver', null],
  ['Smallest-first optimisation by re-solving', 'knapsack-optimum', 2],
  ['Three-level nested loops', 'qbf-three-blocks', 4],
  ['No candidate can be a solution (the empty clause)', 'qbf', 5],
  ['Minimal-set loops that block all supersets', 'reasons-by-size', 4],
  ['Optimisation inside one search', null, null],
  ['Shrinking by dropping assumptions', 'reasons-by-shrinking', 4],
  ['Bound tightening that reads numbers from models', 'knapsack-bounds', 2],
  ['Recursive loops for any quantifier depth', 'qbf-deep', null],
  ['An inner search, or a search under assumptions', 'qbf-three-blocks', 4],
  ['Checks on partial candidates', 'skip', null],
  ['Retractable lemmas, frames, growing horizons', 'conformant-growing', 3],
  ['Lemmas for a solver that is not the link source', 'qbf-deep', null],
];

test('coverage: every one of the 18 loop families runs as a loop script (one family is not built: partial checks)', async () => {
  assert.equal(FAMILIES.length, 18);
  for (const [family, id, want] of FAMILIES) {
    if (id === 'skip') continue;                               // G5 is not built (docs/history.md, L2)
    if (id === null) {
      // optimisation inside one search: search A optimal (G8)
      const p = ex('knapsack-interdiction');
      p.fragments.find((f) => f.name === 'abstraction').text += '\n#minimize { 1,I : lock(I) }.\n';
      p.loop.text = p.loop.text.replace('search A:', 'search A optimal:');
      const r = await H.runProject(all(p));
      assert.deepEqual(H.ofKind(r, 'M').map((m) => m.atoms), ['lock(3) lock(4)'], family);
      continue;
    }
    const p = ex(id);
    assert.equal(p.loop.language, 'loop', `${family}: ${id} is a loop script`);
    const r = await H.runProject(all(p));
    assert.equal(H.done(r).outcome, 'finished', `${family}: ${id}: ${JSON.stringify(H.ofKind(r, 'E'))}`);
    if (want !== null) assert.equal(H.finalStats(r).solutions, want, `${family}: ${id}`);
  }
});

test('final review: return inside on candidate is an error; S.size for a family that does not start at 1', async () => {
  const FR = { fragments: ['a', 'b', 'c'] };
  const D = 'solver S[i in 2..4] = a\nsolver P = b\nlink G = P -> S[2] via c\n';
  const c = compile(D + 'def first():\n    search P:\n        on candidate M:\n            return 7\n    return 0\nlog first()\n', FR);
  assert.ok(c.errors.some((e) => /'return' cannot stand inside 'on candidate'/.test(e.message)), JSON.stringify(c.errors));
  const ok = compile(D + 'log S.size\n', FR);
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.match(ok.lua, /S\.size = math\.max\(0, 4 - 2 \+ 1\)/);
  assert.match(ok.lua, /log\(S\.size\)|S\.size/);
});
