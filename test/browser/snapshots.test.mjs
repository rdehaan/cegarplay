// Project snapshots in the page (js/snapshots.js, Project > Workspace and snapshots): take, restore,
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
  await B.openDialog(page, 'versions');
  await page.fill('#snapshot-name', 'as loaded');
  await page.click('#snapshot-save-button');
  assert.deepEqual(await names(page), ['as loaded']);
  assert.match(await page.textContent('#snapshot-status'), /Took the snapshot as loaded\./);
  // an edit, then another example from the library: an automatic snapshot and an Undo
  await B.closeDialog(page, 'versions');
  await B.setEditor(page, 'editor-check', original + '% my edit\n');
  await page.waitForFunction(() => window.cegarplay.edited === true);
  await B.openLibrary(page);
  await page.click('[data-load-example="tutorial-first-run"]');
  await page.waitForFunction(() => window.cegarplay.project.title !== 'Sum-free sets (too weak relevant/1)' && document.body.dataset.ready === 'true');
  await page.waitForSelector('#load-undo-button', { state: 'visible' });
  await B.openDialog(page, 'versions');
  assert.equal(await page.isVisible('#snapshot-undo-button'), true);
  assert.equal(await page.textContent('#snapshot-undo-button'), 'Undo loading example tutorial-first-run');
  // the automatic snapshot belongs to the earlier project: listed under Other projects
  assert.match(await page.textContent('#snapshot-others'), /Other projects \(2\)/);
  assert.match(await page.textContent('#snapshot-others'), /before loading example tutorial-first-run \(automatic\)/);
  await B.closeDialog(page, 'versions');
  await page.click('#load-undo-button');
  assert.match(await checkText(page), /% my edit/);
  await B.openDialog(page, 'versions');
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
  await B.openDialog(page, 'versions');
  assert.deepEqual(await names(page), ['before restoring as loaded', 'before loading example tutorial-first-run']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('snapshots: without browser storage the page works and Undo still brings the project back', async () => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  const { page, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant&tab=1', { context });
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
  await B.openDialog(page, 'versions');
  await page.click('#snapshot-undo-button');
  assert.match(await checkText(page), /% kept in memory/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Reset everything forgets the project, workspace, snapshots and choices; Cancel keeps them', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant&tab=1');
  await B.openDialog(page, 'versions');
  await page.click('#snapshot-save-button');
  await page.fill('#workspace-name', 'mine');
  await page.click('#workspace-save-button');
  await B.closeDialog(page, 'versions');
  await B.setEditor(page, 'editor-check', '% my edit\n');
  await page.waitForFunction(() => localStorage.getItem('cegarplay.project') && /my edit/.test(localStorage.getItem('cegarplay.project')));
  const ours = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cegarplay')).sort());
  assert.ok((await ours()).length >= 4);
  // Cancel: nothing changes
  await B.openDialog(page, 'settings');
  page.once('dialog', (d) => d.dismiss());
  await page.click('#factory-reset-button');
  assert.ok((await ours()).length >= 4);
  // OK: the page starts again as on a first visit
  page.once('dialog', (d) => d.accept());
  await Promise.all([page.waitForNavigation(), page.click('#factory-reset-button')]);
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(new URL(page.url()).search, '');
  assert.equal(await page.evaluate(() => window.cegarplay.project.title), 'Sum-free sets');
  assert.equal(await page.$$eval('#snapshot-list li[data-snapshot]', (l) => l.length), 0);
  assert.equal(await page.$$eval('#workspace-list li', (l) => l.length), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('snapshots say where the project stands: none yet, the same as one, edited since', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=1');
  page.on('dialog', (d) => d.accept());
  const state = () => page.$eval('#snapshot-current', (e) => e.dataset.state);
  assert.equal(await state(), 'none');
  await B.openDialog(page, 'versions');
  assert.match(await page.textContent('#snapshot-current'), /No snapshot of this project yet/);
  await page.fill('#snapshot-name', 'first');
  await page.click('#snapshot-save-button');
  assert.equal(await state(), 'same');
  assert.match(await page.textContent('#snapshot-current'), /is the same as the snapshot first/);
  assert.match(await page.textContent('#snapshot-status'), /^Last action \(.*\): Took the snapshot first\./);
  assert.equal(await item(page, 'first').locator('.snapshot-badge').count(), 1);
  assert.equal(await item(page, 'first').locator('button:has-text("Restore")').isDisabled(), true);
  // an edit: the line says so, and the snapshot can be restored
  await B.setEditor(page, 'editor-check', (await checkText(page)) + '% edit\n');
  await page.waitForFunction(() => document.getElementById('snapshot-current').dataset.state === 'differs');
  assert.match(await page.textContent('#snapshot-current'), /differs from every snapshot/);
  await item(page, 'first').locator('button:has-text("Restore")').click();
  assert.equal(await state(), 'same');
  assert.equal(await page.isVisible('#snapshot-undo-button'), true);
  assert.match(await page.textContent('#snapshot-undo'), /You replaced the project you were editing \(restoring first\)/);
  // the automatic snapshot holds the edit: after Undo, the project is the same as that one
  await page.click('#snapshot-undo-button');
  assert.equal(await state(), 'same');
  assert.match(await page.textContent('#snapshot-current'), /the same as the snapshot before restoring first/);
  assert.equal(await page.isVisible('#snapshot-undo'), false);
  assert.deepEqual(errors, []);
  await context.close();
});
