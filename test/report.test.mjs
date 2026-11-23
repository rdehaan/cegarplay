// The instance x variant matrix, its CSV and Markdown, optima in campaigns, and tools/report.mjs
// (FUTURE-DIRECTIONS D2, D3, "Optima in campaigns").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resultMatrix, matrixCSV, matrixMarkdown, variantTotals, cactusSvg, inconsistencies, Reducer } from '../js/campaign.js';

const row = (instance, variant, o = {}) => ({ key: `${instance}|${variant}|${o.seed || 0}`, suite: 's', instance, variant, seed: 0,
  outcome: 'finished', exhausted: true, solutions: 2, candidates: 10, refinements: 4, time: 1, hash: 'aa', ...o });

const rows = [
  row('a', 'base', { time: 2, candidates: 40 }), row('a', 'fast', { time: 0.5, candidates: 12 }),
  row('b', 'base', { time: 3 }), row('b', 'fast', { outcome: 'timeout', exhausted: false, time: 30 }),
  row('c', 'base', { solutions: 3, hash: 'bb' }), row('c', 'fast', { solutions: 4, hash: 'cc' }),
];

test('matrix: one row per instance, one column per variant, best solved cell, disagreements', () => {
  const m = resultMatrix(rows, 'time');
  assert.deepEqual(m.variants, ['base', 'fast']);
  assert.deepEqual(m.rows.map((r) => [r.instance, r.best]), [['a', 'fast'], ['b', 'base'], ['c', null]]);
  assert.equal(m.rows[1].cells.fast.solved, false);
  assert.equal(m.rows[1].cells.fast.outcome, 'timeout');
  assert.equal(m.rows[2].cells.base.disagree, true);
  assert.equal(resultMatrix(rows, 'candidates').rows[0].cells.base.value, 40);
  assert.equal(matrixCSV(m), 'instance,base,fast,best\na,2,0.5,fast\nb,3,timeout,base\nc,1,1,\n');
  const md = matrixMarkdown(m);
  assert.match(md, /\| a \| 2\.000 \| \*\*0\.500\*\* \|/);
  assert.match(md, /\| b \| \*\*3\.000\*\* \| timeout \|/);
  assert.match(md, /\| c \| 1\.000 ✗ \| 1\.000 ✗ \|/);
  const t = variantTotals(rows, 30);
  assert.deepEqual(t.fast, { cells: 3, solved: 2, time: 1.5, par2: 61.5 });
  assert.match(cactusSvg(rows), /^<svg[^]*<polyline[^]*base[^]*fast[^]*<\/svg>\n$/);
});

test('optima in campaigns: rows carry the cost; differing optima are inconsistencies', () => {
  const r = new Reducer();
  r.add('M', { n: 1, atoms: 'x', cost: [5] });
  r.add('S', { t: 0.1, candidates: 3, solutions: 1, clauses: 2, literals: 7, solvers: { main: { calls: 4, time: 0.01, conflicts: 9, sat: 3 } } });
  r.add('D', { outcome: 'finished', exhausted: false });
  const res = r.result('ok');
  assert.deepEqual(res.cost, [5]);
  assert.equal(res.sameCost, true);
  assert.equal(res.meanClause, 3.5);
  assert.deepEqual(res.solvers, { main: { calls: 4, time: 0.01, conflicts: 9 } });
  const opt = [row('p', 'x', { exhausted: false, cost: [5], sameCost: true }), row('p', 'y', { exhausted: false, cost: [6], sameCost: true })];
  const bad = inconsistencies(opt);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].kind, 'optimum');
  assert.deepEqual(inconsistencies([opt[0], { ...opt[1], cost: [5] }]), []);
});

test('tools/report.mjs writes Markdown, CSV and SVG', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-'));
  const f = path.join(dir, 'rows.jsonl');
  fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const tool = new URL('../tools/report.mjs', import.meta.url).pathname;
  const out = spawnSync('node', [tool, f], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^# s\n/);
  assert.match(out.stdout, /\| fast \| 2 \| 3 \| 1\.500 \| 61\.500 \|/);
  assert.match(out.stdout, /✗ c \(seed 0\): solution counts differ/);
  const w = spawnSync('node', [tool, f, '--metric', 'candidates', '--out', path.join(dir, 'r')], { encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'r.csv'), 'utf8'), /^instance,base,fast,best\na,40,12,fast\n/);
  assert.match(fs.readFileSync(path.join(dir, 'r.svg'), 'utf8'), /<svg/);
  assert.equal(spawnSync('node', [tool, f, '--metric', 'nope']).status, 2);
});
