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
  const cells = await page.$$eval('#history-table tr', (rows) => {
    const k = [...rows[0].children].findIndex((th) => th.textContent === 'Audit');
    return rows.slice(1).map((r) => r.children[k].textContent);
  });
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
  assert.match(await page.textContent('#instances-status'), /1 with a count or optimum other than expected/);
  await context.close();
});

test('I1: Run all checks expected optima; a wrong optimum is marked', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=maxsat-ihs&tab=9');
  assert.match(await page.textContent('#instances-table tr[data-instance="example"]'), /optimum 8/);
  await page.click('#instances-table a:text("small-opt")');
  assert.equal(await page.inputValue('#instance-optimum'), '3');
  await page.fill('#instance-optimum', '4');
  await page.dispatchEvent('#instance-optimum', 'change');
  await page.click('#run-all-instances-button');
  await page.waitForFunction(() => /Ran 4 instances/.test(document.getElementById('instances-status').textContent));
  const marked = await page.$$eval('#instances-table tr[data-mismatch]', (r) => r.map((x) => x.dataset.instance));
  assert.deepEqual(marked, ['small-opt']);
  assert.match(await page.textContent('#instances-table tr[data-instance="example"]'), /1, cost 8.*✓/);
  assert.deepEqual(errors, []);
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

const campaignDone = (page) => page.waitForFunction(() => !window.cegarplay.campaign.running && /cells:|Aborted|Not started/.test(document.getElementById('campaign-status').textContent), null, { timeout: 120000 });

test('I3: a 1,000-cell suite finishes; after a reload, Start runs zero cells', { timeout: 240000 }, async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=10');
  await page.evaluate(() => {
    const app = window.cegarplay;
    app.project.suites = [{ name: 'thousand', instances: { constants: { x: Array.from({ length: 1000 }, (_, i) => i) } }, limits: { seconds: 30 } }];
    app.campaign.load();
    app.dirty();
  });
  await page.evaluate(() => window.cegarplay.campaign.clearRows());
  const t0 = Date.now();
  await page.click('#campaign-start');
  await campaignDone(page);
  console.log(`# 1,000 cells in ${((Date.now() - t0) / 1000).toFixed(1)} s on ${await page.$eval('#campaign-jobs', (e) => e.value)} engines`);
  assert.match(await page.textContent('#campaign-status'), /1,000 cells: 1,000 run, 0 from earlier/);
  assert.equal(await page.$eval('#campaign-grid', (c) => c.dataset.done), '1000');
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.$eval('#suite-select', (s) => s.value), 'thousand');
  await page.click('#campaign-start');
  await campaignDone(page);
  assert.match(await page.textContent('#campaign-status'), /1,000 cells: 0 run, 1,000 from earlier/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('I3: tutorial-weak-relevant with a reference variant marks n = 8 red; imported rows draw the plots', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant&tab=10');
  await page.evaluate(() => window.cegarplay.campaign.clearRows());
  await page.click('#campaign-start');
  await campaignDone(page);
  const text = await page.textContent('#campaign-consistency');
  assert.match(text, /n8 \((default 11 vs reference 61|reference 61 vs default 11)\)/);
  assert.match(await page.textContent('#label-campaign'), /Campaign \(5 ✗\)/);
  for (const id of ['plot-scaling', 'plot-scatter', 'plot-solved']) assert.equal(await page.$$eval(`#${id} svg`, (x) => x.length), 1, id);
  // the instance x variant matrix (D2): a row per instance, the n8 cells marked, sortable, metric switch
  assert.equal(await page.$$eval('#campaign-matrix tr[data-instance]', (r) => r.length), 5);
  assert.equal(await page.$$eval('#campaign-matrix tr[data-instance="n8"] td.disagree', (r) => r.length), 2);
  await page.click('#campaign-matrix th[data-sort="instance"]');
  assert.match(await page.textContent('#campaign-matrix th[data-sort="instance"]'), /▲/);
  await page.selectOption('#campaign-metric', 'candidates');
  assert.equal(await page.$eval('#campaign-matrix', (t) => t.dataset.metric), 'candidates');
  await page.selectOption('#scatter-x', 'reference');
  assert.equal(await page.$eval('#scatter-y', (e) => e.value), 'default');
  // rows written by tools/bench.mjs, imported: the same plots
  const { spawnSync } = await import('node:child_process');
  const rows = spawnSync('node', [new URL('../../tools/bench.mjs', import.meta.url).pathname, 'tutorial-weak-relevant', '--suite', 'scaling', '--jobs', '2', '--quiet'], { encoding: 'utf8' }).stdout;
  await page.evaluate(() => window.cegarplay.campaign.clearRows());
  await page.evaluate((t) => window.cegarplay.campaign.importText(t, 'bench.jsonl'), rows);
  assert.match(await page.textContent('#campaign-status'), /Imported 10 rows/);
  assert.match(await page.textContent('#campaign-consistency'), /n8/);
  for (const id of ['plot-scaling', 'plot-scatter', 'plot-solved']) assert.equal(await page.$$eval(`#${id} svg`, (x) => x.length), 1, id);
  assert.deepEqual(errors, []);
  await context.close();
});

test('I3: Abort during a suite leaves no running worker', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=graph-coloring&tab=10');
  await page.evaluate(() => {
    const app = window.cegarplay;
    app.project.suites = [{ name: 'slow', instances: { constants: { n: [6], x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] } }, limits: { seconds: 60 } }];
    app.campaign.load();
    return app.campaign.clearRows();
  });
  await page.click('#campaign-start');
  await page.waitForFunction(() => window.cegarplay.campaign.pool && window.cegarplay.campaign.pool.running > 0);
  await page.click('#campaign-abort');
  await campaignDone(page);
  assert.match(await page.textContent('#campaign-status'), /Aborted/);
  assert.equal(await page.evaluate(() => window.cegarplay.campaign.pool.running), 0);
  assert.equal(await page.evaluate(() => window.cegarplay.campaign.running), null);
  assert.deepEqual(errors, []);
  await context.close();
});

