// Shared helpers of the Refinery tests.
import { LabSpace } from '../js/lab/space.js';

// A seeded random space over n atoms: distinct candidates, some solutions, random options.
export function randomSpace(n, count, nsol, seed) {
  let s = seed >>> 0;
  const rnd = (k) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % k; };
  const all = Array.from({ length: 1 << n }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) { const j = rnd(i + 1); [all[i], all[j]] = [all[j], all[i]]; }
  const cands = all.slice(0, count);
  const rows = cands.map((x, i) => {
    if (i < nsol) return { hex: x.toString(16), ncex: 0, opts: [] };
    const opts = [];
    const k = 1 + rnd(3);
    for (let t = 0; t < k; t++) { const r = rnd(1 << n) | (1 << rnd(n)); if (!opts.some((o) => o[0] === r.toString(16))) opts.push([r.toString(16), 1 + rnd(3)]); }
    return { hex: x.toString(16), ncex: opts.reduce((a, o) => a + o[1], 0), opts };
  });
  return new LabSpace(Array.from({ length: n }, (_, j) => `a(${j + 1})`), rows, { link: 'G' });
}

