// The domain view region of the Observatory: pick a view and a step, draw
// the view's marks as SVG. Scene layout once per scene; a frame only changes attributes.
import { Engine } from './engine.js';
import { pairSteps, solutionSteps } from './recording.js';
import { viewAtoms as viewAtomsOf, frameSVG, svgFile } from './views.js';
import { frameFacts, viewProgram, sceneProgram, parseMarks, layoutScene, suggestView, Palette, FrameSource, VIEW_OPTIONS, viewProject } from './views.js';
import { hashText } from './util.js';
import { h, svg } from './dom.js';


// What "New view" starts with: it runs as it is (one note per step) and says what goes where.
const NEW_VIEW = `% A view: rules that derive marks draw(M). See Manual: Writing views.

#program scene.
% What every step shares, from the instance and the program fragments it reads:
% draw(node(X)) :- node(X).
% draw(edge(X,Y)) :- edge(X,Y).
% draw(cell(R,C)) :- cell(R,C).

#program frame.
% One step: cand(A) for the candidate's atoms, cex(A), kind(K), step(I).
% draw(attr(node(X), fill, chosen)) :- cand(in(X)).
draw(note(K)) :- kind(K).
`;

export class ViewPanel {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.engine = null;            // created on first use (one dedicated engine)
    this.source = null;
    this.palette = new Palette();
    this.build();
    // the step comes from the linked cursor (js/cursor.js); the panel keeps none of its own
    if (app.cursor) app.cursor.subscribe(() => this.show());
  }

  build() {
    this.root.hidden = false;
    this.root.textContent = '';
    this.select = h('select', { id: 'view-select', 'aria-label': 'View' });
    this.select.addEventListener('change', () => { this.current = this.select.value; this.resetScene(); this.syncEditor(); this.show(); });
    this.slider = h('input', { type: 'range', id: 'view-step', min: 1, max: 1, value: 1, 'aria-label': 'Step' });
    this.slider.addEventListener('input', () => {
      const st = this.steps[Number(this.slider.value) - 1];
      if (st && this.app.cursor) this.app.cursor.setByStep(st.i);
    });
    this.stepLabel = h('span', { id: 'view-step-label', class: 'note' });
    // Show: the recorded steps, or the run's solutions. A solution is not a step of the trace (it
    // has none for an accepted candidate, and stops after settings.trace steps): shown apart, with
    // what is known of when it was found, instead of as a made-up step after the last traced one.
    this.mode = 'steps';
    const radio = (value, text) => {
      const r = h('input', { type: 'radio', name: 'view-show', value, id: `view-show-${value}`, checked: value === 'steps' });
      r.addEventListener('change', () => { if (r.checked) { this.mode = value; this.renderMode(); this.show(); } });
      return [r, h('label', { for: `view-show-${value}`, id: `view-show-${value}-label` }, text)];
    };
    this.showBox = h('div', { class: 'view-show', role: 'radiogroup', 'aria-label': 'Show the recorded steps or the solutions' },
      h('span', { class: 'note' }, 'Show '), ...radio('steps', 'steps'), ...radio('solutions', 'solutions'));
    this.solSlider = h('input', { type: 'range', id: 'view-solution', min: 1, max: 1, value: 1, 'aria-label': 'Solution' });
    this.solSlider.addEventListener('input', () => this.show());
    this.solLabel = h('span', { id: 'view-solution-label', class: 'note', 'aria-live': 'polite' });
    this.stepBox = h('label', { id: 'view-step-box' }, 'Step ', this.slider);
    this.solBox = h('label', { id: 'view-solution-box', hidden: true }, 'Solution ', this.solSlider);
    this.svgBox = h('div', { id: 'view-svg', class: 'view-svg' });
    this.notes = h('ul', { id: 'view-notes', class: 'view-notes' });
    this.svgBoxB = h('div', { id: 'view-svg-b', class: 'view-svg', hidden: true });
    this.msg = h('p', { id: 'view-message', class: 'note', role: 'status' });
    this.buttons = {
      add: h('button', { class: 'control-button small-button', id: 'view-new', title: 'A new view with a starting point for its rules', onclick: () => this.newView() }, 'New view'),
      suggest: h('button', { class: 'control-button small-button', id: 'view-suggest', title: 'Write a view from the predicates of the last run', onclick: () => this.suggest() }, 'Suggest a view'),
      rename: h('button', { class: 'control-button small-button', id: 'view-rename', onclick: () => this.renameView() }, 'Rename'),
      remove: h('button', { class: 'control-button small-button', id: 'view-delete', onclick: () => this.deleteView() }, 'Delete'),
    };
    // The view's own rules are edited here, not in the Programs tab: Editors puts the blocks of
    // view fragments into #view-fragments (js/editors.js, isViewFragment); this panel shows those
    // of the selected view. An edit redraws the view.
    this.reads = h('div', { id: 'view-reads', class: 'view-reads' });
    this.ownBox = h('div', { id: 'view-fragments' });
    this.editBox = h('details', { id: 'view-edit', class: 'view-edit' },
      h('summary', {}, 'Edit this view'),
      h('p', { class: 'note' }, 'The view\'s rules derive marks ', h('code', {}, 'draw(M)'), ': under ', h('code', {}, '#program scene.'),
        ' what every step shares (', h('code', {}, 'node(X)'), ', ', h('code', {}, 'edge(X,Y)'), ', ', h('code', {}, 'cell(R,C)'), ', ...), under ',
        h('code', {}, '#program frame.'), ' what one step changes (', h('code', {}, 'attr(E,fill,C)'), ', ', h('code', {}, 'emph(E)'), ', ', h('code', {}, 'note(T)'),
        ', ...), from the step\'s ', h('code', {}, 'cand/1'), ', ', h('code', {}, 'cex/1'), ', ', h('code', {}, 'kind/1'), ' and ', h('code', {}, 'step/1'),
        '. The view redraws as you type. Manual: ', h('a', { href: '#manual-writing-views' }, 'Writing views'), '.'),
      this.reads, this.ownBox);
    this.editBox.addEventListener('toggle', () => { if (this.editBox.open) requestAnimationFrame(() => this.app.editors.resizeShown()); });
    this.root.append(
      h('h3', {}, 'Domain view'),
      h('p', { class: 'note' }, 'A view draws each step of the run as a picture of the problem\'s domain. It is not part of the loop: ',
        'its rules only read the steps. Drag a node to fix its place.'),
      h('div', { class: 'instances-bar' }, this.select, this.buttons.add, this.buttons.suggest, this.buttons.rename, this.buttons.remove),
      h('div', { class: 'instances-bar' }, this.showBox, this.stepBox, this.stepLabel, this.solBox, this.solLabel),
      this.editBox,
      this.msg, h('div', { class: 'view-pair' }, this.svgBox, this.svgBoxB), this.notes);
  }

  get views() { return this.app.project.views || []; }
  get view() { return this.views.find((v) => v.name === this.current) || null; }

  // keep: keep the selected view if it still exists (after a fragment or view operation)
  load({ keep = false } = {}) {
    const was = this.current;
    this.select.textContent = '';
    for (const v of this.views) this.select.append(h('option', { value: v.name }, v.name));
    this.select.hidden = !this.views.length;
    this.current = keep && this.views.some((v) => v.name === was) ? was : (this.views[0] ? this.views[0].name : null);
    this.select.value = this.current || '';
    if (!keep || was !== this.current) this.resetScene();
    if (!keep) { this.steps = []; this.updateSteps(); }
    this.msg.textContent = this.views.length ? '' : 'This project has no view. "New view" starts one; "Suggest a view" writes one from the predicates of a run.';
    this.syncEditor();
  }

  // the editor part follows the selected view: its own fragments, the program fragments it reads
  syncEditor() {
    const v = this.view, ed = this.app.editors;
    this.editBox.hidden = !v;
    this.buttons.rename.hidden = this.buttons.remove.hidden = !v;
    this.svgBox.hidden = !v;
    if (!v) this.notes.textContent = '';
    for (const b of this.ownBox.querySelectorAll('.fragment')) b.hidden = !v || !(v.fragments || []).includes(b.dataset.fragment);
    this.reads.textContent = '';
    if (!v) return;
    const program = this.app.project.fragments.filter((f) => !ed.isViewFragment(f.name) && f.name !== 'instance');
    const boxes = program.map((f) => {
      const c = h('input', { type: 'checkbox', value: f.name, checked: (v.fragments || []).includes(f.name), disabled: ed.readOnly });
      c.addEventListener('change', () => this.setReads());
      return h('label', { class: 'view-read' }, c, ' ', f.name);
    });
    this.reads.append(h('span', { class: 'note' }, 'Reads the program fragments '), ...boxes,
      h('span', { class: 'note' }, ' (and the instance of the last run). Its own rules:'));
    for (const b of Object.values(this.buttons)) b.disabled = ed.readOnly;
  }

  setReadOnly() { this.syncEditor(); }

  // Open the Observatory with the editor of the view that owns fragment name (else the selected one).
  openEditor(name) {
    const v = name && this.views.find((x) => (x.fragments || []).includes(name) && this.app.editors.isViewFragment(name));
    if (v && v.name !== this.current) { this.current = v.name; this.select.value = v.name; this.resetScene(); this.syncEditor(); }
    if (this.openTab) this.openTab();
    this.editBox.open = true;
    requestAnimationFrame(() => {
      this.app.editors.resizeShown();
      const f = name && this.app.editors.fragments.get(name);
      (f ? f.block : this.editBox).scrollIntoView({ block: 'start' });
      if (f) f.editor.focus();
      this.show();
    });
  }

  // called by Editors.build: the fragment blocks were made again
  editorsBuilt() { this.load({ keep: true }); }

  setReads() {
    const v = this.view;
    if (!v) return;
    const on = new Set([...this.reads.querySelectorAll('input:checked')].map((c) => c.value));
    const own = (v.fragments || []).filter((n) => this.app.editors.isViewFragment(n));
    v.fragments = [...this.app.project.fragments.map((f) => f.name).filter((n) => on.has(n)), ...own];
    this.app.dirty();
    this.show();
  }

  fragmentEdited(name) {
    const v = this.view;
    if (!v || !(v.fragments || []).includes(name)) return;
    clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => this.show(), 400);
  }

  freeName(base) {
    const p = this.app.project;
    const taken = (n) => p.fragments.some((f) => f.name === n) || this.views.some((v) => v.name === n);
    let name = base;
    for (let i = 2; taken(name); i++) name = `${base}${i}`;
    return name;
  }

  askViewName(question, current = '') {
    const n = this.app.editors.askName(question, current, 'view');
    if (n && this.views.some((v) => v.name === n)) { window.alert(`There is already a view called ${n}.`); return null; }
    return n;
  }

  // add a view with its own fragment, select it and open its editor
  addView(name, text, reads) {
    this.app.editors.withProject((proj) => {
      proj.fragments.push({ name, text, description: '' });
      proj.views = [...(proj.views || []), { name, fragments: [...reads, name] }];
    });
    this.current = name;
    this.load({ keep: true });
    this.resetScene();
    this.editBox.open = true;
    requestAnimationFrame(() => this.app.editors.resizeShown());
    this.show();
  }

  newView() {
    if (this.app.editors.readOnly) return;
    const name = this.askViewName('Name of the new view:', this.freeName('view'));
    if (!name) return;
    const reads = this.app.project.fragments.some((f) => f.name === 'shared') ? ['shared'] : [];
    this.addView(name, NEW_VIEW, reads);
  }

  renameView() {
    const v = this.view;
    if (!v || this.app.editors.readOnly) return;
    const n = this.askViewName(`New name for view ${v.name}:`, v.name);
    if (!n) return;
    const old = v.name;
    this.app.editors.withProject((proj) => {
      const pv = proj.views.find((x) => x.name === old);
      pv.name = n;
      // its own fragment of the same name follows
      const f = proj.fragments.find((x) => x.name === old);
      if (f && this.app.editors.isViewFragment(old, proj)) {
        f.name = n;
        for (const x of proj.views) x.fragments = x.fragments.map((y) => (y === old ? n : y));
      }
    });
    this.current = n;
    this.load({ keep: true });
  }

  deleteView() {
    const v = this.view;
    if (!v || this.app.editors.readOnly) return;
    if (!window.confirm(`Delete view ${v.name} and its rules?`)) return;
    const name = v.name;
    this.app.editors.withProject((proj) => {
      const own = v.fragments.filter((n) => this.app.editors.isViewFragment(n, proj));
      proj.views = proj.views.filter((x) => x.name !== name);
      const still = new Set(proj.views.flatMap((x) => x.fragments));
      proj.fragments = proj.fragments.filter((f) => !own.includes(f.name) || still.has(f.name));
    });
    this.load({ keep: true });
    this.show();
  }

  resetScene() { this.scene = null; this.sceneKey = null; this.palette = new Palette(); this.svgBox.textContent = ''; this.els = new Map(); }

  // the steps of the last run or replay: T events, else R events
  updateSteps() {
    this.steps = pairSteps(this.app.recording);
    this.slider.max = Math.max(1, this.steps.length);
    if (Number(this.slider.value) > this.steps.length) this.slider.value = 1;
    this.slider.disabled = !this.steps.length;
    this.solutions = solutionSteps(this.app.recording);
    this.solSlider.max = Math.max(1, this.solutions.length);
    if (Number(this.solSlider.value) > this.solutions.length) this.solSlider.value = String(Math.max(1, this.solutions.length));
    this.solSlider.disabled = !this.solutions.length;
    this.renderMode();
  }

  renderMode() {
    const sols = this.mode === 'solutions';
    this.stepBox.hidden = sols; this.stepLabel.hidden = sols;
    this.solBox.hidden = !sols; this.solLabel.hidden = !sols;
    const n = (this.solutions || []).length, total = this.app.recording ? (this.app.recording.solutions || []).length : 0;
    this.showBox.querySelector('#view-show-steps-label').textContent = `steps (${(this.steps || []).length})`;
    this.showBox.querySelector('#view-show-solutions-label').textContent = `solutions (${total > n ? `${n} of ${total}` : n})`;
  }

  // How much the trace tells: it keeps the first settings.trace steps (the project's setting now;
  // a recording does not store it).
  traceCut() {
    const rec = this.app.recording;
    if (!rec || (rec.steps && rec.steps.length)) return 0;
    const lim = Number(((this.app.project || {}).settings || {}).trace ?? 200);
    const T = rec.traces || [];
    return lim > 0 && T.length >= lim ? lim : 0;
  }

  // where a solution was found, as far as the recording knows
  solutionWhere(x) {
    const a = x.at;
    if (a.step != null) return `found at step ${a.step}`;
    if (a.after == null) return 'found when (not recorded)';
    if (a.before != null) return a.after ? `found between traced steps ${a.after} and ${a.before}` : `found before traced step ${a.before}`;
    if (!a.after) return 'found with no traced step before it';
    const cut = this.traceCut();
    return cut ? `found after traced step ${a.after}; the trace keeps only the first ${cut} steps, so when exactly is not known (record every step in the Loop tab)`
      : `found after step ${a.after}, the last step of the run`;
  }

  // frames come from a FrameSource; its engine starts only when a frame is not cached
  ensureEngine() {
    if (!this.source) {
      this.source = new FrameSource((p, o) => {
        if (!this.engine) this.engine = new Engine({ threads: false });
        return this.engine.exec(p, o);
      });
    }
  }

  // precomputed frames of an example (examples/views/<id>.json: program hash -> marks)
  prefill(map) {
    this.ensureEngine();
    for (const [k, atoms] of Object.entries(map || {})) this.source.cache.set(k, { atoms, error: null });
  }

  project() {
    // the facts of the instance the last run used reach the view too
    const id = this.app.recording && this.app.recording.header && this.app.recording.header.instance;
    return viewProject(this.app.collect(), id);
  }

  // the index (1-based) of the view step at the cursor: the last step at or before it
  cursorIndex() {
    const c = this.app.cursor;
    if (!c || !c.ticks.length) return Math.min(this.steps.length, Number(this.slider.value) || 1);
    if (c.index === 0) return 0;
    let k = 0;
    this.steps.forEach((st, j) => { if (st.i <= c.step) k = j + 1; });
    return k;
  }

  iface(step) {
    const rec = this.app.recording;
    if (step.r && rec && rec.I) { const L = rec.I.links[(step.r.l || 1) - 1]; return L ? L.atoms : []; }
    return [];
  }

  async show() {
    const v = this.view;
    const index = this.cursorIndex();
    this.slider.value = String(Math.max(1, index));
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
    let facts;
    if (this.mode === 'solutions') {
      const sols = this.solutions || [];
      const k = Math.min(sols.length, Math.max(1, Number(this.solSlider.value) || 1));
      const x = sols[k - 1];
      if (!x) { this.solLabel.textContent = 'no solution in the last run'; this.applyFrame(parseMarks([], v.name)); return; }
      this.solLabel.textContent = `solution ${x.n} of ${(this.app.recording.solutions || []).length}, ${this.solutionWhere(x)}`;
      facts = frameFacts(x.t);
    } else {
      const st = this.steps[index - 1];
      if (!st) { this.stepLabel.textContent = this.steps.length ? 'before the first step' : 'no recorded step (run first)'; this.applyFrame(parseMarks([], v.name)); return; }
      facts = st.t ? frameFacts(st.t) : frameFacts(st.r, this.iface(st));
      const cut = this.traceCut();
      this.stepLabel.textContent = cut ? `traced step ${st.i} of ${this.steps.length} (${st.t.kind}); the trace keeps only the first ${cut} steps of the run`
        : `step ${st.i} of ${this.steps.length} (${st.t ? st.t.kind : st.r.k})`;
    }
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

  // the marks of the frame at view step k (for the storyboard), without drawing
  async frameAt(k) {
    const v = this.view, st = this.steps[k - 1];
    if (!v || !st) return null;
    this.ensureEngine();
    const p = this.project();
    const facts = st.t ? frameFacts(st.t) : frameFacts(st.r, this.iface(st));
    const r = await this.source.frame(viewProgram(p, v, facts), `storyboard-${k}`);
    return !r || r.error ? null : parseMarks(r.atoms, v.name);
  }

  // a second recording of the same instance: its frame at the cursor's step, beside the first
  compareWith(rec) { this.compare = rec; this.svgBoxB.hidden = false; this.show(); }

  async showCompare() {
    const rec = this.compare, v = this.view;
    if (!rec || !v || !this.scene) return;
    const c = this.app.cursor, i = c ? c.step : 0;
    let facts = null;
    const st = [...pairSteps(rec)].reverse().find((x) => x.i <= i);
    if (st) facts = st.t ? frameFacts(st.t) : frameFacts(st.r, ((rec.I && rec.I.links[(st.r.l || 1) - 1]) || { atoms: [] }).atoms);
    let m = parseMarks([], v.name);
    if (facts) {
      const prog = viewProgram(this.project(), v, facts);
      const res = await this.source.frame(prog, 'compare');
      if (!res) return;
      if (!res.error) m = parseMarks(res.atoms, v.name);
    }
    this.svgBoxB.innerHTML = svgFile(frameSVG(this.scene, m, this.pos, { palette: new Palette() }), 1000, 1000, 'second recording');
  }

  applyFrame(m) {
    this.lastFrame = m;
    if (this.app.observatory) this.app.observatory.syncExports();
    if (this.compare) setTimeout(() => this.showCompare(), 0);
    for (const [key, x] of this.els) {
      const a = m.attrs.get(key) || {};
      const cls = [`view-shape`];
      if (a.fill) cls.push(`view-fill-${this.palette.slot(a.fill)}`);
      if (a.stroke) cls.push(`view-stroke-${this.palette.slot(a.stroke)}`);
      if (m.emph.has(key)) cls.push('view-emph');
      if (m.ghost.has(key)) cls.push('view-ghost');
      x.shape.setAttribute('class', x.kind === 'edge' ? cls.join(' ').replace('view-shape', 'view-edge') : cls.join(' '));
      if (a.weight !== undefined) x.shape.style.strokeWidth = a.weight <= 0 ? '0' : String(Math.max(0.5, a.weight)); else x.shape.style.strokeWidth = '';
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
    this.addView(this.freeName('view'), text, p.fragments.some((f) => f.name === 'shared') ? ['shared'] : []);
  }
}
