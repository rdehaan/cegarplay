// Phase I1: instances and variants (docs/directions/instance-lab.md, docs/spec-instances.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as H from './helpers.mjs';
import * as P from '../js/project.js';
import * as I from '../js/instances.js';
import { validate } from '../js/driver.js';

const lib = JSON.parse(H.read('examples/library.json'));
const tool = H.path('tools/run.mjs').pathname;

test('format: version 1 without new keys, version 2 with instances; the name "instance" is reserved', () => {
  const p = P.newProject();
  assert.equal(JSON.parse(P.save(p)).version, 1);
  p.instances = [];
  assert.equal(JSON.parse(P.save(p)).version, 1);
  assert.equal('instances' in JSON.parse(P.save(p)), false);
  p.instances = [{ id: 'a', facts: 'x.' }];
  const q = P.load(P.save(p));
  assert.equal(q.version, 2);
  assert.deepEqual(q.instances, [{ id: 'a', facts: 'x.', constants: {}, tags: [] }]);
  assert.throws(() => P.load({ format: 'cegarplay', version: 3, fragments: [] }), /newer/);
  // an older fragment named "instance" is renamed, with its uses in the declarations
  const old = P.load({ format: 'cegarplay', fragments: [{ name: 'instance', text: 'a.' }], loop: { text: 'solver A = instance\nloop:\n    stop' } });
  assert.deepEqual(old.fragments.map((f) => f.name), ['instance_facts']);
  assert.match(old.loop.text, /^solver A = instance_facts$/m);
  assert.throws(() => P.load({ format: 'cegarplay', fragments: [], instances: [{ id: 'a b' }] }), /id must match/);
  assert.throws(() => P.load({ format: 'cegarplay', fragments: [], instances: [{ id: 'a' }, { id: 'a' }] }), /duplicate/);
  assert.throws(() => P.load({ format: 'cegarplay', fragments: [], instances: [{ id: 'a', expected: { solutions: -1 } }] }), /whole number/);
  assert.throws(() => P.load({ format: 'cegarplay', fragments: [{ name: 'a' }], variants: [{ name: 'v', swap: { a: 'b' } }] }), /unknown fragment/);
});

test('applyInstance and applyVariant return new plain projects', () => {
  const p = P.load({ format: 'cegarplay', fragments: [{ name: 'shared', text: 's.' }, { name: 'check', text: 'c.' }, { name: 'check_block', text: 'b.' }],
    settings: { constants: { n: '3', k: '1' } },
    instances: [{ id: 'one', facts: 'f(1).', constants: { n: '5' } }, { id: 'two', facts: 'f(2).' }],
    variants: [{ name: 'ref', swap: { check: 'check_block' }, loop: 'stop', constants: { k: '2' } }] });
  const a = P.applyInstance(p);
  assert.equal(a.instance, 'one');
  assert.deepEqual(a.fragments[0], { name: 'instance', text: 'f(1).' });
  assert.deepEqual(a.settings.constants, { n: '5', k: '1' });
  assert.equal(p.fragments.length, 3, 'the stored project is not touched');
  assert.equal(P.applyInstance(p, 'two').fragments[0].text, 'f(2).');
  assert.throws(() => P.applyInstance(p, 'three'), /no instance named/);
  p.settings.instance = 'gone';
  assert.equal(P.derive(p).instance, 'one', 'a stale settings.instance falls back to the first');
  const r = P.load({ format: 'cegarplay', fragments: [], instances: [{ id: 'g', recipe: { generator: 'x' } }] });
  assert.equal('facts' in r.instances[0], false);
  assert.throws(() => P.applyInstance(r, 'g'), /not generated yet/);
  p.settings.instance = 'two';
  assert.equal(P.derive(p).instance, 'two');
  p.settings.instance = '';
  assert.equal(P.derive(p).instance, undefined);
  const v = P.derive(p, { variant: 'ref', instance: 'one' });
  assert.equal(v.fragments.find((f) => f.name === 'check').text, 'b.');
  assert.equal(v.loop.text, 'stop');
  assert.deepEqual(v.settings.constants, { n: '5', k: '2' });
});

