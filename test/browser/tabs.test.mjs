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

test('errors and controls: an unfinished last rule is marked, problems listed under the editor, Output after a failed start, the template list, record-and-run, the view slider', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=3');
  const anns = () => page.evaluate(() => ace.edit(document.getElementById('editor-check')).session.getAnnotations());
  // "unexpected EOF": past the text, put on its last line with text (line 1 of 2 here), as the message says
  await B.setEditor(page, 'editor-check', '1 { sum(X,Y) : num(X)\n');
  await page.waitForFunction(() => ace.edit(document.getElementById('editor-check')).session.getAnnotations().length > 0, null, { timeout: 5000 });
  assert.equal((await anns())[0].row, 0);
  await page.waitForSelector('#editor-check + .editor-problems li');
  assert.match(await page.textContent('#editor-check + .editor-problems'), /^line 1: syntax error, unexpected EOF/);
  // an unsafe variable: the short form in the list and first in the tooltip, clingo's text folded
  await B.setEditor(page, 'editor-check', ':- sum(X,Y), not pick(Z).\n');
  await page.waitForFunction(() => /unsafe variable Z/.test(document.querySelector('#editor-check + .editor-problems')?.textContent || ''), null, { timeout: 5000 });
  assert.match((await anns())[0].text, /^unsafe variable Z \(every variable/);
  assert.equal(await page.isVisible('#editor-check + .editor-problems details pre'), false);
  // a click on "line 1" puts the cursor there
  await page.click('#editor-check + .editor-problems .problem-line');
  assert.equal(await page.evaluate(() => ace.edit(document.getElementById('editor-check')).getCursorPosition().row), 0);
  // a run that does not start: Output has the messages only
  await page.click('#run-button');
  await B.waitState(page, ['error']);
  await B.openTab(page, 5);
  assert.match(await page.textContent('#result-line'), /^Not started/);
  assert.equal(await page.isVisible('#output-solutions'), false);
  assert.equal(await page.isVisible('#output-trace'), false);
  assert.equal(await page.isVisible('#output-messages'), true);
  // fixed: the list goes
  await B.setEditor(page, 'editor-check', ':- sum(X,Y), not pick(X).\n1 { sum(X,Y) : num(X), num(Y) } 1.\n');
  await page.waitForFunction(() => document.querySelector('#editor-check + .editor-problems')?.hidden !== false, null, { timeout: 5000 });
  // Loop: no template claimed at first; Use template asks before replacing an edited script
  await B.openTab(page, 4);
  assert.equal(await page.$eval('#template-select', (s) => s.value), '');
  assert.equal(await page.$eval('#insert-template-button', (b) => b.disabled), true);
  await B.setEditor(page, 'loop-editor', (await B.getEditor(page, 'loop-editor')).replace('reject M with G.clause(M, X)', 'reject M with G.clause(M, X)   # my note'));
  await page.selectOption('#template-select', 'shape2');
  let asked = null;
  page.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await page.click('#insert-template-button');
  assert.match(asked, /Replace the statements of the loop script with the template "Shape 2/);
  assert.match(await B.getEditor(page, 'loop-editor'), /# my note/, 'kept when dismissed');
  // Observatory: without recorded calls, one button records them and runs; the view slider only with a view
  await B.openTab(page, 11);
  assert.equal(await page.isVisible('#view-steps-bar'), true, 'this project has a view');
  await page.click('#anatomy-record-run');
  await B.waitState(page, ['finished']);
  assert.equal(await page.isChecked('#anatomy-calls'), true);
  await page.waitForFunction(() => /\d+ calls?, /.test(document.getElementById('anatomy-note').textContent));
  page.once('dialog', (d) => d.accept());      // (the project was edited)
  await page.evaluate(() => window.cegarplay.loadExample('gc-shape2'));
  await page.waitForFunction(() => window.cegarplay.project.title === 'Graph colouring, Shape 2');
  assert.equal(await page.isVisible('#view-steps-bar'), false, 'no view, no slider');
  assert.deepEqual(errors, []);
  await context.close();
});

test('more consistency: variant templates, Campaign names and legends, the shown line while running, Aborted with counts, one snapshot empty line, no empty live row', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=gc-shape2&tab=4');
  // a variant's template list claims no shape; Use template waits for a pick
  await page.waitForSelector('.variant-template');
  assert.equal(await page.$eval('.variant-template', (s) => s.value), '');
  assert.equal(await page.$eval('.variant-insert-template', (b) => b.disabled), true);
  await page.selectOption('.variant-template >> nth=0', 'shape2');
  assert.equal(await page.$eval('.variant-insert-template', (b) => b.disabled), false);
  // the workspace dialog says once that there is no snapshot
  await B.openDialog(page, 'versions');
  assert.equal((await page.textContent('#dialog-versions')).match(/No snapshots? of this project yet/g).length, 1);
  await B.closeDialog(page, 'versions');
  // a long run: the shown line has no trace part while it runs; Abort says how far it got
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => window.cegarplay.loadExample('graph-coloring'));
  await page.waitForFunction(() => window.cegarplay.project.title === 'Graph colouring');
  await page.click('#run-button');
  await page.waitForFunction(() => /\d+ solutions/.test(document.getElementById('live-line').textContent), null, { timeout: 30000 });
  assert.doesNotMatch(await page.textContent('#shown-line'), /no steps recorded|trace of/);
  await page.click('#abort-button');
  await B.waitState(page, ['aborted']);
  await B.openTab(page, 5);
  assert.match(await page.textContent('#result-line'), /^Aborted after \d+\.\d s: [\d,]+ solutions? so far\./);
  assert.deepEqual(errors, []);
  await context.close();
  // a first run that does not start: no empty row for the live counts (after a run they stay: still shown)
  const f = await B.openPage(browser, server, '?example=tutorial-first-run&tab=3');
  await B.setEditor(f.page, 'editor-check', 'a :- b\n');
  await f.page.click('#run-button');
  await B.waitState(f.page, ['error']);
  assert.equal(await f.page.isVisible('#live-line'), false);
  await f.context.close();
  // Campaign: the plain project is "(no variant)" everywhere; the legend sits above the plotting area
  const c = await B.openPage(browser, server, '?example=tutorial-weak-relevant&tab=10');
  await c.page.click('#campaign-start');
  await c.page.waitForSelector('#campaign-summary tr[data-variant="default"]', { timeout: 60000 });
  await c.page.waitForFunction(() => /cells:/.test(document.getElementById('campaign-status').textContent), null, { timeout: 60000 });
  assert.equal(await c.page.textContent('#campaign-summary tr[data-variant="default"] td'), '(no variant)');
  const [rectBottom, axisTop] = await c.page.$eval('#plot-solved svg', (s) => [Math.max(...[...s.querySelectorAll('rect')].map((r) => Number(r.getAttribute('y')) + 10)), Number(s.querySelectorAll('line')[1].getAttribute('y1'))]);
  assert.ok(rectBottom <= axisTop, `legend ${rectBottom} above the plotting area ${axisTop}`);
  assert.deepEqual(c.errors, []);
  await c.context.close();
});
