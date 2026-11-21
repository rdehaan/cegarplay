// Phase 5: statistics, charts, trace, run history.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const points = (page) => page.$eval('#svg-progress polyline.series-candidates', (e) => Number(e.dataset.points));
const historyRows = (page) => page.$$eval('#history-table tbody tr', (rows) => rows.filter((r) => !r.textContent.includes('no finished runs')).length);

test('charts exist and update during a run', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=6');
  for (const id of ['svg-progress', 'svg-time', 'svg-hist']) assert.ok(await page.$('#' + id), id);
  await page.evaluate(() => { window.cegarplay.project.settings.constants.n = '7'; });
  await page.click('#run-button');
  await B.waitState(page, ['running']);
  await page.waitForTimeout(900);
  const p1 = await points(page);
  await page.waitForTimeout(900);
  const p2 = await points(page);
  assert.ok(p1 >= 2 && p2 > p1, `${p1} -> ${p2}`);
  const bars = await page.$$eval('#svg-time rect.bar', (l) => l.length);
  assert.ok(bars >= 4);
  assert.match(await page.textContent('#solver-table'), /shared \+ abstraction/);
  await page.click('#abort-button');
  await B.waitState(page, ['aborted']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('statistics after the default example: summary, solvers, refinements, histogram', async () => {
  const { page, context } = await B.openPage(browser, server, '?tab=6');
  await page.click('#run-button');
  await B.waitState(page, ['finished']);
  const summary = await page.textContent('#stats-summary');
  assert.match(summary, /finished \(exhausted\)/);
  assert.match(summary, /31,776/);
  assert.match(summary, /10,698/);
  const solvers = await page.$$eval('#solver-table tbody tr', (rows) => rows.map((r) => [...r.cells].map((c) => c.textContent)));
  assert.equal(solvers.length, 2);
  assert.equal(solvers[1][0], 'C');
  assert.equal(solvers[1][3], '31,776');
  assert.notEqual(solvers[0][9], '–', 'choices of A are known after the run');
  const hist = await page.$$eval('#svg-hist rect.bar', (l) => l.map((r) => Number(r.getAttribute('height'))));
  assert.equal(hist.length, 8);
  assert.ok(hist.some((x) => x > 0));
  assert.equal(await historyRows(page), 1);
  await context.close();
});

test('trace: step 1 of the default example shows candidate, counterexample and refinement', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=5');
  await page.click('#run-button');
  await B.waitState(page, ['finished']);
  assert.equal(await page.textContent('#trace-label'), 'step 1 of 200');
  const cand = await page.$$eval('#trace-candidate .atom', (l) => l.map((d) => d.textContent));
  const cex = await page.$$eval('#trace-counterexample .atom', (l) => l.map((d) => d.textContent));
  const ref = await page.$$eval('#trace-refinement .atom', (l) => l.map((d) => d.textContent));
  assert.ok(cand.some((a) => a.startsWith('edge(')), cand.join(' '));
  assert.ok(cex.some((a) => a.startsWith('color(')), cex.join(' '));
  assert.ok(ref.length > 0 && ref.every((a) => /^-?[a-z_]+\(/.test(a)), ref.join(' '));
  assert.ok(await page.$$eval('#trace-candidate .atom.hl', (l) => l.length) > 0, 'refinement atoms highlighted');
  assert.match(await page.textContent('#trace-cap'), /first 200 steps/);
  await page.click('#trace-next');
  assert.equal(await page.textContent('#trace-label'), 'step 2 of 200');
  await page.$eval('#trace-slider', (e) => { e.value = '150'; e.dispatchEvent(new Event('input')); });
  assert.equal(await page.textContent('#trace-label'), 'step 150 of 200');
  assert.deepEqual(errors, []);
  await context.close();
});

test('run history: original rules with shape 1 vs the reference run are marked as a mismatch', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?file=graph-coloring-original&tab=6');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  assert.match(await page.textContent('#live-line'), /9,270 solutions/);
  await page.click('label[for="tab4"]');
  await page.selectOption('#template-select', 'reference');
  await page.click('#insert-template-button');
  assert.match(await B.getEditor(page, 'loop-editor'), /reject M with G\.block\(M\)/);
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error'], 120000), 'finished');
  assert.match(await page.textContent('#live-line'), /10,698 solutions/);
  await page.click('label[for="tab6"]');
  const rows = await page.$$eval('#history-table tbody tr', (l) => l.map((r) => ({ m: r.dataset.mismatch === 'true', text: r.textContent })));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.m), JSON.stringify(rows));
  assert.match(rows[0].text, /Shape 1/);
  assert.match(rows[1].text, /Reference run/);
  assert.equal(await page.isVisible('#history-note'), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('rerun with 5 seeds adds five history rows; copy; download with history', async () => {
  const { page, context } = await B.openPage(browser, server, '?tab=6');
  await page.selectOption('#solutions-select', '1');
  await page.click('#rerun-seeds-button');
  await page.waitForFunction(() => document.querySelectorAll('#history-table tbody tr').length === 5 &&
    document.getElementById('run-status').dataset.state === 'finished', null, { timeout: 60000 });
  await page.waitForTimeout(300);
  assert.equal(await historyRows(page), 5);
  const seeds = await page.$$eval('#history-table tbody tr', (l) => l.map((r) => r.cells[8].textContent));
  assert.deepEqual(seeds, ['1', '2', '3', '4', '5']);
  await page.click('#copy-tsv-button');
  const tsv = await page.evaluate(() => window.cegarplay.stats.lastCopied);
  assert.match(tsv, /^outcome\t/);
  await page.click('label[for="tab1"]');
  await page.check('#include-history');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download-button')]);
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
  assert.equal(JSON.parse(text).runs.length, 5);
  await context.close();
});

test('Loop tab: constants, limits, edit as Lua runs the same', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=4');
  await page.fill('#candidates-input', '50');
  await page.dispatchEvent('#candidates-input', 'change');
  await page.click('#run-button');
  await B.waitState(page, ['finished']);
  const a = await page.textContent('#live-line');
  assert.match(a, /50 candidates/);
  page.once('dialog', (d) => d.accept());
  await page.click('#edit-as-lua-button');
  assert.match(await B.getEditor(page, 'loop-editor'), /A:search\{ on_candidate = function\(M\)/);
  assert.equal(await page.textContent('#loop-language'), '(raw Lua)');
  await page.click('#run-button');
  await B.waitState(page, ['finished']);
  assert.equal((await page.textContent('#live-line')).replace(/^[\d.]+ s/, ''), a.replace(/^[\d.]+ s/, ''));
  assert.deepEqual(errors, []);
  await context.close();
});

test('the tutorial is shown with code blocks; internals show the generated Lua', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=2&internals=true');
  await page.waitForFunction(() => document.querySelectorAll('#tutorial .ace_editor').length > 3);
  assert.ok((await page.textContent('#tutorial')).length > 3000);
  await page.click('#run-button');
  await B.waitState(page, ['finished']);
  await page.click('label[for="tab7"]');
  assert.match(await B.getEditor(page, 'generated-lua'), /rt\.prepare\(\)/);
  assert.match(await page.textContent('#raw-events'), /^@@H /);
  assert.deepEqual(errors, []);
  await context.close();
});
