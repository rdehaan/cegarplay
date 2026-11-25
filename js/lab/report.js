// Refinery, Feature C: a recorded run against the bounds.
// No DOM, no Node APIs.
//
//   runReport(exec, sp, rec, o)          the run on the space: length, regret per step, top regrets
//   ladder({ run, loop, omni, block, sim })   the rungs on one axis of refinements
//   decomposition({ sp, run, loop, omni, sim })   looseness, refinement strength, order luck
import { mapRun, regret, topRegret, percentile, outsideReason } from './runs.js';
import { clauseSet, loopOptions, minimalFor, setOf } from './core.js';
import { maskOf, valuesOf } from './sets.js';

export async function runReport(exec, sp, rec, { minimalCap = 200, seconds = 30, onProgress = null } = {}) {
  const run = mapRun(sp, rec, { clauseSet });
  const cands = [...new Set(run.refinements.map((k) => run.steps[k].cand))];
  let minimal = null, minimalNote = null;
  if (cands.length && cands.length <= 5000) {
    if (onProgress) onProgress({ phase: `minimal sound sets of the run's ${cands.length} candidates`, force: true });
    minimal = await minimalFor(exec, sp, cands, { cap: minimalCap, seconds, onProgress });
  } else if (cands.length) minimalNote = `${cands.length} distinct candidates: the best minimal sound set is not computed above 5,000`;
  const setsOf = new Map();
  const minimalOf = minimal ? (M) => {
    if (setsOf.has(M)) return setsOf.get(M);
    const m = minimal.get(M);
    const list = m && m.sets ? m.sets.map((a) => { const r = maskOf(a, sp.W); return setOf(sp, r, valuesOf(sp, M, r)); }) : null;
    setsOf.set(M, list);
    return list;
  } : null;
  const rg = regret(sp, run, { loopOptions, minimalOf });
  const shape1 = rec.steps.some((s) => s.k === 'r');
  const notInOptions = rg.rows.filter((r) => !r.inOptions).length;
  const deadCand = rg.rows.filter((r) => !r.aliveCand).length;
  return {
    length: run.refinements.length, accepts: run.steps.filter((s) => s.kind === 'accept').length, problems: run.problems,
    expands: run.expands, unmapped: run.unmapped, shape1, rows: rg.rows, top: topRegret(rg.rows), lost: rg.lost, badLeft: rg.badLeft, aliveEnd: rg.aliveEnd,
    notInOptions, deadCand, minimalNote, header: { instance: rec.header.instance || null, variant: rec.header.variant || null, title: rec.header.title || null },
    solutionsReported: (rec.solutions || []).length, outcome: rec.done ? rec.done.outcome : null,
  };
}

const val = (b) => (b && b.value != null ? b.value : null);
const rung = (label, b, extra = {}) => {
  if (!b) return { label, missing: 'not computed', ...extra };
  if (b.skipped) return { label, missing: b.skipped, ...extra };
  return { label, lo: b.lower ?? val(b), hi: b.upper ?? val(b), exact: b.status === 'proven', status: b.status, ...extra };
};

