// Project snapshots in the page (js/snapshots.js, the Control tab's Snapshots): take, restore,
// the automatic snapshot and Undo before another project replaces an edited one, and a page
// without browser storage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const checkText = (page) => B.getEditor(page, 'editor-check');
const item = (page, name) => page.locator('#snapshot-list li', { has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) });
const names = (page) => page.$$eval('#snapshot-list li[data-snapshot] b', (l) => l.map((x) => x.textContent));

test('snapshots: take one, load an example over the edit and Undo, restore, delete', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant&tab=1');
  page.on('dialog', (d) => d.accept());
  const original = await checkText(page);
  await page.fill('#snapshot-name', 'as loaded');
  await page.click('#snapshot-save-button');
  assert.deepEqual(await names(page), ['as loaded']);
  assert.match(await page.textContent('#snapshot-status'), /Took the snapshot as loaded\./);
  // an edit, then another example from the library: an automatic snapshot and an Undo
  await B.setEditor(page, 'editor-check', original + '% my edit\n');
  await page.waitForFunction(() => window.cegarplay.edited === true);
  await B.openLibrary(page);
  await page.click('[data-load-example="tutorial-first-run"]');
  await page.waitForFunction(() => window.cegarplay.project.title !== 'Sum-free sets (too weak relevant/1)' && document.body.dataset.ready === 'true');
  assert.equal(await page.isVisible('#snapshot-undo-button'), true);
  assert.equal(await page.textContent('#snapshot-undo-button'), 'Undo loading example tutorial-first-run');
  assert.equal(await page.isVisible('#load-undo-button'), true);
  // the automatic snapshot belongs to the earlier project: listed under Other projects
  assert.match(await page.textContent('#snapshot-others'), /Other projects \(2\)/);
  assert.match(await page.textContent('#snapshot-others'), /before loading example tutorial-first-run \(automatic\)/);
  await page.click('#load-undo-button');
  assert.match(await checkText(page), /% my edit/);
  assert.equal(await page.isVisible('#snapshot-undo-button'), false);
  assert.match(await page.textContent('#snapshot-status'), /Undone: back to the project before loading example tutorial-first-run\./);
  assert.deepEqual(await names(page), ['before loading example tutorial-first-run', 'as loaded']);
  // restore "as loaded": the edit goes, with an automatic snapshot of it and an Undo
  await item(page, 'as loaded').locator('button:has-text("Restore")').click();
  assert.equal(await checkText(page), original);
  assert.equal(await page.textContent('#snapshot-undo-button'), 'Undo restoring as loaded');
  await page.click('#snapshot-undo-button');
  assert.match(await checkText(page), /% my edit/);
  // delete; the list survives a reload (browser storage)
  await item(page, 'as loaded').locator('button:has-text("Delete")').click();
  assert.equal((await names(page)).includes('as loaded'), false);
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.deepEqual(await names(page), ['before restoring as loaded', 'before loading example tutorial-first-run']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('snapshots: without browser storage the page works and Undo still brings the project back', async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  const { page, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant&tab=1', { context, advanced: false });
  page.on('dialog', (d) => d.accept());
  assert.match(await page.textContent('#snapshot-unavailable'), /Browser storage is not available here/);
  assert.equal(await page.isDisabled('#snapshot-save-button'), true);
  const original = await checkText(page);
  await B.setEditor(page, 'editor-check', original + '% kept in memory\n');
  await page.waitForFunction(() => window.cegarplay.edited === true);
  await B.openLibrary(page);
  await page.click('[data-load-example="tutorial-first-run"]');
  await page.waitForFunction(() => window.cegarplay.project.title !== 'Sum-free sets (too weak relevant/1)' && document.body.dataset.ready === 'true');
  assert.match(await page.textContent('#snapshot-status'), /could not be kept in browser storage; Undo still brings it back/);
  await page.click('#snapshot-undo-button');
  assert.match(await checkText(page), /% kept in memory/);
  assert.deepEqual(errors, []);
  await context.close();
});
