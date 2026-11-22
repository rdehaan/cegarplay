// Phase I2: generators (docs/spec-instances.md section 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as H from './helpers.mjs';
import { generate, assembleGenerator, paramList } from '../js/generate.js';
import { validateGenerator } from '../js/driver.js';
import { resolveInstance } from '../js/instances.js';
import { load, template } from '../js/project.js';
import { GENERATORS } from '../tools/library.mjs';

const L = H.GEN_LUA;
const VECTORS = JSON.parse(H.read('test/draw-vectors.json'));
const HAVE_CLINGO = spawnSync('python3', ['-c', 'import clingo'], { encoding: 'utf8' }).status === 0;
const py = (code) => spawnSync('python3', ['-c', code], { cwd: H.path('tools/').pathname, encoding: 'utf8' });
const GNP = GENERATORS.arrowing.find((g) => g.name === 'gnp');

const ROW30 = [
  [0, 'edge(1,5). edge(1,6). edge(2,3). edge(2,4). edge(3,5). edge(3,6). edge(4,6). edge(4,7). edge(5,7).'],
  [2, 'edge(1,4). edge(1,6). edge(1,7). edge(2,6). edge(2,7). edge(3,6). edge(5,6). edge(5,7).'],
  [0, 'edge(1,2). edge(1,3). edge(1,4). edge(1,7). edge(2,3). edge(2,5). edge(4,6). edge(4,7). edge(5,6).'],
  [0, 'edge(1,3). edge(1,7). edge(2,3). edge(2,4). edge(2,7). edge(3,5). edge(3,7). edge(4,6). edge(5,6). edge(6,7).'],
  [0, 'edge(1,3). edge(1,4). edge(2,4). edge(3,4). edge(3,7). edge(4,5). edge(4,7). edge(5,6). edge(5,7).'],
];
const NODES7 = ' node(1). node(2). node(3). node(4). node(5). node(6). node(7).';

test('rows 26 and 30: gnp, n = 7, p = 300, seeds 1 to 5', async () => {
  const { results, problems } = await generate(GNP, { n: 7, p: 300 }, [1, 2, 3, 4, 5], L, H.engineRun);
  assert.deepEqual(problems, []);
  assert.deepEqual(results.map((r) => [r.attempt, r.facts]), ROW30.map(([a, e]) => [a, e + NODES7]));
  assert.ok(results.every((r) => r.exact === true));
});

test('the 200 test vectors agree in Lua (the engine)', async () => {
  const draw = L.draw.replace(/\n?return draw\s*$/, '');
  const lit = (v) => Array.isArray(v) ? `{ ${v.map(lit).join(', ')} }` : typeof v === 'string' ? JSON.stringify(v) : String(v);
  const lines = VECTORS.map((c) => `print(draw.call(${c.seed}, ${c.attempt}, ${JSON.stringify(c.fn)}, ${[...c.args, ...c.keys].map(lit).join(', ')}))`);
  const r = await H.run(`#script (lua)\n${draw}\nfunction main(prg)\n${lines.join('\n')}\nend\n#end.\n`, '');
  assert.equal(VECTORS.length, 200);
  assert.deepEqual(r.out.filter((l) => /^-?\d+$/.test(l)).map(Number), VECTORS.map((v) => v.value));
  assert.ok(new Set(VECTORS.map((v) => v.value)).size > 20, 'the vectors are not trivial');
});

test('the 200 test vectors agree in Python (tools/draw.py)', () => {
  const r = py(`import json
from draw import Draws
V = json.load(open('../test/draw-vectors.json'))
print(sum(getattr(Draws(v['seed'], v['attempt']), v['fn'])(*v['args'], *v['keys']) != v['value'] for v in V), len(V))`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '0 200');
});

const shuffle = (text, seed) => {
  const rules = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('%'));
  let s = seed;
  for (let i = rules.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [rules[i], rules[j]] = [rules[j], rules[i]]; }
  return rules.join('\n') + '\n';
};
const ALL_GENERATORS = [...new Map(Object.values(GENERATORS).flat().map((g) => [g.name + g.text, g])).values()];

test('every library generator: identical facts after its rules are shuffled', async () => {
  for (const g of ALL_GENERATORS) {
    const a = await generate(g, {}, [1, 2, 3], L, H.engineRun);
    assert.deepEqual(a.problems, [], g.name);
    assert.equal(a.results.length, 3, g.name);
    assert.ok(a.results.every((r) => r.facts && !r.error), `${g.name}: ${JSON.stringify(a.results[0])}`);
    for (const k of [7, 8]) {
      const b = await generate({ ...g, text: shuffle(g.text, k) }, {}, [1, 2, 3], L, H.engineRun);
      assert.deepEqual(b.results.map((r) => r.facts), a.results.map((r) => r.facts), `${g.name}, shuffle ${k}`);
    }
  }
});