// The ladder, left to right: best (omniscient), best (loop), greedy best, simulation median, this
// run, greedy worst, worst (loop), |Bad| (block). Unproven values are intervals [lo, hi].
export function ladder({ sp, run = null, compare = null, loop = null, omni = null, sim = null }) {
  const rungs = [
    rung('best (omniscient)', omni && (omni.skipped ? omni : omni.best), { key: 'bestOmni' }),
    rung('best (loop scheme)', loop && (loop.skipped ? loop : loop.best), { key: 'bestLoop' }),
    sim && sim.greedyBest ? { label: 'greedy best', key: 'greedyBest', lo: sim.greedyBest.length, hi: sim.greedyBest.length, exact: true } : { label: 'greedy best', key: 'greedyBest', missing: sim ? (sim.greedySkipped || sim.skipped || 'not computed') : 'not computed' },
    sim && sim.random && sim.random.median != null ? { label: 'simulation median', key: 'median', lo: sim.random.median, hi: sim.random.median, exact: true } : { label: 'simulation median', key: 'median', missing: 'not computed' },
    run ? { label: 'this run', key: 'run', lo: run.length, hi: run.length, exact: true, run: true } : { label: 'this run', key: 'run', missing: 'no recorded run' },
    ...(compare ? [{ label: 'second recording', key: 'compare', lo: compare.length, hi: compare.length, exact: true, run: true }] : []),
    sim && sim.greedyWorst ? { label: 'greedy worst', key: 'greedyWorst', lo: sim.greedyWorst.length, hi: sim.greedyWorst.length, exact: true } : { label: 'greedy worst', key: 'greedyWorst', missing: sim ? (sim.greedySkipped || sim.skipped || 'not computed') : 'not computed' },
    rung('worst (loop scheme)', loop && (loop.skipped ? loop : loop.worst), { key: 'worstLoop' }),
    { label: '|Bad| (block scheme)', key: 'bad', lo: sp.bad.length, hi: sp.bad.length, exact: true },
  ];
  const max = Math.max(1, ...rungs.filter((r) => r.hi != null).map((r) => r.hi));
  const pct = run && sim && sim.random ? percentile(sim.random.lengths, run.length) : null;
  const longest = Math.max(-Infinity, ...[loop && !loop.skipped && loop.worst ? loop.worst.value : null, sim && sim.greedyWorst ? sim.greedyWorst.length : null, sim && sim.random ? sim.random.max : null].filter((x) => x != null));
  const outside = run && loop && !loop.skipped ? outsideReason(run, { length: run.length, best: loop.best, worst: loop.worst, shape1: run.shape1, longest: Number.isFinite(longest) ? longest : null }) : null;
  let sentence = null;
  if (run && pct != null) sentence = `This run made ${run.length} refinements: ${pct.toFixed(1)}% of ${sim.random.runs} simulated runs in random order are shorter (ties count half).`;
  else if (run) sentence = `This run made ${run.length} refinements.`;
  return { rungs, max, percentile: pct, sentence, outside };
}

const fmtI = (b) => (b ? (b.status === 'proven' ? String(b.value) : b.lower != null && b.upper != null ? `${b.lower}–${b.upper}` : '?') : '?');
const diffI = (a, b) => {
  // a − b for intervals [a.lower, a.upper] − [b.lower, b.upper]
  if (!a || !b || a.lower == null || b.upper == null) return null;
  const lo = a.lower - b.upper, hi = a.upper - b.lower;
  return lo === hi ? { value: lo, exact: true, text: String(lo) } : { lo, hi, exact: false, text: `${lo} to ${hi}` };
};

export function decomposition({ sp, run = null, loop = null, omni = null, sim = null }) {
  const cand = sp.count, bad = sp.bad.length;
  const rows = [{ factor: 'Abstraction looseness', key: 'looseness', value: bad, ratio: cand ? bad / cand : 0,
    text: `${bad} bad of ${cand} candidates (${cand ? ((100 * bad) / cand).toFixed(1) : 0}%)`,
    meaning: 'How many spurious candidates the abstraction admits at all' }];
  const lb = loop && !loop.skipped ? loop.best : null, ob = omni && !omni.skipped ? omni.best : null;
  let rs = diffI(lb, ob);
  // for a sound loop scheme the omniscient best is never longer (each sound option contains a minimal
  // sound set, which removes at least as much): the difference is at least 0
  if (rs && loop && loop.unsound === 0 && !rs.exact && rs.lo < 0) rs = rs.hi <= 0 ? { value: 0, exact: true, text: '0' } : { ...rs, lo: 0, text: `0 to ${rs.hi}` };
  rows.push({ factor: 'Refinement strength', key: 'strength', ...(rs || {}),
    text: rs ? `best (loop) ${fmtI(lb)} − best (omniscient) ${fmtI(ob)} = ${rs.text}${omni && omni.exact === false ? ' (minimal sets capped: omniscient best is an upper bound)' : ''}` : `not known: ${!lb ? (loop && loop.skipped) || 'loop-scheme bounds not computed' : (omni && omni.skipped) || 'omniscient bounds not computed'}`,
    meaning: 'Refinements a better relevant/1 could save at best' });
  if (run) {
    const ol = lb ? diffI({ lower: run.length, upper: run.length }, lb) : null;
    const pct = sim && sim.random ? percentile(sim.random.lengths, run.length) : null;
    rows.push({ factor: 'Order luck', key: 'luck', ...(ol || {}), percentile: pct,
      text: `${ol ? `this run ${run.length} − best (loop) ${fmtI(lb)} = ${ol.text}` : `this run ${run.length}; best (loop) not known`}${pct != null ? `; percentile ${pct.toFixed(1)}` : ''}`,
      meaning: 'Refinements lost to the order of candidates and counterexamples' });
  }
  return rows;
}
