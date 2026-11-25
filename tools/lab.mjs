// The Refinery, headless (docs/lab-design.md; manual: Refinery tab). Every number the
// tab shows comes from the same modules (js/lab/*.js).
//
//   node tools/lab.mjs <project.json | library id> [options]
//
//   --instance ID     an instance of the project       --variant NAME   a variant
//   --link G          the link (default: as the audit chooses it)
//   -c name=value     set a constant (repeatable)
//   --limit N         candidate cap (default 200000)
//   --candidate HEX   inspect this candidate (free mode: everything alive)
//   --step N --record FILE   inspect step N of a recording (every step recorded), alive as then
//   --cex N           counterexamples per candidate in the inspector (default 20)
//   --minimal N       minimal sets cap (default 200)
//   --justify         check justification of the inspected sets (and --lift: one lifted clause)
//   --bounds SCHEME   exact best and worst runs: loop | omniscient | block
//   --exact N         skip the exact bounds above N bad candidates (default 3000)
//   --simulate N      N idealised runs in random order (default 0 = none), with greedy policies
//   --seed N          the simulation's seed (default 1)
//   --record FILE     with --bounds/--simulate: place this run against the bounds
//   --compare FILE    a second recording laid over the first
//   --seconds N       time budget of each clingo computation (default 30)
//   --json            print the results as one JSON object
//
// Exit code (as tools/audit.mjs): 0 success, 1 error, 2 bad usage, 3 a limit or budget, 4 unsupported.
import fs from 'node:fs';
import zlib from 'node:zlib';
import factory from '../vendor/clingo-wasm/clingo.js';
import { loadTarget } from './audit.mjs';
import { Recording } from '../js/recording.js';
import * as Lab from '../js/lab/core.js';
import { runReport, ladder, decomposition } from '../js/lab/report.js';

const root = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
export const LUA = { runtime: read('lua/runtime.lua'), lab: read('lua/lab.lua'), ground: read('lua/ground.lua'), draw: read('lua/draw.lua'), generate: read('lua/generate.lua'), audit: read('lua/audit.lua') };

// One clingo-wasm run on a fresh instance (a trap leaves no state behind).
export async function nodeExec(program, options = '--outf=3', onLine = null) {
  const out = [], err = [];
  const m = await factory({ print: (l) => { out.push(l); if (onLine) onLine(l); }, printErr: (l) => err.push(l) });
  let status;
  try { status = m.ccall('run', 'number', ['string', 'string'], [program, options]); } catch (e) { status = 'trap'; err.push(String(e)); }
  return { status, out, err };
}

export function readRecording(file) {
  const buf = fs.readFileSync(file);
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf).toString() : buf.toString();
  return Recording.fromText(text);
}

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/lab.mjs <project.json | library id> [--instance ID] [--variant NAME] [--link G] [--candidate HEX | --step N --record FILE] [--bounds loop|omniscient|block] [--simulate N] [--seconds N] [-c name=value] [--json]');
  process.exit(2);
}

const names = (sp, list) => `{${list.map((j) => sp.atoms[j - 1]).join(' ')}}`;

