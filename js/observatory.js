// The Observatory's cursor bar: the linked cursor's slider, follow,
// a brushed range, exports (SVG of the view, PNG of the map, a storyboard strip), data tables,
// and lecture mode.
import { ticksOf } from './cursor.js';
import { pairSteps } from './recording.js';
import { frameSVG, svgFile, Palette, layoutScene } from './views.js';
import { h, $, download } from './dom.js';


export class ObservatoryBar {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    const c = app.cursor;
    this.slider = h('input', { type: 'range', id: 'cursor-step', min: 0, max: 0, value: 0, 'aria-label': 'Step (linked cursor)' });
    this.slider.addEventListener('input', () => c.set(Number(this.slider.value)));
    this.label = h('span', { id: 'cursor-label', class: 'note' });
    this.follow = h('input', { type: 'checkbox', id: 'cursor-follow' });
    this.follow.addEventListener('change', () => { c.follow = this.follow.checked; if (c.follow) c.set(c.ticks.length); });
    this.from = h('input', { id: 'cursor-from', size: 5, inputmode: 'numeric', 'aria-label': 'Range from step' });
    this.to = h('input', { id: 'cursor-to', size: 5, inputmode: 'numeric', 'aria-label': 'Range to step' });
    this.stepsIn = h('input', { id: 'storyboard-steps', size: 12, placeholder: '1, 3, 6', 'aria-label': 'Storyboard steps' });
    this.data = h('div', { id: 'observatory-data', hidden: true });
    const b = (id, label, fn, title) => h('button', { class: 'control-button small-button', id, onclick: fn, title }, label);
    root.append(
      h('div', { class: 'instances-bar', id: 'cursor-bar' },
        h('label', {}, 'Step ', this.slider), this.label, h('label', {}, this.follow, ' follow the run'),
        h('label', {}, 'Range ', this.from), '–', this.to,
        b('cursor-range', 'Set range', () => c.setRange(this.toIndex(this.from.value), this.toIndex(this.to.value)), 'Restrict the line table and the alive curve to these steps'),
        b('cursor-clear', 'Clear', () => { this.from.value = ''; this.to.value = ''; c.setRange(null, null); })),
      h('div', { class: 'instances-bar' },
        b('export-view', 'Export view (SVG)', () => this.exportView()),
        b('export-map', 'Export candidate map (PNG)', () => this.exportMap()),
        h('label', {}, 'Storyboard of steps ', this.stepsIn), b('export-storyboard', 'Storyboard (SVG)', () => this.storyboard()),
        b('observatory-table', 'Data as table', () => this.toggleData())),
      this.data);
    c.subscribe(() => this.render());
    this.render();
  }

  // a step number typed by the user -> a cursor index
  toIndex(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || String(v).trim() === '') return null;
    const t = this.app.cursor.ticks;
    let k = 0;
    for (let j = 0; j < t.length; j++) if (t[j].i <= n) k = j + 1;
    return Math.max(1, k);
  }

  // a run ended or a recording was replayed: new ticks
  update() { this.app.cursor.setTicks(ticksOf(this.app.recording)); }

  // The exports save a picture that is on the page: disabled, with the reason, while there is none.
  syncExports() {
    const map = $('export-map'), view = $('export-view');
    const hasMap = !!(this.app.space && this.app.space.F);
    if (map) {
      map.disabled = !hasMap;
      map.title = hasMap ? 'Save the candidate space map below (Candidate space), at the cursor\'s step, as a PNG image'
        : 'Saves the candidate space map (below) as a PNG image; there is no map yet: compute it in Candidate space first';
    }
    // a view drawn for a recorded step (before a run the view has a scene but no step)
    const v = this.app.views, steps = !!(v && v.steps && v.steps.length);
    const hasView = !!(v && v.scene && v.lastFrame && steps);
    if (view) {
      view.disabled = !hasView;
      view.title = hasView ? 'Save the domain view at the cursor\'s step as an SVG image' : 'Saves the domain view as an SVG image; no view is drawn yet (a project with a view, after a run)';
    }
    const sb = $('export-storyboard');
    if (sb) {
      sb.disabled = !(v && v.view && steps);
      sb.title = sb.disabled ? 'Saves the frames of the chosen steps side by side; needs a domain view and a run' : 'Save the domain view at the chosen steps side by side, as one SVG image';
    }
    const tb = $('observatory-table');
    if (tb) {
      const any = !!(this.app.cursor && this.app.cursor.ticks.length);
      tb.disabled = !any;
      tb.title = any ? 'The marks of the view at the cursor and the fates of the refinements, as tables' : 'Tables of the view\'s marks and the refinements; needs a run';
    }
  }

  render() {
    this.syncExports();
    const c = this.app.cursor;
    this.slider.max = String(c.ticks.length);
    this.slider.value = String(c.index);
    const t = c.tick;
    // "recorded step 16 of 16 (reject)": the R steps count solutions; "traced step 13 of 13": the trace
    const KIND = { r: 'reject', a: 'add', e: 'expand', s: 'solution', x: 'error' };
    const which = this.app.recording && this.app.recording.steps && this.app.recording.steps.length ? 'recorded' : 'traced';
    this.label.textContent = c.ticks.length ? (t ? `${which} step ${t.i} (${c.index} of ${c.ticks.length}${t.k ? `, ${KIND[t.k] || t.k}` : ''})` : `before the first of ${c.ticks.length} ${which} steps`)
      + (c.range ? `; range ${c.ticks[c.range[0] - 1].i}–${c.ticks[c.range[1] - 1].i}` : '') : 'no recorded steps';
    this.follow.checked = c.follow;
    if (!this.data.hidden) this.fillData();
    // the trace of the Output tab follows the cursor too
    const tr = this.app.output && this.app.output.trace;
    if (tr && tr.events && tr.events.length && t) {
      // the T event paired with the last step at or before the cursor (R and T number apart)
      const pair = [...pairSteps(this.app.recording)].reverse().find((x) => x.i <= t.i && x.t);
      const k = pair ? tr.events.findIndex((e) => e.i === pair.t.i) : -1;
      if (k >= 0 && k !== tr.pos) tr.go(k);
    }
  }

  viewSVG() {
    const v = this.app.views;
    if (!v.scene || !v.lastFrame) return null;
    return svgFile(frameSVG(v.scene, v.lastFrame, v.pos, { palette: new Palette() }), 1000, 1000, v.current || 'view');
  }

  exportView() {
    const text = this.viewSVG();
    if (!text) { this.app.views.msg.textContent = 'No view drawn yet.'; return null; }
    download(`${this.app.views.current || 'view'}-step${this.app.cursor.step}.svg`, new Blob([text], { type: 'image/svg+xml' }));
    return text;
  }

  exportMap() {
    const cv = $('space-map');
    if (!cv || !this.app.space.F) return;
    cv.toBlob((blob) => blob && download(`candidates-step${this.app.cursor.step}.png`, blob));
  }

  // one SVG strip with the frames of the chosen steps (step numbers of the cursor's ticks)
  async storyboard() {
    const v = this.app.views;
    if (!v.scene) { v.msg.textContent = 'No view drawn yet.'; return null; }
    const want = String(this.stepsIn.value || '').split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const steps = want.length ? want : v.steps.slice(0, 4).map((s) => s.i);
    const pal = new Palette();
    const parts = [];
    let k = 0;
    for (const i of steps) {
      const idx = v.steps.findIndex((s) => s.i === i) + 1;
      if (idx < 1) continue;
      const m = await v.frameAt(idx);
      if (!m) continue;
      parts.push(`<text x="${k * 1100}" y="-10" font-family="sans-serif" font-size="28" fill="#222222">step ${i}</text>`);
      parts.push(frameSVG(v.scene, m, v.pos, { palette: pal, x0: k * 1100 }));
      k++;
    }
    if (!k) return null;
    const text = svgFile(parts.join('\n'), k * 1100 - 100, 1000, `${v.current} storyboard`);
    download(`${v.current || 'view'}-storyboard.svg`, new Blob([text], { type: 'image/svg+xml' }));
    return text;
  }

  toggleData() { this.data.hidden = !this.data.hidden; if (!this.data.hidden) this.fillData(); }

  // the views' data as tables: the marks of the frame, the fates per refinement
  fillData() {
    this.data.textContent = '';
    const v = this.app.views;
    if (v.lastFrame && v.scene) {
      const t = h('table', { class: 'internals-table', id: 'view-data-table' });
      t.append(h('tr', {}, ...['Element', 'Fill', 'Stroke', 'Label', 'Ringed'].map((x) => h('th', {}, x))));
      for (const e of v.scene.elements.values()) {
        const a = v.lastFrame.attrs.get(e.key) || {};
        t.append(h('tr', {}, h('td', {}, e.key), h('td', {}, a.fill || ''), h('td', {}, a.stroke || ''), h('td', {}, a.label ?? ''), h('td', {}, v.lastFrame.emph.has(e.key) ? 'yes' : '')));
      }
      this.data.append(h('h4', {}, 'Domain view'), h('div', { class: 'table-wrapper' }, t));
    }
    const S = this.app.space;
    if (S.F) {
      const t = h('table', { class: 'internals-table', id: 'space-data-table' });
      t.append(h('tr', {}, ...['Refinement', 'Step', 'Literals', 'Removed', 'New', 'Already removed', 'Solutions lost'].map((x) => h('th', {}, x))));
      for (const r of S.F.rows.slice(0, 500)) t.append(h('tr', {}, ...[r.ref, r.i, r.len, r.removed, r.fresh, r.already, r.lost].map((x) => h('td', { class: 'num' }, String(x)))));
      this.data.append(h('h4', {}, 'Candidate space'), h('div', { class: 'table-wrapper' }, t));
    }
  }
}

// ?lecture=1: one view full screen, notes as captions, the arrow keys move the cursor.
export function lectureMode(app) {
  document.body.classList.add('lecture');
  const tab = $('tab11');
  if (tab) tab.checked = true;
}
