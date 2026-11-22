// TODO group C: share links, the address bar, live fragment checks, the first visit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const collect = (page) => page.evaluate(() => JSON.parse(JSON.stringify({ ...window.cegarplay.collect(), runs: [] })));

for (const id of ['graph-coloring', 'lang-raw-lua']) {
  test(`C1: a share link opens the same project in a fresh context (${id})`, { skip: process.env.BROWSER === 'firefox' && 'Firefox: Playwright cannot grant clipboard-read' }, async () => {
    const ctx = { contextOptions: { permissions: ['clipboard-read', 'clipboard-write'] } };
    const { page, context } = await B.openPage(browser, server, `?example=${id}`, ctx);
    await page.click('#share-button');
    await page.waitForFunction(() => /share link/i.test(document.getElementById('share-status').textContent));
    const link = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(link, /#p=z[A-Za-z0-9_-]+$/);
    const want = await collect(page);
    await context.close();
    // a fresh context, where another project is kept: the link wins and does not replace it yet
    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    await p2.goto(server.url + 'index.html?nocoi=1');
    await p2.waitForSelector('body[data-ready="true"]');
    await p2.goto(link.replace('index.html#', 'index.html?nocoi=1#').replace(/\/#p=/, '/index.html?nocoi=1#p='));
    await p2.reload();
    await p2.waitForSelector('body[data-ready="true"]');
    assert.deepEqual(await collect(p2), want);
    assert.match(await p2.textContent('#load-status'), /share link/);
    assert.equal(await p2.evaluate(() => window.cegarplay.saveBlocked), true);
    await c2.close();
  });
}

test('C1: a damaged share link gives an error and opens the default example', async () => {
  const { page, context } = await B.openPage(browser, server);
  await page.goto(server.url + 'index.html?nocoi=1#p=zNOTVALID');
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.match(await page.textContent('#load-status'), /could not be opened/);
  await context.close();
});

test('C2: the loaded example and the tab are kept in the address bar', async () => {
  const { page, context } = await B.openPage(browser, server);
  await B.openLibrary(page);
  await page.click('#library [data-load-example="nash"]');
  await page.waitForFunction(() => window.cegarplay.exampleId === 'nash');
  await page.click('label[for="tab5"]');
  assert.match(page.url(), /[?&]example=nash\b/);
  assert.match(page.url(), /[?&]tab=5\b/);
  assert.match(page.url(), /[?&]nocoi=1\b/);
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.evaluate(() => window.cegarplay.exampleId), 'nash');
  assert.equal(await page.$eval('#tab5', (e) => e.checked), true);
  // an edit: the URL no longer names the example
  await page.click('label[for="tab4"]');
  await B.setEditor(page, 'loop-editor', '# edited\n' + await B.getEditor(page, 'loop-editor'));
  assert.doesNotMatch(page.url(), /example=/);
  assert.match(page.url(), /[?&]tab=4\b/);
  await context.close();
});

test('C3: an unsafe rule is marked while typing, and the mark goes when it is fixed', async () => {
  const { page, context } = await B.openPage(browser, server, '?tab=3');
  const before = await B.getEditor(page, 'editor-abstraction');
  await page.evaluate(() => { const ed = ace.edit(document.getElementById('editor-abstraction')); ed.navigateFileEnd(); ed.insert('\nbar(Y).'); });
  await page.waitForFunction(() => ace.edit(document.getElementById('editor-abstraction')).session.getAnnotations().length > 0, null, { timeout: 5000 });
  const ann = await page.evaluate(() => ace.edit(document.getElementById('editor-abstraction')).session.getAnnotations());
  assert.equal(ann[0].row, before.split('\n').length);
  assert.match(ann[0].text, /'Y' is unsafe/);
  assert.doesNotMatch(ann[0].text, /#inc_/);
  assert.equal(await page.$eval('#label-programs', (e) => e.classList.contains('has-problem')), true);
  await page.evaluate(() => { const ed = ace.edit(document.getElementById('editor-abstraction')); ed.navigateFileEnd(); ed.removeToLineStart(); ed.insert('bar(1).'); });
  await page.waitForFunction(() => ace.edit(document.getElementById('editor-abstraction')).session.getAnnotations().length === 0, null, { timeout: 5000 });
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => ace.edit(document.getElementById('editor-abstraction')).session.getAnnotations().length), 0);
  assert.equal(await page.$eval('#label-programs', (e) => e.classList.contains('has-problem')), false);
  await context.close();
});

test('C3: a run right after an edit cancels the pending check and runs normally', async () => {
  const { page, context } = await B.openPage(browser, server, '?tab=3');
  await page.evaluate(() => { const ed = ace.edit(document.getElementById('editor-abstraction')); ed.navigateFileEnd(); ed.insert('\n% a comment'); });
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'aborted']), 'finished');
  await context.close();
});

test('C4, C5: a fresh visit opens tutorial-first-run, runs in well under a second, library open', async () => {
  const { page, context } = await B.openPage(browser, server, '?fresh=1');
  assert.equal(await page.evaluate(() => window.cegarplay.exampleId), 'tutorial-first-run');
  assert.equal(await page.$eval('#library-section', (e) => e.open), true);
  const t0 = Date.now();
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'aborted']), 'finished');
  assert.ok(Date.now() - t0 < 1500, `first run took ${Date.now() - t0} ms`);
  assert.match(await page.textContent('#live-line'), /61 solutions/);
  await context.close();
});
