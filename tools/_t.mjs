// _try3.mjs id loopfile|- '{"edits":{"frag":[["old","new"]]},"constants":{},"instance":"x","variant":"v"}'
import fs from 'node:fs';
import { runProject } from './run.mjs';
const p = JSON.parse(fs.readFileSync(`examples/${process.argv[2]}.json`, 'utf8'));
if (process.argv[3] !== '-') p.loop.text = fs.readFileSync(process.argv[3], 'utf8');
const opts = JSON.parse(process.argv[4] || '{}');
for (const [name, eds] of Object.entries(opts.edits || {})) { const f = p.fragments.find((x) => x.name === name); for (const [a, b] of eds) { if (!f.text.includes(a)) { console.log('EDIT MISS', name, a); process.exit(1); } f.text = f.text.replace(a, b); } }
p.settings.solutions = 0; p.settings.trace = 0;
if (opts.constants) p.settings.constants = { ...p.settings.constants, ...opts.constants };
const r = await runProject(p, { ...(opts.instance !== undefined ? { instance: opts.instance } : {}), ...(opts.variant ? { variant: opts.variant } : {}) });
if (r.problems && r.problems.length) { console.log('PROBLEM', r.problems[0].message); process.exit(1); }
const last = (k) => r.events.filter((e) => e.kind === k).map((e) => e.data).at(-1);
const s = last('S'), d = last('D'), e = last('E');
const calls = Object.entries(s.solvers).map(([n, v]) => `${n}:${v.calls}`).join(' ');
const cost = r.events.filter((e) => e.kind === 'M').map((e) => e.data.cost).at(-1);
console.log(`sol ${s.solutions} cand ${s.candidates} cex ${s.counterexamples} clauses ${s.clauses} exp ${s.expansions} mean ${(s.literals / Math.max(1, s.clauses)).toFixed(1)} calls ${calls} cost ${JSON.stringify(cost)} tracked ${JSON.stringify(s.tracked || {})} counters ${JSON.stringify(s.counters)} | ${d && d.outcome} ex ${d && d.exhausted} ${e ? 'ERR ' + e.message : ''} t ${s.t.toFixed(2)}`);
