// Observatory, loop anatomy: the loop as a diagram
// with live counters, the run as a timeline of solver calls, and the cost of each script line.
// The pure helpers (layout, lineTable, binCalls) use no DOM; the Anatomy class draws.
import { mapLine } from './driver.js';
import { compile } from './compiler.js';
import { fmt } from './output.js';

const SVGNS = 'http://www.w3.org/2000/svg';

// ---- pure helpers -----------------------------------------------------------------------

// Columns by longest path over the links: { col: { name: c }, columns: [[names]] }.
export function layout(solvers, links) {
  const col = Object.fromEntries(solvers.map((s) => [s, 0]));
  for (let pass = 0; pass < solvers.length; pass++) {
    let changed = false;
    for (const L of links) {
      if (L.from === L.to || !(L.from in col) || !(L.to in col)) continue;
      if (col[L.to] < col[L.from] + 1 && col[L.from] + 1 < solvers.length) { col[L.to] = col[L.from] + 1; changed = true; }
    }
    if (!changed) break;
  }
  const columns = [];
  for (const s of solvers) (columns[col[s]] || (columns[col[s]] = [])).push(s);
  return { col, columns: columns.map((c) => c || []) };
}

// The searches: ids of calls that enclose other calls.
export function searchIds(calls) {
  const out = new Set();
  for (const c of calls) if (c.p) out.add(c.p);
  return out;
}

// One row per loop line: { line, calls, sat, unsat, int, time (exclusive), total }, by time.
// lineOf maps the program line of a call (C.n) to a loop line (or null).
export function lineTable(calls, lineOf = (n) => n) {
  const child = new Map();
  for (const c of calls) if (c.p) child.set(c.p, (child.get(c.p) || 0) + (c.dt || 0));
  const rows = new Map();
  for (const c of calls) {
    const line = lineOf(c.n) ?? null;
    const key = line === null ? 'none' : line;
    let r = rows.get(key);
    if (!r) rows.set(key, r = { line, calls: 0, sat: 0, unsat: 0, int: 0, time: 0, total: 0 });
    r.calls++;
    if (c.r === 'sat') r.sat++; else if (c.r === 'unsat') r.unsat++; else r.int++;
    r.total += c.dt || 0;
    r.time += Math.max(0, (c.dt || 0) - (child.get(c.id) || 0));
  }
  return [...rows.values()].sort((a, b) => b.time - a.time || (a.line ?? 1e9) - (b.line ?? 1e9));
}

// Calls narrower than a pixel go into per-lane bins of one pixel: { bars, bins } where bars are
// the calls drawn as rectangles and bins[lane][px] = [sat, unsat, other].
export function binCalls(calls, { v0, v1, width, lanes, laneOf, searches = new Set(), keep = () => true }) {
  const scale = width / Math.max(1e-9, v1 - v0);
  const bars = [], bands = [];
  const bins = Array.from({ length: lanes }, () => new Map());
  for (const c of calls) {
    const lane = laneOf(c);
    if (lane < 0 || lane >= lanes) continue;
    const x0 = (c.t0 - v0) * scale, w = (c.dt || 0) * scale;
    if (x0 + w < 0 || x0 > width) continue;
    if (searches.has(c.id)) { bands.push({ c, lane, x0, w }); continue; }
    if (!keep(c)) continue;
    if (w >= 1) { bars.push({ c, lane, x0, w }); continue; }
    const px = Math.max(0, Math.min(width - 1, Math.floor(x0)));
    const m = bins[lane];
    let b = m.get(px);
    if (!b) m.set(px, b = [0, 0, 0]);
    b[c.r === 'sat' ? 0 : c.r === 'unsat' ? 1 : 2]++;
  }
  return { bars, bands, bins, scale };
}

// ---- drawing ------------------------------------------------------------------------------
const svg = (tag, attrs = {}, text) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};
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
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
const secs = (t) => (t >= 10 ? t.toFixed(1) : t >= 0.1 ? t.toFixed(2) : t.toFixed(4));

const BOX_W = 190, BOX_H = 92, COL_GAP = 110, ROW_GAP = 26, PAD = 16;
const LANE_H = 26, MARK_H = 18;
const TRACK_COLORS = ['--chart-2', '--chart-1', '--chart-3', '--chart-4'];

