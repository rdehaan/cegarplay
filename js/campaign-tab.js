// Campaign tab (tab 10, docs/spec-instances.md section 5): a suite editor, Start / Pause /
// Resume / Abort, a progress grid, four plots and a growth fit, on rows kept in IndexedDB.
import { runSuite, expandSuite, cellKey, inconsistencies, scaling, growthFit, solvedCurves, SuiteError, engineTag, resultMatrix, matrixCSV } from './campaign.js';
import { Pool, defaultPoolSize } from './pool.js';
import { IdbStore, MemoryStore, exportRows, importRows } from './store.js';
import { fmt } from './output.js';

const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k);
  return e;
};
const svg = (tag, attrs = {}, text) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
const COLORS = ['--chart-2', '--chart-1', '--chart-3', '--chart-4', '--chart-6', '--chart-5', '--chart-7'];
const OUTCOME_COLOR = { finished: '--call-sat', limit: '--call-int', timeout: '--call-int', error: '--call-unsat', trap: '--call-unsat', invalid: '--call-unsat', skipped: '--chart-rest', aborted: '--chart-ground' };

// A suite names "no variant" 'default' (the file's key); the page says (no variant).
const vname = (v) => (v === 'default' ? '(no variant)' : v);

export class CampaignTab {
  constructor(app) {
    this.app = app;
    this.root = $('campaign');
    this.rows = [];
    this.running = null;
    this.storeP = (typeof indexedDB !== 'undefined' ? IdbStore.open().catch(() => new MemoryStore()) : Promise.resolve(new MemoryStore()));
    this.build();
  }

  get suites() { return this.app.project.suites || (this.app.project.suites = []); }
  get suite() { return this.suites.find((s) => s.name === this.current) || null; }

  build() {
    this.root.textContent = '';
    this.select = h('select', { id: 'suite-select', 'aria-label': 'Suite' });
    this.select.addEventListener('change', () => { this.current = this.select.value; this.showSuite(); this.refresh(); });
    this.text = h('textarea', { id: 'suite-text', rows: 9, spellcheck: 'false', 'aria-label': 'Suite (JSON)' });
    this.text.addEventListener('change', () => this.saveText());
    this.status = h('p', { id: 'campaign-status', class: 'note', role: 'status', 'aria-live': 'polite' });
    this.jobs = h('input', { id: 'campaign-jobs', size: 3, inputmode: 'numeric', value: String(defaultPoolSize()), 'aria-label': 'Parallel runs (engines)' });
    const b = (id, label, fn) => h('button', { class: 'control-button', id, onclick: fn }, label);
    this.startB = b('campaign-start', 'Start', () => this.start());
    this.pauseB = b('campaign-pause', 'Pause', () => this.togglePause());
    this.abortB = b('campaign-abort', 'Abort', () => this.abort());
    this.fileInput = h('input', { type: 'file', id: 'campaign-file', hidden: true, accept: '.jsonl,.json,.txt', onchange: () => this.importFile() });
    this.grid = h('canvas', { id: 'campaign-grid', class: 'campaign-grid', 'aria-label': 'Progress: one square per cell' });
    this.plots = h('div', { id: 'campaign-plots', class: 'campaign-plots' });
    this.summary = h('div', { id: 'campaign-summary' });
    this.matrixBox = h('div', { id: 'campaign-matrix-box' });
    this.metric = 'time';
    this.sortBy = null;           // null (suite order) | 'instance' | a variant name
    this.scatterPick = [null, null];
    this.grid.addEventListener('mousemove', (e) => this.gridTip(e));
    this.root.append(
      h('div', { class: 'instances-bar' }, this.select, b('campaign-new', 'New suite', () => this.addSuite()),
        h('label', { title: 'How many runs go at once, one engine (worker) each' }, 'Parallel runs ', this.jobs), this.startB, this.pauseB, this.abortB,
        b('campaign-export', 'Export rows', () => this.exportFile()), b('campaign-export-csv', 'Export matrix (CSV)', () => this.exportCSV()), b('campaign-import', 'Import rows', () => this.fileInput.click()),
        b('campaign-clear', 'Forget rows', () => this.clearRows()), this.fileInput),
      this.text, this.status, this.grid, this.summary, this.matrixBox, this.plots);
    this.setRunning(false);
  }

