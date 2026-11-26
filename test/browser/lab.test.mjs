// The Refinery tab (tab 12): off by default and invisible then; the toggle,
// ?lab=1 and ?tab=12; its own worker beside the main engine; the inspector, bounds and the run
// against the bounds; Reset everything clears its keys.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const shown = (page, id) => page.$eval(`label[for="${id}"]`, (l) => !l.hidden);
const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const status = (page) => page.$eval('#lab-status', (e) => e.textContent);
const waitStatus = (page, re, timeout = 120000) => page.waitForFunction((r) => new RegExp(r).test(document.getElementById('lab-status').textContent), re.source, { timeout });

// Taken from the page before the lab existed (fresh visit, Advanced mode off).
// (in the order of the grouped tab row: Home, Write, Results, Learn)
const TABS_BEFORE = ['tab1', 'tab3', 'tab4', 'tab9', 'tab5', 'tab6', 'tab2'];
const CONTROL_IDS_BEFORE = ['project-info', 'edit-project-button', 'project-heading', 'project-description', 'project-readme', 'project-readme-body', 'project-form', 'project-title-input',
  'project-description-input', 'project-readme-input', 'save-project-info', 'cancel-project-info', 'library-section', 'library-filter', 'library-level', 'library-read', 'library', 'load-status',
  'storage-status', 'new-button', 'new-status', 'file-button', 'file-input', 'upload-status', 'download-button', 'include-history', 'keys-status', 'workspace-name', 'workspace-save-button', 'workspace-list',
  'workspace-status', 'snapshot-current', 'snapshot-status', 'snapshot-name', 'snapshot-save-button', 'snapshot-undo', 'snapshot-undo-text', 'snapshot-undo-button', 'snapshot-list-title',
  'snapshot-list', 'snapshot-others', 'download-recording-button', 'open-recording-button', 'recording-input', 'recording-status', 'share-button', 'share-status', 'export-standalone-button',
  'export-status', 'factory-reset-button',
  // the reorganised page: the library's "?", the dialogs' titles, Recordings as a target
  'library-help-button', 'library-help', 'dialog-versions-title', 'recordings', 'dialog-settings-title'].sort();

