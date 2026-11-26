// The editors' help in the page: warnings and tooltips in the Programs tab, autocompletion,
// compiler errors with a fix, the run in words, the results' tooltips, the tabs' short tours.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const visiblePopup = (page) => page.$$eval('.ace_autocomplete', (l) => l.filter((x) => x.style.display !== 'none').map((x) => [...x.querySelectorAll('.ace_line')].map((y) => y.textContent))[0] || []);
const point = (page, id, row, word) => page.evaluate(([i, r, w]) => {
  const e = ace.edit(i);
  e.container.scrollIntoView({ block: 'center' });
  return new Promise((ok) => setTimeout(() => {           // (after the scroll: it hides a tooltip)
    const c = e.renderer.textToScreenCoordinates(r, e.session.getLine(r).indexOf(w) + 1);
    ok([c.pageX + 3, c.pageY + 6]);
  }, 300));
}, [id, row, word]);

test('a typo in a fragment: a warning marker and a tooltip that suggests the fix', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=3');
  await page.evaluate(() => { const e = ace.edit('editor-check'); e.setValue(e.getValue().replace('relevant(pick(X)) :- sum(X,Y).', 'relevant(pick(X)) :- summ(X,Y).'), -1); });
  await page.waitForFunction(() => ace.edit('editor-check').session.getAnnotations().some((a) => /did you mean sum\/2/.test(a.text)));
  // a warning, not an error: the tab keeps no red marker
  assert.equal(await page.$eval('#label-programs', (e) => e.classList.contains('has-problem')), false);
  const [x, y] = await point(page, 'editor-check', 9, 'summ');
  await page.mouse.move(x, y);
  await page.waitForSelector('#loop-tip:not([hidden])');
  assert.equal(await page.textContent('#loop-tip .loop-tip-title'), 'summ/2');
  assert.match(await page.textContent('#loop-tip .loop-tip-warn'), /did you mean sum\/2\?/);
  // fixed: the warning goes
  await page.evaluate(() => { const e = ace.edit('editor-check'); e.setValue(e.getValue().replace('summ(', 'sum('), -1); });
  await page.waitForFunction(() => !ace.edit('editor-check').session.getAnnotations().length);
  // the glue's tooltip names the link
  const [gx, gy] = await point(page, 'editor-glue', 2, 'glue');
  await page.mouse.move(gx, gy);
  await page.waitForFunction(() => document.querySelector('#loop-tip .loop-tip-title')?.textContent === 'glue(pick(X))');
  assert.match(await page.textContent('#loop-tip'), /interface atom of link G \(A → C\)/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('autocompletion: a link\'s members after the dot, predicates in a fragment', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=4');
  await page.evaluate(() => { const e = ace.edit('loop-editor'); e.focus(); e.navigateFileEnd(); });
  await page.keyboard.type('\n        G.');
  await page.waitForFunction(() => [...document.querySelectorAll('.ace_autocomplete')].some((x) => x.style.display !== 'none'));
  const items = await visiblePopup(page);
  assert.ok(items.some((t) => t.startsWith('clause')) && items.every((t) => /link G$/.test(t)), items.join(' | '));
  await page.keyboard.type('blo', { delay: 60 });       // (a person's pace: the list filters as one types)
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  assert.match(await page.evaluate(() => ace.edit('loop-editor').session.getLine(ace.edit('loop-editor').getCursorPosition().row)), /G\.block$/);
  await page.keyboard.press('Escape');
  await page.click('label[for="tab3"]');
  await page.evaluate(() => { const e = ace.edit('editor-check'); e.focus(); e.navigateFileEnd(); });
  await page.keyboard.type('\nfoo :- rel', { delay: 60 });
  await page.waitForFunction(() => [...document.querySelectorAll('.ace_autocomplete')].some((x) => x.style.display !== 'none' && /relevant\/1/.test(x.textContent)));
  await page.keyboard.press('Enter');
  assert.match(await page.evaluate(() => ace.edit('editor-check').session.getLine(ace.edit('editor-check').getCursorPosition().row)), /foo :- relevant\($/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a compiler error: the hint line says what to do and links the manual', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=4');
  await page.evaluate(() => { const e = ace.edit('loop-editor'); e.setValue(e.getValue().replace('if X:', 'if Y:'), -1); e.focus(); e.gotoLine(8, 10); });
  await page.waitForFunction(() => document.getElementById('loop-hint').classList.contains('error'));
  assert.match(await page.textContent('#loop-hint'), /^Line 8: unknown name 'Y'\. Assign Y before this line/);
  assert.match(await page.evaluate(() => ace.edit('loop-editor').session.getAnnotations()[0].text), /\nWhat to do: Assign Y/);
  await page.click('#loop-hint a');
  await page.waitForFunction(() => document.getElementById('tab8').checked);
  assert.deepEqual(errors, []);
  await context.close();
});

test('after a run: the run in words, tooltips on the trace and the statistics', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=5');
  await page.click('#run-button');
  await B.waitState(page, ['finished']);
  assert.match(await page.textContent('#run-story'), /^Solver A proposed 107 candidates\. The check \(solver C\) refuted 46 of them/);
  assert.match(await page.getAttribute('#trace-candidate .atom.hl', 'title'), /occurs in the refinement/);
  assert.match(await page.getAttribute('#trace-refinement .atom', 'title'), /^The refinement clause: /);
  await page.click('label[for="tab6"]');
  assert.match(await page.getAttribute('#solver-table th:has-text("Sat")', 'title'), /For a check: the counterexamples found/);
  // a new run clears it until it ends
  await page.click('label[for="tab5"]');
  await page.click('#clear-button');
  assert.equal(await page.isHidden('#run-story'), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the Observatory\'s short tour: offered the first time the tab opens, then not again', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => { if (localStorage.getItem('cegarplay.tour') === null) localStorage.setItem('cegarplay.tour', '"seen"'); localStorage.setItem('cegarplay.observatory', '1'); });
  await page.goto(server.url + 'index.html?nocoi=1&example=tutorial-first-run');
  await page.waitForSelector('body[data-ready="true"]');
  await page.click('label[for="tab11"]');
  await page.waitForSelector('#tour-card');
  assert.equal(await page.textContent('#tour-title'), 'The Observatory');
  await page.click('#tour-card .tour-next');
  assert.equal(await page.textContent('#tour-title'), 'One cursor for all');
  assert.equal(await page.$eval('#cursor-region', (e) => e.classList.contains('tour-target')), true);
  await page.click('#tour-card .tour-close');
  await page.click('label[for="tab1"]');
  await page.click('label[for="tab11"]');
  await page.waitForTimeout(500);
  assert.equal(await page.$('#tour-card'), null);
  // from Settings, for a tab that is off: shown for the visit
  await page.click('#settings-button');
  await page.click('#dialog-settings [data-tab-tour="tab10"]');
  await page.waitForSelector('#tour-card');
  assert.equal(await page.textContent('#tour-title'), 'The Campaign');
  assert.equal(await page.evaluate(() => document.getElementById('tab10').checked), true);
  await context.close();
});