  load() {
    this.current = this.suites[0] ? this.suites[0].name : null;
    this.rows = [];
    this.select.textContent = '';
    for (const s of this.suites) this.select.append(h('option', { value: s.name }, s.name));
    this.select.hidden = !this.suites.length;
    this.showSuite();
    this.refresh();
  }

  showSuite() {
    const s = this.suite;
    this.text.value = s ? JSON.stringify(s, null, 2) : '';
    this.text.disabled = !s;
    if (!this.running) this.setRunning(false);
  }

  saveText() {
    let s;
    try { s = JSON.parse(this.text.value); } catch (e) { this.say(`Suite: not JSON (${e.message})`, true); return; }
    if (!s || typeof s.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(s.name)) { this.say('Suite: a name of letters, digits, _ and - is needed', true); return; }
    const i = this.suites.findIndex((x) => x.name === this.current);
    if (i >= 0) this.suites[i] = s; else this.suites.push(s);
    this.current = s.name;
    this.load();
    this.current = s.name;
    this.select.value = s.name;
    this.showSuite();
    this.say('Suite saved in the project.');
    this.app.dirty();
  }

  addSuite() {
    let name = 'suite';
    for (let i = 2; this.suites.some((s) => s.name === name); i++) name = `suite${i}`;
    const inst = (this.app.project.instances || []).length ? { ids: 'all' } : { constants: Object.fromEntries(Object.entries(this.app.project.settings.constants).map(([k, v]) => [k, [v]])) };
    this.suites.push({ name, instances: inst, variants: ['default', ...(this.app.project.variants || []).map((v) => v.name)], solver_seeds: 1, limits: { seconds: 30 } });
    this.load();
    this.current = name; this.select.value = name; this.showSuite();
    this.app.dirty();
  }

  tag() { return engineTag(this.app.engineVersion || '', this.app.runtime || '', { ground: (this.app.modules || {}).ground || '' }); }

  say(text, error = false) { this.status.textContent = text; this.status.classList.toggle('error', error); }

  setRunning(on) {
    this.startB.disabled = on || !this.suite;
    this.pauseB.disabled = !on;
    this.abortB.disabled = !on;
    this.pauseB.textContent = this.paused ? 'Resume' : 'Pause';
  }

  // the rows of the current suite: the stored rows whose keys belong to its cells
  async suiteRows() {
    const s = this.suite;
    if (!s) return [];
    let cells;
    try { cells = expandSuite(this.app.project, s); } catch { return []; }
    const keys = new Set();
    for (const c of cells) keys.add(await cellKey(this.app.project, c, s, this.tag()));
    const store = await this.storeP;
    return (await store.all()).filter((r) => keys.has(r.key));
  }

  async refresh() {
    this.rows = await this.suiteRows();
    this.draw();
  }

  async start() {
    const s = this.suite;
    if (!s || this.running || !this.app.ready) return;
    const store = await this.storeP;
    const size = Math.max(1, Math.min(16, Math.floor(Number(this.jobs.value)) || defaultPoolSize()));
    const pool = new Pool(size);
    const signal = { aborted: false };
    this.paused = false;
    this.gate = null;
    this.running = { pool, signal };
    this.pool = pool;
    this.setRunning(true);
    this.rows = [];
    const t0 = performance.now();
    let last = 0;
    this.say('Starting…');
    try {
      const res = await runSuite(this.app.project, s, {
        runJob: async (job) => { if (this.gate) await this.gate.promise; if (signal.aborted) return { outcome: 'aborted' }; return pool.run(job); },
        store, signal, jobs: size, engineVersion: this.tag(),
        engineRun: (p, o) => this.app.engine.exec(p, o), luaTexts: this.app.genLua(), runtime: this.app.runtime, modules: this.app.modules,
        onProgress: (row, done, total) => {
          this.rows.push(row);
          this.progress = { done, total };
          if (performance.now() - last > 200 || done === total) { last = performance.now(); this.draw(); this.say(`${fmt(done)} of ${fmt(total)} cells…`); }
        },
      });
      this.lastRun = res;
      this.rows = res.all;
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      this.say(signal.aborted ? `Aborted after ${fmt(res.ran)} runs.`
        : `${fmt(res.cells)} cells: ${fmt(res.ran)} run, ${fmt(res.skipped)} from earlier runs, ${secs} s.${res.problems.length ? ` Problem: ${res.problems[0]}` : ''}`, res.problems.length > 0);
    } catch (e) {
      this.say(`Not started: ${e instanceof SuiteError ? e.message : e.message || e}`, true);
    } finally {
      pool.terminate();
      this.running = null;
      this.paused = false;
      this.setRunning(false);
      this.draw();
    }
  }

