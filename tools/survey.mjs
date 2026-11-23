// Survey library examples: per instance, the loop's counts and the audit's verdict and time.
//   node tools/survey.mjs [id | file ...] [--no-audit] [--variants] [--seconds N] [--json]
// --variants also runs every variant on every instance and checks the expected counts.
import fs from 'node:fs';
import { runProject } from './run.mjs';
import { auditProject, loadTarget } from './audit.mjs';
import { auditable } from '../js/project.js';

const args = process.argv.slice(2);
const noAudit = args.includes('--no-audit');
const json = args.includes('--json');
const withVariants = args.includes('--variants');
import { expectedCheck, costTracker } from '../js/project.js';
const si = args.indexOf('--seconds');
const seconds = si >= 0 ? Number(args[si + 1]) : 60;
let ids = args.filter((a, i) => !a.startsWith('--') && !(si >= 0 && i === si + 1));
const lib = JSON.parse(fs.readFileSync(new URL('../examples/library.json', import.meta.url)));
if (!ids.length) ids = lib.examples.filter((e) => !['guide', 'tutorial'].includes(e.group)).map((e) => e.id);

for (const id of ids) {
  const p = loadTarget(id);
  const insts = (p.instances || []).length ? p.instances.map((x) => x.id) : [undefined];
  for (const inst of insts) {
    const t0 = Date.now();
    let r;
    try { r = await runProject({ ...p, settings: { ...p.settings, seconds } }, { backstop: true, instance: inst }); }
    catch (e) { console.log(`${id}/${inst}: ERROR ${e.message}`); continue; }
    const S = r.events.filter((e) => e.kind === 'S').at(-1)?.data || {};
    const D = r.events.filter((e) => e.kind === 'D').at(-1)?.data || {};
    const E = r.events.filter((e) => e.kind === 'E').at(-1)?.data;
    const tl = (Date.now() - t0) / 1000;
    const row = { id, inst, sol: S.solutions, cand: S.candidates, cex: S.counterexamples, cl: S.clauses, ex: S.expansions, out: D.outcome, exh: D.exhausted, t: tl, err: E?.message || r.problems?.[0]?.message };
    const own = (p.instances || []).find((y) => y.id === inst);
    if (!noAudit && own && own.audit === false) { row.audit = 'skipped (audit: false)'; row.ta = 0; }
    else if (!noAudit) {
      const t1 = Date.now();
      try {
        const a = await auditProject(p, { seconds, instance: inst });
        row.audit = a.verdict ? (a.verdict.sound ? 'sound' : a.verdict.verdict || 'unsound') : (a.error?.message || a.status || 'none').slice(0, 60);
      } catch (e) { row.audit = 'ERR ' + e.message.slice(0, 60); }
      row.ta = (Date.now() - t1) / 1000;
    }
    if (withVariants) {
      const x = (p.instances || []).find((y) => y.id === inst);
      row.variants = {};
      for (const v of [null, ...(p.variants || []).map((y) => y.name)]) {
        const t2 = Date.now();
        const rv = await runProject({ ...p, settings: { ...p.settings, seconds } }, { backstop: true, instance: inst, variant: v ?? undefined });
        const Sv = rv.events.filter((e) => e.kind === 'S').at(-1)?.data || {};
        const Dv = rv.events.filter((e) => e.kind === 'D').at(-1)?.data;
        const tr = costTracker();
        for (const e of rv.events) if (e.kind === 'M') tr.add(e.data.cost);
        const c = expectedCheck(x?.expected, Dv && { outcome: Dv.outcome, exhausted: Dv.exhausted === true, solutions: Sv.solutions, cost: tr.cost, same: tr.same });
        const err = rv.events.filter((e) => e.kind === 'E').at(-1)?.data?.message || rv.problems?.[0]?.message;
        row.variants[v ?? 'default'] = `${c.checked ? (c.ok ? 'ok' : 'MISMATCH') : 'unchecked'}:${Sv.solutions}/${Sv.candidates}c/${((Date.now() - t2) / 1000).toFixed(1)}s${err ? ' ERR ' + err.slice(0, 50) : ''}`;
      }
    }
    if (json) console.log(JSON.stringify(row));
    else console.log(`${id}/${inst ?? '-'}: sol=${row.sol} cand=${row.cand} cex=${row.cex} cl=${row.cl} ex=${row.ex} ${row.out}${row.exh ? '' : '(!exh)'} t=${row.t.toFixed(1)}${row.err ? ' ERR=' + row.err.slice(0, 60) : ''}${noAudit ? '' : ` audit=${row.audit} ta=${row.ta.toFixed(1)}`}${row.variants ? '\n    ' + Object.entries(row.variants).map(([k, v]) => `${k}=${v}`).join('  ') : ''}`);
  }
}
