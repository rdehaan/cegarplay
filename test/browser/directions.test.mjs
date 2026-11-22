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
