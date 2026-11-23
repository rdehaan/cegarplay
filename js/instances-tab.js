// Instances tab (tab 9) and the instance picker of the run bar (docs/spec-instances.md).
import { makeEditor } from './editors.js';
import { IMPORTERS, importerFor, freshId, checkFacts, ImportError } from './instances.js';
import { generate, PARAM_TYPES } from './generate.js';
import { fuzz, shrinkInstance, diagnose, defaultSource } from './fuzz.js';
import { BatchStopped } from './control.js';
import { auditable, INSTANCE_ID, applyVariant, expectedCheck, costText, runAllSummary, exerciseItems, gradeItem, exerciseSummary } from './project.js';
import { fmt } from './output.js';

const $ = (id) => document.getElementById(id);
// the Expected column: "12", "optimum 8" or both
const expectedText = (e) => !e ? '–' : [Number.isInteger(e.solutions) ? fmt(e.solutions) : null, e.optimum != null ? `optimum ${costText(e.optimum)}` : null].filter(Boolean).join(', ') || '–';
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k);
  return e;
};
const constText = (c) => Object.entries(c || {}).map(([k, v]) => `${k}=${v}`).join(', ');
function parseConsts(text) {
  const out = {};
  for (const part of String(text).split(/[,\s]+/).filter(Boolean)) {
    const m = /^([a-z][A-Za-z0-9_]*)=(.+)$/.exec(part);
    if (!m) throw new Error(`"${part}" is not name=value`);
    out[m[1]] = m[2];
  }
  return out;
}

export class InstancesTab {
  constructor(app) {
    this.app = app;
    this.root = $('instances');
    this.select = $('instance-select');
    this.current = null;            // id shown in the editor
    this.results = new Map();       // id -> { solutions, exhausted, outcome }
    this.select.addEventListener('change', () => {
      this.app.project.settings = { ...this.app.project.settings, instance: this.select.value };
      this.render();
      this.app.dirty();
    });
    this.build();
  }

  get list() { return this.app.project.instances || (this.app.project.instances = []); }

  // the id a run uses now ('' = the project as written, null = none)
  selectedId() {
    const p = this.app.project, list = p.instances || [];
    if (!list.length) return null;
    const s = p.settings.instance;
    if (s === '') return '';
    if (s && list.some((x) => x.id === s)) return s;
    return list[0].id;
  }

