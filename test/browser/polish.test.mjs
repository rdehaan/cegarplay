// TODO group D: page metadata and footer, font downloads, a storage failure.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

test('D1, D2: metadata, footer, no brands font, and the icons render', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(server.url + 'index.html?nocoi=1&tab=3');
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  assert.ok(!requests.some((u) => /fa-brands-400|fa-regular-400/.test(u)), requests.filter((u) => /woff2/.test(u)).join('\n'));
  assert.ok(requests.some((u) => /fa-solid-900\.woff2/.test(u)));
  // every icon of the tabs and the info links is drawn with a Font Awesome face
  const fa = await page.evaluate(async () => {
    const chars = ['', '', '', '', '', ''];
    const ok = [];
    for (const c of chars) ok.push((await document.fonts.load('18px FontAwesome', c)).length > 0 && document.fonts.check('18px FontAwesome', c));
    return ok;
  });
  assert.deepEqual(fa, fa.map(() => true));
  const w = await page.$eval('label[for="tab3"]', (l) => parseFloat(getComputedStyle(l, '::before').width) || l.getBoundingClientRect().width);
  assert.ok(w > 0);
  assert.notEqual(await page.$eval('link[rel="icon"]', (l) => l.getAttribute('href')), 'data:,');
  assert.match(await page.$eval('meta[name="description"]', (m) => m.content), /CEGAR/);
  assert.ok(await page.$('meta[property="og:title"]'));
  assert.match(await page.textContent('.page-footer'), /GitHub[\s\S]*MIT licence[\s\S]*clingo 5\.\d+\.\d+ via clingo-wasm/);
  await context.close();
});

test('D3: when the browser cannot keep the project, the Control tab says so', async () => {
  const { page, context } = await B.openPage(browser, server, '?fresh=1');
  assert.equal(await page.isHidden('#storage-status'), true);
  await page.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
  await page.click('label[for="tab4"]');
  await B.setEditor(page, 'loop-editor', '# edited\n' + await B.getEditor(page, 'loop-editor'));
  await page.waitForFunction(() => !document.getElementById('storage-status').hidden, null, { timeout: 5000 });
  assert.match(await page.textContent('#storage-status'), /Not kept in this browser: storage is full or unavailable; download the project to keep it/);
  await context.close();
});

test('D3: storage that is too small for the run history keeps the project without it', async () => {
  const { page, context } = await B.openPage(browser, server, '?fresh=1');
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'cegarplay.project' && JSON.parse(v).runs.length) throw new DOMException('full', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  });
  // ?fresh=1 keeps nothing until the first edit
  await page.click('label[for="tab4"]');
  await B.setEditor(page, 'loop-editor', '# edited\n' + await B.getEditor(page, 'loop-editor'));
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'aborted']), 'finished');
  await page.waitForFunction(() => !document.getElementById('storage-status').hidden, null, { timeout: 5000 });
  assert.match(await page.textContent('#storage-status'), /without the run history/);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('cegarplay.project')));
  assert.deepEqual(kept.runs, []);
  await context.close();
});