  togglePause() {
    if (!this.running) return;
    if (!this.paused) {
      let resolve; const promise = new Promise((r) => { resolve = r; });
      this.gate = { promise, resolve };
      this.paused = true;
      this.say('Paused: the cells already started finish; Resume continues.');
    } else {
      const g = this.gate; this.gate = null; this.paused = false;
      if (g) g.resolve();
      this.say('Resumed.');
    }
    this.setRunning(true);
  }

  abort() {
    if (!this.running) return;
    this.running.signal.aborted = true;
    if (this.gate) { this.gate.resolve(); this.gate = null; }
    this.running.pool.abortAll();
  }

  async clearRows() {
    const store = await this.storeP;
    await store.clear();
    this.rows = [];
    this.draw();
    this.say('Forgot every stored row (of every suite).');
  }

  exportFile() {
    const blob = new Blob([exportRows(this.rows)], { type: 'application/x-ndjson' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${this.current || 'campaign'}.jsonl` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  exportCSV() {
    const blob = new Blob([matrixCSV(resultMatrix(this.rows, this.metric, this.order()))], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${this.current || 'campaign'}-${this.metric}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async importFile() {
    const f = this.fileInput.files[0];
    this.fileInput.value = '';
    if (!f) return;
    await this.importText(await f.text(), f.name);
  }

  async importText(text, name = 'rows') {
    let rows;
    try { rows = importRows(text); } catch (e) { this.say(`${name}: ${e.message}`, true); return; }
    const store = await this.storeP;
    for (const r of rows) await store.put(r);
    this.rows = rows.filter((r) => !this.current || r.suite === this.current);
    if (!this.rows.length) this.rows = rows;
    this.draw();
    this.say(`Imported ${fmt(rows.length)} rows from ${name}.`);
  }

  // ---- drawing --------------------------------------------------------------------------
  draw() {
    const bad = inconsistencies(this.rows);
    const label = $('label-campaign');
    if (label) label.querySelector('.tab-text').textContent = bad.length ? `Campaign (${bad.length} ✗)` : 'Campaign';
    this.drawGrid(bad);
    this.drawSummary(bad);
    this.drawMatrix();
    this.drawPlots();
  }

  // the instance x variant matrix (FUTURE-DIRECTIONS D2): one row per instance, one column per
  // variant; time or candidates; the best solved cell of a row highlighted; sortable.
  drawMatrix() {
    this.matrixBox.textContent = '';
    if (!this.rows.length) return;
    const m = resultMatrix(this.rows, this.metric, this.order());
    const pick = h('select', { id: 'campaign-metric', 'aria-label': 'Matrix metric' },
      ...[['time', 'time (s)'], ['solutions', 'solutions'], ['candidates', 'candidates'], ['refinements', 'refinements']].map(([v, l]) => h('option', { value: v, selected: v === this.metric }, l)));
    pick.addEventListener('change', () => { this.metric = pick.value; this.drawMatrix(); });
    const rows = m.rows.slice();
    if (this.sortBy === 'instance') rows.sort((a, b) => String(a.instance).localeCompare(String(b.instance), undefined, { numeric: true }));
    else if (this.sortBy) {
      const key = (r) => { const c = r.cells[this.sortBy]; return !c ? Infinity : c.solved && c.value !== null ? c.value : 1e300; };
      rows.sort((a, b) => key(a) - key(b));
    }
    const th = (label, key) => h('th', { 'data-sort': key, class: 'sortable', title: 'Sort by this column', onclick: () => { this.sortBy = this.sortBy === key ? null : key; this.drawMatrix(); } },
      label + (this.sortBy === key ? ' ▲' : ''));
    const t = h('table', { class: 'internals-table campaign-matrix', id: 'campaign-matrix', 'data-metric': this.metric });
    t.append(h('tr', {}, th('Instance', 'instance'), ...m.variants.map((v) => th(vname(v), v))));
    for (const r of rows) {
      t.append(h('tr', { 'data-instance': r.instance }, h('td', {}, r.instance || '(no instance)'), ...m.variants.map((v) => {
        const c = r.cells[v];
        if (!c) return h('td', {}, '');
        const text = this.metric === 'solutions' ? (c.value === null ? '–' : fmt(Math.round(c.value)) + (c.solved ? '' : ` (${c.outcome})`))
          : !c.solved ? c.outcome : c.value === null ? '–' : this.metric === 'time' ? `${c.value.toFixed(3)}` : fmt(Math.round(c.value));
        const cls = ['num', r.best === v ? 'best' : '', c.disagree ? 'disagree' : '', c.solved ? '' : 'unsolved'].filter(Boolean).join(' ');
        const tip = `${r.instance || '(no instance)'} / ${vname(v)}: ${c.outcome}, ${fmt(c.solutions)} solutions${c.cost ? `, cost ${c.cost.join(' ')}` : ''}${c.n > 1 ? `, median of ${c.n} seeds` : ''}${c.disagree ? '; disagrees with another variant' : ''}`;
        return h('td', { class: cls, title: tip, 'data-variant': v }, text + (c.disagree ? ' ✗' : ''));
      })));
    }
    this.matrixBox.append(h('div', { class: 'instances-bar' }, h('b', {}, 'Instance × variant '), h('label', {}, 'Show ', pick),
      h('span', { class: 'note' }, this.metric === 'solutions' ? ' the number of solutions each run found (median over seeds); click a heading to sort'
        : ' the best solved cell per row in bold (none on a tie); click a heading to sort')), t);
  }

  // the order of the project file: the suite's variants as listed, then the project's variants;
  // the instances as in the Instances tab
  order() {
    const p = this.app.project, s = this.suite;
    const variants = [...((s && s.variants) || []), 'default', ...(p.variants || []).map((v) => v.name)];
    return { variants: [...new Set(variants)], instances: (p.instances || []).map((x) => x.id) };
  }

  // the progress grid's tooltip: the cell under the mouse
  gridTip(e) {
    const cv = this.grid, sq = Number(cv.dataset.sq || 10), per = Number(cv.dataset.per || 1);
    const r0 = cv.getBoundingClientRect();
    const i = Math.floor((e.clientY - r0.top) / (sq + 1)) * per + Math.floor((e.clientX - r0.left) / (sq + 1));
    const r = (this.sortedRows || [])[i];
    cv.title = r ? `${r.instance || '(no instance)'} / ${vname(r.variant)} / seed ${r.seed}: ${r.outcome}${r.skipped ? '' : `, ${fmt(r.solutions)} solutions, ${Number(r.time || 0).toFixed(3)} s`}` : '';
  }

  drawGrid(bad) {
    const cv = this.grid;
    const n = Math.max(this.rows.length, this.progress ? this.progress.total : 0);
    const width = Math.max(200, Math.floor(cv.parentElement ? cv.parentElement.clientWidth : 600) || 600);
    const sq = n > 2000 ? 4 : n > 500 ? 6 : 10;
    const per = Math.max(1, Math.floor(width / (sq + 1)));
    const height = Math.max(sq + 2, Math.ceil(n / per) * (sq + 1) + 1);
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr; cv.height = height * dpr; cv.style.width = width + 'px'; cv.style.height = height + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const red = new Set(bad.flatMap((b) => b.rows.map((r) => r.key)));
    const rows = this.rows.slice().sort((a, b) => String(a.instance).localeCompare(String(b.instance)) || String(a.variant).localeCompare(String(b.variant)) || a.seed - b.seed);
    this.sortedRows = rows;
    cv.dataset.sq = String(sq); cv.dataset.per = String(per);
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      const x = (i % per) * (sq + 1), y = Math.floor(i / per) * (sq + 1);
      ctx.fillStyle = r ? css(OUTCOME_COLOR[r.outcome] || '--chart-7') : css('--border');
      ctx.fillRect(x, y, sq, sq);
      if (r && red.has(r.key)) { ctx.strokeStyle = css('--error'); ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, sq - 2, sq - 2); }
    }
    cv.dataset.cells = String(n);
    cv.dataset.done = String(this.rows.length);
  }

  drawSummary(bad) {
    this.summary.textContent = '';
    if (!this.rows.length) return;
    const variants = [...new Set(this.rows.map((r) => r.variant))];
    const t = h('table', { class: 'internals-table', id: 'campaign-table' });
    t.append(h('tr', {}, ...['Variant', 'Cells', 'Exhausted', 'Median time', 'Median candidates', 'Growth per step of x'].map((x) => h('th', {}, x))));
    const x = this.xParam();
    const sc = x ? scaling(this.rows, x, 'time') : {};
    for (const v of variants) {
      const rs = this.rows.filter((r) => r.variant === v && !r.skipped);
      const med = (k) => { const s = rs.map((r) => r[k]).filter((z) => typeof z === 'number').sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
      const fit = sc[v] ? growthFit(sc[v]) : null;
      t.append(h('tr', { 'data-variant': v }, h('td', {}, v), h('td', { class: 'num' }, fmt(rs.length)), h('td', { class: 'num' }, fmt(rs.filter((r) => r.exhausted).length)),
        h('td', { class: 'num' }, med('time') == null ? '–' : `${med('time').toFixed(3)} s`), h('td', { class: 'num' }, med('candidates') == null ? '–' : fmt(med('candidates'))),
        h('td', { class: 'num' }, fit ? `×${fit.factor.toFixed(2)} (90%: ${fit.lo.toFixed(2)}–${fit.hi.toFixed(2)})` : '–')));
    }
    this.summary.append(t);
    const p = h('p', { id: 'campaign-consistency', class: bad.length ? 'error' : 'note' },
      bad.length ? `${bad.length} instances where variants disagree: ` + bad.map((b) => `${b.instance || '(no instance)'}: ${b.kind === 'optimum' ? 'optimum ' : ''}${b.rows.map((r) => `${vname(r.variant)} ${b.kind === 'optimum' ? r.cost.join(' ') : fmt(r.solutions)}`).join(' vs ')}`).join('; ')
        : 'Every instance: the finished variants agree on counts and optima.');
    this.summary.append(p);
  }

  xParam() {
    const keys = new Map();
    for (const r of this.rows) for (const [k, v] of Object.entries(r.params || {})) { if (!keys.has(k)) keys.set(k, new Set()); keys.get(k).add(v); }
    const multi = [...keys].filter(([, s]) => s.size > 1).map(([k]) => k);
    return multi[0] || null;
  }

  drawPlots() {
    this.plots.textContent = '';
    if (!this.rows.length) return;
    const x = this.xParam();
    const variants = [...new Set(this.rows.map((r) => r.variant))];
    const color = (v) => css(COLORS[variants.indexOf(v) % COLORS.length]);
    const fig = (title, el, id) => h('figure', { id }, h('figcaption', {}, title), el);
    // 1. scaling: median and interquartile band of the time per variant, log axis
    if (x) {
      const sc = scaling(this.rows, x, 'time');
      this.plots.append(fig(`Time against ${x} (median, interquartile band, log scale)`, this.linePlot(sc, color, x), 'plot-scaling'));
    }
    // 2. heat map over two parameters (median time of the first variant)
    const keys = [...new Set(this.rows.flatMap((r) => Object.keys(r.params || {})))].filter((k) => new Set(this.rows.map((r) => r.params && r.params[k])).size > 1);
    if (keys.length >= 2) this.plots.append(fig(`Median time over ${keys[0]} and ${keys[1]} (${variants[0]})`, this.heatMap(keys[0], keys[1], variants[0]), 'plot-heat'));
    // 3. scatter: one variant against another, per instance
    if (variants.length >= 2) {
      const [a0, b0] = this.scatterPick;
      const va = variants.includes(a0) ? a0 : variants[0];
      const vb = variants.includes(b0) && b0 !== va ? b0 : variants.find((v) => v !== va);
      const sel = (id, cur, i) => {
        const e = h('select', { id, 'aria-label': i ? 'Scatter y variant' : 'Scatter x variant' }, ...variants.map((v) => h('option', { value: v, selected: v === cur }, vname(v))));
        e.addEventListener('change', () => { this.scatterPick[i] = e.value; this.drawPlots(); });
        return e;
      };
      const cap = h('figcaption', {}, 'Time per instance: ', sel('scatter-x', va, 0), ' (x) against ', sel('scatter-y', vb, 1), ' (y)');
      this.plots.append(h('figure', { id: 'plot-scatter' }, cap, this.scatter(va, vb)));
    }
    // 4. a cactus plot: the i-th fastest solved cell per variant against its time
    this.plots.append(fig('Cactus plot: cells solved (finished) against time', this.solvedPlot(solvedCurves(this.rows), color), 'plot-solved'));
  }

  frame(W = 360, H = 220) {
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'campaign-plot', role: 'img' });
    s.append(svg('line', { x1: 40, y1: H - 24, x2: W - 8, y2: H - 24, stroke: css('--chart-axis') }), svg('line', { x1: 40, y1: 8, x2: 40, y2: H - 24, stroke: css('--chart-axis') }));
    return { s, W, H, x0: 40, x1: W - 8, y0: H - 24, y1: 8 };
  }

  linePlot(sc, color, xname) {
    const f = this.frame();
    const pts = Object.values(sc).flat();
    if (!pts.length) return f.s;
    const xs = pts.map((p) => p.x), ys = pts.flatMap((p) => [p.q1, p.q3]).filter((y) => y > 0);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const lmin = Math.log10(Math.max(1e-4, Math.min(...ys, 1e-3))), lmax = Math.log10(Math.max(...ys, 1e-3) * 1.2);
    const X = (v) => f.x0 + (xmax > xmin ? (v - xmin) / (xmax - xmin) : 0.5) * (f.x1 - f.x0);
    const Y = (v) => f.y0 - (Math.log10(Math.max(v, 1e-4)) - lmin) / Math.max(1e-9, lmax - lmin) * (f.y0 - f.y1);
    for (const [v, ps] of Object.entries(sc)) {
      const c = color(v);
      if (ps.length > 1) {
        const band = ps.map((p) => `${X(p.x)},${Y(p.q3)}`).concat(ps.slice().reverse().map((p) => `${X(p.x)},${Y(p.q1)}`)).join(' ');
        f.s.append(svg('polygon', { points: band, fill: c, 'fill-opacity': 0.18, stroke: 'none' }));
        f.s.append(svg('polyline', { points: ps.map((p) => `${X(p.x)},${Y(p.median)}`).join(' '), fill: 'none', stroke: c, 'stroke-width': 2 }));
      }
      for (const p of ps) f.s.append(svg('circle', { cx: X(p.x), cy: Y(p.median), r: 3, fill: c }, undefined));
    }
    f.s.append(svg('text', { x: f.x0, y: f.H - 6, class: 'plot-label' }, `${xname} ${xmin}`), svg('text', { x: f.x1, y: f.H - 6, 'text-anchor': 'end', class: 'plot-label' }, String(xmax)));
    f.s.append(svg('text', { x: 2, y: f.y1 + 8, class: 'plot-label' }, `${(10 ** lmax).toPrecision(2)} s`), svg('text', { x: 2, y: f.y0, class: 'plot-label' }, `${(10 ** lmin).toPrecision(2)}`));
    this.legend(f, Object.keys(sc), color);
    return f.s;
  }

  legend(f, names, color) {
    names.forEach((v, i) => {
      f.s.append(svg('rect', { x: f.x0 + 8, y: f.y1 + 4 + i * 14, width: 10, height: 10, fill: color(v) }));
      f.s.append(svg('text', { x: f.x0 + 22, y: f.y1 + 13 + i * 14, class: 'plot-label' }, vname(v)));
    });
  }

  heatMap(a, b, variant) {
    const f = this.frame();
    const rs = this.rows.filter((r) => r.variant === variant && !r.skipped && r.params);
    const av = [...new Set(rs.map((r) => r.params[a]))].sort((p, q) => p - q), bv = [...new Set(rs.map((r) => r.params[b]))].sort((p, q) => p - q);
    const cell = new Map();
    for (const r of rs) { const k = `${r.params[a]}|${r.params[b]}`; (cell.get(k) || cell.set(k, []).get(k)).push(r.time); }
    const meds = [...cell.values()].map((v) => v.sort((p, q) => p - q)[Math.floor((v.length - 1) / 2)]);
    const lo = Math.min(...meds), hi = Math.max(...meds);
    const w = (f.x1 - f.x0) / av.length, hh = (f.y0 - f.y1) / bv.length;
    av.forEach((x, i) => bv.forEach((y, j) => {
      const v = cell.get(`${x}|${y}`);
      if (!v) return;
      const m = v[Math.floor((v.length - 1) / 2)];
      const t = hi > lo ? (m - lo) / (hi - lo) : 0;
      f.s.append(svg('rect', { x: f.x0 + i * w, y: f.y0 - (j + 1) * hh, width: w - 1, height: hh - 1, fill: css('--chart-5'), 'fill-opacity': 0.15 + 0.85 * t }));
    }));
    f.s.append(svg('text', { x: f.x0, y: f.H - 6, class: 'plot-label' }, `${a}: ${av.join(', ')}`), svg('text', { x: 2, y: f.y1 + 8, class: 'plot-label' }, `${b}: ${bv.join(', ')}`));
    return f.s;
  }

  scatter(va, vb) {
    const f = this.frame();
    const by = new Map();
    for (const r of this.rows) if (!r.skipped && (r.variant === va || r.variant === vb)) { const k = `${r.instance}|${r.seed}`; (by.get(k) || by.set(k, {}).get(k))[r.variant] = r.time; }
    const pts = [...by.values()].filter((p) => p[va] != null && p[vb] != null);
    const m = Math.max(1e-3, ...pts.flatMap((p) => [p[va], p[vb]]));
    const X = (v) => f.x0 + v / m * (f.x1 - f.x0), Y = (v) => f.y0 - v / m * (f.y0 - f.y1);
    f.s.append(svg('line', { x1: X(0), y1: Y(0), x2: X(m), y2: Y(m), stroke: css('--chart-axis'), 'stroke-dasharray': '3 3' }));
    for (const p of pts) f.s.append(svg('circle', { cx: X(p[va]), cy: Y(p[vb]), r: 3, fill: css('--chart-2') }));
    f.s.append(svg('text', { x: f.x1, y: f.H - 6, 'text-anchor': 'end', class: 'plot-label' }, `${m.toPrecision(2)} s`));
    return f.s;
  }

  solvedPlot(curves, color) {
    const f = this.frame();
    const tmax = Math.max(1e-3, ...Object.values(curves).flatMap((c) => c.times));
    const nmax = Math.max(1, ...Object.values(curves).map((c) => c.total));
    const X = (n) => f.x0 + n / nmax * (f.x1 - f.x0), Y = (t) => f.y0 - t / tmax * (f.y0 - f.y1);
    for (const [v, c] of Object.entries(curves)) {
      const pts = c.times.map((t, i) => `${X(i + 1)},${Y(t)}`);
      if (pts.length > 1) f.s.append(svg('polyline', { points: pts.join(' '), fill: 'none', stroke: color(v), 'stroke-width': 2 }));
      c.times.forEach((t, i) => f.s.append(svg('circle', { cx: X(i + 1), cy: Y(t), r: 2.5, fill: color(v) })));
    }
    f.s.append(svg('text', { x: f.x1, y: f.H - 6, 'text-anchor': 'end', class: 'plot-label' }, `${nmax} solved`), svg('text', { x: 2, y: f.y1 + 8, class: 'plot-label' }, `${tmax.toPrecision(2)} s`));
    this.legend(f, Object.keys(curves), color);
    return f.s;
  }
}
