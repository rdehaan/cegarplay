// Statistics tab, live line, charts, run history (spec-app.md section 10).
import { fmt } from './output.js';

const MAX_POINTS = 500;
const HIST_LABELS = ['1', '2', '3–4', '5–8', '9–16', '17–32', '33–64', '65+'];
const SVGNS = 'http://www.w3.org/2000/svg';
// Chart colours are tokens of css/theme.css, so the charts follow the colour theme without redrawing.
const COLORS = [1, 2, 3, 4, 5, 6, 7].map((i) => `var(--chart-${i})`);

const secs = (t) => (typeof t === 'number' ? (t < 10 ? t.toFixed(2) : t.toFixed(1)) + ' s' : '–');
const dash = (v) => (v === null || v === undefined ? '–' : fmt(typeof v === 'number' && !Number.isInteger(v) ? Math.round(v) : v));
const refinements = (s) => (s ? s.clauses + s.expansions : 0);
const meanLen = (s) => (s && s.clauses ? s.literals / s.clauses : null);

export function liveText(s) {
  if (!s) return ' ';
  return `${s.t.toFixed(1)} s · ${fmt(s.candidates)} candidates · ${fmt(s.counterexamples)} counterexamples · ` +
    `${fmt(refinements(s))} refinements · ${fmt(s.solutions)} solutions`;
}