test('importers: .lp, DIMACS graph, QDIMACS, and the later formats', () => {
  assert.equal(I.fromFacts('a(1).\r\nb.').facts, 'a(1).\nb.\n');
  assert.equal(I.fromDimacsGraph('c a triangle\np edge 3 3\ne 1 2\ne 2 3\ne 1 3\n').facts,
    'node(1..3).\nedge(1,2).\nedge(2,3).\nedge(1,3).\n');
  assert.equal(I.fromDimacsGraph('p edge 2 1\ne 1 2\n', { node: 'vertex' }).facts, 'vertex(1..2).\nedge(1,2).\n');
  assert.throws(() => I.fromDimacsGraph('e 1 2\n'), /before the "p" line/);
  assert.equal(I.fromQdimacs('p cnf 3 2\ne 1 0\na 2 3 0\n1 -2 0\n-1 3 0\n').facts,
    'qblock(1,e).\nqvar(1,1).\nqblock(2,a).\nqvar(2,2).\nqvar(3,2).\nclause(1).\nqlit(1,1,1).\nqlit(1,2,0).\nclause(2).\nqlit(2,1,0).\nqlit(2,3,1).\n');
  assert.throws(() => I.fromQdimacs('p cnf 1 1\n1 2 0\n'), /bad literal/);
  assert.equal(I.fromApx('arg(a).\narg(b).\natt(a,b).\n').facts, 'arg(a).\narg(b).\natt(a,b).\n');
  assert.equal(I.fromTgf('1\n2\n#\n1 2\n').facts, 'arg(1).\narg(2).\natt(1,2).\n');
  assert.equal(I.fromPreflib('# FILE NAME: x\n2: 1,2,3\n1: 3,2,1\n').facts,
    'ballot(1,(c1,c2,c3)).\nballot(2,(c1,c2,c3)).\nballot(3,(c3,c2,c1)).\n');
  assert.equal(I.fromJagg('[variables]\np, q\n[clauses]\np -q\n').facts, 'var(p).\nvar(q).\ncl(1).\npos(1,p).\nneg(1,q).\n');
  assert.equal(I.importerFor('x.col'), 'col');
  assert.equal(I.freshId({ instances: [{ id: 'g' }] }, 'g.col'), 'g-2');
});

test('checkFacts and checkSchema', async () => {
  assert.deepEqual(await I.checkFacts('a(1).', H.engineRun), []);
  const bad = await I.checkFacts('a(1).\nb(', H.engineRun);
  assert.equal(bad[0].line, 3);
  const p = P.load({ format: 'cegarplay', fragments: [{ name: 'schema', text: ':- edge(X,Y), not node(X).' }],
    instances: [{ id: 'ok', facts: 'node(1). edge(1,1).' }, { id: 'bad', facts: 'edge(2,1).' }] });
  assert.equal((await I.checkSchema(p, 'ok', H.engineRun)).ok, true);
  assert.equal((await I.checkSchema(p, 'bad', H.engineRun)).ok, false);
});

test('a clingo message about an instance fact names instance:<line> in the W event', async () => {
  const p = H.example('af-preferred');
  p.instances[0].facts += '\nfoo(X) :- bar(X).\n';
  const r = await H.runProject(p);
  const w = H.ofKind(r, 'W').find((x) => /bar/.test(x.message));
  assert.ok(w, 'a warning about bar/1');
  assert.equal(w.fragment, 'instance');
  assert.match(w.message, /^instance:\d+:/);
});

test('validation covers the instance facts', async () => {
  const p = P.derive(P.load(H.read('examples/af-preferred.json')));
  p.fragments[0].text += '\narg(';
  const problems = await validate(p, H.engineRun);
  assert.ok(problems.some((x) => x.where.kind === 'fragment' && x.where.name === 'instance'), JSON.stringify(problems));
});

test('af-preferred gives 3 solutions with its facts in an instance; run.mjs --instance all', () => {
  const r = spawnSync('node', [tool, 'af-preferred', '--quiet']);
  assert.match(r.stdout.toString(), /Solutions: 3;/);
  const all = spawnSync('node', [tool, 'graph-coloring', '--instance', 'all']);
  const lines = all.stdout.toString().trim().split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^n3: 0 solutions.*as expected/);
  assert.match(lines[2], /^n5: 101 solutions.*as expected/);
  assert.match(lines[3], /^n6: 10698 solutions.*as expected/);
  assert.equal(all.status, 0);
  const one = spawnSync('node', [tool, 'graph-coloring', '--instance', 'n4', '--quiet']);
  assert.match(one.stdout.toString(), /Solutions: 1;/);
  assert.equal(spawnSync('node', [tool, 'graph-coloring', '--instance', 'nope']).status, 2);
});

