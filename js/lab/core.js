// Refinery: the computations end to end. No DOM, no Node APIs.
// The worker (js/lab/worker.js) and tools/lab.mjs both call these functions, so the tab and the
// tool give the same numbers.
//
//   exec(program, options, onLine) -> Promise<{ status, out, err }>   one clingo-wasm run
//   lua: { runtime, lab, ground, draw, generate }                     the Lua texts
//
//   const ctx = await prepare(project, { instance, variant, link }, exec, lua)
//   const sp  = await computeSpace(ctx, { limit, onProgress })
//   inspect(sp, M, { alive, minimal, chosen })          (after minimalFor)
//   await detail(ctx, sp, M, sets, { limit, cap, lift })
import { derive, pickedVariant, selectedInstance } from '../project.js';
import { resolveProject } from '../instances.js';
import { validate, assemble, modulesFor, parseEvent } from '../driver.js';
import { labPlan, spaceBody, detailBody, parseSpace, spaceKey, projectText, LAB_LIMITS, wordsHex, hexWords, yData } from './space.js';
import { differFamily, minimalFamily, forcedAtoms, maskList, maskOf, valuesOf, removalBits, popcount, andCount, soundness,
  neighbourhood, lattice, LATTICE_MAX, bitList, maskKey, agrees } from './sets.js';
import { minimalSets } from './minimal.js';
import { mapRun, aliveBefore } from './runs.js';
import { schemeOptions, incidence, exactBounds, SCHEMES } from './bounds.js';
import { simulate, greedy, histogram } from './simulate.js';

export class LabError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

const engineOf = (exec) => async (program, options) => {
  const r = await exec(program, options);
  return { ...r, events: (r.out || []).map(parseEvent).filter(Boolean) };
};

// Resolve, derive and validate a project; choose the link. Returns a context for later calls.
// Throws LabError (code 2 usage, 4 unsupported, 1 other).
export async function prepare(project, { instance, variant, link } = {}, exec, lua) {
  const engineRun = engineOf(exec);
  const original = project;
  try { project = await resolveProject(project, instance, engineRun, { draw: lua.draw, generate: lua.generate }); }
  catch (e) { throw new LabError(e.message, 2); }
  if (variant === undefined) variant = pickedVariant(project);   // '' = as written, no variant
  let inst = null;
  try { inst = selectedInstance(project, instance); } catch (e) { throw new LabError(e.message, 2); }
  let d;
  try { d = derive(project, { instance, variant }); } catch (e) { throw new LabError(e.message, 2); }
  const problems = await validate(d, engineRun);
  const errors = problems.filter((p) => p.severity === 'error');
  if (errors.length) throw new LabError(`the project has problems: ${errors[0].message}`, 2);
  const plan = labPlan(problems.compiled, link, { loop: d.loop, instance: inst });
  if (plan.error) throw new LabError(plan.error, 2);
  const run = { ...d, settings: { ...d.settings, solutions: 0, candidates: 0, trace: 0, seconds: 0 } };
  delete run.settings.record;
  delete run.settings.certify;
  const key = spaceKey(projectText(original),
    inst ? inst.id : '', variant, plan.link);
  return { project: run, compiled: problems.compiled, plan, instance: inst ? inst.id : null, variant: variant || null, key, exec, lua };
}

function program(ctx, body, { ground = false } = {}) {
  const mods = modulesFor(ctx.project.settings, { compiled: ctx.compiled, loop: ctx.project.loop });
  if (ground && !mods.includes('ground')) mods.push('ground');
  const texts = mods.map((m) => ctx.lua[m]);
  texts.push(ctx.lua.lab);
  return assemble(ctx.project, ctx.compiled, ctx.lua.runtime, { modules: texts, body }).program;
}

function runError(out) {
  for (const l of out) if (l.startsWith('@@E ')) { try { return JSON.parse(l.slice(4)).message; } catch { return 'runtime error'; } }
  return null;
}

