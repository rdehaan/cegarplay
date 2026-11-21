// The colour theme (js/theme.js, css/theme.css, js/theme-cegarplay-dark.js) in the page.
// Screenshots of every tab in both themes go to test/screenshots/theme/ (git-ignored) for a look by eye.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as B from './harness.mjs';

const SHOTS = new URL('../screenshots/theme/', import.meta.url).pathname;
const GUIDE = fs.existsSync(new URL('../../guide/index.html', import.meta.url));

let server, browser;
before(async () => { server = await B.startServer(); browser = await B.launch(); fs.mkdirSync(SHOTS, { recursive: true }); });
after(async () => { await browser.close(); server.close(); });

// Relative luminance of a computed rgb()/rgba() colour; null for a transparent one.
const LUMA = `(c) => {
  const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(',').map(Number); if (a < 0.3) return null;
  const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}`;
const bodyLuma = (page) => page.evaluate(`(${LUMA})(getComputedStyle(document.body).backgroundColor)`);
const editorState = (page) => page.evaluate(`(() => {
  const e = document.querySelector('#section-programs .ace_editor');
  return { dark: e.classList.contains('ace-cegarplay-dark'), luma: (${LUMA})(getComputedStyle(e).backgroundColor) };
})()`);
const withTheme = (mode) => async (context) => {
  await context.addInitScript((m) => { if (!sessionStorage.getItem('theme-set')) { localStorage.setItem('cegarplay.theme', m); sessionStorage.setItem('theme-set', '1'); } }, mode);
  return context;
};
async function open(query, { colorScheme = 'light', stored } = {}) {
  const context = await browser.newContext({ colorScheme });
  if (stored) await withTheme(stored)(context);
  return B.openPage(browser, server, query, { context });
}

test('a dark system gives a dark page and dark editors', async () => {
  const { page, context, errors } = await open('?tab=3', { colorScheme: 'dark' });
  assert.ok(await bodyLuma(page) < 0.05, 'page background');
  const ed = await editorState(page);
  assert.ok(ed.dark && ed.luma < 0.05, JSON.stringify(ed));
  assert.equal(await page.textContent('#theme-button'), '◐ Auto');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the stored setting light wins over a dark system', async () => {
  const { page, context, errors } = await open('?tab=3', { colorScheme: 'dark', stored: 'light' });
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  assert.ok(await bodyLuma(page) > 0.7);
  const ed = await editorState(page);
  assert.ok(!ed.dark && ed.luma > 0.9, JSON.stringify(ed));
  assert.deepEqual(errors, []);
  await context.close();
});

test('the toggle cycles auto, light, dark, switches the editors at once and persists', async () => {
  const { page, context, errors } = await open('?tab=3');
  const state = () => page.evaluate(() => [document.documentElement.dataset.theme || 'auto', localStorage.getItem('cegarplay.theme')]);
  assert.deepEqual(await state(), ['auto', null]);
  await page.click('#theme-button');
  assert.deepEqual(await state(), ['light', 'light']);
  await page.click('#theme-button');
  assert.deepEqual(await state(), ['dark', 'dark']);
  assert.ok((await editorState(page)).dark, 'editor switched without reload');
  assert.ok(await bodyLuma(page) < 0.05);
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.deepEqual(await state(), ['dark', 'dark']);
  assert.ok((await editorState(page)).dark);
  assert.equal(await page.textContent('#theme-button'), '☾ Dark');
  await page.click('#theme-button');
  assert.deepEqual(await state(), ['auto', null]);
  assert.ok(!(await editorState(page)).dark);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the setting made in the app applies on a guide page', { skip: !GUIDE && 'no guide yet' }, async () => {
  const { page, context } = await open('?tab=1');
  await page.click('#theme-button');
  await page.click('#theme-button');
  const guide = await context.newPage();
  await guide.goto(server.url + 'guide/index.html');
  assert.equal(await guide.getAttribute('html', 'data-theme'), 'dark');
  assert.ok(await bodyLuma(guide) < 0.05);
  await context.close();
});

// Elements whose own background is light although the page is dark (a white panel left over).
const LIGHT_BOXES = `(() => {
  const luma = ${LUMA};
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    if (!e.getClientRects().length || e.closest('[hidden]')) continue;
    const l = luma(getComputedStyle(e).backgroundColor);
    if (l !== null && l > 0.3) out.push((e.id ? '#' + e.id : e.tagName.toLowerCase()) + '.' + [...e.classList].join('.') + ' ' + l.toFixed(2));
  }
  return out;
})()`;

for (const theme of ['light', 'dark']) {
  test(`screenshots of every tab in the ${theme} theme`, async () => {
    const { page, context, errors } = await open('?example=clique-interdiction&internals=true&manual=true&tab=1', { colorScheme: theme });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click('#run-button');
    await B.waitState(page, ['finished']);
    for (const t of [1, 2, 3, 4, 5, 6, 7, 8]) {
      await page.click(`label[for="tab${t}"]`);
      await page.waitForTimeout(t === 2 || t === 8 ? 600 : 150);
      await page.screenshot({ path: `${SHOTS}${theme}-tab${t}.png`, fullPage: true });
      if (theme === 'dark') assert.deepEqual(await page.evaluate(LIGHT_BOXES), [], `light boxes on tab ${t}`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  });
}
