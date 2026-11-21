// Phase 6: cross-origin isolation, pause, step, stop and threads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let plain, coiServer, browser;
before(async () => { plain = await B.startServer(); coiServer = await B.startServer({ coi: true }); browser = await B.launch(); });
after(async () => { await browser.close(); plain.close(); coiServer.close(); });

const candidates = async (page) => Number(((/([\d,]+) candidates/.exec(await page.textContent('#live-line')) || [0, '0'])[1]).replace(/,/g, ''));
const setN7 = (page) => page.evaluate(() => { window.cegarplay.project.settings.constants.n = '7'; });

test('the service worker shim isolates the page on the plain server; ?nocoi=1 does not', async () => {
  const o = await B.openPage(browser, plain, '', { coi: true });
  assert.equal(await o.page.evaluate(() => self.crossOriginIsolated), true);
  assert.equal(await o.page.isVisible('#pause-button'), true);
  assert.equal(await o.page.isEnabled('#threads-checkbox'), true);
  assert.deepEqual(o.errors, []);
  assert.deepEqual(o.foreign, []);
  await o.context.close();
  const n = await B.openPage(browser, plain);
  assert.equal(await n.page.evaluate(() => self.crossOriginIsolated), false);
  assert.equal(await n.page.isHidden('#pause-button'), true);
  assert.equal(await n.page.isDisabled('#threads-checkbox'), true);
  await n.context.close();
});

test('pause freezes the counters, step advances, resume continues, stop ends with statistics', async () => {
  const { page, context, errors } = await B.openPage(browser, coiServer, '?nocoi=1&example=graph-coloring&tab=6', { coi: true });
  assert.equal(await page.evaluate(() => self.crossOriginIsolated), true);
  await setN7(page);
  await page.click('#run-button');
  await B.waitState(page, ['running']);
  await page.waitForTimeout(800);
  await page.click('#pause-button');
  assert.equal(await B.runState(page), 'paused');
  await page.waitForTimeout(200);
  const a = await page.textContent('#live-line');
  await page.waitForTimeout(700);
  assert.equal(await page.textContent('#live-line'), a, 'frozen while paused');
  const c0 = await candidates(page);
  await page.click('#step-button');
  await page.waitForTimeout(300);
  assert.equal(await B.runState(page), 'paused');
  const c1 = await candidates(page);
  await page.waitForTimeout(500);
  assert.equal(await candidates(page), c1, 'paused again after a step');
  assert.ok(c1 >= c0);
  await page.click('#pause-button');                 // resume
  assert.equal(await B.runState(page), 'running');
  await page.waitForTimeout(700);
  assert.ok(await candidates(page) > c1, 'continues after resume');
  await page.click('#stop-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'aborted']), 'finished');
  assert.match(await page.textContent('#result-line'), /Stopped: stopped by user/);
  assert.match(await page.textContent('#stats-summary'), /stopped/);
  assert.notEqual((await page.$$eval('#solver-table tbody tr', (r) => r[0].cells[9].textContent)), '–', 'final clasp statistics');
  assert.deepEqual(errors, []);
  await context.close();
});

test('threads: a solver with -t 2 gives 9,270 on reference row 2', async () => {
  const { page, context, errors } = await B.openPage(browser, coiServer, '?nocoi=1&file=graph-coloring-original&tab=4', { coi: true });
  const loop = await B.getEditor(page, 'loop-editor');
  await B.setEditor(page, 'loop-editor', loop.replace('solver A = shared + abstraction', 'solver A = shared + abstraction options "-t 2"'));
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['error', 'finished']), 'error', '-t needs the threaded engine');
  assert.match(await page.textContent('#messages'), /needs the threaded engine/);
  await page.check('#threads-checkbox');
  await page.waitForFunction(() => window.cegarplay.engine.threads === true);
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error'], 120000), 'finished');
  assert.match(await page.textContent('#live-line'), /9,270 solutions/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('abort works on the isolated page too', async () => {
  const { page, context } = await B.openPage(browser, coiServer, '?nocoi=1&example=graph-coloring', { coi: true });
  await setN7(page);
  await page.click('#run-button');
  await B.waitState(page, ['running']);
  await page.waitForTimeout(500);
  await page.click('#pause-button');
  await page.click('#abort-button');
  assert.equal(await B.waitState(page, ['aborted']), 'aborted');
  await page.evaluate(() => { window.cegarplay.project.settings.constants.n = '6'; window.cegarplay.project.settings.solutions = 1; });
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  await context.close();
});
