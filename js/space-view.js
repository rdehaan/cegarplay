// The candidate space region of the Observatory (docs/spec-views.md section 5): the map of
// every candidate coloured by its fate at the cursor's refinement, the alive curve and the blame
// matrix, from the audit's vectors and the last run's recorded steps.
import { Space, fates, mapOrder, blameMatrix, redundancy } from './space.js';
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
  }

  build() {
    this.root.hidden = false;
    this.root.textContent = '';
    this.order = h('select', { id: 'space-order', 'aria-label': 'Map order' },
      h('option', { value: 'blame' }, 'atoms by blame, interleaved'), h('option', { value: 'size' }, 'rows by number of true atoms'));
    this.order.addEventListener('change', () => { if (this.space) { this.layout(); this.draw(); } });
    this.slider = h('input', { type: 'range', id: 'space-step', min: 0, max: 0, value: 0, 'aria-label': 'Refinement' });
    this.slider.addEventListener('input', () => this.draw());
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
    this.draw();
    this.drawCurve();
    this.drawMatrix();
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
    this.colors = { alive: css('--panel'), aliveSol: css('--call-sat'), gone: css('--chart-ground'), now: css('--accent'), lost: css('--error'), accepted: css('--ok'), border: css('--border') };
  }

  // the colour of candidate i at refinement r (1-based; 0 = before any)
  fateAt(i, r) {
    const F = this.F;
    const stepI = r > 0 ? F.rows[r - 1].i : 0;
    const f = F.fate[i];
    if (F.accepted[i]) return 'accepted';
    if (f && f <= stepI) return f === stepI ? (this.truth.has(i) ? 'lost' : 'now') : (this.truth.has(i) ? 'lost' : 'gone');
    return this.truth.has(i) ? 'aliveSol' : 'alive';
  }

  draw() {
    if (!this.F) return;
    const t0 = performance.now();
    const r = Number(this.slider.value);
    const c = this.cell, ctx = this.ctx, M = this.M, col = this.colors;
    ctx.fillStyle = col.border;
    ctx.fillRect(0, 0, M.width * c, M.height * c);
    const by = { alive: [], aliveSol: [], gone: [], now: [], lost: [], accepted: [] };
    for (let i = 0; i < this.space.count; i++) by[this.fateAt(i, r)].push(i);
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
    this.slider.value = String(row.ref);
    this.draw();
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
