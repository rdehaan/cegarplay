// Reference numbers for the spike.  node test/run.mjs [--slow]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import factory from '../node_modules/clingo-wasm/dist/clingo.js';   // not in the package's exports map, so by path
import { assemble, fragmentsFrom } from '../js/assemble.mjs';
import { splitParts, buildProgram } from '../js/port.mjs';
import * as S from '../js/shapes.mjs';

async function exec(program, opts = '--outf=3') {
  const out = [], err = [];
  const m = await factory({ print: (l) => out.push(l), printErr: (l) => err.push(l) });   // fresh instance per run
  const t0 = performance.now(); let status;
  try { status = m.ccall('run', 'number', ['string', 'string'], [program, opts]); } catch (e) { status = 'TRAP ' + e; }
  return { status, ms: Math.round(performance.now() - t0), out, err };
}
const num = (r, kind, name, key) => { const l = r.out.find((x) => x.startsWith('@@' + kind + ' ' + name)); const m = l && l.match(new RegExp('\\b' + key + '=([0-9.]+)')); return m ? Number(m[1]) : undefined; };
const sol = (r) => Number(r.out.find((x) => x.startsWith('@@R')).match(/solutions=(\d+)/)[1]);
const slow = process.argv.includes('--slow');
const gc6file = new URL('../examples/graph-coloring-n6.lp', import.meta.url);
const f6 = fragmentsFrom(gc6file), flags = { GLUE_UNWRAPPED: 'true' };
const fx = { ...f6, abstraction: f6.abstraction + S.REFINE_PART };
const FIX = '\nrelevant(leaf_color(N,C)) :- node(N), not leaf(N), color(C), not color(N,C).\n';
let n = 0;
async function test(name, fn) { const t0 = performance.now(); await fn(); n++; console.log(`ok  ${name}  (${Math.round(performance.now() - t0)} ms)`); }

await test('direct port of cegar.py: 9270 models, 16577 checks, 7307 refinements', async () => {
  const r = await exec(buildProgram(splitParts(fs.readFileSync(gc6file, 'utf8')), { glueWrapped: false }), '-Wnone 0 -q --stats');
  assert.ok(r.out.includes('CEGAR-STATS check_calls=16577 refinements=7307 clause_len=55007'));
  assert.ok(r.out.some((l) => /^Models\s+: 9270$/.test(l)));
  assert.ok(r.out.some((l) => /^Choices\s+: 25512/.test(l)) && r.out.some((l) => /^Conflicts\s+: 7499/.test(l)));
});
await test('runtime, shape 1 (compat): same numbers', async () => {
  const r = await exec(assemble({ fragments: f6, loop: S.LAZY(true), flags }));
  assert.equal(sol(r), 9270); assert.equal(num(r, 'S', 'C', 'calls'), 16577); assert.equal(num(r, 'S', 'A', 'clauses'), 7307);
  assert.equal(num(r, 'S', 'A', 'choices'), 25512); assert.equal(num(r, 'S', 'A', 'conflicts'), 7499);
});
await test('runtime, shape 1 with the added relevant/1 rule: 10698 (brute-force count)', async () => {
  const r = await exec(assemble({ fragments: { ...f6, check: f6.check + FIX }, loop: S.LAZY(false), flags }));
  assert.equal(sol(r), 10698);
});
await test('runtime, shape 4 (search, ground rules in batches of 20): 10698', async () => {
  const r = await exec(assemble({ fragments: fx, loop: S.HYBRID_EXPAND(20), flags }));
  assert.equal(sol(r), 10698);
});
await test('explain1.lp, shape 1 (compat), first solution: 9 checks, 8 refinements', async () => {
  const fe = fragmentsFrom(new URL('../examples/explain1.lp', import.meta.url));
  const r = await exec(assemble({ fragments: fe, loop: S.LAZY(true).replace('{"0"}', '{}') }));
  assert.equal(sol(r), 1); assert.equal(num(r, 'S', 'C', 'calls'), 9); assert.equal(num(r, 'S', 'A', 'clauses'), 8);
  assert.equal(num(r, 'S', 'A', 'choices'), 10269); assert.equal(num(r, 'S', 'A', 'conflicts'), 822);
});
await test('validation: a never-grounded part is parsed and safety-checked', async () => {
  let r = await exec('#program validate__.\np :- q\nr.\n', '--mode=gringo -Wnone');
  assert.equal(r.status, 65); assert.ok(r.err.join('\n').includes('-:3:1-2: error: syntax error'));
  r = await exec('#program validate__.\np(X) :- q.\n', '--mode=gringo -Wnone');
  assert.equal(r.status, 65); assert.ok(r.err.join('\n').includes("'X' is unsafe"));
  r = await exec('#program validate__.\np(X) :- q(X).\n#program refine(t).\n:- p(t).\n', '--mode=gringo -Wnone');
  assert.equal(r.status, 0);
});
await test('a script error is reported as an E event, not a trap', async () => {
  const r = await exec(assemble({ fragments: f6, loop: S.DECL('', false) + '\n    rt.prepare()\n    local X = Q:solve()\n', flags }));
  assert.equal(r.status, 0); assert.ok(r.out.some((l) => l.startsWith('@@E') && l.includes("global 'Q'")));
});
await test('known limitation: an uncaught Lua error traps the instance', async () => {
  const r = await exec('#script (lua)\nfunction main(prg) error("boom") end\n#end.\n');
  assert.ok(String(r.status).startsWith('TRAP'));
});
await test("optimisation in the abstraction, shape 1: #maximize over edges ends at 15 (brute-force optimum)", async () => {
  const MAX = "\n#maximize { 1,X,Y : edge(X,Y), X < Y }.\n";
  const loop = S.LAZY(false).replace("rt.prepare()", "rt.want_shown = true\n    rt.prepare()");
  const r = await exec(assemble({ fragments: { ...f6, abstraction: f6.abstraction + MAX, check: f6.check + FIX }, loop, flags }));
  const ms = r.out.filter((l) => l.startsWith("@@M"));
  const edges = (l) => (l.match(/edge\((\d+),(\d+)\)/g) || []).filter((e) => { const [a, b] = e.match(/\d+/g).map(Number); return a < b; }).length;
  assert.equal(ms.length, 9); assert.equal(edges(ms.at(-1)), 15);
});
if (slow) {
  await test('runtime, shape 2 (solve and re-solve, clauses)', async () => { const r = await exec(assemble({ fragments: f6, loop: S.EAGER_CLAUSE, flags })); assert.ok(sol(r) > 9000 && sol(r) < 10698); });
  await test('runtime, shape 3 (ground rules per counterexample): 10698', async () => { const r = await exec(assemble({ fragments: fx, loop: S.EAGER_EXPAND, flags })); assert.equal(sol(r), 10698); });
}
console.log(`\n${n} tests passed`);
