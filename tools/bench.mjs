// Run a campaign suite headless, the twin of the Campaign tab.
//
//   node tools/bench.mjs <project.json | library id> --suite NAME [--jobs N] [--shard i/n]
//                        [--out file.jsonl] [--resume] [--seconds N] [--quiet]
//                        [--seeds N | --seeds a,b,c | --random-seeds N] [--randomize | --no-randomize]
//
// --seconds N replaces the suite's time limit per cell (N > 0). --seeds and --random-seeds replace
// the suite's solver seeds (N: seeds 0..N-1; a list: these seeds; random: N seeds drawn now, as
// does a suite with random_seeds); the seeds drawn are printed, and every row carries its seed.
// --randomize turns on the randomized search (without it every seed searches the same way).
// Random seeds cannot be drawn with --shard or --resume (each process would draw others): pass the
// printed seeds with --seeds. Turn the rows into a table and a plot with tools/report.mjs
// (--per-seed: the mean and a table per seed).
//
// One row per cell as a JSON line (stdout, or --out). --resume skips the cells whose key is
// already in the --out file and appends. Exit code 0, 1 on a problem, 2 on bad usage.
import fs from 'node:fs';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { engineRun, lua } from './engine.mjs';
import { load } from '../js/project.js';
import { runSuite, parseShard, inconsistencies, Reducer, engineTag, drawSuiteSeeds } from '../js/campaign.js';
import { MemoryStore, importRows } from '../js/store.js';

const root = new URL('..', import.meta.url);

// worker thread: one job at a time, reduced in the thread
if (!isMainThread && workerData && workerData.cegarplayBench) {
  parentPort.on('message', async (job) => {
    const r = await engineRun(job.program);
    const red = new Reducer();
    for (const e of r.events) red.add(e.kind, e.data);
    parentPort.postMessage({ id: job.id, result: red.result(r.status) });
  });
}

// A pool of worker threads with the job interface of js/pool.js; a job past its time limit + 2 s
// terminates its thread (a fresh one takes its place).
export class ThreadPool {
  constructor(size) {
    this.size = size;
    this.free = [];
    this.waiting = [];
    this.next = 1;
    for (let i = 0; i < size; i++) this.free.push(this.spawn());
  }
  spawn() { return new Worker(new URL(import.meta.url), { workerData: { cegarplayBench: true } }); }
  async run(job) {
    const w = this.free.pop() || await new Promise((resolve) => this.waiting.push(resolve));
    const id = this.next++;
    const res = await new Promise((resolve) => {
      let timer = null;
      const done = (r, dead) => {
        if (timer) clearTimeout(timer);
        w.off('message', onMsg);
        resolve({ r, dead });
      };
      const onMsg = (m) => { if (m.id === id) done(m.result, false); };
      w.on('message', onMsg);
      if (job.seconds > 0) timer = setTimeout(() => { w.terminate(); done({ outcome: 'timeout', exhausted: false, solutions: 0, candidates: 0, refinements: 0, time: job.seconds, hash: '' }, true); }, (job.seconds + 2) * 1000);
      w.postMessage({ id, program: job.program });
    });
    const back = res.dead ? this.spawn() : w;
    const wait = this.waiting.shift();
    if (wait) wait(back); else this.free.push(back);
    return res.r;
  }
  close() { for (const w of this.free) w.terminate(); }
}

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/bench.mjs <project.json | library id> --suite NAME [--jobs N] [--shard i/n] [--out file.jsonl] [--resume] [--seconds N] [--quiet]\n' +
    '                     [--seeds N | --seeds a,b,c | --random-seeds N] [--randomize | --no-randomize]');
  process.exit(2);
}

// seeds: a number N or a list (replaces the suite's solver seeds); randomSeeds: N seeds to draw;
// randomize: true | false (replaces the suite's). The result has drawnSeeds (or null).
export async function bench(project, suiteName, { jobs = 1, shard = null, store = new MemoryStore(), onRow = () => {}, seconds = 0, seeds = null, randomSeeds = null, randomize = null, random = Math.random } = {}) {
  let suite = (project.suites || []).find((s) => s.name === suiteName);
  if (!suite) throw new Error(`no suite named ${suiteName}`);
  if (seconds > 0) suite = { ...suite, limits: { ...(suite.limits || {}), seconds } };
  if (seeds !== null || randomSeeds !== null) {
    const { random_seeds: _r, ...rest } = suite;
    suite = randomSeeds !== null ? { ...rest, random_seeds: randomSeeds } : { ...rest, solver_seeds: seeds };
  }
  if (randomize !== null) suite = { ...suite, randomize };
  const drawn = drawSuiteSeeds(suite, random);
  suite = drawn.suite;
  const pool = new ThreadPool(jobs);
  try {
    return await runSuite(project, suite, {
      runJob: (job) => pool.run(job), store, engineRun, luaTexts: { draw: lua('draw.lua'), generate: lua('generate.lua') },
      runtime: lua('runtime.lua'), modules: { ground: lua('ground.lua') }, engineVersion: engineTag(engineVersion(), lua('runtime.lua'), { ground: lua('ground.lua') }), shard, jobs,
      onProgress: (row, done, total, old) => { if (!old) onRow(row, done, total); },
    }).then((r) => ({ ...r, drawnSeeds: drawn.seeds }));
  } finally { pool.close(); }
}
export const engineVersion = () => {
  try { return fs.readFileSync(new URL('vendor/clingo-wasm/VERSION', root), 'utf8').split('\n')[0]; } catch { return 'clingo-wasm'; }
};