async function main(argv) {
  const a = [...argv];
  const o = { cex: 20, minimal: 200, exact: 3000, seconds: 30, simulate: 0, seed: 1, limit: 200000 };
  const consts = {};
  let target = null;
  const num = (v, name, min = 0) => { const x = Number(v); if (!Number.isFinite(x) || x < min) usage(`bad ${name}`); return x; };
  while (a.length) {
    const x = a.shift();
    if (x === '--instance') o.instance = a.shift() || usage('--instance needs an id');
    else if (x === '--variant') o.variant = a.shift() || usage('--variant needs a name');
    else if (x === '--link') o.link = a.shift() || usage('--link needs a name');
    else if (x === '-c') { const kv = a.shift() || usage('-c needs name=value'); const i = kv.indexOf('='); if (i < 1) usage(`bad constant ${kv}`); consts[kv.slice(0, i)] = kv.slice(i + 1); }
    else if (x === '--limit') o.limit = num(a.shift(), '--limit', 1);
    else if (x === '--candidate') o.candidate = a.shift() || usage('--candidate needs a hex vector');
    else if (x === '--step') o.step = num(a.shift(), '--step', 1);
    else if (x === '--record') o.record = a.shift() || usage('--record needs a file');
    else if (x === '--compare') o.compare = a.shift() || usage('--compare needs a file');
    else if (x === '--cex') o.cex = num(a.shift(), '--cex', 1);
    else if (x === '--minimal') o.minimal = num(a.shift(), '--minimal', 1);
    else if (x === '--justify') o.justify = true;
    else if (x === '--lift') o.lift = true;
    else if (x === '--bounds') { o.bounds = a.shift(); if (!['loop', 'omniscient', 'block'].includes(o.bounds)) usage('--bounds takes loop, omniscient or block'); }
    else if (x === '--exact') o.exact = num(a.shift(), '--exact');
    else if (x === '--simulate') o.simulate = num(a.shift(), '--simulate');
    else if (x === '--seed') o.seed = num(a.shift(), '--seed');
    else if (x === '--seconds') o.seconds = num(a.shift(), '--seconds');
    else if (x === '--json') o.json = true;
    else if (x === '-h' || x === '--help') usage();
    else if (x.startsWith('-')) usage(`unknown option ${x}`);
    else if (target) usage('only one project');
    else target = x;
  }
  if (!target) usage();
  if (o.step && !o.record) usage('--step needs --record');
  let project;
  try { project = loadTarget(target); } catch (e) { console.error(`cannot load ${target}: ${e.message}`); process.exit(2); }
  if (Object.keys(consts).length) project = { ...project, settings: { ...project.settings, constants: { ...project.settings.constants, ...consts } } };
  let res;
  try { res = await Lab.labReport(project, o, nodeExec, LUA, { readRecording, more: runPart }); }
  catch (e) {
    if (o.json) console.log(JSON.stringify({ error: e.message, code: e.code || 1 }));
    else console.error(e.message);
    process.exitCode = e.code || 1;
    return;
  }
  if (o.json) console.log(JSON.stringify(res, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
  else printReport(res);
  process.exitCode = res.code || 0;
}

// --record without --step: the run against the bounds (Feature C). The ladder needs the loop
// scheme's bounds and the omniscient best (computed here when --bounds loop is given) and the simulation.
async function runPart(res, { sp, rec, o, exec }) {
  if (!rec || o.step) return;
  const run = await runReport(exec, sp, rec, { minimalCap: o.minimal, seconds: o.seconds });
  let cmp = null;
  if (o.compare) cmp = await runReport(exec, sp, readRecording(o.compare), { minimalCap: o.minimal, seconds: o.seconds });
  const loop = res.bounds && res.bounds.scheme === 'loop' ? res.bounds : null;
  const omni = loop ? await Lab.bounds(exec, sp, 'omniscient', { seconds: o.seconds, exact: o.exact, minimalCap: o.minimal }) : null;
  const sim = res.simulation && res.simulation.scheme === 'loop' ? res.simulation : null;
  const L = ladder({ sp, run, compare: cmp, loop, omni, sim });
  res.omniscient = omni;
  res.run = { length: run.length, percentile: L.percentile, outside: L.outside, sentence: L.sentence, ladder: L.rungs,
    decomposition: decomposition({ sp, run, loop, omni, sim }), regret: run.rows, top: run.top, lost: run.lost, problems: run.problems,
    shape1: run.shape1, notInOptions: run.notInOptions, deadCand: run.deadCand, compare: cmp ? { length: cmp.length, regret: cmp.rows } : null };
  if (run.problems.some((p) => /expand/.test(p))) res.code = Math.max(res.code, 4);
}

export function printReport(res) {
  const s = res.space;
  console.log(`Space of link ${s.link}${s.instance ? ` [${s.instance}]` : ''}${s.variant ? ` (variant ${s.variant})` : ''}: ${s.candidates} candidates, ${s.solutions} solutions, ${s.bad} bad, ${s.atoms} interface atoms`);
  console.log(`Options: loop ${s.options.loop}, block ${s.options.block}; loop scheme ${s.loopSound === true ? 'sound' : s.loopSound === false ? `UNSOUND (${s.unsoundOptions} options remove a solution)` : `not checked (${s.loopSound})`}`);
  if (res.inspect) {
    const I = res.inspect;
    console.log(`Candidate ${I.hex}${I.step ? ` (step ${I.step})` : ''}: ${I.solution ? 'a solution' : `${I.ncex} counterexamples`}; ${I.aliveCount} alive`);
    if (!I.solution) {
      console.log(`  minimal sound sets: ${I.minimal.length}${I.minimalCapped ? ` (capped at ${I.minimalCap})` : ''}; smallest ${I.smallest ? I.smallest.size : '-'}`);
      console.log(`  forced: ${I.forced.length ? I.forced.map((f) => `${I.atomNames[f.atom - 1]} (the solution {${f.solution.join(' ')}})`).join(', ') : 'none'}`);
      for (const op of I.options) console.log(`  option ${op.atoms.length} atoms, removes ${op.total} (${op.prune} alive)${op.sound ? '' : `, UNSOUND (${op.lost} solutions)`}`);
      console.log(`  ${I.verdict}`);
    }
  }
  if (res.bounds) for (const b of [].concat(res.bounds)) console.log(b.skipped ? `Bounds (${b.scheme}): skipped: ${b.skipped}` : `Bounds (${b.scheme}): best ${b.best.text}; worst ${b.worst.text}${b.note ? `; ${b.note}` : ''}`);
  if (res.simulation && res.simulation.skipped) console.log(`Simulation (${res.simulation.scheme}): skipped: ${res.simulation.skipped}`);
  else if (res.simulation) {
    const m = res.simulation;
    console.log(`Simulation: ${m.random.runs} runs; length min ${m.random.min}, median ${m.random.median}, max ${m.random.max}${m.random.lost ? `; lost solutions in ${m.random.lostRuns} runs` : ''}; greedy best ${m.greedyBest ? m.greedyBest.length : '-'}, greedy worst ${m.greedyWorst ? m.greedyWorst.length : '-'}`);
  }
  if (res.run) {
    const r = res.run;
    console.log(`This run: ${r.length} refinements${r.percentile != null ? `, percentile ${r.percentile.toFixed(1)}` : ''}${r.outside ? ` (${r.outside})` : ''}`);
    for (const f of r.decomposition || []) console.log(`  ${f.factor}: ${f.text}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main(process.argv.slice(2));
