// Audit a CegarPlay project: every candidate and every counterexample of its instance,
// against the solution set (docs/spec-soundness.md section 1).
//
//   node tools/audit.mjs <project.json | library id> [options]
//
//   --link G          the link to audit (needed when several links leave a top solver)
//   --limit N         stop above N candidates (default 200000; exit code 3)
//   -c name=value     set a constant (repeatable)
//   --instance id     audit one instance of the project (format version 2)
//   --seconds N       time limit (default 0 = none)
//   --json            print the verdict as one JSON object
//
// Exit code: 0 sound, 1 unsound (or an error), 2 bad usage, 3 candidate or time limit.
import fs from 'node:fs';
import { load } from '../js/project.js';
import { runProject } from './run.mjs';

const root = new URL('..', import.meta.url);

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/audit.mjs <project.json | library id> [--link G] [--limit N] [-c name=value] [--instance id] [--seconds N] [--json]');
  process.exit(2);
}

export function loadTarget(target) {
  const file = fs.existsSync(target) ? target : /^[A-Za-z0-9_-]+$/.test(target) ? new URL(`examples/${target}.json`, root) : target;
  return load(fs.readFileSync(file, 'utf8'));
}

// Audit a project; returns { verdict, events, problems }.
export async function auditProject(project, { link, limit, seconds = 0, instance, variant, constants, vectors = false } = {}) {
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
  let target = null, json = false, link, limit, seconds = 0, instance;
  const consts = {};
  while (args.length) {
    const a = args.shift();
    if (a === '--link') link = args.shift() || usage('--link needs a name');
    else if (a === '--limit') { limit = Number(args.shift()); if (!(limit > 0)) usage('bad --limit'); }
    else if (a === '--seconds') { seconds = Number(args.shift()); if (!(seconds >= 0)) usage('bad --seconds'); }
    else if (a === '--instance') instance = args.shift() || usage('--instance needs an id');
    else if (a === '-c') { const kv = args.shift() || usage('-c needs name=value'); const i = kv.indexOf('='); if (i < 1) usage(`bad constant ${kv}`); consts[kv.slice(0, i)] = kv.slice(i + 1); }
    else if (a === '--json') json = true;
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else if (target) usage('only one project');
    else target = a;
  }
  if (!target) usage();
  let project;
  try { project = loadTarget(target); } catch (e) { console.error(`cannot load ${target}: ${e.message}`); process.exit(2); }
  let r;
  try { r = await auditProject(project, { link, limit, seconds, instance, constants: Object.keys(consts).length ? consts : undefined }); }
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
  else process.exitCode = v.verdict === 'sound' ? 0 : v.verdict === 'unsound' ? 1 : 3;
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
