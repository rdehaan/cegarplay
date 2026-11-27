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
  await page.waitForFunction(() => /Ran 6 instances/.test(document.getElementById('instances-status').textContent));
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
  await page.waitForFunction(() => /Ran 6 instances/.test(document.getElementById('instances-status').textContent));
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
  assert.match(await page.textContent('#result-line'), /^Replayed \(instance n5\): Finished: 101 solutions/);
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
  await B.openDialog(page, 'versions');   // Project > Recordings
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download-recording-button')]);
  const file = await dl.path();
  await page.setInputFiles('#recording-input', file);
  await page.waitForFunction(() => document.getElementById('run-status').dataset.state === 'replayed');
  assert.match(await page.textContent('#recording-status'), /107 steps/);
  await B.closeDialog(page, 'versions');
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

test('I2: Preview 6 shows six instances; Add as instance stores the generated facts, which a run uses', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=qbf&tab=9');
  assert.equal(await page.$eval('#generator-select', (s) => s.value), 'qbf-dnf');
  await page.click('#preview-button');
  await page.waitForSelector('#generator-preview .generator-card:nth-child(6)');
  assert.equal(await page.$$eval('#generator-preview .generator-card', (c) => c.length), 6);
  assert.match(await page.textContent('#generator-status'), /6 instances, 6 accepted of \d+ draws/);
  assert.match(await page.textContent('#generator-preview .generator-card'), /Seed 1, attempt 0, exact/);
  await page.click('#generator-preview .generator-card button');
  assert.equal(await page.$eval('#instances-table', (t) => !!t.querySelector('tr[data-instance="qbf-dnf-s1"]')), true);
  // a fixed instance: its facts are text in the editor, the recipe only says where they came from
  assert.match(await B.getEditor(page, 'instance-editor'), /\.\n/);
  assert.match(await page.textContent('#instance-recipe'), /Generated by qbf-dnf .*the generator is not run again/);
  assert.equal(await page.isVisible('#instance-write-out'), false);
  // (dnf-1 has the same recipe: 8 solutions)
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
  assert.match(text, /n8: (\(no variant\) 11 vs reference 61|reference 61 vs \(no variant\) 11)/);
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
  assert.match(text, /Unsound at n = 2;/);
  assert.match(text, /Tried: the project with n = 1\.\.8/);
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
  assert.match(sum, /This instance: 3,373 candidates, 101 of them solutions\. The candidates are those of link G[^.]*\.\s*This run: 1,320 refinements; 101 candidates left at the end/);
  assert.match(sum, /Lost solutions: none: no refinement of this run removes a solution/);
  assert.equal(await page.isVisible('#space-audit-instance'), true);
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

test('V4: Stop ends a Compute of the candidate space; Compute works again afterwards', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=gc-shape1&tab=11');
  await page.evaluate(() => { window.cegarplay.project.settings.record = { steps: 'all', n: 0, calls: false }; window.cegarplay.loopTab.load(window.cegarplay.project); });
  await page.click('#run-button');
  await settled(page);
  assert.equal(await page.isVisible('#space-stop'), false);
  // stop at once (deterministic: before the audit can finish), as the button does
  const shown = await page.evaluate(async () => {
    const v = window.cegarplay.space;
    const p = v.compute();
    const during = { stop: !v.stopButton.hidden, compute: v.computeButton.disabled };
    v.stop();
    await p;
    return during;
  });
  assert.deepEqual(shown, { stop: true, compute: true });
  assert.match(await page.textContent('#space-message'), /^Stopped: no map\./);
  assert.equal(await page.isVisible('#space-stop'), false);
  assert.equal(await page.isEnabled('#space-compute'), true);
  assert.equal(await page.$eval('#space-map', (c) => c.dataset.cells || ''), '');
  // the engine is free again: a click on Stop while the audit runs, then a full Compute
  await page.click('#space-compute');
  await page.click('#space-stop');
  await page.waitForFunction(() => document.getElementById('space-stop').hidden);
  await page.click('#space-compute');
  await page.waitForFunction(() => /candidates/.test(document.getElementById('space-summary').textContent), null, { timeout: 60000 });
  assert.equal(await page.$eval('#space-map', (c) => c.dataset.cells), '3373');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the run and audit buttons are always on their own row, under the logo', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant');
  const rows = () => page.evaluate(() => {
    const b = document.querySelector('.topbar .brand').getBoundingClientRect();
    const r = document.getElementById('run-button').getBoundingClientRect();
    const a = document.querySelector('.topbar .run-actions').getBoundingClientRect();
    return { below: r.top >= b.bottom, left: Math.round(a.left - document.getElementById('topbar').getBoundingClientRect().left) };
  });
  const seen = new Set();
  for (const width of [1800, 1400, 1100, 900]) {
    await page.setViewportSize({ width, height: 900 });
    const x = await rows();
    assert.equal(x.below, true, `width ${width}`);
    seen.add(x.left);
  }
  // a long project name does not move them either
  await page.evaluate(() => { document.getElementById('topbar-project').textContent = 'a rather long project name '.repeat(3); });
  await page.setViewportSize({ width: 1800, height: 900 });
  assert.equal((await rows()).below, true);
  assert.equal(seen.size, 1, `the actions start at the same place: ${[...seen]}`);
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
  assert.match(await page.textContent('#space-summary'), /refinement 6 is the first that removes a solution \(13 of them\): this run is wrong/);
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
  assert.match(s.label, /^recorded step 4 \(/);
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
  const { page, context, errors } = await B.openPage(browser, server, '?example=voting-justification&tab=9&instance=cancel-reinf-posresp-k4');
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
  await page.waitForFunction(() => /^running audit \(1 of \d+: cancel-posresp-k2\)$/.test(document.getElementById('run-status').textContent));
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

test('D7: several files at once, and a CSV file with a column map', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=graph-coloring&tab=9');
  const n0 = await page.evaluate(() => window.cegarplay.project.instances.length);
  await page.fill('#instance-column-map', 'edge(u,v)');
  await page.setInputFiles('#instance-file', [
    { name: 'tri.csv', mimeType: 'text/csv', buffer: Buffer.from('u,v\n1,2\n2,3\n1,3\n') },
    { name: 'path.lp', mimeType: 'text/plain', buffer: Buffer.from('edge(1,2). edge(2,3).\n') },
    { name: 'bad.lp', mimeType: 'text/plain', buffer: Buffer.from('edge(1,.\n') },
  ]);
  await page.waitForFunction(() => /Imported 2 of 3 files/.test(document.getElementById('instances-status').textContent));
  assert.match(await page.textContent('#instances-status'), /Not imported: bad\.lp: line 1/);
  const added = await page.evaluate((n) => window.cegarplay.project.instances.slice(n).map((x) => [x.id, x.facts.split('\n').filter((l) => !l.startsWith('%')).join(' ').trim()]), n0);
  assert.deepEqual(added, [['tri', 'edge(1,2). edge(2,3). edge(1,3).'], ['path', 'edge(1,2). edge(2,3).']]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('D8: Mine hard instances in the generator panel, and add one', { timeout: 180000 }, async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=qbf&tab=9');
  const n0 = await page.evaluate(() => window.cegarplay.project.instances.length);
  await page.click('#mine-button');
  await page.waitForFunction(() => /^running mining/.test(document.getElementById('run-status').textContent));
  await page.waitForFunction(() => /^Mined \d+ runs/.test(document.getElementById('generator-status').textContent), null, { timeout: 170000 });
  assert.equal(await page.$$eval('#generator-preview .mined', (l) => l.length), 5);
  await page.click('#generator-preview .mined button');
  assert.match(await page.textContent('#generator-status'), /Added instance hard-qbf-dnf/);
  const x = await page.evaluate((n) => window.cegarplay.project.instances[n], n0);
  assert.ok(x.recipe && x.tags.includes('hard'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('D9: the workspace keeps several projects by name and asks before overwriting', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run');
  page.on('dialog', (d) => d.accept());
  await B.openDialog(page, 'versions');   // Project > Workspace and snapshots
  await page.fill('#workspace-name', 'baseline');
  await page.click('#workspace-save-button');
  await page.evaluate(() => window.cegarplay.loadExample('qbf'));
  await page.waitForFunction(() => window.cegarplay.project.title === '2QBF');
  await page.fill('#workspace-name', 'experiment');
  await page.click('#workspace-save-button');
  assert.deepEqual(await page.$$eval('#workspace-list li', (l) => l.map((x) => x.dataset.name)), ['experiment', 'baseline']);
  // overwriting asks (accepted here) and keeps one entry
  let asked = false;
  page.once('dialog', (d) => { asked = /already has a project called experiment/.test(d.message()); });
  await page.click('#workspace-save-button');
  assert.equal(asked, true);
  assert.equal(await page.$$eval('#workspace-list li', (l) => l.length), 2);
  await page.click('#workspace-list li[data-name="baseline"] button:text("Open")');
  await page.waitForFunction(() => window.cegarplay.project.title === 'Sum-free sets');
  assert.match(await page.textContent('#workspace-status'), /Opened baseline/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Statistics: the Cores block shows the lengths of plain and minimised cores', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=maxsat-ihs&tab=6');
  assert.equal(await page.isVisible('#cores-block'), false);
  await page.click('#run-button');
  await settled(page);
  assert.equal(await page.isVisible('#cores-block'), true);
  const rows = await page.$$eval('#cores-table tbody tr', (r) => r.map((x) => [...x.children].slice(0, 2).map((c) => c.textContent)));
  assert.deepEqual(rows, [['minimised (core.minimal)', '5']]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Observatory: tracked values get lanes on the call timeline', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=maxsat-ihs&tab=11');
  await page.click('#run-button');
  await settled(page);
  const t = await page.evaluate(() => [...window.cegarplay.anatomy.tracks.entries()].map(([k, v]) => [k, v.length]));
  assert.deepEqual(t.map((x) => x[0]), ['lower', 'upper']);
  assert.ok(t.every((x) => x[1] >= 1));
  assert.equal(await page.$eval('#anatomy-timeline', (c) => parseInt(c.style.height, 10)), 18 + (2 + 2) * 26 + 16);
  assert.deepEqual(errors, []);
  await context.close();
});

test('I2: generator constants reach the instances it makes; a recipe instance can be written out; (no instance) is explained', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=qbf&tab=9');
  await page.fill('#generator-constants', 'k=2');
  await page.press('#generator-constants', 'Tab');
  assert.deepEqual(await page.evaluate(() => window.cegarplay.project.generators.find((g) => g.name === 'qbf-dnf').constants), { k: '2' });
  await page.click('#preview-button');
  await page.waitForSelector('#generator-preview .generator-card button');
  await page.click('#generator-preview .generator-card button');
  assert.equal(await page.inputValue('#instance-constants'), 'k=2');
  // a library instance stored as a recipe: Write out its facts keeps them as text
  const recipeId = await page.evaluate(() => (window.cegarplay.project.instances.find((x) => x.recipe && x.facts === undefined) || {}).id);
  assert.ok(recipeId, 'qbf has a recipe instance');
  await page.click(`#instances-table tr[data-instance="${recipeId}"] a`);
  assert.equal(await page.isVisible('#instance-write-out'), true);
  await page.click('#instance-write-out');
  await page.waitForFunction((id) => typeof window.cegarplay.project.instances.find((x) => x.id === id).facts === 'string', recipeId);
  assert.match(await B.getEditor(page, 'instance-editor'), /\./);
  assert.equal(await page.isVisible('#instance-write-out'), false);
  // (no instance): named so in the run bar, and explained in the tab
  assert.equal(await page.$eval('#instance-select option[value=""]', (o) => o.textContent), '(no instance)');
  assert.equal(await page.isVisible('#instance-none-note'), false);
  await page.selectOption('#instance-select', '');
  assert.equal(await page.isVisible('#instance-none-note'), true);
  assert.match(await page.textContent('#instance-none-note'), /a run uses none of these instances/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Instances: reorder by dragging and with the keyboard; the instance a run uses stays; Run all says which variant it uses', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=voting-justification&tab=9');
  const ids = () => page.evaluate(() => window.cegarplay.project.instances.map((x) => x.id));
  const before = await ids();
  const used = await page.$eval('#instance-select', (s) => s.value);
  // drag the first instance's grip below the second row
  const g = await page.$(`#instances-table tr[data-instance="${before[0]}"] .drag-grip`);
  const gb = await g.boundingBox();
  const r2 = await (await page.$(`#instances-table tr[data-instance="${before[1]}"]`)).boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2, r2.y + r2.height * 0.6, { steps: 6 });
  assert.equal(await page.isVisible('.drag-line'), true, 'a line shows where it goes');
  await page.mouse.move(gb.x + gb.width / 2, r2.y + r2.height * 0.9, { steps: 2 });
  await page.mouse.up();
  const after = await ids();
  assert.deepEqual(after.slice(0, 2), [before[1], before[0]]);
  assert.equal(await page.$eval('#instance-select', (s) => s.value), used, 'the run bar keeps its instance');
  assert.deepEqual(await page.$$eval('#instance-select option', (l) => l.slice(1, 3).map((o) => o.value)), [before[1], before[0]]);
  assert.equal(await page.$('.drag-line'), null);
  // the keyboard: Arrow Up on the moved instance's grip puts it back (the focus stays on its grip)
  await page.focus(`#instances-table tr[data-instance="${before[0]}"] .drag-grip`);
  await page.keyboard.press('ArrowUp');
  assert.deepEqual(await ids(), before);
  await page.waitForFunction((id) => document.activeElement && document.activeElement.closest(`tr[data-instance="${id}"]`), before[0]);
  await page.keyboard.press('ArrowUp');
  assert.deepEqual(await ids(), before, 'the first stays first');
  // Run all instances and Fuzz: the run bar's variant, named
  assert.match(await page.textContent('#instances-context'), /Both use no variant, as picked in the top bar/);
  await page.selectOption('#variant-select', 'falsified');
  assert.match(await page.textContent('#instances-context'), /use the variant falsified, as picked in the top bar/);
  assert.equal(await page.textContent('#run-all-instances-button'), 'Run all instances');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Control: "Loaded example" goes at the first edit and when another project comes', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=1');
  page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#library [data-load-example="tutorial-first-run"]', { state: 'attached' });
  await B.openLibrary(page);
  // (a first visit opens with this example already: the line must come from this load, not that one)
  await page.evaluate(() => { document.getElementById('load-status').textContent = ''; });
  await page.click('#library [data-load-example="tutorial-first-run"]');
  await page.waitForFunction(() => /Loaded example "Sum-free sets"/.test(document.getElementById('load-status').textContent), null, { timeout: 60000 });
  await B.setEditor(page, 'editor-check', '% edit\n');
  await page.waitForFunction(() => document.getElementById('load-status').textContent === '');
  // an upload replaces it with its own line, and the old line is not left behind
  await page.setInputFiles('#file-input', { name: 'p.json', mimeType: 'application/json',
    buffer: Buffer.from(await page.evaluate(() => JSON.stringify(window.cegarplay.collect()))) });
  await page.waitForFunction(() => /Loaded p\.json/.test(document.getElementById('upload-status').textContent));
  assert.equal(await page.textContent('#load-status'), '');
  await B.setEditor(page, 'editor-check', '% edit 2\n');
  await page.waitForFunction(() => document.getElementById('upload-status').textContent === '');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Instances: the counts say which variant they are of, and are marked stale after an edit', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=af-preferred&tab=9');
  await page.selectOption('#variant-select', 'one-clause');
  await page.click('#run-all-instances-button');
  await page.waitForFunction(() => /Last count: Run all instances at .*, with the variant one-clause\./.test(document.getElementById('instances-results-note').textContent), null, { timeout: 120000 });
  // another variant picked afterwards: the note still names the one the counts are of
  await page.selectOption('#variant-select', '');
  await page.click('label[for="tab9"]');
  assert.match(await page.textContent('#instances-results-note'), /with the variant one-clause/);
  assert.equal(await page.$$eval('#instances-table td.stale-result', (l) => l.length), 0);
  // an edit of check: the variant swaps check out, so its counts still hold
  await B.setEditor(page, 'editor-check', (await B.getEditor(page, 'editor-check')) + '\n% edited\n');
  await page.waitForTimeout(600);
  assert.equal(await page.$$eval('#instances-table td.stale-result', (l) => l.length), 0);
  // an edit of shared, which the variant uses: the counts are marked stale
  await B.setEditor(page, 'editor-shared', (await B.getEditor(page, 'editor-shared')) + '\n% edited\n');
  await page.click('label[for="tab9"]');
  await page.waitForFunction(() => document.querySelectorAll('#instances-table td.stale-result').length > 0);
  assert.match(await page.textContent('#instances-results-note'), /The project changed since/);
  assert.match(await page.textContent('#instances-table'), /\(stale\)/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Fuzz says what it tried and what came out, also when it finds nothing', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=9');
  await page.click('#fuzz-button');
  await page.waitForFunction(() => !document.getElementById('fuzz-card').hidden, null, { timeout: 120000 });
  const text = await page.textContent('#fuzz-card');
  assert.match(text, /Fuzz: no unsound instance found/);
  assert.match(text, /Fuzz looks for a small instance on which the loop is unsound/);
  assert.match(text, /Tried: the project with n = 1\.\.\d+ \(every numeric constant from 1 up to its value/);
  assert.match(text, /\d+ instances?: \d+ sound/);
  assert.equal(await page.$eval('#fuzz-card', (e) => e.dataset.verdict), 'sound');
  assert.deepEqual(errors, []);
  await context.close();
});

test('generator and space results go when their program is edited; a space is checked after an edit; the run bar seed', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=qbf&tab=9');
  await page.click('#preview-button');
  await page.waitForSelector('#generator-preview .generator-card');
  assert.equal(await page.isVisible('#generator-clear-button'), true);
  await page.click('#generator-clear-button');
  assert.equal(await page.$$eval('#generator-preview .generator-card', (l) => l.length), 0);
  await page.click('#preview-button');
  await page.waitForSelector('#generator-preview .generator-card');
  await B.setEditor(page, 'generator-editor', (await B.getEditor(page, 'generator-editor')) + '\n% edited\n');
  assert.equal(await page.$$eval('#generator-preview .generator-card', (l) => l.length), 0, 'an edit removes the preview');
  // spaces: no Check button; an error is marked 500 ms after the edit; Preview can be cleared
  assert.equal(await page.$('#check-space-button'), null);
  await page.click('#preview-space-button');
  await page.waitForSelector('#space-preview .generator-card');
  await page.click('#space-preview-clear');
  assert.equal(await page.$$eval('#space-preview .generator-card', (l) => l.length), 0);
  const text = await B.getEditor(page, 'space-editor');
  await B.setEditor(page, 'space-editor', text + '\nbroken(.\n');
  await page.waitForFunction(() => /line \d+/.test(document.getElementById('space-status').textContent), null, { timeout: 10000 });
  await B.setEditor(page, 'space-editor', text);
  await page.waitForFunction(() => document.getElementById('space-status').textContent === '', null, { timeout: 10000 });
  // the run bar's seed and the Loop tab's are one setting
  await B.runOptions(page, () => page.fill('#run-seed', '7'));
  await page.dispatchEvent('#run-seed', 'change');
  await B.runOptions(page, () => page.check('#run-randomize'));
  assert.equal(await page.$eval('#seed-input', (e) => e.value), '7');
  assert.equal(await page.$eval('#randomize-checkbox', (e) => e.checked), true);
  assert.deepEqual(await page.evaluate(() => [window.cegarplay.project.settings.seed, window.cegarplay.project.settings.randomize]), [7, true]);
  assert.deepEqual(errors, []);
  await context.close();
});