async function main(argv) {
  const args = [...argv];
  let target = null, suite = null, jobs = Math.max(1, Math.min(8, os.cpus().length - 1)), shard = null, out = null, resume = false, quiet = false, seconds = 0;
  let seeds = null, randomSeeds = null, randomize = null;
  while (args.length) {
    const a = args.shift();
    if (a === '--suite') suite = args.shift() || usage('--suite needs a name');
    else if (a === '--jobs') { jobs = Number(args.shift()); if (!Number.isInteger(jobs) || jobs < 1) usage('--jobs needs a whole number >= 1'); }
    else if (a === '--shard') { try { shard = parseShard(args.shift()); } catch (e) { usage(e.message); } }
    else if (a === '--out') out = args.shift() || usage('--out needs a file');
    else if (a === '--resume') resume = true;
    else if (a === '--seconds') { seconds = Number(args.shift()); if (!(seconds > 0)) usage('--seconds needs a number > 0'); }
    else if (a === '--quiet') quiet = true;
    else if (a === '--seeds') {
      const t = args.shift() || usage('--seeds needs N or a list a,b,c');
      if (/^\d+$/.test(t) && !t.includes(',')) seeds = Number(t);
      else if (/^\d+(,\d+)*$/.test(t)) seeds = t.split(',').map(Number);
      else usage('--seeds needs N or a list a,b,c of whole numbers');
      if (seeds === 0) usage('--seeds needs N >= 1');
    } else if (a === '--random-seeds') { randomSeeds = Number(args.shift()); if (!Number.isInteger(randomSeeds) || randomSeeds < 1) usage('--random-seeds needs a whole number >= 1'); }
    else if (a === '--randomize') randomize = true;
    else if (a === '--no-randomize') randomize = false;
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else if (target) usage('only one project');
    else target = a;
  }
  if (!target || !suite) usage();
  if (resume && !out) usage('--resume needs --out');
  if (seeds !== null && randomSeeds !== null) usage('give --seeds or --random-seeds, not both');
  const file = fs.existsSync(target) ? target : /^[A-Za-z0-9_-]+$/.test(target) ? new URL(`examples/${target}.json`, root) : target;
  let project;
  try { project = load(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`cannot load ${target}: ${e.message}`); process.exit(1); }
  const named = (project.suites || []).find((s) => s.name === suite);
  const drawing = randomSeeds !== null || (seeds === null && named && named.random_seeds !== undefined);
  if (drawing && (shard || resume)) usage('random seeds cannot be drawn with --shard or --resume (each process would draw others): draw them once and pass them with --seeds a,b,c');
  const store = new MemoryStore(resume && fs.existsSync(out) ? importRows(fs.readFileSync(out, 'utf8')) : []);
  if (out && !resume) fs.writeFileSync(out, '');
  const t0 = Date.now();
  let r;
  try {
    r = await bench(project, suite, {
      jobs, shard, store, seconds, seeds, randomSeeds, randomize,
      onRow: (row, done, total) => {
        const line = JSON.stringify(row) + '\n';
        if (out) fs.appendFileSync(out, line); else process.stdout.write(line);
        if (!quiet && out) process.stderr.write(`\r${done}/${total} cells`);
      },
    });
  } catch (e) { console.error(e.message); process.exit(1); }
  if (r.drawnSeeds) console.error(`${out && !quiet ? '\n' : ''}random seeds: ${r.drawnSeeds.join(', ')} (repeat with --seeds ${r.drawnSeeds.join(',')})`);
  if (!quiet) {
    const bad = inconsistencies(r.all);
    console.error(`${out ? '\n' : ''}${r.cells} cells: ${r.ran} run, ${r.skipped} from earlier, ${((Date.now() - t0) / 1000).toFixed(1)} s; ` +
      `${bad.length} instances with disagreeing variants${bad.length ? ` (${bad.map((b) => b.instance).join(', ')})` : ''}`);
    for (const p of [...new Set(r.problems)]) console.error(`problem: ${p}`);
  }
  process.exit(r.problems.length ? 1 : 0);
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
