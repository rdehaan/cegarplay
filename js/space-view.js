// The candidate space region of the Observatory (docs/spec-views.md section 5): the map of
// every candidate coloured by its fate at the cursor's refinement, the alive curve and the blame
// matrix, from the audit's vectors and the last run's recorded steps.
import { Space, fates, mapOrder, blameMatrix, redundancy } from './space.js';
import { Recording } from './recording.js';
import { auditPlan, auditBody, assemble, modulesFor, validate } from './driver.js';
import { derive } from './project.js';
import { fmt } from './output.js';

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
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

export class SpaceView {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.F = null;
    this.build();
    if (app.cursor) app.cursor.subscribe(() => { if (this.F) { this.draw(); this.drawCurve(); } });
  }

  build() {
    this.root.hidden = false;
    this.root.textContent = '';
    this.order = h('select', { id: 'space-order', 'aria-label': 'Map order' },
      h('option', { value: 'blame' }, 'by the most blamed atoms (Z-order)'), h('option', { value: 'size' }, 'rows by number of true atoms'));
    this.order.addEventListener('change', () => { if (this.space) { this.layout(); this.draw(); } });
    this.slider = h('input', { type: 'range', id: 'space-step', min: 0, max: 0, value: 0, 'aria-label': 'Refinement' });
    this.slider.addEventListener('input', () => {
      const r = Number(this.slider.value), c = this.app.cursor;
      if (c && c.ticks.length) { if (r === 0) c.set(0); else c.setByStep(this.F.rows[r - 1].i); } else this.draw();
    });
    this.label = h('span', { id: 'space-label', class: 'note' });
    this.msg = h('p', { id: 'space-message', class: 'note', role: 'status' });
    this.canvas = h('canvas', { id: 'space-map', class: 'space-map', 'aria-label': 'Every candidate, coloured by its fate' });
    this.tip = h('p', { id: 'space-tip', class: 'note' });
    this.curve = h('div', { id: 'space-curve' });
    this.matrix = h('canvas', { id: 'space-blame', class: 'space-map', 'aria-label': 'Blame matrix: refinements by atoms' });
    this.summary = h('p', { id: 'space-summary' });
    this.root.append(
      h('h3', {}, 'Candidate space'),
      h('p', { class: 'note' }, 'Every candidate of the unrefined abstraction (from the audit), coloured by what the run\'s refinements did to it up to the chosen refinement: ',
        'alive, removed earlier, removed now, a lost solution, an accepted solution. Needs a run recorded with every step (Loop tab).'),
      h('div', { class: 'instances-bar' }, h('button', { class: 'control-button small-button', id: 'space-compute', onclick: () => this.compute() }, 'Compute'),
        h('button', { class: 'control-button small-button', id: 'space-compare', onclick: () => this.compareFile.click(), title: 'A second recording of the same project and instance' }, 'Compare with a recording'),
        this.compareFile = h('input', { type: 'file', id: 'space-compare-file', hidden: true, accept: '.cprec,.jsonl,.txt', onchange: () => this.openCompare() }),
        this.order, h('label', {}, 'Refinement ', this.slider), this.label),
      this.msg, this.summary, this.canvas, this.tip, this.curve, h('h4', {}, 'Blame matrix'), this.matrix);
    this.canvas.addEventListener('mousemove', (e) => this.hover(e));
    this.canvas.addEventListener('click', (e) => this.click(e));
  }

  // Audit vectors of the current project (instance of the last run) and the recorded steps.
  async compute() {
    const app = this.app;
    const rec = app.recording;
    if (!rec || !rec.I || !rec.steps.length) { this.msg.textContent = 'Run the project with Recording "every step" (Loop tab) first.'; return; }
    if (!app.ready || app.engine.active) return;
    this.msg.textContent = 'Auditing for the candidate vectors…';
    const p = structuredClone(app.collect());
    let d;
    try { d = derive(p, { instance: rec.header && rec.header.instance ? rec.header.instance : undefined }); } catch (e) { this.msg.textContent = e.message; return; }
    const exec = (prog, o) => app.engine.exec(prog, o);
    const pr = await validate(d, exec);
    const plan = pr.compiled ? auditPlan(pr.compiled) : { error: 'a raw Lua loop has no audit' };
    if (plan.error) { this.msg.textContent = `No candidate vectors: ${plan.error}`; return; }
    const run = { ...d, settings: { ...d.settings, solutions: 0, candidates: 0, trace: 0 } };
    const mods = [...modulesFor(run.settings, { compiled: pr.compiled, loop: run.loop }).map((m) => app.modules[m]), app.modules.audit];
    const a = assemble(run, pr.compiled, app.runtime, { modules: mods, body: auditBody(pr.compiled, plan, { vectors: true, limit: 1048576 }) });
    const r = await exec(a.program, '--outf=3');
    const ev = (r.out || []).filter((l) => l.startsWith('@@P ') || l.startsWith('@@A ')).map((l) => ({ kind: l[2], data: JSON.parse(l.slice(4)) }));
    const verdict = ev.filter((e) => e.kind === 'A' && e.data.verdict).map((e) => e.data).at(-1);
    if (verdict && verdict.verdict === 'limit') { this.msg.textContent = 'More candidates than the limit: no map.'; return; }
    const cands = ev.filter((e) => e.kind === 'P' && e.data.set === 'candidates').flatMap((e) => e.data.v);
    const sols = ev.filter((e) => e.kind === 'P' && e.data.set === 'solutions').flatMap((e) => e.data.v);
    this.setData(cands, sols, rec, plan.link);
  }

  setData(cands, sols, rec, linkName) {
    const li = Math.max(0, rec.I.links.findIndex((L) => L.link === linkName));
    this.atoms = rec.I.links[li].atoms;
    this.steps = rec.steps.filter((s) => s.l === li + 1 || s.k === 's');
    const t0 = performance.now();
    this.space = Space.fromHex(cands, this.atoms.length);
    this.truth = new Set(sols.map((x) => this.space.index.get(x.replace(/^0+/, '') || '0')).filter((i) => i !== undefined));
    this.F = fates(this.space, this.steps, { truth: this.truth });
    this.computeMs = performance.now() - t0;
    this.slider.max = String(this.F.rows.length);
    this.slider.value = String(this.F.firstUnsound ? this.F.firstUnsound.ref : this.F.rows.length);

    const red = redundancy(this.steps);
    this.summary.textContent = `${fmt(this.space.count)} candidates, ${fmt(this.truth.size)} solutions, ${fmt(this.F.rows.length)} refinements; ` +
      `alive at the end ${fmt(this.F.alive)}; ${fmt(this.F.already)} of ${fmt(this.F.total)} removals hit a candidate already removed; ` +
      `${fmt(red.length)} clauses contain an earlier one.` + (this.F.firstUnsound ? ` First unsound refinement: ${this.F.firstUnsound.ref} (it removes ${fmt(this.F.firstUnsound.lost)} solutions).` : ' No refinement removes a solution.');
    this.msg.textContent = '';
    this.layout();
    const c = this.app.cursor;
    if (c && c.ticks.length) c.setByStep(this.F.firstUnsound ? this.F.firstUnsound.i : this.F.rows.length ? this.F.rows[this.F.rows.length - 1].i : 0);
    this.draw();
    this.drawCurve();
    this.drawMatrix();
  }

  async openCompare() {
    const f = this.compareFile.files[0];
    this.compareFile.value = '';
    if (!f) return;
    try { this.compareWith(await Recording.fromBlob(f)); } catch (e) { this.msg.textContent = `${f.name}: ${e.message || e}`; }
  }

  // a second recording of the same instance: both alive curves, and the map shows which run
  // removed each candidate (by the cursor's step number in each run)
  compareWith(rec) {
    if (!this.F) { this.msg.textContent = 'Compute the candidate space first.'; return false; }
    const L = rec.I && rec.I.links.find((x) => x.atoms.join(' ') === this.atoms.join(' '));
    if (!L) { this.msg.textContent = 'The second recording has other interface atoms: no comparison.'; return false; }
    const li = rec.I.links.indexOf(L) + 1;
    this.B = { rec, steps: rec.steps.filter((s) => s.l === li || s.k === 's') };
    this.B.F = fates(this.space, this.B.steps, { truth: this.truth });
    if (this.app.views) this.app.views.compareWith(rec);
    this.msg.textContent = `Compared with a second recording: ${fmt(this.B.F.rows.length)} refinements, alive at the end ${fmt(this.B.F.alive)}` +
      (this.B.F.firstUnsound ? `, first unsound refinement ${this.B.F.firstUnsound.ref}.` : ', no refinement removes a solution.');
    this.draw();
    this.drawCurve();
    return true;
  }

  layout() {
    this.M = mapOrder(this.space, this.steps, this.order.value);
    this.cellIndex = new Map();
    for (let i = 0; i < this.space.count; i++) this.cellIndex.set(this.M.xs[i] * 65536 + this.M.ys[i], i);
    const maxW = Math.max(200, (this.root.clientWidth || 640) - 8);
    this.cell = Math.max(1, Math.min(12, Math.floor(maxW / Math.max(1, this.M.width)), Math.floor(480 / Math.max(1, this.M.height))));
    const dpr = window.devicePixelRatio || 1;
    const W = this.M.width * this.cell, H = this.M.height * this.cell;
    this.canvas.width = W * dpr; this.canvas.height = H * dpr;
    this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.colors = { alive: css('--panel'), aliveSol: css('--call-sat'), gone: css('--chart-ground'), now: css('--accent'), lost: css('--error'), accepted: css('--ok'), border: css('--border'),
      onlyA: css('--chart-2'), onlyB: css('--chart-1'), both: css('--chart-ground') };
  }

  // the colour of candidate i at refinement r (1-based; 0 = before any)
  fateAt(i, r) {
    const F = this.F;
    const stepI = r > 0 ? F.rows[r - 1].i : 0;
    const f = F.fate[i];
    if (F.accepted[i] && F.accepted[i] <= stepI) return 'accepted';
    if (f && f <= stepI) return f === stepI ? (this.truth.has(i) ? 'lost' : 'now') : (this.truth.has(i) ? 'lost' : 'gone');
    return this.truth.has(i) ? 'aliveSol' : 'alive';
  }

  // the refinement at the cursor: the number of refinements at or before its step
  refinementAtCursor() {
    const c = this.app.cursor;
    if (!c || !c.ticks.length) return Number(this.slider.value);
    if (c.index === 0) return 0;
    let r = 0;
    for (const row of this.F.rows) { if (row.i <= c.step) r = row.ref; else break; }
    return r;
  }

  draw() {
    if (!this.F) return;
    const t0 = performance.now();
    const r = this.refinementAtCursor();
    this.slider.value = String(r);
    const c = this.cell, ctx = this.ctx, M = this.M, col = this.colors;
    ctx.fillStyle = col.border;
    ctx.fillRect(0, 0, M.width * c, M.height * c);
    const by = { alive: [], aliveSol: [], gone: [], now: [], lost: [], accepted: [], onlyA: [], onlyB: [], both: [] };
    if (this.B) {
      // removed by this run only, by the second run only, by both (up to the cursor's step number)
      const step = this.app.cursor && this.app.cursor.ticks.length ? this.app.cursor.step : (r > 0 ? this.F.rows[r - 1].i : 0);
      for (let i = 0; i < this.space.count; i++) {
        const a = this.F.fate[i] && this.F.fate[i] <= step, b = this.B.F.fate[i] && this.B.F.fate[i] <= step;
        by[a && b ? 'both' : a ? 'onlyA' : b ? 'onlyB' : (this.truth.has(i) ? 'aliveSol' : 'alive')].push(i);
      }
    } else for (let i = 0; i < this.space.count; i++) by[this.fateAt(i, r)].push(i);
    const gap = c > 3 ? 1 : 0;
    for (const [k, list] of Object.entries(by)) {
      ctx.fillStyle = col[k];
      for (const i of list) ctx.fillRect(M.xs[i] * c, M.ys[i] * c, c - gap, c - gap);
    }
    const row = r > 0 ? this.F.rows[r - 1] : null;
    this.label.textContent = row ? `${r} of ${this.F.rows.length} (step ${row.i}: removes ${fmt(row.removed)}, ${fmt(row.fresh)} new, ${fmt(row.lost)} solutions)` : `before the first refinement (${this.F.rows.length} in all)`;
    this.lastDrawMs = performance.now() - t0;
    this.canvas.dataset.cells = String(this.space.count);
  }

  cellAt(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / this.cell), y = Math.floor((e.clientY - rect.top) / this.cell);
    const i = this.cellIndex.get(x * 65536 + y);
    return i === undefined ? -1 : i;
  }

  hover(e) {
    if (!this.F) return;
    const i = this.cellAt(e);
    if (i < 0) { this.tip.textContent = ''; return; }
    const f = this.F.fate[i];
    const row = f ? this.F.rows.find((x) => x.i === f) : null;
    this.tip.textContent = `{${this.space.atoms(i, this.atoms).join(' ')}}${this.truth.has(i) ? ' (a solution)' : ''}` +
      (this.F.accepted[i] ? ', accepted' : row ? `, removed by refinement ${row.ref}` : ', never removed');
  }

  click(e) {
    if (!this.F) return;
    const i = this.cellAt(e);
    if (i < 0 || !this.F.fate[i]) return;
    const row = this.F.rows.find((x) => x.i === this.F.fate[i]);
    const c = this.app.cursor;
    if (c && c.ticks.length) c.setByStep(row.i); else { this.slider.value = String(row.ref); this.draw(); }
  }

  drawCurve() {
    const F = this.F, W = 360, H = 120;
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', `0 0 ${W} ${H}`); s.setAttribute('width', W); s.setAttribute('height', H); s.setAttribute('class', 'campaign-plot');
    const n = F.aliveSeries.length;
    const X = (k) => 30 + (n > 1 ? k / (n - 1) : 0) * (W - 40), Y = (v) => H - 20 - (v / Math.max(1, this.space.count)) * (H - 30);
    const pl = document.createElementNS(SVGNS, 'polyline');
    pl.setAttribute('points', F.aliveSeries.map((v, k) => `${X(k)},${Y(v)}`).join(' '));
    pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', css('--chart-2')); pl.setAttribute('stroke-width', 2);
    s.append(pl);
    if (this.B) {
      const m = this.B.F.aliveSeries.length;
      const XB = (k) => 30 + (m > 1 ? k / (m - 1) : 0) * (W - 40);
      const pb = document.createElementNS(SVGNS, 'polyline');
      pb.setAttribute('points', this.B.F.aliveSeries.map((v, k) => `${XB(k)},${Y(v)}`).join(' '));
      pb.setAttribute('fill', 'none'); pb.setAttribute('stroke', css('--chart-1')); pb.setAttribute('stroke-width', 2); pb.setAttribute('class', 'space-curve-b');
      s.append(pb);
    }
    const sr = this.app.cursor && this.app.cursor.stepRange();
    if (sr) {
      const inR = F.rows.filter((row) => row.i >= sr[0] && row.i <= sr[1]);
      if (inR.length) {
        const rect = document.createElementNS(SVGNS, 'rect');
        const xa = X(inR[0].ref - 1), xb = X(inR[inR.length - 1].ref - 1);
        rect.setAttribute('x', xa); rect.setAttribute('y', 8); rect.setAttribute('width', Math.max(1, xb - xa)); rect.setAttribute('height', H - 28);
        rect.setAttribute('fill', css('--chart-2')); rect.setAttribute('fill-opacity', 0.12);
        s.append(rect);
        this.rangeText = `In the range: ${inR.length} refinements remove ${fmt(inR.reduce((a, x) => a + x.fresh, 0))} candidates, ${fmt(inR.reduce((a, x) => a + x.lost, 0))} solutions.`;
      }
    } else this.rangeText = '';
    const rc = this.app.cursor && this.app.cursor.index ? this.refinementAtCursor() : 0;
    if (rc > 0) {
      const l = document.createElementNS(SVGNS, 'line');
      l.setAttribute('x1', X(rc - 1)); l.setAttribute('x2', X(rc - 1)); l.setAttribute('y1', 8); l.setAttribute('y2', H - 20); l.setAttribute('stroke', css('--text-muted')); l.setAttribute('stroke-dasharray', '3 3');
      s.append(l);
    }
    if (F.firstUnsound) {
      const l = document.createElementNS(SVGNS, 'line');
      const x = X(F.firstUnsound.ref - 1);
      l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('y1', 8); l.setAttribute('y2', H - 20); l.setAttribute('stroke', css('--error'));
      s.append(l);
    }
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('x', 30); t.setAttribute('y', H - 4); t.setAttribute('class', 'plot-label');
    t.textContent = `alive candidates per refinement (${fmt(this.space.count)} → ${fmt(F.alive)})`;
    s.append(t);
    this.curve.textContent = '';
    this.curve.append(s);
    if (this.rangeText) this.curve.append(h('p', { class: 'note', id: 'space-range' }, this.rangeText));
  }

  drawMatrix() {
    const B = blameMatrix(this.atoms.length, this.steps);
    const cv = this.matrix;
    const c = Math.max(1, Math.min(8, Math.floor(600 / Math.max(1, B.cols.length)), Math.floor(400 / Math.max(1, B.rows.length))));
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, B.cols.length * c) * dpr; cv.height = Math.max(1, B.rows.length * c) * dpr;
    cv.style.width = B.cols.length * c + 'px'; cv.style.height = B.rows.length * c + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colOf = new Map(B.cols.map((j, k) => [j, k]));
    const pos = css('--chart-2'), neg = css('--chart-1');
    B.rows.forEach((st, r) => {
      for (const x of st.q) { const k = colOf.get(Math.abs(x)); if (k === undefined) continue; ctx.fillStyle = x > 0 ? pos : neg; ctx.fillRect(k * c, r * c, c, c); }
    });
    cv.dataset.cols = String(B.cols.length);
  }
}
