// The candidate space: the fate of every candidate of the
// unrefined abstraction under the clauses of a recording. No DOM.
//
//   const S = Space.fromHex(candidateHex, n)          // one hex vector per candidate (P events)
//   const F = fates(S, steps, { truth, reported })    // steps: R events of the link
import { hexBits } from './recording.js';

export class Space {
  constructor(n, count) {
    this.n = n; this.count = count;
    this.W = Math.max(1, Math.ceil(n / 32));
    this.words = new Uint32Array(this.W * count);
  }
  static fromHex(list, n) {
    const s = new Space(n, list.length);
    list.forEach((h, i) => {
      const b = hexBits(h, n);
      for (let j = 1; j <= n; j++) if (b[j]) s.words[i * s.W + ((j - 1) >> 5)] |= 1 << ((j - 1) & 31);
    });
    s.index = new Map(list.map((h, i) => [normHex(h), i]));
    s.hex = list;
    return s;
  }
  bit(i, j) { return (this.words[i * this.W + ((j - 1) >> 5)] >>> ((j - 1) & 31)) & 1; }
  atoms(i, names) { const out = []; for (let j = 1; j <= this.n; j++) if (this.bit(i, j)) out.push(names ? names[j - 1] : j); return out; }
  popcount(i) { let c = 0; for (let j = 1; j <= this.n; j++) c += this.bit(i, j); return c; }
}
const normHex = (h) => String(h || '').replace(/^0+/, '') || '0';

// The masks of a clause (signed atom indices): a candidate falsifies every literal when its
// positive-literal bits are all 0 and its negative-literal bits all 1.
function masks(q, W) {
  const pos = new Uint32Array(W), neg = new Uint32Array(W);
  for (const x of q) {
    const j = Math.abs(x) - 1;
    if (x > 0) pos[j >> 5] |= 1 << (j & 31); else neg[j >> 5] |= 1 << (j & 31);
  }
  return { pos, neg };
}
export function removedBy(space, q) {
  const { pos, neg } = masks(q, space.W), W = space.W, w = space.words, out = [];
  for (let i = 0; i < space.count; i++) {
    let hit = true;
    for (let k = 0; k < W; k++) {
      const c = w[i * W + k];
      if ((c & pos[k]) !== 0 || ((c & neg[k]) >>> 0) !== neg[k]) { hit = false; break; }
    }
    if (hit) out.push(i);
  }
  return out;
}

// fates: per refinement step { ref (1-based among refinements), i (the R step), k, len, removed, fresh, already, lost, accepted }; per
// candidate the step that removed it (0 = alive) and whether it was accepted. truth: a Set of
// candidate indices that are solutions (from an audit) or null. reported: hex vectors of the
// solution steps (R kind s). A full-length clause on a reported candidate is an acceptance, and
// so is one that comes right after the run reported solutions of another solver (a loop that
// lists the outcomes of a candidate with C.models and then blocks it: kemeny-rankings).
export function fates(space, steps, { truth = null } = {}) {
  const fate = new Int32Array(space.count);           // step number that removed it, 0 = alive
  const accepted = new Int32Array(space.count);         // the R step that accepted it, 0 = not
  const reported = new Set();
  const rows = [];
  let firstUnsound = null, alive = space.count;
  const aliveSeries = [], removals = [];
  let since = false;                                    // a solution reported since the last refinement
  for (const st of steps) {
    if (st.k === 's') { if (st.c) reported.add(normHex(st.c)); else since = true; continue; }
    if (!(st.k === 'r' || st.k === 'a') || !st.q) continue;
    const gone = removedBy(space, st.q);
    let fresh = 0, lost = 0, acc = 0;
    const full = st.q.length === space.n;
    const listed = full && since;
    since = false;
    for (const i of gone) {
      if (fate[i] || accepted[i]) continue;
      if (full && (listed || reported.has(normHex(space.hex[i])))) { accepted[i] = st.i; acc++; continue; }
      fate[i] = st.i; fresh++;
      if (truth && truth.has(i)) lost++;
    }
    alive -= fresh;
    const row = { ref: rows.length + 1, i: st.i, k: st.k, len: st.q.length, removed: gone.length, fresh, already: gone.length - fresh - acc, lost, accepted: acc };
    rows.push(row);
    aliveSeries.push(alive);
    removals.push(gone.length);
    if (lost && !firstUnsound) firstUnsound = row;
  }
  return { rows, fate, accepted, alive, aliveSeries, removals, firstUnsound,
    already: rows.reduce((a, r) => a + r.already, 0), total: rows.reduce((a, r) => a + r.removed, 0) };
}

// Blame: how many clauses name each atom (1-based).
export function blame(n, steps) {
  const b = new Array(n + 1).fill(0);
  for (const st of steps) if (st.q && (st.k === 'r' || st.k === 'a')) for (const x of st.q) b[Math.abs(x)]++;
  return b;
}

