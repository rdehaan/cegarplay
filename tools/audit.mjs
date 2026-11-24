// Audit a CegarPlay project: every candidate and every counterexample of its instance,
// against the solution set (docs/spec-soundness.md section 1).
//
//   node tools/audit.mjs <project.json | library id> [options]
//
//   --link G          the link to audit (needed when several links leave a top solver)
//   --limit N         stop above N candidates (default 200000; exit code 3)
//   -c name=value     set a constant (repeatable)
//   --instance id     audit one instance of the project (format version 2); 'all': every
//                     instance not marked audit: false, one line each
//   --variant NAME    audit a variant of the project
//   --seconds N       time limit (default 0 = none)
//   --json            print the verdict as one JSON object
//   --symbolic        the symbolic audit (lua/bounded.lua): one search instead of enumeration
//   --no-fewest       (symbolic) any witness, not one with the fewest differing atoms
//   --space NAME      bounded verification over the project's space NAME, k = 1..K (or
//   --bound K           --from K0..K): sound for every instance up to K, or the first breaking k
//   --from K0
//
// Exit code: 0 sound, 1 unsound (or an error), 2 bad usage, 3 candidate or time limit (or the
// symbolic audit's time budget), 4 unsupported (symbolic audit).
import fs from 'node:fs';
import { load, auditable } from '../js/project.js';
import { runProject, engineRun } from './run.mjs';
import { verifySpace } from '../js/bounded.js';

const root = new URL('..', import.meta.url);

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/audit.mjs <project.json | library id> [--link G] [--limit N] [-c name=value] [--instance id|all] [--variant NAME] [--seconds N] [--symbolic [--no-fewest]] [--space NAME --bound K [--from K0]] [--json]');
  process.exit(2);
}

export function loadTarget(target) {
  const file = fs.existsSync(target) ? target : /^[A-Za-z0-9_-]+$/.test(target) ? new URL(`examples/${target}.json`, root) : target;
  return load(fs.readFileSync(file, 'utf8'));
}

// Audit a project; returns { verdict, events, problems }.
// symbolic: the symbolic audit (seconds is its budget, default 60; fewest: the witness order).
export async function auditProject(project, { link, limit, seconds = 0, instance, variant, constants, vectors = false, symbolic = false, fewest = true, space = false } = {}) {
  if (symbolic) {
    const budget = seconds > 0 ? seconds : 60;
    const r = await runProject({ ...project, settings: { ...project.settings, seconds: budget } },
      { bounded: { link, seconds: budget, fewest, space }, instance, variant, constants, backstop: true });
    let A = (r.events || []).filter((e) => e.kind === 'A' && e.data.verdict).map((e) => e.data).at(-1) || null;
    if (!A && r.status === 'timeout') A = { verdict: 'budget', mode: 'symbolic', seconds: budget };
    const D = (r.events || []).filter((e) => e.kind === 'D').map((e) => e.data).at(-1) || null;
    const E = (r.events || []).filter((e) => e.kind === 'E').map((e) => e.data).at(-1) || null;
    return { verdict: A, done: D, error: E, problems: r.problems || [], status: r.status, vectors: null, events: r.events || [] };
  }
  const r = await runProject({ ...project, settings: { ...project.settings, seconds } },
    { audit: { link, limit, vectors }, instance, variant, constants, backstop: seconds > 0 });
  const A = (r.events || []).filter((e) => e.kind === 'A' && e.data.verdict).map((e) => e.data).at(-1) || null;
  const D = (r.events || []).filter((e) => e.kind === 'D').map((e) => e.data).at(-1) || null;
  const E = (r.events || []).filter((e) => e.kind === 'E').map((e) => e.data).at(-1) || null;
  const P = { candidates: [], solutions: [] };
  for (const e of r.events || []) if (e.kind === 'P') P[e.data.set].push(...e.data.v);
  return { verdict: A, done: D, error: E, problems: r.problems || [], status: r.status, vectors: vectors ? P : null, events: r.events || [] };
}

function names(list) { return `{${(list || []).join(' ')}}`; }