test('expected.optimum: validated, and checked on finished runs without needing exhaustion', () => {
  const inst = (expected) => ({ format: 'cegarplay', fragments: [], instances: [{ id: 'a', expected }] });
  assert.doesNotThrow(() => P.load(inst({ solutions: null, optimum: 8 })));
  assert.doesNotThrow(() => P.load(inst({ solutions: 2, optimum: [1, -3] })));
  for (const bad of [1.5, 'x', [], [1, 'a']]) assert.throws(() => P.load(inst({ optimum: bad })), /expected\.optimum must be/);
  const t = P.costTracker(); t.add([8]); t.add([8]);
  const run = (o) => ({ outcome: 'finished', exhausted: false, solutions: 2, cost: t.cost, same: t.same, ...o });
  assert.deepEqual(P.expectedCheck({ optimum: 8 }, run({})), { checked: true, ok: true, want: 'optimum 8' });
  assert.equal(P.expectedCheck({ optimum: 7 }, run({})).ok, false);
  assert.equal(P.expectedCheck({ optimum: 8 }, run({ same: false })).ok, false, 'solutions of different cost');
  assert.equal(P.expectedCheck({ optimum: 8 }, run({ solutions: 0, cost: null })).ok, false, 'no solution');
  assert.equal(P.expectedCheck({ optimum: 8 }, run({ outcome: 'limit' })).checked, false, 'a run cut short says nothing');
  // a count still needs an exhausted run; together, both must hold
  assert.equal(P.expectedCheck({ solutions: 2, optimum: 8 }, run({})).checked, true);
  assert.equal(P.expectedCheck({ solutions: 3, optimum: 8 }, run({})).ok, true, 'count not checked: not exhausted');
  assert.equal(P.expectedCheck({ solutions: 3, optimum: 8 }, run({ exhausted: true })).ok, false);
});

test('three library examples carry three or more instances with expected counts', () => {
  const many = lib.examples.map((e) => P.load(H.read(`examples/${e.id}.json`)))
    .filter((p) => (p.instances || []).filter((x) => x.expected && Number.isInteger(x.expected.solutions)).length >= 3);
  assert.ok(many.length >= 3, `only ${many.length}`);
});

// an exercise's starter is meant to miss its expected counts (test/exercise.test.mjs grades it)
for (const e of lib.examples.filter((x) => !x.tags.includes('exercise'))) {
  const p = P.load(H.read(`examples/${e.id}.json`));
  for (const x of p.instances || []) {
    if (!x.expected || (!Number.isInteger(x.expected.solutions) && x.expected.optimum == null)) continue;
    const slow = (x.tags || []).includes('slow');
    // bench: for the benchmark suites only, never in the tests (manual: Instances, tags)
    const bench = (x.tags || []).includes('bench');
    const what = P.expectedCheck(x.expected, { outcome: 'finished', exhausted: true, solutions: 0 }).want;
    test(`instance ${e.id}/${x.id} gives ${what}`, { skip: bench ? 'bench (tools/bench.mjs only)' : slow && !H.SLOW && 'slow (SLOW=1)' }, async () => {
      const q = structuredClone(p);
      q.settings = { ...q.settings, solutions: 0, trace: 0, seconds: 0 };
      const r = await H.runProject(q, { instance: x.id });
      assert.equal(H.done(r).outcome, 'finished');
      // a solution count needs an exhausted run; an optimum only a finished one
      if (Number.isInteger(x.expected.solutions)) assert.equal(H.done(r).exhausted, true);
      const t = P.costTracker();
      for (const m of H.ofKind(r, 'M')) t.add(m.cost);
      const v = P.expectedCheck(x.expected, { outcome: H.done(r).outcome, exhausted: H.done(r).exhausted, solutions: H.finalStats(r).solutions, cost: t.cost, same: t.same });
      assert.equal(v.checked, true);
      assert.equal(v.ok, true, `${what}: ${H.finalStats(r).solutions} solutions, cost ${JSON.stringify(t.cost)}${t.same ? '' : ' (costs differ)'}`);
    });
  }
}

