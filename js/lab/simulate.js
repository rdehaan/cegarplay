// Refinery, Feature B: idealised runs simulated on the space.
// No DOM, no Node APIs.
//
//   simulate(sp, so, { runs, seed, policy, budgetMs, onProgress })  random order; policy 'uniform'
//        (an option uniformly from Opt(M)) or 'first' (the first counterexample's option)
//   greedy(sp, so, inc, 'best' | 'worst')   the candidate and option that remove the most
//        (fewest) alive candidates, each step
//   histogram(lengths)
import { agrees } from './sets.js';

// xorshift32, seeded (the same seed gives the same runs in the tab and the tool)
export function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// One idealised run in random order. Returns { length, lost }.
function oneRun(sp, so, rand, policy) {
  const C = sp.count, W = sp.W, words = sp.words;
  const alive = new Int32Array(C);
  for (let i = 0; i < C; i++) alive[i] = i;
  let n = C, badAlive = sp.bad.length, length = 0, lost = 0;
  while (badAlive > 0) {
    const k = Math.floor(rand() * n);
    const M = alive[k];
    if (sp.sol[M]) { alive[k] = alive[--n]; continue; }            // accepted (and blocked)
    const list = so.opts[M];
    const s = policy === 'first' ? list[0] : list[Math.floor(rand() * list.length)];
    length++;
    const r = s.r, v = s.v;
    for (let i = 0; i < n;) {
      const c = alive[i];
      let hit = true;
      for (let w = 0; w < W; w++) if (((words[c * W + w] ^ v[w]) & r[w]) !== 0) { hit = false; break; }
      if (hit) { if (sp.sol[c]) lost++; else badAlive--; alive[i] = alive[--n]; } else i++;
    }
  }
  return { length, lost };
}

export function simulate(sp, so, { runs = 1000, seed = 1, policy = 'uniform', budgetMs = 30000, onProgress = null } = {}) {
  const rand = rng(seed + (policy === 'first' ? 7919 : 0));
  const lengths = [], lostList = [];
  const t0 = Date.now();
  let last = t0, stopped = null;
  for (let k = 0; k < runs; k++) {
    const r = oneRun(sp, so, rand, policy);
    lengths.push(r.length); lostList.push(r.lost);
    const now = Date.now();
    if (onProgress && now - last >= 250) { last = now; onProgress({ phase: `simulation (${policy})`, done: k + 1, of: runs }); }
    if (now - t0 > budgetMs && k + 1 < runs) { stopped = `budget of ${budgetMs < 1000 ? (budgetMs / 1000).toFixed(1) : Math.round(budgetMs / 1000)} s: ${k + 1} of ${runs} runs`; break; }
  }
  return { policy, ...stats(lengths), lengths, lost: lostList.reduce((a, b) => a + b, 0), lostRuns: lostList.filter((x) => x > 0).length,
    lostMax: Math.max(0, ...lostList), lostList, stopped, ms: Date.now() - t0 };
}

export function stats(lengths) {
  const s = lengths.slice().sort((a, b) => a - b);
  const n = s.length;
  if (!n) return { runs: 0, min: null, max: null, median: null, mean: null };
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { runs: n, min: s[0], max: s[n - 1], median, mean: s.reduce((a, b) => a + b, 0) / n };
}

export function histogram(lengths) {
  const m = new Map();
  for (const x of lengths) m.set(x, (m.get(x) || 0) + 1);
  return [...m].sort((a, b) => a[0] - b[0]).map(([length, count]) => ({ length, count }));
}

// Greedy policies on the incidence (js/lab/bounds.js incidence): every step takes, among the
// options of alive bad candidates, the one that removes the most (best) or fewest (worst) alive
// candidates (solutions included). Ties: the lower option number.
export function greedy(sp, inc, mode = 'best') {
  const C = sp.count, nopt = inc.nopt;
  // inverse incidence: candidate -> options removing it (bad candidates; solutions apart)
  const deg = new Int32Array(C);
  for (let o = 0; o < nopt; o++) { deg[inc.owner[o]]++; for (const d of inc.rem[o]) deg[d]++; }
  const start = new Int32Array(C + 1);
  for (let c = 0; c < C; c++) start[c + 1] = start[c] + deg[c];
  const inv = new Int32Array(start[C]), fill = start.slice(0, C);
  for (let o = 0; o < nopt; o++) { inv[fill[inc.owner[o]]++] = o; for (const d of inc.rem[o]) inv[fill[d]++] = o; }
  // alive removal counts: bad removed (owner + rem) + solutions not yet removed
  const count = new Int32Array(nopt);
  for (let o = 0; o < nopt; o++) count[o] = 1 + inc.rem[o].length + inc.sols[o];
  // solutions per option (for lost counting and count updates)
  const solsOf = [];
  let anySol = false;
  for (let o = 0; o < nopt; o++) if (inc.sols[o]) anySol = true;
  if (anySol) {
    for (let o = 0; o < nopt; o++) {
      const out = [];
      if (inc.sols[o]) { const s = inc.sets[o]; for (const c of sp.sols) if (agrees(sp, c, s.r, s.v)) out.push(c); }
      solsOf.push(out);
    }
  }
  const solOpts = new Map();
  if (anySol) for (let o = 0; o < nopt; o++) for (const c of solsOf[o]) { if (!solOpts.has(c)) solOpts.set(c, []); solOpts.get(c).push(o); }
  const aliveC = new Uint8Array(C).fill(1);
  let badAlive = inc.bad, length = 0, lost = 0;
  const order = [];
  const kill = (c) => {
    if (!aliveC[c]) return;
    aliveC[c] = 0;
    if (sp.sol[c]) { lost++; for (const o of solOpts.get(c) || []) count[o]--; return; }
    badAlive--;
    for (let k = start[c]; k < start[c + 1]; k++) count[inv[k]]--;
  };
  while (badAlive > 0) {
    let best = -1, bv = mode === 'best' ? -1 : Infinity;
    for (let o = 0; o < nopt; o++) {
      if (!aliveC[inc.owner[o]]) continue;
      const v = count[o];
      if (mode === 'best' ? v > bv : v < bv) { bv = v; best = o; }
    }
    if (best < 0) break;
    order.push(best); length++;
    kill(inc.owner[best]);
    for (const d of inc.rem[best]) kill(d);
    if (anySol) for (const c of solsOf[best]) kill(c);
  }
  return { mode, length, lost, order };
}
