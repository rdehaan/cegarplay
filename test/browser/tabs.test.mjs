// Every tab is shown (nothing to switch on or off since 2026-11-27); the old stored choices are
// forgotten; the group tabs and their sub-tabs; the tab bar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const OLD_KEYS = ['cegarplay.manual', 'cegarplay.campaign', 'cegarplay.observatory', 'cegarplay.tutorial', 'cegarplay.lab'];

test('every tab is shown, also after an old "off" choice, which is forgotten; no tab toggles remain', async () => {
  const context = await browser.newContext();
  // a browser that hid every tab it could, before 2026-11-27
  await context.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cegarplay.tutorial', '0');
    for (const k of ['manual', 'campaign', 'observatory', 'lab']) localStorage.setItem(`cegarplay.${k}`, '0');
  });
  const { page, errors } = await B.openPage(browser, server, '?fresh=1', { context });
  for (const id of ['tab2', 'tab3', 'tab4', 'tab5', 'tab6', 'tab8', 'tab9', 'tab10', 'tab11', 'tab12']) {
    assert.equal(await page.$eval(`label[for="${id}"]`, (l) => l.hidden), false, id);
    assert.equal(await page.$eval(`#${id}`, (r) => r.hidden), false, id);
  }
  assert.equal(await page.$eval('label[for="tab7"]', (l) => l.hidden), true, 'Internals only with ?internals=true');
  for (const g of ['results', 'analyse', 'learn']) assert.equal(await page.isVisible(`#group-${g}`), true, g);
  for (const k of OLD_KEYS) assert.equal(await stored(page, k), null, `${k} forgotten`);
  assert.equal(await page.$$eval('.manual-checkbox, .tutorial-checkbox, .campaign-checkbox, .observatory-checkbox, .lab-checkbox, .advanced-checkbox, .home-more', (l) => l.length), 0, 'no tab toggles');
  assert.equal(await page.$$eval('#dialog-settings h3', (l) => l.map((h) => h.textContent).includes('Tabs')), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the Manual is fetched when its tab first opens, not at start-up', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1');
  const fetched = () => page.evaluate(() => performance.getEntriesByType('resource').some((r) => /\/manual\.md$/.test(r.name)));
  assert.equal(await fetched(), false, 'not at start-up');
  await B.openTab(page, 8);
  await page.waitForSelector('#manual h2');
  assert.equal(await fetched(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('group tabs: Results opens Output, then the sub-tab last used; Analyse says what its open sub-tab is for', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run');
  const checked = () => page.$eval('input[name="tabs"]:checked', (r) => r.id);
  assert.equal(await page.isVisible('#subtabs-results'), false);
  await page.click('#group-results');
  assert.equal(await checked(), 'tab5');
  assert.equal(await page.isVisible('#subtabs-results'), true);
  await page.click('label[for="tab6"]');
  assert.equal(await checked(), 'tab6');
  await page.click('label[for="tab1"]');
  assert.equal(await page.isVisible('#subtabs-results'), false);
  await page.click('#group-results');
  assert.equal(await checked(), 'tab6', 'the sub-tab last used');
  await page.click('#group-analyse');
  assert.equal(await checked(), 'tab11');
  const notes = () => page.$$eval('.sub-tab-note', (l) => l.filter((n) => n.offsetParent !== null).map((n) => n.dataset.for));
  assert.deepEqual(await notes(), ['tab11']);
  await page.click('label[for="tab10"]');
  assert.deepEqual(await notes(), ['tab10']);
  await page.click('label[for="tab12"]');
  assert.deepEqual(await notes(), ['tab12']);
  // the digits number the tab row: 5 is Results, 6 Analyse, 7 Learn
  await page.click('label[for="tab1"]');
  await page.click('.home-intro');
  await page.keyboard.press('7');
  assert.equal(await checked(), 'tab2');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the tab bar: grouped, sticky under the top bar on a large screen; a tab chosen there opens at its top', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=5', { contextOptions: { viewport: { width: 1400, height: 900 } } });
  assert.deepEqual(await page.$$eval('#tab-bar .tab-group', (g) => g.map((x) => x.textContent)), ['Write', 'Read']);
  assert.deepEqual(await page.$$eval('#tab-bar .group-tab:not([hidden])', (g) => g.map((x) => x.textContent.trim())), ['Results', 'Analyse', 'Learn']);
  await page.click('#run-button');
  await page.waitForFunction(() => document.getElementById('run-status').dataset.state === 'finished');
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(() => document.getElementById('tab-bar').classList.contains('stuck'));
  const top = await page.evaluate(() => [document.getElementById('tab-bar').getBoundingClientRect().top,
    document.getElementById('topbar').offsetHeight + document.querySelector('.run-summary').offsetHeight]);
  assert.ok(Math.abs(top[0] - top[1]) <= 1, `the tab bar sits under the top bar and the run summary: ${top}`);
  // the run summary ("Shown: ...") sticks under the top bar
  const sum = await page.evaluate(() => [document.querySelector('.run-summary').getBoundingClientRect().top, document.getElementById('topbar').offsetHeight]);
  assert.ok(Math.abs(sum[0] - sum[1]) <= 1, `the run summary sits under the top bar: ${sum}`);
  // a click on Statistics (by position: a locator click would scroll first)
  const bb = await (await page.$('label[for="tab6"]')).boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForFunction(() => document.getElementById('tab6').checked && document.querySelector('main').style.minHeight === '');
  const rest = await page.evaluate(() => document.getElementById('tab-bar-anchor').getBoundingClientRect().top - document.querySelector('.run-summary').getBoundingClientRect().bottom);
  assert.ok(Math.abs(rest) <= 2, `Statistics opens at its top, the tab bar at its place (${rest})`);
  // a narrow screen: the tab bar scrolls with the page
  await page.setViewportSize({ width: 900, height: 900 });
  assert.equal(await page.$eval('#tab-bar', (t) => getComputedStyle(t).position), 'static');
  // ... while the run summary still sticks under the top bar, and says which run is shown
  await page.mouse.wheel(0, 800);
  await page.waitForFunction(() => Math.abs(document.querySelector('.run-summary').getBoundingClientRect().top - document.getElementById('topbar').offsetHeight) <= 1);
  assert.match(await page.textContent('#shown-line'), /^Shown: the run/);
  assert.equal(await page.isVisible('#shown-line'), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('each tab\'s help: folded by default, and open once it is opened (remembered)', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1&tab=4');
  assert.equal(await page.isVisible('#section-loop .tab-intro'), false, 'folded on the first visit');
  await page.click('#section-loop .help-fold > summary');
  assert.equal(await page.isVisible('#section-loop .tab-intro'), true);
  // stored in the toggle event, which comes just after the click
  await page.waitForFunction(() => /section-loop/.test(localStorage.getItem('cegarplay.help-open') || ''));
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.isVisible('#section-loop .tab-intro'), true, 'stays open');
  await page.click('label[for="tab3"]');
  assert.equal(await page.isVisible('#section-programs .tab-intro'), false, 'another tab: still folded');
  await page.click('label[for="tab4"]');
  await page.click('#section-loop .help-fold > summary');
  assert.equal(await page.isVisible('#section-loop .tab-intro'), false, 'the "?" folds it again');
  await page.waitForFunction(() => !/section-loop/.test(localStorage.getItem('cegarplay.help-open') || ''));
  assert.deepEqual(errors, []);
  await context.close();
});

test('empty states and folds: ready, Output before a run, Instances parts, the Observatory exports, Campaign row buttons, Tutorial and Manual help', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run');
  assert.equal(await page.textContent('#run-status'), 'ready');
  // Output: one line, no empty sections, no Clear
  await B.openTab(page, 5);
  assert.match(await page.textContent('#result-line'), /^No run yet\. Press Run \(Ctrl\+Enter\) or Audit/);
  assert.equal(await page.isVisible('#output-body'), false);
  assert.equal(await page.isVisible('#clear-button'), false);
  // Instances: Generators and Spaces folded, each with a one-line summary; opening is kept
  await B.openTab(page, 9);
  assert.equal(await page.$eval('#generators-part', (d) => d.open), false);
  assert.equal(await page.$eval('#spaces-part', (d) => d.open), false);
  assert.match(await page.textContent('#generators-summary'), /^none: a generator writes random instances/);
  assert.match(await page.textContent('#spaces-summary'), /^n \(The numbers 1\.\.n/);
  await page.click('#spaces-part > summary');
  assert.equal(await page.isVisible('#space-editor .ace_content'), true);
  assert.ok(await page.$eval('#space-editor', (e) => e.getBoundingClientRect().height) > 30, 'the editor has its height once opened');
  assert.equal(await page.evaluate(() => localStorage.getItem('cegarplay.instances-open')), '["spaces"]');
  // Observatory: the exports are folded under the cursor bar
  await B.openTab(page, 11);
  assert.equal(await page.isVisible('#cursor-step'), true);
  assert.equal(await page.isVisible('#export-view'), false);
  await page.click('#observatory-export > summary');
  assert.equal(await page.isVisible('#export-view'), true);
  // Campaign: nothing to export or forget without rows
  await B.openTab(page, 10);
  for (const id of ['campaign-export', 'campaign-export-csv', 'campaign-clear']) assert.equal(await page.$eval(`#${id}`, (b) => b.disabled), true, id);
  assert.equal(await page.$eval('#campaign-import', (b) => b.disabled), false);
  // Tutorial and Manual start like the other tabs: a name and a folded help
  for (const n of [2, 8]) {
    await B.openTab(page, n);
    assert.equal(await page.isVisible(`#section-${n === 2 ? 'tutorial' : 'manual'} > details.help-fold > summary`), true);
  }
  // after a run: the Output sections show and Clear is offered
  await page.click('#run-button');
  await B.waitState(page, ['finished']);
  await B.openTab(page, 5);
  assert.equal(await page.isVisible('#output-body'), true);
  assert.equal(await page.isVisible('#clear-button'), true);
  assert.deepEqual(errors, []);
  await context.close();
});
