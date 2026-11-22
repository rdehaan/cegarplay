// Fuzz and diagnose (docs/spec-instances.md section 6): walk instances from small to large, ask
// the audit for a verdict on each, shrink the first unsound one, and name the refinement that
// removes a solution. No DOM, no Node APIs.
import { derive } from './project.js';
import { validate, assemble, modulesFor, auditPlan, auditBody, declarationLines, parseEvent } from './driver.js';
import { suiteInstances, Reducer, cellProject } from './campaign.js';
import { resolveProject } from './instances.js';
import { Recording } from './recording.js';
import { shrink, shrinkConstants, normaliseFacts } from './shrink.js';

// env: { engineRun, runtime, modules: { audit, ground, replay }, luaTexts }

// The default source: a constants grid 1..v over each numeric constant of the project.
export function defaultSource(project) {
  const c = {};
  for (const [k, v] of Object.entries(project.settings.constants || {})) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 50) c[k] = Array.from({ length: n }, (_, i) => i + 1);
  }
  return Object.keys(c).length ? { constants: c } : { ids: 'all' };
}

const size = (params) => Object.values(params || {}).reduce((a, v) => (typeof v === 'number' || /^\d+$/.test(String(v)) ? a * Number(v) : a), 1);

// The instances of a source, smallest first (by the product of their numeric parameters).
export function fuzzInstances(project, source) {
  const list = suiteInstances(project, { name: 'fuzz', instances: source });
  return list.map((x, i) => ({ ...x, order: i })).sort((a, b) => size(a.params) - size(b.params) || a.order - b.order);
}

async function runEvents(program, env) {
  const r = await env.engineRun(program, '--outf=3');
  return { status: r.status, events: (r.out || []).map(parseEvent).filter(Boolean) };
}

// The audit of a plain (derived) project: { verdict } (the A event) | { error } | { noAudit }.
export async function auditOf(d, env) {
  const problems = await validate(d, env.engineRun);
  const errs = problems.filter((p) => p.severity === 'error');
  if (errs.length) return { error: errs[0].message };
  const compiled = problems.compiled;
  if (!compiled) return { noAudit: 'a raw Lua loop has no audit' };
  const plan = auditPlan(compiled);
  if (plan.error) return { noAudit: plan.error };
  const run = { ...d, settings: { ...d.settings, solutions: 0, candidates: 0, trace: 0 } };
  const mods = [...modulesFor(run.settings, { compiled, loop: run.loop }).map((m) => env.modules[m]), env.modules.audit];
  const a = assemble(run, compiled, env.runtime, { modules: mods, body: auditBody(compiled, plan) });
  const r = await runEvents(a.program, env);
  const A = r.events.filter((e) => e.kind === 'A' && e.data.verdict).map((e) => e.data).at(-1);
  const E = r.events.find((e) => e.kind === 'E');
  if (!A) return { error: E ? E.data.message : `the audit ended without a verdict (${r.status})` };
  return { verdict: A, plan };
}

// A run with all solutions: the reducer's result.
export async function countOf(d, env, { record = null } = {}) {
  const problems = await validate(d, env.engineRun);
  const errs = problems.filter((p) => p.severity === 'error');
  if (errs.length) return { error: errs[0].message };
  const compiled = d.loop.language === 'loop' ? problems.compiled : null;
  const run = { ...d, settings: { ...d.settings, solutions: 0, trace: 0, ...(record ? { record } : {}) } };
  const a = assemble(run, compiled, env.runtime, { modules: modulesFor(run.settings, { compiled, loop: run.loop }).map((m) => env.modules[m]) });
  const r = await runEvents(a.program, env);
  const red = new Reducer();
  for (const e of r.events) red.add(e.kind, e.data);
  return { ...red.result(r.status), events: r.events, compiled };
}

// The plain project of one fuzz instance (variant optional), recipes resolved.
async function plainOf(project, x, env, variant) {
  const cell = { instance: x.id, variant: variant || 'default', seed: 0, params: x.params, inst: x.instance };
  const cp = cellProject(project, cell, { name: 'fuzz', limits: { seconds: 0 } });
  let p = cp.project;
  if (cp.instance && env.luaTexts) p = await resolveProject(p, cp.instance, env.engineRun, env.luaTexts);
  const d = derive(p, { instance: cp.instance, variant: cell.variant });
  d.settings = { ...d.settings, seconds: 0, candidates: 0 };
  return d;
}

// Walk the source. Returns { found: { instance, params, verdict, mode } | null, tried, mode,
// skipped }. mode "audit", or "compare" (no audit for this script: solution hashes against the
// variant `reference`).
export async function fuzz(project, { source = defaultSource(project), env, onProgress = () => {}, signal = { aborted: false } } = {}) {
  const list = fuzzInstances(project, source);
  let mode = 'audit', tried = 0, skipped = 0, note = '';
  for (const x of list) {
    if (signal.aborted) break;
    tried++;
    const d = await plainOf(project, x, env);
    let res = mode === 'audit' ? await auditOf(d, env) : null;
    if (res && res.noAudit) {
      if (!(project.variants || []).some((v) => v.name === 'reference')) return { found: null, tried, mode: 'none', skipped, note: `${res.noAudit}, and the project has no variant "reference" to compare with` };
      mode = 'compare'; note = `no audit for this script (${res.noAudit}): solution hashes compared with the variant "reference"`;
    }
    if (mode === 'audit') {
      onProgress({ instance: x.id, tried, total: list.length, verdict: res.verdict ? res.verdict.verdict : 'error' });
      if (res.error) { skipped++; continue; }
      if (res.verdict.verdict === 'limit') { skipped++; continue; }
      if (res.verdict.verdict === 'unsound') return { found: { instance: x, params: x.params, verdict: res.verdict, plan: res.plan, project: d }, tried, mode, skipped, note };
      continue;
    }
    const a = await countOf(d, env), b = await countOf(await plainOf(project, x, env, 'reference'), env);
    onProgress({ instance: x.id, tried, total: list.length, verdict: a.hash === b.hash ? 'same' : 'differs' });
    if (a.error || b.error || !a.exhausted || !b.exhausted) { skipped++; continue; }
    if (a.hash !== b.hash || a.solutions !== b.solutions) return { found: { instance: x, params: x.params, counts: [a.solutions, b.solutions], project: d }, tried, mode, skipped, note };
  }
  return { found: null, tried, mode, skipped, note };
}