  build() {
    this.root.textContent = '';
    this.table = el('table', { class: 'internals-table instances-table', id: 'instances-table' });
    this.status = el('p', { id: 'instances-status', class: 'note', role: 'status', 'aria-live': 'polite' });
    this.fileInput = el('input', { type: 'file', id: 'instance-file', hidden: true, multiple: true, onchange: () => this.importFile() });
    this.columnMap = el('input', { id: 'instance-column-map', size: 28, placeholder: 'CSV column map: edge(from,to); w(from,to,cost)',
      'aria-label': 'Column map for CSV files', title: 'For CSV files: predicates over header columns. Empty: row(I, V1, ..., Vn) per record.' });
    this.format = el('select', { id: 'instance-format', 'aria-label': 'Format of the file to import' },
      ...Object.entries(IMPORTERS).map(([k, v]) => el('option', { value: k }, v.label)));
    const auto = el('option', { value: 'auto', selected: true }, 'Format from the file name');
    this.format.prepend(auto);
    const bar = el('div', { class: 'instances-bar' },
      el('button', { class: 'control-button', id: 'add-instance-button', onclick: () => this.add() }, 'New instance'),
      el('button', { class: 'control-button', id: 'import-instance-button', onclick: () => this.fileInput.click() }, 'Import file'),
      this.format, this.columnMap,
      el('button', { class: 'control-button', id: 'run-all-instances-button', onclick: () => this.runAll() }, 'Run all'),
      this.checkButton = el('button', { class: 'control-button', id: 'check-exercise-button', hidden: true, onclick: () => this.checkExercise(),
        title: 'Check this exercise: expected counts and optima, the audit, and the budgets' }, 'Check exercise'),
      el('button', { class: 'control-button', id: 'fuzz-button', onclick: () => this.fuzz(), title: 'Audit instances from small to large; shrink the first unsound one and name the refinement that loses a solution' }, 'Fuzz'),
      this.fileInput);
    this.form = el('div', { class: 'instance-form', id: 'instance-form', hidden: true });
    this.idInput = el('input', { id: 'instance-id', size: 16, 'aria-label': 'Instance id' });
    this.expInput = el('input', { id: 'instance-expected', size: 8, inputmode: 'numeric', 'aria-label': 'Expected number of solutions' });
    this.optInput = el('input', { id: 'instance-optimum', size: 8, 'aria-label': 'Expected optimum (the cost of every solution; levels separated by spaces)' });
    this.tagsInput = el('input', { id: 'instance-tags', size: 20, 'aria-label': 'Tags' });
    this.constInput = el('input', { id: 'instance-constants', size: 24, 'aria-label': 'Constants' });
    this.auditInput = el('input', { type: 'checkbox', id: 'instance-audit', 'aria-label': 'Include this instance in the audit' });
    this.auditInput.addEventListener('change', () => this.setAudit(this.auditInput.checked));
    const editorBox = el('div', { class: 'instance-editor', id: 'instance-editor' });
    this.form.append(
      el('div', { class: 'instance-fields' },
        el('label', {}, 'Id ', this.idInput), el('label', {}, 'Constants ', this.constInput),
        el('label', {}, 'Expected solutions ', this.expInput), el('label', { title: 'For an optimisation loop that stops at its optimum: the cost of every solution (levels separated by spaces)' }, 'Expected optimum ', this.optInput),
        el('label', {}, 'Tags ', this.tagsInput),
        el('label', { title: 'Untick for an instance too large to enumerate: the audit and Fuzz skip it; runs still use it' }, this.auditInput, ' audit'),
        el('button', { class: 'control-button small-button', id: 'delete-instance-button', onclick: () => this.remove() }, 'Delete')),
      el('p', { class: 'note' }, 'Facts of this instance. A run gives them to every solver and every glue control, as the fragment "instance".'),
      this.recipeNote = el('p', { class: 'note', id: 'instance-recipe', hidden: true }),
      editorBox);
    for (const [inp, fn] of [[this.idInput, 'rename'], [this.expInput, 'setExpected'], [this.optInput, 'setOptimum'], [this.tagsInput, 'setTags'], [this.constInput, 'setConstants']]) {
      inp.addEventListener('change', () => this[fn](inp.value));
    }
    this.exerciseBox = el('div', { id: 'exercise-box', class: 'audit-panel exercise-box', hidden: true });
    this.root.append(
      bar, this.status, this.exerciseBox, this.fuzzCard = el('div', { id: 'fuzz-card', class: 'audit-panel', hidden: true }), el('div', { class: 'table-wrapper' }, this.table), this.form);
    this.buildGenerators();
    this.editor = makeEditor(editorBox, 'ace/mode/gringo');
    this.editor.on('change', () => {
      if (this.loading) return;
      const x = this.list.find((i) => i.id === this.current);
      if (x) { x.facts = this.editor.getValue(); this.app.dirty(); }
    });
  }

  load() {
    this.results = new Map();
    this.showExercise();
    this.gen = (this.app.project.generators || [])[0] ? this.app.project.generators[0].name : null;
    this.renderGenerators();
    this.current = this.list.length ? this.selectedId() || this.list[0].id : null;
    if (this.current === '') this.current = this.list[0].id;
    this.render();
    this.showForm();
  }

  setReadOnly(b) {
    this.editor.setReadOnly(b);
    for (const x of this.root.querySelectorAll('button, input, select')) x.disabled = b;
    this.select.disabled = b;
  }

