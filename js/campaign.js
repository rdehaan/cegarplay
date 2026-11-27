// Campaigns: a suite expands into cells (instance x variant x
// solver seed); each cell is one run; one row per cell. No DOM, no Node APIs: the page
// (js/campaign-tab.js with js/pool.js) and tools/bench.mjs run the same code.
//
//   suite: { name, instances, variants, solver_seeds, limits, where }
//     instances: { ids: [...] | "all" }
//              | { generator, grid: { param: [values] }, seeds: N, attempts, constants: { name: value } }
//              | { constants: { name: [values] }, base: instance id }
//     variants: ["default", "reference", ...]   (default: ["default"])
//     solver_seeds: N (seeds 0..N-1; default 1) | [seed, ...] (these seeds)
//     random_seeds: N (draw N random seeds; the page's Start and tools/bench.mjs replace it by
//                   solver_seeds: [the seeds drawn], so the seeds used are written down)
//     randomize: true | false (randomized search for every cell; absent: the project's setting).
//                   Without it, clingo searches the same way for every seed.
//     limits: { seconds, candidates }   (default { seconds: 30 })
//     where: ["solutions(reference) >= 1", ...]   (instance filters)
import { derive, ProjectError, costTracker } from './project.js';
import { validate, assemble, modulesFor, parseEvent, refinementCounts } from './driver.js';
import { resolveProject } from './instances.js';
import { csvField } from './util.js';

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
    // constants: { name: value } given to every generated instance (the project's bounds for it)
    const consts = Object.fromEntries(Object.entries(spec.constants || {}).map(([k, v]) => [k, String(v)]));
    const out = [];
    for (const p of gridPoints(spec.grid || {})) {
      for (let s = 1; s <= seeds; s++) {
        const id = `${g.name}-${pointId(p)}${pointId(p) ? '-' : ''}s${s}`;
        out.push({ id, params: p, instance: { id, recipe: { generator: g.name, params: p, seed: s, ...(spec.attempts ? { attempts: spec.attempts } : {}) }, constants: { ...consts }, tags: ['suite'] } });
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

// The solver seeds of a suite, in order: solver_seeds N gives 0..N-1, a list gives its seeds.
// random_seeds must have been drawn first (drawSuiteSeeds).
export function suiteSeeds(suite) {
  if (suite.random_seeds !== undefined) throw new SuiteError(`suite ${suite.name}: random_seeds are drawn when the suite starts (Start, or tools/bench.mjs)`);
  if (suite.randomize !== undefined && typeof suite.randomize !== 'boolean') throw new SuiteError(`suite ${suite.name}: randomize must be true or false`);
  const s = suite.solver_seeds;
  if (Array.isArray(s)) {
    if (!s.length) throw new SuiteError(`suite ${suite.name}: solver_seeds is an empty list`);
    for (const x of s) if (!(Number.isInteger(x) && x >= 0 && x < 2 ** 31)) throw new SuiteError(`suite ${suite.name}: solver_seeds: ${JSON.stringify(x)} is not a whole number from 0 to 2^31 - 1`);
    if (new Set(s).size !== s.length) throw new SuiteError(`suite ${suite.name}: solver_seeds lists a seed twice`);
    return s.slice();
  }
  const n = Math.max(1, Number(s) || 1);
  return Array.from({ length: n }, (_, i) => i);
}

// n distinct random seeds from 1 to 99999 (0 means "clingo's default", so it is not drawn).
export function drawSeeds(n, random = Math.random) {
  const k = Math.floor(Number(n));
  if (!(k >= 1 && k <= 1000)) throw new SuiteError('random_seeds: a number from 1 to 1000');
  const out = new Set();
  while (out.size < k) out.add(1 + Math.floor(random() * 99999));
  return [...out];
}

// A suite with random_seeds: N becomes one with solver_seeds: [N seeds drawn now]; any other
// suite is returned as it is. Returns { suite, seeds } (seeds: the drawn ones, or null).
export function drawSuiteSeeds(suite, random = Math.random) {
  if (suite.random_seeds === undefined) return { suite, seeds: null };
  const seeds = drawSeeds(suite.random_seeds, random);
  const { random_seeds: _r, ...rest } = suite;
  return { suite: { ...rest, solver_seeds: seeds }, seeds };
}

// Cells (without keys): [{ instance, variant, seed, params, inst }].
export function expandSuite(project, suite) {
  const insts = suiteInstances(project, suite);
  const variants = suiteVariants(project, suite);
  const seeds = suiteSeeds(suite);
  const cells = [];
  for (const x of insts) {
    for (const variant of variants) {
      for (const seed of seeds) cells.push({ instance: x.id, variant, seed, params: x.params, inst: x.instance, asWritten: !!x.asWritten });
    }
  }
  return cells;
}

// The seeds of some rows, sorted (the skipped rows count too: they have a seed).
export const rowSeeds = (rows) => [...new Set(rows.map((r) => r.seed).filter((x) => x !== undefined && x !== null))].sort((a, b) => a - b);

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
    settings: { solutions: 0, trace: 0, seed: cell.seed, seconds: Number(limits.seconds) || 0, candidates: Number(limits.candidates) || 0,
      ...(typeof suite.randomize === 'boolean' ? { randomize: suite.randomize } : {}) } };
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
    d = { ...d, recipe: [inst.recipe, g ? g.text : '', g ? g.defaults || {} : {}, g ? g.constants || {} : {}] };
  } else {
    d = derive(c.project, { instance: c.instance, variant: c.variant });
  }
  // every setting that changes a run (certify, record, ...) with the cell's own settings over them
  // settings.instance and settings.variant are the top bar's picks, not part of a cell
  const { constants, instance: _i, variant: _v, ...rest } = d.settings;
  const settings = Object.fromEntries(Object.entries({ ...rest, ...c.settings }).sort(([a], [b]) => a.localeCompare(b)));
  const text = JSON.stringify([d.fragments.map((f) => [f.name, f.text]), d.loop, constants, d.recipe || null,
    settings, engineVersion]);
  return sha256(text);
}