// The space: every candidate, its counterexamples reduced to options; per-atom bitsets.
export async function computeSpace(ctx, { limit = LAB_LIMITS.candidates, onProgress } = {}) {
  if (ctx.plan.unsupported) throw new LabError(`unsupported: ${ctx.plan.unsupported}`, 4);
  const prog = program(ctx, spaceBody(ctx.compiled, ctx.plan, { limit }));
  const t0 = Date.now();
  const r = await ctx.exec(prog, '--outf=3', (line) => {
    if (onProgress && line.startsWith('@@Y ') && line.includes('"t":"p"')) { try { onProgress(JSON.parse(line.slice(4))); } catch { /* skip */ } }
  });
  const out = r.out || [];
  if (r.status === 'trap') throw new LabError('clingo stopped unexpectedly while enumerating the space', 1);
  const err = runError(out);
  if (err) throw new LabError(`the enumeration stopped with an error: ${err}`, 1);
  const sp = parseSpace(out, { key: ctx.key, link: ctx.plan.link, instance: ctx.instance, variant: ctx.variant, plan: ctx.plan, blockOnly: ctx.plan.block, limit });
  if (sp.limit) throw new LabError(`more than ${sp.limit} candidates: the lab enumerates at most ${sp.limit} (the audit's limit)`, 3);
  if (sp.error) throw new LabError(sp.error, 1);
  sp.meta.ms = Date.now() - t0;
  return sp;
}

// ---------------------------------------------------------------------------
// Schemes and sets
// ---------------------------------------------------------------------------
// A set as plain data: { r, v } word arrays plus its atoms (1-based) and kind.
export function setOf(sp, rW, vW, extra = {}) {
  return { r: rW, v: vW, atoms: maskList(rW, sp.n), size: maskList(rW, sp.n).length, ...extra };
}
export function blockSet(sp, M) { return setOf(sp, sp.full.slice(), valuesOf(sp, M, sp.full), { kind: 'block' }); }
export function loopOptions(sp, M) {
  return sp.options(M).map((o) => setOf(sp, sp.optRw(o).slice(), sp.optVw(o).slice(), { kind: sp.optKind[o] === 1 ? 'group' : sp.optKind[o] === 2 ? 'block' : 'relevant', option: o, cex: sp.optN[o] }));
}
// A recorded clause q (signed atom indices, 1-based): S = its atoms, v = the values removed
// candidates have (a literal +j is falsified by j false).
export function clauseSet(sp, q, extra = {}) {
  const r = new Uint32Array(sp.W), v = new Uint32Array(sp.W);
  for (const x of q) { const j = Math.abs(x) - 1; r[j >> 5] |= 1 << (j & 31); if (x < 0) v[j >> 5] |= 1 << (j & 31); }
  return setOf(sp, r, v, { kind: 'run', ...extra });
}
export const setHex = (sp, s) => ({ r: wordsHex(s.r, sp.n), v: wordsHex(s.v, sp.n) });

// Minimal sound sets of several candidates in one clingo run.
export async function minimalFor(exec, sp, cands, { cap = LAB_LIMITS.minimal, seconds = LAB_LIMITS.seconds, onProgress = null } = {}) {
  const fams = cands.map((M) => minimalFamily(differFamily(sp, M)).map((f) => maskList(f.d, sp.n)));
  const res = await minimalSets(exec, fams, { cap, seconds, onProgress });
  const out = new Map();
  cands.forEach((M, i) => out.set(M, res[i]));
  return out;
}

// Describe one set at M: size, total removal, pruning (alive), soundness (lost, witness).
export function describe(sp, M, s, alive = null) {
  const bits = removalBits(sp, s.r, s.v);
  const so = soundness(sp, s.r, s.v, M);
  return { ...s, total: popcount(bits), prune: andCount(bits, alive || sp.allBits), removesSelf: agrees(sp, M, s.r, s.v), sound: so.sound, lost: so.lost, witness: so.witness };
}

// The Pareto frontier of sound points: fewest atoms, most pruning (indices into points).
export function pareto(points) {
  const sound = points.map((p, i) => [p, i]).filter(([p]) => p.sound).sort((a, b) => a[0].size - b[0].size || b[0].prune - a[0].prune);
  const out = [];
  let best = -1;
  for (const [p, i] of sound) if (p.prune > best) { out.push(i); best = p.prune; }
  return out;
}

