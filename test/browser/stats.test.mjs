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
  const { page, context, errors } = await B.openPage(browser, server, '?example=graph-coloring&tab=6');
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
  const { page, context } = await B.openPage(browser, server, '?example=graph-coloring&tab=6');
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
  const { page, context, errors } = await B.openPage(browser, server, '?example=graph-coloring&tab=5');
  await page.click('#run-button');
  await B.waitState(page, ['finished']);
  assert.equal(await page.textContent('#trace-label'), 'traced step 1 of 200');
  const cand = await page.$$eval('#trace-candidate .atom', (l) => l.map((d) => d.textContent));
  const cex = await page.$$eval('#trace-counterexample .atom', (l) => l.map((d) => d.textContent));
  const ref = await page.$$eval('#trace-refinement .atom', (l) => l.map((d) => d.textContent));
  assert.ok(cand.some((a) => a.startsWith('edge(')), cand.join(' '));
  assert.ok(cex.some((a) => a.startsWith('color(')), cex.join(' '));
  assert.ok(ref.length > 0 && ref.every((a) => /^-?[a-z_]+\(/.test(a)), ref.join(' '));
  assert.ok(await page.$$eval('#trace-candidate .atom.hl', (l) => l.length) > 0, 'refinement atoms highlighted');
  assert.match(await page.textContent('#trace-cap'), /first 200 steps/);
  await page.click('#trace-next');
  assert.equal(await page.textContent('#trace-label'), 'traced step 2 of 200');
  await page.$eval('#trace-slider', (e) => { e.value = '150'; e.dispatchEvent(new Event('input')); });
  assert.equal(await page.textContent('#trace-label'), 'traced step 150 of 200');
  assert.deepEqual(errors, []);
  await context.close();
});

