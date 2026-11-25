// Which tabs show: the Advanced tabs (Campaign, Observatory, Lab) and the Tutorial toggle, all kept in
// this browser; links that open such a tab show it for the visit without storing anything.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const shown = (page, id) => page.$eval(`label[for="${id}"]`, (l) => !l.hidden);
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

test('the Advanced tabs are off by default; each has a toggle, the Advanced toggle sets all three; remembered', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1', { advanced: false });
  assert.equal(await shown(page, 'tab11'), false);
  assert.equal(await shown(page, 'tab10'), false);
  assert.equal(await shown(page, 'tab12'), false);
  assert.equal(await shown(page, 'tab2'), true);
  const box = () => page.$eval('#dialog-settings .advanced-checkbox', (c) => ({ checked: c.checked, mixed: c.indeterminate }));
  assert.deepEqual(await box(), { checked: false, mixed: false });
  // one of them: the Advanced toggle shows "some"
  await B.inDialog(page, 'settings', () => page.check('#dialog-settings .observatory-checkbox'));
  assert.equal(await shown(page, 'tab11'), true);
  assert.equal(await shown(page, 'tab10'), false);
  assert.equal(await stored(page, 'cegarplay.observatory'), '1');
  assert.equal(await stored(page, 'cegarplay.campaign'), null);
  assert.deepEqual(await box(), { checked: false, mixed: true });
  // the Tutorial tab's copy of the Observatory checkbox follows
  assert.equal(await page.$eval('#section-tutorial .observatory-checkbox', (c) => c.checked), true);
  // the Advanced toggle: all three
  await B.inDialog(page, 'settings', () => page.check('#dialog-settings .advanced-checkbox'));
  for (const id of ['tab10', 'tab11', 'tab12']) assert.equal(await shown(page, id), true, id);
  assert.deepEqual(await box(), { checked: true, mixed: false });
  for (const k of ['campaign', 'observatory', 'lab']) assert.equal(await stored(page, `cegarplay.${k}`), '1', k);
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await shown(page, 'tab11'), true, 'remembered after a reload');
  assert.equal(await shown(page, 'tab10'), true, 'remembered after a reload');
  // switching the Observatory off while on it goes back to the Control tab
  await page.click('label[for="tab11"]');
  await page.click('label[for="tab1"]');
  await page.click('label[for="tab11"]');
  await page.evaluate(() => { const c = document.querySelector('#dialog-settings .observatory-checkbox'); c.checked = false; c.dispatchEvent(new Event('change')); });
  assert.equal(await shown(page, 'tab11'), false);
  assert.equal(await shown(page, 'tab10'), true);
  assert.equal(await page.$eval('#tab1', (r) => r.checked), true);
  assert.equal(await stored(page, 'cegarplay.observatory'), null);
  // the Advanced toggle off: all three
  await page.evaluate(() => { const c = document.querySelector('#dialog-settings .advanced-checkbox'); c.checked = false; c.dispatchEvent(new Event('change')); });
  for (const id of ['tab10', 'tab11', 'tab12']) assert.equal(await shown(page, id), false, id);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter((k) => /^cegarplay\.(advanced|campaign|observatory|lab)$/.test(k))), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('an older stored Advanced mode shows Campaign and Observatory, and moves to the new keys on a change', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1', { advanced: false });
  await page.evaluate(() => localStorage.setItem('cegarplay.advanced', '1'));
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await shown(page, 'tab11'), true);
  assert.equal(await shown(page, 'tab10'), true);
  assert.equal(await shown(page, 'tab12'), false);
  await B.inDialog(page, 'settings', () => page.uncheck('#dialog-settings .campaign-checkbox'));
  assert.equal(await stored(page, 'cegarplay.advanced'), null);
  assert.equal(await stored(page, 'cegarplay.observatory'), '1');
  assert.equal(await stored(page, 'cegarplay.campaign'), null);
  assert.equal(await shown(page, 'tab11'), true);
  assert.equal(await shown(page, 'tab10'), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a link to the Observatory shows it for the visit only', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1&tab=11', { advanced: false });
  assert.equal(await shown(page, 'tab11'), true);
  assert.equal(await page.$eval('#tab11', (r) => r.checked), true);
  assert.equal(await stored(page, 'cegarplay.observatory'), null, 'nothing stored');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the Tutorial can be hidden and comes back; a lesson link shows it for the visit', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1', { advanced: false });
  await B.inDialog(page, 'settings', () => page.uncheck('#dialog-settings .tutorial-checkbox'));
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
  assert.equal(await page.$eval('#dialog-settings .tutorial-checkbox', (c) => c.checked), true);
  await B.inDialog(page, 'settings', () => page.uncheck('#dialog-settings .tutorial-checkbox'));
  await B.inDialog(page, 'settings', () => page.check('#dialog-settings .tutorial-checkbox'));
  assert.equal(await stored(page, 'cegarplay.tutorial'), null);
  assert.deepEqual(errors, []);
  await context.close();
});
