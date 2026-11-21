// TODO groups A4 and B: keyboard access, dialogs, small screens, the time limit in the page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const active = (page) => page.evaluate(() => {
  const e = document.activeElement;
  return { tag: e.tagName.toLowerCase(), id: e.id, name: e.getAttribute('name'), cls: e.className };
});

async function tabUntil(page, pred, max = 40) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const a = await active(page);
    if (pred(a)) return a;
  }
  return null;
}

test('B1: Tab reaches the tab row, arrow keys switch tabs, the focus ring is visible', async () => {
  const { page, context, errors } = await B.openPage(browser, server);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const a = await tabUntil(page, (x) => x.name === 'tabs');
  assert.ok(a, 'the tab row is in the Tab order');
  assert.equal(a.id, 'tab1');
  const ring = await page.$eval('label[for="tab1"]', (l) => getComputedStyle(l).outlineStyle);
  assert.notEqual(ring, 'none');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('#tab2', (e) => e.checked), true);
  assert.equal(await page.isVisible('#section-tutorial'), true);
  // hidden Manual and Internals tabs are skipped
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowRight');
    const id = (await active(page)).id;
    assert.ok(!['tab7', 'tab8'].includes(id), `focus on hidden ${id}`);
  }
  assert.equal(await page.$eval('#tab1', (e) => e.getAttribute('aria-controls')), 'section-control');
  assert.equal(await page.$$eval('label[name="tabs"]', (l) => l.length), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('B1: ?tab=N still opens that tab', async () => {
  const { page, context } = await B.openPage(browser, server, '?tab=5');
  assert.equal(await page.$eval('#tab5', (e) => e.checked), true);
  assert.equal(await page.isVisible('#section-output'), true);
  await context.close();
});

test('B2: the file control is in the Tab order and Enter opens the file dialog', async () => {
  const { page, context } = await B.openPage(browser, server);
  await page.waitForSelector('#library .library-group');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const a = await tabUntil(page, (x) => x.id === 'file-button', 80);
  assert.ok(a, 'Select file is reachable with Tab');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.keyboard.press('Enter')]);
  assert.ok(chooser);
  await context.close();
});

test('B6: an info modal opens with the keyboard, closes with Escape, focus returns', async () => {
  const { page, context } = await B.openPage(browser, server, '?tab=3');
  const link = 'a.modal-link[data-open="modal-abstraction"]';
  assert.match(await page.$eval(link, (e) => e.getAttribute('aria-label')), /abstraction/);
  await page.focus(link);
  await page.keyboard.press('Enter');
  assert.equal(await page.isVisible('#modal-abstraction .modal-dialog'), true);
  const dlg = await page.$eval('#modal-abstraction .modal-dialog', (d) => [d.getAttribute('role'), d.getAttribute('aria-modal'), document.getElementById(d.getAttribute('aria-labelledby'))?.textContent]);
  assert.deepEqual(dlg.slice(0, 2), ['dialog', 'true']);
  assert.match(dlg[2], /abstraction/);
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('#modal-abstraction')), true);
  // Tab stays inside
  for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('#modal-abstraction')), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#modal-abstraction .modal-dialog'), false);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.open), 'modal-abstraction');
  assert.equal(await page.$eval('#run-status', (e) => e.getAttribute('role')), 'status');
  assert.equal(await page.$eval('#run-message', (e) => e.getAttribute('aria-live')), 'polite');
  await context.close();
});

test('B4, B5: at 390 px every tab has a name and a tooltip, and no tab scrolls sideways', async () => {
  const { page, context } = await B.openPage(browser, server, '?internals=true&manual=true', { contextOptions: { viewport: { width: 390, height: 800 } } });
  for (const t of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const sel = `label[for="tab${t}"]`;
    if (await page.isHidden(sel)) continue;
    const [name, title, size] = await page.$eval(sel, (l) => [l.textContent.trim(), l.title, parseFloat(getComputedStyle(l.querySelector('.tab-text') || l).fontSize)]);
    assert.ok(name.length > 2 && title.length > 2, `tab ${t} has a name and a title`);
    assert.ok(size > 0, `tab ${t}: the text is not zero-sized`);
    await page.click(sel);
    await page.waitForTimeout(150);
    const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.equal(sw, w, `tab ${t} scrolls sideways (${sw} > ${w})`);
  }
  await context.close();
});

test('A4: the time limit ends a loop without solver calls in the page', async () => {
  const { page, context } = await B.openPage(browser, server, '?example=tutorial-first-run');
  const text = await B.getEditor(page, 'loop-editor');
  await B.setEditor(page, 'loop-editor', text.split('\n').slice(0, 4).join('\n') + '\nloop:\n    x = 1\n');
  await page.click('label[for="tab4"]');
  await page.fill('#seconds-input', '1');
  await page.dispatchEvent('#seconds-input', 'change');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'aborted'], 20000), 'finished');
  assert.equal(await page.evaluate(() => window.cegarplay.control.D.outcome), 'limit');
  await context.close();
});