// Map orders: cell (x, y) per candidate.
// 'blame': candidates sorted by their bits in blame order, placed along a Z-order curve.
// 'size': rows by the number of true atoms, candidates in a row by index.
export function mapOrder(space, steps, kind = 'blame') {
  const n = space.n, xs = new Int32Array(space.count), ys = new Int32Array(space.count);
  if (kind === 'size') {
    const rowLen = new Map();
    for (let i = 0; i < space.count; i++) {
      const p = space.popcount(i);
      const k = rowLen.get(p) || 0;
      rowLen.set(p, k + 1);
      xs[i] = k; ys[i] = p;
    }
    return { xs, ys, width: Math.max(...rowLen.values(), 1), height: n + 1 };
  }
  const b = blame(n, steps);
  const order = Array.from({ length: n }, (_, j) => j + 1).sort((p, q) => b[q] - b[p] || p - q);
  // the code of a candidate: its bits in blame order (most blamed first); candidates sorted by
  // code, then placed along a Z-order curve by rank: x takes the even bits of the rank, y the
  // odd ones. One cell per candidate; candidates that agree on the most blamed atoms stay close.
  const idx = Array.from({ length: space.count }, (_, i) => i);
  const cmp = (p, q) => { for (const j of order) { const d = space.bit(q, j) - space.bit(p, j); if (d) return d; } return p - q; };
  idx.sort(cmp);
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, space.count))));
  let w = 0, hgt = 0;
  idx.forEach((i, r) => {
    let x = 0, y = 0;
    for (let t = 0; t < bits; t++) { const v = (r >> t) & 1; if (t % 2 === 0) x |= v << (t >> 1); else y |= v << (t >> 1); }
    xs[i] = x; ys[i] = y;
    if (x + 1 > w) w = x + 1;
    if (y + 1 > hgt) hgt = y + 1;
  });
  return { xs, ys, width: w, height: hgt };
}

// Hindsight redundancy: steps whose clause contains an earlier clause (removes nothing new by
// subsumption), and candidates that falsify a clause added before (already removed).
export function redundancy(steps) {
  const clauses = [];
  const out = [];
  for (const st of steps) {
    if (!st.q || !(st.k === 'r' || st.k === 'a')) continue;
    const set = new Set(st.q);
    const by = clauses.find((c) => [...c.set].every((x) => set.has(x)));
    if (by) out.push({ i: st.i, subsumedBy: by.i });
    clauses.push({ i: st.i, set });
  }
  return out;
}

// The blame matrix: rows = refinement steps, columns = atoms, ordered by a greedy seriation on
// the overlap (Jaccard) of the atoms' blame sets.
export function blameMatrix(n, steps) {
  const rows = steps.filter((s) => s.q && (s.k === 'r' || s.k === 'a'));
  const sets = Array.from({ length: n + 1 }, () => new Set());
  rows.forEach((s, r) => { for (const x of s.q) sets[Math.abs(x)].add(r); });
  const used = [];
  for (let j = 1; j <= n; j++) if (sets[j].size) used.push(j);
  if (!used.length) return { rows, cols: [] };
  const jac = (a, b) => { let i = 0; for (const x of sets[a]) if (sets[b].has(x)) i++; const u = sets[a].size + sets[b].size - i; return u ? i / u : 0; };
  used.sort((a, b) => sets[b].size - sets[a].size || a - b);
  const cols = [used.shift()];
  while (used.length) {
    const last = cols[cols.length - 1];
    let best = 0, bv = -1;
    used.forEach((j, k) => { const v = jac(last, j); if (v > bv) { bv = v; best = k; } });
    cols.push(used.splice(best, 1)[0]);
  }
  return { rows, cols };
}

// Sample mode (above the limit): random sign vectors; every figure is labelled "sample, not uniform".
export function sampleSpace(n, count, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
  const sp = new Space(n, count);
  for (let i = 0; i < sp.words.length; i++) sp.words[i] = rnd();
  const extra = sp.W * 32 - n;
  if (extra > 0) for (let i = 0; i < count; i++) sp.words[i * sp.W + sp.W - 1] &= 0xffffffff >>> extra;
  sp.hex = []; sp.sample = true;
  return sp;
}

// What a refinement was, for the candidate space's detail box: its R step (k, s = solver, c =
// candidate as hex, q = clause as signed atom indices, 1-based into atoms) and, when the trace
// kept it, its paired T event (the counterexample). The clause removes every candidate that
// falsifies all its literals: "at least one of" the literals must hold.
export function refinementDetail(step, atoms, t = null) {
  const name = (j) => atoms[j - 1] ?? `#${j}`;
  let candidate = null;
  if (step.c !== undefined && step.c !== null) {
    const b = hexBits(step.c, atoms.length);
    candidate = [];
    for (let j = 1; j <= atoms.length; j++) if (b[j]) candidate.push(name(j));
  }
  const clause = (step.q || []).map((x) => (x > 0 ? name(x) : `not ${name(-x)}`));
  return {
    // the R step's s is the solver's index; the trace has its name
    step: step.i, kind: step.k, solver: (t && t.solver) || (typeof step.s === 'string' ? step.s : ''),
    candidate: candidate ?? (t && t.candidate ? String(t.candidate).split(' ').filter(Boolean) : []),
    clause,
    counterexample: t ? (t.counterexample ?? null) : null,
    traced: !!t,
    traceStep: t ? t.i : null,
  };
}
