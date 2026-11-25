// Refinery: removal sets, soundness, forced atoms, the one-atom neighbourhood
// (docs/lab-design.md, "Definitions"). No DOM, no Node APIs.
//
// A set is a pair of atom word masks (r, v): S = the atoms of r, v = the values the clause's
// removed candidates have on them (M's values for a relevant set or a block). For a bad candidate
// M and S ⊆ I, cl(M, S) removes R(M, S) = the candidates that agree with M on S.

export const popcount32 = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
export function popcount(bits) { let c = 0; for (let k = 0; k < bits.length; k++) c += popcount32(bits[k]); return c; }
export function andCount(a, b) { let c = 0; for (let k = 0; k < a.length; k++) c += popcount32(a[k] & b[k]); return c; }
export const maskCount = popcount;
export function maskHas(w, j) { return ((w[(j - 1) >> 5] >>> ((j - 1) & 31)) & 1) === 1; }       // j 1-based
export function maskOf(list, W) { const w = new Uint32Array(W); for (const j of list) w[(j - 1) >> 5] |= 1 << ((j - 1) & 31); return w; }
export function maskList(w, n) { const out = []; for (let j = 1; j <= n; j++) if (maskHas(w, j)) out.push(j); return out; }
export const maskKey = (w) => Array.from(w).join(',');
export function bitList(bits, limit = Infinity) { const out = []; for (let k = 0; k < bits.length && out.length < limit; k++) { let x = bits[k]; while (x) { const b = 31 - Math.clz32(x & -x); out.push(k * 32 + b); x &= x - 1; if (out.length >= limit) break; } } return out; }

// M's values on S
export function valuesOf(sp, M, rW) { const W = sp.W, v = new Uint32Array(W); for (let k = 0; k < W; k++) v[k] = sp.words[M * W + k] & rW[k]; return v; }

// R(S, v) as a bitset over candidates
export function removalBits(sp, rW, vW, out = null) {
  const CW = sp.CW, res = out || new Uint32Array(CW);
  res.set(sp.allBits);
  for (let j = 0; j < sp.n; j++) {
    if (!((rW[j >> 5] >>> (j & 31)) & 1)) continue;
    const T = sp.bitsT.subarray(j * CW, (j + 1) * CW);
    if ((vW[j >> 5] >>> (j & 31)) & 1) for (let k = 0; k < CW; k++) res[k] &= T[k];
    else for (let k = 0; k < CW; k++) res[k] &= ~T[k] & sp.allBits[k];
  }
  return res;
}
export const removal = (sp, rW, vW) => popcount(removalBits(sp, rW, vW));
export const pruning = (sp, rW, vW, alive) => andCount(removalBits(sp, rW, vW), alive || sp.allBits);

// Does candidate i agree with v on r?
export function agrees(sp, i, rW, vW) {
  const W = sp.W, w = sp.words;
  for (let k = 0; k < W; k++) if (((w[i * W + k] ^ vW[k]) & rW[k]) !== 0) return false;
  return true;
}
export function differ(sp, a, b) { const W = sp.W, d = new Uint32Array(W); for (let k = 0; k < W; k++) d[k] = sp.words[a * W + k] ^ sp.words[b * W + k]; return d; }
export function differCount(sp, a, b) { let c = 0; const W = sp.W; for (let k = 0; k < W; k++) c += popcount32(sp.words[a * W + k] ^ sp.words[b * W + k]); return c; }

// Sound: R(S, v) has no solution. Returns { sound, lost, witness } where witness is the lost
// solution that differs from M (when given) on the fewest atoms, as the audit chooses it.
export function soundness(sp, rW, vW, M = -1) {
  let lost = 0, witness = -1, best = Infinity;
  for (const s of sp.sols) {
    if (agrees(sp, s, rW, vW)) {
      lost++;
      const d = M >= 0 ? differCount(sp, M, s) : 0;
      if (d < best) { best = d; witness = s; }
    }
  }
  return { sound: lost === 0, lost, witness };
}
export const isSound = (sp, rW, vW) => { for (const s of sp.sols) if (agrees(sp, s, rW, vW)) return false; return true; };