test('run history: a too weak relevant/1 vs the reference run are marked as a mismatch', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant&tab=6');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  assert.match(await page.textContent('#live-line'), /11 solutions/);
  await page.click('label[for="tab4"]');
  await page.selectOption('#template-select', 'reference');
  await page.click('#insert-template-button');
  assert.match(await B.getEditor(page, 'loop-editor'), /reject M with G\.block\(M\)/);
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error'], 120000), 'finished');
  assert.match(await page.textContent('#live-line'), /61 solutions/);
  await B.openTab(page, 6);
  const rows = await page.$$eval('#history-table tbody tr', (l) => l.map((r) => ({ m: r.dataset.mismatch === 'true', text: r.textContent })));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.m), JSON.stringify(rows));
  assert.doesNotMatch(rows[0].text, /Reference run/);
  assert.match(rows[1].text, /Reference run/);
  assert.equal(await page.isVisible('#history-note'), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('rerun with 5 seeds adds five history rows; copy; download with history', async () => {
  const { page, context } = await B.openPage(browser, server, '?tab=6');
  await B.runOptions(page, () => page.selectOption('#solutions-select', '1'));
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
  const [dl] = await Promise.all([page.waitForEvent('download'), B.projectMenu(page, 'download-button', { history: true })]);
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
  await B.openTab(page, 7);
  assert.match(await B.getEditor(page, 'generated-lua'), /rt\.prepare\(\)/);
  assert.match(await page.textContent('#raw-events'), /^@@H /);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Clear run history asks first; dismissing keeps the rows, accepting removes them', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1&tab=6');
  assert.equal(await page.$eval('#clear-history-button', (b) => b.disabled), true, 'nothing to clear yet');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  const rows = () => page.$$eval('#history-table tbody tr', (l) => l.filter((r) => !/no finished runs/.test(r.textContent)).length);
  assert.equal(await rows(), 1);
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await page.click('#clear-history-button');
  assert.match(asked, /Remove all 1 row of the run history\?/);
  assert.equal(await rows(), 1, 'dismissed: kept');
  page.once('dialog', (d) => d.accept());
  await page.click('#clear-history-button');
  assert.equal(await rows(), 0, 'accepted: removed');
  assert.equal(await page.$eval('#clear-history-button', (b) => b.disabled), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Clear removes the last run\'s results and keeps the run history', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=graph-coloring&tab=6');
  const disabled = () => page.$eval('#clear-button', (b) => b.disabled);
  assert.equal(await disabled(), true, 'nothing to clear yet');
  await page.evaluate(() => { window.cegarplay.project.settings.constants.n = '7'; });
  await page.click('#run-button');
  await B.waitState(page, ['running']);
  assert.equal(await disabled(), true, 'disabled while running');
  await page.click('#abort-button');
  await B.waitState(page, ['aborted']);
  await page.evaluate(() => { window.cegarplay.project.settings.constants.n = '3'; });
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  assert.equal(await disabled(), false);
  assert.notEqual((await page.textContent('#result-line')).trim(), '');
  assert.equal(await page.$eval('#download-recording-button', (b) => b.disabled), false);
  const before = await historyRows(page);
  assert.ok(before >= 1);
  await B.openTab(page, 5);  // Clear is in the Output tab
  await page.click('#clear-button');
  assert.equal(await page.textContent('#run-status'), 'ready');
  assert.match((await page.textContent('#result-line')).trim(), /^(No run yet\..*)?$/, 'as on a fresh load');
  assert.equal(await page.textContent('#solutions'), '');
  assert.equal((await page.textContent('#live-line')).trim(), '');
  assert.equal(await page.$eval('#download-recording-button', (b) => b.disabled), true);
  assert.equal(await page.evaluate(() => window.cegarplay.recording), null);
  assert.equal(await historyRows(page), before, 'run history kept');
  assert.equal(await disabled(), true, 'nothing left to clear');
  assert.deepEqual(errors, []);
  await context.close();
});

test('track: a chart of the tracked values, and their last values with the counters', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=knapsack-bounds&tab=6');
  assert.equal(await page.$eval('#tracked-figure', (e) => e.hidden), true, 'hidden before a run');
  await page.click('#run-button');
  await B.waitState(page, ['finished']);
  assert.equal(await page.$eval('#tracked-figure', (e) => e.hidden), false);
  const lines = await page.$$eval('#svg-tracked polyline.series-tracked', (l) => l.map((e) => [e.dataset.name, Number(e.dataset.points)]));
  assert.deepEqual(lines, [['lower', 7], ['upper', 7]]);
  const counters = await page.textContent('#counters-table');
  assert.match(counters, /lower \(tracked, last value\)\s*25/);
  assert.match(counters, /upper \(tracked, last value\)\s*25/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('what the tabs show: the marked history row, the Summary and notes after an audit, charts that say why they are empty', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=6');
  const done = () => page.waitForFunction(() => ['finished', 'error'].includes(document.getElementById('run-status').dataset.state) && !window.cegarplay.control.batch, null, { timeout: 60000 });
  await page.click('#run-button');
  await done();
  // the run's row is marked, with the note that says what the mark means
  assert.equal(await page.$$eval('#history-table tr[data-shown="true"]', (l) => l.length), 1);
  assert.match(await page.$eval('#history-table tr[data-shown="true"] td', (td) => td.textContent), /^▶ /);
  assert.equal(await page.isVisible('#history-shown-note'), true);
  assert.equal(await page.$$eval('#history-table th', (l) => l[1].textContent), 'Loop [instance]');
  // the live line and the Summary give the time in one format
  const live = await page.textContent('#live-line');
  const elapsed = await page.$eval('#stats-summary tbody td:nth-child(2)', (td) => td.textContent);
  assert.ok(live.startsWith(elapsed + ' · '), `${live} / ${elapsed}`);
  // an audit: its own figures in the Summary, notes where the loop's solutions and trace would be
  await page.click('#audit-button');
  await done();
  assert.deepEqual(await page.$$eval('#stats-summary th', (l) => l.map((x) => x.textContent)),
    ['Audit verdict', 'Elapsed', 'Candidates', 'Counterexamples', 'Refinements checked', 'Solutions']);
  assert.match(await page.$eval('#stats-summary tbody td', (td) => td.textContent), /^sound$/);
  assert.match(await page.textContent('#svg-progress'), /an audit: no loop to draw/);
  assert.match(await page.textContent('#svg-hist'), /an audit adds no clauses/);
  assert.equal(await page.$$eval('#history-table tr[data-shown="true"]', (l) => l.length), 1);
  assert.match(await page.$eval('#history-table tr[data-shown="true"]', (tr) => tr.textContent), /sound/);
  await B.openTab(page, 5);
  assert.match(await page.textContent('#solutions-note'), /An audit does not run the loop: no solutions are listed here/);
  assert.match(await page.textContent('#trace-empty'), /An audit does not run the loop, so it has no trace/);
  assert.match(await page.textContent('#result-line'), /refinements checked\)/);
  assert.match(await page.textContent('#audit-panel'), /refined with G\.(clause|clauses|block)/);
  // Clear: nothing is shown, no row is marked
  await B.openTab(page, 5);  // Clear is in the Output tab
  await page.click('#clear-button');
  assert.equal(await page.$$eval('#history-table tr[data-shown="true"]', (l) => l.length), 0);
  await page.waitForFunction(() => /^Shown: no results yet/.test(document.getElementById('shown-line').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

test('a run history row can be removed on its own; the shown mark and the compare picks follow', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1&tab=6');
  for (let k = 0; k < 3; k++) {
    await page.click('#run-button');
    assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  }
  const rows = () => page.$$eval('#history-table tbody tr', (l) => l.filter((r) => !/no finished runs/.test(r.textContent)).length);
  assert.equal(await rows(), 3);
  // pick runs 1 and 3 to compare; the last run (3) is the shown one
  const picks = page.locator('#history-table .history-compare-pick');
  await picks.nth(0).check();
  await picks.nth(2).check();
  await page.locator('#history-table .history-delete').nth(1).click();
  assert.equal(await rows(), 2);
  assert.equal(await page.evaluate(() => window.cegarplay.stats.history.length), 2);
  assert.deepEqual(await page.evaluate(() => window.cegarplay.stats.compareSel), [0, 1]);
  assert.equal(await page.evaluate(() => window.cegarplay.stats.shownIndex), 1);
  assert.equal(await page.$$eval('#history-table tr[data-shown]', (l) => l.length), 1);
  // removing the shown run: no row is marked
  await page.locator('#history-table .history-delete').nth(1).click();
  assert.equal(await rows(), 1);
  assert.equal(await page.$$eval('#history-table tr[data-shown]', (l) => l.length), 0);
  assert.deepEqual(errors, []);
  await context.close();
});
