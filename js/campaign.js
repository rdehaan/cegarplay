// Campaigns (docs/spec-instances.md section 5): a suite expands into cells (instance x variant x
// solver seed); each cell is one run; one row per cell. No DOM, no Node APIs: the page
// (js/campaign-tab.js with js/pool.js) and tools/bench.mjs run the same code.
//
//   suite: { name, instances, variants, solver_seeds, limits, where }
//     instances: { ids: [...] | "all" }
//              | { generator, grid: { param: [values] }, seeds: N, attempts }
//              | { constants: { name: [values] }, base: instance id }
//     variants: ["default", "reference", ...]   (default: ["default"])
//     solver_seeds: N (seeds 0..N-1; default 1)
//     limits: { seconds, candidates }   (default { seconds: 30 })
//     where: ["solutions(reference) >= 1", ...]   (instance filters)
import { derive, ProjectError } from './project.js';
import { validate, assemble, modulesFor, parseEvent } from './driver.js';
import { resolveProject } from './instances.js';

export class SuiteError extends Error {}

export const DEFAULT_LIMITS = { seconds: 30, candidates: 0 };

// The cartesian product of a { name: [values] } grid, in key order: [{ name: value }].
export function gridPoints(grid) {
  let out = [{}];
  for (const [k, vals] of Object.entries(grid || {})) {
    if (!Array.isArray(vals) || !vals.length) throw new SuiteError(`grid ${k}: expected a non-empty list of values`);
    out = out.flatMap((p) => vals.map((v) => ({ ...p, [k]: v })));
  }
  return out;
}
const pointId = (p) => Object.entries(p).map(([k, v]) => `${k}${v}`).join('-');

// The instances of a suite: [{ id, instance, params }] (instance is a plain instance object).
export function suiteInstances(project, suite) {
  const spec = suite.instances || { ids: 'all' };
  const list = project.instances || [];
  if (spec.generator) {
    const g = (project.generators || []).find((x) => x.name === spec.generator);
    if (!g) throw new SuiteError(`suite ${suite.name}: no generator named ${spec.generator}`);
    const seeds = Math.max(1, Number(spec.seeds) || 1);
    const out = [];
    for (const p of gridPoints(spec.grid || {})) {
      for (let s = 1; s <= seeds; s++) {
        const id = `${g.name}-${pointId(p)}${pointId(p) ? '-' : ''}s${s}`;
        out.push({ id, params: p, instance: { id, recipe: { generator: g.name, params: p, seed: s, ...(spec.attempts ? { attempts: spec.attempts } : {}) }, constants: {}, tags: ['suite'] } });
      }
    }
    return out;
  }
  if (spec.constants) {
    let base = null;
    if (spec.base) {
      base = list.find((x) => x.id === spec.base);
      if (!base) throw new SuiteError(`suite ${suite.name}: no instance named ${spec.base}`);
    }
    return gridPoints(spec.constants).map((p) => {
      const id = pointId(p) || 'as-written';
      const constants = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)]));
      const instance = base ? { ...base, id, constants: { ...(base.constants || {}), ...constants } } : { id, facts: '', constants, tags: ['suite'] };
      return { id, params: p, instance, asWritten: !base };
    });
  }
  const ids = spec.ids === 'all' || spec.ids === undefined ? list.map((x) => x.id) : spec.ids;
  if (!Array.isArray(ids)) throw new SuiteError(`suite ${suite.name}: instances.ids must be a list or "all"`);
  if (!ids.length) return [{ id: '', params: {}, instance: null }];      // the project as written
  return ids.map((id) => {
    const x = list.find((i) => i.id === id);
    if (!x) throw new SuiteError(`suite ${suite.name}: no instance named ${id}`);
    return { id, params: { ...(x.constants || {}) }, instance: x };
  });
}

export function suiteVariants(project, suite) {
  const v = suite.variants && suite.variants.length ? suite.variants : ['default'];
  for (const name of v) {
    if (name !== 'default' && !(project.variants || []).some((x) => x.name === name)) throw new SuiteError(`suite ${suite.name}: no variant named ${name}`);
  }
  return v;
}

// Cells (without keys): [{ instance, variant, seed, params, inst }].
export function expandSuite(project, suite) {
  const insts = suiteInstances(project, suite);
  const variants = suiteVariants(project, suite);
  const seeds = Math.max(1, Number(suite.solver_seeds) || 1);
  const cells = [];
  for (const x of insts) {
    for (const variant of variants) {
      for (let seed = 0; seed < seeds; seed++) cells.push({ instance: x.id, variant, seed, params: x.params, inst: x.instance, asWritten: !!x.asWritten });
    }
  }
  return cells;
}

