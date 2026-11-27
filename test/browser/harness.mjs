// Browser test harness: a static server on a free port and a Chromium page that records
// console errors and requests to other origins.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { chromium, firefox } from 'playwright';

const ROOT = new URL('../..', import.meta.url).pathname;

async function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

export async function startServer({ coi = false } = {}) {
  const port = await freePort();
  const args = [new URL('../serve.py', import.meta.url).pathname, String(port)];
  if (coi) args.push('coi');
  const proc = spawn('python3', args, { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    const ok = await new Promise((res) => { const c = net.connect(port, '127.0.0.1', () => { c.end(); res(true); }); c.on('error', () => res(false)); });
    if (ok) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return { url: `http://127.0.0.1:${port}/`, port, close: () => proc.kill() };
}

// CHROMIUM_PATH: a Chromium binary to use instead of Playwright's own download (for machines
// with a preinstalled browser of another Playwright version, e.g. cloud sessions).
export async function launch() {
  if (process.env.BROWSER === 'firefox') return firefox.launch();
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

// By default the page is opened with ?nocoi=1 (not isolated); pass { coi: true } to let the
// service worker shim isolate it (the page reloads once).
// contextOptions go to browser.newContext (for instance { colorScheme: 'dark' }); path is the page to open.
// advanced: open the page with the Observatory and Campaign tabs shown, as most tests need;
// the stored choice is set before the page's scripts run. advanced: false leaves storage alone.
export async function openPage(browser, server, query = '', { acceptDownloads = true, coi = false, contextOptions = {}, path = 'index.html', context: given, advanced = true, tour = false } = {}) {
  if (!coi) query = query ? query + '&nocoi=1' : '?nocoi=1';
  const context = given || await browser.newContext({ acceptDownloads, ...contextOptions });
  const page = await context.newPage();
  // the guided tour is offered on a first visit; tests that do not ask for it have seen it
  if (!tour) await page.addInitScript(() => {
    try { for (const k of ['cegarplay.tour', 'cegarplay.tour.observatory', 'cegarplay.tour.campaign', 'cegarplay.tour.refinery']) if (localStorage.getItem(k) === null) localStorage.setItem(k, '"seen"'); } catch { /* no storage */ }
  });
  if (advanced) {
    await page.addInitScript(() => {
      try {
        const keys = ['cegarplay.campaign', 'cegarplay.observatory'];
        if (keys.every((k) => localStorage.getItem(k) === null)) { localStorage.setItem('cegarplay.campaign', '1'); localStorage.setItem('cegarplay.observatory', '1'); }
      } catch { /* no storage */ }
    });
  }
  const errors = [], foreign = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/chrome:\/\/juggler/.test(m.text())) errors.push(m.text()); });  // juggler: Playwright's Firefox instrumentation
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(server.url) && !u.startsWith('blob:') && !u.startsWith('data:')) foreign.push(u); });
  await page.goto(server.url + path + query);
  if (coi) {
    for (let i = 0; i < 100; i++) {
      const iso = await page.evaluate(() => self.crossOriginIsolated && document.body.dataset.ready === 'true').catch(() => false);
      if (iso) { errors.length = 0; break; }   // errors of the first document, discarded by the shim's reload
      await page.waitForTimeout(100);
    }
  }
  if (path === 'index.html') await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  return { page, context, errors, foreign };
}

export const runState = (page) => page.$eval('#run-status', (e) => e.dataset.state);
export async function waitState(page, states, timeout = 60000) {
  await page.waitForFunction((s) => s.includes(document.getElementById('run-status').dataset.state), states, { timeout });
  return runState(page);
}
export const setEditor = (page, id, text) => page.evaluate(([i, t]) => ace.edit(document.getElementById(i)).setValue(t, -1), [id, text]);
export const getEditor = (page, id) => page.evaluate((i) => ace.edit(document.getElementById(i)).getValue(), id);
// The example library is folded by default: unfold the section and every group.
export const openLibrary = (page) => page.evaluate(() => {
  for (const d of document.querySelectorAll('#library-section, .library-group')) d.open = true;
});

// The top bar keeps solutions, seed, randomized and record steps under Run options: open it.
// Each use opens it, does one thing and closes it again (an open pop-up covers part of the page).
export async function runOptions(page, action) {
  if (await page.isHidden('#run-options')) await page.click('#run-options-button');
  await action();
  if (await page.isVisible('#run-options')) await page.keyboard.press('Escape');
}

// The Project menu presses the hidden file buttons: choose the item that presses button `id`
// (history: the Download item with or without the run history).
export async function projectMenu(page, id, { history } = {}) {
  if (await page.isHidden('#project-menu')) await page.click('#project-menu-button');
  const h = history === undefined ? '' : `[data-history="${history ? 1 : 0}"]`;
  await page.click(`#project-menu .menu-item[data-click="${id}"]${h}`);
}

// The dialogs: Settings ('settings') and Workspace, snapshots and recordings ('versions').
export async function openDialog(page, name) {
  const sel = `#dialog-${name}`;
  if (!(await page.$eval(sel, (d) => d.open))) {
    if (name === 'settings') await page.click('#settings-button');
    else { await page.click('#project-menu-button'); await page.click('#project-menu .menu-item[data-dialog="dialog-versions"]:not([data-scroll])'); }
  }
}
export async function closeDialog(page, name) {
  await page.evaluate((id) => { const d = document.getElementById(id); if (d.open) d.close(); }, `dialog-${name}`);
}
// Open a dialog, do one thing, close it again.
export async function inDialog(page, name, action) {
  await openDialog(page, name);
  const r = await action();
  await closeDialog(page, name);
  return r;
}
