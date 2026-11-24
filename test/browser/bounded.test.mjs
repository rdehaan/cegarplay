// PLAN3 phase S8: the audit modes Symbolic and Space in the page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const settled = (page) => page.waitForFunction(() => ['finished', 'error', 'aborted'].includes(document.getElementById('run-status').dataset.state) &&
  !window.cegarplay.control.batch);
const historyAudit = (page) => page.$$eval('#history-table tr', (rows) => {
  const k = [...rows[0].children].findIndex((th) => th.textContent === 'Audit');
  return rows.slice(1).map((r) => r.children[k].textContent);
});

test('S8: the symbolic audit of tutorial-weak-relevant shows "unsound" with its witness', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant');
  await page.selectOption('#audit-mode', 'symbolic');
  assert.equal(await page.isVisible('#space-select'), false);
  await page.click('#audit-button');
  await settled(page);
  assert.equal(await page.$eval('#audit-panel', (e) => e.dataset.verdict), 'unsound');
  assert.equal(await page.$eval('#audit-panel', (e) => e.dataset.mode), 'symbolic');
  const text = await page.textContent('#audit-panel');
  assert.match(text, /Symbolic audit: unsound/);
  assert.match(text, /Relevant\{pick\(2\)\}/);
  assert.match(text, /They differ on\{pick\(1\)\}/);
  assert.match(await page.textContent('#result-line'), /Symbolic audit: unsound/);
  assert.deepEqual(await historyAudit(page), ['unsound (symbolic)']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('S8: a space audit shows its k; the witness instance can be saved', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run');
  await page.selectOption('#audit-mode', 'space');
  assert.equal(await page.isVisible('#space-select'), true);
  assert.equal(await page.$eval('#space-bound', (e) => e.value), '10');
  await page.fill('#space-bound', '4');
  await page.click('#audit-button');
  await settled(page);
  assert.equal(await page.$eval('#audit-panel', (e) => e.dataset.mode), 'space');
  assert.match(await page.textContent('#audit-panel'), /Space n: sound up to k = 4/);
  assert.deepEqual(await historyAudit(page), ['sound ≤ 4']);
  // the too weak variant breaks at n = 2; its instance is kept as a regression instance
  await page.goto(server.url + 'index.html?nocoi=1&example=tutorial-weak-relevant');
  await page.waitForSelector('body[data-ready="true"]');
  await page.selectOption('#audit-mode', 'space');
  await page.click('#audit-button');
  await settled(page);
  assert.equal(await page.$eval('#audit-panel', (e) => e.dataset.verdict), 'unsound');
  assert.match(await page.textContent('#audit-panel'), /Space n: unsound at k = 2/);
  await page.$eval('#audit-panel .save-witness', (b) => b.click());   // the panel is in the Output tab
  const inst = await page.evaluate(() => window.cegarplay.project.instances.map((x) => [x.id, x.constants]));
  assert.deepEqual(inst, [['regression', { n: '2' }]]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('S8: a project without spaces offers no Space mode', async () => {
  const { page, context } = await B.openPage(browser, server, '?example=gc-shape3');
  const opt = await page.$eval('#audit-mode-space', (o) => ({ hidden: o.hidden, disabled: o.disabled }));
  assert.deepEqual(opt, { hidden: true, disabled: true });
  // and the Instances tab lists the spaces of a project that has them
  await page.goto(server.url + 'index.html?nocoi=1&example=af-preferred&tab=9');
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.$eval('#space-list-select', (s) => s.value), 'frameworks');
  assert.equal(await page.$eval('#space-name', (s) => s.value), 'frameworks');
  assert.equal(await page.$eval('#audit-mode-space', (o) => o.hidden), false);
  await context.close();
});

test('S8: Stop ends a long symbolic audit on an isolated page (the verifier polls like the runtime)', async () => {
  const coi = await B.startServer({ coi: true });
  try {
    const { page, context, errors } = await B.openPage(browser, coi, '?nocoi=1&example=slitherlink', { coi: true });
    assert.equal(await page.evaluate(() => self.crossOriginIsolated), true);
    await page.selectOption('#audit-mode', 'symbolic');
    await page.click('#audit-button');
    await B.waitState(page, ['running']);
    await page.waitForTimeout(2500);
    const t0 = Date.now();
    await page.click('#stop-button');
    await page.waitForFunction(() => ['finished', 'error', 'aborted'].includes(document.getElementById('run-status').dataset.state), null, { timeout: 10000 });
    assert.ok(Date.now() - t0 < 5000, 'stopped within seconds');
    assert.equal(await B.runState(page), 'finished');
    assert.match(await page.textContent('#result-line'), /Symbolic audit ended without a verdict: stopped/);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { coi.close(); }
});
