// Refinement lab: a recorded run read onto the space (docs/lab-design.md, Feature C).
// No DOM, no Node APIs.
//
//   mapRun(sp, rec)            the run's steps over the space: refinements, acceptances, problems
//   aliveBefore(sp, run, k)    the alive bitset before refinement k (0-based), by replay
//   regret(sp, run, opts)      per refinement: pruning of the run's clause, best of Opt(M), best minimal
//   ladder(...), decomposition(...), percentile(...)
import { removalBits, andCount, popcount, agrees } from './sets.js';

// The link's index in the recording (1-based), by name; 0 when the recording has no I event.
export function linkIndex(rec, name) {
  if (!rec || !rec.I || !rec.I.links) return 0;
  const k = rec.I.links.findIndex((L) => L.link === name);
  return k < 0 ? 0 : k + 1;
}

// The steps of a recording on the space. Every step of the link with a candidate is placed:
//   refinement: a clause (k r or a) on a bad candidate; costs one in the idealised model
//   accept:     a solution step (k s), or a clause on a solution (the block of an accepted one)
//   other:      expand (k e), errors, steps of other links: reported, not placed
// Returns { steps: [{ i, kind, cand, q, set }], refinements: [indices into steps], problems: [...] }
export function mapRun(sp, rec, { clauseSet }) {
  const li = linkIndex(rec, sp.link);
  const problems = [];
  if (!rec || !rec.steps || !rec.steps.length) return { steps: [], refinements: [], problems: ['the recording has no recorded steps (record every step: Loop tab, Recording)'], link: li };
  if (!li) problems.push(`the recording has no link named ${sp.link}`);
  const atoms = li ? rec.I.links[li - 1].atoms : [];
  if (li && (atoms.length !== sp.n || atoms.some((a, j) => a !== sp.atoms[j]))) problems.push('the recording\'s interface atoms differ from the space\'s (another instance, variant or project version?)');
  const steps = [], refinements = [];
  let expands = 0, unmapped = 0, other = 0;
  const policy = rec.header && rec.header.record ? rec.header.record : null;
  const iSeen = rec.steps.map((s) => s.i);
  const gaps = iSeen.some((x, k) => x !== k + 1);
  if (gaps) problems.push('the recording does not have every step (record every step: Loop tab, Recording)');
  for (const st of rec.steps) {
    if (st.k === 'e') { expands++; continue; }
    if (st.k === 'x') continue;
    if (st.k !== 's' && st.l !== li) { other++; continue; }
    const cand = st.c ? sp.indexOf(st.c) : -1;
    if (st.c && cand < 0) unmapped++;
    if (st.k === 's') { steps.push({ i: st.i, kind: 'accept', cand, q: null, set: null }); continue; }
    if (!(st.k === 'r' || st.k === 'a') || !st.q) { other++; continue; }
    const set = clauseSet(sp, st.q);
    const kind = cand >= 0 && !sp.sol[cand] ? 'refinement' : cand >= 0 ? 'accept' : 'unknown';
    steps.push({ i: st.i, kind, cand, q: st.q, set });
    if (kind === 'refinement') refinements.push(steps.length - 1);
  }
  if (expands) problems.push(`${expands} expand steps: rule refinements do not fit the idealised model (unsupported)`);
  if (unmapped) problems.push(`${unmapped} steps name a candidate that is not in the space`);
  if (other) problems.push(`${other} steps of another link or without a clause were left out`);
  void policy;
  return { steps, refinements, problems, link: li, expands, unmapped };
}

// Replay: the alive bitset before step index `upto` (exclusive) of run.steps.
export function aliveBefore(sp, run, upto) {
  const alive = sp.allBits.slice();
  for (let k = 0; k < upto && k < run.steps.length; k++) removeStep(sp, alive, run.steps[k]);
  return alive;
}
function removeStep(sp, alive, st) {
  if (st.set) { const b = removalBits(sp, st.set.r, st.set.v); for (let w = 0; w < alive.length; w++) alive[w] &= ~b[w]; }
  if (st.cand >= 0 && st.kind === 'accept') alive[st.cand >> 5] &= ~(1 << (st.cand & 31));
}

// Per refinement: { step, i, cand, prune (the run's clause), bestOpt, bestMin, total, lost, alive,
// aliveCand (was the candidate alive?) }. minimalOf(M) -> list of sets (optional).
export function regret(sp, run, { loopOptions, minimalOf = null }) {
  const alive = sp.allBits.slice();
  const rows = [];
  let lostTotal = 0;
  run.steps.forEach((st, k) => {
    if (st.kind === 'refinement') {
      const M = st.cand;
      const bits = removalBits(sp, st.set.r, st.set.v);
      const prune = andCount(bits, alive);
      const lostBits = new Uint32Array(alive.length);
      for (let w = 0; w < alive.length; w++) lostBits[w] = bits[w] & alive[w] & sp.solBits[w];
      const lost = popcount(lostBits);
      lostTotal += lost;
      let bestOpt = 0;
      for (const s of loopOptions(sp, M)) { const p = andCount(removalBits(sp, s.r, s.v), alive); if (p > bestOpt) bestOpt = p; }
      let bestMin = null;
      if (minimalOf) {
        const mins = minimalOf(M);
        if (mins) { bestMin = 0; for (const s of mins) { const p = andCount(removalBits(sp, s.r, s.v), alive); if (p > bestMin) bestMin = p; } }
      }
      const aliveCand = ((alive[M >> 5] >>> (M & 31)) & 1) === 1;
      rows.push({ ref: rows.length + 1, k, i: st.i, cand: M, size: st.set.atoms.length, prune, bestOpt, bestMin, regret: Math.max(0, bestOpt - prune),
        lost, aliveCand, inOptions: loopOptions(sp, M).some((s) => sameSet(s, st.set)), alive: popcount(alive) });
    }
    removeStep(sp, alive, st);
  });
  return { rows, lost: lostTotal, aliveEnd: popcount(alive), badLeft: andCount(alive, sp.badBits) };
}
const sameSet = (a, b) => a.r.every((x, k) => x === b.r[k]) && a.v.every((x, k) => x === b.v[k]);
export { sameSet };

// The run's percentile in a simulated distribution: 100·(#shorter + ½·#equal)/#runs.
export function percentile(lengths, L) {
  if (!lengths || !lengths.length) return null;
  let lo = 0, eq = 0;
  for (const x of lengths) { if (x < L) lo++; else if (x === L) eq++; }
  return (100 * (lo + eq / 2)) / lengths.length;
}

// The five largest regrets (ties: earlier first).
export function topRegret(rows, n = 5) {
  return rows.filter((r) => r.regret > 0).sort((a, b) => b.regret - a.regret || a.ref - b.ref).slice(0, n);
}

// Why a real run can fall outside the idealised range.
export function outsideReason(run, { length, best, worst, shape1 }) {
  const lo = best && best.lower != null ? best.lower : null, hi = worst && worst.upper != null ? worst.upper : null;
  if (lo != null && length < lo) return 'shorter than the best idealised run: the run probably did not refine every bad candidate (it stopped early, at a solution or candidate limit) or the recording misses steps';
  if (hi != null && length > hi) {
    const why = [];
    if (shape1) why.push('weak clause retention in Shape 1 (clasp may forget a clause and propose a removed candidate again)');
    if (run.expands) why.push('expand steps, which the idealised model does not have');
    why.push('restarts, or refinements of a candidate already removed');
    return `longer than the worst idealised run: ${why.join('; ')}`;
  }
  return null;
}

export const isAgree = agrees;
