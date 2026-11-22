// The domain view region of the Observatory (docs/spec-views.md): pick a view and a step, draw
// the view's marks as SVG. Scene layout once per scene; a frame only changes attributes.
import { Engine } from './engine.js';
import { frameFacts, viewProgram, sceneProgram, parseMarks, layoutScene, suggestView, Palette, FrameSource, VIEW_OPTIONS } from './views.js';

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

export class ViewPanel {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.engine = null;            // created on first use (one dedicated engine)
    this.source = null;
    this.palette = new Palette();
    this.build();
  }

  build() {
    this.root.hidden = false;
    this.root.textContent = '';
    this.select = h('select', { id: 'view-select', 'aria-label': 'View' });
    this.select.addEventListener('change', () => { this.current = this.select.value; this.resetScene(); this.show(); });
    this.slider = h('input', { type: 'range', id: 'view-step', min: 1, max: 1, value: 1, 'aria-label': 'Step' });
    this.slider.addEventListener('input', () => this.show());
    this.stepLabel = h('span', { id: 'view-step-label', class: 'note' });
    this.svgBox = h('div', { id: 'view-svg', class: 'view-svg' });
    this.notes = h('ul', { id: 'view-notes', class: 'view-notes' });
    this.msg = h('p', { id: 'view-message', class: 'note', role: 'status' });
    this.root.append(
      h('h3', {}, 'Domain view'),
      h('p', { class: 'note' }, 'A view is an ASP fragment that turns a step into marks (draw/1): a scene part for what stays, a frame part for one step. ',
        'Drag a node to fix its place.'),
      h('div', { class: 'instances-bar' }, this.select,
        h('button', { class: 'control-button small-button', id: 'view-suggest', onclick: () => this.suggest() }, 'Suggest a view'),
        h('label', {}, 'Step ', this.slider), this.stepLabel),
      this.msg, this.svgBox, this.notes);
  }

  get views() { return this.app.project.views || []; }
  get view() { return this.views.find((v) => v.name === this.current) || null; }

  load() {
    this.select.textContent = '';
    for (const v of this.views) this.select.append(h('option', { value: v.name }, v.name));
    this.select.hidden = !this.views.length;
    this.current = this.views[0] ? this.views[0].name : null;
    this.resetScene();
    this.steps = [];
    this.updateSteps();
    this.msg.textContent = this.views.length ? '' : 'This project has no view. "Suggest a view" writes one from the predicates of the interface.';
  }

  resetScene() { this.scene = null; this.sceneKey = null; this.palette = new Palette(); this.svgBox.textContent = ''; this.els = new Map(); }

  // the steps of the last run or replay: T events, else R events
  updateSteps() {
    const rec = this.app.recording;
    const T = rec ? rec.traces : [];
    const R = rec ? rec.steps : [];
    this.steps = T.length ? T.map((t) => ({ t })) : R.map((r) => ({ r }));
    this.slider.max = Math.max(1, this.steps.length);
    if (Number(this.slider.value) > this.steps.length) this.slider.value = 1;
    this.slider.disabled = !this.steps.length;
  }

  ensureEngine() {
    if (!this.engine) {
      this.engine = new Engine({ threads: false });
      this.source = new FrameSource((p, o) => this.engine.exec(p, o));
    }
  }

  project() {
    // the facts of the instance the last run used reach the view too
    const p = this.app.collect();
    const id = this.app.recording && this.app.recording.header && this.app.recording.header.instance;
    const x = id && (p.instances || []).find((i) => i.id === id);
    if (x && typeof x.facts === 'string') return { ...p, fragments: [{ name: 'instance', text: x.facts }, ...p.fragments.filter((f) => f.name !== 'instance')] };
    return p;
  }

  iface(step) {
    const rec = this.app.recording;
    if (step.r && rec && rec.I) { const L = rec.I.links[(step.r.l || 1) - 1]; return L ? L.atoms : []; }
    return [];
  }

  async show(index = Number(this.slider.value)) {
    const v = this.view;
    if (!v || !this.root.offsetParent && !this.forceShow) return;
    this.ensureEngine();
    const p = this.project();
    let sceneText;
    try { sceneText = sceneProgram(p, v); } catch (e) { this.msg.textContent = e.message; return; }
    if (this.sceneKey !== sceneText) {
      const r = await this.source.frame(sceneText);
      if (!r) return;
      if (r.error) { this.msg.textContent = `The scene: ${r.error}`; return; }
      this.sceneKey = sceneText;
      this.scene = parseMarks(r.atoms, v.name);
      this.drawScene();
    }
    const st = this.steps[index - 1];
    if (!st) { this.stepLabel.textContent = 'no recorded step (run first)'; this.applyFrame(parseMarks([], v.name)); return; }
    const facts = st.t ? frameFacts(st.t) : frameFacts(st.r, this.iface(st));
    this.stepLabel.textContent = `step ${st.t ? st.t.i : st.r.i} of ${this.steps.length} (${st.t ? st.t.kind : st.r.k})`;
    const r = await this.source.frame(viewProgram(p, v, facts));
    if (!r) return;                                    // the cursor has moved on
    if (r.error) { this.msg.textContent = `The frame: ${r.error}`; return; }
    const m = parseMarks(r.atoms, v.name);
    this.lastMarks = r.atoms.length;
    this.msg.textContent = [...this.scene.problems, ...m.problems].slice(0, 5).join('; ');
    this.applyFrame(m);
  }

  drawScene() {
    const v = this.view, sc = this.scene;
    const fixed = new Map([...sc.pos, ...Object.entries(v.positions || {})]);
    this.pos = layoutScene(sc, sc.layout, fixed);
    const root = svg('svg', { viewBox: '-40 -40 1080 1080', class: 'view-root', role: 'img', 'aria-label': `View ${v.name}` });
    const gEdges = svg('g'), gNodes = svg('g');
    root.append(gEdges, gNodes);
    this.els = new Map();
    const size = this.pos.cellSize || 0;
    for (const e of sc.elements.values()) {
      if (e.kind === 'edge') {
        const a = this.pos.get(e.from), b = this.pos.get(e.to);
        if (!a || !b) continue;
        const l = svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'view-edge', 'data-key': e.key });
        gEdges.append(l);
        this.els.set(e.key, { el: l, shape: l, kind: 'edge', e });
        continue;
      }
      const p = this.pos.get(e.key);
      if (!p) continue;
      const g = svg('g', { class: `view-${e.kind}`, 'data-key': e.key, transform: `translate(${p[0]},${p[1]})` });
      let shape;
      if (e.kind === 'cell') shape = svg('rect', { x: -size / 2 + 2, y: -size / 2 + 2, width: size - 4, height: size - 4, class: 'view-shape' });
      else if (e.kind === 'item' || e.kind === 'rank') shape = svg('rect', { x: -60, y: -20, width: 120, height: 40, rx: 6, class: 'view-shape' });
      else shape = svg('circle', { r: 28, class: 'view-shape' });
      const label = svg('text', { 'text-anchor': 'middle', dy: '0.35em', class: 'view-label' }, e.label || '');
      g.append(shape, label);
      gNodes.append(g);
      this.els.set(e.key, { el: g, shape, label, kind: e.kind, e });
      if (e.kind === 'node') this.draggable(g, e.key);
    }
    this.svgBox.textContent = '';
    this.svgBox.append(root);
    this.root.dataset.sceneElements = String(this.els.size);
  }

  applyFrame(m) {
    for (const [key, x] of this.els) {
      const a = m.attrs.get(key) || {};
      const cls = [`view-shape`];
      if (a.fill) cls.push(`view-fill-${this.palette.slot(a.fill)}`);
      if (a.stroke) cls.push(`view-stroke-${this.palette.slot(a.stroke)}`);
      if (m.emph.has(key)) cls.push('view-emph');
      if (m.ghost.has(key)) cls.push('view-ghost');
      x.shape.setAttribute('class', x.kind === 'edge' ? cls.join(' ').replace('view-shape', 'view-edge') : cls.join(' '));
      if (a.weight !== undefined) x.shape.style.strokeWidth = String(Math.max(0.5, a.weight)); else x.shape.style.strokeWidth = '';
      if (x.label) x.label.textContent = a.label !== undefined ? a.label : (x.e.label || '');
    }
    this.notes.textContent = '';
    for (const n of m.notes) this.notes.append(h('li', {}, n));
  }

  draggable(g, key) {
    let drag = null;
    g.addEventListener('pointerdown', (ev) => {
      const svgEl = g.ownerSVGElement;
      drag = { svgEl, pt: svgEl.createSVGPoint() };
      g.setPointerCapture(ev.pointerId);
    });
    g.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      drag.pt.x = ev.clientX; drag.pt.y = ev.clientY;
      const p = drag.pt.matrixTransform(drag.svgEl.getScreenCTM().inverse());
      g.setAttribute('transform', `translate(${p.x},${p.y})`);
      drag.last = [Math.round(p.x), Math.round(p.y)];
      this.pos.set(key, drag.last);
      for (const [, x] of this.els) {
        if (x.kind !== 'edge' || (x.e.from !== key && x.e.to !== key)) continue;
        const a = this.pos.get(x.e.from), b = this.pos.get(x.e.to);
        x.el.setAttribute('x1', a[0]); x.el.setAttribute('y1', a[1]); x.el.setAttribute('x2', b[0]); x.el.setAttribute('y2', b[1]);
      }
    });
    g.addEventListener('pointerup', () => {
      if (drag && drag.last) {
        const v = this.view;
        v.positions = { ...(v.positions || {}), [key]: drag.last };
        this.app.dirty();
      }
      drag = null;
    });
  }

  // Write a view fragment from the predicates of the interface and the shared facts.
  async suggest() {
    const app = this.app;
    if (!app.ready) return;
    const p = this.project();
    const rec = app.recording;
    let iface = rec && rec.I ? rec.I.links[0].atoms : [];
    if (!iface.length && rec) {
      const seen = new Set();
      for (const t of rec.traces) for (const a of String(t.candidate || '').split(/\s+/).concat((t.literals || []).map((l) => l.replace(/^-/, '')))) if (a) seen.add(a);
      iface = [...seen];
    }
    if (!iface.length) { this.msg.textContent = 'Run the project first: the suggestion reads the interface atoms of a recorded run.'; return; }
    const shared = ['instance', 'shared'].map((n) => p.fragments.find((f) => f.name === n)).filter(Boolean).map((f) => f.text).join('\n');
    this.ensureEngine();
    let facts = [];
    const all = await this.engine.exec(shared + '\n', VIEW_OPTIONS);
    try { facts = JSON.parse(all.out.join('\n')).Call[0].Witnesses[0].Value; } catch { facts = []; }
    const text = suggestView(iface, facts);
    let name = 'view';
    for (let i = 2; p.fragments.some((f) => f.name === name); i++) name = `view${i}`;
    app.editors.withProject((proj) => {
      proj.fragments.push({ name, text, description: 'A domain view (Observatory tab): a scene part and a frame part that draw/1 marks.' });
      proj.views = [...(proj.views || []), { name, fragments: ['shared', name] }];
    });
    this.load();
    this.current = name; this.select.value = name;
    this.resetScene();
    this.show();
  }
}
