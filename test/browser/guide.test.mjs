// The guide in the browser: pages render in both themes and at phone width, and the deep links
// (?example=…&fragment=…&from=…) open the right place in the playground.
// Screenshots go to test/screenshots/guide/ (git-ignored) for a look by eye.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as B from './harness.mjs';

const SHOTS = new URL('../screenshots/guide/', import.meta.url).pathname;
const PAGES = fs.readdirSync(new URL('../../guide/', import.meta.url)).filter((f) => f.endsWith('.html')).sort();
const NUMBERS = JSON.parse(fs.readFileSync(new URL('../../guide/numbers.json', import.meta.url), 'utf8'));

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); fs.mkdirSync(SHOTS, { recursive: true }); });
after(async () => { await browser.close(); server.close(); });

const LUMA = `(c) => {
  const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(',').map(Number); if (a < 0.3) return null;
  const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}`;
const luma = (page, sel) => page.$eval(sel, (e, L) => (0, eval)(L)(getComputedStyle(e).backgroundColor), LUMA);

const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };

for (const scheme of ['light', 'dark']) {
  for (const [size, viewport] of Object.entries(SIZES)) {
    test(`guide pages render in ${scheme} at ${size} width`, async () => {
      const context = await browser.newContext({ colorScheme: scheme, viewport });
      for (const f of PAGES) {
        const { page, errors, foreign } = await B.openPage(browser, server, '', { context, path: `guide/${f}` });
        await page.waitForLoadState('networkidle');
        assert.deepEqual(errors, [], `${f}: console errors`);
        assert.deepEqual(foreign, [], `${f}: requests to another origin`);
        assert.ok(await page.$$eval('#chapters li', (l) => l.length) >= 2, `${f}: chapter nav`);
        if (await page.$('pre.code')) assert.ok(await page.$('pre.code span[class^="tok-"]'), `${f}: highlighting`);
        for (const fig of await page.$$('figure.graph')) assert.ok(await fig.$('svg.graph-svg circle'), `${f}: graph figure`);
        const bg = await luma(page, 'article');
        if (scheme === 'dark') assert.ok(bg < 0.05, `${f}: article background ${bg}`);
        else assert.ok(bg > 0.9, `${f}: article background ${bg}`);
        // No horizontal scroll of the page at phone width.
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 1, `${f}: page is ${over}px wider than the window`);
        await page.screenshot({ path: `${SHOTS}${f.replace('.html', '')}-${scheme}-${size}.png`, fullPage: true });
        await page.close();
      }
      await context.close();
    });
  }
}

test('a guide page without JavaScript still has its previous/next links and its text', async () => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const { page } = await B.openPage(browser, server, '', { context, path: 'guide/01-why-a-loop.html' });
  assert.ok(await page.$('nav.pager a.prev'));
  assert.ok(await page.isVisible('h1'));
  await page.screenshot({ path: `${SHOTS}01-why-a-loop-nojs.png`, fullPage: true });
  await context.close();
});

test('a deep link opens the named fragment and shows the way back to the guide', async () => {
  const from = 'guide/03-learning.html%23hit-clique';
  const { page, context, errors } = await B.openPage(browser, server, `?example=guide-03-hit-clique&fragment=check&from=${from}`);
  assert.ok(await page.isChecked('#tab3'), 'Programs tab');
  assert.ok(await page.$('.fragment.fragment-target[data-fragment="check"]'));
  assert.ok(await page.isVisible('#back-to-guide'));
  assert.equal(await page.getAttribute('#back-to-guide', 'href'), 'guide/03-learning.html#hit-clique');
  await page.click('#back-to-guide');
  await page.waitForURL(/guide\/03-learning\.html#hit-clique$/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('fragment=loop opens the Loop tab; an unknown fragment is ignored with a note; fragment overrides tab', async () => {
  let o = await B.openPage(browser, server, '?example=guide-03-hit-clique&fragment=loop&tab=5');
  assert.ok(await o.page.isChecked('#tab4'));
  await o.context.close();
  o = await B.openPage(browser, server, '?example=guide-03-hit-clique&fragment=nosuch');
  assert.match(await o.page.textContent('#load-status'), /no fragment "nosuch"/);
  assert.ok(!(await o.page.isChecked('#tab3')));
  assert.deepEqual(o.errors, []);
  await o.context.close();
});

test('a from= that is not a guide page shows no link', async () => {
  for (const bad of ['https://example.org/', 'javascript:alert(1)', 'guide/../index.html', '//example.org/guide/x.html',
    'guide/01-why-a-loop.html%23a%22onmouseover%3D1', 'Guide/01.html']) {
    const { page, context } = await B.openPage(browser, server, `?example=guide-03-hit-clique&from=${encodeURIComponent(bad)}`);
    assert.ok(!(await page.isVisible('#back-to-guide')), bad);
    assert.equal(await page.getAttribute('#back-to-guide', 'href'), 'guide/', bad);
    await context.close();
  }
});

test('the library shows a "Guide page" link for guide examples', async () => {
  const { page, context } = await B.openPage(browser, server, '?tab=1');
  await B.openLibrary(page);
  const href = await page.getAttribute('.library-entry[data-example="guide-03-hit-clique"] .library-guide-link', 'href');
  assert.equal(href, 'guide/03-learning.html#hit-clique');
  await context.close();
});

test('a guide example run in the page gives the candidate count of numbers.json', async () => {
  const id = 'guide-03-hit-clique';
  const { page, context, errors } = await B.openPage(browser, server, `?example=${id}`);
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'stopped']), 'finished');
  const s = await page.evaluate(() => window.cegarplay.stats.S);
  assert.equal(s.candidates, NUMBERS[id].candidates);
  assert.equal(s.solutions, NUMBERS[id].solutions);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the soundness test of page 4: one changed loop line, and the run history marks both runs', async () => {
  const { page, context, errors } = await B.openPage(browser, server, '?example=guide-04-one-node&fragment=loop');
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'stopped']), 'finished');
  const loop = await B.getEditor(page, 'loop-editor');
  assert.match(loop, /reject M with G\.clause\(M, X\)/);
  await B.setEditor(page, 'loop-editor', loop.replace('reject M with G.clause(M, X)', 'reject M with G.block(M)'));
  await page.click('#run-button');
  assert.equal(await B.waitState(page, ['finished', 'error', 'stopped']), 'finished');
  await page.click('label[for="tab6"]');
  const rows = await page.$$eval('#history-table tbody tr', (l) => l.map((r) => ({ m: r.dataset.mismatch === 'true', text: r.textContent })));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.m && r.text.includes('⚠')), JSON.stringify(rows));
  assert.deepEqual(errors, []);
  await context.close();
});