test('engine and Python twin give the same facts for every library generator', { skip: !HAVE_CLINGO && 'Python clingo missing' }, async () => {
  for (const g of ALL_GENERATORS) {
    const a = await generate(g, {}, [1, 2], L, H.engineRun);
    const r = py(`import json, sys
from draw import generate
g = json.loads(sys.argv[1]) if False else json.loads(${JSON.stringify(JSON.stringify(g))})
print(json.dumps([generate(g['text'], g['defaults'], s) for s in (1, 2)]))`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).map((x) => [x.facts, x.attempt, x.exact]), a.results.map((x) => [x.facts, x.attempt, x.exact]), g.name);
  }
});

test('@flip(a, 1) ends with an error event, not a trap', async () => {
  const r = await generate({ name: 'bad', params: {}, text: 'p(@flip(a, 1)).\n#show p/1.\n' }, {}, [1], L, H.engineRun);
  assert.equal(r.results.length, 1);
  assert.match(r.results[0].error, /@flip: the probability must be an integer, got a/);
  for (const t of ['p(@perm(3, 9, k)).', 'p(@int(5, 1, k)).', 'p(@weighted(3, k)).', 'p(@mallows(4, 2000, 1, k)).']) {
    const x = await generate({ name: 'bad', params: {}, text: t }, {}, [1], L, H.engineRun);
    assert.ok(x.results[0] && x.results[0].error, `${t}: ${JSON.stringify(x)}`);
  }
});

test('validateGenerator: syntax errors and unsafe variables with the line of the generator', async () => {
  assert.deepEqual(await validateGenerator(GNP, H.engineRun, ['n=7', 'p=300']), []);
  const e = await validateGenerator({ text: 'node(1..3).\na(X) :- b.\n' }, H.engineRun);
  assert.equal(e[0].line, 2);
  const s = await validateGenerator({ text: 'node(1..3).\n\np(.\n' }, H.engineRun);
  assert.equal(s[0].line, 3);
  const r = await generate({ name: 'x', params: {}, text: 'p(.' }, {}, [1], L, H.engineRun);
  assert.equal(r.results.length, 0);
  assert.equal(r.problems[0].line, 1);
});

test('parameters: types, defaults, unknown names', () => {
  assert.deepEqual(paramList(GNP, {}).list, ['n=7', 'p=300']);
  assert.match(paramList(GNP, { p: 1200 }).problems[0], /permille/);
  assert.match(paramList(GNP, { q: 1 }).problems[0], /unknown parameter q/);
  assert.throws(() => assembleGenerator(GNP, { n: 'x' }, 1, L));
  assert.throws(() => load({ format: 'cegarplay', fragments: [], generators: [{ name: 'g', text: '', params: { n: 'float' } }] }), /int or permille/);
});

test('qbf with a qbf-dnf recipe: the same count in its own loop and in the Reference template', async () => {
  const p = load(H.example('qbf'));
  assert.ok(p.instances.find((x) => x.id === 'dnf-1' && x.recipe && x.facts === undefined));
  const x = await resolveInstance(p, 'dnf-1', H.engineRun, L);
  assert.ok(x.facts.includes('xlit('));
  const sols = { ...p.settings, solutions: 0, seconds: 0 };
  const own = await H.runProject({ ...p, settings: sols }, { instance: 'dnf-1' });
  const ref = await H.runProject({ ...p, settings: sols, loop: { language: 'loop', text: template('reference') } }, { instance: 'dnf-1' });
  const n = (r) => H.finalStats(r).solutions;
  assert.equal(H.done(own).outcome, 'finished');
  assert.equal(n(own), n(ref));
  console.log(`# qbf dnf-1: ${n(own)} solutions in both loops`);
});

test('cegarcheck.py --instance with a recipe gives the same count', { skip: !HAVE_CLINGO && 'Python clingo missing' }, async () => {
  const p = load(H.example('qbf'));
  const own = await H.runProject({ ...p, settings: { ...p.settings, solutions: 0, seconds: 0 } }, { instance: 'dnf-1' });
  const r = spawnSync('python3', [H.path('tools/cegarcheck.py').pathname, H.path('examples/qbf.json').pathname, '--instance', 'dnf-1', '--solutions', 'all'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Solutions: ${H.finalStats(own).solutions};`));
});
