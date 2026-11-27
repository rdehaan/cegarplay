// Campaigns over several solver seeds: fixed, listed or random seeds (written down), randomized
// search per suite, and the matrix per seed and as a mean.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';
import { expandSuite, cellProject, cellKey, suiteSeeds, drawSeeds, drawSuiteSeeds, rowSeeds, runSuite, Reducer, resultMatrix, seedMatrices, matricesCSV, matrixMarkdown, SuiteError } from '../js/campaign.js';
import { importRows } from '../js/store.js';
import { report } from '../tools/report.mjs';

const runJob = async (job) => { const r = await H.run(job.program); const red = new Reducer(); for (const e of r.events) red.add(e.kind, e.data); return red.result(r.status); };
const opts = (extra = {}) => ({ runJob, engineRun: H.engineRun, luaTexts: H.GEN_LUA, runtime: H.RUNTIME, modules: { ground: H.read('lua/ground.lua') }, ...extra });
const ex = (id) => load(H.read(`examples/${id}.json`));
const SCRATCH = process.env.TMPDIR || '/tmp';
// a small deterministic generator for the random seeds
const lcg = (s = 7) => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };

test('solver seeds: a number, a list, random seeds drawn once; randomize per suite', async () => {
  assert.deepEqual(suiteSeeds({ name: 's' }), [0]);
  assert.deepEqual(suiteSeeds({ name: 's', solver_seeds: 3 }), [0, 1, 2]);
  assert.deepEqual(suiteSeeds({ name: 's', solver_seeds: [17, 4] }), [17, 4]);
  assert.throws(() => suiteSeeds({ name: 's', solver_seeds: [] }), /empty list/);
  assert.throws(() => suiteSeeds({ name: 's', solver_seeds: [1, 1] }), /twice/);
  assert.throws(() => suiteSeeds({ name: 's', solver_seeds: [1.5] }), /whole number/);
  assert.throws(() => suiteSeeds({ name: 's', random_seeds: 3 }), /drawn when the suite starts/);
  assert.throws(() => suiteSeeds({ name: 's', randomize: 'yes' }), /randomize must be true or false/);
  const d = drawSeeds(50, lcg());
  assert.equal(new Set(d).size, 50);
  assert.ok(d.every((x) => Number.isInteger(x) && x >= 1 && x <= 99999));
  assert.throws(() => drawSeeds(0), SuiteError);
  const { suite, seeds } = drawSuiteSeeds({ name: 's', random_seeds: 3, variants: ['default'] }, lcg(3));
  assert.equal(seeds.length, 3);
  assert.deepEqual(suite, { name: 's', variants: ['default'], solver_seeds: seeds });
  assert.equal(drawSuiteSeeds({ name: 's', solver_seeds: 2 }).seeds, null);
  // cells: one per instance x variant x seed, in the order of the list
  const p = ex('tutorial-first-run');
  const s2 = { name: 's', instances: { constants: { n: [4, 5] } }, solver_seeds: [9, 3] };
  assert.deepEqual(expandSuite(p, s2).map((c) => `${c.instance}/${c.seed}`), ['n4/9', 'n4/3', 'n5/9', 'n5/3']);
  // randomize: in the cell's settings and its key only when the suite says so
  const c = expandSuite(p, s2)[0];
  assert.equal('randomize' in cellProject(p, c, s2).settings, false);
  assert.equal(cellProject(p, c, { ...s2, randomize: true }).settings.randomize, true);
  assert.notEqual(await cellKey(p, c, s2), await cellKey(p, c, { ...s2, randomize: true }));
});

const row = (instance, variant, seed, time, extra = {}) => ({ key: `${instance}|${variant}|${seed}`, instance, variant, seed, outcome: 'finished', exhausted: true, solutions: 4, time, candidates: Math.round(time * 10), ...extra });

