// The guided tour (js/tour.js), the toast that goes by itself, and the "?" of the fragments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const title = (page) => page.textContent('#tour-title');
const next = (page) => page.click('#tour-card .tour-next');
const doIt = (page) => page.click('#tour-card .tour-do-it');
const shownTab = (page) => page.$eval('input[name="tabs"]:checked', (r) => r.id);

test('the tour is offered on a first visit, runs through the basics, and is not offered again', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '', { tour: true });
  assert.equal(await title(page), 'Welcome to CegarPlay');
  await next(page);
  await page.waitForFunction(() => document.getElementById('tour-title').textContent === 'The project');
  assert.equal(await page.textContent('#project-heading'), 'Sum-free sets');
  assert.equal(await page.$eval('.project-box', (e) => e.classList.contains('tour-target')), true);
  await next(page);
  // a step that waits: Next is disabled until the tab is opened (by the user, here)
  assert.equal(await title(page), 'The programs');
  assert.equal(await page.isDisabled('#tour-card .tour-next'), true);
  await page.click('label[for="tab3"]');
  await page.waitForFunction(() => document.getElementById('tour-title').textContent === 'Fragments');
  await next(page);
  await doIt(page);                                           // opens the Loop tab
  await page.waitForFunction(() => document.getElementById('tour-title').textContent === 'The loop script');
  assert.equal(await shownTab(page), 'tab4');
  await next(page);
  assert.equal(await title(page), 'Run it');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('#tour-card .tour-after');
  assert.match(await page.textContent('#tour-card .tour-after'), /61 solutions/);
  await next(page);
  await page.click('label[for="tab5"]');
  await page.waitForFunction(() => document.getElementById('tour-title').textContent === 'Step through the trace');
  await page.click('#trace-label');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('#tour-card .tour-after');
  assert.equal(await page.textContent('#trace-label'), 'traced step 2 of 46');
  await next(page);
  await doIt(page);                                           // Statistics
  await page.waitForSelector('#tour-card .tour-next:not([disabled])');
  await next(page);
  assert.equal(await title(page), 'Is the loop right? The audit');
  await doIt(page);
  await page.waitForSelector('#tour-card .tour-after', { timeout: 60000 });
  await next(page);
  await next(page);
  assert.equal(await title(page), 'Where next');
  await next(page);
  assert.equal(await page.$('#tour-card'), null);
  assert.equal(await page.$$eval('.tour-target', (l) => l.length), 0);
  assert.match(await page.evaluate(() => localStorage.getItem('cegarplay.tour')), /finished/);
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.$('#tour-card'), null, 'not offered again');
  // ... but on Home and in Settings
  await page.click('label[for="tab1"]');
  await page.click('.home-intro [data-tour]');
  assert.equal(await title(page), 'Welcome to CegarPlay');
  await page.click('#tour-card .tour-skip');
  assert.equal(await page.$('#tour-card'), null);
  await B.openDialog(page, 'settings');
  await page.click('#dialog-settings [data-tour]');
  assert.equal(await page.$eval('#dialog-settings', (d) => d.open), false);
  assert.equal(await title(page), 'Welcome to CegarPlay');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the tour keeps an edited project as a snapshot; a link with a query does not offer it', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=4', { tour: true });
  assert.equal(await page.$('#tour-card'), null, 'a link with a query: no tour');
  await B.setEditor(page, 'loop-editor', '# mine\n' + await B.getEditor(page, 'loop-editor'));
  await page.goto(server.url + 'index.html?nocoi=1&tour=1');
  await page.waitForSelector('body[data-ready="true"]');
  assert.match(await page.textContent('#tour-card .tour-body'), /kept as a snapshot/);
  await next(page);
  await page.waitForFunction(() => document.getElementById('tour-title').textContent === 'The project');
  assert.doesNotMatch(await B.getEditor(page, 'loop-editor'), /# mine/);
  const snaps = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cegarplay.snap')).map((k) => localStorage.getItem(k)).join('\n'));
  assert.match(snaps, /before the guided tour/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the toast goes by itself after 5 s, not while the pointer is on it; the fragments\' "?" has the tabs\' style', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=1');
  // (whichever status line feeds the toast)
  const src = await page.evaluate(() => [...document.querySelectorAll('.toast-source')].map((e) => e.id));
  await page.evaluate((id) => { document.getElementById(id).textContent = 'Something happened.'; }, src[0]);
  await page.waitForSelector('#toast:not([hidden])');
  await page.hover('#toast');
  await page.waitForTimeout(5600);
  assert.equal(await page.isVisible('#toast'), true, 'held while the pointer is on it');
  await page.mouse.move(5, 300);
  await page.waitForSelector('#toast', { state: 'hidden', timeout: 7000 });
  // the "?" of a fragment: the same size and shape as a tab's "?"
  await page.click('label[for="tab3"]');
  const q = await page.$eval('a.modal-link[data-open="modal-abstraction"]', (a) => [a.textContent, getComputedStyle(a).borderRadius, a.getBoundingClientRect().width]);
  assert.deepEqual(q.slice(0, 2), ['?', '50%']);
  assert.equal(Math.round(q[2]), 20);
  assert.deepEqual(errors, []);
  await context.close();
});