// D(M): { D(M, s) : s in Sol } with each set's solution; minimal(): the inclusion-minimal members
// (their minimal hitting sets are those of the whole family). Sorted by size.
export function differFamily(sp, M) {
  return Array.from(sp.sols, (s) => ({ s, d: differ(sp, M, s), size: differCount(sp, M, s) })).sort((a, b) => a.size - b.size || a.s - b.s);
}
export function minimalFamily(fam) {
  const kept = [], seen = new Set();
  for (const f of fam) {
    const key = maskKey(f.d);
    if (seen.has(key)) continue;
    let dominated = false;
    for (const g of kept) {
      let sub = true;
      for (let k = 0; k < f.d.length; k++) if ((g.d[k] & ~f.d[k]) !== 0) { sub = false; break; }
      if (sub) { dominated = true; break; }
    }
    if (!dominated) { kept.push(f); seen.add(key); }
  }
  return kept;
}
// S hits every member of the family
export function hitsAll(fam, rW) {
  for (const f of fam) { let hit = false; for (let k = 0; k < rW.length; k++) if (f.d[k] & rW[k]) { hit = true; break; } if (!hit) return false; }
  return true;
}

// Forced atoms: t is in every sound set of M exactly when some solution differs from M only on t.
// Returns [{ atom (1-based), witness (solution index) }], one per atom (the first witness).
export function forcedAtoms(sp, M, fam = null) {
  const out = new Map();
  for (const f of fam || differFamily(sp, M)) {
    if (f.size !== 1) { if (f.size > 1) break; continue; }
    const j = maskList(f.d, sp.n)[0];
    if (!out.has(j)) out.set(j, f.s);
  }
  return [...out].map(([atom, witness]) => ({ atom, witness })).sort((a, b) => a.atom - b.atom);
}

// The one-step neighbourhood of a set (r, v) of M: for each atom t, dropping t from S (when in S)
// and adding t (with M's value) to S. alive: the bitset of alive candidates (default all).
export function neighbourhood(sp, M, rW, vW, alive = null) {
  const al = alive || sp.allBits;
  const base = removalBits(sp, rW, vW);
  const baseTotal = popcount(base), basePrune = andCount(base, al);
  const rows = [];
  for (let j = 1; j <= sp.n; j++) {
    const r2 = rW.slice(), v2 = vW.slice();
    const k = (j - 1) >> 5, b = 1 << ((j - 1) & 31);
    const inS = (rW[k] & b) !== 0;
    if (inS) { r2[k] &= ~b; v2[k] &= ~b; } else { r2[k] |= b; v2[k] = (v2[k] & ~b) | (sp.words[M * sp.W + k] & b); }
    const bits = removalBits(sp, r2, v2);
    const total = popcount(bits), prune = andCount(bits, al);
    rows.push({ atom: j, inS, sound: isSound(sp, r2, v2), total, prune, dTotal: total - baseTotal, dPrune: prune - basePrune });
  }
  return { total: baseTotal, prune: basePrune, rows };
}

// Brute force (tests, tiny spaces): every subset of I, its soundness; the minimal sound sets.
export function bruteMinimal(sp, M, maxAtoms = 20) {
  const n = sp.n;
  if (n > maxAtoms) throw new Error(`brute force over ${n} atoms`);
  const W = sp.W, sound = new Uint8Array(1 << n);
  for (let m = 0; m < (1 << n); m++) {
    const r = new Uint32Array(W);
    for (let j = 0; j < n; j++) if (m & (1 << j)) r[j >> 5] |= 1 << (j & 31);
    sound[m] = isSound(sp, r, valuesOf(sp, M, r)) ? 1 : 0;
  }
  const minimal = [];
  for (let m = 0; m < (1 << n); m++) {
    if (!sound[m]) continue;
    let min = true;
    for (let j = 0; j < n; j++) if ((m & (1 << j)) && sound[m & ~(1 << j)]) { min = false; break; }
    if (min) minimal.push(Array.from({ length: n }, (_, j) => j + 1).filter((j) => m & (1 << (j - 1))));
  }
  return { sound, minimal };
}

// Lattice data (the Hasse diagram over a chosen atom list, at most 10 atoms): every subset of
// atoms, its soundness and pruning. Nodes indexed by bitmask over the list.
export const LATTICE_MAX = 10;
export function lattice(sp, M, atomList, alive = null) {
  const k = atomList.length;
  if (k > LATTICE_MAX) return { tooLarge: true, atoms: atomList };
  const nodes = [];
  for (let m = 0; m < (1 << k); m++) {
    const r = maskOf(atomList.filter((_, i) => m & (1 << i)), sp.W);
    const v = valuesOf(sp, M, r);
    const bits = removalBits(sp, r, v);
    nodes.push({ mask: m, size: popcount32(m), sound: isSound(sp, r, v), prune: andCount(bits, alive || sp.allBits), total: popcount(bits) });
  }
  return { atoms: atomList, nodes };
}
