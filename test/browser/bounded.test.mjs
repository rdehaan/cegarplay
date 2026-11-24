// PLAN3 phase S8: the audit modes Symbolic and Space in the page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as B from './harness.mjs';

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); });
after(async () => { await browser.close(); server.close(); });

const settled = (page) => page.waitForFunction(() => ['finished', 'error', 'aborted'].includes(document.getElementById('run-status').dataset.state) &&
  !window.cegarplay.control.batch);
const historyAudit = (page) => page.$$eval('#history-table tr', (rows) => {
  const k = [...rows[0].children].findIndex((th) => th.textContent === 'Audit');
  return rows.slice(1).map((r) => r.children[k].textContent);
});

test('S8: the symbolic audit of tutorial-weak-relevant shows "unsound" with its witness', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant');
  await page.selectOption('#audit-mode', 'symbolic');
  assert.equal(await page.isVisible('#space-select'), false);
  await page.click('#audit-button');
  await settled(page);
  assert.equal(await page.$eval('#audit-panel', (e) => e.dataset.verdict), 'unsound');
  assert.equal(await page.$eval('#audit-panel', (e) => e.dataset.mode), 'symbolic');
  const text = await page.textContent('#audit-panel');
  assert.match(text, /Symbolic audit: unsound/);
  assert.match(text, /Relevant\{pick\(2\)\}/);
  assert.match(text, /They differ on\{pick\(1\)\}/);
  assert.match(await page.textContent('#result-line'), /Symbolic audit: unsound/);
  assert.deepEqual(await historyAudit(page), ['unsound (symbolic)']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('S8: a space audit shows its k; the witness instance can be saved', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run');
  await page.selectOption('#audit-mode', 'space');
  assert.equal(await page.isVisible('#space-select'), true);
  assert.equal(await page.$eval('#space-bound', (e) => e.value), '10');
  await page.fill('#space-bound', '4');
  await page.click('#audit-button');
  await settled(page);
  assert.equal(await page.$eval('#audit-panel', (e) => e.dataset.mode), 'space');
  assert.match(await page.textContent('#audit-panel'), /Space n: sound up to n = 4/);
  assert.deepEqual(await historyAudit(page), ['sound ≤ 4']);
  // the too weak variant breaks at n = 2; its instance is kept as a regression instance
  await page.goto(server.url + 'index.html?nocoi=1&example=tutorial-weak-relevant');
  await page.waitForSelector('body[data-ready="true"]');
  await page.selectOption('#audit-mode', 'space');
  await page.click('#audit-button');
  await settled(page);
  assert.equal(await page.$eval('#audit-panel', (e) => e.dataset.verdict), 'unsound');
  assert.match(await page.textContent('#audit-panel'), /Space n: unsound at n = 2/);
  await page.$eval('#audit-panel .save-witness', (b) => b.click());   // the panel is in the Output tab
  const inst = await page.evaluate(() => window.cegarplay.project.instances.map((x) => [x.id, x.constants]));
  assert.deepEqual(inst, [['regression', { n: '2' }]]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('S8: a project without spaces offers no Space mode', async () => {
  const { page, context } = await B.openPage(browser, server, '?example=gc-shape3');
  const opt = await page.$eval('#audit-mode-space', (o) => ({ hidden: o.hidden, disabled: o.disabled }));
  assert.deepEqual(opt, { hidden: true, disabled: true });
  // and the Instances tab lists the spaces of a project that has them
  await page.goto(server.url + 'index.html?nocoi=1&example=af-preferred&tab=9');
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.$eval('#space-list-select', (s) => s.value), 'frameworks');
  assert.equal(await page.$eval('#space-name', (s) => s.value), 'frameworks');
  assert.equal(await page.$eval('#audit-mode-space', (o) => o.hidden), false);
  await context.close();
});

test('S8: Stop ends a long symbolic audit on an isolated page (the verifier polls like the runtime)', async () => {
  const coi = await B.startServer({ coi: true });
  try {
    const { page, context, errors } = await B.openPage(browser, coi, '?nocoi=1&example=slitherlink', { coi: true });
    assert.equal(await page.evaluate(() => self.crossOriginIsolated), true);
    await page.selectOption('#audit-mode', 'symbolic');
    await page.click('#audit-button');
    await B.waitState(page, ['running']);
    await page.waitForTimeout(2500);
    const t0 = Date.now();
    await page.click('#stop-button');
    await page.waitForFunction(() => ['finished', 'error', 'aborted'].includes(document.getElementById('run-status').dataset.state), null, { timeout: 10000 });
    assert.ok(Date.now() - t0 < 5000, 'stopped within seconds');
    assert.equal(await B.runState(page), 'finished');
    assert.match(await page.textContent('#result-line'), /Symbolic audit ended without a verdict: stopped/);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { coi.close(); }
});

test('UI: modes a loop does not support are marked with the reason; next steps; space preview', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=gc-shape3');
  await page.hover('#audit-button');
  const sym = await page.$eval('#audit-mode option[value="symbolic"]', (o) => [o.textContent, o.title]);
  assert.match(sym[0], /not for this loop/);
  assert.match(sym[1], /expand/);
  // af-preferred: the space select names its description; a sound space offers a larger bound
  await page.goto(server.url + 'index.html?nocoi=1&example=af-preferred');
  await page.waitForSelector('body[data-ready="true"]');
  await page.selectOption('#audit-mode', 'space');
  assert.equal(await page.$eval('#space-select', (s) => s.options[s.selectedIndex].textContent), 'frameworks');
  assert.match(await page.textContent('#space-description'), /^Every argumentation framework/);
  assert.equal(await page.isVisible('#space-description'), true);
  await page.fill('#space-bound', '3');
  await page.click('#audit-button');
  await settled(page);
  assert.match(await page.textContent('#audit-panel .space-steps'), /Per size: 1-3 sound \(1 round each\)/);
  assert.deepEqual(await page.$$eval('#audit-panel .audit-next button', (bs) => bs.map((b) => b.dataset.action)), ['larger-bound']);
  // an enumerative audit that is sound offers the space
  await page.selectOption('#audit-mode', 'enumerate');
  await page.click('#audit-button');
  await settled(page);
  assert.deepEqual(await page.$$eval('#audit-panel .audit-next button', (bs) => bs.map((b) => b.dataset.action)), ['space']);
  // the Spaces editor: the bound named by its own name; Preview shows instances as facts
  await page.evaluate(() => { const t = document.getElementById('tab9'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.$eval('#space-params .space-bound-pick:checked', (r) => r.value), 'size');
  await page.fill('#space-preview-k', '2');
  await page.click('#preview-space-button');
  await page.waitForSelector('[data-space-instance="6"]');
  assert.match(await page.textContent('#space-status'), /6 of more instances at size = 2/);
  assert.match(await page.textContent('[data-space-instance="1"]'), /arg\(1\)\.\s*arg\(2\)\./);
  assert.deepEqual(errors, []);
  await context.close();
});

test('UI: the Instances tab shows an instance\'s expected symbolic verdict', async () => {
  const { page, context } = await B.openPage(browser, server, '?example=exercise-sum-free&tab=9');
  assert.match(await page.textContent('#instances-table'), /symbolic audit: unsound/);
  assert.match(await page.textContent('#instance-symbolic'), /Expected verdict of the symbolic audit on this instance: unsound/);
  await context.close();
});

test('UI: the audit mode, space and bound are kept with the project (settings.audit) across a reload', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-weak-relevant');
  const stored = () => page.evaluate(() => { const t = localStorage.getItem('cegarplay.project'); return t && JSON.parse(t).settings.audit; });
  await page.selectOption('#audit-mode', 'symbolic');
  await page.waitForFunction(() => /"audit"/.test(localStorage.getItem('cegarplay.project') || ''));
  assert.deepEqual(await stored(), { mode: 'symbolic' });
  // no example in the URL: the page restores the autosaved project, with its audit mode
  await page.goto(server.url + 'index.html?nocoi=1');
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.$eval('#audit-mode', (e) => e.value), 'symbolic');
  // a space and its bound too
  await page.selectOption('#audit-mode', 'space');
  await page.fill('#space-bound', '3');
  await page.dispatchEvent('#space-bound', 'change');
  await page.waitForFunction(() => /"bound": 3/.test(localStorage.getItem('cegarplay.project') || ''));
  assert.deepEqual(await stored(), { mode: 'space', space: 'n', bound: 3 });
  await page.goto(server.url + 'index.html?nocoi=1');
  await page.waitForSelector('body[data-ready="true"]');
  assert.deepEqual(await page.evaluate(() => ['audit-mode', 'space-select', 'space-bound'].map((id) => document.getElementById(id).value)), ['space', 'n', '3']);
  assert.equal(await page.isVisible('#space-bound'), true);
  // back to enumeration: nothing is written; another example starts from enumeration
  await page.selectOption('#audit-mode', 'enumerate');
  await page.waitForFunction(() => !/"audit"/.test(localStorage.getItem('cegarplay.project') || ''));
  await page.selectOption('#audit-mode', 'symbolic');
  await page.evaluate(() => window.cegarplay.loadExample('tutorial-first-run'));
  await page.waitForFunction(() => document.getElementById('audit-mode').value === 'enumerate');
  assert.deepEqual(errors, []);
  await context.close();
});

test('UI: a space\'s First k: the audit starts there, the bar and the verdict say so', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=9');
  assert.equal(await page.$eval('#space-from', (e) => e.value), '1');
  await page.fill('#space-from', '3');
  await page.dispatchEvent('#space-from', 'change');
  assert.equal(await page.evaluate(() => window.cegarplay.project.spaces[0].from), 3);
  await page.selectOption('#audit-mode', 'space');
  assert.equal(await page.textContent('#space-bound-label'), 'every instance with n = 3 up to');
  await page.fill('#space-bound', '5');
  await page.click('#audit-button');
  await settled(page);
  const text = await page.textContent('#audit-panel');
  assert.match(text, /Space n: sound up to n = 5/);
  assert.match(text, /every instance of the space for n from 3 up to 5 was checked/);
  assert.match(text, /Per n: 3-5 sound/);
  // back to 1: the field is dropped again
  await page.fill('#space-from', '1');
  await page.dispatchEvent('#space-from', 'change');
  assert.equal(await page.evaluate(() => 'from' in window.cegarplay.project.spaces[0]), false);
  assert.equal(await page.textContent('#space-bound-label'), 'every instance with n up to');
  assert.deepEqual(errors, []);
  await context.close();
});

test('UI: the space editor picks the bound by name, takes a value or a range, and chooses the regression constants', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=tutorial-first-run&tab=9');
  page.on('dialog', (d) => d.accept('m'));
  await page.click('#add-space-param-button');
  const sp = () => page.evaluate(() => structuredClone(window.cegarplay.project.spaces[0]));
  assert.deepEqual(Object.keys((await sp()).params), ['n', 'm']);
  // a range for m
  await page.fill('#space-params .space-param-value[data-param="m"]', '1..3');
  await page.dispatchEvent('#space-params .space-param-value[data-param="m"]', 'change');
  assert.deepEqual((await sp()).ranges, { m: [1, 3] });
  await page.fill('#space-params .space-param-value[data-param="m"]', 'x');
  await page.dispatchEvent('#space-params .space-param-value[data-param="m"]', 'change');
  assert.match(await page.textContent('#space-status'), /m: a whole number, or a range lo\.\.hi/);
  // m stays out of a regression instance
  await page.uncheck('#space-params .space-param-keep[data-param="m"]');
  assert.deepEqual((await sp()).regression, { m: false });
  // the run bar names the bound, and says that the space audit uses no instance
  await page.selectOption('#audit-mode', 'space');
  assert.equal(await page.textContent('#space-bound-label'), 'every instance with n up to');
  assert.match(await page.textContent('#instance-select-label'), /the space audit uses none/);
  // a witness at n = 2, m = 3: the instance gets n but not m
  const id = await page.evaluate(() => window.cegarplay.instancesTab.saveWitness({ space: 'n', k: 2, bound: 'n', params: { m: 3 }, witness: { instance: '' } }));
  assert.deepEqual(await page.evaluate((x) => window.cegarplay.project.instances.find((i) => i.id === x).constants, id), { n: '2' });
  // m becomes the bound: the run bar follows
  await page.check('#space-params .space-bound-pick[value="m"]');
  assert.equal((await sp()).bound, 'm');
  assert.equal((await sp()).ranges, undefined);
  assert.equal(await page.textContent('#space-bound-label'), 'every instance with m up to');
  await page.selectOption('#audit-mode', 'enumerate');
  assert.equal(await page.textContent('#instance-select-label'), 'Instance:');
  assert.deepEqual(errors, []);
  await context.close();
});
