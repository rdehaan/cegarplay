// PLAN2 page features: the audit (S1), and later instances, recordings, views.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const settled = (page) => page.waitForFunction(() => ['finished', 'error', 'aborted'].includes(document.getElementById('run-status').dataset.state));

test('S1: the Audit button shows the verdict, the witness and an audit column in the history', async () => {
  const { page, context } = await B.openPage(browser, server, '?example=tutorial-weak-relevant');
  await page.click('#audit-button');
  await settled(page);
  assert.equal(await page.$eval('#audit-panel', (e) => e.dataset.verdict), 'unsound');
  const text = await page.textContent('#audit-panel');
  assert.match(text, /499 refinements remove a solution/);
  assert.match(text, /They differ on\{pick\(2\)\}/);
  assert.match(await page.textContent('#result-line'), /Audit: unsound/);
  // a run of the same project shows the audit's verdict in its row
  await page.click('#run-button');
  await settled(page);
  assert.equal(await page.$eval('#audit-panel', (e) => e.hidden), true);
  const cells = await page.$$eval('#history-table tr', (rows) => rows.slice(1).map((r) => r.lastElementChild.textContent));
  assert.deepEqual(cells, ['unsound (499)', 'unsound (499)']);
  await context.close();
});

test('S1: a sound audit, and a script with nothing to audit', async () => {
  const { page, context } = await B.openPage(browser, server, '?example=tutorial-first-run');
  await page.click('#audit-button');
  await settled(page);
  assert.equal(await page.$eval('#audit-panel', (e) => e.dataset.verdict), 'sound');
  await page.goto(server.url + 'index.html?nocoi=1&example=gc-reference');
  await page.waitForSelector('body[data-ready="true"]');
  await page.click('#audit-button');
  await settled(page);
  assert.match(await page.textContent('#messages'), /nothing to audit/);
  await context.close();
});

const solutionsOf = (page) => page.evaluate(() => window.cegarplay.stats.S.solutions);

test('I1: the run bar picks an instance; Run uses it; ?instance= selects one', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=qbf');
  assert.equal(await page.isVisible('#instance-select'), true);
  assert.equal(await page.$eval('#instance-select', (s) => s.value), 'example');
  await page.click('#run-button');
  await settled(page);
  assert.equal(await solutionsOf(page), 5);
  await page.selectOption('#instance-select', 'random-1');
  await page.click('#run-button');
  await settled(page);
  assert.equal(await solutionsOf(page), 16);
  assert.match(await page.$eval('#history-table', (t) => t.textContent), /\[random-1\]/);
  await page.goto(server.url + 'index.html?nocoi=1&example=qbf&instance=random-3&tab=9');
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.$eval('#instance-select', (s) => s.value), 'random-3');
  assert.equal(await page.$eval('#tab9', (e) => e.checked), true);
  // a project without instances has no picker
  await page.goto(server.url + 'index.html?nocoi=1&example=tutorial-first-run');
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.isVisible('#instance-select'), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('I1: Run all marks a wrong expected count in red', async () => {
  const { page, context } = await B.openPage(browser, server, '?example=af-preferred&tab=9');
  // break one expectation
  await page.click('#instances-table a:text("random-1")');
  await page.fill('#instance-expected', '7');
  await page.press('#instance-expected', 'Enter');
  await page.dispatchEvent('#instance-expected', 'change');
  await page.click('#run-all-instances-button');
  await page.waitForFunction(() => /Ran 4 instances/.test(document.getElementById('instances-status').textContent));
  const marked = await page.$$eval('#instances-table tr[data-mismatch]', (r) => r.map((x) => x.dataset.instance));
  assert.deepEqual(marked, ['random-1']);
  assert.match(await page.textContent('#instances-status'), /1 with a count other than expected/);
  await context.close();
});

test('I1: a new instance is edited in the tab and used by the next run', async () => {
  const { page, context } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=9');
  await page.click('#add-instance-button');
  await page.fill('#instance-constants', 'n=4');
  await page.dispatchEvent('#instance-constants', 'change');
  const p = await page.evaluate(() => window.cegarplay.collect());
  assert.deepEqual(p.instances.map((x) => [x.id, x.constants]), [['instance', { n: '4' }]]);
  await page.click('#run-button');
  await settled(page);
  // the sum-free subsets of 1..4 (n = 8 gives 61)
  assert.equal(await solutionsOf(page), 9);
  assert.match(await page.$eval('#history-table', (t) => t.textContent), /\[instance\]/);
  await context.close();
});

test('V1: ?replay= replays a library recording without running the engine', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?replay=examples/replays/gc-shape1.cprec');
  await page.waitForFunction(() => document.getElementById('run-status').dataset.state === 'replayed');
  assert.equal(await page.evaluate(() => window.cegarplay.exampleId), 'gc-shape1');
  assert.equal(await solutionsOf(page), 101);
  assert.match(await page.textContent('#result-line'), /^Replayed: Finished: 101 solutions/);
  assert.equal(await page.$$eval('#solutions li', (l) => l.length), 101);
  // a path outside examples/replays/ is refused
  await page.goto(server.url + 'index.html?nocoi=1&replay=../secret.cprec');
  await page.waitForSelector('body[data-ready="true"]');
  assert.match(await page.textContent('#load-status'), /not a file of examples\/replays/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('V1: the recording setting, a recorded run, Download and Open recording', async () => {
  const { page, context } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=4');
  assert.equal(await page.isDisabled('#download-recording-button'), true);
  await page.selectOption('#record-select', 'all');
  await page.check('#record-calls');
  assert.deepEqual(await page.evaluate(() => window.cegarplay.collect().settings.record), { steps: 'all', n: 1000, calls: true });
  await page.click('#run-button');
  await settled(page);
  assert.equal(await page.evaluate(() => window.cegarplay.recording.steps.length), 107);
  await page.click('label[for="tab1"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download-recording-button')]);
  const file = await dl.path();
  await page.setInputFiles('#recording-input', file);
  await page.waitForFunction(() => document.getElementById('run-status').dataset.state === 'replayed');
  assert.match(await page.textContent('#recording-status'), /107 steps/);
  assert.equal(await solutionsOf(page), 61);
  // off again: the setting disappears
  await page.click('label[for="tab4"]');
  await page.selectOption('#record-select', 'off');
  await page.uncheck('#record-calls');
  assert.equal(await page.evaluate(() => 'record' in window.cegarplay.collect().settings), false);
  await context.close();
});