// Shard i of n (0-based): the cells whose key, read as a number, is i modulo n.
// The engine tag of the keys: the engine version and a hash of the runtime and module texts, so
// a changed runtime does not reuse stale rows.
export function engineTag(version, runtime = '', modules = {}) {
  const parts = [runtime, ...Object.keys(modules).sort().map((k) => `${k}:${modules[k] || ''}`)].join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) { h ^= parts.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${version}|${h.toString(16)}`;
}

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
  constructor() { this.S = null; this.D = null; this.n = 0; this.sum = 0; this.E = null; this.costs = costTracker(); }
  add(kind, d) {
    if (kind === 'S') this.S = d;
    else if (kind === 'D') this.D = d;
    else if (kind === 'E') this.E = d;
    else if (kind === 'M') {
      this.n++;
      if (d.cost !== undefined && d.cost !== null) this.costs.add(d.cost);
      const atoms = String(d.atoms || '').split(/\s+/).filter(Boolean).sort().join(' ');
      this.sum = (this.sum + fnv(atoms)) >>> 0;
    }
  }
  line(l) { const e = parseEvent(l); if (e) this.add(e.kind, e.data); }
  result(status) {
    const S = this.S || {}, D = this.D;
    const row = {
      outcome: D ? D.outcome : status === 'timeout' ? 'timeout' : 'trap',
      exhausted: D ? D.exhausted === true : false,
      detail: D ? D.detail || '' : (this.E ? this.E.message : ''),
      solutions: S.solutions ?? this.n, candidates: S.candidates ?? 0,
      refinements: refinementCounts(S).total, time: S.t ?? 0,
      hash: this.sum.toString(16).padStart(8, '0'),
    };
    // counterexamples (models that refuted a candidate) and refinements by source (manual: Counting)
    if (S.counterexamples !== undefined) row.counterexamples = S.counterexamples;
    const rc = refinementCounts(S);
    if (rc.split) { row.from_models = rc.from_models; row.from_cores = rc.from_cores; row.blocks = rc.blocks; if (rc.other) row.other = rc.other; }
    // the metrics that explain a difference between variants (FUTURE-DIRECTIONS D4)
    if (S.clauses) row.meanClause = Math.round((S.literals || 0) / S.clauses * 100) / 100;
    if (S.solvers && typeof S.solvers === 'object') {
      row.solvers = {};
      for (const [name, v] of Object.entries(S.solvers)) {
        row.solvers[name] = { calls: v.calls ?? 0, time: Math.round((v.time ?? 0) * 1e4) / 1e4, conflicts: v.conflicts ?? 0 };
      }
    }
    if (this.costs.n) { row.cost = this.costs.cost; row.sameCost = this.costs.same; }
    if (S.labels && Object.keys(S.labels).length) row.labels = { ...S.labels };
    return row;
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
    // a stored row counts unless it was skipped by a filter or invalid (both are decided again)
    const old0 = store && await store.get(c.key);
    const old = old0 && !old0.skipped && old0.outcome !== 'invalid' ? old0 : null;
    if (old) { done.set(c.key, old); skipped++; count++; onProgress(old, count, total, true); return; }
    if (filters.length && !named.has(c.variant)) {
      const w = evalWhere(filters, instRows(c));
      if (w === false) {
        const row = { key: c.key, suite: suite.name, instance: c.instance, variant: c.variant, seed: c.seed, params: c.params, skipped: 'where', outcome: 'skipped' };
        done.set(c.key, row); rows.push(row); count++;
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
    if (r.skipped || r.outcome !== 'finished') continue;
    const k = `${r.instance}|${r.seed}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  const out = [];
  for (const [, all] of by) {
    const rs = all.filter((r) => r.exhausted);
    const counts = rs.length > 1 && (new Set(rs.map((r) => r.hash)).size > 1 || new Set(rs.map((r) => r.solutions)).size > 1);
    // optima: finished rows whose solutions all had one cost; an optimum loop need not be exhausted
    const opt = all.filter((r) => Array.isArray(r.cost) && r.sameCost !== false);
    const optima = opt.length > 1 && new Set(opt.map((r) => r.cost.join(' '))).size > 1;
    if (counts || optima) out.push({ instance: all[0].instance, seed: all[0].seed, rows: counts ? rs : opt, kind: counts ? 'count' : 'optimum' });
  }
  return out;
}