test('Run all summary: never says "match" when nothing was checked (D1)', () => {
  const done = (o) => ({ outcome: 'finished', exhausted: true, solutions: 2, cost: null, same: true, ...o });
  // the bug: a run stopped at the solution limit was not checked but reported as a match
  const s1 = P.runAllSummary([{ expected: { solutions: 2 }, result: done({ exhausted: false, solutions: 1 }) }]);
  assert.equal(s1.checked, 0);
  assert.match(s1.text, /0 of 1 checked: nothing to compare; not checked: 1 stopped before all solutions were found\./);
  assert.doesNotMatch(s1.text, /match/);
  const s2 = P.runAllSummary([
    { expected: { solutions: 2 }, result: done({}) },
    { expected: { solutions: 3 }, result: done({}) },
    { expected: null, result: done({}) },
    { expected: { solutions: 1 }, result: done({ outcome: 'limit' }) },
  ]);
  assert.deepEqual([s2.n, s2.checked, s2.bad, s2.noExpect, s2.unfinished], [4, 2, 1, 1, 1]);
  assert.match(s2.text, /^Ran 4 instances; 2 of 4 checked: 1 with a count or optimum other than expected/);
  const s3 = P.runAllSummary([{ expected: { solutions: 2 }, result: done({}) }]);
  assert.equal(s3.text, 'Ran 1 instance; 1 of 1 checked, all match.');
});

test('instances[].audit: false keeps an instance out of the audit and Fuzz, not out of runs', async () => {
  const { fuzzInstances } = await import('../js/fuzz.js');
  const base = { format: 'cegarplay', fragments: [], instances: [{ id: 'small', facts: '' }, { id: 'big', facts: '', audit: false }] };
  const p = P.load(JSON.stringify(base));
  assert.deepEqual(P.auditable(p).map((x) => x.id), ['small']);
  assert.throws(() => P.load(JSON.stringify({ ...base, instances: [{ id: 'a', audit: 'no' }] })), /audit must be true or false/);
  assert.equal(P.load(JSON.stringify({ ...base, instances: [{ id: 'a', audit: true }] })).instances[0].audit, undefined);
  assert.deepEqual(fuzzInstances(p, { ids: 'all' }).map((x) => x.id), ['small']);
  const v = P.load(H.read('examples/voting-justification.json'));
  assert.deepEqual(v.instances.filter((x) => x.audit === false).map((x) => x.id), ['faith-cancel-reinf-pareto-condorcet-k3',
    'faith-cancel-reinf-pareto-k3', 'cancel-reinf-posresp-k4', 'pareto-neutral-cancel-reinf-k8', 'random-1', 'random-2']);
});

test('CSV import: row/N facts without a map, named predicates with a column map (D7)', async () => {
  const I = await import('../js/instances.js');
  const csv = 'from,to,cost\n1,2,5\n2,3,"x, y"\n';
  assert.equal(I.fromCsv(csv).facts, '% from a CSV file with the columns from, to, cost\nrow(1,1,2,5).\nrow(2,2,3,"x, y").\n');
  assert.equal(I.fromCsv(csv, {}, 'edge(from,to); w(1,3)').facts.split('\n').slice(1).join('\n'), 'edge(1,2).\nw(1,5).\nedge(2,3).\nw(2,"x, y").\n');
  assert.equal(I.fromCsv('a\tb\nfoo\tBar\n').facts.split('\n')[1], 'row(1,foo,"Bar").');
  assert.throws(() => I.fromCsv(csv, {}, 'edge(from,nope)'), /no column "nope"/);
  assert.throws(() => I.fromCsv(csv, {}, 'edge from'), /expected pred/);
  assert.throws(() => I.fromCsv('a,b\n1\n'), /line 2: 1 fields/);
  assert.equal(I.importerFor('data.tsv'), 'csv');
});

test('generator constants: a value naming a parameter takes its value; a recipe instance gets them under its own', async () => {
  const { generatorConstants } = await import('../js/generate.js');
  const g = { name: 'g', text: 'node(1..n).\n#show node/1.\n', params: { n: 'int' }, defaults: { n: 4 }, constants: { n: 'n', k: '3' } };
  assert.deepEqual(generatorConstants(g, {}), { n: '4', k: '3' });
  assert.deepEqual(generatorConstants(g, { n: 6 }), { n: '6', k: '3' });
  assert.deepEqual(generatorConstants({ ...g, constants: undefined }, {}), {});
  // the project format keeps them, and checks them
  const p = P.load({ format: 'cegarplay', fragments: [{ name: 'shared', text: '' }], generators: [g],
    instances: [{ id: 'a', recipe: { generator: 'g', params: { n: 5 }, seed: 1 }, constants: { k: '7' } }] });
  assert.deepEqual(p.generators[0].constants, { n: 'n', k: '3' });
  assert.throws(() => P.load({ format: 'cegarplay', fragments: [], generators: [{ ...g, constants: { N: '1' } }] }), /constant name 'N'/);
  const x = await I.resolveInstance(p, 'a', H.engineRun, H.GEN_LUA);
  assert.match(x.facts, /node\(5\)/);
  assert.deepEqual(x.constants, { n: '5', k: '7' });
});
