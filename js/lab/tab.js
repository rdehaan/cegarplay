// The Refinement lab tab (docs/lab-design.md; manual: Refinement lab tab). The only lab module
// that touches the DOM. It talks only to the lab worker (js/lab/worker.js); it reads the page's
// project, run bar and latest recording, and changes none of them.
import { Recording } from '../recording.js';
import { fnv, LAB_LIMITS } from './space.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
};
const s = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  for (const k of kids.flat()) if (k !== null && k !== undefined) e.append(k);
  return e;
};
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n == null ? '–' : String(n));
const STORE = 'cegarplay.lab.';
const store = {
  get(k, d) { try { const v = localStorage.getItem(STORE + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(STORE + k, JSON.stringify(v)); } catch { /* no storage */ } },
};
const projectHash = (p) => fnv(JSON.stringify({ fragments: p.fragments, loop: p.loop, instances: p.instances, variants: p.variants, constants: p.settings && p.settings.constants }));
const download = (name, text, type = 'text/plain') => {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const csv = (rows) => rows.map((r) => r.map((x) => { const t = x == null ? '' : String(x); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(',')).join('\n') + '\n';
const svgText = (svg) => {
  const c = svg.cloneNode(true);
  c.setAttribute('xmlns', SVGNS);
  // resolve the theme's colours, so that the file looks the same outside the page
  const cs = getComputedStyle(document.documentElement);
  return c.outerHTML.replace(/var\((--[a-z0-9-]+)\)/g, (_, v) => cs.getPropertyValue(v).trim() || '#888');
};

// ---------------------------------------------------------------------------
// The worker client: one request at a time; Cancel terminates the lab worker only.
// ---------------------------------------------------------------------------
class LabClient {
  constructor() { this.worker = null; this.next = 1; this.pending = null; }
  spawn() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev) => {
      const d = ev.data, p = this.pending;
      if (!p || d.id !== p.id) return;
      if (d.type === 'progress') { if (p.onProgress) p.onProgress(d.data); return; }
      this.pending = null;
      if (d.type === 'result') p.resolve(d.data); else { const e = new Error(d.message); e.code = d.code; p.reject(e); }
    };
    this.worker.onerror = (e) => { const p = this.pending; this.pending = null; this.worker = null; if (p) { const x = new Error(`the lab's engine stopped: ${e.message || 'worker error'}`); x.code = 1; p.reject(x); } };
  }
  get busy() { return !!this.pending; }
  request(type, payload = {}, onProgress = null) {
    if (this.pending) return Promise.reject(Object.assign(new Error('the lab is busy'), { code: 5 }));
    if (!this.worker) this.spawn();
    return new Promise((resolve, reject) => {
      const id = this.next++;
      this.pending = { id, resolve, reject, onProgress };
      this.worker.postMessage({ id, type, ...payload });
    });
  }
  cancel() {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    const p = this.pending;
    this.pending = null;
    if (p) { const e = new Error('cancelled'); e.code = 'cancel'; p.reject(e); }
  }
}

const SCHEME_TEXT = { loop: 'loop (the loop\'s own options)', omniscient: 'omniscient (every minimal sound set)', block: 'block (the whole interface)' };

export class LabTab {
  constructor(app, root) {
    this.app = app; this.root = root;
    this.client = new LabClient();
    this.limits = { ...LAB_LIMITS, ...store.get('limits', {}) };
    this.space = null;          // { key, summary, atoms, count, hex, sol, ncex, pop, params }
    this.results = {};          // bounds by scheme, simulation, run, compare
    this.inspected = null;
    this.build();
    this.syncPickers();
    this.timer = setInterval(() => this.checkStale(), 1500);
  }

  // ---- layout -----------------------------------------------------------------------------
  build() {
    const R = this.root;
    R.textContent = '';
    this.inst = h('select', { id: 'lab-instance', 'aria-label': 'Instance' });
    this.variant = h('select', { id: 'lab-variant', 'aria-label': 'Variant' });
    this.link = h('input', { id: 'lab-link', type: 'text', size: 6, placeholder: 'auto', 'aria-label': 'Link', title: 'The link to look at; empty: as the audit chooses it' });
    this.source = h('select', { id: 'lab-source', 'aria-label': 'Source of steps' },
      h('option', { value: 'latest' }, 'the latest run of the page'), h('option', { value: 'file' }, 'an opened recording'), h('option', { value: 'free' }, 'free (no run)'));
    this.source.value = store.get('source', 'latest');
    this.source.addEventListener('change', () => { store.set('source', this.source.value); this.loadSteps(); });
    this.file = h('input', { type: 'file', id: 'lab-file', accept: '.cprec,.jsonl,.txt', hidden: true, onchange: () => this.openFile(this.file, 'file') });
    this.computeBtn = h('button', { class: 'control-button', id: 'lab-compute', type: 'button', onclick: () => this.computeSpace() }, 'Compute space');
    this.cancelBtn = h('button', { class: 'control-button', id: 'lab-cancel', type: 'button', disabled: true, onclick: () => this.cancel(), title: 'Stop the lab\'s computation (only the lab\'s engine; runs and audits are not affected)' }, 'Cancel');
    this.status = h('p', { id: 'lab-status', class: 'status-line', role: 'status', 'aria-live': 'polite' }, 'No space yet: press Compute space.');
    this.stale = h('p', { id: 'lab-stale', class: 'lab-stale', hidden: true });
    const lim = (key, label, title) => {
      const i = h('input', { type: 'number', min: 0, step: 1, id: `lab-limit-${key}`, value: this.limits[key], title });
      i.addEventListener('change', () => { const v = Math.max(0, Number(i.value) || 0); this.limits[key] = v; store.set('limits', this.limits); });
      return h('label', { class: 'inline-label' }, label, ' ', i);
    };
    this.limitsBox = h('details', { class: 'lab-limits', id: 'lab-limits' }, h('summary', {}, 'Limits'),
      h('div', { class: 'lab-row' },
        lim('candidates', 'candidates', 'Stop above this many candidates (the audit\'s cap is 200,000)'),
        lim('cex', 'counterexamples per candidate', 'How many counterexamples of a candidate the inspector lists and tries for justification'),
        lim('minimal', 'minimal sets', 'Enumerate at most this many minimal sound sets per candidate'),
        lim('exact', 'exact-bounds threshold', 'Skip the exact bounds above this many bad candidates'),
        lim('seconds', 'time budget (s)', 'Time budget of each clingo computation and of the simulation'),
        lim('runs', 'simulation runs', 'Idealised runs in random order')));
    const bar = h('div', { class: 'lab-bar', role: 'group', 'aria-label': 'Lab bar' },
      h('div', { class: 'lab-row' },
        h('label', { class: 'inline-label' }, 'Instance ', this.inst), h('label', { class: 'inline-label' }, 'Variant ', this.variant),
        h('label', { class: 'inline-label' }, 'Link ', this.link),
        h('label', { class: 'inline-label' }, 'Steps from ', this.source),
        h('button', { class: 'control-button small-button', type: 'button', id: 'lab-open', onclick: () => this.file.click() }, 'Open recording'), this.file),
      h('div', { class: 'lab-row' }, this.computeBtn, this.cancelBtn, this.limitsBox),
      this.status, this.stale);

    this.summaryBox = h('div', { id: 'lab-summary', class: 'lab-region' });
    this.inspectBox = h('div', { id: 'lab-inspect', class: 'lab-region' });
    this.boundsBox = h('div', { id: 'lab-bounds', class: 'lab-region' });
    this.runBox = h('div', { id: 'lab-run', class: 'lab-region' });
    R.append(bar,
      h('h3', {}, 'Space ', this.info('lab-info-space', 'The space', [
        'Every candidate of the unrefined abstraction (one per assignment of the link\'s interface atoms, as the audit enumerates them), every counterexample of each, and each distinct relevant set as one option of the loop.',
        'Solutions are candidates without a counterexample; bad candidates are the others. The loop scheme is sound on this instance when no option removes a solution: the same answer as the audit.'])), this.summaryBox,
      h('h3', {}, 'Step inspector ', this.info('lab-info-inspect', 'The step inspector', [
        'For one bad candidate M: every clause the loop could add there and how good each is. A set S of interface atoms gives the clause "one atom of S changes"; it removes R(M, S), the candidates that agree with M on S. It is sound when R(M, S) has no solution.',
        'Forced atoms are in every sound set: a solution differs from M only there (the witness). Minimal sound sets are the minimal hitting sets of the sets D(M, s) of atoms on which M and a solution s differ.',
        'Justified by X: X is a counterexample of every candidate the clause removes. That is the most a loop can know without knowing the solutions; justified implies sound.',
        'Pruning counts the removed candidates that are still alive at this step (all, in free mode).'])), this.inspectBox,
      h('h3', {}, 'Run bounds ', this.info('lab-info-bounds', 'Run bounds', [
        'An idealised run proposes alive candidates: a solution is accepted at no cost, a bad candidate is refined with one of its scheme\'s options. Its length is its number of refinements.',
        'Best and worst are exact (an ASP program with an acyclicity constraint, solved by clingo) when proven: by clingo within the time budget, or by reaching a bound computed without clingo (the packing bound for the best, the matching bound for the worst). Otherwise the result is an interval. The simulation runs the scheme in random orders.',
        'The idealisation ignores clasp\'s weak retention of clauses in Shape 1: a real Shape 1 run can be longer than the worst idealised run.'])), this.boundsBox,
      h('h3', {}, 'This run against the bounds ', this.info('lab-info-run', 'This run against the bounds', [
        'A recorded run (every step) placed among the idealised runs of the same instance: the ladder, its percentile among the simulated runs, and a decomposition of its length.',
        'Regret at a step: the pruning of the best option the loop had there minus the pruning of the clause the run used.'])), this.runBox);
    this.renderAll();
  }

  info(id, title, paras) {
    if (!document.getElementById(id)) {
      const m = h('div', { class: 'modal', id },
        h('div', { class: 'modal-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-title` },
          h('header', { class: 'modal-header' }, h('button', { class: 'close-modal', 'aria-label': 'close modal', 'data-close': '' }, '✕')),
          h('div', { class: 'modal-content' }, h('h3', { id: `${id}-title` }, title), ...paras.map((p) => h('p', {}, p)),
            h('p', {}, h('a', { href: '#manual-refinement-lab-tab' }, 'Manual: Refinement lab tab')))));
      document.body.append(m);
    }
    return h('a', { href: '#', class: 'modal-link', 'data-open': id, title: `About: ${title}`, 'aria-label': `About: ${title}` }, '');
  }

  // the run bar's instance and variant are the starting point; changing them here does not change the run bar
  syncPickers() {
    const p = this.app.project;
    const fill = (sel, items, none, current) => {
      const keep = sel.value;
      sel.textContent = '';
      if (none) sel.append(h('option', { value: '' }, none));
      for (const x of items) sel.append(h('option', { value: x }, x));
      const want = keep && items.includes(keep) ? keep : current;
      sel.value = want != null && (items.includes(want) || want === '') ? want : (sel.options[0] ? sel.options[0].value : '');
      sel.closest('label').hidden = !items.length;
    };
    const rb = (id) => { const e = document.getElementById(id); return e && !e.hidden ? e.value : undefined; };
    fill(this.inst, (p.instances || []).map((x) => x.id), (p.instances || []).length ? '(no instance)' : null, rb('instance-select'));
    fill(this.variant, (p.variants || []).map((x) => x.name), '(as written)', rb('variant-select') || '');
  }

  shown() { this.syncPickers(); this.checkStale(); if (this.source.value === 'latest' && this.space) this.loadSteps(); }

  setBusy(text) {
    this.computeBtn.disabled = !!text;
    this.cancelBtn.disabled = !text;
    for (const b of this.root.querySelectorAll('.lab-needs-idle')) b.disabled = !!text;
    if (text) this.status.textContent = text;
  }

  async call(type, payload, what) {
    this.setBusy(`${what}…`);
    const t0 = Date.now();
    try {
      return await this.client.request(type, payload, (p) => {
        const parts = [p.phase || what];
        if (p.done != null && p.of) parts.push(`${fmt(p.done)} of ${fmt(p.of)}`);
        else if (p.s != null) parts.push(`${p.s} s`);
        this.status.textContent = `${parts.join(': ')} (${((Date.now() - t0) / 1000).toFixed(1)} s)…`;
      });
    } finally { this.setBusy(null); }
  }

  failed(e, what) {
    if (e.code === 'cancel') { this.status.textContent = `${what}: cancelled. The lab's engine stopped; results shown before stay (the space is computed again on the next request).`; return; }
    this.status.textContent = `${what}: ${e.code === 4 ? '' : 'stopped: '}${e.message}`;
  }

  cancel() { this.client.cancel(); }

  // ---- the space --------------------------------------------------------------------------
  params() {
    const p = structuredClone(this.app.collect());
    return { project: p, instance: this.inst.closest('label').hidden ? undefined : this.inst.value, variant: this.variant.closest('label').hidden ? undefined : (this.variant.value || undefined),
      link: this.link.value.trim() || undefined, limit: this.limits.candidates || LAB_LIMITS.candidates };
  }

  async computeSpace({ again = null } = {}) {
    const prm = again || this.params();
    let r;
    try { r = await this.call('space', prm, 'Enumerating the space'); }
    catch (e) { this.failed(e, 'Compute space'); return false; }
    const changed = !this.space || this.space.key !== r.key;
    this.space = { ...r, params: prm, hash: projectHash(prm.project) };
    if (changed) { this.results = {}; this.inspected = null; this.runSteps = null; }
    const S = r.summary;
    const line = `space: ${fmt(S.candidates)} candidates, ${fmt(S.solutions)} solutions, ${fmt(S.bad)} bad, ${fmt(S.atoms)} interface atoms${r.cached ? ' (kept from before)' : ''}`;
    this.status.textContent = line;
    this.checkStale();
    this.renderAll();
    if (this.source.value !== 'free') {
      await this.loadSteps();
      const k = this.runSteps ? this.runSteps.steps.filter((x) => x.kind === 'refinement').length : null;
      this.status.textContent = line + (k != null ? `; the recorded run: ${fmt(k)} refinements` : '');
    }
    return true;
  }

  // after a Cancel the worker (and its space) is gone: compute the space again, same parameters
  async ensure() {
    if (!this.space) return false;
    if (!this.client.worker) return this.computeSpace({ again: this.space.params });
    return true;
  }

  checkStale() {
    if (!this.space) { this.stale.hidden = true; return; }
    let now = null;
    try { now = projectHash(this.app.collect()); } catch { return; }
    const edited = now !== this.space.hash;
    this.stale.hidden = !edited;
    this.stale.textContent = edited ? 'The project was edited (or another project loaded) since the space was computed: the results below are of the earlier version. Compute space again to update them.' : '';
  }

  renderAll() { this.renderSummary(); this.renderInspect(); this.renderBounds(); this.renderRun(); }

  needs(box, text) { box.textContent = ''; box.append(h('p', { class: 'note lab-disabled' }, text)); }

  renderSummary() {
    const B = this.summaryBox;
    if (!this.space) return this.needs(B, 'Compute the space first: the step inspector, the bounds and the comparison read it.');
    const S = this.space.summary;
    B.textContent = '';
    const sound = S.loopSound === true ? 'sound on this instance (no option removes a solution; the same answer as the audit)'
      : S.loopSound === false ? `unsound on this instance: ${fmt(S.unsoundOptions)} options remove a solution, ${fmt(S.atRisk)} solutions at risk` : `not checked: ${S.loopSound}`;
    const tbl = h('table', { class: 'lab-table', id: 'lab-summary-table' },
      h('tbody', {},
        ...[['Link', S.link + (S.instance ? `, instance ${S.instance}` : '') + (S.variant ? `, variant ${S.variant}` : '')],
          ['Candidates', fmt(S.candidates)], ['Solutions', fmt(S.solutions)], ['Bad candidates', `${fmt(S.bad)} (${S.candidates ? ((100 * S.bad) / S.candidates).toFixed(1) : 0}%)`],
          ['Interface atoms', fmt(S.atoms)], ['Counterexamples', fmt(S.counterexamples)],
          ['Options per scheme', `loop ${fmt(S.options.loop)} · block ${fmt(S.options.block)} · omniscient: computed with the bounds`],
          ['Loop scheme', sound]].map(([a, b]) => h('tr', {}, h('th', { scope: 'row' }, a), h('td', {}, b)))));
    B.append(h('div', { class: 'lab-scroll' }, tbl));
    if (S.witness) {
      const w = S.witness;
      B.append(h('p', { class: 'note' }, `Witness (fewest differing atoms, as the audit): candidate {${w.candidateAtoms.join(' ')}} with relevant {${w.relevant.join(' ')}} removes solution {${w.solutionAtoms.join(' ')}}; they differ on {${w.differ.join(' ')}}. `,
        h('button', { class: 'control-button small-button', type: 'button', id: 'lab-witness', onclick: () => this.inspectCandidate(w.candidate) }, 'Inspect this candidate')));
    }
    B.append(h('p', { class: 'lab-exports' }, h('button', { class: 'control-button small-button lab-needs-idle', type: 'button', id: 'lab-export-json', onclick: () => this.exportJSON() }, 'Export space and results (JSON)')));
  }

  async exportJSON() {
    if (!(await this.ensure())) return;
    let r;
    try { r = await this.call('export', { key: this.space.key }, 'Exporting'); } catch (e) { this.failed(e, 'Export'); return; }
    const data = { format: 'cegarplay-lab', version: 1, params: { instance: this.space.params.instance || null, variant: this.space.params.variant || null, link: this.space.summary.link },
      summary: r.summary, space: r.space, inspected: this.inspected, results: this.results };
    download(`lab-${this.space.summary.link}${this.space.params.instance ? '-' + this.space.params.instance : ''}.json`, JSON.stringify(data), 'application/json');
    this.status.textContent = 'Exported the space and the results.';
  }

  // ---- steps of a run ---------------------------------------------------------------------
  recording() {
    if (this.source.value === 'file') return this.fileRec || null;
    if (this.source.value === 'latest') {
      const rec = this.app.recording;
      if (!rec || !rec.steps || !rec.steps.length || (rec.header && (rec.header.mode === 'audit' || rec.header.mode === 'bounded'))) return null;
      return rec;
    }
    return null;
  }

  async openFile(input, which) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    try {
      const rec = await Recording.fromBlob(f);
      if (which === 'compare') { this.compareRec = rec; this.compareName = f.name; await this.computeRun(); return; }
      this.fileRec = rec; this.fileName = f.name;
      this.source.value = 'file'; store.set('source', 'file');
      this.status.textContent = `Opened ${f.name}: ${fmt(rec.steps.length)} recorded steps.`;
      await this.loadSteps();
    } catch (e) { this.status.textContent = `Cannot open ${f.name}: ${e.message}`; }
  }

  async loadSteps() {
    this.runSteps = null;
    const rec = this.recording();
    if (this.space && rec) {
      if (!(await this.ensure())) return;
      try { this.runSteps = await this.call('steps', { key: this.space.key, recording: rec.text() }, 'Reading the recording'); this.runSteps.rec = rec; }
      catch (e) { this.failed(e, 'Reading the recording'); }
    }
    this.renderInspect();
    this.renderRun();
  }

  // ---- Feature A --------------------------------------------------------------------------
  renderInspect() {
    const B = this.inspectBox;
    if (!this.space) return this.needs(B, 'Disabled until the space is computed (Compute space, above).');
    B.textContent = '';
    const free = this.source.value === 'free' || !this.runSteps || !this.runSteps.steps.length;
    const ctl = h('div', { class: 'lab-row', id: 'lab-inspect-controls' });
    if (!free) {
      const refs = this.runSteps.steps.filter((x) => x.kind === 'refinement');
      const slider = h('input', { type: 'range', id: 'lab-step', min: 1, max: refs.length, value: Math.min(refs.length, this.stepPos || 1), 'aria-label': 'Refinement of the run' });
      const label = h('span', { class: 'note', id: 'lab-step-label' });
      const go = (k) => { this.stepPos = Math.max(1, Math.min(refs.length, k)); slider.value = this.stepPos; const st = refs[this.stepPos - 1]; label.textContent = `refinement ${this.stepPos} of ${refs.length} (recorded step ${st.i})`; };
      slider.addEventListener('input', () => go(Number(slider.value)));
      slider.addEventListener('change', () => this.inspectStep(refs[this.stepPos - 1].i));
      go(Number(slider.value));
      ctl.append(h('button', { class: 'control-button small-button lab-needs-idle', type: 'button', id: 'lab-prev', onclick: () => { go(this.stepPos - 1); this.inspectStep(refs[this.stepPos - 1].i); } }, 'Previous'),
        h('label', { class: 'inline-label' }, 'Step ', slider), label,
        h('button', { class: 'control-button small-button lab-needs-idle', type: 'button', id: 'lab-next', onclick: () => { go(this.stepPos + 1); this.inspectStep(refs[this.stepPos - 1].i); } }, 'Next'),
        h('button', { class: 'control-button small-button lab-needs-idle', type: 'button', id: 'lab-inspect-step', onclick: () => this.inspectStep(refs[this.stepPos - 1].i) }, 'Inspect'));
      if (this.runSteps.problems.length) B.append(h('p', { class: 'note' }, `The recording: ${this.runSteps.problems.join('; ')}.`));
    } else {
      const sort = h('select', { id: 'lab-sort', 'aria-label': 'Order of the candidates' },
        h('option', { value: 'atoms' }, 'by number of true atoms'), h('option', { value: 'cex' }, 'by number of counterexamples'), h('option', { value: 'random' }, 'at random'));
      sort.value = store.get('sort', 'atoms');
      const pick = h('select', { id: 'lab-candidate', 'aria-label': 'Bad candidate' });
      const fillPick = () => {
        store.set('sort', sort.value);
        const S = this.space;
        let bad = []; for (let i = 0; i < S.count; i++) if (!S.sol[i]) bad.push(i);
        if (sort.value === 'atoms') bad.sort((a, b) => S.pop[a] - S.pop[b] || a - b);
        else if (sort.value === 'cex') bad.sort((a, b) => S.ncex[b] - S.ncex[a] || a - b);
        else { let x = 12345; for (let i = bad.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) % 2147483648; const j = x % (i + 1); [bad[i], bad[j]] = [bad[j], bad[i]]; } }
        const total = bad.length;
        bad = bad.slice(0, 2000);
        pick.textContent = '';
        for (const i of bad) pick.append(h('option', { value: i }, `${S.hex[i]}: ${S.pop[i]} true, ${S.ncex[i]} counterexamples`));
        pick.title = total > 2000 ? `the first 2,000 of ${fmt(total)} bad candidates in this order` : `${fmt(total)} bad candidates`;
      };
      sort.addEventListener('change', fillPick);
      fillPick();
      if (this.inspected && !this.inspected.step) pick.value = String(this.inspected.candidate);
      ctl.append(h('label', { class: 'inline-label' }, 'Candidates ', sort), h('label', { class: 'inline-label' }, 'Bad candidate ', pick),
        h('button', { class: 'control-button small-button lab-needs-idle', type: 'button', id: 'lab-inspect-go', onclick: () => this.inspectCandidate(Number(pick.value)) }, 'Inspect'));
      B.append(h('p', { class: 'note' }, this.source.value === 'free' ? 'Free mode: any bad candidate, with every candidate alive.'
        : 'No recorded run to step through (record a run with every step: Loop tab, Recording; or open a recording): free mode.'));
    }
    B.prepend(ctl);
    this.verdict = h('p', { id: 'lab-verdict', class: 'lab-verdict', role: 'status', 'aria-live': 'polite' });
    this.inspectBody = h('div', { id: 'lab-inspect-body' });
    B.append(this.verdict, this.inspectBody);
    if (this.inspected) this.drawInspect();
  }

  async inspectStep(i) {
    const rec = this.runSteps && this.runSteps.rec;
    if (!rec || !(await this.ensure())) return;
    await this.doInspect({ step: i, recording: rec.text() });
  }
  async inspectCandidate(M) { if (await this.ensure()) await this.doInspect({ candidate: M }); }
  async doInspect(o, selected = null) {
    let r;
    try { r = await this.call('inspect', { key: this.space.key, minimalCap: this.limits.minimal, seconds: this.limits.seconds, selected, ...o }, 'Inspecting'); }
    catch (e) { this.failed(e, 'Inspect'); return; }
    this.inspected = r; this.inspectReq = o; this.detail = null;
    this.status.textContent = r.solution ? `Candidate ${r.hex} is a solution: nothing to refine.` : `Inspected candidate ${r.hex}${r.step ? ` at recorded step ${r.step}` : ''}.`;
    if (!this.verdict || !this.inspectBody || !this.inspectBox.contains(this.verdict)) this.renderInspect();
    this.drawInspect();
  }

  // every set of the inspector, as points (index = position)
  points() {
    const I = this.inspected;
    const pts = [...I.minimal.map((p) => ({ ...p, cls: 'minimal' })), ...I.options.map((p) => ({ ...p, cls: 'option' })), { ...I.block, cls: 'block' }];
    if (I.run) pts.push({ ...I.run, cls: 'run' });
    if (this.detail && this.detail.lifted && !this.detail.lifted.error) pts.push({ ...this.detail.lifted, cls: 'lifted' });
    if (this.detail) {
      const J = this.detail.justification;
      pts.forEach((p, k) => { if (J[k]) p.justified = J[k].verdict; });
    }
    return pts;
  }

  drawInspect() {
    const I = this.inspected, B = this.inspectBody;
    if (!B) return;
    B.textContent = '';
    if (I.solution) { this.verdict.textContent = `Candidate ${I.hex} is a solution: the loop accepts it.`; return; }
    this.verdict.textContent = I.verdict;
    const names = I.atomNames;
    const nm = (list) => `{${list.map((j) => names[j - 1]).join(' ')}}`;
    B.append(h('p', {}, h('b', {}, 'Candidate '), `${I.hex}: {${I.atomsTrue.join(' ')}}; ${fmt(I.ncex)} counterexamples; ${fmt(I.aliveCount)} candidates alive${I.step ? ` before recorded step ${I.step}` : ''}.`));
    if (I.minimalCapped) B.append(h('p', { class: 'note' }, `Minimal sound sets: the first ${fmt(I.minimalCap)} are shown (capped; Limits). The smallest is a cardinality-minimal one, found by an optimisation.`));
    if (I.minimalBudget) B.append(h('p', { class: 'note' }, 'Minimal sound sets: not enumerated within the time budget.'));

    // 1. counterexamples (on request: one more run of the check)
    const cx = h('div', { id: 'lab-cex' });
    const runDetail = async (lift) => {
      const pts = this.points().filter((p) => p.cls !== 'lifted');
      try {
        this.detail = await this.call('detail', { key: this.space.key, candidate: I.candidate, limit: this.limits.cex, cap: 20000, lift,
          sets: pts.map((p) => ({ r: p.r, v: p.v, kind: p.kind })) }, lift ? 'Lifting a clause' : 'Checking the counterexamples');
      } catch (e) { this.failed(e, 'Counterexamples'); return; }
      this.status.textContent = `Checked ${this.detail.shown} of ${this.detail.ncex} counterexamples.`;
      this.drawInspect();
    };
    if (!this.detail) {
      cx.append(h('p', { class: 'note' }, 'The counterexamples, their clauses and whether each set is justified by one of them need one more run of the check. ',
        h('button', { class: 'control-button small-button lab-needs-idle', type: 'button', id: 'lab-detail', onclick: () => runDetail(false) }, 'List counterexamples and check justification'), ' ',
        h('button', { class: 'control-button small-button lab-needs-idle', type: 'button', id: 'lab-lift', onclick: () => runDetail(true), title: 'Lift one clause from the ground programs (certificate levels 2 and 3); this costs time' }, 'Also compute the lifted clause')));
    } else {
      const D = this.detail;
      const used = I.run ? I.run.atoms.join(',') : null;
      const rows = D.counterexamples.map((x) => h('tr', { class: used !== null && x.relevant.join(',') === used ? 'lab-used' : '' },
        h('td', {}, x.k), h('td', { class: 'lab-atoms' }, x.shown), h('td', { class: 'lab-atoms' }, nm(x.relevant)), h('td', {}, x.size), h('td', {}, fmt(x.total)),
        h('td', {}, x.sound ? 'sound' : 'unsound'), h('td', {}, used !== null && x.relevant.join(',') === used ? 'used by the run' : '')));
      cx.append(h('h4', {}, `Counterexamples (${D.shown} of ${fmt(D.ncex)})`),
        h('div', { class: 'lab-scroll' }, h('table', { class: 'lab-table', id: 'lab-cex-table' },
          h('thead', {}, h('tr', {}, ...['#', 'counterexample', 'relevant set', 'clause length', 'total removal', 'status', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))),
        this.csvButton('lab-cex-csv', 'counterexamples.csv', () => [['k', 'counterexample', 'relevant', 'length', 'removal', 'sound'], ...D.counterexamples.map((x) => [x.k, x.shown, nm(x.relevant), x.size, x.total, x.sound])]));
      if (D.lifted && D.lifted.error) cx.append(h('p', { class: 'note' }, `Lifting failed: ${D.lifted.error}`));
      else if (D.lifted) cx.append(h('p', { class: 'note' }, `Lifted clause: ${nm(D.lifted.atoms)} (${D.lifted.size} atoms, removes ${fmt(D.lifted.prune)}${D.lifted.fallback ? '; the counterexample was not certified, so lifting fell back to the block' : `; certificate level ${D.lifted.level}`}).`));
    }
    if (!this.detail) B.append(h('h4', {}, 'Counterexamples'));
    B.append(cx);

    // 2. the atom table
    const sel = I.selected;
    const tb = h('tbody', {}, I.atoms.map((a) => h('tr', { class: a.inSelected ? 'lab-in' : '' },
      h('th', { scope: 'row', class: 'lab-atoms' }, a.name), h('td', {}, a.value ? 'true' : 'false'),
      h('td', {}, a.inRun === null ? '–' : a.inRun ? 'yes' : ''),
      h('td', {}, a.forced ? h('button', { class: 'link-button', type: 'button', onclick: () => this.showWitness(a) }, 'forced') : ''),
      h('td', {}, fmt(a.inMinimal)),
      h('td', {}, a.drop ? `${a.drop.sound ? 'sound' : 'unsound'}, ${a.drop.dPrune >= 0 ? '+' : ''}${fmt(a.drop.dPrune)} removed` : ''),
      h('td', {}, a.add ? `${a.add.dPrune >= 0 ? '+' : ''}${fmt(a.add.dPrune)} removed` : ''))));
    this.witnessLine = h('p', { class: 'note', id: 'lab-witness-line', 'aria-live': 'polite' });
    B.append(h('h4', {}, `Atoms (for the ${sel.kind === 'run' ? 'run\'s clause' : 'selected set'}: ${nm(sel.atoms)}, ${sel.size} atoms, removes ${fmt(sel.prune)}${sel.sound ? '' : ', unsound'})`),
      h('div', { class: 'lab-scroll' }, h('table', { class: 'lab-table', id: 'lab-atom-table' },
        h('thead', {}, h('tr', {}, ...['atom', 'M', 'in the loop\'s clause', 'forced', 'in minimal sets', 'drop from S', 'add to S'].map((t) => h('th', { scope: 'col' }, t)))), tb)),
      this.witnessLine,
      this.csvButton('lab-atoms-csv', 'atoms.csv', () => [['atom', 'value', 'in run clause', 'forced', 'witness', 'in minimal', 'drop sound', 'drop dPrune', 'add dPrune'],
        ...I.atoms.map((a) => [a.name, a.value, a.inRun, a.forced, a.witness == null ? '' : a.witness + 1, a.inMinimal, a.drop ? a.drop.sound : '', a.drop ? a.drop.dPrune : '', a.add ? a.add.dPrune : ''])]));

    // 3. the option map
    const pts = this.points();
    const map = this.optionMap(pts, I.pareto, (p) => this.doInspect(this.inspectReq, { r: p.r, v: p.v, kind: p.kind }));
    const choose = h('select', { id: 'lab-point', 'aria-label': 'Select a set for the atom table' }, h('option', { value: '' }, 'select a set…'),
      ...pts.map((p, k) => h('option', { value: k }, `${p.cls}: ${p.size} atoms, removes ${p.prune}${p.sound ? '' : ' (unsound)'}`)));
    choose.addEventListener('change', () => { const p = pts[Number(choose.value)]; if (p) this.doInspect(this.inspectReq, { r: p.r, v: p.v, kind: p.kind }); });
    B.append(h('h4', {}, 'Option map'), h('p', { class: 'note' }, 'Clause length (x) against pruning at this step (y). The line joins the Pareto frontier of the sound sets. Hover for the atoms; click (or choose below) to fill the atom table.'),
      h('div', { class: 'lab-chart' }, map), this.legend([['minimal', 'minimal sound set'], ['option', 'the loop\'s option'], ['block', 'block'], ['run', 'the run\'s clause'], ['lifted', 'lifted clause'],
        ['unsound', 'unsound'], ['sound', 'sound, not justified (or not checked)'], ['justified', 'justified by a counterexample']]),
      h('p', { class: 'lab-row' }, h('label', { class: 'inline-label' }, 'Set ', choose), this.svgButton('lab-map-svg', 'option-map.svg', () => map)));

    // 4. the lattice
    B.append(h('h4', {}, 'Lattice'));
    if (I.lattice.tooLarge) B.append(h('p', { class: 'note', id: 'lab-lattice-note' }, `The lattice of ${I.lattice.atoms.length} atoms (the clause's atoms and the forced ones) is too large to draw honestly (at most 10): see the option map.`));
    else { const lat = this.hasse(I.lattice, names); B.append(h('div', { class: 'lab-chart' }, lat), this.svgButton('lab-lattice-svg', 'lattice.svg', () => lat)); }
  }

  showWitness(a) {
    const S = this.space;
    const i = a.witness;
    const atoms = [];
    const hex = S.hex[i], n = S.atoms.length;
    for (let j = 1; j <= n; j++) { const d = parseInt(hex[hex.length - 1 - ((j - 1) >> 2)] || '0', 16); if ((d >> ((j - 1) & 3)) & 1) atoms.push(S.atoms[j - 1]); }
    this.witnessLine.textContent = `${a.name} must be in the clause: solution ${i + 1} {${atoms.join(' ')}} differs from M only there.`;
  }

  legend(items) {
    return h('ul', { class: 'lab-legend', 'aria-label': 'Legend' }, items.map(([c, t]) => h('li', {}, s('svg', { width: 14, height: 14, 'aria-hidden': 'true' }, this.mark(c, 7, 7, 5)), ' ', t)));
  }
  mark(cls, x, y, r, extra = {}) {
    const c = `lab-pt lab-${cls}`;
    if (cls === 'block') return s('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, class: c, ...extra });
    if (cls === 'lifted') return s('path', { d: `M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`, class: c, ...extra });
    if (cls === 'run') return s('circle', { cx: x, cy: y, r: r + 1.5, class: c, ...extra });
    return s('circle', { cx: x, cy: y, r, class: c, ...extra });
  }

  optionMap(pts, pareto, onPick) {
    const W = 640, H = 300, L = 48, B = 36, T = 12, Rm = 16;
    const xmax = Math.max(1, ...pts.map((p) => p.size)), ymax = Math.max(1, ...pts.map((p) => p.prune));
    const X = (v) => L + (v / xmax) * (W - L - Rm), Y = (v) => H - B - (v / ymax) * (H - B - T);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lab-svg', id: 'lab-option-map', role: 'img', 'aria-label': `Option map: ${pts.length} sets by clause length and pruning` });
    svg.append(s('line', { x1: L, y1: H - B, x2: W - Rm, y2: H - B, class: 'lab-axis' }), s('line', { x1: L, y1: T, x2: L, y2: H - B, class: 'lab-axis' }),
      s('text', { x: (W + L) / 2, y: H - 6, class: 'lab-label', 'text-anchor': 'middle' }, 'clause length (atoms)'),
      s('text', { x: 12, y: (H - B) / 2, class: 'lab-label', 'text-anchor': 'middle', transform: `rotate(-90 12 ${(H - B) / 2})` }, 'pruning at this step'));
    for (const t of ticks(xmax)) svg.append(s('text', { x: X(t), y: H - B + 14, class: 'lab-tick', 'text-anchor': 'middle' }, t));
    for (const t of ticks(ymax)) svg.append(s('text', { x: L - 4, y: Y(t) + 4, class: 'lab-tick', 'text-anchor': 'end' }, fmt(t)));
    const front = pareto.map((k) => pts[k]).filter(Boolean).sort((a, b) => a.size - b.size);
    if (front.length > 1) {
      let d = '';
      front.forEach((p, k) => { d += `${k ? 'L' : 'M'}${X(p.size)} ${Y(p.prune)}`; if (k < front.length - 1) d += `L${X(front[k + 1].size)} ${Y(p.prune)}`; });
      svg.append(s('path', { d, class: 'lab-front' }));
    }
    const order = ['minimal', 'option', 'block', 'lifted', 'run'];
    pts.map((p, k) => [p, k]).sort((a, b) => order.indexOf(a[0].cls) - order.indexOf(b[0].cls)).forEach(([p]) => {
      const status = !p.sound ? 'unsound' : p.justified === 'yes' ? 'justified' : 'sound';
      const names = this.inspected.atomNames;
      const tip = `${p.cls === 'option' ? 'loop option' : p.cls}: {${p.atoms.map((j) => names[j - 1]).join(' ')}}; ${p.size} atoms; removes ${p.prune} alive (${p.total} in all)` +
        (!p.sound ? `; unsound: loses ${p.lost} solutions (e.g. solution ${p.witness + 1})` : p.justified === 'yes' ? '; justified' : p.justified === 'no' ? '; sound, not justified by a listed counterexample' : p.justified === 'unchecked' ? '; justification not checked (too many candidates)' : '');
      const g = s('g', { class: `lab-point lab-${status}`, tabindex: '-1' }, s('title', {}, tip), this.mark(p.cls, X(p.size), Y(p.prune), 4.5));
      g.addEventListener('click', () => onPick(p));
      svg.append(g);
    });
    return svg;
  }

  hasse(lat, names) {
    const k = lat.atoms.length, W = 640, H = 70 * (k + 1) + 20;
    const byLevel = Array.from({ length: k + 1 }, () => []);
    for (const nd of lat.nodes) byLevel[nd.size].push(nd);
    const pos = new Map();
    byLevel.forEach((lv, L) => lv.forEach((nd, i) => pos.set(nd.mask, [((i + 1) * W) / (lv.length + 1), H - 30 - L * 70])));
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lab-svg', id: 'lab-lattice', role: 'img', 'aria-label': `Lattice of subsets of ${k} atoms, sound or unsound, with their pruning` });
    for (const nd of lat.nodes) for (let b = 0; b < k; b++) if (!(nd.mask & (1 << b))) {
      const [x1, y1] = pos.get(nd.mask), [x2, y2] = pos.get(nd.mask | (1 << b));
      svg.append(s('line', { x1, y1, x2, y2, class: 'lab-edge' }));
    }
    const small = lat.nodes.length > 64;
    for (const nd of lat.nodes) {
      const [x, y] = pos.get(nd.mask);
      const set = lat.atoms.filter((_, i) => nd.mask & (1 << i)).map((j) => names[j - 1]);
      svg.append(s('g', { class: nd.sound ? 'lab-sound' : 'lab-unsound' }, s('title', {}, `{${set.join(' ')}}: ${nd.sound ? 'sound' : 'unsound'}, removes ${nd.prune} alive (${nd.total} in all)`),
        s('circle', { cx: x, cy: y, r: small ? 6 : 11, class: 'lab-pt' }), small ? null : s('text', { x, y: y + 4, class: 'lab-node-label', 'text-anchor': 'middle' }, nd.prune)));
    }
    return svg;
  }

  csvButton(id, name, rows) { return h('button', { class: 'control-button small-button', type: 'button', id, onclick: () => download(name, csv(rows()), 'text/csv') }, 'CSV'); }
  svgButton(id, name, el) { return h('button', { class: 'control-button small-button', type: 'button', id, onclick: () => download(name, svgText(el()), 'image/svg+xml') }, 'SVG'); }

  // ---- Feature B --------------------------------------------------------------------------
  renderBounds() {
    const B = this.boundsBox;
    if (!this.space) return this.needs(B, 'Disabled until the space is computed.');
    B.textContent = '';
    const sel = h('select', { id: 'lab-scheme', 'aria-label': 'Scheme' }, ...Object.entries(SCHEME_TEXT).map(([v, t]) => h('option', { value: v }, t)));
    sel.value = store.get('scheme', 'loop');
    sel.addEventListener('change', () => { store.set('scheme', sel.value); this.drawBounds(sel.value); });
    B.append(h('div', { class: 'lab-row' }, h('label', { class: 'inline-label' }, 'Scheme ', sel),
      h('button', { class: 'control-button lab-needs-idle', type: 'button', id: 'lab-compute-bounds', onclick: () => this.computeBounds(sel.value) }, 'Compute bounds')),
    h('p', { class: 'note' }, 'Idealised runs: they ignore clasp\'s weak retention of clauses in Shape 1 (Loop tab, --enum-mode=record), so a real Shape 1 run can be longer than the worst idealised run.'));
    this.boundsBody = h('div', { id: 'lab-bounds-body', 'aria-live': 'polite' });
    B.append(this.boundsBody);
    this.drawBounds(sel.value);
  }

  async computeBounds(scheme) {
    if (!(await this.ensure())) return;
    const L = this.limits;
    try {
      const b = await this.call('bounds', { key: this.space.key, scheme, seconds: L.seconds, exact: L.exact, minimalCap: L.minimal }, `Exact bounds (${scheme})`);
      const m = await this.call('simulate', { key: this.space.key, scheme, runs: L.runs, seed: 1, seconds: L.seconds, minimalCap: L.minimal }, `Simulating ${fmt(L.runs)} runs (${scheme})`);
      this.results[scheme] = { bounds: b, sim: m };
      this.status.textContent = `Bounds (${scheme}): ${b.skipped ? b.skipped : `best ${b.best.text}; worst ${b.worst.text}`}.`;
    } catch (e) { this.failed(e, 'Bounds'); }
    this.drawBounds(scheme);
    this.renderRun();
  }

  drawBounds(scheme) {
    const B = this.boundsBody;
    if (!B) return;
    B.textContent = '';
    const r = this.results[scheme];
    if (!r) { B.append(h('p', { class: 'note' }, `No bounds for the ${scheme} scheme yet: press Compute bounds.`)); return; }
    const { bounds: b, sim: m } = r;
    const rows = [];
    if (b.skipped) rows.push(['Exact bounds', b.skipped]);
    else {
      rows.push(['Best (shortest run)', b.best.text + (b.best.atRisk ? `; ${fmt(b.best.atRisk)} solutions at risk` : '')]);
      rows.push(['Worst (longest run)', b.worst.text + (b.worst.atRisk ? `; ${fmt(b.worst.atRisk)} solutions at risk` : '')]);
      rows.push(['Program', `${fmt(b.options)} options, ${fmt(b.edges)} removal facts`]);
    }
    if (m.skipped) rows.push(['Simulation', m.skipped]);
    else {
      rows.push(['Simulation (random order, option at random)', `${fmt(m.random.runs)} runs: min ${m.random.min}, median ${m.random.median}, max ${m.random.max}${m.random.stopped ? ` (${m.random.stopped})` : ''}`]);
      if (m.first) rows.push(['Simulation (random order, first counterexample\'s option)', `min ${m.first.min}, median ${m.first.median}, max ${m.first.max}`]);
      rows.push(['Greedy best / worst', m.greedySkipped ? m.greedySkipped : `${m.greedyBest.length} / ${m.greedyWorst.length}`]);
      if (m.unsound) rows.push(['Lost solutions', `the scheme is unsound (${fmt(m.unsound)} options remove a solution): ${fmt(m.random.lostRuns)} of ${fmt(m.random.runs)} simulated runs lose solutions (at most ${fmt(m.random.lostMax)} in one run); greedy best loses ${m.greedyBest ? m.greedyBest.lost : '–'}, greedy worst ${m.greedyWorst ? m.greedyWorst.lost : '–'}. Audit the instance (Audit, next to Run) to see a witness.`]);
    }
    B.append(h('div', { class: 'lab-scroll' }, h('table', { class: 'lab-table', id: 'lab-bounds-table' }, h('tbody', {}, rows.map(([a, c]) => h('tr', {}, h('th', { scope: 'row' }, a), h('td', {}, c)))))));
    if (b.note) B.append(h('p', { class: 'note' }, b.note));
    B.append(this.csvButton('lab-bounds-csv', `bounds-${scheme}.csv`, () => [['quantity', 'value'], ...rows]));
    if (!m.skipped) {
      const marks = [];
      if (!b.skipped) { marks.push({ lo: b.best.lower, hi: b.best.upper, label: 'best', cls: 'exact' }); marks.push({ lo: b.worst.lower, hi: b.worst.upper, label: 'worst', cls: 'exact' }); }
      if (m.greedyBest) marks.push({ lo: m.greedyBest.length, hi: m.greedyBest.length, label: 'greedy best', cls: 'greedy' });
      if (m.greedyWorst) marks.push({ lo: m.greedyWorst.length, hi: m.greedyWorst.length, label: 'greedy worst', cls: 'greedy' });
      marks.push({ lo: m.random.median, hi: m.random.median, label: 'median', cls: 'median' });
      const hist = this.histogram(m.random.histogram, marks);
      B.append(h('div', { class: 'lab-chart' }, hist), h('p', { class: 'lab-row' }, this.svgButton('lab-hist-svg', `histogram-${scheme}.svg`, () => hist),
        this.csvButton('lab-hist-csv', `histogram-${scheme}.csv`, () => [['length', 'runs'], ...m.random.histogram.map((x) => [x.length, x.count])])));
    }
  }

  histogram(hist, marks) {
    const W = 640, H = 240, L = 44, B = 50, T = 16, Rm = 16;
    // the axis spans the runs and the marks' lower ends: an unproven interval (a trivial bound such
    // as |Bad|) is clipped at the edge instead of squeezing the bars
    const xs = [...hist.map((x) => x.length), ...marks.map((m) => m.lo).filter((x) => x != null)];
    const x0 = Math.min(...xs), x1 = Math.max(...xs), span = Math.max(1, x1 - x0);
    const ymax = Math.max(1, ...hist.map((x) => x.count));
    const X = (v) => L + ((v - x0 + 0.5) / (span + 1)) * (W - L - Rm), Y = (v) => H - B - (v / ymax) * (H - B - T);
    const bw = Math.max(1, (W - L - Rm) / (span + 1) - 1);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lab-svg', id: 'lab-histogram', role: 'img', 'aria-label': 'Histogram of simulated run lengths with the bounds marked' });
    svg.append(s('line', { x1: L, y1: H - B, x2: W - Rm, y2: H - B, class: 'lab-axis' }));
    for (const x of hist) svg.append(s('rect', { x: X(x.length) - bw / 2, y: Y(x.count), width: bw, height: H - B - Y(x.count), class: 'lab-hbar' }, s('title', {}, `${x.length} refinements: ${x.count} runs`)));
    for (const t of ticks(span).map((t) => t + x0).filter((t) => t <= x1)) svg.append(s('text', { x: X(t), y: H - B + 14, class: 'lab-tick', 'text-anchor': 'middle' }, t));
    // marks at the same place share one label
    const groups = new Map();
    for (const m of marks) { if (m.lo == null) continue; const k = `${m.lo}|${m.hi}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
    [...groups.values()].forEach((g, k) => {
      const m = g[0];
      const y = H - B + 26 + (k % 2) * 12;
      if (m.hi != null && m.hi !== m.lo) svg.append(s('rect', { x: X(m.lo), y: T, width: Math.max(1, X(Math.min(m.hi, x1 + 0.5)) - X(m.lo)), height: H - B - T, class: `lab-interval lab-mark-${m.cls}` }));
      svg.append(s('line', { x1: X(m.lo), y1: T, x2: X(m.lo), y2: H - B, class: `lab-mark lab-mark-${m.cls}` }),
        s('text', { x: X(m.lo), y, class: 'lab-tick', 'text-anchor': 'middle' }, `${g.map((x) => x.label).join(' = ')}${m.hi !== m.lo && m.hi != null ? ` ${m.lo}–${m.hi}` : ''}`));
    });
    svg.append(s('text', { x: (W + L) / 2, y: H - 2, class: 'lab-label', 'text-anchor': 'middle' }, 'refinements (run length)'));
    return svg;
  }

  // ---- Feature C --------------------------------------------------------------------------
  renderRun() {
    const B = this.runBox;
    if (!this.space) return this.needs(B, 'Disabled until the space is computed.');
    const rec = this.recording();
    if (!rec) return this.needs(B, 'Needs a recorded run (every step) of this instance: the latest run of the page, recorded with every step (Loop tab, Recording), or an opened recording (Steps from).');
    if (!this.results.loop || !this.results.loop.bounds) return this.needs(B, 'Needs the loop scheme\'s bounds: choose the loop scheme under Run bounds and press Compute bounds.');
    B.textContent = '';
    B.append(h('div', { class: 'lab-row' }, h('button', { class: 'control-button lab-needs-idle', type: 'button', id: 'lab-compute-run', onclick: () => this.computeRun() }, 'Place this run'),
      h('button', { class: 'control-button small-button lab-needs-idle', type: 'button', id: 'lab-compare', onclick: () => this.compareFile.click(), title: 'A second recording of the same instance (another variant or seed)' }, 'Compare with a recording'),
      this.compareFile = h('input', { type: 'file', hidden: true, id: 'lab-compare-file', accept: '.cprec,.jsonl,.txt', onchange: () => this.openFile(this.compareFile, 'compare') })),
    h('p', { class: 'note' }, 'The idealised runs ignore clasp\'s weak retention of clauses in Shape 1; a real run is compared with them as it is.'));
    this.runBody = h('div', { id: 'lab-run-body', 'aria-live': 'polite' });
    B.append(this.runBody);
    if (this.results.run) this.drawRun();
  }

  async computeRun() {
    const rec = this.recording();
    if (!rec || !(await this.ensure())) return;
    const L = this.limits;
    try {
      const run = await this.call('run', { key: this.space.key, recording: rec.text(), minimalCap: L.minimal, seconds: L.seconds }, 'Reading the run onto the space');
      let cmp = null;
      if (this.compareRec) cmp = await this.call('run', { key: this.space.key, recording: this.compareRec.text(), minimalCap: L.minimal, seconds: L.seconds }, 'Reading the second recording');
      if (!this.results.omniscient) {
        try { this.results.omniscient = await this.call('bounds', { key: this.space.key, scheme: 'omniscient', seconds: L.seconds, exact: L.exact, minimalCap: L.minimal }, 'Exact bounds (omniscient)'); }
        catch (e) { if (e.code === 'cancel') throw e; this.results.omniscient = { skipped: e.message }; }
      }
      const lad = await this.call('ladder', { key: this.space.key, run, compare: cmp, loop: this.results.loop.bounds, omni: this.results.omniscient, sim: this.results.loop.sim }, 'The ladder');
      this.results.run = { run, cmp, ...lad };
      this.status.textContent = lad.sentence || 'Placed the run.';
    } catch (e) { this.failed(e, 'This run'); }
    this.renderRun();
  }

  drawRun() {
    const B = this.runBody, R = this.results.run;
    B.textContent = '';
    const { run, cmp } = R;
    if (run.problems.length) B.append(h('p', { class: 'note' }, `The recording: ${run.problems.join('; ')}.`));
    const lad = this.ladderChart(R.rungs, R.max);
    B.append(h('h4', {}, 'The ladder'), h('div', { class: 'lab-chart' }, lad), h('p', { id: 'lab-ladder-sentence', role: 'status', 'aria-live': 'polite' }, R.sentence || ''));
    if (R.outside) B.append(h('p', { class: 'lab-stale', id: 'lab-outside' }, `This run lies outside the idealised range: ${R.outside}.`));
    B.append(h('p', { class: 'lab-row' }, this.svgButton('lab-ladder-svg', 'ladder.svg', () => lad),
      this.csvButton('lab-ladder-csv', 'ladder.csv', () => [['rung', 'low', 'high', 'exact', 'missing'], ...R.rungs.map((r) => [r.label, r.lo, r.hi, r.exact, r.missing || ''])])));
    B.append(h('h4', {}, 'Where the length comes from'), h('div', { class: 'lab-scroll' }, h('table', { class: 'lab-table', id: 'lab-decomposition' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Factor'), h('th', {}, 'Value'), h('th', {}, 'Meaning'))),
      h('tbody', {}, R.decomposition.map((d) => h('tr', {}, h('th', { scope: 'row' }, d.factor), h('td', {}, d.text), h('td', {}, d.meaning)))))),
    this.csvButton('lab-decomposition-csv', 'decomposition.csv', () => [['factor', 'value', 'meaning'], ...R.decomposition.map((d) => [d.factor, d.text, d.meaning])]));
    const chart = this.regretChart(run.rows, cmp ? cmp.rows : null);
    B.append(h('h4', {}, 'Regret per step'), h('p', { class: 'note' }, `Pruning of the run's clause, of the best option of the loop at that step, and of the best minimal sound set${run.minimalNote ? ` (${run.minimalNote})` : ''}.${run.notInOptions ? ` ${run.notInOptions} clauses of the run are not among the space's options (another relevant set than the enumeration gives, a lift, or a hand-made clause).` : ''}`),
      h('div', { class: 'lab-chart' }, chart), h('p', { class: 'lab-row' }, this.svgButton('lab-regret-svg', 'regret.svg', () => chart),
        this.csvButton('lab-regret-csv', 'regret.csv', () => [['refinement', 'step', 'candidate', 'clause length', 'pruning', 'best option', 'best minimal', 'regret', 'lost'], ...run.rows.map((r) => [r.ref, r.i, this.space.hex[r.cand], r.size, r.prune, r.bestOpt, r.bestMin, r.regret, r.lost])])));
    const top = h('ol', { id: 'lab-top-regret' }, run.top.map((r) => h('li', {}, h('button', { class: 'link-button', type: 'button', onclick: () => this.openStep(r.i) },
      `refinement ${r.ref} (recorded step ${r.i}): regret ${r.regret} (the run removed ${r.prune}, the best option ${r.bestOpt})`))));
    B.append(h('h4', {}, 'The largest regrets'), run.top.length ? top : h('p', { class: 'note' }, 'No step has regret: at every step the run used an option that pruned the most.'));
  }

  async openStep(i) {
    if (this.source.value === 'free') { this.source.value = this.fileRec ? 'file' : 'latest'; await this.loadSteps(); }
    if (this.runSteps) { const refs = this.runSteps.steps.filter((x) => x.kind === 'refinement'); this.stepPos = refs.findIndex((x) => x.i === i) + 1; this.renderInspect(); }
    await this.inspectStep(i);
    this.inspectBox.scrollIntoView({ block: 'start' });
  }

  ladderChart(rungs, max) {
    const W = 640, rowH = 22, L = 170, Rm = 20, H = rungs.length * rowH + 40;
    const X = (v) => L + (v / max) * (W - L - Rm);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lab-svg', id: 'lab-ladder', role: 'img', 'aria-label': 'Ladder: run lengths from the best to the worst on one axis' });
    rungs.forEach((r, k) => {
      const y = 14 + k * rowH;
      svg.append(s('text', { x: L - 8, y: y + 4, class: `lab-label${r.run ? ' lab-strong' : ''}`, 'text-anchor': 'end' }, r.label));
      if (r.missing) { svg.append(s('text', { x: L, y: y + 4, class: 'lab-tick' }, `– ${r.missing.length > 70 ? r.missing.slice(0, 67) + '…' : r.missing}`)); return; }
      if (r.lo !== r.hi) svg.append(s('rect', { x: X(r.lo), y: y - 5, width: Math.max(2, X(r.hi) - X(r.lo)), height: 10, class: 'lab-interval-bar' }, s('title', {}, `${r.label}: between ${r.lo} and ${r.hi} (not proven)`)));
      svg.append(s('circle', { cx: X(r.lo === r.hi ? r.lo : r.hi), cy: y, r: r.run ? 6 : 4, class: r.run ? 'lab-pt lab-run' : 'lab-pt lab-rung' }, s('title', {}, `${r.label}: ${r.lo === r.hi ? r.lo : `${r.lo}–${r.hi}`}`)),
        s('text', { x: X(r.hi) + 9, y: y + 4, class: 'lab-tick' }, r.lo === r.hi ? fmt(r.lo) : `${r.lo}–${r.hi}`));
    });
    const y = rungs.length * rowH + 14;
    svg.append(s('line', { x1: L, y1: y, x2: W - Rm, y2: y, class: 'lab-axis' }));
    for (const t of ticks(max)) svg.append(s('text', { x: X(t), y: y + 14, class: 'lab-tick', 'text-anchor': 'middle' }, fmt(t)));
    return svg;
  }

  regretChart(rows, cmpRows) {
    const W = 640, H = 260, L = 48, B = 36, T = 14, Rm = 16;
    const n = Math.max(1, rows.length, cmpRows ? cmpRows.length : 0);
    const all = [...rows.flatMap((r) => [r.prune, r.bestOpt, r.bestMin || 0]), ...(cmpRows || []).map((r) => r.prune)];
    const ymax = Math.max(1, ...all);
    const X = (i) => L + (n === 1 ? 0.5 : i / (n - 1)) * (W - L - Rm), Y = (v) => H - B - (v / ymax) * (H - B - T);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lab-svg', id: 'lab-regret', role: 'img', 'aria-label': 'Pruning per refinement: the run, the best option, the best minimal sound set' });
    svg.append(s('line', { x1: L, y1: H - B, x2: W - Rm, y2: H - B, class: 'lab-axis' }), s('line', { x1: L, y1: T, x2: L, y2: H - B, class: 'lab-axis' }));
    const line = (vals, cls) => { const pts = vals.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean); if (pts.length) svg.append(s('polyline', { points: pts.join(' '), class: `lab-line ${cls}` })); };
    if (rows.some((r) => r.bestMin != null)) line(rows.map((r) => r.bestMin), 'lab-line-min');
    line(rows.map((r) => r.bestOpt), 'lab-line-opt');
    line(rows.map((r) => r.prune), 'lab-line-run');
    if (cmpRows) line(cmpRows.map((r) => r.prune), 'lab-line-cmp');
    for (const t of ticks(n)) svg.append(s('text', { x: X(Math.max(0, t - 1)), y: H - B + 14, class: 'lab-tick', 'text-anchor': 'middle' }, t));
    for (const t of ticks(ymax)) svg.append(s('text', { x: L - 4, y: Y(t) + 4, class: 'lab-tick', 'text-anchor': 'end' }, fmt(t)));
    svg.append(s('text', { x: (W + L) / 2, y: H - 4, class: 'lab-label', 'text-anchor': 'middle' }, 'refinement of the run'));
    const leg = [['lab-line-run', 'this run'], ['lab-line-opt', 'best option of the loop'], ['lab-line-min', 'best minimal sound set'], ...(cmpRows ? [['lab-line-cmp', 'second recording']] : [])];
    leg.forEach(([c, t], k) => svg.append(s('line', { x1: L + 10 + k * 150, y1: 6, x2: L + 30 + k * 150, y2: 6, class: `lab-line ${c}` }), s('text', { x: L + 34 + k * 150, y: 10, class: 'lab-tick' }, t)));
    return svg;
  }

  destroy() { clearInterval(this.timer); this.client.cancel(); }
}

function ticks(max) {
  if (max <= 0) return [0];
  const raw = max / 5, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = Math.max(1, (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p);
  const out = [];
  for (let t = 0; t <= max + 1e-9; t += step) out.push(Math.round(t));
  return out;
}
