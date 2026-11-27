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
  // the radios are in the order of the tab row: Home, then Programs (Write)
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.$eval('#tab3', (e) => e.checked), true);
  assert.equal(await page.isVisible('#section-programs'), true);
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
  const { page, context } = await B.openPage(browser, server, '?tab=5', { parts: true });
  assert.equal(await page.$eval('#tab5', (e) => e.checked), true);
  assert.equal(await page.isVisible('#section-output'), true);
  await context.close();
});

test('B2: the Project menu is in the Tab order; Enter, the arrow keys and Enter open the file dialog', async () => {
  const { page, context } = await B.openPage(browser, server);
  await page.waitForSelector('#library .library-group');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const a = await tabUntil(page, (x) => x.id === 'project-menu-button', 100);
  assert.ok(a, 'the Project menu is reachable with Tab');
  // Enter on "Open file…" clicks the hidden file input (which opens the dialog). Waiting for the
  // 'filechooser' event itself timed out only in the full parallel test run (PLAN2 S1/I1).
  await page.evaluate(() => { window.__fileClicks = 0; document.getElementById('file-input').addEventListener('click', (e) => { window.__fileClicks++; e.preventDefault(); }); });
  await page.keyboard.press('Enter');                       // opens the menu, focus on its first item
  assert.equal(await page.isVisible('#project-menu'), true);
  await page.keyboard.press('ArrowDown');                   // Open file…
  assert.match(await page.evaluate(() => document.activeElement.textContent), /Open file/);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__fileClicks === 1, null, { timeout: 15000 });
  assert.equal(await page.isHidden('#project-menu'), true, 'the menu closes');
  await context.close();
});

