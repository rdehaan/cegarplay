// Instances tab (tab 9) and the instance picker of the top bar.
import { sortable, grip } from './drag-order.js';
import { makeEditor } from './editors.js';
import { IMPORTERS, importerFor, freshId, checkFacts, ImportError } from './instances.js';
import { fuzz, defaultSource } from './fuzz.js';
import { programHash, derive, auditable, INSTANCE_ID, expectedCheck, costText, runAllSummary, exerciseItems, gradeItem, exerciseSummary } from './project.js';
import { fmt } from './util.js';
import { resultCard } from './result-card.js';
import { refinementCounts } from './driver.js';
import { h as el, $ } from './dom.js';
import { GeneratorsPart } from './instances-generators.js';
import { FuzzPart } from './instances-fuzz.js';
import { SpacesPart } from './instances-spaces.js';
import { expectedText, added, constText, parseConsts, RUN_ALL_TITLE, fuzzSourceText } from './instances-common.js';

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
    // the instances' order: drag an instance by its grip (js/drag-order.js)
    sortable(this.table, {
      items: () => [...this.table.querySelectorAll('tr[data-instance]')],
      key: (tr) => tr.dataset.instance,
      onMove: (id, before) => this.moveTo(id, before),
      disabled: () => !!this.app.editors.readOnly,
    });
    this.status = el('p', { id: 'instances-status', class: 'note', role: 'status', 'aria-live': 'polite' });
    this.fileInput = el('input', { type: 'file', id: 'instance-file', hidden: true, multiple: true, onchange: () => this.importFile() });
    this.columnMap = el('input', { id: 'instance-column-map', size: 28, placeholder: 'CSV column map: edge(from,to); w(from,to,cost)',
      'aria-label': 'Column map for CSV files', title: 'For CSV files: predicates over header columns. Empty: row(I, V1, ..., Vn) per record.' });
    this.format = el('select', { id: 'instance-format', 'aria-label': 'Format of the file to import' },
      ...Object.entries(IMPORTERS).map(([k, v]) => el('option', { value: k }, v.label)));
    const auto = el('option', { value: 'auto', selected: true }, 'Format from the file name');
    this.format.prepend(auto);
    // the column map is for CSV files: hidden when another format is chosen
    const syncMap = () => { const imp = IMPORTERS[this.format.value]; this.columnMap.hidden = this.format.value !== 'auto' && !(imp && imp.columnMap); };
    this.format.addEventListener('change', syncMap);
    syncMap();
    const bar = el('div', { class: 'instances-bar' },
      el('button', { class: 'control-button', id: 'add-instance-button', onclick: () => this.add() }, 'New instance'),
      el('button', { class: 'control-button', id: 'import-instance-button', onclick: () => this.fileInput.click() }, 'Import file'),
      // the format and the CSV column map matter only for an import: folded away until wanted
      el('details', { class: 'import-options', id: 'import-options' }, el('summary', {}, 'Import options'), this.format, ' ', this.columnMap),
      this.runAllButton = el('button', { class: 'control-button', id: 'run-all-instances-button', onclick: () => this.runAll(), title: RUN_ALL_TITLE }, 'Run all instances'),
      this.checkButton = el('button', { class: 'control-button', id: 'check-exercise-button', hidden: true, onclick: () => this.checkExercise(),
        title: 'Check this exercise: expected counts and optima, the audit, and the budgets' }, 'Check exercise'),
      el('button', { class: 'control-button', id: 'fuzz-button', onclick: () => this.fuzz(), title: 'Look for a small instance on which the loop is unsound: audit instances from small to large (the instances, or the numeric constants from 1 up), shrink the first unsound one, and name the step of the run that loses a solution. The result is a card under these buttons.' }, 'Fuzz'),
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
    this.formTitle = el('h4', { id: 'instance-form-title' });
    this.form.append(
      this.formTitle,
      el('div', { class: 'instance-fields' },
        el('label', {}, 'Id ', this.idInput), el('label', {}, 'Constants ', this.constInput),
        el('label', {}, 'Expected solutions ', this.expInput), el('label', { title: 'For an optimisation loop that stops at its optimum: the cost of every solution (levels separated by spaces)' }, 'Expected optimum ', this.optInput),
        el('label', {}, 'Tags ', this.tagsInput),
        el('label', { title: 'Untick for an instance too large to enumerate: the audit and Fuzz skip it; runs still use it' }, this.auditInput, ' audit'),
        el('button', { class: 'control-button small-button', id: 'delete-instance-button', onclick: () => this.remove() }, 'Delete')),
      el('p', { class: 'note' }, 'Facts of this instance. A run gives them to every solver and every glue control, as the fragment "instance".'),
      this.recipeNote = el('p', { class: 'note', id: 'instance-recipe', hidden: true }),
      this.writeOut = el('button', { class: 'control-button small-button', id: 'instance-write-out', hidden: true, onclick: () => this.writeOutFacts(),
        title: 'Generate the facts now and keep them in this instance, as text you can read and edit' }, 'Write out its facts'),
      this.symbolicNote = el('p', { class: 'note', id: 'instance-symbolic', hidden: true }),
      editorBox);
    for (const [inp, fn] of [[this.idInput, 'rename'], [this.expInput, 'setExpected'], [this.optInput, 'setOptimum'], [this.tagsInput, 'setTags'], [this.constInput, 'setConstants']]) {
      inp.addEventListener('change', () => this[fn](inp.value));
    }
    this.exerciseBox = el('div', { id: 'exercise-box', class: 'audit-panel exercise-box', hidden: true });
    this.noneNote = el('p', { class: 'note audit-note', id: 'instance-none-note', hidden: true },
      'The top bar says (no instance): a run uses none of these instances. The solvers get the fragments alone, with the project\'s own constants (Loop tab); ',
      'no instance facts and no instance constants. Pick an instance in the top bar, or press Use in the table, to run on one.');
    // which choice of the top bar the actions of this bar use
    this.contextNote = el('p', { class: 'note', id: 'instances-context' });
    this.root.append(
      bar, this.contextNote, this.status, this.noneNote, this.exerciseBox, this.fuzzCard = el('div', { id: 'fuzz-card', class: 'audit-panel', hidden: true }), el('div', { class: 'table-wrapper' }, this.table),
      this.resultsNote = el('p', { class: 'note', id: 'instances-results-note', hidden: true }), this.form);
    this.buildGenerators();
    this.buildSpaces();
    this.editor = makeEditor(editorBox, 'ace/mode/gringo');
    this.editor.on('change', () => {
      if (this.loading) return;
      const x = this.list.find((i) => i.id === this.current);
      if (x) { x.facts = this.editor.getValue(); this.app.dirty(); }
    });
  }

  load() {
    this.results = new Map();
    this.lastRunAll = null;
    this.showExercise();
    this.gen = (this.app.project.generators || [])[0] ? this.app.project.generators[0].name : null;
    this.renderGenerators();
    this.space = (this.app.project.spaces || [])[0] ? this.app.project.spaces[0].name : null;
    this.applyAuditSetting();
    this.renderSpaces();
    this.current = this.list.length ? this.selectedId() || this.list[0].id : null;
    if (this.current === '') this.current = this.list[0].id;
    this.render();
    this.showForm();
  }

  setReadOnly(b) {
    this.editor.setReadOnly(b);
    for (const x of this.root.querySelectorAll('button, input, select')) x.disabled = b;
    this.select.disabled = b;
    if (this.runAllButton && !b) this.runAllButton.disabled = !this.list.length;
  }

  render() {
    const list = this.list;
    // the top bar picker
    const sel = this.selectedId();
    this.select.textContent = '';
    this.select.hidden = list.length === 0;
    $('instance-select-label').hidden = list.length === 0;
    if (list.length) {
      this.select.append(el('option', { value: '', title: 'Run the fragments alone, with the project\'s own constants: no instance facts, no instance constants' }, '(no instance)'));
      for (const x of list) this.select.append(el('option', { value: x.id }, x.id));
      this.select.value = sel;
    }
    this.renderContext();
    // what "(no instance)" means, said where the instances are listed
    this.noneNote.hidden = !(list.length && sel === '');
    // the table
    this.table.textContent = '';
    this.table.append(el('tr', {}, ...['Instance', 'Facts', 'Constants', 'Tags', 'Expected', 'Last count', ''].map((h) => el('th', {}, h))));
    if (!list.length) {
      this.table.append(el('tr', {}, el('td', { colspan: 7 }, 'No instances. The project runs as written; "New instance" or "Import file" adds one.')));
    }
    // which variant the counts are of, and whether the project changed since
    let staleAny = false;
    const variants = new Set();
    for (const [i, x] of list.entries()) {
      const r = this.results.get(x.id);
      const stale = this.staleResult(x.id, r);
      if (r) { variants.add(r.variant || ''); if (stale) staleAny = true; }
      const v = expectedCheck(x.expected, r);
      const bad = v.checked && !v.ok;
      const good = v.checked && v.ok;
      const nfacts = (x.facts || '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('%')).length;
      const tr = el('tr', { 'data-instance': x.id, class: [x.id === this.current ? 'selected' : '', bad ? 'mismatch' : good ? 'match' : ''].filter(Boolean).join(' '),
        ...(bad ? { 'data-mismatch': 'true' } : {}) },
        el('td', {}, grip(`Move instance ${x.id}: drag, or Arrow Up and Arrow Down`), el('a', { href: '#', onclick: (e) => { e.preventDefault(); this.show(x.id); } }, x.id), x.id === sel ? el('span', { class: 'note', title: 'The instance picked in the top bar: Run and Audit use it' }, ' (picked in the top bar)') : ''),
        el('td', {}, x.recipe && !x.facts ? 'recipe' : `${nfacts} lines`),
        el('td', {}, constText(x.constants) || '–'),
        el('td', {}, [...(x.tags || []), ...(x.audit === false ? ['no audit'] : []), ...(x.symbolic === 'unsound' ? ['symbolic audit: unsound'] : [])].join(', ') || '–'),
        el('td', { class: 'num' }, expectedText(x.expected)),
        el('td', { class: 'num' + (stale ? ' stale-result' : ''), title: r ? `${r.time}, ${r.variant ? `variant ${r.variant}` : 'no variant'}${stale ? '; the project changed since: this count may no longer hold' : ''}` : '' },
          r ? `${fmt(r.solutions)}${r.cost ? `, cost ${costText(r.cost)}${r.same ? '' : ' (differ)'}` : ''}${r.exhausted ? '' : ' (not exhausted)'}${bad ? ' ✗' : good ? ' ✓' : ''}${stale ? ' (stale)' : ''}` : '–'),
        el('td', { class: 'instance-actions' },
          el('button', { class: 'control-button small-button', onclick: () => this.pick(x.id), disabled: x.id === sel,
            title: 'Pick this instance in the top bar: Run and Audit use it' }, 'Use')));
      this.table.append(tr);
    }
    // under the table: which run the Last count column is of, and whether it still holds
    this.resultsNote.textContent = '';
    this.resultsNote.hidden = !variants.size;
    this.resultsNote.classList.toggle('stale-note', staleAny);
    // the status line above (e.g. "all match") is of the counts as they were: dimmed once one is stale
    this.status.classList.toggle('stale-status', staleAny);
    if (this.runAllButton) {
      this.runAllButton.disabled = !list.length || !!this.app.editors.readOnly;
      this.runAllButton.title = list.length ? RUN_ALL_TITLE : 'No instances in the table: New instance, Import file or a generator adds one';
    }
    if (variants.size) {
      const vs = [...variants];
      const which = vs.length > 1 ? 'different variants (hover a count to see which)' : vs[0] ? `the variant ${vs[0]}` : 'no variant';
      const ra = this.lastRunAll;
      this.resultsNote.append(ra ? `Last count: Run all instances at ${ra.time}, with ${ra.variant ? `the variant ${ra.variant}` : 'no variant'}` + (vs.length > 1 ? `; some counts are of other runs, with ${which}.` : '.')
        : `Last count: runs with ${which}.`);
      if (staleAny) this.resultsNote.append(' ', el('b', {}, 'The project changed since'), ' (fragments, loop script, constants, the instance or the variant): the counts marked (stale) may no longer hold. Run all instances again.');
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
    this.formTitle.textContent = `Editing instance ${x.id}`;
    this.auditInput.checked = x.audit !== false;
    this.idInput.value = x.id;
    this.expInput.value = x.expected && Number.isInteger(x.expected.solutions) ? String(x.expected.solutions) : '';
    this.optInput.value = x.expected && x.expected.optimum != null ? [x.expected.optimum].flat().join(' ') : '';
    this.tagsInput.value = (x.tags || []).join(', ');
    this.constInput.value = constText(x.constants);
    this.recipeNote.hidden = !x.recipe;
    this.writeOut.hidden = !(x.recipe && x.facts === undefined);
    // the stored expected verdict of the symbolic audit (library instances)
    this.symbolicNote.hidden = !x.symbolic;
    this.symbolicNote.textContent = x.symbolic ? `Expected verdict of the symbolic audit on this instance: ${x.symbolic}.` : '';
    if (x.recipe) {
      const r = x.recipe;
      this.recipeNote.textContent = x.facts === undefined
        ? `Recipe: generator ${r.generator}, ${constText(r.params) || 'default parameters'}, seed ${r.seed || 0}. Its facts are generated when a run uses it; Write out its facts keeps them here, to read and edit.`
        : `Generated by ${r.generator} (${constText(r.params) || 'default parameters'}, seed ${r.seed || 0}). The facts below are this instance's own: edit them freely; the generator is not run again.`;
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

  // Which choice of the top bar the buttons above use: Run all instances and Fuzz go over the
  // instances themselves, with the variant picked in the top bar.
  renderContext() {
    const p = this.app.project, vs = p.variants || [];
    const v = this.app.variants ? this.app.variants.selected() : '';
    this.contextNote.textContent = '';
    this.contextNote.hidden = false;
    // what Fuzz tries (the same choice as fuzz() makes)
    let fz;
    try {
      const def = defaultSource(p);
      const suite = (p.suites || []).find((s) => s.instances && (s.instances.generator || s.instances.constants));
      fz = fuzzSourceText(def.constants ? def : suite ? suite.instances : def, p, suite).replace(/ \(every numeric constant.*$/, ', from the Loop tab\'s constants');
    } catch { fz = 'instances from small to large'; }
    this.contextNote.append('Run all instances runs the instances in the table; Fuzz tries ', fz, '.',
      ...(vs.length ? [' Both use ', el('b', {}, v ? `the variant ${v}` : 'no variant'), ', as picked in the top bar\'s Variant.'] : []));
  }

  // the order of the instances (the top bar, Run all, the Campaign tab and the file follow it)
  move(id, d) {
    const list = this.list, i = list.findIndex((x) => x.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return;
    this.moveTo(id, d < 0 ? list[j].id : (list[j + 1] ? list[j + 1].id : null));
  }

  // put instance `id` before instance `before` (null: at the end); dragged by its grip
  moveTo(id, before) {
    const list = this.list, i = list.findIndex((x) => x.id === id);
    if (i < 0 || id === before || this.app.editors.readOnly) return;
    // the instance a run uses stays the same (without a pick it is the first one)
    const sel = this.selectedId();
    if (sel && this.app.project.settings.instance === undefined) this.app.project.settings = { ...this.app.project.settings, instance: sel };
    const [x] = list.splice(i, 1);
    const j = before === null ? list.length : list.findIndex((y) => y.id === before);
    list.splice(j < 0 ? list.length : j, 0, x);
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
  noteRun(id, S, D, costs, info = {}) {
    if (!id || !S || !D) return;
    this.results.set(id, { solutions: S.solutions, exhausted: D.outcome === 'finished' && D.exhausted === true, outcome: D.outcome,
      cost: costs && costs.n ? costs.cost : null, same: costs ? costs.same : true,
      variant: info.variant || null, hash: info.programHash || null, time: new Date().toLocaleTimeString(),
      facts: info.instanceFacts ?? null, recipe: JSON.stringify((this.list.find((x) => x.id === id) || {}).recipe || null) });
    this.render();
  }

  // Is a result of an earlier program? The run's program hash against the project now, with the
  // same instance and variant (a recipe instance not yet generated: not known, not marked).
  staleResult(id, r) {
    if (!r || !r.hash) return false;
    try {
      const p0 = structuredClone(this.app.collect ? this.app.collect() : this.app.project);
      // a recipe instance (facts generated at run time): the facts of that run, while its recipe is the same
      const x = (p0.instances || []).find((i) => i.id === id);
      if (x && x.facts === undefined && x.recipe) {
        if (JSON.stringify(x.recipe) !== r.recipe) return true;
        x.facts = r.facts || '';
      }
      const p = derive(p0, { instance: id, variant: r.variant || undefined });
      return programHash(p) !== r.hash;
    } catch { return false; }
  }

  // after an edit (js/init.js, 300 ms later): mark the results that no longer hold
  markStale() { if (this.results.size) this.render(); }

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
    this.lastRunAll = { variant: this.app.variants ? this.app.variants.selected() || null : null, time: new Date().toLocaleTimeString() };
    this.render();
    // the Output and Statistics tabs show the last run of the batch, not the top bar's instance
    const last = list.at(-1);
    this.say(`${s.text} The Output and Statistics tabs show the last of these runs (${last.id}).`, s.bad > 0);
  }

  // ---- self-checking exercises (FUTURE-DIRECTIONS F1) ---------------------------------------
  showExercise(graded = null, done = true) {
    const x = this.app.project.exercise;
    this.checkButton.hidden = !x;
    this.exerciseBox.hidden = !x;
    this.exerciseBox.textContent = '';
    if (!x) return;
    const items = exerciseItems(this.app.project);
    const ul = el('ul', { id: 'exercise-items', class: 'exercise-items' });
    items.forEach((it, i) => {
      const g = graded && graded[i];
      ul.append(el('li', { 'data-kind': it.kind, 'data-state': g ? (g.ok ? 'pass' : 'fail') : 'open', class: g ? (g.ok ? 'pass' : 'fail') : '' },
        `${g ? (g.ok ? '✓ ' : '✗ ') : '○ '}${it.label}${g ? ` (${g.detail})` : ''}`));
    });
    const sum = graded && done ? exerciseSummary(graded) : null;
    resultCard(this.exerciseBox, {
      verdict: sum ? (sum.pass ? 'pass' : 'fail') : 'info',
      title: 'Exercise',
      paragraphs: [x.text ? { id: 'exercise-text', text: x.text } : null],
      content: [ul, sum ? el('p', { id: 'exercise-summary', class: sum.pass ? 'note' : 'error' }, sum.text)
        : el('p', { class: 'note' }, 'Check exercise (above) runs each instance with all solutions, audits where asked, and compares the counts with the budgets.')],
    });
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
            refinements: r.S ? refinementCounts(r.S).total : undefined } : r ? { outcome: r.state } : null);
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

}

// The generators, Fuzz and spaces live in their own modules; their methods are the tab's.
for (const Part of [GeneratorsPart, FuzzPart, SpacesPart]) {
  for (const k of Object.getOwnPropertyNames(Part.prototype)) {
    if (k !== 'constructor') Object.defineProperty(InstancesTab.prototype, k, Object.getOwnPropertyDescriptor(Part.prototype, k));
  }
}