// Feature A: the step inspector at bad candidate M.
//   alive: bitset (default all), minimal: { sets, capped, min } from minimalFor,
//   chosen: the run's clause (a set) or null; selected: a set for the atom table (default chosen,
//   else the first loop option).
export function inspect(sp, M, { alive = null, minimal = null, chosen = null, selected = null, minimalCap = LAB_LIMITS.minimal } = {}) {
  if (M < 0 || M >= sp.count) throw new LabError('no such candidate', 2);
  const al = alive || sp.allBits;
  const fam = differFamily(sp, M);
  const forced = forcedAtoms(sp, M, fam).map((f) => ({ ...f, solution: sp.atomsOf(sp.candWords(f.witness)) }));
  const options = loopOptions(sp, M).map((s) => describe(sp, M, s, al));
  const mins = minimal && minimal.sets ? minimal.sets.map((a) => describe(sp, M, setOf(sp, maskOf(a, sp.W), valuesOf(sp, M, maskOf(a, sp.W)), { kind: 'minimal' }), al)) : [];
  const cardMin = minimal && minimal.min ? describe(sp, M, setOf(sp, maskOf(minimal.min, sp.W), valuesOf(sp, M, maskOf(minimal.min, sp.W)), { kind: 'cardinality' }), al) : null;
  const block = describe(sp, M, blockSet(sp, M), al);
  const run = chosen ? describe(sp, M, chosen, al) : null;
  const sel = selected || run || options[0] || block;
  const inMinimal = new Array(sp.n + 1).fill(0);
  for (const m of mins) for (const j of m.atoms) inMinimal[j]++;
  const nb = neighbourhood(sp, M, sel.r, sel.v, al);
  const forcedBy = new Map(forced.map((f) => [f.atom, f.witness]));
  const mw = sp.candWords(M);
  const atoms = nb.rows.map((row) => ({
    atom: row.atom, name: sp.atoms[row.atom - 1], value: ((mw[(row.atom - 1) >> 5] >>> ((row.atom - 1) & 31)) & 1) === 1,
    inSelected: row.inS, inRun: run ? run.atoms.includes(row.atom) : null,
    forced: forcedBy.has(row.atom), witness: forcedBy.has(row.atom) ? forcedBy.get(row.atom) : null,
    inMinimal: inMinimal[row.atom],
    drop: row.inS ? { sound: row.sound, prune: row.prune, dPrune: row.dPrune, total: row.total, dTotal: row.dTotal } : null,
    add: row.inS ? null : { sound: row.sound, prune: row.prune, dPrune: row.dPrune, total: row.total, dTotal: row.dTotal },
  }));
  const points = [...mins, ...options, block, ...(run ? [run] : [])];
  const front = pareto(points);
  // the lattice: the run's (or selected) clause atoms plus the forced atoms
  const latAtoms = [...new Set([...sel.atoms, ...forced.map((f) => f.atom)])].sort((a, b) => a - b);
  const lat = latAtoms.length <= LATTICE_MAX ? lattice(sp, M, latAtoms, al) : { tooLarge: true, atoms: latAtoms };
  const smallest = cardMin || mins.slice().sort((a, b) => a.size - b.size || b.prune - a.prune)[0] || null;
  return {
    candidate: M, hex: sp.hex[M], atomsTrue: sp.atomsOf(mw), solution: !!sp.sol[M], ncex: sp.ncex[M],
    aliveCount: popcount(al), options, minimal: mins, minimalCapped: !!(minimal && minimal.capped), minimalCap, minimalBudget: !!(minimal && minimal.budget),
    cardinality: cardMin, smallest, block, run, selected: describe(sp, M, sel, al), atoms, pareto: front, points: points.length,
    forced, lattice: lat, family: minimalFamily(fam).length, verdict: verdictLine(sp, { run, sel, smallest, forced, options }),
  };
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export function verdictLine(sp, { run, sel, smallest, forced, options }) {
  const what = run ? 'The loop\'s clause' : sel.kind === 'relevant' ? 'The first counterexample\'s clause' : sel.kind === 'block' ? 'The block' : 'The selected clause';
  const s = run || sel;
  let t = `${what} has ${plural(s.size, 'atom')} and removes ${plural(s.prune, 'candidate')}`;
  if (!s.sound) t += `, and is unsound: it removes ${plural(s.lost, 'solution')}`;
  t += '.';
  if (smallest) t += ` The smallest sound clause has ${plural(smallest.size, 'atom')} and removes ${smallest.prune}.`;
  if (forced.length) {
    const f = forced[0];
    t += ` ${sp.atoms[f.atom - 1]} is forced by the solution {${f.solution.join(' ')}}`;
    if (forced.length > 1) t += ` (and ${plural(forced.length - 1, 'more forced atom')})`;
    t += '.';
  }
  if (!options.length) t += ' (The loop has no option of its own here.)';
  return t;
}

// The counterexamples of M (the first `limit`), whether each set is justified by one of them, and
// optionally one lifted clause. sets: [set]; members of R(M, S) are listed up to `cap` in total.
export async function detail(ctx, sp, M, sets = [], { limit = LAB_LIMITS.cex, cap = 20000, lift = false } = {}) {
  let budget = cap;
  const ss = sets.map((s) => {
    const bits = removalBits(sp, s.r, s.v);
    const total = popcount(bits);
    const over = total > budget;
    const members = over ? [] : bitList(bits).filter((i) => i !== M).map((i) => sp.hex[i]);
    if (!over) budget -= members.length;
    return { ...setHex(sp, s), members, over };
  });
  const body = detailBody(ctx.compiled, ctx.plan, { cand: sp.hex[M], limit, cap, lift, sets: ss });
  const r = await ctx.exec(program(ctx, body, { ground: true }), '--outf=3');
  const out = r.out || [];
  if (r.status === 'trap') throw new LabError('clingo stopped unexpectedly while checking the candidate', 1);
  const err = runError(out);
  if (err) throw new LabError(`the check stopped with an error: ${err}`, 1);
  const ys = yData(out);
  const cex = ys.filter((y) => y.t === 'x').map((y) => {
    const rW = hexWords(y.r, sp.n, sp.W);
    const s = describe(sp, M, setOf(sp, rW, valuesOf(sp, M, rW), { kind: 'relevant' }));
    return { k: y.k, shown: y.shown, relevant: s.atoms, size: s.size, total: s.total, sound: s.sound, key: maskKey(rW),
      groups: (y.groups || []).map(([gr, gv]) => maskList(hexWords(gr, sp.n, sp.W), sp.n)) };
  });
  const just = ys.filter((y) => y.t === 'j').sort((a, b) => a.i - b.i).map((y) => ({ verdict: y.verdict, by: y.by, how: y.how, fails: y.fails, failsIndex: y.fails ? sp.indexOf(y.fails) : -1 }));
  ss.forEach((s, i) => { if (s.over && just[i] && just[i].verdict !== 'yes') just[i].verdict = 'unchecked'; });
  const lf = ys.find((y) => y.t === 'lift');
  let lifted = null;
  if (lf && !lf.error) {
    const rW = hexWords(lf.r, sp.n, sp.W), vW = hexWords(lf.v, sp.n, sp.W);
    lifted = { ...describe(sp, M, setOf(sp, rW, vW, { kind: 'lifted' })), level: lf.level, fallback: lf.fallback };
  } else if (lf) lifted = { error: lf.error };
  const d = ys.find((y) => y.t === 'detail') || {};
  return { counterexamples: cex, ncex: sp.ncex[M], shown: d.ncex ?? cex.length, justification: just, lifted, checked: d.checked ?? 0 };
}

// Is the loop scheme sound on this instance (the audit's question, from the space)? Every option of
// every bad candidate against every solution; the witness with the fewest differing atoms.
export function loopSoundness(sp, { onProgress = null } = {}) {
  if (sp.meta.plan && sp.meta.plan.schemes && sp.meta.plan.schemes.loop !== true) return { sound: null, reason: sp.meta.plan.schemes.loop };
  const c = cacheOf(sp);
  if (c.sound) return c.sound;
  const W = sp.W, words = sp.words, n = sp.n;
  // the solutions by the value of each atom: an option is checked only against the solutions that
  // agree with it on its rarest atom (the same answer as a scan of every solution)
  const byAtom = [];
  for (let j = 0; j < n; j++) {
    const t = [], f = [];
    for (const s of sp.sols) (((words[s * W + (j >> 5)] >>> (j & 31)) & 1) ? t : f).push(s);
    byAtom.push([Int32Array.from(f), Int32Array.from(t)]);
  }
  let unsound = 0, best = null, removesNothing = 0, done = 0, last = Date.now();
  const atRisk = new Uint8Array(sp.count);
  const total = sp.optStart[sp.count];
  for (const M of sp.bad) {
    for (let o = sp.optStart[M]; o < sp.optStart[M + 1]; o++) {
      const r = sp.optR.subarray(o * W, o * W + W), v = sp.optV.subarray(o * W, o * W + W);
      if (!agrees(sp, M, r, v)) removesNothing++;
      let bucket = sp.sols;
      for (let j = 0; j < n && bucket.length; j++) {
        if (!((r[j >> 5] >>> (j & 31)) & 1)) continue;
        const b = byAtom[j][(v[j >> 5] >>> (j & 31)) & 1];
        if (b.length < bucket.length) bucket = b;
      }
      let bad = false;
      for (let k = 0; k < bucket.length; k++) {
        const s0 = bucket[k] * W;
        let hit = true;
        for (let w = 0; w < W; w++) if (((words[s0 + w] ^ v[w]) & r[w]) !== 0) { hit = false; break; }
        if (!hit) continue;
        const sIdx = bucket[k];
        bad = true; atRisk[sIdx] = 1;
        let d = 0;
        for (let w = 0; w < W; w++) { let x = words[M * W + w] ^ words[s0 + w]; while (x) { x &= x - 1; d++; } }
        if (!best || d < best.diff || (d === best.diff && (M < best.M || (M === best.M && (o < best.o || (o === best.o && sIdx < best.s)))))) best = { M, o, s: sIdx, diff: d };
      }
      if (bad) unsound++;
      done++;
      if (onProgress && (done & 1023) === 0 && Date.now() - last >= 250) { last = Date.now(); onProgress({ phase: 'checking every option against every solution', done, of: total }); }
    }
  }
  let risk = 0;
  for (let i = 0; i < sp.count; i++) risk += atRisk[i];
  const witness = best ? { candidate: best.M, option: best.o, solution: best.s,
    candidateAtoms: sp.atomsOf(sp.candWords(best.M)), relevant: maskList(sp.optRw(best.o), sp.n).map((j) => sp.atoms[j - 1]),
    solutionAtoms: sp.atomsOf(sp.candWords(best.s)), differ: sp.atomsOf(Uint32Array.from(sp.candWords(best.M), (x, k) => x ^ sp.words[best.s * sp.W + k])) } : null;
  c.sound = { sound: unsound === 0, unsound, atRisk: risk, witness, removesNothing };
  return c.sound;
}

export function spaceSummary(sp, sound = loopSoundness(sp)) {
  const s = sp.summary();
  return { ...s, link: sp.link, instance: sp.meta.instance || null, variant: sp.meta.variant || null, key: sp.key,
    options: { loop: s.options, block: s.bad }, loopSound: sound.sound === null ? sound.reason : sound.sound, unsoundOptions: sound.unsound || 0,
    atRisk: sound.atRisk || 0, witness: sound.witness || null, schemes: sp.meta.plan ? sp.meta.plan.schemes : null, ms: sp.meta.ms };
}

// The step of a recording (R step number i) to inspect: its candidate and alive set.
export function stepAt(sp, rec, i) {
  const run = mapRun(sp, rec, { clauseSet });
  const k = run.steps.findIndex((s) => s.i === i);
  if (k < 0) throw new LabError(`step ${i} is not a step of link ${sp.link} with a candidate in this recording`, 2);
  const st = run.steps[k];
  if (st.kind !== 'refinement') throw new LabError(`step ${i} is ${st.kind === 'accept' ? 'a solution' : 'not a refinement of a bad candidate'}`, 2);
  return { run, step: st, k, alive: aliveBefore(sp, run, k) };
}

// The headless report (tools/lab.mjs): the space, then what the options ask for.
// o: { instance, variant, link, limit, candidate, step, record, cex, minimal, justify, lift,
//      bounds, exact, simulate, seed, seconds, compare }
export async function labReport(project, o, exec, lua, { readRecording, more = null } = {}) {
  const ctx = await prepare(project, o, exec, lua);
  const sp = await computeSpace(ctx, { limit: o.limit });
  const sound = loopSoundness(sp);
  const res = { space: spaceSummary(sp, sound), code: 0 };
  const rec = o.record && readRecording ? readRecording(o.record) : null;
  if (o.candidate || o.step) {
    let M, alive = null, chosen = null, step = null;
    if (o.step) {
      const at = stepAt(sp, rec, o.step);
      M = at.step.cand; alive = at.alive; chosen = at.step.set; step = o.step;
    } else {
      M = sp.indexOf(o.candidate);
      if (M < 0) throw new LabError(`no candidate ${o.candidate} in the space`, 2);
    }
    const mins = sp.sol[M] ? null : (await minimalFor(exec, sp, [M], { cap: o.minimal, seconds: o.seconds })).get(M);
    const I = sp.sol[M] ? { candidate: M, hex: sp.hex[M], solution: true, ncex: 0, aliveCount: popcount(alive || sp.allBits) } : inspect(sp, M, { alive, minimal: mins, chosen, minimalCap: o.minimal });
    I.step = step;
    I.atomNames = sp.atoms;
    if (mins && mins.budget) res.code = 3;
    if (o.justify && !sp.sol[M]) {
      const sets = [...I.options, ...I.minimal, I.block, ...(I.run ? [I.run] : [])];
      I.detail = await detail(ctx, sp, M, sets, { limit: o.cex, lift: !!o.lift });
    }
    res.inspect = I;
  }
  if (o.bounds) {
    res.bounds = await bounds(exec, sp, o.bounds, { seconds: o.seconds, exact: o.exact, minimalCap: o.minimal });
    if (res.bounds.code) res.code = Math.max(res.code, res.bounds.code);
    if (res.bounds.skipped && /unsupported/.test(res.bounds.skipped)) res.code = 4;
  }
  if (o.simulate) {
    res.simulation = await simulation(exec, sp, o.bounds || 'loop', { runs: o.simulate, seed: o.seed, seconds: o.seconds, minimalCap: o.minimal });
    if (res.simulation.code) res.code = Math.max(res.code, res.simulation.code);
  }
  if (more) await more(res, { ctx, sp, rec, o, exec });
  return res;
}

// ---------------------------------------------------------------------------
// Feature B: schemes, exact bounds, simulation
// ---------------------------------------------------------------------------
export const OMNISCIENT_MAX = 20000;     // bad candidates for which minimal sets are computed for a scheme
function cacheOf(sp) { if (!sp.cache) sp.cache = { minimal: new Map(), schemes: {} }; return sp.cache; }

// The minimal sound sets of every bad candidate (cached on the space).
export async function allMinimal(exec, sp, { cap = LAB_LIMITS.minimal, seconds = LAB_LIMITS.seconds, onProgress = null } = {}) {
  const c = cacheOf(sp);
  const want = Array.from(sp.bad).filter((M) => !c.minimal.has(`${cap}|${M}`));
  if (want.length) {
    const got = await minimalFor(exec, sp, want, { cap, seconds, onProgress });
    for (const [M, v] of got) c.minimal.set(`${cap}|${M}`, v);
  }
  return new Map(Array.from(sp.bad, (M) => [M, c.minimal.get(`${cap}|${M}`)]));
}

// Options and incidence of a scheme; { unsupported } when the scheme does not apply.
export async function schemeData(exec, sp, scheme, { minimalCap = LAB_LIMITS.minimal, seconds = LAB_LIMITS.seconds, maxWork = 4e8, onProgress = null } = {}) {
  if (!SCHEMES.includes(scheme)) throw new LabError(`unknown scheme ${scheme} (loop, omniscient or block)`, 2);
  const plan = sp.meta.plan || {};
  if (scheme === 'loop' && plan.schemes && plan.schemes.loop !== true) return { unsupported: plan.schemes.loop };
  const c = cacheOf(sp);
  const key = `${scheme}|${minimalCap}`;
  if (c.schemes[key]) return c.schemes[key];
  let minimal = null;
  if (scheme === 'omniscient') {
    if (sp.bad.length > OMNISCIENT_MAX) return { unsupported: `${sp.bad.length} bad candidates: minimal sets are computed for at most ${OMNISCIENT_MAX}` };
    if (onProgress) onProgress({ phase: 'minimal sound sets of every bad candidate' });
    minimal = await allMinimal(exec, sp, { cap: minimalCap, seconds, onProgress });
  }
  const so = schemeOptions(sp, scheme, { minimal });
  const inc = incidence(sp, so, { maxWork, onProgress });
  let unsound = 0;
  if (!inc.tooLarge) for (let o = 0; o < inc.nopt; o++) if (inc.sols[o]) unsound++;
  const d = { scheme, so, inc, notes: so.notes, unsound, options: inc.tooLarge ? inc.nopt : inc.nopt };
  c.schemes[key] = d;
  return d;
}

const statusOf = (b) => b && b.status;
// Exact best and worst of one scheme (with a reason when skipped).
export async function bounds(exec, sp, scheme, { seconds = LAB_LIMITS.seconds, exact = LAB_LIMITS.exact, minimalCap = LAB_LIMITS.minimal, onProgress = null } = {}) {
  const d = await schemeData(exec, sp, scheme, { minimalCap, seconds, onProgress });
  const base = { scheme, bad: sp.bad.length };
  if (d.unsupported) return { ...base, skipped: `unsupported: ${d.unsupported}` };
  if (sp.bad.length > exact) return { ...base, skipped: `${sp.bad.length} bad candidates, above the exact-bounds threshold of ${exact}: only the simulation`, notes: d.notes };
  if (d.inc.tooLarge) return { ...base, skipped: 'the scheme\'s removal sets are too large to write as a program', notes: d.notes };
  if (scheme === 'block') {
    // also solved by the program (the tests check that it gives |Bad|); here as for any scheme
  }
  const r = await exactBounds(exec, sp, d.inc, { seconds, onProgress });
  const notes = [];
  if (d.notes.capped) notes.push(`minimal sets capped at ${minimalCap} for ${d.notes.capped} candidates: omniscient best is an upper bound`);
  if (d.notes.missing) notes.push(`${d.notes.missing} candidates without minimal sets (budget)`);
  if (d.notes.stuck.length) notes.push(`${d.notes.stuck.length} bad candidates have no option that removes them (the block stands in)`);
  if (d.notes.dropped) notes.push(`${d.notes.dropped} clause groups that do not remove their candidate left out`);
  if (d.unsound) notes.push(`the scheme is unsound: ${d.unsound} options remove a solution; an idealised run loses a solution when it proposes such a clause before accepting the solution (the audit names one)`);
  const exactOk = !(d.notes.capped || d.notes.missing);
  return { ...base, best: r.best, worst: r.worst, trivial: r.trivial, options: d.inc.nopt, edges: d.inc.edges, unsound: d.unsound, exact: exactOk,
    proven: statusOf(r.best) === 'proven' && statusOf(r.worst) === 'proven', note: notes.join('; ') || null, notes: d.notes, code: (statusOf(r.best) !== 'proven' || statusOf(r.worst) !== 'proven') ? 3 : 0 };
}

// The distribution over random orders (two option policies) and the greedy policies.
export async function simulation(exec, sp, scheme, { runs = LAB_LIMITS.runs, seed = 1, seconds = LAB_LIMITS.seconds, minimalCap = LAB_LIMITS.minimal, onProgress = null } = {}) {
  const d = await schemeData(exec, sp, scheme, { minimalCap, seconds, onProgress });
  if (d.unsupported) return { scheme, skipped: `unsupported: ${d.unsupported}` };
  // one budget for the simulation: two thirds for the random options, a third for the first ones
  const budgetMs = seconds * 1000, two = d.so.scheme === 'loop';
  const random = simulate(sp, d.so, { runs, seed, policy: 'uniform', budgetMs: two ? (budgetMs * 2) / 3 : budgetMs, onProgress });
  const first = two ? simulate(sp, d.so, { runs, seed, policy: 'first', budgetMs: budgetMs / 3, onProgress }) : null;
  let greedyBest = null, greedyWorst = null, greedySkipped = null;
  if (d.inc.tooLarge) greedySkipped = 'the removal sets are too large to index';
  else { greedyBest = greedy(sp, d.inc, 'best'); greedyWorst = greedy(sp, d.inc, 'worst'); }
  return { scheme, runs, seed, random: { ...random, histogram: histogram(random.lengths) }, first: first && { ...first, histogram: histogram(first.lengths) },
    greedyBest, greedyWorst, greedySkipped, unsound: d.unsound, code: random.stopped ? 3 : 0 };
}

export { LAB_LIMITS };
