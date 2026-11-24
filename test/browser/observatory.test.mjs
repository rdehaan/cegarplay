// The Observatory's domain view (Show: steps | solutions) and candidate space (no map without
// candidates; the blame matrix needs only the recorded steps).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

test('domain view: a solution is not a step after a cut trace; Show: solutions says what is known', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=af-preferred&tab=4');
  // a trace of 3 steps, all solutions
  await page.fill('#trace-input', '3');
  await page.dispatchEvent('#trace-input', 'change');
  await page.selectOption('#solutions-select', '0');
  await page.click('label[for="tab11"]');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  await page.keyboard.press('End');
  await page.waitForFunction(() => /traced step 3 of 3/.test(document.getElementById('view-step-label').textContent));
  assert.match(await page.textContent('#view-step-label'), /the trace keeps only the first 3 steps of the run/);
  // the cursor's last tick is the last traced step: no solution numbered on after it
  assert.deepEqual(await page.evaluate(() => window.cegarplay.cursor.ticks.map((t) => t.k)), ['reject', 'reject', 'reject']);
  assert.equal(await page.textContent('#view-show-steps-label'), 'steps (3)');
  assert.equal(await page.textContent('#view-show-solutions-label'), 'solutions (3)');
  assert.equal(await page.isVisible('#view-solution'), false);
  await page.check('#view-show-solutions');
  assert.equal(await page.isVisible('#view-step'), false);
  await page.waitForFunction(() => /^solution 1 of 3, /.test(document.getElementById('view-solution-label').textContent));
  await page.fill('#view-solution', '3');
  await page.dispatchEvent('#view-solution', 'input');
  await page.waitForFunction(() => /^solution 3 of 3, found after traced step 3; the trace keeps only the first 3 steps, so when exactly is not known/.test(document.getElementById('view-solution-label').textContent));
  await page.waitForSelector('#view-svg svg');
  // with every step recorded a solution has its step number
  await page.check('#view-show-steps');
  await page.click('label[for="tab4"]');
  await page.selectOption('#record-select', 'all');
  await page.click('label[for="tab11"]');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  await page.check('#view-show-solutions');
  // (the slider keeps its place: solution 3)
  await page.waitForFunction(() => /^solution 3 of 3, found at step \d+$/.test(document.getElementById('view-solution-label').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

test('candidate space: an audit: false instance gets no empty map; the blame matrix still shows; Try anyway', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=af-preferred&tab=11');
  assert.match(await page.textContent('#space-blame-note'), /One row per refinement, one column per interface atom/);
  await page.evaluate(() => { window.cegarplay.project.instances.find((x) => x.id === 'example').audit = false; });
  await page.evaluate(() => window.cegarplay.space.recordAndRun());
  assert.match(await page.textContent('#space-message'), /No map: the instance example is marked "audit: false"/);
  assert.equal(await page.textContent('#space-summary'), '');
  assert.equal(await page.textContent('#space-label'), '');
  assert.ok(Number(await page.$eval('#space-blame', (c) => c.dataset.cols)) > 0, 'the blame matrix is drawn from the steps');
  // this instance is small: Try anyway lists its candidates
  await page.click('#space-compute-anyway');
  await page.waitForFunction(() => Number(document.getElementById('space-map').dataset.cells) > 0, null, { timeout: 60000 });
  assert.match(await page.textContent('#space-summary'), /candidates, \d+ of them solutions/);
  assert.deepEqual(errors, []);
  await context.close();
});

const settled = (page) => page.waitForFunction(() => ['finished', 'error'].includes(document.getElementById('run-status').dataset.state) && !window.cegarplay.control.batch, null, { timeout: 120000 });

test('a space audit to the candidate space: which run the map shows, the refinement at the cursor, the trace; a new run clears it', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant');
  assert.match(await page.textContent('#shown-line'), /^Shown: no results yet/);
  await page.selectOption('#audit-mode', 'space');
  await page.click('#audit-button');
  await settled(page);
  await page.waitForFunction(() => /^Shown: the space audit of space n, started \S+ · unsound at n = 2$/.test(document.getElementById('shown-line').textContent));
  // after an audit alone the map explains why it has nothing to show
  await page.evaluate(() => window.cegarplay.space.compute());
  assert.match(await page.textContent('#space-message'), /The last action was an audit, which records no steps of the loop/);
  await page.click('label[for="tab5"]');
  await page.click('#audit-panel button[data-action="space-candidate-space"]');
  await page.waitForFunction(() => Number(document.getElementById('space-map').dataset.cells) > 0, null, { timeout: 120000 });
  assert.equal(await page.$eval('#instance-select', (s) => s.value), 'regression-n2');
  assert.match(await page.textContent('#space-source'), /^The map of the run on instance regression-n2: \d+ recorded steps\./);
  await page.waitForFunction(() => /candidate space computed for it/.test(document.getElementById('shown-line').textContent));
  // the refinement at the cursor: its step, candidate, counterexample and clause
  const detail = await page.textContent('#space-refinement');
  assert.match(detail, /^Refinement \d+ of \d+: recorded step \d+, traced step \d+ \((reject|add|expand), solver A\)/);
  assert.match(detail, /Candidate\{/);
  assert.match(detail, /Counterexample\S/);
  assert.match(detail, /Clauseat least one of: /);
  assert.equal(await page.getAttribute('#space-refinement', 'aria-live'), 'polite');
  // the first refinement: its own box, and Show in the trace lands on the paired trace step
  await page.fill('#space-step', '1');
  await page.dispatchEvent('#space-step', 'input');
  await page.waitForFunction(() => /^Refinement 1 of/.test(document.getElementById('space-refinement').textContent));
  await page.click('#space-show-trace');
  assert.equal(await page.$eval('#tab5', (t) => t.checked), true);
  assert.match(await page.textContent('#trace-label'), /^traced step 1 of \d+ \(recorded step \d+ of \d+, as in the Observatory\)$/);
  // another run: the map is of a run no longer shown, so it is cleared with a note
  await page.click('#run-button');
  await settled(page);
  assert.match(await page.textContent('#space-message'), /The map of the run on instance regression-n2 was cleared: a newer run, audit or replay replaced it/);
  assert.equal(await page.$eval('#space-map', (c) => c.dataset.cells ?? null), null);
  assert.equal(await page.isHidden('#space-refinement'), true);
  assert.doesNotMatch(await page.textContent('#shown-line'), /candidate space/);
  // an edit: the Shown line warns that the results are of the earlier version
  await B.setEditor(page, 'editor-check', (await B.getEditor(page, 'editor-check')) + '% an edit\n');
  await page.waitForFunction(() => document.getElementById('shown-line').dataset.state === 'stale');
  assert.match(await page.textContent('#shown-line'), /the project was edited since: these results are of the earlier version/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a view is edited in the Observatory, not in the Programs tab; a new fragment has its height', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=3', { advanced: false });
  await page.waitForSelector('#fragments [data-fragment="check"]');
  // the view's rules are not among the program fragments; a note leads to them
  assert.deepEqual(await page.$$eval('#fragments .fragment', (l) => l.map((x) => x.dataset.fragment)), ['shared', 'abstraction', 'glue', 'check']);
  assert.equal(await page.isVisible('#view-fragments-note'), true);
  // a fragment added in the Programs tab is not a few pixels high
  page.once('dialog', (d) => d.accept('extra'));
  await page.click('#add-fragment-button');
  assert.ok(await page.$eval('[data-fragment="extra"] .editor', (e) => e.getBoundingClientRect().height) > 30);
  // the note's button opens the Observatory (an Advanced tab) with the view's editor
  await page.click('#open-view-editor');
  await page.waitForFunction(() => document.getElementById('tab11').checked && document.getElementById('view-edit').open);
  await page.waitForFunction(() => document.querySelector('#view-fragments [data-fragment="view"] .editor').getBoundingClientRect().height > 100);
  assert.deepEqual(await page.$$eval('#view-reads input:checked', (l) => l.map((x) => x.value)), ['shared']);
  // run, then edit the view: it redraws
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  await page.waitForFunction(() => document.getElementById('view-notes').textContent.length > 0);
  await page.evaluate(() => { const ed = window.cegarplay.editors.fragments.get('view').editor; ed.navigateFileEnd(); ed.insert('\ndraw(note(hello)).\n'); });
  await page.waitForFunction(() => /hello/.test(document.getElementById('view-notes').textContent));
  // New view: its own fragment, shown instead of the first one's; rename and delete follow it
  page.once('dialog', (d) => d.accept('second'));
  await page.click('#view-new');
  await page.waitForFunction(() => document.getElementById('view-select').value === 'second');
  assert.deepEqual(await page.$$eval('#view-fragments .fragment:not([hidden])', (l) => l.map((x) => x.dataset.fragment)), ['second']);
  await page.waitForFunction(() => /reject/.test(document.getElementById('view-notes').textContent));
  page.once('dialog', (d) => d.accept('third'));
  await page.click('#view-rename');
  await page.waitForFunction(() => document.getElementById('view-select').value === 'third');
  assert.deepEqual(await page.evaluate(() => window.cegarplay.project.views.map((v) => [v.name, v.fragments])), [['view', ['shared', 'view']], ['third', ['shared', 'third']]]);
  page.once('dialog', (d) => d.accept());
  await page.click('#view-delete');
  await page.waitForFunction(() => document.getElementById('view-select').value === 'view');
  assert.equal(await page.evaluate(() => window.cegarplay.project.fragments.some((f) => f.name === 'third')), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('?fragment=view opens the view\'s editor in the Observatory', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=guide-03-hit-clique&fragment=view', { advanced: false });
  await page.waitForFunction(() => document.getElementById('tab11').checked && document.getElementById('view-edit').open);
  assert.equal(await page.isVisible('#view-fragments [data-fragment="view"] .ace_editor'), true);
  assert.deepEqual(errors, []);
  await context.close();
});
