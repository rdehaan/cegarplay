// Keyboard shortcuts (js/keys.js): the trace's step keys, the tab keys, the shortcuts dialog,
// and the keys that belong to an editor or a field.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const label = (page) => page.textContent('#trace-label');
const shownTab = (page) => page.$eval('input[name="tabs"]:checked', (r) => r.id);

test('arrow keys, Shift, Home and End step through the trace in the Output tab', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=graph-coloring&tab=5');
  await page.click('#run-button');
  await B.waitState(page, ['finished']);
  await page.click('#trace-label');                      // the focus on the page, not on a control
  assert.equal(await label(page), 'traced step 1 of 200');
  await page.keyboard.press('ArrowRight');
  assert.equal(await label(page), 'traced step 2 of 200');
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await label(page), 'traced step 12 of 200');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await label(page), 'traced step 11 of 200');
  await page.keyboard.press('End');
  assert.equal(await label(page), 'traced step 200 of 200');
  await page.keyboard.press('ArrowRight');
  assert.equal(await label(page), 'traced step 200 of 200');
  await page.keyboard.press('Home');
  assert.equal(await label(page), 'traced step 1 of 200');
  // the slider keeps its own arrow keys (one step, no double move)
  await page.focus('#trace-slider');
  await page.keyboard.press('ArrowRight');
  assert.equal(await label(page), 'traced step 2 of 200');
  assert.match(await page.getAttribute('#trace-next', 'title'), /→/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('digits open the tabs shown; ? opens the shortcuts; editors and fields keep their keys', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=1');
  await page.click('.home-intro');
  await page.keyboard.press('2');
  assert.equal(await shownTab(page), 'tab3');
  await page.keyboard.press('5');
  assert.equal(await shownTab(page), 'tab5');
  // in an editor a digit is typed, not a tab switch
  await page.keyboard.press('2');
  await page.click('#editor-abstraction');
  assert.equal(await shownTab(page), 'tab3');
  const before = await B.getEditor(page, 'editor-abstraction');
  await page.keyboard.press('End');
  await page.keyboard.press('5');
  assert.equal(await shownTab(page), 'tab3');
  assert.notEqual(await B.getEditor(page, 'editor-abstraction'), before);
  // ? opens the dialog, with the tabs numbered as the digits open them
  await page.click('.tab-bar');
  await page.keyboard.press('?');
  assert.equal(await page.$eval('#dialog-keys', (d) => d.open), true);
  const tabs = await page.$$eval('#keys-tabs li', (l) => l.map((x) => x.textContent));
  assert.equal(tabs[0], '1 Home');
  assert.equal(tabs[1], '2 Programs');
  // a digit inside the dialog does nothing; Escape closes it
  await page.keyboard.press('1');
  assert.equal(await shownTab(page), 'tab3');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#dialog-keys', (d) => d.open), false);
  // the footer link opens it too
  await page.click('.page-footer [data-shortcuts]');
  assert.equal(await page.$eval('#dialog-keys', (d) => d.open), true);
  assert.deepEqual(errors, []);
  await context.close();
});
