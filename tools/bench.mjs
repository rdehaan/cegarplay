// Run a campaign suite headless (docs/spec-instances.md section 5), the twin of the Campaign tab.
//
//   node tools/bench.mjs <project.json | library id> --suite NAME [--jobs N] [--shard i/n]
//                        [--out file.jsonl] [--resume] [--quiet]
//
// One row per cell as a JSON line (stdout, or --out). --resume skips the cells whose key is
// already in the --out file and appends. Exit code 0, 1 on a problem, 2 on bad usage.
import fs from 'node:fs';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import factory from '../vendor/clingo-wasm/clingo.js';
import { load } from '../js/project.js';
import { runSuite, parseShard, inconsistencies, Reducer } from '../js/campaign.js';
import { MemoryStore, importRows } from '../js/store.js';
import { parseEvent } from '../js/driver.js';

const root = new URL('..', import.meta.url);
const lua = (name) => fs.readFileSync(new URL(`lua/${name}`, root), 'utf8');

async function engineRun(program, options = '--outf=3') {
  const out = [], err = [];
  const m = await factory({ print: (l) => out.push(l), printErr: (l) => err.push(l) });
  let status;
  try { status = m.ccall('run', 'number', ['string', 'string'], [program, options]); }
  catch (e) { status = 'trap'; err.push(String(e)); }
  return { status, out, err, events: out.map(parseEvent).filter(Boolean) };
}

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
  console.error('usage: node tools/bench.mjs <project.json | library id> --suite NAME [--jobs N] [--shard i/n] [--out file.jsonl] [--resume] [--quiet]');
  process.exit(2);
}

export async function bench(project, suiteName, { jobs = 1, shard = null, store = new MemoryStore(), onRow = () => {} } = {}) {
  const suite = (project.suites || []).find((s) => s.name === suiteName);
  if (!suite) throw new Error(`no suite named ${suiteName}`);
  const pool = new ThreadPool(jobs);
  try {
    return await runSuite(project, suite, {
      runJob: (job) => pool.run(job), store, engineRun, luaTexts: { draw: lua('draw.lua'), generate: lua('generate.lua') },
      runtime: lua('runtime.lua'), modules: { ground: lua('ground.lua') }, engineVersion: engineVersion(), shard, jobs,
      onProgress: (row, done, total, old) => { if (!old) onRow(row, done, total); },
    });
  } finally { pool.close(); }
}
export const engineVersion = () => {
  try { return fs.readFileSync(new URL('vendor/clingo-wasm/VERSION', root), 'utf8').split('\n')[0]; } catch { return 'clingo-wasm'; }
};

async function main(argv) {
  const args = [...argv];
  let target = null, suite = null, jobs = Math.max(1, Math.min(8, os.cpus().length - 1)), shard = null, out = null, resume = false, quiet = false;
  while (args.length) {
    const a = args.shift();
    if (a === '--suite') suite = args.shift() || usage('--suite needs a name');
    else if (a === '--jobs') { jobs = Number(args.shift()); if (!Number.isInteger(jobs) || jobs < 1) usage('--jobs needs a whole number >= 1'); }
    else if (a === '--shard') { try { shard = parseShard(args.shift()); } catch (e) { usage(e.message); } }
    else if (a === '--out') out = args.shift() || usage('--out needs a file');
    else if (a === '--resume') resume = true;
    else if (a === '--quiet') quiet = true;
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else if (target) usage('only one project');
    else target = a;
  }
  if (!target || !suite) usage();
  if (resume && !out) usage('--resume needs --out');
  const file = fs.existsSync(target) ? target : /^[A-Za-z0-9_-]+$/.test(target) ? new URL(`examples/${target}.json`, root) : target;
  let project;
  try { project = load(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`cannot load ${target}: ${e.message}`); process.exit(1); }
  const store = new MemoryStore(resume && fs.existsSync(out) ? importRows(fs.readFileSync(out, 'utf8')) : []);
  if (out && !resume) fs.writeFileSync(out, '');
  const t0 = Date.now();
  let r;
  try {
    r = await bench(project, suite, {
      jobs, shard, store,
      onRow: (row, done, total) => {
        const line = JSON.stringify(row) + '\n';
        if (out) fs.appendFileSync(out, line); else process.stdout.write(line);
        if (!quiet && out) process.stderr.write(`\r${done}/${total} cells`);
      },
    });
  } catch (e) { console.error(e.message); process.exit(1); }
  if (!quiet) {
    const bad = inconsistencies(r.all);
    console.error(`${out ? '\n' : ''}${r.cells} cells: ${r.ran} run, ${r.skipped} from earlier, ${((Date.now() - t0) / 1000).toFixed(1)} s; ` +
      `${bad.length} instances with disagreeing variants${bad.length ? ` (${bad.map((b) => b.instance).join(', ')})` : ''}`);
    for (const p of [...new Set(r.problems)]) console.error(`problem: ${p}`);
  }
  process.exit(r.problems.length ? 1 : 0);
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
