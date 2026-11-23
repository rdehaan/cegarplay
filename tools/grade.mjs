// Grade self-checking exercises headless (FUTURE-DIRECTIONS F1): the checks of the page's
// "Check exercise" button, for one project or a folder of submissions.
//
//   node tools/grade.mjs <project.json | folder | library id> ... [--exercise reference.json]
//                        [--seconds N] [--json]
//
// Each project's exercise block names instances whose expected count or optimum must match,
// instances whose audit must be sound, and budgets (at most N candidates or refinements on an
// instance). With --exercise, the exercise block and the instances (with their expectations)
// come from the reference project, and only the fragments, the loop and the settings from each
// submission, so a submission cannot change what it is graded against.
// Prints one line per item and a summary per project; --json prints one JSON object per project.
// Exit code 0 when every project passes every item, 1 otherwise, 2 on bad usage.
import fs from 'node:fs';
import path from 'node:path';
import { load, exerciseItems, gradeItem, exerciseSummary, costTracker } from '../js/project.js';
import { runProject } from './run.mjs';
import { auditProject, loadTarget } from './audit.mjs';

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/grade.mjs <project.json | folder | library id> ... [--exercise reference.json] [--seconds N] [--json]');
  process.exit(2);
}

// The result of one run with all solutions, as gradeItem reads it.
async function runOne(project, instance, seconds) {
  const p = { ...project, settings: { ...project.settings, solutions: 0, trace: 0, seconds: seconds || project.settings.seconds } };
  const r = await runProject(p, { instance, backstop: true });
  if (r.problems && r.problems.length) return { outcome: 'error', detail: r.problems[0].message };
  const ev = (k) => (r.events || []).filter((e) => e.kind === k).map((e) => e.data);
  const D = ev('D').at(-1), S = ev('S').at(-1);
  const t = costTracker();
  for (const m of ev('M')) if (m.cost !== undefined && m.cost !== null) t.add(m.cost);
  if (!D || !S) return { outcome: 'error' };
  return { outcome: D.outcome, exhausted: D.exhausted === true, solutions: S.solutions, cost: t.n ? t.cost : null, same: t.same,
    candidates: S.candidates, refinements: (S.clauses || 0) + (S.expansions || 0) };
}

export async function gradeProject(project, { seconds = 0 } = {}) {
  const items = exerciseItems(project);
  const runs = new Map(), audits = new Map();
  const graded = [];
  for (const it of items) {
    const inst = (project.instances || []).find((i) => i.id === it.instance);
    let res;
    if (it.kind === 'audit') {
      if (!audits.has(it.instance)) {
        const a = await auditProject(project, { instance: it.instance, seconds });
        audits.set(it.instance, a.verdict || { outcome: a.done ? a.done.outcome : 'error' });
      }
      res = audits.get(it.instance);
    } else {
      if (!runs.has(it.instance)) runs.set(it.instance, await runOne(project, it.instance, seconds));
      res = runs.get(it.instance);
    }
    graded.push({ ...it, ...gradeItem(it, inst, res) });
  }
  return { items: graded, summary: exerciseSummary(graded) };
}

// A submission with the reference's exercise and instances.
export function withReference(sub, ref) {
  return { ...sub, instances: structuredClone(ref.instances || []), exercise: structuredClone(ref.exercise),
    generators: ref.generators ? structuredClone(ref.generators) : sub.generators };
}

async function main(argv) {
  const args = [...argv];
  const targets = [];
  let ref = null, json = false, seconds = 0;
  while (args.length) {
    const a = args.shift();
    if (a === '--exercise') { const f = args.shift() || usage('--exercise needs a file'); try { ref = loadTarget(f); } catch (e) { usage(`${f}: ${e.message}`); } }
    else if (a === '--seconds') { seconds = Number(args.shift()); if (!(seconds > 0)) usage('--seconds needs a number > 0'); }
    else if (a === '--json') json = true;
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else targets.push(a);
  }
  if (!targets.length) usage();
  if (ref && !ref.exercise) usage('the reference project has no exercise block');
  const files = [];
  for (const t of targets) {
    if (fs.existsSync(t) && fs.statSync(t).isDirectory()) {
      for (const f of fs.readdirSync(t).filter((x) => x.endsWith('.json')).sort()) files.push(path.join(t, f));
    } else files.push(t);
  }
  let allPass = true;
  for (const f of files) {
    let p;
    try { p = loadTarget(f); } catch (e) { allPass = false; console.log(json ? JSON.stringify({ file: f, error: e.message }) : `${f}: cannot load: ${e.message}`); continue; }
    if (ref) p = load(JSON.stringify(withReference(p, ref)));
    if (!p.exercise) { allPass = false; console.log(json ? JSON.stringify({ file: f, error: 'no exercise block' }) : `${f}: no exercise block (use --exercise)`); continue; }
    const g = await gradeProject(p, { seconds });
    if (!g.summary.pass) allPass = false;
    if (json) console.log(JSON.stringify({ file: f, pass: g.summary.pass, ok: g.summary.ok, n: g.summary.n, items: g.items }));
    else {
      console.log(`${f}: ${g.summary.text}`);
      for (const it of g.items) console.log(`  ${it.ok ? '✓' : '✗'} ${it.label} (${it.detail})`);
    }
  }
  process.exit(allPass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
