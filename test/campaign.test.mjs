// Phase I3: campaigns (docs/spec-instances.md section 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as H from './helpers.mjs';
import { load, template } from '../js/project.js';
import { expandSuite, cellKey, inShard, parseShard, parseWhere, evalWhere, runSuite, Reducer, inconsistencies, scaling, growthFit, gridPoints } from '../js/campaign.js';
import { MemoryStore, exportRows, importRows } from '../js/store.js';

const runJob = async (job) => { const r = await H.run(job.program); const red = new Reducer(); for (const e of r.events) red.add(e.kind, e.data); return red.result(r.status); };
const opts = (extra = {}) => ({ runJob, engineRun: H.engineRun, luaTexts: H.GEN_LUA, runtime: H.RUNTIME, modules: { ground: H.read('lua/ground.lua') }, ...extra });
const ex = (id) => load(H.read(`examples/${id}.json`));
const SCRATCH = process.env.TMPDIR || '/tmp';

test('expansion: constants grid, generator grid, instance list; variants and solver seeds', () => {
  assert.deepEqual(gridPoints({ n: [1, 2], p: [3] }), [{ n: 1, p: 3 }, { n: 2, p: 3 }]);
  const p = ex('tutorial-weak-relevant');
  const cells = expandSuite(p, { name: 's', instances: { constants: { n: [4, 5] } }, variants: ['default', 'reference'], solver_seeds: 2 });
  assert.equal(cells.length, 8);
  assert.deepEqual(cells[0].inst.constants, { n: '4' });
  const q = ex('qbf');
  const g = expandSuite(q, q.suites[0]);
  assert.equal(g.length, 20);
  assert.deepEqual(g[0].inst.recipe, { generator: 'qbf-dnf', params: { t: 6 }, seed: 1 });
  const l = expandSuite(q, { name: 'l', instances: { ids: 'all' } });
  assert.deepEqual(l.map((c) => c.instance), ['example', 'random-1', 'random-2', 'random-3', 'dnf-1']);
  assert.throws(() => expandSuite(p, { name: 'x', variants: ['nope'] }), /no variant named nope/);
});

test('cell keys: stable, change with what decides the run; shards partition the cells', async () => {
  const p = ex('tutorial-weak-relevant');
  const suite = p.suites[0];
  const cells = expandSuite(p, suite);
  const keys = await Promise.all(cells.map((c) => cellKey(p, c, suite, 'v1')));
  assert.equal(new Set(keys).size, cells.length);
  assert.deepEqual(await Promise.all(cells.map((c) => cellKey(p, c, suite, 'v1'))), keys);
  assert.notEqual(await cellKey(p, cells[0], suite, 'v2'), keys[0]);
  const p2 = structuredClone(p); p2.fragments[1].text += '\n% edit\n';
  assert.notEqual(await cellKey(p2, cells[0], suite, 'v1'), keys[0]);
  const s3 = keys.map((k) => [0, 1, 2].filter((i) => inShard(k, { i, n: 3 })).length);
  assert.ok(s3.every((x) => x === 1));
  assert.throws(() => parseShard('3/3'));
});

test('where filters', () => {
  const f = ['solutions(reference) >= 10', 'outcome(default) == "finished"'].map(parseWhere);
  assert.equal(evalWhere(f, [{ variant: 'reference', solutions: 12 }, { variant: 'default', outcome: 'finished' }]), true);
  assert.equal(evalWhere(f, [{ variant: 'reference', solutions: 9 }, { variant: 'default', outcome: 'finished' }]), false);
  assert.equal(evalWhere(f, [{ variant: 'default', outcome: 'finished' }]), null);
  assert.throws(() => parseWhere('time(x) > 1'), /cannot read/);
});

test('tutorial-weak-relevant against the reference variant: n = 8 is marked (11 against 61); a rerun skips every cell', async () => {
  const p = ex('tutorial-weak-relevant');
  const store = new MemoryStore();
  const r = await runSuite(p, p.suites[0], opts({ store }));
  assert.equal(r.ran, 10);
  const bad = inconsistencies(r.all);
  const n8 = bad.find((b) => b.instance === 'n8');
  assert.ok(n8);
  assert.deepEqual(n8.rows.map((x) => [x.variant, x.solutions]).sort(), [['default', 11], ['reference', 61]]);
  const again = await runSuite(p, p.suites[0], opts({ store }));
  assert.equal(again.ran, 0);
  assert.equal(again.skipped, 10);
});

test('a generator suite with a where filter skips the other variants of filtered instances', async () => {
  const q = ex('qbf');
  q.variants = [{ name: 'reference', loop: { language: 'loop', text: template('reference') }, swap: {}, constants: {} }];
  const suite = { name: 'w', instances: { generator: 'qbf-dnf', grid: { t: [6, 10] }, seeds: 2 }, variants: ['default', 'reference'], where: ['solutions(default) >= 6'] };
  const r = await runSuite(q, suite, opts());
  const skipped = r.rows.filter((x) => x.skipped);
  const dflt = r.rows.filter((x) => x.variant === 'default');
  assert.equal(dflt.length, 4);
  assert.equal(skipped.length, dflt.filter((x) => x.solutions < 6).length);
  assert.ok(skipped.every((x) => x.variant === 'reference'));
  assert.deepEqual(inconsistencies(r.rows), []);
});

test('rows as JSON lines; scaling and growth fit', () => {
  const rows = [1, 2, 3, 4].flatMap((n) => [0, 1, 2].map((s) => ({ key: `${n}-${s}`, variant: 'v', params: { n }, time: 2 ** n * (1 + s / 10), exhausted: true, outcome: 'finished' })));
  assert.deepEqual(importRows(exportRows(rows)), rows);
  assert.throws(() => importRows('{"x":1}\n'), /needs a key/);
  const sc = scaling(rows, 'n');
  assert.equal(sc.v.length, 4);
  const fit = growthFit(sc.v);
  assert.ok(Math.abs(fit.factor - 2) < 0.01 && fit.lo <= fit.factor && fit.factor <= fit.hi, JSON.stringify(fit));
});

test('tools/bench.mjs: two shards together give the rows of an unsharded run; --resume runs nothing', () => {
  const dir = fs.mkdtempSync(`${SCRATCH}/bench-`);
  const run = (...a) => spawnSync('node', [H.path('tools/bench.mjs').pathname, 'qbf', '--suite', 'random', '--jobs', '2', '--quiet', ...a], { encoding: 'utf8' });
  const all = run('--out', `${dir}/all.jsonl`);
  assert.equal(all.status, 0, all.stderr);
  for (const s of ['0/2', '1/2']) assert.equal(run('--shard', s, '--out', `${dir}/s${s[0]}.jsonl`).status, 0);
  const strip = (r) => JSON.stringify({ ...r, time: undefined, candidates: r.candidates });
  const rows = (f) => importRows(fs.readFileSync(`${dir}/${f}`, 'utf8')).map(strip).sort();
  const A = rows('all.jsonl'), B = [...rows('s0.jsonl'), ...rows('s1.jsonl')].sort();
  assert.equal(A.length, 20);
  assert.deepEqual(B, A);
  const again = spawnSync('node', [H.path('tools/bench.mjs').pathname, 'qbf', '--suite', 'random', '--jobs', '2', '--out', `${dir}/all.jsonl`, '--resume'], { encoding: 'utf8' });
  assert.match(again.stderr, /20 cells: 0 run, 20 from earlier/);
  fs.copyFileSync(`${dir}/all.jsonl`, `${SCRATCH}/cegarplay-bench-qbf.jsonl`);
});