test('lab off (the default): the same tabs and Home as before, no lab code or worker loaded', async () => {
  const { page, context, errors, foreign } = await B.openPage(browser, server, '?fresh=1', { advanced: false });
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const tabs = await page.$$eval('label.tab-label', (ls) => ls.filter((l) => !l.hidden && getComputedStyle(l).display !== 'none').map((l) => l.getAttribute('for')));
  assert.deepEqual(tabs, TABS_BEFORE);
  // Home, and the dialogs that took over the rest of the old Control tab
  assert.deepEqual(await page.$$eval('#section-control [id], #dialog-versions [id], #dialog-settings [id]', (es) => es.map((e) => e.id).sort()), CONTROL_IDS_BEFORE);
  // the one visible change: the toggle, unticked
  assert.equal(await page.$eval('#dialog-settings .lab-checkbox', (c) => c.checked), false);
  assert.equal(await page.$$eval('.lab-checkbox', (l) => l.length), 1, 'only in Settings');
  assert.equal(await stored(page, 'cegarplay.lab'), null);
  await page.click('label[for="tab3"]');
  await page.waitForTimeout(300);
  assert.ok(!requests.some((u) => /\/js\/lab\//.test(u)), 'no lab module requested');
  assert.equal(await page.evaluate(() => !!window.cegarplay.lab), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(foreign, []);
  await context.close();
});

test('the toggle shows the Refinery tab and is remembered; ?lab=1 and ?tab=12 show it for the visit only', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?fresh=1', { advanced: false });
  assert.equal(await shown(page, 'tab12'), false);
  await B.inDialog(page, 'settings', () => page.check('#dialog-settings .lab-checkbox'));
  assert.equal(await shown(page, 'tab12'), true);
  assert.equal(await stored(page, 'cegarplay.lab'), '1');
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await shown(page, 'tab12'), true, 'remembered');
  await page.click('label[for="tab12"]');
  await page.waitForSelector('#lab-compute');
  assert.match(new URL(page.url()).search, /tab=12/);
  await page.evaluate(() => { const c = document.querySelector('#dialog-settings .lab-checkbox'); c.checked = false; c.dispatchEvent(new Event('change')); });
  assert.equal(await shown(page, 'tab12'), false);
  assert.equal(await page.$eval('#tab1', (r) => r.checked), true);
  assert.equal(await stored(page, 'cegarplay.lab'), null, 'absent when off');
  await context.close();
  for (const q of ['?fresh=1&lab=1', '?fresh=1&tab=12']) {
    const o = await B.openPage(browser, server, q, { advanced: false });
    assert.equal(await shown(o.page, 'tab12'), true, q);
    assert.equal(await stored(o.page, 'cegarplay.lab'), null, `${q}: nothing stored`);
    if (q.includes('tab=12')) { assert.equal(await o.page.$eval('#tab12', (r) => r.checked), true); await o.page.waitForSelector('#lab-compute'); }
    assert.deepEqual(o.errors, []);
    await o.context.close();
  }
  assert.deepEqual(errors, []);
});

test('free mode: space, inspector (verdict, atom table, option map, lattice), counterexamples, bounds with the histogram', async () => {
  const { page, context, errors, foreign } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=12&lab=1', { advanced: false });
  await page.waitForSelector('#lab-compute');
  assert.match(await page.textContent('#lab-inspect'), /Disabled until the space is computed/);
  await page.selectOption('#lab-source', 'free');
  await page.click('#lab-compute');
  await waitStatus(page, /^space: 256 candidates, 61 solutions, 195 bad, 8 interface atoms/);
  assert.match(await page.textContent('#lab-summary'), /sound on this instance/);
  await page.click('#lab-inspect-go');
  await page.waitForFunction(() => (document.getElementById('lab-verdict') || {}).textContent, null, { timeout: 60000 });
  assert.match(await page.textContent('#lab-verdict'), /has \d+ atoms? and removes \d+ candidates/);
  assert.equal(await page.$eval('#lab-verdict', (e) => e.getAttribute('aria-live')), 'polite');
  assert.equal(await page.$$eval('#lab-atom-table tbody tr', (r) => r.length), 8);
  assert.ok(await page.$$eval('#lab-option-map .lab-point', (r) => r.length) >= 2);
  assert.ok(await page.$('#lab-lattice'));
  await page.click('#lab-detail');
  await page.waitForSelector('#lab-cex-table', { timeout: 60000 });
  assert.ok(await page.$$eval('#lab-option-map .lab-justified', (r) => r.length) >= 1, 'justified points after the check');
  await page.click('#lab-compute-bounds');
  await page.waitForSelector('#lab-histogram', { timeout: 180000 });
  assert.match(await page.textContent('#lab-bounds-table'), /Best \(shortest run\)/);
  assert.match(await page.textContent('#lab-run'), /No recorded run of this instance yet|the loop scheme's bounds are needed/);
  // no sideways page scroll from 1400 px down to 400 px, with every part filled
  for (const width of [1400, 650, 400]) {
    await page.setViewportSize({ width, height: 900 });
    const [sw, iw] = await page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
    assert.ok(sw <= iw, `${width} px: page ${sw} px wide`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(foreign, []);
  await context.close();
});

test('from a run: gc-shape2 n3 recorded with every step; the run against the bounds; Run works while the Refinery computes; Cancel stops only the Refinery', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=gc-shape2&instance=n3&lab=1', { advanced: false });
  await page.click('label[for="tab4"]');
  await page.selectOption('#record-select', 'all');
  await B.runOptions(page, () => page.selectOption('#solutions-select', '0'));
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished']), 'finished');
  await page.click('label[for="tab12"]');
  await page.waitForSelector('#lab-compute');
  assert.equal(await page.$eval('#lab-instance', (s) => s.value), 'n3', 'starts from the run bar');
  await page.selectOption('#lab-source', 'latest');
  await page.click('#lab-compute');
  await waitStatus(page, /^space: 19 candidates/);
  await page.waitForSelector('#lab-step');
  await page.click('#lab-inspect-step');
  await page.waitForFunction(() => /recorded step/.test((document.getElementById('lab-status') || {}).textContent), null, { timeout: 60000 });
  assert.match(await page.textContent('#lab-verdict'), /The loop's clause has/);
  // bounds for the loop scheme; the main engine runs meanwhile
  await page.click('#lab-compute-bounds');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished']), 'finished', 'a run during the Refinery\'s computation');
  await page.waitForSelector('#lab-histogram', { timeout: 180000 });
  await page.click('#lab-compute-run');
  await page.waitForSelector('#lab-ladder', { timeout: 180000 });
  assert.match(await page.textContent('#lab-ladder-sentence'), /This run made 19 refinements/);
  assert.match(await page.textContent('#lab-decomposition'), /Abstraction looseness/);
  assert.ok(await page.$('#lab-regret'));
  // the shown line of the run bar is the run's, not the Refinery's
  assert.match(await page.textContent('#shown-line'), /run/i);
  // Cancel: a long computation of the lab stops; the run bar stays idle
  await page.click('#lab-limits summary'); await page.fill('#lab-limit-runs', '100000000');
  await page.dispatchEvent('#lab-limit-runs', 'change');
  await page.click('#lab-compute-bounds');
  // press Cancel during the simulation (between the two requests the button is briefly disabled)
  await page.waitForFunction(() => {
    const b = document.getElementById('lab-cancel');
    if (b.disabled || !/simulat/i.test(document.getElementById('lab-status').textContent)) return false;
    b.click();
    return true;
  }, null, { timeout: 120000 });
  await waitStatus(page, /cancelled/);
  assert.equal(await B.runState(page), 'finished');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Reset everything also removes the Refinery\'s keys', async () => {
  const { page, context } = await B.openPage(browser, server, '?fresh=1&tab=12', { advanced: false });
  await B.inDialog(page, 'settings', () => page.check('#dialog-settings .lab-checkbox'));
  await page.waitForSelector('#lab-compute');
  await page.selectOption('#lab-source', 'free');
  assert.equal(await stored(page, 'cegarplay.lab.source'), '"free"');
  page.once('dialog', (d) => d.accept());
  await B.openDialog(page, 'settings');
  await Promise.all([page.waitForNavigation(), page.click('#factory-reset-button')]);
  await page.waitForSelector('body[data-ready="true"]');
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cegarplay.lab'))), []);
  assert.equal(await shown(page, 'tab12'), false);
  await context.close();
});

test('review fixes: omniscient bounds and the run share no slot; a recording of another instance gives free mode; a request while busy keeps Cancel', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=gc-shape2&instance=n4&lab=1', { advanced: false });
  await page.click('label[for="tab4"]');
  await page.selectOption('#record-select', 'all');
  await B.runOptions(page, () => page.selectOption('#solutions-select', '0'));
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished']), 'finished');
  await page.click('label[for="tab12"]');
  await page.waitForSelector('#lab-compute');
  // the latest run is of n4; the Refinery's space of n3: no step lands on it, so free mode, without an error
  await page.selectOption('#lab-instance', 'n3');
  await page.selectOption('#lab-source', 'latest');
  await page.click('#lab-compute');
  await waitStatus(page, /^space: 19 candidates/);
  await page.waitForSelector('#lab-candidate');
  assert.match(await page.textContent('#lab-inspect'), /no refinement of a bad candidate on this space/);
  // a second request while the Refinery computes: refused, and Cancel stays available
  await page.click('#lab-limits summary');
  await page.fill('#lab-limit-runs', '100000000');
  await page.dispatchEvent('#lab-limit-runs', 'change');
  await page.click('#lab-compute-bounds');
  await page.waitForFunction(() => /simulat/i.test(document.getElementById('lab-status').textContent), null, { timeout: 120000 });
  await page.evaluate(() => window.cegarplay.lab.inspectCandidate(0));
  assert.match(await status(page), /the Refinery is still computing/);
  assert.equal(await page.$eval('#lab-cancel', (b) => b.disabled), false);
  await page.click('#lab-cancel');
  await waitStatus(page, /cancelled/);
  // omniscient bounds from Run bounds, then the scheme select: no error; the run's ladder uses them
  await page.fill('#lab-limit-runs', '200');
  await page.dispatchEvent('#lab-limit-runs', 'change');
  await page.selectOption('#lab-instance', 'n4');
  await page.click('#lab-compute');
  await waitStatus(page, /^space: 154 candidates/);
  await page.fill('#lab-limit-seconds', '5');
  await page.dispatchEvent('#lab-limit-seconds', 'change');
  await page.selectOption('#lab-scheme', 'loop');
  await page.click('#lab-compute-bounds');
  await page.waitForSelector('#lab-histogram', { timeout: 180000 });
  await page.click('#lab-compute-run');
  await page.waitForSelector('#lab-ladder', { timeout: 180000 });
  await page.selectOption('#lab-scheme', 'omniscient');
  assert.match(await page.textContent('#lab-bounds-body'), /No bounds for the omniscient scheme yet/);
  await page.click('#lab-compute-bounds');
  await page.waitForSelector('#lab-bounds-table', { timeout: 180000 });
  await page.click('#lab-compute-run');
  await page.waitForFunction(() => /refinements/.test((document.getElementById('lab-ladder-sentence') || {}).textContent || ''), null, { timeout: 180000 });
  assert.doesNotMatch(await page.textContent('#lab-decomposition'), /not known/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Record a run and place it, New seed, the busy line with Stop, and the run bar\'s "record steps"', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=gc-shape2&instance=n3&lab=1', { advanced: false });
  // the run bar's toggle: every step and every call, or no recording at all
  assert.equal(await page.isChecked('#run-record'), false);
  await B.runOptions(page, () => page.check('#run-record'));
  assert.equal(await page.$eval('#record-select', (s) => s.value), 'all');
  assert.equal(await page.isChecked('#record-calls'), true);
  assert.match(await page.textContent('#run-options-summary'), /recording/);
  // a finer choice in the Loop tab (steps without calls): a dash in the box, "partial recording"
  await page.click('label[for="tab4"]');
  await page.uncheck('#record-calls');
  assert.equal(await page.$eval('#run-record', (b) => [b.checked, b.indeterminate].join()), 'false,true');
  assert.match(await page.textContent('#run-options-summary'), /partial recording/);
  // ticked again: everything
  await B.runOptions(page, () => page.check('#run-record'));
  assert.equal(await page.isChecked('#record-calls'), true);
  assert.deepEqual(await page.evaluate(() => window.cegarplay.project.settings.record), { steps: 'all', n: 1000, calls: true });
  await B.runOptions(page, () => page.uncheck('#run-record'));
  assert.equal(await page.$eval('#record-select', (s) => s.value), 'off');
  assert.equal(await page.isChecked('#record-calls'), false);
  assert.equal(await page.evaluate(() => window.cegarplay.project.settings.record), undefined);
  await page.click('label[for="tab12"]');
  await page.selectOption('#lab-source', 'latest');
  await page.click('#lab-compute');
  await waitStatus(page, /^space: 19 candidates/);
  // no recording yet: the button runs, records, computes the loop bounds and places the run
  assert.match(await page.textContent('#lab-run'), /No recorded run of this instance yet/);
  await page.click('#lab-record-run');
  await page.waitForSelector('#lab-busy');
  await page.waitForSelector('#lab-ladder', { timeout: 180000 });
  assert.match(await page.textContent('#lab-ladder-sentence'), /This run made 19 refinements/);
  assert.equal(await page.$eval('#record-select', (s) => s.value), 'off', 'the project\'s Recording setting is unchanged');
  assert.match(await page.textContent('#lab-placed-of'), /seed 0/);
  // New seed: a random seed in the run bar, a randomized search, placed again
  await page.click('#lab-new-seed');
  await page.waitForFunction(() => document.getElementById('run-seed').value !== '0');
  const seed = await page.$eval('#run-seed', (e) => e.value);
  assert.equal(await page.isChecked('#run-randomize'), true);
  await page.waitForFunction((s) => { const e = document.getElementById('lab-placed-of'); return e && e.textContent.includes(`seed ${s} (randomized)`) && document.getElementById('lab-ladder'); }, seed, { timeout: 180000 });
  await page.waitForFunction(() => !document.getElementById('lab-busy'));
  // a long computation: the busy line sits next to the button that started it; Stop ends it
  await page.click('#lab-limits summary'); await page.fill('#lab-limit-runs', '100000000');
  await page.dispatchEvent('#lab-limit-runs', 'change');
  await page.click('#lab-compute-bounds');
  await page.waitForFunction(() => { const b = document.getElementById('lab-busy'); return b && /simulat/i.test(b.textContent); }, null, { timeout: 120000 });
  assert.equal(await page.$eval('#lab-busy', (b) => !!b.previousElementSibling.querySelector('#lab-compute-bounds')), true);
  await page.click('#lab-busy-stop');
  await waitStatus(page, /cancelled/);
  assert.equal(await page.$('#lab-busy'), null);
  assert.deepEqual(errors, []);
  await context.close();
});

// CI failure 2026-11-25: the bounds were ready before the page's run ended, the run's part was drawn
// without a recording and never again, so Place this run did not appear. Here in that order on purpose.
test('a run of the page that ends after the bounds: the run\'s part follows it (Place this run appears)', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=gc-shape2&instance=n3&lab=1', { advanced: false });
  await page.click('label[for="tab12"]');
  await page.selectOption('#lab-source', 'latest');
  await page.click('#lab-compute');
  await waitStatus(page, /^space: 19 candidates/);
  await page.click('#lab-compute-bounds');
  await page.waitForSelector('#lab-histogram', { timeout: 180000 });
  assert.match(await page.textContent('#lab-run'), /No recorded run of this instance yet/);
  assert.equal(await page.$('#lab-step'), null, 'the inspector is in free mode');
  await B.runOptions(page, () => page.check('#run-record'));
  await B.runOptions(page, () => page.selectOption('#solutions-select', '0'));
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished']), 'finished');
  await page.waitForSelector('#lab-compute-run', { timeout: 30000 });
  await page.waitForSelector('#lab-step', { timeout: 30000 });
  await page.click('#lab-compute-run');
  await page.waitForSelector('#lab-ladder', { timeout: 180000 });
  assert.match(await page.textContent('#lab-ladder-sentence'), /This run made 19 refinements/);
  assert.deepEqual(errors, []);
  await context.close();
});
