// Phase 4: browser smoke tests (spec-app.md section 8) on the plain server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

test('1. the page loads with no console error and no request to another origin', async () => {
  const { page, context, errors, foreign } = await B.openPage(browser, server);
  assert.equal(await B.runState(page), 'idle');
  assert.equal(await page.isHidden('#pause-button'), true, 'pause is hidden on a page that is not isolated');
  for (const t of [2, 3, 4, 5, 6]) await page.click(`label[for="tab${t}"]`);
  await page.waitForTimeout(300);
  assert.deepEqual(errors, []);
  assert.deepEqual(foreign, []);
  await context.close();
});

test('2. the default example runs to the reference numbers', async () => {
  const { page, context, errors } = await B.openPage(browser, server);
  assert.equal(await page.$eval('#solutions-select', (e) => e.value), '0');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'aborted']), 'finished');
  const live = await page.textContent('#live-line');
  assert.match(live, /10,698 solutions/);
  assert.match(live, /31,776 candidates · 21,078 counterexamples · 21,078 refinements/);
  assert.equal(await page.$$eval('#solutions li', (l) => l.length), 1000);
  assert.deepEqual(errors, []);
  await context.close();
});

test('3. abort a long run, then run the default example again', async () => {
  const { page, context, errors } = await B.openPage(browser, server);
  await page.click('label[for="tab4"]');
  await page.fill('#constants-table tbody tr input.const-value', '7');
  await page.click('#run-button');
  await B.waitState(page, ['running']);
  await page.waitForTimeout(1000);
  await page.click('#abort-button');
  assert.equal(await B.waitState(page, ['aborted', 'finished', 'error']), 'aborted');
  const live = await page.textContent('#live-line');
  const cand = Number((/([\d,]+) candidates/.exec(live) || [0, '0'])[1].replace(/,/g, ''));
  assert.ok(cand > 0, live);
  await page.click('label[for="tab1"]');
  await page.click('#load-button');
  await page.waitForFunction(() => /Loaded/.test(document.getElementById('load-status').textContent));
  const t0 = Date.now();
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'aborted']), 'finished');
  assert.match(await page.textContent('#live-line'), /10,698 solutions/);
  assert.ok(Date.now() - t0 < 30000);
  assert.deepEqual(errors, []);
  await context.close();
});

test('4. a syntax error in a fragment: annotation, status error, no run', async () => {
  const { page, context } = await B.openPage(browser, server);
  const text = await B.getEditor(page, 'editor-check');
  await B.setEditor(page, 'editor-check', 'a :- b\nc.\n' + text);
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['error', 'finished', 'running']), 'error');
  const anns = await page.evaluate(() => ace.edit(document.getElementById('editor-check')).session.getAnnotations());
  assert.equal(anns.length, 1);
  assert.equal(anns[0].row, 1);
  assert.match(anns[0].text, /syntax error/);
  assert.equal(await page.$eval('label[for="tab3"]', (e) => e.classList.contains('has-problem')), true);
  assert.equal((await page.textContent('#live-line')).trim(), '');
  assert.match(await page.textContent('#result-line'), /Not started/);
  // editing clears the annotation
  await B.setEditor(page, 'editor-check', text);
  assert.equal(await page.evaluate(() => ace.edit(document.getElementById('editor-check')).session.getAnnotations().length), 0);
  await context.close();
});

test('5. download JSON, reload, upload: all editors equal', async () => {
  const { page, context } = await B.openPage(browser, server);
  await B.setEditor(page, 'editor-shared', '% changed\n' + await B.getEditor(page, 'editor-shared'));
  await B.setEditor(page, 'loop-editor', (await B.getEditor(page, 'loop-editor')).replace('search A:', '# a comment\nsearch A:'));
  const ids = await page.$$eval('#fragments .editor, #loop-editor', (l) => l.map((e) => e.id));
  const before = {};
  for (const id of ids) before[id] = await B.getEditor(page, id);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download-button')]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cegarplay-')), dl.suggestedFilename());
  await dl.saveAs(file);
  assert.equal(path.basename(file), 'graph-colouring.json');
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.notEqual(await B.getEditor(page, 'editor-shared'), before['editor-shared']);
  await page.setInputFiles('#file-input', file);
  await page.waitForFunction(() => /Loaded/.test(document.getElementById('upload-status').textContent));
  for (const id of ids) assert.equal(await B.getEditor(page, id), before[id], id);
  await context.close();
});

test('URL parameters: ?file=nash and ?tab=4', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?file=nash&tab=4');
  assert.equal(await page.isVisible('#section-loop'), true);
  assert.equal(await page.isVisible('#section-control'), false);
  assert.match(await B.getEditor(page, 'editor-abstraction'), /Nash equilibrium/);
  assert.equal(await page.isVisible('label[for="tab7"]'), false);
  assert.deepEqual(errors, []);
  await context.close();
  const o = await B.openPage(browser, server, '?internals=true&tab=7');
  assert.equal(await o.page.isVisible('#section-internals'), true);
  await o.context.close();
});