// Shrink the facts (one ground fact per item) and then the numeric constants of an unsound
// plain project, keeping the schema fragment satisfied and the audit unsound.
export async function shrinkInstance(d, env, { jobs = 1, onStep } = {}) {
  const inst = d.fragments.find((f) => f.name === 'instance');
  const schema = d.fragments.find((f) => f.name === 'schema');
  const withFacts = (facts, constants = d.settings.constants) => ({
    ...d, settings: { ...d.settings, constants },
    fragments: [{ name: 'instance', text: facts.join('\n') + '\n' }, ...d.fragments.filter((f) => f.name !== 'instance')],
  });
  const schemaOk = async (p) => {
    if (!schema) return true;
    const facts = p.fragments.find((f) => f.name === 'instance').text;
    const c = Object.entries(p.settings.constants || {}).map(([k, v]) => `-c ${k}=${v}`).join(' ');
    const r = await env.engineRun(`${facts}\n${schema.text}\n`, `--outf=3 ${c}`.trim());
    return r.status === 10 || r.status === 30;
  };
  const unsound = async (p) => (await schemaOk(p)) && (await auditOf(p, env)).verdict?.verdict === 'unsound';
  let facts = [];
  if (inst && inst.text.trim()) {
    const n = await normaliseFacts(inst.text, env.engineRun, d.settings.constants);
    if (n.error) return { error: `the instance facts: ${n.error}` };
    facts = n.facts;
  }
  let tests = 0, cur = facts;
  if (facts.length > 1) {
    const r = await shrink(facts, (sub) => unsound(withFacts(sub)), { jobs, onStep });
    cur = r.items; tests += r.tests;
  }
  const rc = await shrinkConstants(d.settings.constants || {}, (c) => unsound(withFacts(cur, c)));
  tests += rc.tests;
  const small = withFacts(cur, rc.constants);
  const final = await auditOf(small, env);
  return { project: small, facts: cur, constants: rc.constants, tests, verdict: final.verdict, from: facts.length };
}

// Run the project's own loop with every step recorded and find the first refinement that the
// audit's lost solution falsifies (clause refinements), or replay the expansions (rule
// refinements). Returns { step, solution, lostInRun, witness, culprit? }.
export async function diagnose(d, verdict, env) {
  const w = verdict.witness || {};
  const solution = w.solution || [];
  const run = await countOf(d, env, { record: { steps: 'all', n: 0, calls: false } });
  const rec = new Recording({});
  for (const e of run.events || []) rec.add(e.kind, e.data);
  const shown = new Set(solution);
  const lostInRun = !rec.solutions.some((s) => {
    const atoms = new Set(String(s.atoms || '').split(/\s+/).filter(Boolean));
    return [...shown].every((a) => atoms.has(a)) && [...atoms].filter((a) => (rec.I ? rec.I.links[0].atoms.includes(a) : true)).every((a) => shown.has(a));
  });
  const out = { solution, lostInRun, witness: w, recording: rec, counts: { loop: run.solutions } };
  if (!lostInRun) return out;
  if (w.kind === 'expand' && env.modules.replay && run.compiled) {
    const plan = auditPlan(run.compiled);
    const L = run.compiled.links.find((x) => x.name === plan.link);
    const expansions = rec.steps.filter((s) => s.k === 'e' && s.s === run.compiled.solvers.findIndex((s) => s.name === L.from) + 1).map((s) => s.f || []);
    const lua = (v) => Array.isArray(v) ? `{ ${v.map(lua).join(', ')} }` : JSON.stringify(v);
    const body = [...declarationLines(run.compiled), `rt.replay{ solver = ${L.from}, link = ${L.name}, part = ${JSON.stringify(plan.expand[0].part)}, expansions = ${lua(expansions)}, solution = ${lua(solution)} }`]
      .map((l) => '    ' + l).join('\n') + '\n';
    const a = assemble({ ...d, settings: { ...d.settings, solutions: 0, trace: 0 } }, run.compiled, env.runtime, { modules: [env.modules.replay], body });
    const r = await runEvents(a.program, env);
    const Y = r.events.find((e) => e.kind === 'Y');
    out.culprit = Y ? Y.data.culprit : null;
    const si = run.compiled.solvers.findIndex((x) => x.name === L.from) + 1;
    out.step = Y && Y.data.culprit > 0 ? rec.steps.filter((x) => x.k === 'e' && x.s === si)[Y.data.culprit - 1] || null : null;
    return out;
  }
  const link = rec.I ? Math.max(1, rec.I.links.findIndex((x) => x.link === (verdict.link || x.link)) + 1) : 1;
  out.step = rec.firstViolated(solution, { link });
  return out;
}
