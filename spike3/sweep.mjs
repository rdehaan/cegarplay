// PLAN3 phase S6, task 1 and the sweep: the symbolic audit (lua/bounded.lua) against the
// enumerative audit (lua/audit.lua) on every clause-based library instance the audit can run,
// and on mutations (one relevant/1 rule deleted at a time) of each example's default instance.
//
//   node spike3/sweep.mjs [--shard i/n] [--mutations] [--ids a,b,c] > out.jsonl
//
// One JSON line per case: { id, instance, mutation, audit: {verdict, t, diff}, symbolic: {...} }.
import fs from 'node:fs';
import { loadTarget, auditProject } from '../tools/audit.mjs';
import { compile } from '../js/compiler.js';
import { boundedPlan } from '../js/driver.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const [si, sn] = (opt('--shard') || '0/1').split('/').map(Number);
const mutations = args.includes('--mutations');
const only = opt('--ids') ? opt('--ids').split(',') : null;
const seconds = Number(opt('--seconds') || 60);
const lib = JSON.parse(fs.readFileSync(new URL('../examples/library.json', import.meta.url), 'utf8'));

function clauseBased(p) {
  if (p.loop.language !== 'loop') return null;
  const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
  const b = boundedPlan(c);
  if (b.error || b.unsupported || !(b.clause || b.clauses)) return null;
  return b;
}

// every rule that derives relevant/1, one mutation per rule (fragment, line range)
function relevantRules(p) {
  const out = [];
  for (const f of p.fragments) {
    const lines = f.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*relevant\(/.test(lines[i]) && !/^\s*%/.test(lines[i])) {
        let j = i;
        while (j < lines.length && !/\.\s*(%.*)?$/.test(lines[j])) j++;
        out.push({ fragment: f.name, from: i, to: j, text: lines.slice(i, j + 1).join(' ').trim() });
      }
    }
  }
  return out;
}
function mutate(p, m) {
  const q = structuredClone(p);
  const f = q.fragments.find((x) => x.name === m.fragment);
  const lines = f.text.split('\n');
  lines.splice(m.from, m.to - m.from + 1, '% (deleted)');
  f.text = lines.join('\n');
  return q;
}

const summary = (r) => {
  const v = r.verdict;
  if (r.problems.length) return { verdict: 'problem', reason: r.problems[0].message };
  if (!v) return { verdict: 'none', reason: r.error ? r.error.message : r.done ? r.done.outcome : String(r.status) };
  return { verdict: v.verdict, t: v.t, diff: v.witness ? v.witness.differ.length : undefined, rounds: v.rounds, refinements: v.refinements,
    fallback: v.fallback, kinds: v.kinds, reason: v.reason, candidates: v.candidates };
};

let n = 0;
for (const e of lib.examples) {
  if (only && !only.includes(e.id)) continue;
  let p;
  try { p = loadTarget(e.id); } catch { continue; }
  const plan = clauseBased(p);
  if (!plan) continue;
  const cases = [];
  const insts = (p.instances || []).length ? p.instances : [{ id: null }];
  if (!mutations) for (const x of insts) cases.push({ p, instance: x.id, off: x.audit === false, mutation: null });
  else {
    const def = (p.instances || []).find((x) => x.audit !== false);
    for (const m of relevantRules(p)) cases.push({ p: mutate(p, m), instance: def ? def.id : null, off: false, mutation: m.text });
  }
  for (const c of cases) {
    if (n++ % sn !== si) continue;
    const t0 = Date.now();
    const s = summary(await auditProject(c.p, { instance: c.instance || undefined, symbolic: true, seconds }));
    s.wall = (Date.now() - t0) / 1000;
    let a = { verdict: 'skipped' };
    if (!c.off) {
      const t1 = Date.now();
      a = summary(await auditProject(c.p, { instance: c.instance || undefined, limit: 200000, seconds }));
      a.wall = (Date.now() - t1) / 1000;
    }
    console.log(JSON.stringify({ id: e.id, instance: c.instance, off: c.off, mutation: c.mutation, kinds: plan.kinds, audit: a, symbolic: s }));
  }
}
