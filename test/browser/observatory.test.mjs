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
  assert.match(await page.textContent('#space-summary'), /candidates, \d+ solutions/);
  assert.deepEqual(errors, []);
  await context.close();
});
