// Turn campaign rows (JSONL from tools/bench.mjs or the Campaign tab's "Export rows") into a
// report: an instance x variant matrix as Markdown and CSV, per-variant totals, and an SVG
// cactus plot.
//
//   node tools/report.mjs <rows.jsonl> [--metric time|candidates|refinements] [--suite NAME]
//                         [--limit SECONDS] [--out PREFIX]
//
// Without --out the Markdown report goes to stdout. With --out PREFIX it writes PREFIX.md,
// PREFIX.csv and PREFIX.svg. --limit sets the time used for the PAR2 score of unsolved cells
// (default: the largest time in the rows). Exit code 0, 2 on bad usage.
import fs from 'node:fs';
import { importRows } from '../js/store.js';
import { resultMatrix, matrixCSV, matrixMarkdown, variantTotals, cactusSvg, inconsistencies } from '../js/campaign.js';

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/report.mjs <rows.jsonl> [--metric time|candidates|refinements] [--suite NAME] [--limit SECONDS] [--out PREFIX]');
  process.exit(2);
}

export function report(rows, { metric = 'time', limit = 0, title = 'Campaign' } = {}) {
  const m = resultMatrix(rows, metric);
  const lim = limit || Math.max(0, ...rows.filter((r) => typeof r.time === 'number').map((r) => r.time));
  const tot = variantTotals(rows, lim);
  const bad = inconsistencies(rows);
  const lines = [`# ${title}`, '',
    `${m.rows.length} instances × ${m.variants.length} variants, ${rows.filter((r) => !r.skipped).length} cells. ` +
    `Metric: ${metric} (median over seeds); the best solved cell of a row is in bold (none on a tie); a cell that did not finish shows its outcome.`, '',
    '## Per variant', '',
    '| variant | solved | cells | total time (s) | PAR2 (s) |', '|---|---:|---:|---:|---:|',
    ...m.variants.map((v) => { const t = tot[v]; return `| ${v} | ${t.solved} | ${t.cells} | ${t.time.toFixed(3)} | ${t.par2.toFixed(3)} |`; }),
    '', `PAR2 counts an unsolved cell as twice the limit (${lim} s).`, '',
    '## Per instance', '', matrixMarkdown(m).trimEnd(), ''];
  lines.push('## Consistency', '');
  if (bad.length) {
    for (const b of bad) lines.push(`- ✗ ${b.instance} (seed ${b.seed}): ${b.kind === 'optimum' ? 'optima' : 'solution counts'} differ: ${b.rows.map((r) => `${r.variant} ${b.kind === 'optimum' ? r.cost.join(' ') : r.solutions}`).join(' vs ')}`);
  } else lines.push('Every instance: the finished variants agree on counts and optima.');
  return { markdown: lines.join('\n') + '\n', csv: matrixCSV(m), svg: cactusSvg(rows, { title: `${title}: solved cells against time` }), matrix: m, totals: tot, bad };
}

function main(argv) {
  const args = [...argv];
  let file = null, metric = 'time', suite = null, limit = 0, out = null;
  while (args.length) {
    const a = args.shift();
    if (a === '--metric') { metric = args.shift(); if (!['time', 'candidates', 'refinements'].includes(metric)) usage('--metric: time, candidates or refinements'); }
    else if (a === '--suite') suite = args.shift() || usage('--suite needs a name');
    else if (a === '--limit') { limit = Number(args.shift()); if (!(limit > 0)) usage('--limit needs a number > 0'); }
    else if (a === '--out') out = args.shift() || usage('--out needs a prefix');
    else if (a === '-h' || a === '--help') usage();
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else if (file) usage('only one rows file');
    else file = a;
  }
  if (!file) usage();
  let rows;
  try { rows = importRows(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`${file}: ${e.message}`); process.exit(2); }
  if (suite) rows = rows.filter((r) => r.suite === suite);
  const title = suite || [...new Set(rows.map((r) => r.suite).filter(Boolean))].join(', ') || 'Campaign';
  const r = report(rows, { metric, limit, title });
  if (!out) { process.stdout.write(r.markdown); return; }
  fs.writeFileSync(`${out}.md`, r.markdown);
  fs.writeFileSync(`${out}.csv`, r.csv);
  fs.writeFileSync(`${out}.svg`, r.svg);
  console.error(`wrote ${out}.md, ${out}.csv, ${out}.svg`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
