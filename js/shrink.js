// Delta debugging (Zeller's ddmin) for instances. No DOM.
//
//   shrink(items, test, { jobs }) -> a 1-minimal sublist for which test is still true
// test(subset) -> Promise<boolean>; the tests of one round are independent and run `jobs` at a
// time. normaliseFacts turns instance facts into one ground fact per item.
import { parseClingoErrors } from './driver.js';

async function firstTrue(cands, test, jobs) {
  // in order: the first candidate whose test holds (runs up to `jobs` tests at once)
  for (let i = 0; i < cands.length; i += jobs) {
    const batch = cands.slice(i, i + jobs);
    const res = await Promise.all(batch.map((c) => test(c)));
    const k = res.indexOf(true);
    if (k >= 0) return batch[k];
  }
  return null;
}

export async function shrink(items, test, { jobs = 1, onStep = () => {} } = {}) {
  let cur = items.slice(), n = 2, tests = 0;
  const t = async (x) => { tests++; return test(x); };
  while (cur.length >= 2) {
    const size = Math.ceil(cur.length / n);
    const chunks = [];
    for (let i = 0; i < cur.length; i += size) chunks.push(cur.slice(i, i + size));
    // complements first (the usual ddmin order: reduce to a complement, then to a chunk)
    const comps = chunks.map((_, i) => chunks.filter((__, j) => j !== i).flat()).filter((c) => c.length);
    let hit = await firstTrue(comps, t, jobs);
    if (hit) { cur = hit; n = Math.max(n - 1, 2); onStep(cur, tests); continue; }
    hit = await firstTrue(chunks.length > 1 ? chunks : [], t, jobs);
    if (hit) { cur = hit; n = 2; onStep(cur, tests); continue; }
    if (n >= cur.length) break;
    n = Math.min(cur.length, n * 2);
  }
  return { items: cur, tests };
}

// Lower each numeric constant while the test holds: { name: value } -> smaller values.
export async function shrinkConstants(constants, test) {
  const cur = { ...constants };
  let tests = 0;
  for (const k of Object.keys(cur)) {
    if (!/^-?\d+$/.test(String(cur[k]))) continue;
    let v = Number(cur[k]);
    while (v > 0) {
      const next = { ...cur, [k]: String(v - 1) };
      tests++;
      if (!(await test(next))) break;
      v--; cur[k] = String(v);
    }
  }
  return { constants: cur, tests };
}

// Facts as one ground fact per line: clingo --mode=gringo --text (rules with conditions are
// grounded too). Returns { facts: [...], error }.
export async function normaliseFacts(text, engineRun, constants = {}) {
  const c = Object.entries(constants).flatMap(([k, v]) => ['-c', `${k}=${v}`]).join(' ');
  const r = await engineRun(text + '\n', `--mode=gringo --text -Wnone ${c}`.trim());
  if (r.status !== 0) {
    const e = parseClingoErrors(r.err || [])[0];
    return { facts: [], error: e ? `line ${e.line}: ${e.message}` : `clingo exited with status ${r.status}` };
  }
  const facts = (r.out || []).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && /\.$/.test(l));
  return { facts, error: null };
}
