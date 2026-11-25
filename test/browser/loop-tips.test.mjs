// The loop script editor's help (js/loop-tips.js): the tooltip per word and the hint line.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

// the screen position of (row, column) in the loop editor, a little inside the character
const spot = (page, row, col) => page.evaluate(([r, c]) => {
  const e = ace.edit('loop-editor');
  e.renderer.scrollCursorIntoView({ row: r, column: c });
  const p = e.renderer.textToScreenCoordinates(r, c);
  return [p.pageX + 3, p.pageY + 6];
}, [row, col]);

test('hovering a word of the loop script explains it; the hint line explains the statement at the cursor', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=4');
  await page.$eval('#loop-editor', (e) => e.scrollIntoView({ block: 'center' }));
  assert.match(await page.textContent('#loop-hint'), /^Point at a word/);
  // the word "clause" on line 9 (row 8)
  const line = await page.evaluate(() => ace.edit('loop-editor').session.getLine(8));
  let [x, y] = await spot(page, 8, line.indexOf('clause') + 1);
  await page.mouse.move(x, y);
  await page.waitForSelector('#loop-tip:not([hidden])');
  assert.equal(await page.textContent('#loop-tip .loop-tip-title'), 'G.clause(M, X)');
  // another word: the text follows at once
  [x, y] = await spot(page, 0, 'solver A = shared + '.length + 2);
  await page.mouse.move(x, y);
  await page.waitForFunction(() => document.querySelector('#loop-tip .loop-tip-title')?.textContent === 'abstraction');
  assert.match(await page.textContent('#loop-tip'), /Fragment abstraction: Proposes candidates/);
  // past the end of a line: no word, no tooltip
  [x, y] = await spot(page, 3, 0);
  await page.mouse.move(x + 200, y);
  await page.waitForSelector('#loop-tip', { state: 'hidden' });
  // the cursor on the solve line
  await page.evaluate(() => { const e = ace.edit('loop-editor'); e.focus(); e.gotoLine(7, 9); });
  await page.waitForFunction(() => /^X = a counterexample from solver C/.test(document.getElementById('loop-hint').textContent));
  await page.evaluate(() => ace.edit('loop-editor').gotoLine(5, 0));
  await page.waitForFunction(() => /^Runs the search of solver A/.test(document.getElementById('loop-hint').textContent));
  // raw Lua: no help
  page.on('dialog', (d) => d.accept());
  await page.click('#edit-as-lua-button');
  await page.waitForFunction(() => document.getElementById('loop-hint').hidden);
  [x, y] = await spot(page, 2, 3);
  await page.mouse.move(x, y);
  await page.waitForTimeout(600);
  assert.equal(await page.isHidden('#loop-tip'), true);
  assert.deepEqual(errors, []);
  await context.close();
});
