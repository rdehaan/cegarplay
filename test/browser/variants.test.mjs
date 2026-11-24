// Variants in the page: the run bar's Variant picker and the editor in the Loop tab.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const options = (page) => page.$$eval('#variant-select option', (l) => l.map((o) => o.value));

test('the voting example: the picker lists its variants, and a run with one says so in the run history', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=voting-justification&tab=4');
  assert.equal(await page.isVisible('#variant-select'), true);
  assert.deepEqual(await options(page), ['', 's1', 's3', 's4', 's5', 'shape2', 'record', 'reference']);
  assert.equal(await page.$$eval('#variants .variant-card', (l) => l.length), 7);
  await page.selectOption('#instance-select', 'cancel-posresp-k2');
  await page.selectOption('#variant-select', 's1');
  await page.selectOption('#solutions-select', '0');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  assert.match(await page.textContent('#live-line'), /2 solutions/);
  await page.click('label[for="tab6"]');
  assert.match(await page.textContent('#history-table'), /\[cancel-posresp-k2\] \(variant s1\)/);
  assert.equal(await page.evaluate(() => window.cegarplay.project.settings.variant), 's1');
  // a project without variants has no picker
  assert.equal(await page.evaluate(async () => { await window.cegarplay.loadExample('tutorial-first-run'); return document.getElementById('variant-select').hidden; }), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the editor adds, checks, renames and deletes a variant', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=4');
  page.on('dialog', (d) => d.accept());
  assert.equal(await page.isVisible('#variant-select'), false);
  await page.click('#add-variant-button');
  assert.deepEqual(await options(page), ['', 'v1']);
  const card = '#variants .variant-card[data-variant="v1"]';
  await page.fill(`${card} .variant-swap`, 'check=nope');
  await page.press(`${card} .variant-swap`, 'Tab');
  assert.match(await page.textContent(`${card} .variant-error`), /no fragment named nope/);
  assert.deepEqual(await page.evaluate(() => window.cegarplay.project.variants[0].swap), {});
  await page.fill(`${card} .variant-swap`, 'check=abstraction');
  await page.press(`${card} .variant-swap`, 'Tab');
  assert.equal(await page.textContent(`${card} .variant-error`), '');
  assert.deepEqual(await page.evaluate(() => window.cegarplay.project.variants[0].swap), { check: 'abstraction' });
  // its own loop starts as a copy of the project's
  await page.check(`${card} .variant-own-loop`);
  assert.equal(await page.evaluate(() => window.cegarplay.project.variants[0].loop.text === window.cegarplay.project.loop.text), true);
  await page.fill(`${card} .variant-name`, 'mine');
  await page.press(`${card} .variant-name`, 'Tab');
  assert.deepEqual(await options(page), ['', 'mine']);
  await page.click('#variants .variant-card[data-variant="mine"] button');
  assert.equal(await page.isVisible('#variant-select'), false);
  assert.deepEqual(await page.evaluate(() => window.cegarplay.project.variants), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Compare variants: line diffs of fragments and loop script, and the latest results per instance', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=af-preferred&tab=4');
  // the project as written and the variant one-clause, each run with all solutions on "example"
  await page.selectOption('#instance-select', 'example');
  await page.selectOption('#solutions-select', '0');
  for (const v of ['', 'one-clause']) {
    await page.selectOption('#variant-select', v);
    await page.click('#run-button');
    assert.equal(await B.waitState(page, ['finished', 'error']), 'finished');
  }
  assert.equal(await page.isVisible('#variant-compare'), true);
  assert.deepEqual(await page.$$eval('#compare-a option', (l) => l.map((o) => o.value)), ['', 'reference', 'one-clause', 'three-cex', 'record']);
  await page.selectOption('#compare-a', '');
  await page.selectOption('#compare-b', 'one-clause');
  await page.click('#compare-button');
  await page.waitForSelector('#compare-summary');
  assert.match(await page.textContent('#compare-summary'), /one-clause against the project as written: 1 fragment, the loop script differ\./);
  assert.deepEqual(await page.$$eval('#compare-result [data-compare]', (l) => l.map((d) => d.dataset.compare)), ['fragment:check', 'loop']);
  assert.ok(await page.$$eval('[data-compare="loop"] .diff-add', (l) => l.length) > 0);
  // the run history's latest count on "example", per side
  const row = await page.$$eval('#compare-results tr[data-instance="example"] td', (l) => l.map((x) => x.textContent));
  assert.equal(row.length, 5);
  assert.match(row[1], /^\d+$/);
  assert.match(row[2], /^\d+$/);
  assert.equal(row[1], row[2]);      // a sound variant: the same count
  // both sides the same
  await page.selectOption('#compare-b', '');
  assert.equal(await page.textContent('#compare-summary'), 'Both sides are the same.');
  // the live region announces the result
  assert.equal(await page.getAttribute('#compare-result', 'aria-live'), 'polite');
  assert.deepEqual(errors, []);
  await context.close();
});