test('S2: with certificates on, the Statistics tab counts refinements per level', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=4');
  assert.equal(await page.isVisible('#certificates-block'), false);
  await page.selectOption('#certify-select', 'report');
  await page.click('#run-button');
  await settled(page);
  await page.click('label[for="tab6"]');
  assert.equal(await page.isVisible('#certificates-block'), true);
  const cells = await page.$$eval('#certificates-table tbody td', (t) => t.map((x) => x.textContent));
  assert.deepEqual(cells.slice(0, 6), ['0', '0', '46', '0', '0', '0']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('I2: Preview 6 shows six instances; Add as instance stores a recipe that a run generates', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=qbf&tab=9');
  assert.equal(await page.$eval('#generator-select', (s) => s.value), 'qbf-dnf');
  await page.click('#preview-button');
  await page.waitForSelector('#generator-preview .generator-card:nth-child(6)');
  assert.equal(await page.$$eval('#generator-preview .generator-card', (c) => c.length), 6);
  assert.match(await page.textContent('#generator-status'), /6 instances, 6 accepted of \d+ draws/);
  assert.match(await page.textContent('#generator-preview .generator-card'), /Seed 1, attempt 0, exact/);
  await page.click('#generator-preview .generator-card button');
  assert.equal(await page.$eval('#instances-table', (t) => !!t.querySelector('tr[data-instance="qbf-dnf-s1"]')), true);
  // a run of the recipe generates the facts first (dnf-1 has the same recipe: 8 solutions)
  await page.selectOption('#instance-select', 'qbf-dnf-s1');
  await page.click('#run-button');
  await settled(page);
  assert.equal(await page.evaluate(() => window.cegarplay.stats.S.solutions), 8);
  assert.deepEqual(errors, []);
  await context.close();
});

const SHAPES = ['lang-basics', 'lang-clauses', 'lang-core', 'lang-legacy', 'lang-optimal', 'lang-raw-lua', 'lang-second-solver',
  'lang-several-cex', 'lang-two-stage', 'gc-shape1', 'gc-shape2', 'gc-shape3', 'gc-shape4', 'gc-reference'];

test('V2: one box per declared solver and one arrow per link, for the lang-* examples and the shapes', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=11');
  for (const id of SHAPES) {
    await page.evaluate(async (x) => { await window.cegarplay.loadExample(x); }, id);
    const want = await page.evaluate(() => {
      const p = window.cegarplay.project;
      if (p.loop.language === 'lua') return null;
      const m = p.loop.text.split('\n');
      return { solvers: m.filter((l) => /^\s*solver\s/.test(l)).length, links: m.filter((l) => /^\s*link\s/.test(l)).length };
    });
    await page.click('#run-button');
    await settled(page);
    await page.waitForTimeout(50);
    const got = await page.evaluate(() => ({ solvers: document.querySelectorAll('#anatomy-diagram .anatomy-solver').length,
      links: document.querySelectorAll('#anatomy-diagram .anatomy-link').length, H: window.cegarplay.recording.H }));
    const expect = want || { solvers: got.H.solvers.length, links: got.H.links.length };
    assert.deepEqual({ solvers: got.solvers, links: got.links }, expect, id);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('V2: the line table sums to the final S calls; 100,000 synthetic calls redraw under 50 ms', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=gc-shape2&tab=11');
  await page.check('#anatomy-calls');
  await page.click('#run-button');
  await settled(page);
  const sums = await page.evaluate(() => {
    const a = window.cegarplay.anatomy;
    const S = window.cegarplay.stats.S;
    return { table: a.rows().reduce((x, r) => x + r.calls, 0), S: Object.values(S.solvers).reduce((x, s) => x + s.calls, 0),
      rows: document.querySelectorAll('#anatomy-lines tr[data-line]').length };
  });
  assert.equal(sums.table, sums.S);
  assert.ok(sums.rows >= 2);
  // a click on a row filters the timeline
  await page.click('#anatomy-lines tr[data-line] a');
  assert.match(await page.textContent('#anatomy-note'), /Showing the calls of loop line/);
  const ms = await page.evaluate(() => {
    const a = window.cegarplay.anatomy;
    a.filterLine = null;
    a.calls = [];
    for (let i = 0; i < 100000; i++) a.calls.push({ id: i + 1, s: (i % 2) + 1, t0: i * 1e-4, dt: 5e-5, r: i % 3 ? 'sat' : 'unsat', p: 0, n: 0 });
    a.drawTimeline(); a.drawTimeline();
    const t = [];
    for (let k = 0; k < 3; k++) { a.drawTimeline(); t.push(a.lastDrawMs); }
    return Math.min(...t);
  });
  console.log(`# timeline redraw of 100,000 calls: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 50, `${ms} ms`);
  assert.deepEqual(errors, []);
  await context.close();
});
