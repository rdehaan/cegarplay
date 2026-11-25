// Statistics tab, live line, charts, run history (spec-app.md section 10).
import { fmt, spaceAt } from './output.js';
import { refinementCounts, refinementSplitText, COUNT_TIP } from './driver.js';

const MAX_POINTS = 500;
const HIST_LABELS = ['1', '2', '3–4', '5–8', '9–16', '17–32', '33–64', '65+'];
const SVGNS = 'http://www.w3.org/2000/svg';
// Chart colours are tokens of css/theme.css, so the charts follow the colour theme without redrawing.
const COLORS = [1, 2, 3, 4, 5, 6, 7].map((i) => `var(--chart-${i})`);

const secs = (t) => (typeof t === 'number' ? (t < 10 ? t.toFixed(2) : t.toFixed(1)) + ' s' : '–');
const dash = (v) => (v === null || v === undefined ? '–' : fmt(typeof v === 'number' && !Number.isInteger(v) ? Math.round(v) : v));
const refinements = (s) => (s ? refinementCounts(s).total : 0);
const meanLen = (s) => (s && s.clauses ? s.literals / s.clauses : null);

export function liveText(s) {
  if (!s) return ' ';
  // the same time format as the Summary and the run history (0.05 s, not 0.1 s)
  const r = refinementCounts(s), split = refinementSplitText(r);
  return `${secs(s.t)} · ${fmt(s.candidates)} candidates · ${fmt(s.counterexamples)} counterexamples · ` +
    `${fmt(r.total)} refinements${split && split !== 'none' ? ` (${split})` : ''} · ${fmt(s.solutions)} solutions`;
}

// The top bar after an audit: its own counts (the S events of an audit count raw models).
export function auditLiveText(a) {
  if (!a || !a.verdict) return ' ';
  if (a.mode === 'space' && a.space) return `space ${a.space} · ${a.verdict === 'sound' ? `sound up to ${a.bound || 'k'} = ${a.k}` : `${a.verdict} at ${spaceAt(a)}`}`;
  if (a.mode === 'space') return ' ';   // one step of a space audit: the space's line follows
  if (a.mode) return `symbolic audit · ${fmt(a.rounds ?? 0)} round${(a.rounds ?? 0) === 1 ? '' : 's'} · ${fmt(a.refinements ?? 0)} refinement${(a.refinements ?? 0) === 1 ? '' : 's'} · ${a.verdict}`;
  const verdict = a.verdict === 'sound' ? 'sound' : a.verdict === 'unsound'
    ? `unsound: ${fmt(a.unsound)} remove a solution` : a.verdict;
  return `audit · ${fmt(a.candidates)} candidates · ${fmt(a.solutions)} solutions · ` +
    `${fmt(a.pairs)} refinements checked · ${verdict}`;
}

function svg(tag, attrs = {}, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
};

// A simple string hash (for "same fragments" in the run history).
export function hashText(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; }
  return x.toString(16).padStart(8, '0');
}

export class Stats {
  constructor(app) {
    this.app = app;
    this.live = document.getElementById('live-line');
    this.live.title = COUNT_TIP;
    this.root = document.getElementById('statistics');
    this.history = [];
    this.build();
    this.reset();
  }

