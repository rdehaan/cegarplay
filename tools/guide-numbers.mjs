// Measure every example of the guide and write guide/numbers.json.
//
//   node tools/guide-numbers.mjs            run every guide example, write guide/numbers.json
//   node tools/guide-numbers.mjs --check    run them, compare with guide/numbers.json, and check
//                                          every <span data-stat="ID:KEY"> of guide/*.html
//
// Each example runs as the page runs it, but with all solutions and no trace. A number on a
// guide page is never typed by hand: it is a data-stat span whose text must be format(value).
// Keys of numbers.json: the example id, or ID@name=value[,name=value] for a run with other
// constants (the variants of a guide entry, and the existing examples in QUOTED).
import fs from 'node:fs';
import { runProject } from './run.mjs';
import { QUOTED } from './guide.mjs';

const root = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
export const NUMBERS = 'guide/numbers.json';

// The keys a page can quote. Computed from the final S event of a run.
export const KEYS = {
  solutions: (s) => s.solutions,
  candidates: (s) => s.candidates,
  counterexamples: (s) => s.counterexamples,
  refinements: (s) => s.clauses + s.expansions,          // clauses (a block is a clause too) and expansions
  clauses: (s) => s.clauses,
  expansions: (s) => s.expansions,
  literals: (s) => s.literals,
  meanClause: (s) => (s.clauses ? Math.round((10 * s.literals) / s.clauses) / 10 : 0),
  maxClause: (s) => s.maxlen,
  checkCalls: (s) => Object.entries(s.solvers).filter(([n]) => n !== 'A').reduce((a, [, v]) => a + v.calls, 0),
  restarts: (s) => s.restarts,
};

// The text a data-stat span must hold.
export function format(key, value) {
  if (key === 'meanClause') return value.toFixed(1);
  return value.toLocaleString('en');
}

export function guideEntries() {
  const lib = JSON.parse(read('examples/library.json'));
  return lib.examples.filter((e) => e.group === 'guide');
}

// The key of a run of example id with the given constants.
export const runKey = (id, constants) => {
  const c = Object.entries(constants || {}).sort(([a], [b]) => a.localeCompare(b));
  return c.length ? `${id}@${c.map(([k, v]) => `${k}=${v}`).join(',')}` : id;
};

// Every run to measure: [{ key, id, constants }]: the guide examples, their variants, QUOTED.
export function runs(entries = guideEntries()) {
  const out = [];
  for (const e of entries) {
    out.push({ key: e.id, id: e.id });
    for (const c of e.variants || []) out.push({ key: runKey(e.id, c), id: e.id, constants: c });
  }
  for (const q of QUOTED) out.push({ key: runKey(q.id, q.constants), id: q.id, constants: q.constants });
  return out;
}

// Run one example (with constants changed); returns { numbers, outcome, exhausted, error }.
export async function measure(id, constants) {
  const p = JSON.parse(read(`examples/${id}.json`));
  p.settings = { ...p.settings, solutions: 0, trace: 0 };
  if (constants) p.settings.constants = { ...p.settings.constants, ...constants };
  const r = await runProject(p);
  if (r.problems.length) return { error: r.problems.map((x) => x.message).join('; ') };
  const ev = (k) => r.events.filter((e) => e.kind === k).map((e) => e.data);
  const err = ev('E').at(-1);
  const done = ev('D').at(-1) || {};
  const s = ev('S').at(-1);
  const numbers = {};
  if (s) for (const [k, f] of Object.entries(KEYS)) numbers[k] = f(s);
  return { numbers, outcome: done.outcome, exhausted: done.exhausted, error: err ? err.message : (r.status === 'trap' ? 'engine trap' : null) };
}

export async function measureAll(entries = guideEntries()) {
  const out = {};
  for (const r of runs(entries)) {
    const m = await measure(r.id, r.constants);
    if (m.error) throw new Error(`${r.key}: ${m.error}`);
    if (m.outcome !== 'finished' || !m.exhausted) throw new Error(`${r.key}: outcome ${m.outcome}, exhausted ${m.exhausted}`);
    out[r.key] = m.numbers;
  }
  return out;
}

// Every <span data-stat="ID:KEY">TEXT</span> in the guide pages.
export function statSpans() {
  const dir = new URL('guide/', root);
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html')).sort()) {
    const html = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of html.matchAll(/<span\b[^>]*\bdata-stat="([^"]*)"[^>]*>([^<]*)<\/span>/g)) {
      const i = m[1].lastIndexOf(':');
      const id = m[1].slice(0, i), key = m[1].slice(i + 1);
      out.push({ file: `guide/${f}`, id, key, text: m[2] });
    }
  }
  return out;
}

// Problems with the spans, given the numbers: [message].
export function checkSpans(numbers, spans = statSpans()) {
  const bad = [];
  for (const s of spans) {
    if (!(s.key in KEYS)) bad.push(`${s.file}: unknown key ${s.key} in ${s.id}:${s.key}`);
    else if (!numbers[s.id]) bad.push(`${s.file}: no numbers for ${s.id}`);
    else if (s.text !== format(s.key, numbers[s.id][s.key])) bad.push(`${s.file}: ${s.id}:${s.key} says "${s.text}", measured ${format(s.key, numbers[s.id][s.key])}`);
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const fresh = await measureAll();
  if (check) {
    const stored = JSON.parse(read(NUMBERS));
    const bad = [];
    for (const id of new Set([...Object.keys(stored), ...Object.keys(fresh)])) {
      if (JSON.stringify(stored[id]) !== JSON.stringify(fresh[id])) bad.push(`${id}: stored ${JSON.stringify(stored[id])}, measured ${JSON.stringify(fresh[id])}`);
    }
    bad.push(...checkSpans(fresh));
    if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
    console.log(`${Object.keys(fresh).length} guide examples and ${statSpans().length} numbers on the pages agree with ${NUMBERS}`);
  } else {
    fs.writeFileSync(new URL(NUMBERS, root), JSON.stringify(fresh, null, 2) + '\n');
    console.log(`${Object.keys(fresh).length} guide examples measured; ${NUMBERS} written`);
  }
}
