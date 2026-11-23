import fs from 'node:fs';
import { runProject } from './run.mjs';
const p = JSON.parse(fs.readFileSync(`examples/${process.argv[2]}.json`, 'utf8'));
p.loop.text = fs.readFileSync(process.argv[3], 'utf8');
if (process.argv[4]) for (const [k, v] of Object.entries(JSON.parse(process.argv[4]))) { if (k === 'instance') p.settings.instance = v; else { const f = p.fragments.find((x) => x.name === k); if (f) f.text = v; else p.fragments.push({ name: k, text: v }); } }
p.settings.solutions = 0; p.settings.trace = 0;
const r = await runProject(p);
if (r.problems && r.problems.length) { console.log('PROBLEM', r.problems[0].message); process.exit(1); }
const last = (k) => r.events.filter((e) => e.kind === k).map((e) => e.data).at(-1);
const s = last('S'), d = last('D'), e = last('E');
const calls = Object.entries(s.solvers).map(([n, v]) => `${n}:${v.calls}`).join(' ');
console.log(`sol ${s.solutions} cand ${s.candidates} cex ${s.counterexamples} clauses ${s.clauses} exp ${s.expansions} lits ${s.literals} mean ${(s.literals / Math.max(1, s.clauses)).toFixed(1)} calls ${calls} counters ${JSON.stringify(s.counters)} tracked ${JSON.stringify(s.tracked || {})} | ${d && d.outcome} ex ${d && d.exhausted} ${e ? 'ERR ' + e.message : ''} t ${s.t.toFixed(2)}`);
