// Compare two variants (FUTURE-DIRECTIONS, interface): what differs between two variants of a
// project, or between the project as written and one variant. No DOM, no Node: the Loop tab's
// Variants section (js/variants.js) draws the result; test/compare.test.mjs tests it.
//
//   lineDiff(a, b)                  -> [{ op: ' ' | '-' | '+', line }]   (LCS on lines)
//   hunks(diff, context = 2)        -> [{ aStart, bStart, lines: [{ op, line }] }]  (changes with context)
//   compareVariants(project, a, b, history = [])
//     a, b: variant names; '' (or null) = the project as written
//     -> { a, b, fragments: [{ name, diff, added, removed }], loop: { diff, added, removed } | null,
//          constants: [{ name, a, b }], settings: [{ name, a, b }], results: [{ instance, a, b }] }
//     results come from the run history (js/stats.js rows): per instance the latest solution
//     count and the latest audit verdict of each side ({ solutions, exact, audit, time } or null).
import { applyVariant } from './project.js';

const lines = (t) => {
  const s = String(t ?? '');
  if (s === '') return [];
  const l = s.split('\n');
  if (l[l.length - 1] === '') l.pop();   // a final newline is not a line of its own
  return l;
};

// LCS table on the middle part (the common prefix and suffix are taken off first, so that a
// small change in a long text costs little). Above MAX cells the middle part is shown as removed
// and added without alignment.
const MAX = 4e6;
export function lineDiff(aText, bText) {
  const a = lines(aText), b = lines(bText);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  const out = a.slice(0, pre).map((line) => ({ op: ' ', line }));
  const n = A.length, m = B.length;
  if (n * m > MAX) {
    for (const line of A) out.push({ op: '-', line });
    for (const line of B) out.push({ op: '+', line });
  } else {
    // L[i][j]: the length of the LCS of A[i..] and B[j..]
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ op: ' ', line: A[i] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', line: A[i++] });
      else out.push({ op: '+', line: B[j++] });
    }
    while (i < n) out.push({ op: '-', line: A[i++] });
    while (j < m) out.push({ op: '+', line: B[j++] });
  }
  for (const line of a.slice(a.length - suf)) out.push({ op: ' ', line });
  return out;
}

export const changed = (diff) => diff.some((d) => d.op !== ' ');
const count = (diff, op) => diff.filter((d) => d.op === op).length;

// The changed lines with `context` unchanged lines around them, as hunks; aStart and bStart are
// the 1-based line numbers of the hunk's first line on each side.
export function hunks(diff, context = 2) {
  const keep = new Array(diff.length).fill(false);
  diff.forEach((d, k) => {
    if (d.op === ' ') return;
    for (let x = Math.max(0, k - context); x <= Math.min(diff.length - 1, k + context); x++) keep[x] = true;
  });
  const out = [];
  let ai = 1, bi = 1, cur = null;
  diff.forEach((d, k) => {
    if (keep[k]) {
      if (!cur) { cur = { aStart: ai, bStart: bi, lines: [] }; out.push(cur); }
      cur.lines.push(d);
    } else cur = null;
    if (d.op !== '+') ai++;
    if (d.op !== '-') bi++;
  });
  return out;
}

// The instance of a history row: the row's own field, else the "[id]" its loop label ends with
// (rows recorded before the field existed).
export function rowInstance(r) {
  if (r.instance !== undefined) return r.instance || '';
  const m = /\[([^\]]+)\]/.exec(r.loop || '');
  return m ? m[1] : '';
}

// The text the run history's Audit column shows for a verdict.
export function verdictText(a) {
  if (!a) return '';
  if (a.mode === 'space') return a.verdict === 'sound' ? `sound ≤ ${a.k}` : a.verdict === 'unsound' ? `unsound at k = ${a.k}` : a.verdict;
  if (a.mode) return `${a.verdict} (symbolic)`;
  return a.verdict;
}

// Per instance, the latest result of one side (variant name, '' = the project as written).
// A space audit is about the space, not the instance: it is listed under its own key.
export function latestResults(history, variant) {
  const want = variant || null;
  const by = new Map();
  for (const r of history || []) {
    if ((r.variant || null) !== want) continue;
    const key = r.audit && r.audit.mode === 'space' ? `space ${r.audit.space}` : rowInstance(r);
    const x = by.get(key) || { solutions: null, exact: false, audit: null, time: null };
    const isAudit = r.mode === 'audit' || r.mode === 'bounded';
    // a run's count, or an enumerative audit's (the audit counts every solution)
    if (!isAudit || (r.audit && !r.audit.mode && r.audit.verdict !== 'limit')) {
      if (typeof r.solutions === 'number') {
        x.solutions = r.solutions;
        x.exact = isAudit || r.exhausted === true;
        x.time = r.time || x.time;
      }
    }
    if (r.audit) x.audit = verdictText(r.audit);
    by.set(key, x);
  }
  return by;
}

const pairs = (x, y) => {
  const out = [];
  for (const k of [...new Set([...Object.keys(x || {}), ...Object.keys(y || {})])].sort()) {
    const a = x ? x[k] : undefined, b = y ? y[k] : undefined;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ name: k, a: a === undefined ? null : a, b: b === undefined ? null : b });
  }
  return out;
};
// settings a variant can change that a comparison should show (constants are listed apart)
const SHOWN_SETTINGS = (s) => Object.fromEntries(Object.entries(s || {}).filter(([k]) => !['constants', 'variant', 'instance', 'audit'].includes(k)));

export function compareVariants(project, a, b, history = []) {
  const pa = applyVariant(project, a || ''), pb = applyVariant(project, b || '');
  const fb = new Map(pb.fragments.map((f) => [f.name, f.text]));
  const fragments = [];
  for (const f of pa.fragments) {
    const diff = lineDiff(f.text, fb.get(f.name));
    if (changed(diff)) fragments.push({ name: f.name, diff, added: count(diff, '+'), removed: count(diff, '-') });
  }
  const ld = lineDiff(pa.loop.text, pb.loop.text);
  const loop = changed(ld) || pa.loop.language !== pb.loop.language
    ? { diff: ld, added: count(ld, '+'), removed: count(ld, '-'), languages: [pa.loop.language, pb.loop.language] } : null;
  const ra = latestResults(history, a), rb = latestResults(history, b);
  const order = [...(project.instances || []).map((x) => x.id)];
  for (const k of [...ra.keys(), ...rb.keys()]) if (!order.includes(k)) order.push(k);
  const results = order.filter((k) => ra.has(k) || rb.has(k)).map((k) => ({ instance: k, a: ra.get(k) || null, b: rb.get(k) || null }));
  return {
    a: a || '', b: b || '', fragments, loop,
    constants: pairs(pa.settings.constants, pb.settings.constants),
    settings: pairs(SHOWN_SETTINGS(pa.settings), SHOWN_SETTINGS(pb.settings)),
    results,
  };
}