test('B6: a fragment\'s "?" opens its explanation inline with the keyboard, and folds it again', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?tab=3', { parts: true });
  const link = 'a.modal-link[data-open="modal-abstraction"]';
  assert.match(await page.$eval(link, (e) => e.getAttribute('aria-label')), /abstraction/);
  assert.equal(await page.getAttribute(link, 'aria-expanded'), 'false');
  await page.focus(link);
  await page.keyboard.press('Enter');
  // a blue box under the heading, no dialog
  assert.equal(await page.isVisible('#modal-abstraction-inline'), true);
  assert.equal(await page.isVisible('#modal-abstraction .modal-dialog'), false);
  assert.equal(await page.$eval('#modal-abstraction-inline', (b) => b.previousElementSibling.tagName + ' ' + b.classList.contains('help-box')), 'H3 true');
  assert.match(await page.textContent('#modal-abstraction-inline'), /Proposes candidates/);
  assert.equal(await page.getAttribute(link, 'aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.open), 'modal-abstraction', 'the focus stays on the "?"');
  await page.keyboard.press('Enter');
  assert.equal(await page.$('#modal-abstraction-inline'), null);
  assert.equal(await page.getAttribute(link, 'aria-expanded'), 'false');
  // the loop script's "?": its manual link still works
  await page.click('label[for="tab4"]');
  await page.click('a.modal-link[data-open="modal-loop"]');
  await page.click('#modal-loop-inline a[href="#manual-the-loop-language"]');
  await page.waitForFunction(() => document.getElementById('tab8').checked);
  assert.equal(await page.$eval('#run-status', (e) => e.getAttribute('role')), 'status');
  assert.equal(await page.$eval('#run-message', (e) => e.getAttribute('aria-live')), 'polite');
  assert.deepEqual(errors, []);
  await context.close();
});

test('B4, B5: at 390 px every tab has a name and a tooltip, and no tab scrolls sideways', async () => {
  const { page, context } = await B.openPage(browser, server, '?internals=true', { parts: true, contextOptions: { viewport: { width: 390, height: 800 } } });
  for (const t of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const sel = `label[for="tab${t}"]`;
    if (await page.$eval(sel, (l) => l.hidden)) continue;
    const [name, title, size] = await page.$eval(sel, (l) => [l.textContent.trim(), l.title, parseFloat(getComputedStyle(l.querySelector('.tab-text') || l).fontSize)]);
    assert.ok(name.length > 2 && title.length > 2, `tab ${t} has a name and a title`);
    assert.ok(size > 0, `tab ${t}: the text is not zero-sized`);
    await B.openTab(page, t);
    await page.waitForTimeout(150);
    const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert.equal(sw, w, `tab ${t} scrolls sideways (${sw} > ${w})`);
  }
  await context.close();
});

test('A4: the time limit ends a loop without solver calls in the page', async () => {
  const { page, context } = await B.openPage(browser, server, '?example=tutorial-first-run', { parts: true });
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

// The controls added with bounded verification and the interface items: names, a visible keyboard
// focus, the tab order of the audit group, and live regions for what reports status.
const accName = (page, sel) => page.$eval(sel, (e) => {
  if (e.getAttribute('aria-label')) return e.getAttribute('aria-label');
  if (e.labels && e.labels.length) return [...e.labels].map((l) => l.textContent.trim()).join(' ');
  return ['BUTTON', 'A', 'SUMMARY'].includes(e.tagName) ? e.textContent.trim() : '';
});

test('B7: the audit group, the Spaces editor, next steps and result cards are named, focusable and announced', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=af-preferred&tab=9', { parts: true });
  for (const sel of ['#audit-button', '#audit-mode', '#space-list-select', '#space-name', '#space-description-input', '#space-preview-k',
    '#preview-space-button', '#add-space-param-button', '#add-space-button', '#delete-space-button',
    '#snapshot-name', '#snapshot-save-button', '#compare-a', '#compare-b', '#compare-button']) {
    assert.ok((await accName(page, sel)).length > 1, `${sel} has a name`);
  }
  assert.equal(await page.$('#space-description-input') !== null && await page.$$eval('[id="space-description"]', (l) => l.length), 1, 'one #space-description');
  // the audit group in the Tab order: Audit, its mode, the space and the bound
  await page.selectOption('#audit-mode', 'space');
  for (const sel of ['#space-select', '#space-bound']) assert.ok((await accName(page, sel)).length > 1, `${sel} has a name`);
  await page.focus('#audit-button');
  const order = [];
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement.id)); }
  assert.deepEqual(order, ['audit-mode', 'space-select', 'space-bound']);
  // a visible keyboard focus (2 px in the link colour)
  assert.deepEqual(await page.$eval('#space-bound', (e) => [getComputedStyle(e).outlineStyle, getComputedStyle(e).outlineWidth]), ['solid', '2px']);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.$eval('#space-select', (e) => getComputedStyle(e).outlineStyle), 'solid');
  // status regions
  for (const sel of ['#space-status', '#snapshot-status', '#compare-result', '#instances-status', '#run-message']) {
    assert.equal(await page.getAttribute(sel, 'aria-live'), 'polite', `${sel} is a live region`);
  }
  // a verdict: the result card is a live region named by its heading; its next steps are buttons
  await page.fill('#space-bound', '2');
  await page.click('#audit-button');
  await page.waitForFunction(() => document.getElementById('run-status').dataset.state === 'finished' && !window.cegarplay.control.batch, null, { timeout: 60000 });
  assert.equal(await page.getAttribute('#audit-panel', 'aria-live'), 'polite');
  assert.equal(await page.$eval('#audit-panel', (e) => document.getElementById(e.getAttribute('aria-labelledby')).textContent), 'Space frameworks: sound up to size = 2');
  await B.openTab(page, 5);
  const next = await page.$$eval('#audit-panel .audit-next button', (l) => l.map((b) => [b.textContent, b.type, b.title.length > 0]));
  assert.deepEqual(next, [['Try a larger bound', 'button', true]]);
  await page.keyboard.press('Shift');   // keyboard use: the focus that follows is a keyboard focus
  await page.focus('#audit-panel .audit-next button');
  assert.equal(await page.$eval('#audit-panel .audit-next button', (e) => getComputedStyle(e).outlineStyle), 'solid');
  assert.deepEqual(errors, []);
  await context.close();
});

test('B5: at 1400, 700 and 400 px the Control, Instances, Output and Observatory tabs do not scroll sideways', async () => {
  for (const width of [1400, 700, 400]) {
    const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant', { parts: true, contextOptions: { viewport: { width, height: 800 } } });
    for (const t of [1, 9, 5, 11]) {
      await B.openTab(page, t);
      await page.waitForTimeout(150);
      const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.equal(sw, w, `tab ${t} at ${width} px scrolls sideways (${sw} > ${w})`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});