test('the matrix per seed and as a mean (± standard deviation); CSV and Markdown of every table', () => {
  const rows = [row('a', 'x', 1, 1), row('a', 'x', 2, 3), row('a', 'y', 1, 2), row('a', 'y', 2, 2),
    row('b', 'x', 1, 5), row('b', 'x', 2, 1, { outcome: 'timeout' }), row('b', 'y', 1, 1), row('b', 'y', 2, 1)];
  assert.deepEqual(rowSeeds(rows), [1, 2]);
  const med = resultMatrix(rows, 'time');
  assert.equal(med.stat, 'median');
  assert.equal(med.rows[0].cells.x.value, 2);
  const mean = resultMatrix(rows, 'time', {}, { stat: 'mean' });
  assert.equal(mean.rows[0].cells.x.value, 2);
  assert.ok(Math.abs(mean.rows[0].cells.x.sd - Math.SQRT2) < 1e-9);
  assert.equal(mean.rows[0].cells.y.sd, 0);
  assert.equal(mean.rows[0].best, null);                       // 2 against 2: a tie,
  assert.deepEqual(mean.rows[0].bests, ['x', 'y']);              // both bold
  assert.equal(mean.rows[1].cells.x.solved, false);             // one seed did not finish
  assert.equal(mean.rows[1].cells.x.solvedN, 1);
  assert.equal(mean.rows[1].best, 'y');
  assert.deepEqual(mean.rows[0].cells.x.perSeed, [[1, 1], [2, 3]]);
  const one = resultMatrix(rows, 'time', {}, { seed: 1 });
  assert.equal(one.seed, 1);
  assert.equal(one.rows[0].cells.x.value, 1);
  assert.equal(one.rows[0].best, 'x');
  assert.equal(one.rows[1].cells.x.solved, true);
  const all = seedMatrices(rows, 'time');
  assert.deepEqual(all.map((x) => x.table), ['mean', 'seed 1', 'seed 2']);
  const csv = matricesCSV(all);
  assert.match(csv, /^table,instance,x,x sd,y,y sd,best\nmean,a,2,1\.414\d*,2,0,x y\n/);
  assert.match(csv, /\nmean,b,timeout \(1 of 2 finished\),/);
  assert.match(csv, /\nseed 2,b,timeout,,1,,y\n/);
  assert.match(matrixMarkdown(mean), /\| a \| \*\*2\.000 ± 1\.414\*\* \| \*\*2\.000 ± 0\.000\*\* \|/);
  const md = report(rows, { perSeed: true }).markdown;
  assert.match(md, /Solver seeds: 1, 2\./);
  assert.match(md, /## Per seed[^]*### Mean over the seeds[^]*### Seed 1[^]*### Seed 2/);
  assert.doesNotMatch(report(rows).markdown, /## Per seed/);
});

test('a suite over random seeds with randomized search: the seeds change the runs, and the rows name them', async () => {
  const p = ex('gc-shape2');
  const { suite, seeds } = drawSuiteSeeds({ name: 'seeds', instances: { ids: [] }, random_seeds: 3, randomize: true, limits: { seconds: 60 } }, lcg(11));
  const r = await runSuite(p, suite, opts());
  assert.equal(r.all.length, 3);
  assert.deepEqual(r.all.map((x) => x.seed).sort((a, b) => a - b), seeds.slice().sort((a, b) => a - b));
  assert.ok(r.all.every((x) => x.outcome === 'finished' && x.solutions === 101));
  assert.ok(new Set(r.all.map((x) => x.candidates)).size > 1, 'randomized search: the seeds give different runs');
  const m = resultMatrix(r.all, 'candidates', {}, { stat: 'mean' });
  assert.ok(m.rows[0].cells.default.sd > 0);
});

test('tools/bench.mjs: --random-seeds prints the seeds drawn, --seeds repeats them; not with --shard', () => {
  const dir = fs.mkdtempSync(`${SCRATCH}/bench-seeds-`);
  const bench = (...a) => spawnSync('node', [H.path('tools/bench.mjs').pathname, 'tutorial-weak-relevant', '--suite', 'scaling', '--jobs', '2', '--quiet', ...a], { encoding: 'utf8' });
  const r = bench('--random-seeds', '2', '--randomize', '--out', `${dir}/a.jsonl`);
  assert.equal(r.status, 0, r.stderr);
  const m = r.stderr.match(/random seeds: (\d+), (\d+) \(repeat with --seeds (\d+,\d+)\)/);
  assert.ok(m, r.stderr);
  const rows = importRows(fs.readFileSync(`${dir}/a.jsonl`, 'utf8'));
  assert.deepEqual(rowSeeds(rows), [Number(m[1]), Number(m[2])].sort((a, b) => a - b));
  const again = bench('--seeds', m[3], '--randomize', '--out', `${dir}/a.jsonl`, '--resume');
  assert.equal(again.status, 0, again.stderr);
  assert.equal(importRows(fs.readFileSync(`${dir}/a.jsonl`, 'utf8')).length, rows.length, 'the same seeds: every cell from earlier');
  assert.equal(bench('--random-seeds', '2', '--shard', '0/2').status, 2);
  const rep = spawnSync('node', [H.path('tools/report.mjs').pathname, `${dir}/a.jsonl`, '--per-seed'], { encoding: 'utf8' });
  assert.equal(rep.status, 0, rep.stderr);
  assert.match(rep.stdout, /### Seed /);
});