export class Anatomy {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.reset();
    this.build();
    if (app.cursor) app.cursor.subscribe(() => { if (this.visible) { this.drawTimeline(); this.drawTable(); } });
  }

  reset() {
    this.solvers = [];        // [{ name, fragments }]
    this.links = [];          // [{ name, from, to, atoms }]
    this.S = null;
    this.calls = [];
    this.steps = [];          // { t, k }
    this.view = null;         // [v0, v1] seconds, or null = all
    this.filterLine = null;
    this.assembled = null;
    this.rate = [];           // times of recent R events (pulse or rate)
    this.tracks = new Map();  // track statements: name -> [{ t, v }] (V events), drawn under the lanes
    this.dirty = { diagram: true, timeline: true, table: true };
  }

  build() {
    this.root.textContent = '';
    this.callsBox = h('input', { type: 'checkbox', id: 'anatomy-calls' });
    this.callsBox.addEventListener('change', () => {
      const st = this.app.project.settings;
      const r = { steps: 'off', n: 0, ...(st.record || {}), calls: this.callsBox.checked };
      if (r.steps === 'off' && !r.calls && !r.proof) delete st.record; else st.record = r;
      const lc = document.getElementById('record-calls');
      if (lc) lc.checked = this.callsBox.checked;
      if (this.app.loopTab && this.app.loopTab.syncRecordBox) this.app.loopTab.syncRecordBox();
      this.app.dirty();
    });
    this.diagram = h('div', { id: 'anatomy-diagram', class: 'anatomy-diagram' });
    this.canvas = h('canvas', { id: 'anatomy-timeline', class: 'anatomy-timeline', height: 80, 'aria-label': 'Timeline of solver calls' });
    this.note = h('p', { class: 'note', id: 'anatomy-note' });
    this.table = h('table', { class: 'internals-table', id: 'anatomy-lines' });
    this.root.append(
      h('h3', {}, 'Loop anatomy'),
      h('p', { class: 'note' }, 'One box per solver with its calls, and one arrow per link with its interface size. ',
        'A link flashes when a step refines through it.'),
      this.diagram,
      h('h3', {}, 'Timeline'),
      h('p', { class: 'note' }, 'Where the time of the run goes. One lane per solver; each call it makes (a solve, or one check inside a search) is a bar ',
        'from its start to its end, so long calls and the solver that dominates stand out. A thin band over a lane is a search; the ticks along the top ',
        'mark solutions and refinements; the vertical line is the Observatory\'s cursor.'),
      this.legend = h('p', { class: 'note anatomy-legend', id: 'anatomy-legend' },
        ...[['--call-sat', 'sat (a model)'], ['--call-unsat', 'unsat (none)'], ['--call-int', 'interrupted'], ['--call-search', 'search']]
          .map(([c, t]) => h('span', { class: 'legend-item' }, h('span', { class: 'legend-swatch', style: `background: var(${c})` }), ' ', t))),
      h('p', { class: 'note' }, h('label', {}, this.callsBox, ' Record calls'),
        ' (off by default: the timeline and the table below need it; the setting is also in the Loop tab). Wheel zooms, drag pans, double click shows all.'),
      this.timelineBox = h('div', { class: 'anatomy-timeline-box' }, this.canvas),
      this.note,
      this.linesHead = h('h3', {}, 'Cost per line'),
      this.linesBox = h('div', { class: 'table-wrapper' }, h('p', { class: 'note' }, 'The loop script\'s lines with the calls they made and their time: which line of the loop costs most. A click on a row shows its calls in the timeline.'), this.table));
    this.bindTimeline();
  }

  get visible() { return this.root.offsetParent !== null; }

  // A project was loaded or the tab opened: the diagram of the script as written.
  load() {
    this.reset();
    this.callsBox.checked = !!(this.app.project.settings.record && this.app.project.settings.record.calls);
    this.fromScript();
    this.schedule();
  }

  fromScript() {
    const p = this.app.project;
    if (!p || !p.loop || p.loop.language !== 'loop') return;
    let c;
    try { c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) }); } catch { return; }
    if (!c || !c.ok) return;
    this.solvers = c.solvers.map((s) => ({ name: s.name, fragments: s.fragments }));
    this.links = c.links.map((L) => ({ name: L.name, from: L.from, to: L.to, atoms: null }));
  }

  start({ assembled = null, compiled = null } = {}) {
    this.reset();
    this.assembled = assembled;
    if (compiled && compiled.ok) {
      this.solvers = compiled.solvers.map((s) => ({ name: s.name, fragments: s.fragments }));
      this.links = compiled.links.map((L) => ({ name: L.name, from: L.from, to: L.to, atoms: null }));
    }
    this.schedule();
  }

  event(kind, d) {
    switch (kind) {
      case 'H':
        this.solvers = d.solvers.map((s) => ({ name: s.name, fragments: s.fragments || [] }));
        this.links = (d.links || []).map((L) => ({ name: L.name, from: L.from, to: L.to, atoms: L.atoms }));
        this.dirty.diagram = true;
        break;
      case 'S': this.S = d; this.dirty.diagram = true; break;
      case 'C': this.calls.push(d); this.dirty.timeline = true; this.dirty.table = true; break;
      case 'V':
        if (typeof d.v === 'number' && typeof d.t === 'number') {
          if (!this.tracks.has(d.n)) this.tracks.set(d.n, []);
          this.tracks.get(d.n).push({ t: d.t, v: d.v });
          this.dirty.timeline = true;
        }
        break;
      case 'R':
        this.steps.push({ t: d.t, k: d.k });
        this.dirty.timeline = true;
        if (!this.app.control || !this.app.control.replaying) this.pulse(d.l);
        break;
      default: return;
    }
    this.schedule();
  }

  done() {
    this.dirty = { diagram: true, timeline: true, table: true };
    this.render();
    this.annotateLoop();
  }

  schedule() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => { this.pending = null; if (this.visible) this.render(); });
  }

  render() {
    if (this.dirty.diagram) this.drawDiagram();
    if (this.dirty.timeline) this.drawTimeline();
    if (this.dirty.table) this.drawTable();
    this.dirty = { diagram: false, timeline: false, table: false };
  }

  // ---- diagram ---------------------------------------------------------------------------
  drawDiagram() {
    const names = this.solvers.map((s) => s.name);
    const { col, columns } = layout(names, this.links);
    const rows = Math.max(1, ...columns.map((c) => c.length));
    const W = PAD * 2 + columns.length * BOX_W + Math.max(0, columns.length - 1) * COL_GAP;
    const H = PAD * 2 + rows * BOX_H + (rows - 1) * ROW_GAP;
    const pos = {};
    columns.forEach((c, i) => c.forEach((n, j) => {
      const off = (rows - c.length) * (BOX_H + ROW_GAP) / 2;
      pos[n] = { x: PAD + i * (BOX_W + COL_GAP), y: PAD + off + j * (BOX_H + ROW_GAP) };
    }));
    const root = svg('svg', { viewBox: `0 0 ${W} ${H + 8}`, width: W, height: H + 8, role: 'img', 'aria-label': 'Solvers and links of the loop', class: 'anatomy-svg' });
    root.append(svg('defs', {}), svg('title', {}, 'Solvers and links'));
    const marker = svg('marker', { id: 'anatomy-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.append(svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'anatomy-arrowhead' }));
    root.firstChild.append(marker);
    this.linkEls = [];
    const now = performance.now();
    const rate = this.rate.filter((t) => now - t < 1000).length;
    this.links.forEach((L, i) => {
      const a = pos[L.from], b = pos[L.to];
      if (!a || !b) return;
      const g = svg('g', { class: 'anatomy-link', 'data-link': L.name });
      let d, lx, ly;
      if (L.from === L.to) {
        d = `M${a.x + BOX_W - 30},${a.y} C${a.x + BOX_W},${a.y - 40} ${a.x + BOX_W + 40},${a.y + 10} ${a.x + BOX_W},${a.y + 24}`;
        lx = a.x + BOX_W + 6; ly = a.y - 12;
      } else {
        const fwd = col[L.to] > col[L.from];
        const x1 = fwd ? a.x + BOX_W : a.x, x2 = fwd ? b.x : b.x + BOX_W;
        const y1 = a.y + BOX_H / 2 + (fwd ? -8 : 8), y2 = b.y + BOX_H / 2 + (fwd ? -8 : 8);
        const mx = (x1 + x2) / 2;
        d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
        lx = mx; ly = (y1 + y2) / 2 - 6;
      }
      const path = svg('path', { d, class: 'anatomy-arrow', 'marker-end': 'url(#anatomy-arrow)' });
      const label = `${L.name}${L.atoms != null ? ` · ${fmt(L.atoms)} atoms` : ''}${rate > 30 && this.lastLink === i + 1 ? ` · ${rate}/s` : ''}`;
      g.append(path, svg('text', { x: lx, y: ly, 'text-anchor': 'middle', class: 'anatomy-label' }, label));
      root.append(g);
      this.linkEls[i + 1] = g;
    });
    for (const s of this.solvers) {
      const p = pos[s.name];
      if (!p) continue;
      const st = this.S && this.S.solvers && this.S.solvers[s.name];
      const g = svg('g', { class: 'anatomy-solver', 'data-solver': s.name, transform: `translate(${p.x},${p.y})` });
      g.append(svg('rect', { width: BOX_W, height: BOX_H, rx: 6, class: st && st.busy ? 'anatomy-box busy' : 'anatomy-box' }));
      g.append(svg('text', { x: 10, y: 20, class: 'anatomy-name' }, s.name));
      const frag = (s.fragments || []).filter((f) => f !== 'instance').join(' + ');
      g.append(svg('text', { x: 10, y: 37, class: 'anatomy-frag' }, frag.length > 28 ? frag.slice(0, 27) + '…' : frag));
      const c = st ? `${fmt(st.calls)} call${st.calls === 1 ? '' : 's'} · ${fmt(st.sat)} sat · ${fmt(st.unsat)} unsat` : 'no calls yet';
      g.append(svg('text', { x: 10, y: 60, class: 'anatomy-count', 'data-count': 'calls' }, c));
      g.append(svg('text', { x: 10, y: 78, class: 'anatomy-count', 'data-count': 'time' }, st ? `${secs(st.time || 0)} s` : ''));
      if (st && st.k > 0) {
        g.append(svg('rect', { x: BOX_W - 44, y: 6, width: 38, height: 18, rx: 9, class: 'anatomy-badge' }));
        g.append(svg('text', { x: BOX_W - 25, y: 19, 'text-anchor': 'middle', class: 'anatomy-badge-text' }, `+${st.k}`));
      }
      root.append(g);
    }
    this.diagram.textContent = '';
    this.diagram.append(root);
  }

  pulse(l) {
    if (!l) return;
    const now = performance.now();
    this.rate.push(now);
    while (this.rate.length && now - this.rate[0] > 1000) this.rate.shift();
    this.lastLink = l;
    if (this.rate.length > 30) { this.dirty.diagram = true; return; }
    const g = this.linkEls && this.linkEls[l];
    if (!g) return;
    g.classList.remove('pulse');
    void g.getBoundingClientRect();
    g.classList.add('pulse');
  }

  // ---- timeline --------------------------------------------------------------------------
  extent() {
    let t1 = 0;
    for (const c of this.calls) t1 = Math.max(t1, c.t0 + (c.dt || 0));
    for (const s of this.steps) t1 = Math.max(t1, s.t);
    for (const pts of this.tracks.values()) for (const p of pts) t1 = Math.max(t1, p.t);
    return [0, t1 > 0 ? t1 : 1];
  }

  drawTimeline() {
    // without recorded calls there is nothing to draw: no empty chart or table, but what to do
    const none = !this.calls.length;
    this.timelineBox.hidden = none; this.legend.hidden = none;
    this.linesHead.hidden = none; this.linesBox.hidden = none;
    const cv = this.canvas;
    const lanes = Math.max(1, this.solvers.length);
    const tracks = [...this.tracks.entries()];
    const width = Math.max(200, Math.floor(cv.parentElement.clientWidth || 600));
    const height = MARK_H + (lanes + tracks.length) * LANE_H + 16;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== width * dpr || cv.height !== height * dpr) {
      cv.width = width * dpr; cv.height = height * dpr;
      cv.style.width = width + 'px'; cv.style.height = height + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const LABEL = 60, w = width - LABEL;
    const [v0, v1] = this.view || this.extent();
    const color = { sat: css('--call-sat'), unsat: css('--call-unsat'), int: css('--call-int'), search: css('--call-search') };
    ctx.font = '11px sans-serif';
    ctx.fillStyle = css('--text-muted');
    this.solvers.forEach((s, i) => ctx.fillText(s.name, 4, MARK_H + i * LANE_H + 16));
    tracks.forEach(([name], i) => ctx.fillText(name, 4, MARK_H + (lanes + i) * LANE_H + 16));
    const t = performance.now();
    if (none) {
      this.note.textContent = this.steps.length || this.S ? 'This run has no recorded calls: tick "Record calls" above and run again to see its timeline and the cost of each loop line.'
        : 'Run the project (with "Record calls" ticked) to see its calls.';
    }
    const searches = searchIds(this.calls);
    const lineOf = (n) => this.lineOf(n);
    const keep = this.filterLine === null ? () => true : (c) => lineOf(c.n) === this.filterLine;
    const { bars, bands, bins } = binCalls(this.calls, { v0, v1, width: w, lanes, laneOf: (c) => c.s - 1, searches, keep });
    ctx.save();
    ctx.translate(LABEL, 0);
    for (const b of bands) {
      ctx.fillStyle = color.search;
      ctx.fillRect(b.x0, MARK_H + b.lane * LANE_H + 2, Math.max(1, b.w), 4);
    }
    for (const b of bars) {
      ctx.fillStyle = color[b.c.r] || color.int;
      ctx.fillRect(b.x0, MARK_H + b.lane * LANE_H + 8, b.w, LANE_H - 12);
    }
    bins.forEach((m, lane) => {
      const y = MARK_H + lane * LANE_H + 8, hh = LANE_H - 12;
      for (const [px, [sa, un, ot]] of m) {
        const n = sa + un + ot;
        let yy = y;
        for (const [k, v] of [['sat', sa], ['unsat', un], ['int', ot]]) {
          if (!v) continue;
          const part = hh * v / n;
          ctx.fillStyle = color[k];
          ctx.fillRect(px, yy, 1, part);
          yy += part;
        }
      }
    });
    // marks: solutions, refinements, expansions
    const scale = w / Math.max(1e-9, v1 - v0);
    const markColor = { s: css('--call-sat'), r: css('--text-muted'), a: css('--text-muted'), e: css('--accent'), x: css('--call-unsat') };
    const seen = new Set();
    for (const s of this.steps) {
      const x = Math.floor((s.t - v0) * scale);
      if (x < 0 || x > w) continue;
      const key = x * 8 + 'sraex'.indexOf(s.k);
      if (seen.has(key)) continue;
      seen.add(key);
      ctx.fillStyle = markColor[s.k] || css('--text-muted');
      const top = s.k === 's' ? 2 : s.k === 'e' ? 6 : 10;
      ctx.fillRect(x, top, 1, 6);
    }
    // tracked values (track statements): one lane each, a step line from value to value, so a
    // bound that moves lines up with the call that moved it
    tracks.forEach(([name, pts], i) => {
      const y0 = MARK_H + (lanes + i) * LANE_H + 4, hh = LANE_H - 8;
      const vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs);
      const Y = (v) => y0 + hh - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * hh;
      ctx.strokeStyle = css(TRACK_COLORS[i % TRACK_COLORS.length]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((p, k) => {
        const x = (p.t - v0) * scale, y = Y(p.v);
        if (k === 0) ctx.moveTo(x, y);
        else { ctx.lineTo(x, Y(pts[k - 1].v)); ctx.lineTo(x, y); }
      });
      if (pts.length) ctx.lineTo((Math.max(pts.at(-1).t, v1) - v0) * scale, Y(pts.at(-1).v));
      ctx.stroke();
      ctx.fillStyle = css('--text-muted');
      ctx.fillText(`${fmt(lo)}–${fmt(hi)}`, Math.max(2, w - 60), y0 + 9);
    });
    // the linked cursor and its range
    const cur = this.app.cursor;
    if (cur) {
      const tr = cur.timeRange();
      if (tr) { ctx.fillStyle = css('--chart-2'); ctx.globalAlpha = 0.12; ctx.fillRect((tr[0] - v0) * scale, 0, Math.max(1, (tr[1] - tr[0]) * scale), height); ctx.globalAlpha = 1; }
      if (cur.tick) { ctx.fillStyle = css('--text'); ctx.fillRect(Math.floor((cur.tick.t - v0) * scale), 0, 1, height - 14); }
    }
    ctx.restore();
    ctx.fillStyle = css('--text-muted');
    ctx.fillText(`${secs(v0)} s`, LABEL, height - 3);
    const end = `${secs(v1)} s`;
    ctx.fillText(end, width - ctx.measureText(end).width - 2, height - 3);
    this.lastDrawMs = performance.now() - t;
    if (this.calls.length) {
      this.note.textContent = `${fmt(this.calls.length)} call${this.calls.length === 1 ? '' : 's'}, ${fmt(searches.size)} search${searches.size === 1 ? '' : 'es'}; drawn in ${this.lastDrawMs.toFixed(1)} ms.` +
        (this.filterLine !== null ? ` Showing the calls of loop line ${this.filterLine} (click the row again to show all).` : '');
    }
  }

  bindTimeline() {
    const cv = this.canvas;
    const LABEL = 60;
    const toT = (x) => { const [v0, v1] = this.view || this.extent(); const w = cv.clientWidth - LABEL; return v0 + (x - LABEL) / w * (v1 - v0); };
    cv.addEventListener('wheel', (e) => {
      if (!this.calls.length && !this.steps.length) return;
      e.preventDefault();
      const [v0, v1] = this.view || this.extent();
      const r = cv.getBoundingClientRect();
      const at = toT(e.clientX - r.left);
      const f = e.deltaY > 0 ? 1.25 : 0.8;
      const [e0, e1] = this.extent();
      const n0 = Math.max(e0, at - (at - v0) * f), n1 = Math.min(e1, at + (v1 - at) * f);
      this.view = n1 - n0 > 1e-7 ? [n0, n1] : this.view;
      this.drawTimeline();
    }, { passive: false });
    let drag = null;
    cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, view: this.view || this.extent() }; });
    addEventListener('mouseup', () => { drag = null; });
    addEventListener('mousemove', (e) => {
      if (!drag) return;
      const [v0, v1] = drag.view;
      const dt = (e.clientX - drag.x) / Math.max(1, cv.clientWidth - LABEL) * (v1 - v0);
      this.view = [v0 - dt, v1 - dt];
      this.drawTimeline();
    });
    cv.addEventListener('dblclick', () => { this.view = null; this.drawTimeline(); });
  }

  // ---- line table ------------------------------------------------------------------------
  lineOf(n) {
    if (!n) return null;
    return this.assembled ? mapLine(this.assembled, n) : n;
  }

  // the calls of the cursor's brushed range (elapsed time), or all
  rangeCalls() {
    const tr = this.app.cursor && this.app.cursor.timeRange();
    return tr ? this.calls.filter((c) => c.t0 + (c.dt || 0) >= tr[0] && c.t0 <= tr[1]) : this.calls;
  }

  rows() { return lineTable(this.rangeCalls(), (n) => this.lineOf(n)); }

  drawTable() {
    const rows = this.rows();
    this.table.textContent = '';
    this.table.append(h('tr', {}, ...['Loop line', 'Calls', 'Sat', 'Unsat', 'Time (exclusive)', 'Time (with nested)'].map((x) => h('th', {}, x))));
    if (!rows.length) { this.table.append(h('tr', {}, h('td', { colspan: 6 }, 'No calls recorded.'))); return; }
    const text = this.app.editors && this.app.editors.loop ? this.app.editors.loop.session.getDocument().getAllLines() : [];
    for (const r of rows) {
      // the loop source beside a row only when the line is a loop line (not in a replay)
      const src = this.assembled && r.line && text[r.line - 1] ? text[r.line - 1].trim() : '';
      const tr = h('tr', { 'data-line': r.line ?? '', class: r.line !== null && r.line === this.filterLine ? 'selected' : '' },
        h('td', {}, r.line === null ? '(outside the script)' : h('a', { href: '#', onclick: (e) => { e.preventDefault(); this.pickLine(r.line); } }, `${this.assembled ? '' : 'program '}${r.line}`), src ? h('code', { class: 'anatomy-src' }, ' ' + (src.length > 50 ? src.slice(0, 49) + '…' : src)) : null),
        h('td', { class: 'num' }, fmt(r.calls)), h('td', { class: 'num' }, fmt(r.sat)), h('td', { class: 'num' }, fmt(r.unsat)),
        h('td', { class: 'num' }, `${secs(r.time)} s`), h('td', { class: 'num' }, `${secs(r.total)} s`));
      this.table.append(tr);
    }
  }

  pickLine(line) {
    this.filterLine = this.filterLine === line ? null : line;
    const ed = this.app.editors && this.app.editors.loop;
    if (ed && this.filterLine !== null && this.assembled) { ed.gotoLine(line, 0, false); ed.selection.selectLine(); }
    this.drawTimeline();
    this.drawTable();
  }

  // Hover figures in the loop editor: an info annotation per line with calls.
  annotateLoop() {
    const ed = this.app.editors && this.app.editors.loop;
    if (!ed || !this.assembled || !this.calls.length) return;
    const old = (ed.session.getAnnotations() || []).filter((a) => !a.anatomy);
    const add = this.rows().filter((r) => r.line).map((r) => ({ row: r.line - 1, column: 0, type: 'info', anatomy: true,
      text: `${fmt(r.calls)} call${r.calls === 1 ? '' : 's'} (${fmt(r.sat)} sat, ${fmt(r.unsat)} unsat), ${secs(r.time)} s exclusive` }));
    ed.session.setAnnotations([...old, ...add]);
  }
}