  build() {
    const r = this.root;
    r.innerHTML = `
      <div class="stats-block"><h3>Summary</h3><div class="table-wrapper"><table class="internals-table" id="stats-summary"></table></div>
        <div id="links-block" hidden><h4>Per link</h4><div class="table-wrapper"><table class="internals-table" id="links-table"></table></div>
        <p class="note">Each counterexample and refinement is credited to the link whose refinement used it (in a chain A -> B -> C, the link that consumed it).</p></div></div>
      <div class="stats-block" id="certificates-block" hidden><h3>Certificates</h3>
        <div class="table-wrapper"><table class="internals-table" id="certificates-table"></table></div>
        <p class="note">Each refinement gets the cheapest certificate that holds: 0 a block, 1 an unsat core, 2 the
        three-valued evaluation of the check, 3 one solver call on the product of abstraction and check (also for
        the rules an expansion grounds), 4 a search for a lost solution (Certificates: exact).
        Uncertified does not mean unsound; use Audit for a verdict.</p></div>
      <div class="stats-block" id="lift-block" hidden><h3>Lifting coach</h3>
        <div class="table-wrapper"><table class="internals-table" id="lift-table"></table></div>
        <p class="note" id="lift-note"></p></div>
      <div class="stats-block" id="cores-block" hidden><h3>Cores</h3>
        <div class="table-wrapper"><table class="internals-table" id="cores-table"></table></div>
        <p class="note" id="cores-note"></p></div>
      <div class="stats-block"><h3>Solvers</h3><div class="table-wrapper"><table class="internals-table" id="solver-table"></table></div></div>
      <div class="stats-block"><h3>Refinements</h3><div class="table-wrapper"><table class="internals-table" id="refinement-table"></table></div></div>
      <div class="stats-block"><h3>Charts</h3>
        <div class="charts">
          <figure><figcaption>Candidates and refinements over time</figcaption><div id="chart-progress" class="chart"></div></figure>
          <figure><figcaption>Where the time went</figcaption><div id="chart-time" class="chart"></div></figure>
          <figure><figcaption>Clause lengths</figcaption><div id="chart-hist" class="chart"></div></figure>
          <figure id="tracked-figure" hidden><figcaption>Tracked values (<code>track</code>), per round</figcaption><div id="chart-tracked" class="chart"></div></figure>
        </div>
      </div>
      <div class="stats-block"><h3>Custom counters and tracked values</h3><div class="table-wrapper"><table class="internals-table" id="counters-table"></table></div></div>
      <div class="stats-block">
        <h3>Copy</h3>
        <button class="control-button" id="copy-tsv-button">Copy as text (tab-separated)</button>
        <button class="control-button" id="copy-json-button">Copy as JSON</button>
        <span id="copy-status" class="note"></span>
      </div>
      <div class="stats-block">
        <h3>Run history</h3>
        <p class="inline-controls">
          <button class="control-button" id="rerun-seeds-button" title="Run again with seeds 1 to 5 and a randomized search (random decisions and signs), one run history row each: does the outcome depend on the search?">Rerun with 5 seeds</button>
          <button class="control-button" id="clear-history-button" title="Remove every row of the run history (asks first)">Clear run history</button>
          <button class="control-button" id="save-pool-button" title="Store the counterexamples of the last run's expansions as pools (needs Recording: every step)">Save counterexamples as pool</button>
          <button class="control-button" id="import-verdict-button" title="The --json output of tools/certcheck.py for a proof log of one of these runs">Import certcheck verdict</button>
          <input type="file" id="verdict-file" accept=".json,.txt" hidden>
        </p>
        <p class="note" id="history-shown-note" hidden>&#x25B6; marks the run whose results the tabs show now (the <b>Shown</b> line under the top bar);
          the other rows are earlier runs, kept as numbers only.</p>
        <div class="table-wrapper"><table class="internals-table" id="history-table"></table></div>
        <div id="history-compare-box" hidden><h3>Two runs side by side</h3>
          <div class="table-wrapper"><table class="internals-table" id="history-compare"></table></div></div>
        <p class="note" id="history-note">Rows marked ⚠ ran the same fragments with all solutions, finished exhausted,
          and found different numbers of solutions: at least one of the loops is not sound.</p>
      </div>`;
    r.querySelector('#copy-tsv-button').addEventListener('click', () => this.copy('tsv'));
    r.querySelector('#copy-json-button').addEventListener('click', () => this.copy('json'));
    r.querySelector('#clear-history-button').addEventListener('click', () => this.clearHistory());
    r.querySelector('#rerun-seeds-button').addEventListener('click', () => this.app.control && this.app.control.rerunSeeds());
    r.querySelector('#save-pool-button').addEventListener('click', () => this.savePools());
    const vf = r.querySelector('#verdict-file');
    r.querySelector('#import-verdict-button').addEventListener('click', () => vf.click());
    vf.addEventListener('change', async () => { const f = vf.files[0]; vf.value = ''; if (f) this.importVerdict(await f.text()); });
  }

  reset() {
    this.H = null;
    this.S = null;
    this.D = null;
    this.series = [];
    this.tracks = new Map();
    this.audit = null;
    this.shownIndex = null;
    this.live.textContent = ' ';
    this.render();
  }

  start(meta) { this.reset(); this.meta = meta; }
  header(H) { this.H = H; this.schedule(); }

