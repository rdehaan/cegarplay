// PLAN3 phase S7: measure every library space (tools/library.mjs SPACES): k = 1, 2, ... until a
// step is not sound, takes more than --cap seconds, or k reaches --max.
//   node spike3/spaces.mjs [--ids a,b] [--max K] [--cap S] [--shard i/n]
import { loadTarget, spaceAudit } from '../tools/audit.mjs';
import { SPACES } from '../tools/library.mjs';
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ids = opt('--ids') ? opt('--ids').split(',') : Object.keys(SPACES);
const max = Number(opt('--max') || 12), cap = Number(opt('--cap') || 20);
const [si, sn] = (opt('--shard') || '0/1').split('/').map(Number);
let n = 0;
for (const id of ids) {
  if (n++ % sn !== si) continue;
  const p = loadTarget(id);
  p.spaces = SPACES[id];
  for (const sp of p.spaces) {
    const rows = [];
    let last = null;
    for (let k = sp.from ?? 1; k <= max; k++) {
      const t0 = Date.now();
      const r = await spaceAudit(p, { space: sp.name, from: k, to: k, seconds: 60 });
      const row = { k, verdict: r.verdict, t: r.perK[0]?.t ?? null, wall: (Date.now() - t0) / 1000, rounds: r.perK[0]?.rounds, reason: r.reason };
      rows.push(row);
      last = r;
      if (r.verdict !== 'sound' || row.wall > cap) break;
    }
    console.log(JSON.stringify({ id, space: sp.name, rows, witness: last && last.witness }));
  }
}
