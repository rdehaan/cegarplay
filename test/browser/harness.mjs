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
// advanced: open the page in Advanced mode (Observatory and Campaign tabs), as most tests need;
// the stored choice is set before the page's scripts run. advanced: false leaves storage alone.
export async function openPage(browser, server, query = '', { acceptDownloads = true, coi = false, contextOptions = {}, path = 'index.html', context: given, advanced = true } = {}) {
  if (!coi) query = query ? query + '&nocoi=1' : '?nocoi=1';
  const context = given || await browser.newContext({ acceptDownloads, ...contextOptions });
  const page = await context.newPage();
  if (advanced) await page.addInitScript(() => { try { if (localStorage.getItem('cegarplay.advanced') === null) localStorage.setItem('cegarplay.advanced', '1'); } catch { /* no storage */ } });
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