// The project of one cell: the suite's instance applied (also an instance the project does not
// store), the variant, the seed and the limits; all solutions, no trace.
export function cellProject(project, cell, suite) {
  const limits = { ...DEFAULT_LIMITS, ...(suite.limits || {}) };
  let p = project;
  if (cell.inst) {
    const others = (project.instances || []).filter((x) => x.id !== cell.inst.id);
    p = { ...project, instances: [cell.inst, ...others] };
  }
  return { project: p, instance: cell.inst ? cell.inst.id : '', variant: cell.variant,
    settings: { solutions: 0, trace: 0, seed: cell.seed, seconds: Number(limits.seconds) || 0, candidates: Number(limits.candidates) || 0 } };
}

const enc = (s) => new TextEncoder().encode(s);
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 over what decides the run: fragments, loop, constants (of the derived project, with
// the instance's facts or recipe), limits, seed, engine version.
export async function cellKey(project, cell, suite, engineVersion = '') {
  const c = cellProject(project, cell, suite);
  let d;
  const inst = cell.inst;
  if (inst && inst.facts === undefined && inst.recipe) {
    const g = (project.generators || []).find((x) => x.name === inst.recipe.generator);
    d = derive({ ...c.project, instances: [{ ...inst, facts: '' }] }, { instance: inst.id, variant: c.variant });
    d = { ...d, recipe: [inst.recipe, g ? g.text : '', g ? g.defaults || {} : {}] };
  } else {
    d = derive(c.project, { instance: c.instance, variant: c.variant });
  }
  const text = JSON.stringify([d.fragments.map((f) => [f.name, f.text]), d.loop, d.settings.constants, d.recipe || null,
    c.settings, engineVersion]);
  return sha256(text);
}

// Shard i of n (0-based): the cells whose key, read as a number, is i modulo n.
export function inShard(key, shard) {
  if (!shard) return true;
  const n = BigInt(shard.n), i = BigInt(shard.i);
  return BigInt('0x' + key) % n === i;
}
export function parseShard(text) {
  const m = /^(\d+)\/(\d+)$/.exec(String(text || ''));
  if (!m || Number(m[2]) < 1 || Number(m[1]) >= Number(m[2])) throw new SuiteError(`bad shard ${text}: expected i/n with 0 <= i < n`);
  return { i: Number(m[1]), n: Number(m[2]) };
}

// ---- where filters ------------------------------------------------------------------------
const WHERE = /^\s*(solutions|candidates|outcome)\s*\(\s*([A-Za-z0-9_-]+)\s*\)\s*(==|!=|>=|<=|>|<)\s*(-?\d+|"[^"]*")\s*$/;
export function parseWhere(text) {
  const m = WHERE.exec(String(text));
  if (!m) throw new SuiteError(`where: cannot read "${text}" (expected solutions(v) >= N, candidates(v) < N or outcome(v) == "finished")`);
  const [, fn, variant, op, raw] = m;
  const value = raw.startsWith('"') ? raw.slice(1, -1) : Number(raw);
  if (fn === 'outcome' && typeof value !== 'string') throw new SuiteError(`where: outcome(${variant}) compares with a string`);
  if (fn !== 'outcome' && typeof value !== 'number') throw new SuiteError(`where: ${fn}(${variant}) compares with a number`);
  if (fn === 'outcome' && op !== '==' && op !== '!=') throw new SuiteError('where: outcome(v) takes == or !=');
  return { fn, variant, op, value, text: String(text) };
}
const CMP = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b };
// rows: the rows of one instance (and seed). Returns true, false, or null when a named run is missing.
export function evalWhere(filters, rows) {
  for (const f of filters) {
    const r = rows.find((x) => x.variant === f.variant && !x.skipped);
    if (!r) return null;
    const v = f.fn === 'outcome' ? r.outcome : r[f.fn];
    if (!CMP[f.op](v, f.value)) return false;
  }
  return true;
}

