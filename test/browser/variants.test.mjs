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
  await B.runOptions(page, () => page.selectOption('#solutions-select', '0'));
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
  assert.match(await page.textContent(`${card} .variant-error`), /no fragment named nope yet/);
  assert.deepEqual(await page.evaluate(() => window.cegarplay.project.variants[0].swap), {});
  await page.fill(`${card} .variant-swap`, 'check=abstraction');
  await page.press(`${card} .variant-swap`, 'Tab');
  assert.equal(await page.textContent(`${card} .variant-error`), '');
  assert.deepEqual(await page.evaluate(() => window.cegarplay.project.variants[0].swap), { check: 'abstraction' });
  // its own loop starts as a copy of the project's
  await page.check(`${card} .variant-own-loop`);
  assert.equal(await page.evaluate(() => window.cegarplay.project.variants[0].loop.text === window.cegarplay.project.loop.text), true);
  // in an editor like the project's: highlighting, edits reach the variant, the live check marks errors
  await page.waitForSelector(`${card} .variant-loop .ace_keyword`);
  await page.click(`${card} .variant-loop .ace_content`);
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nbogus ((\n');
  await page.waitForSelector(`${card} .variant-loop .ace_gutter-cell.ace_error`);
  assert.match(await page.evaluate(() => window.cegarplay.project.variants[0].loop.text), /bogus \(\(/);
  assert.doesNotMatch(await page.evaluate(() => window.cegarplay.project.loop.text), /bogus/);
  // a template for the variant's own script: Shape 2 replaces it (the project's script stays)
  assert.equal(await page.isVisible(`${card} .variant-template`), true);
  await page.selectOption(`${card} .variant-template`, 'shape2');
  await page.click(`${card} .variant-insert-template`);
  await page.waitForFunction(() => /^loop:$/m.test(window.cegarplay.project.variants[0].loop.text));
  // the statements are the template's; the declarations stay the variant's own (a copy of the project's)
  const [vt, decl, body] = await page.evaluate(async () => {
    const t = (await import('./js/project.js')).template('shape2');
    const d = (x) => x.split('\n').filter((l) => /^\s*(solver|link)\b/.test(l)).join('\n');
    const b = (x) => x.split('\n').filter((l) => l.trim() && !/^\s*(solver|link)\b/.test(l)).join('\n');
    const v = window.cegarplay.project.variants[0].loop.text;
    return [v, d(v) === d(window.cegarplay.project.loop.text), b(v) === b(t)];
  });
  assert.ok(decl && body, vt);
  await page.waitForFunction((c) => !document.querySelector(`${c} .variant-loop .ace_gutter-cell.ace_error`), card);
  assert.doesNotMatch(await page.evaluate(() => window.cegarplay.project.loop.text), /^loop:$/m);
  // Ctrl+Z in the editor undoes it
  await page.click(`${card} .variant-loop .ace_content`);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => /bogus \(\(/.test(window.cegarplay.project.variants[0].loop.text));
  // without its own script: no template controls
  await page.uncheck(`${card} .variant-own-loop`);
  assert.equal(await page.isVisible(`${card} .variant-template`), false);
  await page.fill(`${card} .variant-name`, 'mine');
  await page.press(`${card} .variant-name`, 'Tab');
  assert.deepEqual(await options(page), ['', 'mine']);
  await page.click('#variants .variant-card[data-variant="mine"] button');
  assert.equal(await page.isVisible('#variant-select'), false);
  assert.deepEqual(await page.evaluate(() => window.cegarplay.project.variants), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Compare variants: line diffs of fragments and loop script; Close; results are in the Campaign tab', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=af-preferred&tab=4');
  assert.equal(await page.isVisible('#variant-compare'), true);
  assert.deepEqual(await page.$$eval('#compare-a option', (l) => l.map((o) => o.value)), ['', 'reference', 'one-clause', 'three-cex', 'record']);
  assert.equal(await page.isVisible('#compare-close-button'), false);
  await page.selectOption('#compare-a', '');
  await page.selectOption('#compare-b', 'one-clause');
  await page.click('#compare-button');
  await page.waitForSelector('#compare-summary');
  assert.match(await page.textContent('#compare-summary'), /one-clause against \(no variant\): 1 fragment and the loop script differ\./);
  assert.deepEqual(await page.$$eval('#compare-result [data-compare]', (l) => l.map((d) => d.dataset.compare)), ['fragment:check', 'loop']);
  assert.ok(await page.$$eval('[data-compare="loop"] .diff-add', (l) => l.length) > 0);
  // what the sides compute is compared in the Campaign tab
  assert.match(await page.textContent('#compare-results-note'), /compares the texts only/);
  assert.equal(await page.$('#compare-results'), null);
  await page.click('#compare-campaign-link');
  assert.equal(await page.$eval('#tab10', (e) => e.checked), true);
  await page.click('label[for="tab4"]');
  // both sides the same
  await page.selectOption('#compare-b', '');
  assert.equal(await page.textContent('#compare-summary'), 'Both sides are the same.');
  // the live region announces the result
  assert.equal(await page.getAttribute('#compare-result', 'aria-live'), 'polite');
  // Close: nothing compared
  await page.selectOption('#compare-b', 'one-clause');
  await page.click('#compare-close-button');
  assert.equal(await page.$eval('#compare-result', (e) => e.childElementCount), 0);
  assert.equal(await page.$eval('#compare-b', (s) => s.value), '');
  assert.equal(await page.isVisible('#compare-close-button'), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('variants follow edits: the compare box gets a new name; a swap waits for its fragment', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=4');
  await page.click('#add-variant-button');
  const card = (n) => `#variants .variant-card[data-variant="${n}"]`;
  assert.deepEqual(await page.$$eval('#compare-b option', (l) => l.map((o) => o.value)), ['', 'v1']);
  assert.equal(await page.$eval('#compare-b', (s) => s.value), 'v1');
  await page.fill(`${card('v1')} .variant-name`, 'mine');
  await page.press(`${card('v1')} .variant-name`, 'Tab');
  assert.deepEqual(await page.$$eval('#compare-b option', (l) => l.map((o) => o.value)), ['', 'mine']);
  assert.equal(await page.$eval('#compare-b', (s) => s.value), 'mine');
  // a swap with a fragment that does not exist yet: kept as typed, applied once it is made
  await page.fill(`${card('mine')} .variant-swap`, 'check=check2');
  await page.press(`${card('mine')} .variant-swap`, 'Tab');
  assert.match(await page.textContent(`${card('mine')} .variant-error`), /no fragment named check2 yet/);
  assert.deepEqual(await page.evaluate(() => window.cegarplay.project.variants[0].swap), {});
  await page.click('label[for="tab3"]');
  page.once('dialog', (d) => d.accept('check2'));
  await page.click('#add-fragment-button');
  await page.click('label[for="tab4"]');
  assert.equal(await page.textContent(`${card('mine')} .variant-error`), '');
  assert.equal(await page.inputValue(`${card('mine')} .variant-swap`), 'check=check2');
  assert.deepEqual(await page.evaluate(() => window.cegarplay.project.variants[0].swap), { check: 'check2' });
  assert.deepEqual(errors, []);
  await context.close();
});
