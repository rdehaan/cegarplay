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
  page.once('dialog', (d) => d.accept());     // the constant was edited: confirm replacing the project
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

test('5. download JSON, reload (autosave restores), upload: all editors equal', async () => {
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
  // a reload restores the project being edited (autosave in localStorage) ...
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  for (const id of ids) assert.equal(await B.getEditor(page, id), before[id], 'restored ' + id);
  assert.match(await page.$eval('#load-status', (e) => e.textContent), /Restored/);
  // ... ?fresh=1 starts from the default example
  await page.goto(page.url() + '&fresh=1');
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

test('editors are sized when their tab is shown; Ctrl+Enter runs; clingo infos mark the line', async () => {
  const { page, context, errors } = await B.openPage(browser, server);
  await page.click('label[for="tab2"]');
  await page.waitForTimeout(200);
  const cropped = await page.$$eval('#instructions .ace_editor', (l) => l.filter((e) => {
    const ed = e.env.editor;
    return e.offsetHeight + 2 < ed.session.getScreenLength() * ed.renderer.lineHeight;
  }).length);
  assert.equal(cropped, 0, 'no example editor in the Instructions is cropped');
  await page.click('label[for="tab3"]');
  await page.waitForTimeout(200);
  assert.ok(await page.$eval('#editor-abstraction', (e) => e.offsetHeight) > 100);
  // a check that uses an atom no rule defines: an info marker on that line, no red tab marker
  await B.setEditor(page, 'editor-check', (await B.getEditor(page, 'editor-check')) + '\n:- undefined_atom(X), node(X).\n');
  await page.click('#editor-check');
  await page.keyboard.press('Control+Enter');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  const ann = await page.evaluate(() => ace.edit(document.getElementById('editor-check')).session.getAnnotations());
  assert.ok(ann.some((a) => a.type === 'info' && /undefined_atom/.test(a.text)), JSON.stringify(ann));
  assert.equal(await page.$eval('#label-programs', (e) => e.classList.contains('has-problem')), false);
  assert.match(await page.$eval('#messages', (e) => e.textContent), /fragment check, line \d+/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('loading an example over an edited project asks first', async () => {
  const { page, context } = await B.openPage(browser, server);
  // no edit yet: no question
  let asked = 0;
  page.on('dialog', (d) => { asked++; d.dismiss(); });
  await page.selectOption('#example-select', 'nash');
  await page.click('#load-button');
  await page.waitForFunction(() => /Nash/i.test(document.getElementById('load-status').textContent));
  assert.equal(asked, 0);
  await B.setEditor(page, 'editor-shared', '% edited\n');
  await page.selectOption('#example-select', 'graph-coloring');
  await page.click('#load-button');
  await page.waitForTimeout(200);
  assert.equal(asked, 1);
  assert.equal(await B.getEditor(page, 'editor-shared'), '% edited\n', 'dismissed: the project is kept');
  await context.close();
});