// The run bar after an audit: its own counts (the S events of an audit count raw models).
export function auditLiveText(a) {
  if (!a || !a.verdict) return ' ';
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
    this.root = document.getElementById('statistics');
    this.history = [];
    this.build();
    this.reset();
  }

  build() {
    const r = this.root;
    r.innerHTML = `
      <div class="stats-block"><h3>Summary</h3><div class="table-wrapper"><table class="internals-table" id="stats-summary"></table></div></div>
      <div class="stats-block" id="certificates-block" hidden><h3>Certificates</h3>
        <div class="table-wrapper"><table class="internals-table" id="certificates-table"></table></div>
        <p class="note">Each refinement gets the cheapest certificate that holds: 0 a block, 1 an unsat core, 2 the
        three-valued evaluation of the check, 3 one solver call on the product of abstraction and check (also for
        the rules an expansion grounds), 4 a search for a lost solution (Certificates: exact).
        Uncertified does not mean unsound; use Audit for a verdict.</p></div>
      <div class="stats-block" id="lift-block" hidden><h3>Lifting coach</h3>
        <div class="table-wrapper"><table class="internals-table" id="lift-table"></table></div>
        <p class="note" id="lift-note"></p></div>
      <div class="stats-block"><h3>Solvers</h3><div class="table-wrapper"><table class="internals-table" id="solver-table"></table></div></div>
      <div class="stats-block"><h3>Refinements</h3><div class="table-wrapper"><table class="internals-table" id="refinement-table"></table></div></div>
      <div class="stats-block"><h3>Charts</h3>
        <div class="charts">
          <figure><figcaption>Candidates and refinements over time</figcaption><div id="chart-progress" class="chart"></div></figure>
          <figure><figcaption>Where the time went</figcaption><div id="chart-time" class="chart"></div></figure>
          <figure><figcaption>Clause lengths</figcaption><div id="chart-hist" class="chart"></div></figure>
        </div>
      </div>
      <div class="stats-block"><h3>Custom counters</h3><div class="table-wrapper"><table class="internals-table" id="counters-table"></table></div></div>
      <div class="stats-block">
        <h3>Copy</h3>
        <button class="control-button" id="copy-tsv-button">Copy as text (tab-separated)</button>
        <button class="control-button" id="copy-json-button">Copy as JSON</button>
        <span id="copy-status" class="note"></span>
      </div>
      <div class="stats-block">
        <h3>Run history</h3>
        <p class="inline-controls">
          <button class="control-button" id="rerun-seeds-button">Rerun with 5 seeds</button>
          <button class="control-button" id="clear-history-button">Clear</button>
          <button class="control-button" id="save-pool-button" title="Store the counterexamples of the last run's expansions as pools (needs Recording: every step)">Save counterexamples as pool</button>
          <button class="control-button" id="import-verdict-button" title="The --json output of tools/certcheck.py for a proof log of one of these runs">Import certcheck verdict</button>
          <input type="file" id="verdict-file" accept=".json,.txt" hidden>
        </p>
        <div class="table-wrapper"><table class="internals-table" id="history-table"></table></div>
        <p class="note" id="history-note">Rows marked ⚠ ran the same fragments with all solutions, finished exhausted,
          and found different numbers of solutions: at least one of the loops is not sound.</p>
      </div>`;
    r.querySelector('#copy-tsv-button').addEventListener('click', () => this.copy('tsv'));
    r.querySelector('#copy-json-button').addEventListener('click', () => this.copy('json'));
    r.querySelector('#clear-history-button').addEventListener('click', () => { this.history = []; this.renderHistory(); });
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

  done(D, info) {
    this.D = D;
    if (info && info.mode === 'audit' && info.audit) this.live.textContent = auditLiveText(info.audit);
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
    this.renderCharts();
    this.renderCounters();
    this.renderHistory();
  }

  table(id, head, rows, numeric = []) {
    const t = this.root.querySelector('#' + id);
    t.textContent = '';
    const tr = h('tr');
    head.forEach((x, i) => tr.append(h('th', numeric.includes(i) ? { class: 'num' } : {}, x)));
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

  renderSummary() {
    const s = this.S, d = this.D;
    const outcome = d ? d.outcome + (d.exhausted === true ? ' (exhausted)' : '') : s ? 'running' : '–';
    this.table('stats-summary', ['Outcome', 'Elapsed', 'Candidates', 'Counterexamples', 'Refinements', 'Solutions'],
      [[outcome, s ? secs(s.t) : '–', dash(s && s.candidates), dash(s && s.counterexamples), s ? fmt(refinements(s)) : '–', dash(s && s.solutions)]],
      [1, 2, 3, 4, 5]);
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
    this.table('refinement-table', ['Clauses', 'Mean length', 'Largest', 'Expansions', 'Restarts', 'Automatic blocks'],
      [[dash(s && s.clauses), m == null ? '–' : m.toFixed(2), dash(s && s.maxlen), dash(s && s.expansions), dash(s && s.restarts), dash(s && s.blocks)]],
      [0, 1, 2, 3, 4, 5]);
  }

  renderCounters() {
    const c = (this.S && this.S.counters) || {};
    const rows = Object.entries(c).map(([k, v]) => [k, fmt(v)]);
    this.table('counters-table', ['Counter', 'Value'], rows.length ? rows : [['(none: use count in the loop script)', '']], [1]);
  }

  renderCharts() {
    this.chartProgress(this.root.querySelector('#chart-progress'));
    this.chartTime(this.root.querySelector('#chart-time'));
    this.chartHist(this.root.querySelector('#chart-hist'));
  }

  chartProgress(box) {
    const W = 380, H = 200, L = 48, R = 10, T = 10, B = 28;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', id: 'svg-progress', role: 'img' });
    const pts = this.series;
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
    }
    s.append(this.legend([['candidates', COLORS[0]], ['refinements', COLORS[1]]], L + 8, T + 4));
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
    this.history.push({
      time: new Date().toTimeString().slice(0, 8),
      loop: info.loopLabel,
      outcome: d.outcome || info.outcome || 'error',
      exhausted: d.exhausted === true,
      elapsed: s.t,
      candidates: s.candidates,
      refinements: refinements(s),
      meanLength: meanLen(s),
      solutions: info.audit && info.audit.verdict !== 'limit' ? info.audit.solutions : s.solutions,
      seed: info.settings.seed,
      engine: info.engine,
      solvers: (info.solvers || []).map((x) => ({ name: x.name, options: x.options })),
      settings: info.settings,
      fragmentsHash: info.fragmentsHash,
      mode: info.mode || 'run',
      audit: info.audit ? { verdict: info.audit.verdict, unsound: info.audit.unsound, pairs: info.audit.pairs } : null,
    });
    this.renderHistory();
  }

  mismatches() {
    const bad = new Set();
    const h = this.history;
    for (let i = 0; i < h.length; i++) {
      for (let j = i + 1; j < h.length; j++) {
        const a = h[i], b = h[j];
        if (a.mode === 'audit' || b.mode === 'audit') continue;
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
    const a = r.audit || (r.mode !== 'audit' && [...this.history].reverse().find((x) => x.audit && x.fragmentsHash === r.fragmentsHash)?.audit);
    if (!a) return '–';
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
      attrs: { ...(bad.has(i) ? { class: 'mismatch', 'data-mismatch': 'true' } : {}), ...(r.audit ? { 'data-audit': r.audit.verdict } : {}) },
      cells: [(bad.has(i) ? '⚠ ' : '') + r.time, r.loop, r.outcome + (r.exhausted ? ' (exhausted)' : ''), secs(r.elapsed), fmt(r.candidates),
        fmt(r.refinements), typeof r.meanLength !== 'number' ? '–' : r.meanLength.toFixed(2), fmt(r.solutions), String(r.seed ?? 0), this.auditText(r) + (r.certcheck ? ` · ${r.certcheck}` : '')],
    }));
    this.table('history-table', ['Time', 'Loop', 'Outcome', 'Elapsed', 'Candidates', 'Refinements', 'Mean clause', 'Solutions', 'Seed', 'Audit'],
      rows.length ? rows : [['(no finished runs yet)', '', '', '', '', '', '', '', '', '']], [3, 4, 5, 6, 7, 8]);
    this.root.querySelector('#history-note').hidden = bad.size === 0;
    if (this.app.dirty) this.app.dirty(false);
  }

  // ---- copy ---------------------------------------------------------------------
  snapshot() {
    return { summary: this.S && { outcome: this.D && this.D.outcome, exhausted: this.D && this.D.exhausted, t: this.S.t,
      candidates: this.S.candidates, counterexamples: this.S.counterexamples, refinements: refinements(this.S), solutions: this.S.solutions,
      clauses: this.S.clauses, literals: this.S.literals, maxlen: this.S.maxlen, expansions: this.S.expansions, restarts: this.S.restarts,
      blocks: this.S.blocks, hist: this.S.hist }, solvers: this.solverRows(), counters: (this.S && this.S.counters) || {} };
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
    return lines.join('\n') + '\n';
  }

  async copy(kind) {
    const text = kind === 'json' ? JSON.stringify(this.snapshot(), null, 2) : this.asText();
    const st = this.root.querySelector('#copy-status');
    this.lastCopied = text;
    try { await navigator.clipboard.writeText(text); st.textContent = 'Copied.'; } catch { st.textContent = 'Copying is not allowed here.'; }
  }
}
