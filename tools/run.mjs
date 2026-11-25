// Run a CegarPlay project headless, with the same engine and runtime as the page.
//
//   node tools/run.mjs <project.json | library id> [options]
//
//   -c name=value     set a constant (repeatable; overrides the project's constants)
//   --solutions N     number of solutions to look for (0 or "all" = all)
//   --seconds N       time limit (0 = none)
//   --trace N         number of trace steps to record (default 0)
//   --instance ID     run one instance of the project (format version 2); "all" runs each
//                     and prints one line per instance (exit 1 on an expected-count mismatch)
//   --variant NAME    run a variant of the project
//   --record FILE     write the run as a recording (.cprec, gzip): every step and call unless
//                     --record-steps POLICY[:N] says otherwise (off|first|every|last|sample|all)
//   --proof FILE      write a proof log (every step, counterexamples and certificate levels, plain
//                     JSON lines) for tools/certcheck.py
//   --json            print every event as one JSON line ({kind, data}) instead of a summary
//   --quiet           do not print the solutions
//
// Exit code: 0 when the run ends without an error, 1 on a problem or error, 2 on bad usage.
// With a time limit above 0 the run is ended N + 2 s after the start (exit code 1) if the
// runtime does not stop by itself, like the page's backstop.
import { resolveProject } from '../js/instances.js';
import fs from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import factory from '../vendor/clingo-wasm/clingo.js';
import { load, derive, pickedVariant, ProjectError, expectedCheck, costTracker, costText } from '../js/project.js';
import { Recording } from '../js/recording.js';
import { hashText } from '../js/stats.js';
import { assemble, parseEvent, validate, auditPlan, auditBody, boundedPlan, boundedBody, modulesFor, refinementCounts } from '../js/driver.js';

const root = new URL('..', import.meta.url);

export async function engineRun(program, options = '--outf=3') {
  const out = [], err = [];
  const m = await factory({ print: (l) => out.push(l), printErr: (l) => err.push(l) });
  let status;
  try { status = m.ccall('run', 'number', ['string', 'string'], [program, options]); }
  catch (e) { status = 'trap'; err.push(String(e)); }
  return { status, out, err, events: out.map(parseEvent).filter(Boolean) };
}

// The engine call blocks its thread: a run with a backstop goes to a worker thread.
if (!isMainThread && workerData?.cegarplayRun) {
  engineRun(workerData.program).then((r) => parentPort.postMessage(r));
}
function engineRunWithin(program, ms) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { cegarplayRun: true, program } });
    const timer = setTimeout(() => { w.terminate(); resolve({ status: 'timeout', out: [], err: [], events: [] }); }, ms);
    w.once('message', (r) => { clearTimeout(timer); w.terminate(); resolve(r); });
    w.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/run.mjs <project.json | library id> [-c name=value] [--solutions N|all] [--seconds N] [--trace N] [--instance ID|all] [--variant NAME] [--json] [--quiet]');
  process.exit(2);
}

const lua = (name) => fs.readFileSync(new URL(`lua/${name}`, root), 'utf8');

// audit: { link, limit } runs the audit mode (lua/audit.lua) instead of the loop.
// instance, variant: derive the plain project first (js/project.js derive); constants given
// here override the instance's.
// bounded: { link, seconds, fewest, space } runs the symbolic audit (lua/bounded.lua).
export async function runProject(project, { onEvent, backstop = false, audit = null, bounded = null, instance, variant, constants } = {}) {
  const t0 = Date.now();
  try {
    project = await resolveProject(project, instance, engineRun, { draw: lua('draw.lua'), generate: lua('generate.lua') });
  } catch (e) {
    if (e instanceof ProjectError) throw e;      // an unknown instance: a usage error, as before
    return { problems: [{ severity: 'error', message: e.message }], events: [] };
  }
  // like the page: without --variant, the variant picked in the project's settings (if it exists)
  if (variant === undefined) variant = pickedVariant(project);
  project = derive(project, { instance, variant });
  if (constants) project = { ...project, settings: { ...project.settings, constants: { ...project.settings.constants, ...constants } } };
  const problems = await validate(project, engineRun);
  const errors = problems.filter((p) => p.severity === 'error');
  if (errors.length) return { problems: errors, events: [] };
  const runtime = lua('runtime.lua');
  let opts = { modules: modulesFor(project.settings, { compiled: problems.compiled, loop: project.loop }).map((m) => lua(`${m}.lua`)) };
  if (audit) {
    const plan = auditPlan(problems.compiled, audit.link);
    if (plan.error) return { problems: [{ severity: 'error', message: plan.error, where: { kind: 'loop' } }], events: [] };
    opts = { modules: [...opts.modules, lua('audit.lua')], body: auditBody(problems.compiled, plan, { limit: audit.limit, vectors: audit.vectors }) };
    project = { ...project, settings: { ...project.settings, solutions: 0, candidates: 0, trace: 0 } };
  }
  if (bounded) {
    const plan = boundedPlan(problems.compiled, bounded.link);
    if (plan.error) return { problems: [{ severity: 'error', message: plan.error, where: { kind: 'loop' } }], events: [] };
    opts = { modules: modulesFor(project.settings, { mode: 'bounded' }).map((m) => lua(`${m}.lua`)),
      body: boundedBody(problems.compiled, plan, { seconds: bounded.seconds, fewest: bounded.fewest !== false, space: bounded.space }) };
    project = { ...project, settings: { ...project.settings, solutions: 0, candidates: 0, trace: 0 } };
  }
  const a = assemble(project, problems.compiled, runtime, opts);
  const seconds = project.settings.seconds || 0;
  const r = backstop && seconds > 0
    ? await engineRunWithin(a.program, Math.max(0, (seconds + 2) * 1000 - (Date.now() - t0)))
    : await engineRun(a.program);
  if (onEvent) r.events.forEach(onEvent);
  return { problems: [], events: r.events, status: r.status, err: r.err, assembled: a, project };
}