// ---- the reducer of one run -----------------------------------------------------------------
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
// Keeps the last S, the D, the solution count and an order-independent hash of the solutions.
export class Reducer {
  constructor() { this.S = null; this.D = null; this.n = 0; this.sum = 0; this.E = null; }
  add(kind, d) {
    if (kind === 'S') this.S = d;
    else if (kind === 'D') this.D = d;
    else if (kind === 'E') this.E = d;
    else if (kind === 'M') {
      this.n++;
      const atoms = String(d.atoms || '').split(/\s+/).filter(Boolean).sort().join(' ');
      this.sum = (this.sum + fnv(atoms)) >>> 0;
    }
  }
  line(l) { const e = parseEvent(l); if (e) this.add(e.kind, e.data); }
  result(status) {
    const S = this.S || {}, D = this.D;
    return {
      outcome: D ? D.outcome : status === 'timeout' ? 'timeout' : 'trap',
      exhausted: D ? D.exhausted === true : false,
      detail: D ? D.detail || '' : (this.E ? this.E.message : ''),
      solutions: S.solutions ?? this.n, candidates: S.candidates ?? 0,
      refinements: (S.clauses ?? 0) + (S.expansions ?? 0), time: S.t ?? 0,
      hash: this.sum.toString(16).padStart(8, '0'),
    };
  }
}

// ---- running a suite ----------------------------------------------------------------------
// opts: { runJob(job) -> result, store: { get(key), put(row) }, onProgress(row, done, total),
//   engineRun (validation, recipes), luaTexts { draw, generate }, runtime, modules { ground, ... },
//   engineVersion, shard { i, n }, jobs (concurrency), signal { aborted } }
// job: { program, seconds }. Returns { rows, skipped, ran, cells, problems }.
export async function runSuite(project, suite, opts) {
  const { runJob, store, onProgress = () => {}, engineRun: run0, luaTexts, runtime, modules = {}, engineVersion = '', shard = null,
    jobs = 1, signal = { aborted: false } } = opts;
  const filters = (suite.where || []).map(parseWhere);
  // validation and recipes use one engine: one call at a time
  let lock = Promise.resolve();
  const engineRun = (p, o) => { const r = lock.then(() => run0(p, o)); lock = r.catch(() => {}); return r; };
  let cells = expandSuite(project, suite);
  for (const c of cells) c.key = await cellKey(project, c, suite, engineVersion);
  cells = cells.filter((c) => inShard(c.key, shard));
  // variants named in a filter run first, so the filter can be evaluated before the others
  const named = new Set(filters.map((f) => f.variant));
  cells.sort((a, b) => (named.has(a.variant) ? 0 : 1) - (named.has(b.variant) ? 0 : 1));
  const rows = [], problems = [];
  const done = new Map();          // key -> row (this run and the store)
  const total = cells.length;
  let ran = 0, skipped = 0, count = 0;
  const instRows = (c) => [...done.values()].filter((r) => r.instance === c.instance && r.seed === c.seed);
  // validate each variant once (with the first instance of the suite)
  const valid = new Map();
  const resolved = new Map();      // instance id -> project with facts
  async function prepared(c) {
    if (!resolved.has(c.instance)) {
      const cp = cellProject(project, c, suite);
      resolved.set(c.instance, cp.instance && luaTexts ? resolveProject(cp.project, cp.instance, engineRun, luaTexts) : Promise.resolve(cp.project));
    }
    const base = await resolved.get(c.instance);
    const cp = cellProject(base, { ...c, inst: c.inst ? base.instances.find((x) => x.id === c.inst.id) : null }, suite);
    const d = derive(cp.project, { instance: cp.instance, variant: cp.variant });
    d.settings = { ...d.settings, ...cp.settings };
    if (!valid.has(c.variant)) {
      valid.set(c.variant, validate(d, engineRun).then((pr) => ({ errs: pr.filter((x) => x.severity === 'error'), compiled: pr.compiled })));
    }
    const v = await valid.get(c.variant);
    if (v.errs.length) throw new SuiteError(`variant ${c.variant}: ${v.errs[0].message}`);
    const compiled = d.loop.language === 'loop' ? v.compiled : null;
    const mods = modulesFor(d.settings, { compiled, loop: d.loop }).map((m) => modules[m]);
    return { program: assemble(d, compiled, runtime, { modules: mods }).program, seconds: d.settings.seconds };
  }
  async function one(c) {
    const old = store && await store.get(c.key);
    if (old) { done.set(c.key, old); skipped++; count++; onProgress(old, count, total, true); return; }
    if (filters.length && !named.has(c.variant)) {
      const w = evalWhere(filters, instRows(c));
      if (w === false) {
        const row = { key: c.key, suite: suite.name, instance: c.instance, variant: c.variant, seed: c.seed, params: c.params, skipped: 'where', outcome: 'skipped' };
        done.set(c.key, row); rows.push(row); count++;
        if (store) await store.put(row);
        onProgress(row, count, total, false);
        return;
      }
    }
    let job;
    try { job = await prepared(c); } catch (e) {
      problems.push(e.message);
      const row = { key: c.key, suite: suite.name, instance: c.instance, variant: c.variant, seed: c.seed, params: c.params, outcome: 'invalid', detail: e.message };
      rows.push(row); count++; onProgress(row, count, total, false);
      return;
    }
    if (signal.aborted) return;
    const res = await runJob(job);
    if (signal.aborted && res.outcome === 'aborted') return;
    const row = { key: c.key, suite: suite.name, instance: c.instance, variant: c.variant, seed: c.seed, params: c.params, engine: engineVersion, ...res };
    done.set(c.key, row); rows.push(row); ran++; count++;
    if (store) await store.put(row);
    onProgress(row, count, total, false);
  }
  // named-variant cells first (all of them), then the rest, each phase with `jobs` in flight
  const phases = [cells.filter((c) => named.has(c.variant)), cells.filter((c) => !named.has(c.variant))];
  for (const list of phases) {
    let next = 0;
    const worker = async () => {
      while (next < list.length && !signal.aborted) { const c = list[next++]; await one(c); }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, list.length)) }, worker));
    if (signal.aborted) break;
  }
  return { rows, skipped, ran, cells: total, problems, all: [...done.values()] };
}

