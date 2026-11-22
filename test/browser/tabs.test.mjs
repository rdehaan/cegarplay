// Which tabs show: Advanced mode (Observatory, Campaign) and the Tutorial toggle, both kept in
// this browser; links that open such a tab show it for the visit without storing anything.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const shown = (page, id) => page.$eval(`label[for="${id}"]`, (l) => !l.hidden);
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

test('Advanced mode is off by default; the toggle shows Observatory and Campaign and is remembered', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1', { advanced: false });
  assert.equal(await shown(page, 'tab11'), false);
  assert.equal(await shown(page, 'tab10'), false);
  assert.equal(await shown(page, 'tab2'), true);
  await page.check('#section-control .advanced-checkbox');
  assert.equal(await shown(page, 'tab11'), true);
  assert.equal(await shown(page, 'tab10'), true);
  assert.equal(await stored(page, 'cegarplay.advanced'), '1');
  // the Tutorial tab's copy of the checkbox follows
  assert.equal(await page.$eval('#section-tutorial .advanced-checkbox', (c) => c.checked), true);
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await shown(page, 'tab11'), true, 'remembered after a reload');
  // switching it off while on the Observatory goes back to the Control tab
  await page.click('label[for="tab11"]');
  await page.click('label[for="tab1"]');
  await page.click('label[for="tab11"]');
  await page.evaluate(() => { const c = document.querySelector('#section-control .advanced-checkbox'); c.checked = false; c.dispatchEvent(new Event('change')); });
  assert.equal(await shown(page, 'tab11'), false);
  assert.equal(await page.$eval('#tab1', (r) => r.checked), true);
  assert.equal(await stored(page, 'cegarplay.advanced'), null);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a link to the Observatory shows it for the visit only', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1&tab=11', { advanced: false });
  assert.equal(await shown(page, 'tab11'), true);
  assert.equal(await page.$eval('#tab11', (r) => r.checked), true);
  assert.equal(await stored(page, 'cegarplay.advanced'), null, 'nothing stored');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the Tutorial can be hidden and comes back; a lesson link shows it for the visit', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1', { advanced: false });
  await page.uncheck('#section-control .tutorial-checkbox');
  assert.equal(await shown(page, 'tab2'), false);
  assert.equal(await stored(page, 'cegarplay.tutorial'), '0');
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await shown(page, 'tab2'), false, 'remembered after a reload');
  // the Programs tab's opening line links to a lesson: the Tutorial opens at it, nothing stored
  await page.click('label[for="tab3"]');
  await page.click('#section-programs .tab-help a[href="#tut-fragments"]');
  await page.waitForFunction(() => document.getElementById('tab2').checked);
  assert.equal(await shown(page, 'tab2'), true);
  assert.equal(await stored(page, 'cegarplay.tutorial'), '0');
  // the checkboxes show what is visible; ticking again stores "shown"
  await page.click('label[for="tab1"]');
  assert.equal(await page.$eval('#section-control .tutorial-checkbox', (c) => c.checked), true);
  await page.uncheck('#section-control .tutorial-checkbox');
  await page.check('#section-control .tutorial-checkbox');
  assert.equal(await stored(page, 'cegarplay.tutorial'), null);
  assert.deepEqual(errors, []);
  await context.close();
});