test('V3: the domain view draws a step; another step keeps every position; a cached step makes no call; drag writes positions', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=guide-03-hit-clique&tab=11');
  await page.click('#run-button');
  await settled(page);
  await page.waitForSelector('#view-svg .view-node');
  const state = () => page.evaluate(() => ({
    pos: [...document.querySelectorAll('#view-svg .view-node')].map((g) => [g.dataset.key, g.getAttribute('transform')]),
    emph: [...document.querySelectorAll('#view-svg .view-emph')].map((e) => e.parentNode.dataset.key || e.dataset.key).sort(),
    calls: window.cegarplay.views.source.calls,
  }));
  assert.equal((await state()).pos.length, 10);
  await page.$eval('#view-step', (s) => { s.value = '3'; s.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.querySelectorAll('#view-svg .view-emph').length === 3);
  const a = await state();
  assert.deepEqual(a.emph, ['node(4)', 'node(5)', 'node(6)']);
  assert.match(await page.textContent('#view-notes'), /A triangle survives/);
  await page.$eval('#view-step', (s) => { s.value = '1'; s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(150);
  const b = await state();
  assert.deepEqual(b.pos, a.pos);
  await page.$eval('#view-step', (s) => { s.value = '3'; s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(100);
  assert.equal((await state()).calls, b.calls, 'step 3 again: cached');
  // drag node 1
  const box = await page.$eval('#view-svg [data-key="node(1)"] circle', (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 30, box.y + 20, { steps: 4 }); await page.mouse.up();
  const posd = await page.evaluate(() => window.cegarplay.project.views[0].positions);
  assert.ok(posd && Array.isArray(posd['node(1)']), JSON.stringify(posd));
  assert.deepEqual(errors, []);
  await context.close();
});

test('I4: Fuzz on tutorial-weak-relevant reports n = 2, the lost solution pick(2), and saves a regression instance', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant&tab=9');
  await page.click('#fuzz-button');
  await page.waitForSelector('#fuzz-card:not([hidden])', { timeout: 60000 });
  const text = await page.textContent('#fuzz-card');
  assert.match(text, /Found at n2/);
  assert.match(text, /Lost solution \{pick\(2\)\}/);
  assert.match(text, /candidate \{pick\(1\) pick\(2\)\}/);
  await page.click('#fuzz-save');
  const x = await page.evaluate(() => window.cegarplay.project.instances.find((i) => i.tags.includes('regression')));
  assert.equal(x.expected.solutions, 3);
  await page.click('#fuzz-witness');
  await settled(page);
  assert.match(await page.textContent('#result-line'), /Audit: unsound/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('V4: the candidate space of gc-shape1: 3,373 cells, alive 101, a cursor move redraws within one frame', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=gc-shape1&tab=11');
  await page.evaluate(() => { window.cegarplay.project.settings.record = { steps: 'all', n: 0, calls: false }; window.cegarplay.loopTab.load(window.cegarplay.project); });
  await page.click('#run-button');
  await settled(page);
  await page.click('#space-compute');
  await page.waitForFunction(() => /candidates/.test(document.getElementById('space-summary').textContent), null, { timeout: 60000 });
  const sum = await page.textContent('#space-summary');
  assert.match(sum, /3,373 candidates, 101 solutions, 1,320 refinements; alive at the end 101/);
  assert.match(sum, /No refinement removes a solution/);
  const ms = await page.evaluate(() => {
    const v = window.cegarplay.space, t = [];
    for (const r of [10, 500, 1000, 1320, 1]) { v.slider.value = String(r); v.draw(); t.push(v.lastDrawMs); }
    return Math.max(...t);
  });
  console.log(`# candidate map redraw: ${ms.toFixed(1)} ms for 3,373 cells`);
  assert.ok(ms < 16, `${ms} ms`);
  assert.equal(await page.$eval('#space-map', (c) => c.dataset.cells), '3373');
  assert.deepEqual(errors, []);
  await context.close();
});

test('V4: tutorial-weak-relevant: the first unsound refinement is 6', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant&tab=11');
  await page.evaluate(() => { window.cegarplay.project.settings.record = { steps: 'all', n: 0, calls: false }; });
  await page.click('#run-button');
  await settled(page);
  await page.click('#space-compute');
  await page.waitForFunction(() => /candidates/.test(document.getElementById('space-summary').textContent));
  assert.match(await page.textContent('#space-summary'), /First unsound refinement: 6 \(it removes 13 solutions\)/);
  assert.equal(await page.$eval('#space-step', (s) => s.value), '6');
  assert.deepEqual(errors, []);
  await context.close();
});

test('V5: one cursor drives the trace, the domain view, the map and the timeline; the arrow keys move it', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=guide-03-hit-clique&tab=11');
  await page.evaluate(() => { window.cegarplay.project.settings.record = { steps: 'all', n: 0, calls: true }; });
  await page.click('#run-button');
  await settled(page);
  await page.click('#space-compute');
  await page.waitForFunction(() => /candidates/.test(document.getElementById('space-summary').textContent));
  const state = () => page.evaluate(() => {
    const a = window.cegarplay;
    return { step: a.cursor.step, label: document.getElementById('cursor-label').textContent, view: Number(document.getElementById('view-step').value),
      viewStep: a.views.steps[Number(document.getElementById('view-step').value) - 1]?.i, space: Number(document.getElementById('space-step').value),
      spaceStep: a.space.F.rows[Number(document.getElementById('space-step').value) - 1]?.i, trace: a.output.trace.events[a.output.trace.pos]?.i };
  });
  await page.evaluate(() => window.cegarplay.cursor.setByStep(3));
  await page.waitForFunction(() => document.querySelectorAll('#view-svg .view-emph').length === 3);
  let s = await state();
  assert.equal(s.step, 3);
  assert.equal(s.viewStep, 3);
  assert.ok(s.spaceStep <= 3);
  assert.equal(s.trace, 3);
  await page.focus('body');
  await page.keyboard.press('ArrowRight');
  s = await state();
  assert.equal(s.step, 4);
  assert.match(s.label, /^step 4/);
  await page.keyboard.press('Shift+ArrowLeft');
  assert.equal((await state()).step, 0);
  // a range restricts the line table
  const all = await page.evaluate(() => window.cegarplay.anatomy.rows().reduce((x, r) => x + r.calls, 0));
  await page.fill('#cursor-from', '1'); await page.fill('#cursor-to', '2'); await page.click('#cursor-range');
  const some = await page.evaluate(() => window.cegarplay.anatomy.rows().reduce((x, r) => x + r.calls, 0));
  assert.ok(some < all, `${some} < ${all}`);
  // exports
  const svg = await page.evaluate(async () => { window.cegarplay.cursor.setByStep(3); await window.cegarplay.views.show(); return window.cegarplay.observatory.viewSVG(); });
  assert.match(svg, /^<svg xmlns/);
  assert.equal((svg.match(/stroke-width="8"/g) || []).length, 3);
  assert.deepEqual(errors, []);
  await context.close();
});

test('V5: a link with replay, step and view opens on that step and view; lecture mode shows the notes', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?replay=examples/replays/guide-03-hit-clique.cprec&step=3&view=view&lecture=1');
  await page.waitForFunction(() => document.querySelectorAll('#view-svg .view-emph').length === 3);
  assert.equal(await page.evaluate(() => window.cegarplay.cursor.step), 3);
  assert.equal(await page.evaluate(() => document.body.classList.contains('lecture')), true);
  assert.match(await page.textContent('#view-notes'), /A triangle survives/);
  assert.equal(await page.isVisible('#anatomy'), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('V5: every library example with a replay and a view opens with a picture before the engine has loaded', async () => {
  const lib = JSON.parse(await (await fetch(server.url + 'examples/library.json')).text());
  const ids = [];
  for (const e of lib.examples) {
    const p = await (await fetch(server.url + `examples/${e.id}.json`)).json();
    if ((p.views || []).length && (e.tags || []).includes('fast')) ids.push(e.id);
  }
  assert.ok(ids.length >= 10, ids.join(' '));
  const context = await browser.newContext();
  await context.route(/clingo(-mt)?\.wasm$/, (route) => route.abort());
  for (const id of ids) {
    const page = await context.newPage();
    await page.goto(server.url + `index.html?nocoi=1&replay=examples/replays/${id}.cprec&tab=11`);
    await page.waitForSelector('#view-svg .view-root', { timeout: 20000 });
    const n = await page.evaluate(() => document.querySelectorAll('#view-svg .view-root g, #view-svg .view-root line').length);
    assert.ok(n > 0, id);
    assert.notEqual(await page.evaluate(() => document.body.dataset.ready), 'true', `${id}: the engine must not be ready`);
    await page.close();
  }
  await context.close();
});

test('V5: comparing two recordings: two alive curves, the second domain view beside the first', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant&tab=11');
  await page.evaluate(() => { window.cegarplay.project.settings.record = { steps: 'all', n: 0, calls: false }; });
  await page.click('#run-button');
  await settled(page);
  await page.click('#space-compute');
  await page.waitForFunction(() => /candidates/.test(document.getElementById('space-summary').textContent));
  const ok = await page.evaluate(async () => {
    const { Recording } = await import('./js/recording.js');
    const r = await fetch('examples/replays/tutorial-first-run.cprec');
    return window.cegarplay.space.compareWith(await Recording.fromBlob(await r.blob()));
  });
  assert.equal(ok, true);
  assert.match(await page.textContent('#space-message'), /alive at the end 61, no refinement removes a solution/);
  assert.equal(await page.$$eval('#space-curve .space-curve-b', (x) => x.length), 1);
  await page.waitForSelector('#view-svg-b svg');
  assert.deepEqual(errors, []);
  await context.close();
});

test('F1: Check exercise runs counts, audits and budgets, and never passes what it could not check', { timeout: 120000 }, async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=exercise-triangles&tab=9');
  assert.equal(await page.isVisible('#check-exercise-button'), true);
  assert.match(await page.textContent('#exercise-text'), /G\.clause\(M, X\)/);
  assert.equal(await page.$$eval('#exercise-items li', (l) => l.length), 7);
  await page.click('#check-exercise-button');
  await page.waitForSelector('#exercise-summary', { timeout: 100000 });
  assert.equal(await page.textContent('#exercise-summary'), '3 of 7 checks pass.');
  const states = await page.$$eval('#exercise-items li', (l) => l.map((x) => `${x.dataset.kind}:${x.dataset.state}`));
  assert.deepEqual(states, ['expected:pass', 'expected:pass', 'expected:pass', 'audit:fail', 'audit:fail', 'budget:fail', 'budget:fail']);
  assert.match(await page.textContent('#instances-status'), /Exercise: 3 of 7 checks pass\./);
  // a project without an exercise has no button
  await page.evaluate(() => window.cegarplay.loadExample('tutorial-first-run'));
  await page.waitForFunction(() => document.getElementById('check-exercise-button').hidden);
  assert.deepEqual(errors, []);
  await context.close();
});

test('D5, D10: two runs side by side, a note per run and per variant', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant&tab=6');
  await page.evaluate(() => window.cegarplay.control.run({}));
  await page.evaluate(() => window.cegarplay.control.run({ variant: 'reference' }));
  await page.waitForFunction(() => document.querySelectorAll('#history-table tbody tr').length === 2);
  await page.fill('#history-table tbody tr:nth-child(1) .history-note-input', 'the weak relevant/1');
  await page.dispatchEvent('#history-table tbody tr:nth-child(1) .history-note-input', 'change');
  await page.click('#history-table tbody tr:nth-child(1) .history-compare-pick');
  assert.equal(await page.isVisible('#history-compare-box'), false, 'one run picked: nothing to compare');
  await page.click('#history-table tbody tr:nth-child(2) .history-compare-pick');
  assert.equal(await page.isVisible('#history-compare-box'), true);
  const text = await page.textContent('#history-compare');
  assert.match(text, /the weak relevant\/1/);
  assert.match(text, /Solutions.*differ/s);
  assert.match(text, /A: calls/);
  assert.equal(await page.evaluate(() => window.cegarplay.stats.history[0].note), 'the weak relevant/1');
  await page.click('label[for="tab4"]');
  await page.fill('#variants .variant-card[data-variant="reference"] .variant-note', 'ground truth');
  await page.dispatchEvent('#variants .variant-card[data-variant="reference"] .variant-note', 'change');
  assert.equal(await page.evaluate(() => window.cegarplay.project.variants.find((v) => v.name === 'reference').note), 'ground truth');
  assert.deepEqual(errors, []);
  await context.close();
});

// the run bar's label, collected as it changes
const watchStatus = (page) => page.evaluate(() => {
  window.__status = [];
  new MutationObserver(() => window.__status.push(document.getElementById('run-status').textContent))
    .observe(document.getElementById('run-status'), { childList: true, characterData: true, subtree: true });
});

test('the run bar says running audit during an audit', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run');
  await watchStatus(page);
  await page.click('#audit-button');
  await settled(page);
  const seen = await page.evaluate(() => window.__status);
  assert.ok(seen.includes('running audit'), seen.join(' | '));
  assert.equal(await page.textContent('#run-status'), 'finished');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Run all, Fuzz and the audit of many instances name themselves and stop at one click', { timeout: 120000 }, async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=voting-justification&tab=9');
  // Run all: one click on Abort ends the whole batch
  await page.click('#run-all-instances-button');
  await page.waitForFunction(() => /^running all instances \(1 of \d+: /.test(document.getElementById('run-status').textContent));
  assert.equal(await page.isEnabled('#run-button'), false);
  await page.click('#abort-button');
  await page.waitForFunction(() => /Stopped after 0 of \d+ instances/.test(document.getElementById('instances-status').textContent));
  assert.equal(await page.textContent('#run-status'), 'aborted');
  assert.equal(await page.isEnabled('#run-button'), true);
  // the picked instance is marked audit: false, so Audit audits the other instances one by one
  assert.equal(await page.$eval('#instance-select', (s) => s.value), 'cancel-reinf-posresp-k4');
  assert.match(await page.textContent('#instances-table tr[data-instance="cancel-reinf-posresp-k4"]'), /no audit/);
  await page.click('#audit-button');
  await page.waitForFunction(() => /^running audit \(1 of \d+: faith-k1\)$/.test(document.getElementById('run-status').textContent));
  await page.click('#abort-button');
  await page.waitForFunction(() => /Audit stopped after/.test(document.getElementById('instances-status').textContent));
  // Fuzz: named in the run bar, stopped by one click
  await page.click('#fuzz-button');
  await page.waitForFunction(() => document.getElementById('run-status').textContent === 'running fuzz');
  await page.click('#abort-button');
  await page.waitForFunction(() => document.getElementById('instances-status').textContent === 'Fuzz: stopped.');
  assert.equal(await page.isEnabled('#run-button'), true);
  // the checkbox in the instance form switches the audit back on
  await page.click('#instances-table a:text("cancel-reinf-posresp-k4")');
  assert.equal(await page.isChecked('#instance-audit'), false);
  await page.check('#instance-audit');
  assert.equal(await page.evaluate(() => window.cegarplay.project.instances.find((x) => x.id === 'cancel-reinf-posresp-k4').audit), undefined);
  assert.deepEqual(errors, []);
  await context.close();
});