// ---- analysis -----------------------------------------------------------------------------
// Instances (with seed) whose exhausted variants disagree: [{ instance, seed, rows }].
export function inconsistencies(rows) {
  const by = new Map();
  for (const r of rows) {
    if (r.skipped || !r.exhausted || r.outcome !== 'finished') continue;
    const k = `${r.instance}|${r.seed}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  const out = [];
  for (const [, rs] of by) {
    if (new Set(rs.map((r) => r.hash)).size > 1 || new Set(rs.map((r) => r.solutions)).size > 1) out.push({ instance: rs[0].instance, seed: rs[0].seed, rows: rs });
  }
  return out;
}

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Scaling: per variant and value of the parameter x, median and quartiles of a metric.
export function scaling(rows, x, metric = 'time') {
  const out = {};
  for (const r of rows) {
    if (r.skipped || r.params == null || r.params[x] === undefined || typeof r[metric] !== 'number') continue;
    const v = (out[r.variant] = out[r.variant] || {});
    (v[r.params[x]] = v[r.params[x]] || []).push(r[metric]);
  }
  const res = {};
  for (const [variant, byX] of Object.entries(out)) {
    res[variant] = Object.entries(byX).map(([xv, vals]) => {
      const s = vals.slice().sort((a, b) => a - b);
      return { x: Number(xv), median: quantile(s, 0.5), q1: quantile(s, 0.25), q3: quantile(s, 0.75), n: s.length };
    }).sort((a, b) => a.x - b.x);
  }
  return res;
}

// Growth fit: least squares of log(median) on x, slope = log growth per unit of x; a 90% interval
// for the slope from bootstrap resamples of the points (deterministic generator).
export function growthFit(points, { resamples = 200, seed = 1 } = {}) {
  const pts = points.filter((p) => p.median > 0 && Number.isFinite(p.x));
  if (pts.length < 2) return null;
  const fit = (ps) => {
    const n = ps.length, mx = ps.reduce((a, p) => a + p.x, 0) / n, my = ps.reduce((a, p) => a + Math.log(p.median), 0) / n;
    let sxy = 0, sxx = 0;
    for (const p of ps) { sxy += (p.x - mx) * (Math.log(p.median) - my); sxx += (p.x - mx) ** 2; }
    return sxx > 0 ? sxy / sxx : NaN;
  };
  const slope = fit(pts);
  let s = seed >>> 0;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  const boots = [];
  for (let k = 0; k < resamples; k++) {
    const ps = pts.map(() => pts[Math.floor(rand() * pts.length)]);
    const b = fit(ps);
    if (Number.isFinite(b)) boots.push(b);
  }
  boots.sort((a, b) => a - b);
  return { slope, factor: Math.exp(slope), lo: Math.exp(quantile(boots, 0.05)), hi: Math.exp(quantile(boots, 0.95)) };
}

// Solved within time: per variant, sorted times of the exhausted rows.
export function solvedCurves(rows) {
  const out = {};
  for (const r of rows) {
    if (r.skipped) continue;
    (out[r.variant] = out[r.variant] || { times: [], total: 0 }).total++;
    if (r.outcome === 'finished' && r.exhausted) out[r.variant].times.push(r.time);
  }
  for (const v of Object.values(out)) v.times.sort((a, b) => a - b);
  return out;
}

export { ProjectError };
