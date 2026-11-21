// Run a CegarPlay project headless, with the same engine and runtime as the page.
//
//   node tools/run.mjs <project.json | library id> [options]
//
//   -c name=value     set a constant (repeatable; overrides the project's constants)
//   --solutions N     number of solutions to look for (0 or "all" = all)
//   --seconds N       time limit (0 = none)
//   --trace N         number of trace steps to record (default 0)
//   --json            print every event as one JSON line ({kind, data}) instead of a summary
//   --quiet           do not print the solutions
//
// Exit code: 0 when the run ends without an error, 1 on a problem or error, 2 on bad usage.
import fs from 'node:fs';
import factory from '../vendor/clingo-wasm/clingo.js';
import { load } from '../js/project.js';
import { assemble, parseEvent, validate } from '../js/driver.js';

const root = new URL('..', import.meta.url);

async function engineRun(program, options = '--outf=3') {
  const out = [], err = [];
  const m = await factory({ print: (l) => out.push(l), printErr: (l) => err.push(l) });
  let status;
  try { status = m.ccall('run', 'number', ['string', 'string'], [program, options]); }
  catch (e) { status = 'trap'; err.push(String(e)); }
  return { status, out, err, events: out.map(parseEvent).filter(Boolean) };
}

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/run.mjs <project.json | library id> [-c name=value] [--solutions N|all] [--seconds N] [--trace N] [--json] [--quiet]');
  process.exit(2);
}

export async function runProject(project, { onEvent } = {}) {
  const problems = await validate(project, engineRun);
  const errors = problems.filter((p) => p.severity === 'error');
  if (errors.length) return { problems: errors, events: [] };
  const runtime = fs.readFileSync(new URL('lua/runtime.lua', root), 'utf8');
  const a = assemble(project, problems.compiled, runtime);
  const r = await engineRun(a.program);
  if (onEvent) r.events.forEach(onEvent);
  return { problems: [], events: r.events, status: r.status, err: r.err, assembled: a };
}

async function main(argv) {
  const args = [...argv];
  let target = null;
  const consts = {}, set = {};
  let json = false, quiet = false;
  while (args.length) {
    const a = args.shift();
    if (a === '-c') { const kv = args.shift() || usage('-c needs name=value'); const i = kv.indexOf('='); if (i < 1) usage(`bad constant ${kv}`); consts[kv.slice(0, i)] = kv.slice(i + 1); }
    else if (a === '--solutions') { const v = args.shift(); set.solutions = v === 'all' ? 0 : Number(v); }
    else if (a === '--seconds') set.seconds = Number(args.shift());
    else if (a === '--trace') set.trace = Number(args.shift());
    else if (a === '--json') json = true;
    else if (a === '--quiet') quiet = true;
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else if (target) usage('only one project');
    else target = a;
  }
  if (!target) usage();
  const file = fs.existsSync(target) ? target : /^[A-Za-z0-9_-]+$/.test(target) ? new URL(`examples/${target}.json`, root) : target;
  let project;
  try { project = load(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`cannot load ${target}: ${e.message}`); process.exit(1); }
  project.settings = { ...project.settings, trace: 0, ...set, constants: { ...project.settings.constants, ...consts } };
  for (const k of Object.keys(set)) if (!Number.isFinite(project.settings[k]) || project.settings[k] < 0) usage(`bad value for --${k}`);

  const r = await runProject(project);
  if (r.problems.length) {
    for (const p of r.problems) {
      const w = p.where;
      console.error(`${w.kind === 'loop' ? 'loop' : w.name}${w.line ? `:${w.line}:${w.col || 1}` : ''}: ${p.severity}: ${p.message}`);
    }
    process.exit(1);
  }
  if (json) {
    for (const e of r.events) console.log(JSON.stringify(e));
  } else {
    for (const e of r.events) {
      const d = e.data;
      if (e.kind === 'M' && !quiet) console.log(`Solution ${d.n}: ${d.atoms}${d.cost ? `  cost ${JSON.stringify(d.cost)}` : ''}`);
      else if (e.kind === 'L') console.log(`log: ${d.text}`);
      else if (e.kind === 'W') console.log(`clingo (${d.solver}): ${d.message}`);
      else if (e.kind === 'E') console.log(`error: ${d.message}`);
    }
    const S = r.events.filter((e) => e.kind === 'S').at(-1)?.data;
    const D = r.events.filter((e) => e.kind === 'D').at(-1)?.data;
    if (!D) { console.log(`the engine stopped without a result (status ${r.status}); ${r.err.join(' ')}`); process.exit(1); }
    console.log(`Outcome: ${D.outcome}${D.detail ? ` (${D.detail})` : ''}; exhausted: ${D.exhausted}`);
    if (S) {
      console.log(`Solutions: ${S.solutions}; candidates: ${S.candidates}; counterexamples: ${S.counterexamples}; clauses: ${S.clauses}; time: ${S.t} s`);
      if (S.counters && Object.keys(S.counters).length) console.log(`Counters: ${JSON.stringify(S.counters)}`);
    }
  }
  const D = r.events.filter((e) => e.kind === 'D').at(-1)?.data;
  process.exit(D && D.outcome !== 'error' ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