async function main(argv) {
  const args = [...argv];
  let target = null, json = false, link, limit, seconds = 0, instance, variant, symbolic = false, fewest = true, space = null, bound = null, from;
  const consts = {};
  while (args.length) {
    const a = args.shift();
    if (a === '--link') link = args.shift() || usage('--link needs a name');
    else if (a === '--limit') { limit = Number(args.shift()); if (!(limit > 0)) usage('bad --limit'); }
    else if (a === '--seconds') { seconds = Number(args.shift()); if (!(seconds >= 0)) usage('bad --seconds'); }
    else if (a === '--instance') instance = args.shift() || usage('--instance needs an id');
    else if (a === '--variant') variant = args.shift() || usage('--variant needs a name');
    else if (a === '-c') { const kv = args.shift() || usage('-c needs name=value'); const i = kv.indexOf('='); if (i < 1) usage(`bad constant ${kv}`); consts[kv.slice(0, i)] = kv.slice(i + 1); }
    else if (a === '--json') json = true;
    else if (a === '--symbolic') symbolic = true;
    else if (a === '--no-fewest') fewest = false;
    else if (a === '--space') space = args.shift() || usage('--space needs a name');
    else if (a === '--bound') { bound = Number(args.shift()); if (!Number.isInteger(bound) || bound < 0) usage('bad --bound'); }
    else if (a === '--from') { from = Number(args.shift()); if (!Number.isInteger(from) || from < 0) usage('bad --from'); }
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else if (target) usage('only one project');
    else target = a;
  }
  if (!target) usage();
  let project;
  try { project = loadTarget(target); } catch (e) { console.error(`cannot load ${target}: ${e.message}`); process.exit(2); }
  if (space) {
    let r;
    try { r = await spaceAudit(project, { space, from, to: bound ?? undefined, seconds, link, variant, fewest }); }
    catch (e) { console.error(e.message); process.exitCode = 2; return; }
    if (json) console.log(JSON.stringify(r));
    else {
      const B = r.bound || 'k';
      for (const row of r.perK) console.log(`${B} = ${row.k}${row.params ? `, ${Object.entries(row.params).map(([a, x]) => `${a} = ${x}`).join(', ')}` : ''}: ${row.verdict}${row.rounds != null ? `; ${row.rounds} rounds` : ''}${row.t != null ? `; ${row.t.toFixed(2)} s` : ''}`);
      if (r.verdict === 'error') console.log(`error: ${r.reason}`);
      else printSymbolic({ ...(r.last || {}), verdict: r.verdict, mode: 'space', space, k: r.k, bound: r.bound, params: r.params, witness: r.witness, reason: r.reason, seconds: seconds || 60 });
    }
    process.exitCode = r.verdict === 'error' ? 2 : exitCode({ verdict: r.verdict });
    return;
  }
  // --instance all: every instance not marked audit: false, one line each
  if (instance === 'all') {
    const list = auditable(project);
    const skipped = (project.instances || []).length - list.length;
    let worst = 0;
    for (const x of list) {
      const a = await auditProject(project, { link, limit, seconds, instance: x.id, variant, constants: Object.keys(consts).length ? consts : undefined, symbolic, fewest });
      const v = a.verdict;
      const what = a.problems.length ? `problem: ${a.problems[0].message}` : !v ? `no verdict (${a.done ? a.done.outcome : a.status})`
        : v.mode ? `${v.verdict === 'unsound' ? 'UNSOUND' : v.verdict}${v.reason ? ` (${v.reason})` : ''}; ${v.rounds ?? '?'} rounds, ${v.refinements ?? '?'} refinements; ${v.t != null ? v.t.toFixed(2) : '?'} s`
        : v.verdict === 'unsound' ? `UNSOUND (${v.unsound} of ${v.pairs} pairs)` : v.verdict;
      console.log(json ? JSON.stringify({ instance: x.id, ...(v || { verdict: 'error' }) }) : `${x.id}: ${what}`);
      const code = exitCode(v);
      worst = code === 1 || worst === 1 ? 1 : Math.max(worst, code);
    }
    if (!json && skipped) console.log(`(${skipped} instance${skipped === 1 ? '' : 's'} with audit off skipped)`);
    process.exitCode = worst;
    return;
  }
  if (instance && (project.instances || []).some((x) => x.id === instance && x.audit === false)) console.error(`note: instance ${instance} is marked audit: false`);
  let r;
  try { r = await auditProject(project, { link, limit, seconds, instance, variant, constants: Object.keys(consts).length ? consts : undefined, symbolic, fewest }); }
  catch (e) { console.error(e.message); process.exitCode = 2; return; }
  if (r.problems.length) {
    for (const p of r.problems) console.error(`${p.where?.name || p.where?.kind || 'project'}${p.where?.line ? ':' + p.where.line : ''}: ${p.severity}: ${p.message}`);
    process.exitCode = 2;
    return;
  }
  const v = r.verdict;
  if (json) console.log(JSON.stringify(v ? { ...v, outcome: r.done?.outcome } : { verdict: 'error', outcome: r.done?.outcome, error: r.error?.message || r.done?.detail || null }));
  else if (!v) console.log(`no verdict: ${r.error ? r.error.message : r.done ? `${r.done.outcome} ${r.done.detail}` : `engine status ${r.status}`}`);
  else if (v.verdict === 'limit') console.log(`Limit: more than ${v.limit} candidates`);
  else if (v.mode) printSymbolic(v);
  else {
    console.log(`Audit of link ${v.link} (${v.kinds.join(', ')}): ${v.candidates} candidates, ${v.solutions} solutions, ${v.counterexamples} counterexamples, ${v.pairs} pairs`);
    if (v.verdict === 'sound') console.log('Sound for every candidate and counterexample of this instance');
    else {
      console.log(`UNSOUND: ${v.unsound} of ${v.pairs} pairs; ${v.at_risk} solutions at risk`);
      const w = v.witness;
      if (w) {
        console.log(`Witness: candidate ${names(w.candidate)}, counterexample [${w.counterexample}]`);
        if (w.kind === 'clause') console.log(`  relevant ${names(w.relevant)}`);
        else console.log(`  ${w.part} grounded with ${(w.facts || []).join(' ')}`);
        console.log(`  lost solution ${names(w.solution)}; candidate and solution differ on ${names(w.differ)}`);
      }
    }
    if (v.empty) console.log(`${v.empty} counterexamples have no relevant atom`);
  }
  if (!v) process.exitCode = r.done?.outcome === 'limit' ? 3 : 1;
  else process.exitCode = exitCode(v);
}

