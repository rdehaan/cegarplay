// Browser test harness: a static server on a free port and a Chromium page that records
// console errors and requests to other origins.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { chromium } from 'playwright';

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

export async function launch() {
  return chromium.launch();
}

export async function openPage(browser, server, query = '', { acceptDownloads = true } = {}) {
  const context = await browser.newContext({ acceptDownloads });
  const page = await context.newPage();
  const errors = [], foreign = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(server.url) && !u.startsWith('blob:') && !u.startsWith('data:')) foreign.push(u); });
  await page.goto(server.url + 'index.html' + query);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  return { page, context, errors, foreign };
}

export const runState = (page) => page.$eval('#run-status', (e) => e.dataset.state);
export async function waitState(page, states, timeout = 60000) {
  await page.waitForFunction((s) => s.includes(document.getElementById('run-status').dataset.state), states, { timeout });
  return runState(page);
}
export const setEditor = (page, id, text) => page.evaluate(([i, t]) => ace.edit(document.getElementById(i)).setValue(t, -1), [id, text]);
export const getEditor = (page, id) => page.evaluate((i) => ace.edit(document.getElementById(i)).getValue(), id);