  render() {
    const list = this.list;
    // the run bar picker
    const sel = this.selectedId();
    this.select.textContent = '';
    this.select.hidden = list.length === 0;
    $('instance-select-label').hidden = list.length === 0;
    if (list.length) {
      this.select.append(el('option', { value: '' }, '(project as written)'));
      for (const x of list) this.select.append(el('option', { value: x.id }, x.id));
      this.select.value = sel;
    }
    // the table
    this.table.textContent = '';
    this.table.append(el('tr', {}, ...['Instance', 'Facts', 'Constants', 'Tags', 'Expected', 'Last count', ''].map((h) => el('th', {}, h))));
    if (!list.length) {
      this.table.append(el('tr', {}, el('td', { colspan: 7 }, 'No instances. The project runs as written; "New instance" or "Import file" adds one.')));
    }
    for (const x of list) {
      const r = this.results.get(x.id);
      const v = expectedCheck(x.expected, r);
      const bad = v.checked && !v.ok;
      const good = v.checked && v.ok;
      const nfacts = (x.facts || '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('%')).length;
      const tr = el('tr', { 'data-instance': x.id, class: [x.id === this.current ? 'selected' : '', bad ? 'mismatch' : good ? 'match' : ''].filter(Boolean).join(' '),
        ...(bad ? { 'data-mismatch': 'true' } : {}) },
        el('td', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); this.show(x.id); } }, x.id), x.id === sel ? ' (runs)' : ''),
        el('td', {}, x.recipe && !x.facts ? 'recipe' : `${nfacts} lines`),
        el('td', {}, constText(x.constants) || '–'),
        el('td', {}, [...(x.tags || []), ...(x.audit === false ? ['no audit'] : [])].join(', ') || '–'),
        el('td', { class: 'num' }, expectedText(x.expected)),
        el('td', { class: 'num' }, r ? `${fmt(r.solutions)}${r.cost ? `, cost ${costText(r.cost)}${r.same ? '' : ' (differ)'}` : ''}${r.exhausted ? '' : ' (not exhausted)'}${bad ? ' ✗' : good ? ' ✓' : ''}` : '–'),
        el('td', {}, el('button', { class: 'control-button small-button', onclick: () => this.pick(x.id), disabled: x.id === sel }, 'Use')));
      this.table.append(tr);
    }
  }

  setAudit(on) {
    const x = this.list.find((i) => i.id === this.current);
    if (!x) return;
    if (on) delete x.audit; else x.audit = false;
    this.render();
    this.app.dirty();
  }

  // The Audit button on an instance marked audit: false audits the auditable instances instead,
  // one after the other (a batch), and sums up their verdicts.
  async auditAll() {
    const c = this.app.control;
    const list = auditable(this.app.project);
    if (!list.length) { this.say('No instance is marked for the audit (every one has audit off).', true); return; }
    const b = c.beginBatch('audit');
    if (!b) return;
    const verdicts = [];
    try {
      for (const [i, x] of list.entries()) {
        c.batchProgress(`${i + 1} of ${list.length}: ${x.id}`);
        const r = await c.run({ instance: x.id, mode: 'audit' });
        if (b.cancelled || !r || r.state === 'aborted') { this.say(`Audit stopped after ${verdicts.length} of ${list.length} instances.`); return; }
        verdicts.push({ id: x.id, v: r.audit ? r.audit.verdict : r.state });
      }
    } finally { c.endBatch(b); }
    const unsound = verdicts.filter((x) => x.v === 'unsound'), other = verdicts.filter((x) => x.v !== 'sound' && x.v !== 'unsound');
    const skipped = this.list.length - list.length;
    this.say(`Audit of ${list.length} instances (${skipped} with audit off skipped): ` +
      (unsound.length ? `unsound on ${unsound.map((x) => x.id).join(', ')}.` : other.length ? `sound where it finished; no verdict on ${other.map((x) => `${x.id} (${x.v})`).join(', ')}.` : 'sound on every one.'), unsound.length > 0);
  }

  showForm() {
    const x = this.list.find((i) => i.id === this.current);
    this.form.hidden = !x;
    if (!x) return;
    this.auditInput.checked = x.audit !== false;
    this.idInput.value = x.id;
    this.expInput.value = x.expected && Number.isInteger(x.expected.solutions) ? String(x.expected.solutions) : '';
    this.optInput.value = x.expected && x.expected.optimum != null ? [x.expected.optimum].flat().join(' ') : '';
    this.tagsInput.value = (x.tags || []).join(', ');
    this.constInput.value = constText(x.constants);
    this.recipeNote.hidden = !x.recipe;
    if (x.recipe) {
      const r = x.recipe;
      this.recipeNote.textContent = `Recipe: generator ${r.generator}, ${constText(r.params) || 'default parameters'}, seed ${r.seed || 0}. ` +
        (x.facts === undefined ? 'Its facts are generated when a run uses it.' : 'Facts written here replace the recipe\'s.');
    }
    this.loading = true;
    this.editor.setValue(x.facts || '', -1);
    this.loading = false;
    requestAnimationFrame(() => this.editor.resize());
  }

  show(id) { this.current = id; this.render(); this.showForm(); }

  pick(id) {
    this.app.project.settings = { ...this.app.project.settings, instance: id };
    this.render();
    this.app.dirty();
  }

  say(text, error = false) { this.status.textContent = text; this.status.classList.toggle('error', error); }

  add(x) {
    const id = x && x.id ? x.id : freshId(this.app.project, 'instance');
    this.list.push({ id, facts: '', constants: {}, tags: [], ...(x || {}), ...(x ? {} : {}) });
    this.current = id;
    this.render();
    this.showForm();
    this.app.dirty();
    return id;
  }

  remove() {
    const i = this.list.findIndex((x) => x.id === this.current);
    if (i < 0) return;
    const [x] = this.list.splice(i, 1);
    if (this.app.project.settings.instance === x.id) delete this.app.project.settings.instance;
    this.results.delete(x.id);
    this.current = this.list.length ? this.list[Math.max(0, i - 1)].id : null;
    this.render();
    this.showForm();
    this.app.dirty();
  }

  rename(v) {
    const x = this.list.find((i) => i.id === this.current);
    if (!x) return;
    v = v.trim();
    if (!INSTANCE_ID.test(v) || (v !== x.id && this.list.some((i) => i.id === v))) {
      this.say(`"${v}" is not a valid new id (letters, digits, _ and -; unique).`, true);
      this.idInput.value = x.id;
      return;
    }
    if (this.app.project.settings.instance === x.id) this.app.project.settings.instance = v;
    x.id = v;
    this.current = v;
    this.render();
    this.app.dirty();
  }

  setExpected(v) {
    const x = this.list.find((i) => i.id === this.current);
    if (!x) return;
    v = v.trim();
    const opt = x.expected && x.expected.optimum != null ? x.expected.optimum : null;
    if (v === '') { if (opt === null) delete x.expected; else x.expected = { solutions: null, optimum: opt }; }
    else if (/^\d+$/.test(v)) x.expected = { solutions: Number(v), ...(opt !== null ? { optimum: opt } : {}) };
    else { this.say('The expected count must be a whole number (or empty).', true); return; }
    this.render();
    this.app.dirty();
  }

  // expected.optimum: the cost of every solution of a finished run ("8", or "2 5" for two levels)
  setOptimum(v) {
    const x = this.list.find((i) => i.id === this.current);
    if (!x) return;
    v = v.trim();
    const sol = x.expected && Number.isInteger(x.expected.solutions) ? x.expected.solutions : null;
    if (v === '') {
      if (sol === null) delete x.expected; else x.expected = { solutions: sol };
    } else if (/^-?\d+(\s+-?\d+)*$/.test(v)) {
      const l = v.split(/\s+/).map(Number);
      x.expected = { solutions: sol, optimum: l.length === 1 ? l[0] : l };
    } else { this.say('The expected optimum must be whole numbers separated by spaces (or empty).', true); return; }
    this.render();
    this.app.dirty();
  }

  setTags(v) {
    const x = this.list.find((i) => i.id === this.current);
    if (!x) return;
    x.tags = v.split(/[,\s]+/).filter(Boolean);
    this.render();
    this.app.dirty();
  }

  setConstants(v) {
    const x = this.list.find((i) => i.id === this.current);
    if (!x) return;
    try { x.constants = parseConsts(v); this.say(''); } catch (e) { this.say(`Constants: ${e.message}`, true); return; }
    this.render();
    this.app.dirty();
  }

  // Import files (one or several at once) as new instances; the facts of each are checked with
  // clingo --mode=gringo first. A file that fails is reported and the others are still added.
  async importFile() {
    const files = [...(this.fileInput.files || [])];
    this.fileInput.value = '';
    if (!files.length) return;
    const added = [], failed = [];
    for (const f of files) {
      const kind = this.format.value === 'auto' ? importerFor(f.name) : this.format.value;
      const imp = IMPORTERS[kind];
      let res;
      try { res = imp.columnMap ? imp.fn(await f.text(), {}, this.columnMap.value) : imp.fn(await f.text()); }
      catch (e) { failed.push(`${f.name}: ${e instanceof ImportError ? e.message : e}`); continue; }
      if (this.app.ready && !this.app.engine.active) {
        const problems = await checkFacts(res.facts, (p, o) => this.app.engine.exec(p, o), { ...this.app.project.settings.constants, ...res.constants });
        if (problems.length) { failed.push(`${f.name}: line ${problems[0].line}: ${problems[0].message}`); continue; }
      }
      added.push(`${this.add({ id: freshId(this.app.project, f.name), facts: res.facts, constants: res.constants, tags: ['imported'] })} (${imp.label})`);
    }
    if (files.length === 1 && added.length) this.say(`Imported ${files[0].name} as instance ${added[0]}.`);
    else if (files.length === 1) this.say(failed[0], true);
    else this.say(`Imported ${added.length} of ${files.length} files${added.length ? `: ${added.map((x) => x.split(' ')[0]).join(', ')}` : ''}.${failed.length ? ` Not imported: ${failed.join('; ')}` : ''}`, failed.length > 0);
  }

  // Record a finished run of an instance (called by the control after every run).
  noteRun(id, S, D, costs) {
    if (!id || !S || !D) return;
    this.results.set(id, { solutions: S.solutions, exhausted: D.outcome === 'finished' && D.exhausted === true, outcome: D.outcome,
      cost: costs && costs.n ? costs.cost : null, same: costs ? costs.same : true });
    this.render();
  }

  async runAll() {
    const c = this.app.control;
    if (!this.list.length) return;
    const b = c.beginBatch('all instances');
    if (!b) return;
    this.say('Running every instance…');
    const rows = [];
    const list = [...this.list];
    try {
      for (const [i, x] of list.entries()) {
        c.batchProgress(`${i + 1} of ${list.length}: ${x.id}`);
        const wantsCount = !!(x.expected && Number.isInteger(x.expected.solutions));
        const r = await c.run({ instance: x.id, allSolutions: wantsCount });
        if (b.cancelled || !r || r.state === 'aborted') { this.say(`Stopped after ${rows.length} of ${list.length} instances.`); return; }
        rows.push({ expected: x.expected, result: this.results.get(x.id) });
      }
    } finally { c.endBatch(b); }
    const s = runAllSummary(rows);
    this.say(s.text, s.bad > 0);
  }

  // ---- self-checking exercises (FUTURE-DIRECTIONS F1) ---------------------------------------
  showExercise(graded = null, done = true) {
    const x = this.app.project.exercise;
    this.checkButton.hidden = !x;
    this.exerciseBox.hidden = !x;
    this.exerciseBox.textContent = '';
    if (!x) return;
    const items = exerciseItems(this.app.project);
    this.exerciseBox.append(el('h3', {}, 'Exercise'));
    if (x.text) this.exerciseBox.append(el('p', { id: 'exercise-text' }, x.text));
    const ul = el('ul', { id: 'exercise-items', class: 'exercise-items' });
    items.forEach((it, i) => {
      const g = graded && graded[i];
      ul.append(el('li', { 'data-kind': it.kind, 'data-state': g ? (g.ok ? 'pass' : 'fail') : 'open', class: g ? (g.ok ? 'pass' : 'fail') : '' },
        `${g ? (g.ok ? '✓ ' : '✗ ') : '○ '}${it.label}${g ? ` (${g.detail})` : ''}`));
    });
    this.exerciseBox.append(ul);
    if (graded && done) {
      const sum = exerciseSummary(graded);
      this.exerciseBox.append(el('p', { id: 'exercise-summary', class: sum.pass ? 'note' : 'error' }, sum.text));
    } else {
      this.exerciseBox.append(el('p', { class: 'note' }, 'Check exercise runs each instance with all solutions, audits where asked, and compares the counts with the budgets.'));
    }
  }

  async checkExercise() {
    const c = this.app.control;
    if (!this.app.project.exercise) return;
    const b = c.beginBatch('exercise check');
    if (!b) return;
    try { await this.checkExerciseItems(b); } finally { c.endBatch(b); }
  }

  async checkExerciseItems(b) {
    const c = this.app.control;
    const items = exerciseItems(this.app.project);
    const graded = [];
    const runs = new Map(), audits = new Map();
    this.say('Checking the exercise…');
    for (const [k, it] of items.entries()) {
      c.batchProgress(`${k + 1} of ${items.length}`);
      if (b.cancelled) { this.say('Stopped.'); return; }
      const inst = this.list.find((i) => i.id === it.instance);
      let res = null;
      if (it.kind === 'audit') {
        if (!audits.has(it.instance)) {
          const r = await c.run({ instance: it.instance, mode: 'audit' });
          if (r && r.state === 'aborted') { this.say('Stopped.'); return; }
          audits.set(it.instance, r && r.audit ? r.audit : r ? { outcome: r.state } : null);
        }
        res = audits.get(it.instance);
      } else {
        if (!runs.has(it.instance)) {
          const r = await c.run({ instance: it.instance, allSolutions: true });
          if (r && r.state === 'aborted') { this.say('Stopped.'); return; }
          const last = this.results.get(it.instance);
          runs.set(it.instance, r && r.D && last ? { ...last, candidates: r.S ? r.S.candidates : undefined,
            refinements: r.S ? (r.S.clauses || 0) + (r.S.expansions || 0) : undefined } : r ? { outcome: r.state } : null);
        }
        res = runs.get(it.instance);
      }
      graded.push(gradeItem(it, inst, res));
      this.showExercise(graded, false);
    }
    this.showExercise(graded);
    const sum = exerciseSummary(graded);
    this.say(`Exercise: ${sum.text}`, !sum.pass);
  }

  // ---- generators (docs/spec-instances.md section 4) ------------------------------------
  get generators() { return this.app.project.generators || (this.app.project.generators = []); }
  get generator() { return this.generators.find((g) => g.name === this.gen) || null; }

  buildGenerators() {
    this.genSelect = el('select', { id: 'generator-select', 'aria-label': 'Generator' });
    this.genSelect.addEventListener('change', () => { this.gen = this.genSelect.value; this.renderGenerators(); });
    this.genName = el('input', { id: 'generator-name', size: 14, 'aria-label': 'Generator name' });
    this.genName.addEventListener('change', () => this.renameGenerator(this.genName.value));
    this.genParams = el('table', { class: 'internals-table', id: 'generator-params' });
    this.genSeed = el('input', { id: 'generator-seed', size: 6, inputmode: 'numeric', value: '1', 'aria-label': 'First seed' });
    this.genStatus = el('p', { id: 'generator-status', class: 'note', role: 'status', 'aria-live': 'polite' });
    this.preview = el('div', { id: 'generator-preview', class: 'generator-preview' });
    const box = el('div', { class: 'instance-editor', id: 'generator-editor' });
    this.genBody = el('div', { id: 'generator-body', hidden: true },
      el('div', { class: 'instance-fields' }, el('label', {}, 'Name ', this.genName),
        el('button', { class: 'control-button small-button', id: 'delete-generator-button', onclick: () => this.removeGenerator() }, 'Delete')),
      el('p', { class: 'note' }, 'ASP whose shown atoms are the instance. Draws: @flip(P, K...), @int(Lo, Hi, K...), @weighted((W1, ..., Wm), K...), ' +
        '@perm(N, I, K...), @subset(M, N, I, K...), @mallows(N, Phi, I, K...); P and Phi in thousandths. An unsatisfiable draw is redrawn.'),
      box,
      el('div', { class: 'table-wrapper' }, this.genParams),
      el('div', { class: 'instances-bar' },
        el('button', { class: 'control-button small-button', id: 'add-param-button', onclick: () => this.addParam() }, 'Add parameter'),
        el('label', {}, 'Seed ', this.genSeed),
        el('button', { class: 'control-button', id: 'preview-button', onclick: () => this.previewSix() }, 'Preview 6')),
      this.genStatus, this.preview);
    this.root.append(el('h3', {}, 'Generators'),
      el('div', { class: 'instances-bar' }, this.genSelect,
        el('button', { class: 'control-button', id: 'add-generator-button', onclick: () => this.addGenerator() }, 'New generator')),
      this.genBody);
    this.genEditor = makeEditor(box, 'ace/mode/gringo');
    this.genEditor.on('change', () => {
      if (this.genLoading) return;
      const g = this.generator;
      if (g) { g.text = this.genEditor.getValue(); this.app.dirty(); }
    });
  }

  renderGenerators() {
    const list = this.generators, g = this.generator;
    this.genSelect.textContent = '';
    this.genSelect.hidden = !list.length;
    for (const x of list) this.genSelect.append(el('option', { value: x.name }, x.name));
    if (g) this.genSelect.value = g.name;
    this.genBody.hidden = !g;
    if (!g) return;
    this.genName.value = g.name;
    this.genLoading = true;
    if (this.genEditor.getValue() !== g.text) this.genEditor.setValue(g.text || '', -1);
    this.genLoading = false;
    this.genParams.textContent = '';
    this.genParams.append(el('tr', {}, ...['Parameter', 'Type', 'Value', ''].map((h) => el('th', {}, h))));
    for (const [k, t] of Object.entries(g.params || {})) {
      const type = el('select', { 'aria-label': `Type of ${k}` }, ...PARAM_TYPES.map((x) => el('option', { value: x, selected: x === t }, x)));
      type.addEventListener('change', () => { g.params[k] = type.value; this.app.dirty(); });
      const val = el('input', { size: 6, value: g.defaults && g.defaults[k] !== undefined ? String(g.defaults[k]) : '', 'aria-label': `Value of ${k}` });
      val.addEventListener('change', () => { g.defaults = { ...(g.defaults || {}), [k]: val.value.trim() === '' ? undefined : Number(val.value) }; this.app.dirty(); });
      this.genParams.append(el('tr', {}, el('td', {}, k), el('td', {}, type), el('td', {}, val),
        el('td', {}, el('button', { class: 'control-button small-button', onclick: () => { delete g.params[k]; if (g.defaults) delete g.defaults[k]; this.renderGenerators(); this.app.dirty(); } }, 'Remove'))));
    }
    requestAnimationFrame(() => this.genEditor.resize());
  }

  addGenerator() {
    let name = 'gen';
    for (let i = 2; this.generators.some((g) => g.name === name); i++) name = `gen${i}`;
    this.generators.push({ name, text: '% one fact per node; each edge with probability p/1000\nnode(1..n).\nedge(X,Y) :- node(X), node(Y), X < Y, @flip(p, X, Y) = 1.\n#show node/1.  #show edge/2.\n',
      params: { n: 'int', p: 'permille' }, defaults: { n: 5, p: 500 } });
    this.gen = name;
    this.renderGenerators();
    this.app.dirty();
  }

  removeGenerator() {
    const i = this.generators.findIndex((g) => g.name === this.gen);
    if (i < 0) return;
    this.generators.splice(i, 1);
    this.gen = this.generators.length ? this.generators[0].name : null;
    this.preview.textContent = '';
    this.renderGenerators();
    this.app.dirty();
  }

  renameGenerator(v) {
    const g = this.generator;
    v = v.trim();
    if (!g || v === g.name) return;
    if (!INSTANCE_ID.test(v) || this.generators.some((x) => x.name === v)) { this.genStatus.textContent = `"${v}" is not a valid new name.`; this.genName.value = g.name; return; }
    for (const x of this.list) if (x.recipe && x.recipe.generator === g.name) x.recipe.generator = v;
    g.name = v; this.gen = v;
    this.renderGenerators();
    this.app.dirty();
  }

  addParam() {
    const g = this.generator;
    if (!g) return;
    const k = (window.prompt('Parameter name (a lower case letter first):') || '').trim();
    if (!/^[a-z][A-Za-z0-9_]*$/.test(k)) return;
    g.params = { ...(g.params || {}), [k]: 'int' };
    this.renderGenerators();
    this.app.dirty();
  }

  // Six instances from seeds s..s+5, each with its attempt number and label.
  async previewSix() {
    const g = this.generator;
    if (!g || !this.app.ready || this.app.engine.active) return;
    const s0 = Math.trunc(Number(this.genSeed.value)) || 0;
    const seeds = [0, 1, 2, 3, 4, 5].map((i) => s0 + i);
    this.genStatus.textContent = 'Generating…';
    this.preview.textContent = '';
    let res;
    try { res = await generate(g, {}, seeds, this.app.genLua(), (p, o) => this.app.engine.exec(p, o)); }
    catch (e) { this.genStatus.textContent = `Not generated: ${e.message || e}`; return; }
    if (res.problems.length) {
      const p = res.problems[0];
      this.genStatus.textContent = `Not generated: ${p.line ? `line ${p.line}: ` : ''}${p.message}`;
      if (p.line) this.genEditor.getSession().setAnnotations(res.problems.filter((x) => x.line).map((x) => ({ row: x.line - 1, column: (x.col || 1) - 1, text: x.message, type: 'error' })));
      return;
    }
    this.genEditor.getSession().setAnnotations([]);
    const tried = res.results.filter((r) => !r.error).reduce((a, r) => a + r.attempt + 1, 0);
    const ok = res.results.filter((r) => !r.error).length;
    this.genStatus.textContent = ok ? `${ok} instances, ${ok} accepted of ${tried} draws.` : 'No instance.';
    for (const r of res.results) {
      const card = el('div', { class: 'generator-card', 'data-seed': String(r.seed) });
      if (r.error) card.append(el('p', { class: 'error' }, `Seed ${r.seed}: ${r.error}`));
      else {
        const params = Object.fromEntries(Object.keys(g.params || {}).filter((k) => g.defaults && g.defaults[k] !== undefined).map((k) => [k, g.defaults[k]]));
        card.append(
          el('p', {}, `Seed ${r.seed}, attempt ${r.attempt}, `, el('span', { class: r.exact ? 'label-exact' : 'label-completed' }, r.exact ? 'exact' : 'solver-completed')),
          el('pre', { class: 'generator-facts' }, r.facts.split(' ').join('\n')),
          el('button', { class: 'control-button small-button', onclick: () => {
            const id = freshId(this.app.project, `${g.name}-s${r.seed}`);
            this.add({ id, recipe: { generator: g.name, params, seed: r.seed }, constants: {}, tags: ['generated'] });
            delete this.list.find((x) => x.id === id).facts;
            this.showForm();
            this.say(`Added instance ${id} (recipe: ${g.name}, seed ${r.seed}).`);
          } }, 'Add as instance'));
      }
      this.preview.append(card);
    }
  }

  // ---- fuzz (docs/spec-instances.md section 6) ----------------------------------------------
  async fuzz() {
    const app = this.app;
    if (this.fuzzing) return;
    const b = app.control.beginBatch('fuzz');
    if (!b) return;
    this.fuzzing = true;
    // every engine call of Fuzz goes through the batch: Stop or Abort ends it at the next call
    const env = { engineRun: app.control.batchExec(b), runtime: app.runtime, modules: app.modules, luaTexts: app.genLua() };
    // the variant picked in the run bar (its 'reference' variant, if any, stays available)
    const project = applyVariant(structuredClone(app.collect()), app.variants ? app.variants.selected() || undefined : undefined);
    const suite = (project.suites || []).find((s) => s.instances && (s.instances.generator || s.instances.constants));
    // smallest first: a grid 1..v over the numeric constants, else a suite's grid, else the instances
    const def = defaultSource(project);
    const source = def.constants ? def : suite ? suite.instances : def;
    this.fuzzCard.hidden = true;
    try {
      this.say('Fuzz: auditing instances from small to large…');
      const r = await fuzz(project, { source, env, onProgress: (x) => this.say(`Fuzz: ${x.tried} of ${x.total} instances (${x.instance}: ${x.verdict})…`) });
      if (!r.found) { this.say(`Fuzz: no unsound instance among ${r.tried}${r.skipped ? ` (${r.skipped} skipped)` : ''}.${r.note ? ` ${r.note}.` : ''}`); return; }
      if (r.mode !== 'audit') { this.say(`Fuzz: instance ${r.found.instance.id} gives ${r.found.counts[0]} solutions against ${r.found.counts[1]} with the reference (${r.note}).`, true); return; }
      this.say(`Fuzz: ${r.found.instance.id} is unsound; shrinking…`);
      const s = await shrinkInstance(r.found.project, env, { onStep: (items, tests) => this.say(`Fuzz: shrinking, ${items.length} facts after ${tests} audits…`) });
      if (s.error || !s.verdict) { this.say(`Fuzz: ${r.found.instance.id} is unsound; shrinking failed (${s.error || 'no verdict'}).`, true); return; }
      const dg = await diagnose(s.project, s.verdict, env);
      this.showFuzz(r.found, s, dg);
      this.say(`Fuzz: ${r.found.instance.id} is unsound (after ${r.tried} instances); shrunk to ${s.facts.length} facts.`, true);
    } catch (e) {
      if (e instanceof BatchStopped || b.cancelled) this.say('Fuzz: stopped.');
      else this.say(`Fuzz stopped: ${e.message || e}`, true);
    } finally { this.fuzzing = false; app.control.endBatch(b); }
  }

  showFuzz(found, s, dg) {
    const w = s.verdict.witness || {};
    const card = this.fuzzCard;
    card.textContent = '';
    card.hidden = false;
    card.dataset.verdict = 'unsound';
    const step = dg.step ? `step ${dg.step.i} (${{ r: 'reject', a: 'add', e: 'expand' }[dg.step.k] || dg.step.k})` : dg.culprit ? `expansion ${dg.culprit}` : null;
    const consts = Object.entries(s.constants || {}).map(([k, v]) => `${k}=${v}`).join(', ');
    card.append(
      el('h3', {}, 'Fuzz: an unsound instance'),
      el('p', {}, `Found at ${found.instance.id}; shrunk from ${s.from} facts to ${s.facts.length}${consts ? ` (constants ${consts})` : ''} in ${s.tests} audits.`),
      el('pre', { id: 'fuzz-facts' }, s.facts.join('\n') || '(no facts)'),
      el('p', {}, `Lost solution {${(w.solution || []).join(' ')}}; the audit's witness: candidate {${(w.candidate || []).join(' ')}}, counterexample [${w.counterexample || ''}]` +
        (w.relevant ? `, relevant {${w.relevant.join(' ')}}` : '') + '.'),
      el('p', { id: 'fuzz-culprit' }, step ? `The loop's own run loses it at ${step}.` : 'The loop\'s own run does not lose this solution (its search order avoids the bad refinement here); the witness shows the unsound pair.'),
      el('div', { class: 'instances-bar' },
        el('button', { class: 'control-button small-button', id: 'fuzz-trace', onclick: () => this.fuzzAction('trace', s) }, 'Open in trace'),
        el('button', { class: 'control-button small-button', id: 'fuzz-witness', onclick: () => this.fuzzAction('audit', s) }, 'Show audit witness'),
        el('button', { class: 'control-button small-button', id: 'fuzz-save', onclick: () => this.fuzzAction('save', s) }, 'Save as regression instance')));
  }

  fuzzSave(s) {
    if (this.fuzzSaved && this.list.some((x) => x.id === this.fuzzSaved)) return this.fuzzSaved;
    const id = freshId(this.app.project, 'regression');
    const constants = Object.fromEntries(Object.entries(s.constants || {}).filter(([k, v]) => this.app.project.settings.constants[k] !== v));
    this.add({ id, facts: s.facts.join('\n') + '\n', constants, expected: { solutions: s.verdict.solutions }, tags: ['regression'] });
    this.fuzzSaved = id;
    return id;
  }

  async fuzzAction(what, s) {
    const id = this.fuzzSave(s);
    if (what === 'save') { this.say(`Saved instance ${id} with its true count ${s.verdict.solutions} (tag regression).`); return; }
    const tab = document.getElementById(what === 'trace' ? 'tab5' : 'tab1');
    await this.app.control.run(what === 'audit' ? { mode: 'audit', instance: id } : { instance: id });
    if (tab) { tab.checked = true; tab.dispatchEvent(new Event('change')); }
  }
}