// Bounded verification over a space (js/bounded.js verifySpace with the headless engine).
export async function spaceAudit(project, { space, from, to, seconds = 0, link, variant, fewest = true, onK } = {}) {
  const budget = seconds > 0 ? seconds : 60;
  return verifySpace(project, { space, from, to, seconds: budget, variant, onK, env: {
    engineRun,
    runBounded: async (p, { seconds: s }) => {
      const r = await auditProject(p, { symbolic: true, seconds: s, link, fewest, space: true });
      if (r.problems.length) return { verdict: 'error', reason: r.problems[0].message };
      if (!r.verdict && r.error) return { verdict: 'error', reason: r.error.message };
      return r.verdict;
    },
  } });
}

function exitCode(v) {
  if (!v) return 1;
  return v.verdict === 'sound' ? 0 : v.verdict === 'unsound' ? 1 : v.verdict === 'unsupported' ? 4 : 3;
}

// A symbolic (or space) verdict as text.
export function printSymbolic(v, log = console.log) {
  const B = v.bound || 'k';
  const at = [`${B} = ${v.k}`, ...Object.entries(v.params || {}).map(([a, x]) => `${a} = ${x}`)].join(', ');
  const where = v.mode === 'space' && v.k != null ? ` (space ${v.space || ''}, ${at})` : '';
  log(`Symbolic audit of link ${v.link || '?'}${(v.kinds || []).length ? ` (${v.kinds.join(', ')})` : ''}${where}: ${v.rounds ?? 0} rounds, ${v.refinements ?? 0} refinements${v.fallback ? ` (${v.fallback} blocks)` : ''}${v.t != null ? `, ${v.t.toFixed(2)} s` : ''}`);
  if (v.verdict === 'sound') log(v.mode === 'space' ? `Sound for every instance of the space up to ${B} = ${v.k}` : 'Sound for every candidate and counterexample of this instance');
  else if (v.verdict === 'budget') log(`Budget: no verdict within ${v.seconds} s`);
  else if (v.verdict === 'unsupported') log(`Unsupported: ${v.reason}`);
  else if (v.verdict === 'unsound') {
    log('UNSOUND');
    const w = v.witness;
    if (w) {
      if (w.instance != null) log(`Instance (${B} = ${w.k ?? v.k}): ${w.instance}`);
      log(`Witness: candidate ${names(w.candidate)}, counterexample [${w.counterexample}]`);
      if (w.kind === 'clauses') log(`  clause ${names(w.clause)}`);
      else log(`  relevant ${names(w.relevant)}`);
      log(`  lost solution ${names(w.solution)}; candidate and solution differ on ${names(w.differ)}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