// ---- the instance x variant matrix (FUTURE-DIRECTIONS D2, D3) ------------------------------
// metric: 'time' | 'candidates' | 'refinements' | ... The seeds of one cell are summarised by
// opts.stat: 'median' (default) or 'mean' (with the standard deviation sd); opts.seed (a number)
// keeps only the rows of that seed: the table of one seed.
// Returns { metric, stat, seed, variants, rows: [{ instance, cells: { variant: cell }, best }] }
// where a cell is { value, sd, n, solvedN, solved, outcome, disagree, solutions, cost, perSeed }
// (perSeed: [[seed, value]]); bests lists every variant with the smallest value among the solved
// cells of the row (all of them on a tie; none when no cell is solved, or for the metric
// solutions), and best names it when it is the only one (null otherwise).
export const solvedRow = (r) => !r.skipped && r.outcome === 'finished';
// order: { variants: [...], instances: [...] } lists the names in the order to show (the project's);
// names not listed follow in the order of the rows.
export function resultMatrix(rows, metric = 'time', order = {}, opts = {}) {
  const stat = opts.stat === 'mean' ? 'mean' : 'median';
  const seed = typeof opts.seed === 'number' ? opts.seed : null;
  const bad = new Set(inconsistencies(rows).flatMap((b) => b.rows.map((r) => r.key)));
  if (seed !== null) rows = rows.filter((r) => r.seed === seed);
  const variants = [], instances = [];
  const by = new Map();
  for (const r of rows) {
    if (r.skipped) continue;
    if (!variants.includes(r.variant)) variants.push(r.variant);
    if (!instances.includes(r.instance)) instances.push(r.instance);
    const k = `${r.instance}\u0000${r.variant}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  const byOrder = (list, want) => {
    if (!Array.isArray(want) || !want.length) return list;
    const at = (x) => { const i = want.indexOf(x); return i < 0 ? want.length : i; };
    return list.map((x, i) => [x, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map((x) => x[0]);
  };
  variants.splice(0, variants.length, ...byOrder(variants, order.variants));
  instances.splice(0, instances.length, ...byOrder(instances, order.instances));
  const out = instances.map((instance) => {
    const cells = {};
    for (const v of variants) {
      const rs = by.get(`${instance}\u0000${v}`);
      if (!rs) continue;
      const vals = rs.map((r) => r[metric]).filter((x) => typeof x === 'number').sort((a, b) => a - b);
      const solvedN = rs.filter(solvedRow).length;
      const solved = solvedN === rs.length;
      const outcome = solved ? 'finished' : (rs.find((r) => !solvedRow(r)) || rs[0]).outcome;
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1)) : null;
      cells[v] = { value: !vals.length ? null : stat === 'mean' ? mean : quantile(vals, 0.5), sd: stat === 'mean' ? sd : null, n: rs.length, solvedN, solved, outcome,
        disagree: rs.some((r) => bad.has(r.key)), solutions: rs[0].solutions, cost: rs[0].cost || null,
        perSeed: rs.slice().sort((a, b) => a.seed - b.seed).map((r) => [r.seed, typeof r[metric] === 'number' ? r[metric] : null]) };
    }
    // the best cells: the smallest value among the solved cells, compared at the precision the
    // matrix shows (time: 3 decimals; a mean: 1 decimal), so that equal-looking cells tie
    const shown = (x) => (metric === 'time' ? Math.round(x * 1000) : stat === 'mean' ? Math.round(x * 10) : Math.round(x));
    const solvedCells = variants.filter((v) => cells[v] && cells[v].solved && cells[v].value !== null);
    const low = solvedCells.length ? Math.min(...solvedCells.map((v) => shown(cells[v].value))) : null;
    // fewer solutions is not better
    const bests = metric === 'solutions' || low === null ? [] : solvedCells.filter((v) => shown(cells[v].value) === low);
    return { instance, cells, bests, best: bests.length === 1 ? bests[0] : null };
  });
  return { metric, stat, seed, variants, rows: out };
}

// The tables of a seed study: the mean over the seeds, then one table per seed.
// Returns [{ label, table, m }] (table: 'mean' or 'seed N').
export function seedMatrices(rows, metric = 'time', order = {}) {
  const out = [{ label: 'mean over the seeds', table: 'mean', m: resultMatrix(rows, metric, order, { stat: 'mean' }) }];
  for (const s of rowSeeds(rows)) out.push({ label: `seed ${s}`, table: `seed ${s}`, m: resultMatrix(rows, metric, order, { seed: s }) });
  return out;
}

const cellText = (c) => !c ? '' : c.solved ? String(c.value) : c.solvedN ? `${c.outcome} (${c.solvedN} of ${c.n} finished)` : c.outcome;

// CSV: one row per instance, one column per variant (the metric, or the outcome of a cell that
// did not finish), then the best variants of the row (several on a tie, separated by spaces).
export function matrixCSV(m) {
  const lines = [['instance', ...m.variants, 'best'].map(csvField).join(',')];
  for (const r of m.rows) lines.push([r.instance, ...m.variants.map((v) => cellText(r.cells[v])), (r.bests || []).join(' ')].map(csvField).join(','));
  return lines.join('\n') + '\n';
}

// Several tables in one CSV (seedMatrices): a first column names the table; a mean table has a
// standard deviation column per variant.
export function matricesCSV(list) {
  const variants = [...new Set(list.flatMap((x) => x.m.variants))];
  const sdCols = list.some((x) => x.m.stat === 'mean');
  const head = ['table', 'instance', ...variants.flatMap((v) => (sdCols ? [v, `${v} sd`] : [v])), 'best'];
  const lines = [head.map(csvField).join(',')];
  for (const { table, m } of list) {
    for (const r of m.rows) {
      const cols = variants.flatMap((v) => { const c = r.cells[v]; const t = cellText(c); return sdCols ? [t, c && c.sd !== null && c.sd !== undefined ? String(c.sd) : ''] : [t]; });
      lines.push([table, r.instance, ...cols, (r.bests || []).join(' ')].map(csvField).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

const num = (x, metric) => x === null ? '–' : metric === 'time' ? x.toFixed(3) : String(Math.round(x * 100) / 100);
// Markdown: the same table; the best cells in bold (every one of a tie), a disagreement marked ✗, a cut-off cell named.
export function matrixMarkdown(m) {
  const head = `| instance | ${m.variants.join(' | ')} |`;
  const sep = `|---|${m.variants.map(() => '---:').join('|')}|`;
  const body = m.rows.map((r) => `| ${r.instance || '(project)'} | ${m.variants.map((v) => {
    const c = r.cells[v];
    if (!c) return '';
    let t = c.solved ? num(c.value, m.metric) + (c.sd !== null && c.sd !== undefined ? ` ± ${num(c.sd, m.metric)}` : '') : c.solvedN ? `${c.outcome} (${c.solvedN}/${c.n})` : c.outcome;
    if ((r.bests || []).includes(v)) t = `**${t}**`;
    if (c.disagree) t += ' ✗';
    return t;
  }).join(' | ')} |`);
  return [head, sep, ...body].join('\n') + '\n';
}

// Per variant: solved cells, total cells, the PAR2 score (time of a solved cell; twice the
// limit for one that is not) when a limit is known.
export function variantTotals(rows, limitSeconds = 0) {
  const out = {};
  for (const r of rows) {
    if (r.skipped) continue;
    const v = (out[r.variant] = out[r.variant] || { cells: 0, solved: 0, time: 0, par2: 0 });
    v.cells++;
    if (solvedRow(r)) { v.solved++; v.time += r.time; v.par2 += r.time; } else v.par2 += 2 * (limitSeconds || r.time || 0);
  }
  for (const v of Object.values(out)) { v.time = Math.round(v.time * 1000) / 1000; v.par2 = Math.round(v.par2 * 1000) / 1000; }
  return out;
}

// A cactus plot as an SVG string (no DOM): per variant, the i-th solved cell against its time.
export function cactusSvg(rows, { width = 480, height = 300, title = 'Solved cells against time' } = {}) {
  const curves = solvedCurves(rows);
  const names = Object.keys(curves);
  const palette = ['#2f6db5', '#c4572a', '#3a8a4f', '#8a4fb5', '#b58a2f', '#2fa3b5', '#777777'];
  const x0 = 48, x1 = width - 12, y0 = height - 32, y1 = 24;
  const nmax = Math.max(1, ...names.map((n) => curves[n].times.length));
  const tmax = Math.max(1e-3, ...names.flatMap((n) => curves[n].times));
  const X = (i) => x0 + i / nmax * (x1 - x0), Y = (t) => y0 - t / tmax * (y0 - y1);
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="sans-serif" font-size="11">`,
    `<rect width="${width}" height="${height}" fill="white"/>`,
    `<text x="${x0}" y="14">${esc(title)}</text>`,
    `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}" stroke="#444"/><line x1="${x0}" y1="${y1}" x2="${x0}" y2="${y0}" stroke="#444"/>`,
    `<text x="${(x0 + x1) / 2}" y="${height - 6}" text-anchor="middle">cells solved (of ${Math.max(0, ...names.map((n) => curves[n].total))})</text>`,
    `<text x="${x1}" y="${y0 + 14}" text-anchor="end">${nmax}</text><text x="${x0}" y="${y0 + 14}">0</text>`,
    `<text x="${x0 - 4}" y="${y1 + 4}" text-anchor="end">${tmax.toPrecision(2)} s</text>`];
  names.forEach((n, k) => {
    const c = palette[k % palette.length];
    const pts = curves[n].times.map((t, i) => `${X(i + 1).toFixed(1)},${Y(t).toFixed(1)}`);
    if (pts.length) parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="2"/>`);
    for (const p of pts) { const [a, b] = p.split(','); parts.push(`<circle cx="${a}" cy="${b}" r="2.5" fill="${c}"/>`); }
    parts.push(`<rect x="${x0 + 8}" y="${y1 + 4 + k * 14}" width="10" height="10" fill="${c}"/><text x="${x0 + 22}" y="${y1 + 13 + k * 14}">${esc(n)}</text>`);
  });
  parts.push('</svg>');
  return parts.join('\n') + '\n';
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

// Solved within time: per variant, sorted times of the finished rows (an optimisation loop that
// stops at its optimum is solved without being exhausted).
export function solvedCurves(rows) {
  const out = {};
  for (const r of rows) {
    if (r.skipped) continue;
    (out[r.variant] = out[r.variant] || { times: [], total: 0 }).total++;
    if (r.outcome === 'finished') out[r.variant].times.push(r.time);
  }
  for (const v of Object.values(out)) v.times.sort((a, b) => a - b);
  return out;
}

export { ProjectError };