  update(S) {
    this.S = S;
    this.live.textContent = liveText(S);
    const p = [S.t, S.candidates, refinements(S)];
    const last = this.series.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) {
      this.series.push(p);
      if (this.series.length > MAX_POINTS) this.series = this.series.filter((_, i) => i % 2 === 0 || i === this.series.length - 1);
    }
    this.schedule();
  }

  // A V event (track name = e): one value of a named series.
  track(V) {
    if (!this.tracks.has(V.n)) this.tracks.set(V.n, []);
    this.tracks.get(V.n).push([V.i, V.v]);
    this.schedule();
  }

  done(D, info) {
    this.D = D;
    if (info && (info.mode === 'audit' || info.mode === 'bounded') && info.audit) { this.live.textContent = auditLiveText(info.audit); this.audit = info.audit; }
    if (this.S && info && !info.noHistory) this.record(info);
    this.render();
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
  }

  // ---- rendering -------------------------------------------------------------
  render() {
    this.renderSummary();
    this.renderSolvers();
    this.renderRefinements();
    this.renderCores();
    this.renderCharts();
    this.renderCounters();
    this.renderHistory();
  }

  table(id, head, rows, numeric = []) {
    const t = this.root.querySelector('#' + id);
    t.textContent = '';
    const tr = h('tr');
    // a header cell is a text, or [text, tooltip]
    head.forEach((x, i) => tr.append(h('th', { ...(numeric.includes(i) ? { class: 'num' } : {}), ...(Array.isArray(x) ? { title: x[1] } : {}) }, Array.isArray(x) ? x[0] : x)));
    t.append(h('thead', {}, tr));
    const tb = h('tbody');
    for (const r of rows) {
      const row = h('tr', r.attrs || {});
      (r.cells || r).forEach((x, i) => row.append(h('td', numeric.includes(i) ? { class: 'num' } : {}, x == null ? '–' : String(x))));
      tb.append(row);
    }
    t.append(tb);
    return t;
  }

  // counterexamples and refinements per link (S event: links), when the run has a link
  renderLinks() {
    const s = this.S, box = this.root.querySelector('#links-block');
    const L = s && s.links && !(this.audit && this.audit.verdict) ? Object.entries(s.links) : [];
    box.hidden = !L.length;
    if (!L.length) return;
    const other = L.some(([, x]) => x.other);
    this.table('links-table', ['Link', ['Counterexamples', COUNT_TIP], ['From counterexamples', COUNT_TIP], ['From cores', COUNT_TIP], ['Blocks', COUNT_TIP], ...(other ? ['Other'] : [])],
      L.map(([name, x]) => [name, fmt(x.counterexamples), fmt(x.from_models), fmt(x.from_cores), fmt(x.blocks), ...(other ? [fmt(x.other || 0)] : [])]), [1, 2, 3, 4, 5]);
  }

  renderSummary() {
    const s = this.S, d = this.D, a = this.audit;
    const outcome = d ? d.outcome + (d.exhausted === true ? ' (exhausted)' : '') : s ? 'running' : '–';
    if (a && a.verdict && !a.mode) {
      // an audit by enumeration: its own counts (the solver tables below are its solving, whose raw
      // model counts are not the loop's solutions or refinements)
      this.table('stats-summary', ['Audit verdict', 'Elapsed', 'Candidates', 'Counterexamples', 'Refinements checked', 'Solutions'],
        [[a.verdict === 'unsound' ? `unsound (${fmt(a.unsound)} remove a solution)` : a.verdict, s ? secs(s.t) : '–', dash(a.candidates), dash(a.counterexamples), dash(a.pairs), dash(a.solutions)]],
        [1, 2, 3, 4, 5]);
    } else if (a && a.verdict && a.mode) {
      // a symbolic or space audit: rounds and refinements of its inner loop
      this.table('stats-summary', ['Audit verdict', 'Elapsed', 'Rounds of the inner loop', 'Refinements of the inner loop'],
        [[a.mode === 'space' && a.space ? (a.verdict === 'sound' ? `sound up to ${a.bound || 'k'} = ${a.k}` : `${a.verdict} at ${spaceAt(a)}`) : `${a.verdict} (symbolic)`, s ? secs(s.t) : '–', dash(a.rounds), dash(a.refinements)]],
        [1, 2, 3]);
    } else {
      const r = refinementCounts(s);
      const split = r && r.split;
      const other = split && r.other > 0;
      this.table('stats-summary', ['Outcome', 'Elapsed', 'Candidates', ['Counterexamples', COUNT_TIP], ['Refinements', COUNT_TIP],
        ...(split ? [['From counterexamples', COUNT_TIP], ['From cores', COUNT_TIP], ['Blocks', COUNT_TIP]] : []),
        ...(other ? [['Other', 'Clauses the script builds itself, and expansions from neither a counterexample nor a core']] : []), 'Solutions'],
        [[outcome, s ? secs(s.t) : '–', dash(s && s.candidates), dash(s && s.counterexamples), s ? fmt(r.total) : '–',
          ...(split ? [fmt(r.from_models), fmt(r.from_cores), fmt(r.blocks)] : []), ...(other ? [fmt(r.other)] : []), dash(s && s.solutions)]],
        [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
    this.renderLinks();
    const c = s && s.certificates;
    const box = this.root.querySelector('#certificates-block');
    box.hidden = !c;
    if (c) {
      this.table('certificates-table', ['Level 0 (block)', 'Level 1 (core)', 'Level 2', 'Level 3', 'Level 4', 'Uncertified', 'Unsound (level 4)', 'Outside levels 2-3', 'Expansions certified', 'Time levels 2 / 3 / 4'],
        [[fmt(c.l0), fmt(c.l1), fmt(c.l2), fmt(c.l3), fmt(c.l4 || 0), fmt(c.none), fmt(c.unsound || 0), fmt(c.outside),
          c.expansions ? `${fmt(c.expansions_certified)} of ${fmt(c.expansions)}` : '–', `${secs(c.t2)} / ${secs(c.t3)} / ${secs(c.t4 || 0)}`]], [0, 1, 2, 3, 4, 5, 6, 7]);
    }
    // the coach of a lift link (phase S3): per interface predicate, atoms marked by relevant/1 and kept by lifting
    const L = s && s.lift;
    const lb = this.root.querySelector('#lift-block');
    lb.hidden = !L;
    if (L) {
      const preds = Object.entries(L.preds || {}).sort((a, b) => a[0].localeCompare(b[0]));
      const per = (x) => (L.clauses ? (x / L.clauses).toFixed(2) : '–');
      this.table('lift-table', ['Interface predicate', 'Marked by relevant/1', 'Kept by lifting', 'Per refinement (marked)', 'Per refinement (kept)'],
        preds.map(([name, p]) => [name, fmt(p.hand), fmt(p.kept), per(p.hand), per(p.kept)]), [1, 2, 3, 4]);
      this.root.querySelector('#lift-note').textContent = `${fmt(L.clauses)} lifted refinements` +
        (L.uncertified ? `; ${fmt(L.uncertified)} hand-written sets were not certified (lifting started from the whole interface)` : '') +
        (L.fallbacks ? `; ${fmt(L.fallbacks)} fallbacks to a block (the counterexample could not be certified)` : '') + '.';
    }
  }

  // the clauses made from cores (FUTURE-DIRECTIONS, Statistics): their lengths, plain and minimised
  renderCores() {
    const s = this.S;
    const cb = this.root.querySelector('#cores-block');
    const ch = s && s.cores;
    const total = (h) => (h || []).reduce((a, x) => a + x, 0);
    cb.hidden = !ch || total(ch.plain) + total(ch.minimal) === 0;
    if (cb.hidden) return;
    const mean = (h) => { const mids = [1, 2, 3.5, 6.5, 12.5, 24.5, 48.5, 80]; const n = total(h); return n ? (h.reduce((a, x, i) => a + x * mids[i], 0) / n).toFixed(1) : '–'; };
    const rows = [['as clasp returns them', ch.plain], ['minimised (core.minimal)', ch.minimal]].filter(([, h]) => total(h) > 0)
      .map(([name, h]) => [name, fmt(total(h)), ...h.map((x) => fmt(x)), mean(h)]);
    this.table('cores-table', ['Cores', 'Count', ...HIST_LABELS.map((x) => `len ${x}`), 'Mean (approx.)'], rows, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    this.root.querySelector('#cores-note').textContent = 'A short core is a strong clause. Compare the two rows in one run, or a run with and without core.minimal (run history, Compare).';
  }

  solverRows() {
    const s = this.S, H = this.H;
    const names = H ? H.solvers.map((x) => x.name) : s ? Object.keys(s.solvers) : [];
    return names.map((n) => {
      const hs = H && H.solvers.find((x) => x.name === n);
      const v = (s && s.solvers[n]) || {};
      return {
        name: n, fragments: hs ? hs.fragments.join(' + ') : '', options: hs ? hs.options.join(' ') : '',
        calls: v.calls, sat: v.sat, unsat: v.unsat, time: v.time, mean: v.calls ? v.time / v.calls : null, ground: v.ground,
        choices: v.choices, conflicts: v.conflicts, restarts: v.restarts, atoms: v.atoms ?? (hs && hs.atoms), rules: v.rules, expansions: v.k,
      };
    });
  }

  renderSolvers() {
    const ms = (x) => (typeof x === 'number' ? (x * 1000).toFixed(x < 0.001 ? 3 : 2) + ' ms' : '–');
    const rows = this.solverRows().map((r) => [r.name, r.fragments, r.options || '–', dash(r.calls), dash(r.sat), dash(r.unsat), secs(r.time),
      ms(r.mean), secs(r.ground), dash(r.choices), dash(r.conflicts), dash(r.restarts), dash(r.atoms), dash(r.rules), dash(r.expansions)]);
    this.table('solver-table', ['Solver', 'Fragments', 'Options', 'Calls', 'Sat', 'Unsat', 'Solving', 'Per call', 'Grounding', 'Choices',
      'Conflicts', 'Restarts', 'Atoms', 'Rules', 'Expansions'], rows, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  }

  renderRefinements() {
    const s = this.S;
    const m = meanLen(s);
    this.table('refinement-table', ['Clauses', 'Mean length', 'Largest', 'Expansions', 'Restarts', ['Blocks', 'G.block, G.above, G.below and the automatic blocks of accepted solutions']],
      [[dash(s && s.clauses), m == null ? '–' : m.toFixed(2), dash(s && s.maxlen), dash(s && s.expansions), dash(s && s.restarts), dash(s && s.blocks)]],
      [0, 1, 2, 3, 4, 5]);
  }

  renderCounters() {
    const c = (this.S && this.S.counters) || {};
    const rows = Object.entries(c).map(([k, v]) => [k, fmt(v)]);
    const last = new Map(Object.entries((this.S && this.S.tracked) || {}));
    for (const [k, pts] of this.tracks) if (!last.has(k) && pts.length) last.set(k, pts.at(-1)[1]);
    for (const [k, v] of last) rows.push([`${k} (tracked, last value)`, fmt(v)]);
    if (this.S && this.S.partials) rows.unshift(['partial checks (on partial)', fmt(this.S.partials)]);
    if (this.S && this.S.minimised) rows.unshift(['minimised cores (core.minimal)', fmt(this.S.minimised)]);
    for (const [k, v] of Object.entries((this.S && this.S.labels) || {}).reverse()) rows.unshift([`accepted as ${k}`, fmt(v)]);
    this.table('counters-table', ['Counter', 'Value'], rows.length ? rows : [['(none: use count or track in the loop script)', '']], [1]);
  }

  renderCharts() {
    this.chartProgress(this.root.querySelector('#chart-progress'));
    this.chartTime(this.root.querySelector('#chart-time'));
    this.chartHist(this.root.querySelector('#chart-hist'));
    const fig = this.root.querySelector('#tracked-figure');
    fig.hidden = this.tracks.size === 0;
    if (!fig.hidden) this.chartTracked(this.root.querySelector('#chart-tracked'));
  }

  // One line per tracked name; x = the round (the i-th value of that name), one shared y axis.
  chartTracked(box) {
    const W = 380, H = 200, L = 48, R = 10, T = 10, B = 28;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', id: 'svg-tracked', role: 'img' });
    const thin = (pts) => { const k = Math.ceil(pts.length / MAX_POINTS); return k <= 1 ? pts : pts.filter((_, i) => i % k === 0 || i === pts.length - 1); };
    const all = [...this.tracks.entries()].map(([n, pts]) => [n, thin(pts)]);
    const xs = all.flatMap(([, p]) => p.map((q) => q[0])), ys = all.flatMap(([, p]) => p.map((q) => q[1]));
    const xMax = Math.max(1, ...xs), yMin = Math.min(0, ...ys), yMax = Math.max(yMin + 1, ...ys);
    s.append(svg('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, class: 'axis' }), svg('line', { x1: L, y1: T, x2: L, y2: H - B, class: 'axis' }));
    s.append(svg('text', { x: L - 4, y: T + 8, 'text-anchor': 'end', class: 'tick' }, fmt(yMax)));
    s.append(svg('text', { x: L - 4, y: H - B, 'text-anchor': 'end', class: 'tick' }, fmt(yMin)));
    s.append(svg('text', { x: W - R, y: H - 8, 'text-anchor': 'end', class: 'tick' }, `round ${fmt(xMax)}`));
    const x = (i) => L + (xMax <= 1 ? 0.5 : (i - 1) / (xMax - 1)) * (W - L - R), y = (v) => H - B - ((v - yMin) / (yMax - yMin)) * (H - T - B);
    all.forEach(([name, pts], k) => {
      const c = COLORS[k % COLORS.length];
      // a step line: a value holds until the next one
      const d = pts.map((p, i) => (i ? `${x(p[0]).toFixed(1)},${y(pts[i - 1][1]).toFixed(1)} ` : '') + `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
      s.append(svg('polyline', { points: d, fill: 'none', style: `stroke: ${c}`, 'stroke-width': 2, class: 'series-tracked', 'data-name': name, 'data-points': pts.length }));
      if (pts.length === 1) s.append(svg('circle', { cx: x(pts[0][0]), cy: y(pts[0][1]), r: 3, style: `fill: ${c}` }));
    });
    s.append(this.legend(all.map(([n], k) => [n, COLORS[k % COLORS.length]]), L + 8, T + 4));
    box.replaceChildren(s);
  }

  chartProgress(box) {
    const W = 380, H = 200, L = 48, R = 10, T = 10, B = 28;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', id: 'svg-progress', role: 'img' });
    // an audit's counts are its own solving, not the loop's progress: nothing to draw
    const pts = this.audit ? [] : this.series;
    const tMax = Math.max(1e-3, ...pts.map((p) => p[0]));
    const yMax = Math.max(1, ...pts.map((p) => Math.max(p[1], p[2])));
    s.append(svg('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, class: 'axis' }), svg('line', { x1: L, y1: T, x2: L, y2: H - B, class: 'axis' }));
    s.append(svg('text', { x: L - 4, y: T + 8, 'text-anchor': 'end', class: 'tick' }, fmt(yMax)));
    s.append(svg('text', { x: L - 4, y: H - B, 'text-anchor': 'end', class: 'tick' }, '0'));
    s.append(svg('text', { x: W - R, y: H - 8, 'text-anchor': 'end', class: 'tick' }, tMax.toFixed(1) + ' s'));
    const x = (t) => L + (t / tMax) * (W - L - R), y = (v) => H - B - (v / yMax) * (H - T - B);
    for (const [i, name] of [[1, 'candidates'], [2, 'refinements']]) {
      const d = pts.map((p) => `${x(p[0]).toFixed(1)},${y(p[i]).toFixed(1)}`).join(' ');
      s.append(svg('polyline', { points: d, fill: 'none', style: `stroke: ${COLORS[i - 1]}`, 'stroke-width': 2, class: `series-${name}`, 'data-points': pts.length }));
      // few points (a short run reports its counts once or twice): draw them as dots
      if (pts.length < 4) for (const p of pts) s.append(svg('circle', { cx: x(p[0]).toFixed(1), cy: y(p[i]).toFixed(1), r: 3, style: `fill: ${COLORS[i - 1]}` }));
    }
    s.append(this.legend([['candidates', COLORS[0]], ['refinements', COLORS[1]]], L + 8, T + 4));
    // say why the frame is (nearly) empty instead of leaving it blank
    const why = this.audit ? 'an audit: no loop to draw (its counts are in the Summary)'
      : !pts.length ? (this.S ? 'no counts reported yet' : 'no run yet')
        : pts.length < 3 ? 'too short for a curve (counts only at the end)' : '';
    if (why) s.append(svg('text', { x: (L + W - R) / 2, y: (T + H - B) / 2, 'text-anchor': 'middle', class: 'tick chart-empty-note' }, why));
    box.replaceChildren(s);
  }

  chartTime(box) {
    const W = 380, H = 200;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', id: 'svg-time', role: 'img' });
    const st = this.S;
    const parts = [];
    if (st) {
      let used = 0, ground = 0;
      Object.entries(st.solvers).forEach(([n, v], i) => { parts.push([`solving ${n}`, v.time, COLORS[i % COLORS.length]]); used += v.time; ground += v.ground; });
      parts.push(['grounding', ground, 'var(--chart-ground)']);
      parts.push(['rest', Math.max(0, st.t - used - ground), 'var(--chart-rest)']);
    }
    const total = parts.reduce((a, p) => a + p[1], 0) || 1;
    let x0 = 10;
    const bw = W - 20;
    parts.forEach(([name, v, c], i) => {
      const w = (v / total) * bw;
      s.append(svg('rect', { x: x0, y: 20, width: Math.max(0, w), height: 40, style: `fill: ${c}`, class: 'bar' }, undefined));
      x0 += w;
      const ly = 82 + i * 18;
      s.append(svg('rect', { x: 10, y: ly - 10, width: 12, height: 12, style: `fill: ${c}`, class: 'swatch' }));
      s.append(svg('text', { x: 28, y: ly, class: 'tick' }, `${name}: ${v.toFixed(3)} s (${Math.round((v / total) * 100)}%)`));
    });
    box.replaceChildren(s);
  }

  chartHist(box) {
    const W = 380, H = 200, L = 40, B = 34, T = 14;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', id: 'svg-hist', role: 'img' });
    const hist = (this.S && this.S.hist) || [0, 0, 0, 0, 0, 0, 0, 0];
    const max = Math.max(1, ...hist);
    const bw = (W - L - 10) / 8;
    s.append(svg('line', { x1: L, y1: H - B, x2: W - 10, y2: H - B, class: 'axis' }));
    s.append(svg('text', { x: L - 4, y: T + 4, 'text-anchor': 'end', class: 'tick' }, fmt(max)));
    hist.forEach((v, i) => {
      const bh = (v / max) * (H - B - T);
      s.append(svg('rect', { x: L + i * bw + 3, y: H - B - bh, width: bw - 6, height: bh, style: `fill: ${COLORS[1]}`, class: 'bar' }));
      s.append(svg('text', { x: L + i * bw + bw / 2, y: H - B + 14, 'text-anchor': 'middle', class: 'tick' }, HIST_LABELS[i]));
      if (v) s.append(svg('text', { x: L + i * bw + bw / 2, y: H - B - bh - 3, 'text-anchor': 'middle', class: 'tick' }, fmt(v)));
    });
    s.append(svg('text', { x: (W + L) / 2, y: H - 4, 'text-anchor': 'middle', class: 'tick' }, 'literals per clause'));
    if (!hist.some((v) => v > 0)) {
      s.append(svg('text', { x: (W + L) / 2, y: (H - B + T) / 2, 'text-anchor': 'middle', class: 'tick chart-empty-note' },
        this.audit ? 'an audit adds no clauses' : this.S ? 'no clauses in this run (blocks, expansions or none)' : 'no run yet'));
    }
    box.replaceChildren(s);
  }

  legend(items, x, y) {
    const g = svg('g');
    items.forEach(([name, c], i) => {
      g.append(svg('rect', { x, y: y + i * 16, width: 10, height: 10, style: `fill: ${c}` }));
      g.append(svg('text', { x: x + 14, y: y + i * 16 + 9, class: 'tick' }, name));
    });
    return g;
  }

  // ---- run history -------------------------------------------------------------
  record(info) {
    const s = this.S, d = this.D || {};
    // the row of the run whose results the tabs show (cleared by reset: a new run, Clear, another project)
    this.shownIndex = this.history.length;
    this.history.push({
      time: new Date().toTimeString().slice(0, 8),
      loop: info.loopLabel,
      outcome: d.outcome || info.outcome || 'error',
      exhausted: d.exhausted === true,
      elapsed: s.t,
      candidates: s.candidates,
      refinements: refinements(s),
      ...(refinementCounts(s).split ? { from_models: s.from_models, from_cores: s.from_cores, blocks: s.blocks } : {}),
      meanLength: meanLen(s),
      solutions: info.audit && info.audit.verdict !== 'limit' && !info.audit.mode ? info.audit.solutions : s.solutions,
      seed: info.settings.seed,
      engine: info.engine,
      solvers: (info.solvers || []).map((x) => ({ name: x.name, options: x.options })),
      settings: info.settings,
      fragmentsHash: info.fragmentsHash,
      mode: info.audit && info.audit.mode === 'space' ? 'bounded' : info.mode || 'run',
      audit: info.audit ? { verdict: info.audit.verdict, unsound: info.audit.unsound, pairs: info.audit.pairs,
        ...(info.audit.mode ? { mode: info.audit.mode, k: info.audit.k ?? null, space: info.audit.space ?? null,
          ...(info.audit.bound ? { bound: info.audit.bound } : {}), ...(info.audit.params ? { params: info.audit.params } : {}) } : {}) } : null,
      // for "two runs side by side" (FUTURE-DIRECTIONS D5) and the lab notebook (D10)
      counterexamples: s.counterexamples,
      perSolver: Object.fromEntries(Object.entries(s.solvers || {}).map(([k, v]) => [k, { calls: v.calls, time: v.time, conflicts: v.conflicts }])),
      ...(s.labels ? { labels: { ...s.labels } } : {}),
      variant: info.variant || null,
      // the instance of the run ('' = the project as written; null for a space audit), for Compare variants (js/compare.js)
      instance: info.audit && info.audit.mode === 'space' ? null : info.instance || '',
      note: '',
    });
    this.renderHistory();
  }

  mismatches() {
    const bad = new Set();
    const h = this.history;
    for (let i = 0; i < h.length; i++) {
      for (let j = i + 1; j < h.length; j++) {
        const a = h[i], b = h[j];
        if (a.mode === 'audit' || b.mode === 'audit' || a.mode === 'bounded' || b.mode === 'bounded') continue;
        if (a.fragmentsHash && a.fragmentsHash === b.fragmentsHash && a.settings && b.settings &&
            Number(a.settings.solutions) === 0 && Number(b.settings.solutions) === 0 &&
            a.outcome === 'finished' && b.outcome === 'finished' && a.exhausted && b.exhausted && a.solutions !== b.solutions) {
          bad.add(i); bad.add(j);
        }
      }
    }
    return bad;
  }

  // The audit column: an audit row shows its verdict; a run shows the verdict of the last
  // audit of the same fragments and constants, if there is one.
  auditText(r) {
    const a = r.audit || (r.mode !== 'audit' && r.mode !== 'bounded' && [...this.history].reverse().find((x) => x.audit && !x.audit.mode && x.fragmentsHash === r.fragmentsHash)?.audit);
    if (!a) return '–';
    if (a.mode === 'space') return a.verdict === 'sound' ? `sound ≤ ${a.k}` : `${a.verdict} at ${spaceAt(a)}`;
    if (a.mode === 'symbolic') return `${a.verdict} (symbolic)`;
    if (a.verdict === 'unsound') return `unsound (${fmt(a.unsound)})`;
    return a.verdict;
  }

  // Pools from the expansions of the last run (R events of kind e): one pool per fact name, an
  // item per expansion (the atoms inside name(k, atom)), keyed by the domain the run reported.
  savePools() {
    const rec = this.app.recording;
    const E = rec ? rec.steps.filter((s) => s.k === 'e' && s.f && s.f.length) : [];
    const note = this.root.querySelector('#history-note');
    if (!E.length) { note.hidden = false; note.textContent = 'No recorded expansions: run with Recording "every step" first.'; return 0; }
    const by = new Map();
    for (const s of E) {
      const items = new Map();
      for (const f of s.f) {
        const m = /^([a-z][A-Za-z0-9_]*)\(\d+,(.*)\)$/.exec(f);
        if (!m) continue;
        (items.get(m[1]) || items.set(m[1], []).get(m[1])).push(m[2]);
      }
      for (const [name, atoms] of items) {
        const p = by.get(name) || { name, domain: s.d || '', items: [] };
        p.items.push(atoms);
        by.set(name, p);
      }
    }
    const project = this.app.project;
    const pools = (project.pools || []).filter((p) => !by.has(p.name));
    project.pools = [...pools, ...by.values()];
    this.app.dirty();
    note.hidden = false;
    note.textContent = `Saved ${[...by.values()].map((p) => `pool ${p.name} (${p.items.length} items)`).join(', ')}. Use it in the loop with: for P in pool(name): A.expand(part, name = P)`;
    return by.size;
  }

  // A certcheck verdict ({ verdict, fragmentsHash, solutions }): the runs of the same fragments,
  // constants and solution count get the mark "certified" (or "rejected") in the Audit column.
  importVerdict(text) {
    let v;
    try { v = JSON.parse(text); } catch { return 0; }
    if (!v || !v.fragmentsHash) return 0;
    let n = 0;
    for (const r of this.history) {
      if (r.fragmentsHash === v.fragmentsHash && (v.verdict !== 'certified' || r.solutions === v.solutions)) { r.certcheck = v.verdict; n++; }
    }
    this.renderHistory();
    return n;
  }

  renderHistory() {
    const bad = this.mismatches();
    const rows = this.history.map((r, i) => ({
      attrs: { ...([bad.has(i) ? 'mismatch' : '', i === this.shownIndex ? 'shown-row' : ''].some(Boolean)
        ? { class: [bad.has(i) ? 'mismatch' : '', i === this.shownIndex ? 'shown-row' : ''].filter(Boolean).join(' ') } : {}),
        ...(bad.has(i) ? { 'data-mismatch': 'true' } : {}), ...(i === this.shownIndex ? { 'data-shown': 'true', title: 'The run whose results the tabs show now' } : {}),
        ...(r.audit ? { 'data-audit': r.audit.verdict } : {}) },
      cells: [(i === this.shownIndex ? '▶ ' : '') + (bad.has(i) ? '⚠ ' : '') + r.time, r.loop, r.outcome + (r.exhausted ? ' (exhausted)' : ''), secs(r.elapsed), fmt(r.candidates),
        fmt(r.refinements) + (r.from_models !== undefined ? ` (${fmt(r.from_models)} · ${fmt(r.from_cores)} · ${fmt(r.blocks)})` : ''), typeof r.meanLength !== 'number' ? '–' : r.meanLength.toFixed(2), fmt(r.solutions), String(r.seed ?? 0), this.auditText(r) + (r.certcheck ? ` · ${r.certcheck}` : '')],
    }));
    // 'Loop [instance]': the loop's first line, then the instance in brackets and the variant
    const t = this.table('history-table', ['Time', 'Loop [instance]', 'Outcome', 'Elapsed', 'Candidates',
      ['Refinements', 'In brackets: from counterexamples · from cores · blocks. ' + COUNT_TIP], 'Mean clause', 'Solutions', 'Seed', 'Audit'],
      rows.length ? rows : [['(no finished runs yet)', '', '', '', '', '', '', '', '', '']], [3, 4, 5, 6, 7, 8]);
    // the lab notebook (a note per run) and the pick of two runs to compare
    if (this.history.length) {
      t.querySelector('thead tr').append(h('th', {}, 'Compare'), h('th', {}, 'Note'), h('th', {}, ''));
      this.compareSel = (this.compareSel || []).filter((i) => i < this.history.length);
      [...t.querySelectorAll('tbody tr')].forEach((tr, i) => {
        const r = this.history[i];
        const box = h('input', { type: 'checkbox', class: 'history-compare-pick', 'aria-label': `Compare run ${i + 1}` });
        box.checked = this.compareSel.includes(i);
        box.addEventListener('change', () => {
          this.compareSel = box.checked ? [...this.compareSel.filter((x) => x !== i), i].slice(-2) : this.compareSel.filter((x) => x !== i);
          this.renderHistory();
        });
        const note = h('input', { type: 'text', class: 'history-note-input', value: r.note || '', placeholder: 'why I tried this', 'aria-label': `Note on run ${i + 1}` });
        note.addEventListener('change', () => { r.note = note.value; if (this.app.dirty) this.app.dirty(); });
        const del = h('button', { class: 'control-button small-button history-delete', type: 'button', title: 'Remove this row from the run history',
          'aria-label': `Remove run ${i + 1} from the run history` }, '✕');
        del.addEventListener('click', () => this.removeRun(i));
        tr.append(h('td', {}, box), h('td', {}, note), h('td', {}, del));
      });
    }
    this.renderCompare();
    this.root.querySelector('#history-note').hidden = bad.size === 0;
    this.root.querySelector('#history-shown-note').hidden = this.shownIndex == null || this.shownIndex >= this.history.length;
    this.root.querySelector('#clear-history-button').disabled = this.history.length === 0;
    if (this.app.dirty) this.app.dirty(false);
  }

  // Two runs side by side (FUTURE-DIRECTIONS D5): the two rows picked in the run history, with
  // the change from the first to the second.
  renderCompare() {
    const box = this.root.querySelector('#history-compare-box');
    const sel = (this.compareSel || []).map((i) => this.history[i]).filter(Boolean);
    box.hidden = sel.length !== 2;
    if (sel.length !== 2) return;
    const [a, b] = sel;
    const num = (x) => (typeof x === 'number' ? x : null);
    const delta = (x, y) => {
      if (num(x) === null || num(y) === null) return '';
      const d = y - x;
      const pct = x ? ` (${d >= 0 ? '+' : ''}${Math.round((d / x) * 100)}%)` : '';
      return `${d >= 0 ? '+' : ''}${Number.isInteger(d) ? fmt(d) : d.toFixed(3)}${pct}`;
    };
    const rows = [
      ['Loop', a.loop, b.loop, ''], ['Note', a.note || '', b.note || '', ''],
      ['Outcome', a.outcome + (a.exhausted ? ' (exhausted)' : ''), b.outcome + (b.exhausted ? ' (exhausted)' : ''), ''],
      ['Elapsed (s)', a.elapsed, b.elapsed, delta(a.elapsed, b.elapsed)],
      ['Candidates', a.candidates, b.candidates, delta(a.candidates, b.candidates)],
      ['Counterexamples', a.counterexamples, b.counterexamples, delta(a.counterexamples, b.counterexamples)],
      ['Refinements', a.refinements, b.refinements, delta(a.refinements, b.refinements)],
      ['Mean clause', a.meanLength, b.meanLength, delta(a.meanLength, b.meanLength)],
      ['Solutions', a.solutions, b.solutions, a.solutions !== b.solutions ? 'differ' : ''],
    ];
    for (const n of new Set([...Object.keys(a.perSolver || {}), ...Object.keys(b.perSolver || {})])) {
      const x = (a.perSolver || {})[n] || {}, y = (b.perSolver || {})[n] || {};
      rows.push([`${n}: calls`, x.calls, y.calls, delta(x.calls, y.calls)], [`${n}: time (s)`, x.time, y.time, delta(x.time, y.time)],
        [`${n}: conflicts`, x.conflicts, y.conflicts, delta(x.conflicts, y.conflicts)]);
    }
    const show = (v) => (v == null ? '–' : typeof v === 'number' ? (Number.isInteger(v) ? fmt(v) : v.toFixed(3)) : String(v));
    this.table('history-compare', ['', `Run ${this.compareSel[0] + 1} (${a.time})`, `Run ${this.compareSel[1] + 1} (${b.time})`, 'Change'],
      rows.map((r) => ({ attrs: r[0] === 'Solutions' && r[3] ? { class: 'mismatch' } : {}, cells: [r[0], show(r[1]), show(r[2]), r[3]] })), [1, 2, 3]);
  }

  // Remove one row (no question: it is one run, and the button is next to it). The marks that
  // point at rows by position (the run the tabs show, the two picked to compare) follow.
  removeRun(i) {
    if (i < 0 || i >= this.history.length) return false;
    this.history.splice(i, 1);
    if (this.shownIndex != null) this.shownIndex = this.shownIndex === i ? null : this.shownIndex > i ? this.shownIndex - 1 : this.shownIndex;
    this.compareSel = (this.compareSel || []).filter((x) => x !== i).map((x) => (x > i ? x - 1 : x));
    this.renderHistory();
    if (this.app.dirty) this.app.dirty(false);
    return true;
  }

  // Remove every row, after a question: the rows are the only record of earlier runs (the
  // project kept in this browser loses them too).
  clearHistory() {
    const n = this.history.length;
    if (!n) return false;
    if (!window.confirm(`Remove all ${n} row${n === 1 ? '' : 's'} of the run history? This cannot be undone.`)) return false;
    this.history = [];
    this.renderHistory();
    return true;
  }

  // ---- copy ---------------------------------------------------------------------
  snapshot() {
    return { summary: this.S && { outcome: this.D && this.D.outcome, exhausted: this.D && this.D.exhausted, t: this.S.t,
      candidates: this.S.candidates, counterexamples: this.S.counterexamples, refinements: refinements(this.S), solutions: this.S.solutions,
      clauses: this.S.clauses, literals: this.S.literals, maxlen: this.S.maxlen, expansions: this.S.expansions, restarts: this.S.restarts,
      blocks: this.S.blocks, hist: this.S.hist }, solvers: this.solverRows(), counters: (this.S && this.S.counters) || {}, tracked: (this.S && this.S.tracked) || {} };
  }

  asText() {
    const sn = this.snapshot();
    const lines = [];
    if (sn.summary) {
      lines.push(Object.keys(sn.summary).join('\t'));
      lines.push(Object.values(sn.summary).map((v) => (Array.isArray(v) ? v.join(' ') : v)).join('\t'));
    }
    if (sn.solvers.length) {
      lines.push('');
      const keys = Object.keys(sn.solvers[0]);
      lines.push(keys.join('\t'));
      for (const r of sn.solvers) lines.push(keys.map((k) => r[k] ?? '').join('\t'));
    }
    const cs = Object.entries(sn.counters);
    if (cs.length) { lines.push(''); lines.push('counter\tvalue'); for (const [k, v] of cs) lines.push(`${k}\t${v}`); }
    const ts = Object.entries(sn.tracked || {});
    if (ts.length) { lines.push(''); lines.push('tracked\tlast value'); for (const [k, v] of ts) lines.push(`${k}\t${v}`); }
    return lines.join('\n') + '\n';
  }

  async copy(kind) {
    const text = kind === 'json' ? JSON.stringify(this.snapshot(), null, 2) : this.asText();
    const st = this.root.querySelector('#copy-status');
    this.lastCopied = text;
    try { await navigator.clipboard.writeText(text); st.textContent = 'Copied.'; } catch { st.textContent = 'Copying is not allowed here.'; }
  }
}