// A recording of a finished headless run (the same file the page writes).
export function recordingOf(project, events, extra = {}) {
  const rec = new Recording({ title: project.title || '', instance: project.instance || null, variant: project.variant || null, engine: 'clingo-wasm (node)', ...extra });
  for (const e of events) rec.add(e.kind, e.data);
  return rec;
}

async function main(argv) {
  const args = [...argv];
  let target = null;
  const consts = {}, set = {};
  let json = false, quiet = false, instance, variant, recordFile = null, recordSteps = null, proofFile = null;
  while (args.length) {
    const a = args.shift();
    if (a === '-c') { const kv = args.shift() || usage('-c needs name=value'); const i = kv.indexOf('='); if (i < 1) usage(`bad constant ${kv}`); consts[kv.slice(0, i)] = kv.slice(i + 1); }
    else if (a === '--solutions') { const v = args.shift(); set.solutions = v === 'all' ? 0 : Number(v); }
    else if (a === '--seconds') set.seconds = Number(args.shift());
    else if (a === '--trace') set.trace = Number(args.shift());
    else if (a === '--instance') instance = args.shift() || usage('--instance needs an id or all');
    else if (a === '--variant') variant = args.shift() || usage('--variant needs a name');
    else if (a === '--record') recordFile = args.shift() || usage('--record needs a file');
    else if (a === '--record-steps') recordSteps = args.shift() || usage('--record-steps needs a policy');
    else if (a === '--proof') proofFile = args.shift() || usage('--proof needs a file');
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
  project.settings = { ...project.settings, trace: 0, ...set };
  for (const k of Object.keys(set)) if (!Number.isFinite(project.settings[k]) || project.settings[k] < 0) usage(`bad value for --${k}`);
  const constants = Object.keys(consts).length ? consts : undefined;
  if (recordFile || recordSteps) {
    const [steps, n] = (recordSteps || 'all').split(':');
    if (!['off', 'first', 'every', 'last', 'sample', 'all'].includes(steps)) usage(`bad --record-steps ${recordSteps}`);
    project.settings.record = { steps, n: Number(n) || 0, calls: true };
  }

  if (instance === 'all') {
    const list = project.instances || [];
    if (!list.length) { console.error(`${target} has no instances`); process.exitCode = 1; return; }
    let bad = 0;
    for (const x of list) {
      const r = await runProject(project, { backstop: true, instance: x.id, variant, constants });
      const S = r.events.filter((e) => e.kind === 'S').at(-1)?.data;
      const D = r.events.filter((e) => e.kind === 'D').at(-1)?.data;
      const got = S ? S.solutions : null;
      const t = costTracker();
      for (const e of r.events) if (e.kind === 'M') t.add(e.data.cost);
      const v = expectedCheck(x.expected, D && { outcome: D.outcome, exhausted: D.exhausted === true, solutions: got, cost: t.cost, same: t.same });
      const mismatch = v.checked && !v.ok;
      if (mismatch || (r.problems && r.problems.length) || !D || D.outcome === 'error') bad++;
      const what = r.problems && r.problems.length ? `problem: ${r.problems[0].message}` : !D ? `no result (${r.status})`
        : `${got} solutions${t.n && (t.cost || !t.same) ? `, cost ${costText(t.cost)}${t.same ? '' : ' (costs differ)'}` : ''}; ${D.outcome}${D.exhausted ? ' (exhausted)' : ''}; ${S ? S.candidates : '?'} candidates; ${S ? S.t : '?'} s`;
      console.log(`${x.id}: ${what}${v.want ? (mismatch ? `; MISMATCH: expected ${v.want}` : v.checked ? '; as expected' : `; expected ${v.want}`) : ''}`);
    }
    process.exitCode = bad ? 1 : 0;
    return;
  }

  if (proofFile) project.settings = { ...project.settings, record: { steps: 'all', n: 0, calls: false, proof: true } };
  let r;
  try { r = await runProject(project, { backstop: true, instance, variant, constants }); }
  catch (e) { console.error(e.message); process.exitCode = 2; return; }
  if (r.problems.length) {
    for (const p of r.problems) {
      const w = p.where;
      console.error(`${w.kind === 'loop' ? 'loop' : w.name}${w.line ? `:${w.line}:${w.col || 1}` : ''}: ${p.severity}: ${p.message}`);
    }
    process.exit(1);
  }
  if (r.status === 'timeout') {
    console.log(`Outcome: limit (the run did not stop at the time limit of ${project.settings.seconds} s; ended after ${project.settings.seconds + 2} s)`);
    process.exitCode = 1;
    return;
  }
  if (proofFile) {
    const d = r.project;
    const rec = recordingOf(d, r.events, { fragmentsHash: hashText(JSON.stringify([d.fragments.map((f) => [f.name, f.text]), d.settings.constants])) });
    fs.writeFileSync(proofFile, rec.text());
  }
  if (recordFile) {
    const rec = recordingOf(project, r.events);
    fs.writeFileSync(recordFile, Buffer.from(await (await rec.toBlob()).arrayBuffer()));
  }
  if (json) {
    for (const e of r.events) console.log(JSON.stringify(e));
  } else {
    for (const e of r.events) {
      const d = e.data;
      if (e.kind === 'M' && !quiet) console.log(`Solution ${d.n}: ${d.atoms}${d.cost ? `  cost ${JSON.stringify(d.cost)}` : ''}`);
      else if (e.kind === 'N' && !quiet) console.log(`${d.label} ${d.n}: ${d.atoms}${d.cost ? `  cost ${JSON.stringify(d.cost)}` : ''}`);
      else if (e.kind === 'L') console.log(`log: ${d.text}`);
      else if (e.kind === 'W') console.log(`clingo (${d.solver}): ${d.message}`);
      else if (e.kind === 'E') console.log(`error: ${d.message}`);
    }
    const S = r.events.filter((e) => e.kind === 'S').at(-1)?.data;
    const D = r.events.filter((e) => e.kind === 'D').at(-1)?.data;
    if (!D) { console.log(`the engine stopped without a result (status ${r.status}); ${r.err.join(' ')}`); process.exitCode = 1; return; }
    console.log(`Outcome: ${D.outcome}${D.detail ? ` (${D.detail})` : ''}; exhausted: ${D.exhausted}`);
    if (S) {
      console.log(`Solutions: ${S.solutions}; candidates: ${S.candidates}; counterexamples: ${S.counterexamples}; clauses: ${S.clauses}; time: ${S.t} s`);
      // refinements by source and per link (manual: Counting); a counterexample is a model that refuted a candidate
      const rc = refinementCounts(S);
      if (rc.split) console.log(`Refinements: ${rc.total} (from counterexamples ${rc.from_models}, from cores ${rc.from_cores}, blocks ${rc.blocks}${rc.other ? `, other ${rc.other}` : ''})`);
      for (const [name, x] of Object.entries(S.links || {})) console.log(`  link ${name}: counterexamples ${x.counterexamples}; from counterexamples ${x.from_models}, from cores ${x.from_cores}, blocks ${x.blocks}${x.other ? `, other ${x.other}` : ''}`);
      if (S.counters && Object.keys(S.counters).length) console.log(`Counters: ${JSON.stringify(S.counters)}`);
      if (S.labels && Object.keys(S.labels).length) console.log(`Accepted as: ${Object.entries(S.labels).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      if (S.partials) console.log(`Partial checks: ${S.partials}`);
      if (S.minimised) console.log(`Minimised cores: ${S.minimised}`);
    }
    // track statements: each series in order (the first 30 values)
    const tracks = new Map();
    for (const e of r.events) if (e.kind === 'V') { if (!tracks.has(e.data.n)) tracks.set(e.data.n, []); tracks.get(e.data.n).push(e.data.v); }
    for (const [n, vs] of tracks) console.log(`Tracked ${n}: ${vs.slice(0, 30).join(' ')}${vs.length > 30 ? ` ... (${vs.length} values, last ${S && S.tracked ? S.tracked[n] : vs.at(-1)})` : ''}`);
  }
  const D = r.events.filter((e) => e.kind === 'D').at(-1)?.data;
  // exitCode, not process.exit(): exit() drops output still buffered for a pipe
  process.exitCode = D && D.outcome !== 'error' ? 0 : 1;
}

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
