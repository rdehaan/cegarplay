// Instances tab (tab 9) and the instance picker of the run bar (docs/spec-instances.md).
import { makeEditor } from './editors.js';
import { IMPORTERS, importerFor, freshId, checkFacts, ImportError, resolveInstance } from './instances.js';
import { generate, PARAM_TYPES, generatorConstants } from './generate.js';
import { fuzz, shrinkInstance, diagnose, defaultSource, auditOf, symbolicOf } from './fuzz.js';
import { mine } from './mine.js';
import { BatchStopped, programHash } from './control.js';
import { derive, spaceBound, spaceCombos, spaceKeeps, auditable, INSTANCE_ID, applyVariant, expectedCheck, costText, runAllSummary, exerciseItems, gradeItem, exerciseSummary } from './project.js';
import { fmt, spaceAt } from './output.js';
import { spaceProblems } from './bounded.js';
import { resultCard } from './result-card.js';

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
// A card's "Add as instance" after a click: says so, and is not clicked twice
function added(card, id) {
  const b = card.querySelector('button');
  if (b) { b.textContent = `Added ✓ (${id})`; b.disabled = true; }
}

// generated facts ("a. b(1). c.") one per line
const factsText = (facts) => String(facts || '').split(/(?<=\.)\s+/).filter(Boolean).join('\n') + '\n';
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

const RUN_ALL_TITLE = 'Run every instance in the table in turn (the instance picked in the run bar does not matter), with the variant picked in the run bar';

// What Fuzz does, said at the top of its result card.
const FUZZ_WHAT = 'Fuzz looks for a small instance on which the loop is unsound. It audits instances from small to large (every refinement the loop could make; ' +
  'a solution removed means unsound), stops at the first unsound one, removes facts from it while it stays unsound, and shows the step of the loop\'s own run that loses the solution.';

// What a Fuzz source goes over, in words.
function fuzzSourceText(source, project, suite) {
  if (source.constants) {
    const parts = Object.entries(source.constants).map(([k, v]) => `${k} = ${v[0]}..${v[v.length - 1]}`);
    return `the project with ${parts.join(' and ')} (every numeric constant from 1 up to its value in the Loop tab; not the instances in the table)`;
  }
  if (source.generator) return `the instances of suite ${suite ? suite.name : '?'} (generator ${source.generator}${source.grid ? `, ${Object.entries(source.grid).map(([k, v]) => `${k} in ${JSON.stringify(v)}`).join(', ')}` : ''}, ${source.seeds || 1} seed${(source.seeds || 1) === 1 ? '' : 's'} each)`;
  const n = (project.instances || []).length;
  return `the ${n} instance${n === 1 ? '' : 's'} in the table`;
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
    // the column map is for CSV files: hidden when another format is chosen
    const syncMap = () => { const imp = IMPORTERS[this.format.value]; this.columnMap.hidden = this.format.value !== 'auto' && !(imp && imp.columnMap); };
    this.format.addEventListener('change', syncMap);
    syncMap();
    const bar = el('div', { class: 'instances-bar' },
      el('button', { class: 'control-button', id: 'add-instance-button', onclick: () => this.add() }, 'New instance'),
      el('button', { class: 'control-button', id: 'import-instance-button', onclick: () => this.fileInput.click() }, 'Import file'),
      this.format, this.columnMap,
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
      'The run bar says (no instance): a run uses none of these instances. The solvers get the fragments alone, with the project\'s own constants (Loop tab); ',
      'no instance facts and no instance constants. Pick an instance in the run bar, or press Use in the table, to run on one.');
    // which choice of the run bar the actions of this bar use
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
    // the run bar picker
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
        el('td', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); this.show(x.id); } }, x.id), x.id === sel ? el('span', { class: 'note', title: 'The instance picked in the run bar: Run and Audit use it' }, ' (picked in the run bar)') : ''),
        el('td', {}, x.recipe && !x.facts ? 'recipe' : `${nfacts} lines`),
        el('td', {}, constText(x.constants) || '–'),
        el('td', {}, [...(x.tags || []), ...(x.audit === false ? ['no audit'] : []), ...(x.symbolic === 'unsound' ? ['symbolic audit: unsound'] : [])].join(', ') || '–'),
        el('td', { class: 'num' }, expectedText(x.expected)),
        el('td', { class: 'num' + (stale ? ' stale-result' : ''), title: r ? `${r.time}, ${r.variant ? `variant ${r.variant}` : 'no variant'}${stale ? '; the project changed since: this count may no longer hold' : ''}` : '' },
          r ? `${fmt(r.solutions)}${r.cost ? `, cost ${costText(r.cost)}${r.same ? '' : ' (differ)'}` : ''}${r.exhausted ? '' : ' (not exhausted)'}${bad ? ' ✗' : good ? ' ✓' : ''}${stale ? ' (stale)' : ''}` : '–'),
        el('td', { class: 'instance-actions' },
          el('button', { class: 'control-button small-button', onclick: () => this.pick(x.id), disabled: x.id === sel,
            title: 'Pick this instance in the run bar: Run and Audit use it' }, 'Use'), ' ',
          el('button', { class: 'control-button small-button instance-up', onclick: () => this.move(x.id, -1), disabled: i === 0,
            title: 'Move up', 'aria-label': `Move instance ${x.id} up` }, '↑'),
          el('button', { class: 'control-button small-button instance-down', onclick: () => this.move(x.id, 1), disabled: i === list.length - 1,
            title: 'Move down', 'aria-label': `Move instance ${x.id} down` }, '↓')));
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

  // Which choice of the run bar the buttons above use: Run all instances and Fuzz go over the
  // instances themselves, with the variant picked in the run bar.
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
      ...(vs.length ? [' Both use ', el('b', {}, v ? `the variant ${v}` : 'no variant'), ', as picked in the run bar\'s Variant.'] : []));
  }

  // the order of the instances (the run bar, Run all, the Campaign tab and the file follow it)
  move(id, d) {
    const list = this.list, i = list.findIndex((x) => x.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= list.length || this.app.editors.readOnly) return;
    // the instance a run uses stays the same (without a pick it is the first one)
    const sel = this.selectedId();
    if (sel && this.app.project.settings.instance === undefined) this.app.project.settings = { ...this.app.project.settings, instance: sel };
    [list[i], list[j]] = [list[j], list[i]];
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
    // the Output and Statistics tabs show the last run of the batch, not the run bar's instance
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
    this.genSelect.addEventListener('change', () => { this.gen = this.genSelect.value; this.clearGenResults(); this.renderGenerators(); });
    this.genName = el('input', { id: 'generator-name', size: 14, 'aria-label': 'Generator name' });
    this.genName.addEventListener('change', () => this.renameGenerator(this.genName.value));
    this.genParams = el('table', { class: 'internals-table', id: 'generator-params' });
    this.genConsts = el('input', { id: 'generator-constants', size: 24, placeholder: 'n=n, k=3', 'aria-label': 'Constants of its instances' });
    this.genConsts.addEventListener('change', () => this.setGenConstants(this.genConsts.value));
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
      el('div', { class: 'instance-fields' }, el('label', { title: 'name=value, ...; a value that names a parameter takes its value' }, 'Constants of its instances ', this.genConsts)),
      el('p', { class: 'note' }, 'Given to every instance it makes (added to the instance\'s Constants): for example n=n passes the parameter n on as the constant n, k=3 a fixed value.'),
      el('div', { class: 'instances-bar' },
        el('button', { class: 'control-button small-button', id: 'add-param-button', onclick: () => this.addParam() }, 'Add parameter'),
        el('label', {}, 'Seed ', this.genSeed),
        el('button', { class: 'control-button', id: 'preview-button', onclick: () => this.previewSix() }, 'Preview 6'),
        el('button', { class: 'control-button', id: 'mine-button', onclick: () => this.mineHard(),
          title: 'Search 24 seeds of this generator (default parameters) for the instances with the most candidates per solution, then try removing single facts' }, 'Mine hard instances'),
        this.genClear = el('button', { class: 'control-button small-button', id: 'generator-clear-button', hidden: true, onclick: () => this.clearGenResults(),
          title: 'Remove the previewed or mined instances below (an edit of the generator removes them too)' }, 'Clear results')),
      this.genStatus, this.preview);
    this.root.append(el('h3', {}, 'Generators'),
      el('div', { class: 'instances-bar' }, this.genSelect,
        el('button', { class: 'control-button', id: 'add-generator-button', onclick: () => this.addGenerator() }, 'New generator')),
      this.genBody);
    this.genEditor = makeEditor(box, 'ace/mode/gringo');
    this.genEditor.on('change', () => {
      if (this.genLoading) return;
      const g = this.generator;
      if (g) { g.text = this.genEditor.getValue(); this.genEdited(); }
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
    this.genConsts.value = constText(g.constants);
    this.genLoading = true;
    if (this.genEditor.getValue() !== g.text) this.genEditor.setValue(g.text || '', -1);
    this.genLoading = false;
    this.genParams.textContent = '';
    this.genParams.append(el('tr', {}, ...['Parameter', 'Type', 'Value', ''].map((h) => el('th', {}, h))));
    for (const [k, t] of Object.entries(g.params || {})) {
      const type = el('select', { 'aria-label': `Type of ${k}` }, ...PARAM_TYPES.map((x) => el('option', { value: x, selected: x === t }, x)));
      type.addEventListener('change', () => { g.params[k] = type.value; this.genEdited(); });
      const val = el('input', { size: 6, value: g.defaults && g.defaults[k] !== undefined ? String(g.defaults[k]) : '', 'aria-label': `Value of ${k}` });
      val.addEventListener('change', () => { g.defaults = { ...(g.defaults || {}), [k]: val.value.trim() === '' ? undefined : Number(val.value) }; this.genEdited(); });
      this.genParams.append(el('tr', {}, el('td', {}, k), el('td', {}, type), el('td', {}, val),
        el('td', {}, el('button', { class: 'control-button small-button', onclick: () => { delete g.params[k]; if (g.defaults) delete g.defaults[k]; this.renderGenerators(); this.genEdited(); } }, 'Remove'))));
    }
    requestAnimationFrame(() => this.genEditor.resize());
  }

  // The previewed or mined instances are of the generator as it was: an edit removes them.
  genEdited() { this.clearGenResults(); this.app.dirty(); }
  clearGenResults() {
    this.preview.textContent = '';
    this.genStatus.textContent = '';
    this.genEditor.getSession().setAnnotations([]);
    this.genClear.hidden = true;
  }
  showGenClear() { this.genClear.hidden = !this.preview.childElementCount; }

  addGenerator() {
    let name = 'gen';
    for (let i = 2; this.generators.some((g) => g.name === name); i++) name = `gen${i}`;
    this.generators.push({ name, text: '% one fact per node; each edge with probability p/1000\nnode(1..n).\nedge(X,Y) :- node(X), node(Y), X < Y, @flip(p, X, Y) = 1.\n#show node/1.  #show edge/2.\n',
      params: { n: 'int', p: 'permille' }, defaults: { n: 5, p: 500 } });
    this.gen = name;
    this.clearGenResults();
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

  setGenConstants(v) {
    const g = this.generator;
    if (!g) return;
    let c;
    try { c = parseConsts(v); } catch (e) { this.genStatus.textContent = `Constants: ${e.message}`; return; }
    for (const k of Object.keys(c)) if (!/^[a-z][A-Za-z0-9_]*$/.test(k)) { this.genStatus.textContent = `Constants: ${k} must start with a lower case letter.`; return; }
    if (Object.keys(c).length) g.constants = c; else delete g.constants;
    this.genStatus.textContent = '';
    this.app.dirty();
  }

  // A recipe instance becomes a fixed one: its facts generated now and kept as text, with the
  // generator's constants added to its own.
  async writeOutFacts() {
    const x = this.list.find((i) => i.id === this.current);
    if (!x || !x.recipe || !this.app.ready || this.app.engine.active) return;
    let r;
    try { r = await resolveInstance(this.app.project, x.id, (p, o) => this.app.engine.exec(p, o), this.app.genLua()); }
    catch (e) { this.say(`Not written out: ${e.message || e}`, true); return; }
    x.facts = factsText(r.facts);
    x.constants = r.constants;
    delete x.mutations;
    this.render();
    this.showForm();
    this.app.dirty();
    this.say(`Wrote out the facts of ${x.id}: they are its own now.`);
  }

  addParam() {
    const g = this.generator;
    if (!g) return;
    const k = (window.prompt('Parameter name (a lower case letter first):') || '').trim();
    if (!/^[a-z][A-Za-z0-9_]*$/.test(k)) return;
    g.params = { ...(g.params || {}), [k]: 'int' };
    this.renderGenerators();
    this.genEdited();
  }

  // Six instances from seeds s..s+5, each with its attempt number and label.
  // Mining (FUTURE-DIRECTIONS D8, js/mine.js): the hardest instances of this generator for the
  // loop as it is, by candidates per solution; each can be added as a recipe instance.
  async mineHard() {
    const g = this.generator;
    if (!g) return;
    const c = this.app.control;
    const b = c.beginBatch('mining');
    if (!b) return;
    const app = this.app;
    const env = { engineRun: c.batchExec(b), runtime: app.runtime, modules: app.modules, luaTexts: app.genLua() };
    this.preview.textContent = '';
    this.genStatus.textContent = 'Mining…';
    let r;
    try {
      r = await mine(structuredClone(app.collect()), { source: { generator: g.name, grid: {}, seeds: 24 }, objective: 'candidates-per-solution',
        budget: 48, keep: 5, seconds: 1, rounds: 2, mutations: 6, env,
        onProgress: (x) => { c.batchProgress(`${x.runs} runs`); this.genStatus.textContent = `Mining: stage ${x.stage}, ${x.runs} runs (${x.instance})…`; } });
    } catch (e) {
      this.genStatus.textContent = e instanceof BatchStopped || b.cancelled ? 'Mining stopped.' : `Mining failed: ${e.message || e}`;
      return;
    } finally { c.endBatch(b); }
    this.genStatus.textContent = `Mined ${r.runs} runs: the ${r.best.length} hardest instances, by candidates per solution.`;
    for (const x of r.best) {
      const card = el('div', { class: 'generator-card mined', 'data-mined': x.id });
      card.append(el('p', {}, `${x.id}: ${x.score.toFixed(2)} candidates per solution (${x.res ? `${x.res.candidates} candidates, ${x.res.solutions} solutions, ${x.res.outcome}` : 'no run'})` +
        `${x.instance.mutations && x.instance.mutations.length ? `; ${x.instance.mutations.length} facts removed` : ''}`),
        el('button', { class: 'control-button small-button', onclick: async () => {
          const inst = { ...structuredClone(x.instance), id: freshId(this.app.project, x.id) };
          // a fixed instance: its facts (with the removals) as text, the generator's constants added
          try {
            const r = await resolveInstance({ ...this.app.project, instances: [inst] }, inst.id, (p, o) => this.app.engine.exec(p, o), this.app.genLua());
            inst.facts = factsText(r.facts);
            inst.constants = r.constants;
            delete inst.mutations;
          } catch (e) { this.genStatus.textContent = `Not added: ${e.message || e}`; return; }
          const id = this.add(inst);
          added(card, id);
          this.genStatus.textContent = `Added instance ${id} (tag hard).`;
        } }, 'Add as instance'));
      this.preview.append(card);
    }
    this.showGenClear();
  }

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
        const constants = generatorConstants(g, params);
        card.append(
          el('p', {}, `Seed ${r.seed}, attempt ${r.attempt}, `, el('span', { class: r.exact ? 'label-exact' : 'label-completed' }, r.exact ? 'exact' : 'solver-completed')),
          el('pre', { class: 'generator-facts' }, r.facts.split(' ').join('\n')),
          el('button', { class: 'control-button small-button', onclick: () => {
            const id = freshId(this.app.project, `${g.name}-s${r.seed}`);
            // a fixed instance: the facts as text (the recipe says where they came from)
            this.add({ id, facts: factsText(r.facts), recipe: { generator: g.name, params, seed: r.seed }, constants, tags: ['generated'] });
            added(card, id);
            this.say(`Added instance ${id} (generated by ${g.name}, seed ${r.seed}${constText(constants) ? `; constants ${constText(constants)}` : ''}).`);
          } }, 'Add as instance'));
      }
      this.preview.append(card);
    }
    this.showGenClear();
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
    // what Fuzz goes over, said in the card whatever comes out
    const variant = app.variants ? app.variants.selected() : '';
    this.fuzzWhat = `${fuzzSourceText(source, project, suite)}, ${variant ? `with the variant ${variant}` : 'with no variant'} (the run bar's)`;
    const seen = [];
    try {
      this.say('Fuzz: auditing instances from small to large…');
      const r = await fuzz(project, { source, env, onProgress: (x) => { seen.push(x); this.say(`Fuzz: ${x.tried} of ${x.total} instances (${x.instance}: ${x.verdict})…`); } });
      if (!r.found) { this.showFuzzNone(r, seen); this.say(`Fuzz: no unsound instance among ${r.tried}${r.skipped ? ` (${r.skipped} skipped)` : ''}; see the card below.`); return; }
      if (r.mode !== 'audit') {
        resultCard(this.fuzzCard, { verdict: 'unsound', title: 'Fuzz: an instance where the loop and the reference differ',
          paragraphs: [FUZZ_WHAT, `Tried: ${this.fuzzWhat}.`, `On ${r.found.instance.id} the loop finds ${r.found.counts[0]} solutions and the variant "reference" ${r.found.counts[1]} (${r.note}).`] });
        this.say(`Fuzz: instance ${r.found.instance.id} gives ${r.found.counts[0]} solutions against ${r.found.counts[1]} with the reference.`, true);
        return;
      }
      this.say(`Fuzz: ${r.found.instance.id} is unsound; shrinking…`);
      // an instance that only the symbolic audit could judge is shrunk with it too
      const judge = r.found.verdict && r.found.verdict.mode === 'symbolic' ? symbolicOf : auditOf;
      const s = await shrinkInstance(r.found.project, env, { judge, onStep: (items, tests) => this.say(`Fuzz: shrinking, ${items.length} facts after ${tests} audits…`) });
      if (s.error || !s.verdict) { this.say(`Fuzz: ${r.found.instance.id} is unsound; shrinking failed (${s.error || 'no verdict'}).`, true); return; }
      const dg = await diagnose(s.project, s.verdict, env);
      this.showFuzz(r.found, s, dg);
      this.say('Fuzz: done; the card below says what it found.');
    } catch (e) {
      if (e instanceof BatchStopped || b.cancelled) this.say('Fuzz: stopped.');
      else this.say(`Fuzz stopped: ${e.message || e}`, true);
    } finally { this.fuzzing = false; app.control.endBatch(b); }
  }

  // Fuzz found nothing: say so in a card, with what it tried
  showFuzzNone(r, seen) {
    const count = (v) => seen.filter((x) => x.verdict === v).length;
    const sound = count('sound') + count('same');
    resultCard(this.fuzzCard, {
      verdict: r.tried ? 'sound' : 'limit',
      title: r.tried ? 'Fuzz: no unsound instance found' : 'Fuzz: nothing to try',
      paragraphs: [FUZZ_WHAT, `Tried: ${this.fuzzWhat}.`,
        r.tried ? `${r.tried} instance${r.tried === 1 ? '' : 's'}: ${sound} sound${r.skipped ? `, ${r.skipped} skipped (too large, out of budget, or an error)` : ''}. ` +
          'The loop loses no solution on any of them. This says nothing about other or larger instances: a space (below) covers every instance up to a bound.'
          : 'No instance to audit.',
        ...(r.note ? [`Note: ${r.note}.`] : [])],
      content: seen.length ? [el('p', { class: 'note', id: 'fuzz-tried' }, seen.map((x) => `${x.instance}: ${x.verdict}`).join(' · '))] : [],
    });
  }

  showFuzz(found, s, dg) {
    const w = s.verdict.witness || {};
    const step = dg.step ? `step ${dg.step.i} (${{ r: 'reject', a: 'add', e: 'expand' }[dg.step.k] || dg.step.k})` : dg.culprit ? `expansion ${dg.culprit}` : null;
    const consts = Object.entries(s.constants || {}).map(([k, v]) => `${k} = ${v}`).join(', ');
    // an instance of the constants grid is named by its values (n = 2), not by its id (n2)
    const at = found.params && Object.keys(found.params).length && !found.instance.facts
      ? Object.entries(found.params).map(([k, v]) => `${k} = ${v}`).join(', ') : found.instance.id;
    resultCard(this.fuzzCard, {
      verdict: 'unsound',
      title: 'Fuzz: an unsound instance',
      paragraphs: [FUZZ_WHAT, `Tried: ${this.fuzzWhat}.`,
        `Unsound at ${at}; ${s.from ? `shrunk from ${s.from} facts to the ${s.facts.length} below` : 'no facts to shrink'}${consts ? ` (constants ${consts})` : ''}; ${s.tests} audit${s.tests === 1 ? '' : 's'}.`],
      content: [el('pre', { id: 'fuzz-facts' }, s.facts.join('\n') || '(no facts)'),
        el('p', {}, `Lost solution {${(w.solution || []).join(' ')}}; the audit's witness: candidate {${(w.candidate || []).join(' ')}}, counterexample [${w.counterexample || ''}]` +
          (w.relevant ? `, relevant {${w.relevant.join(' ')}}` : '') + '.'),
        el('p', { id: 'fuzz-culprit' }, step ? `The loop's own run loses it at ${step}.` : 'The loop\'s own run does not lose this solution (its search order avoids the bad refinement here); the witness shows the unsound pair.')],
      actions: [
        { name: 'trace', id: 'fuzz-trace', label: 'Open in trace', title: 'Run the loop on the small instance and open the trace', onClick: () => this.fuzzAction('trace', s) },
        { name: 'audit', id: 'fuzz-witness', label: 'Show audit witness', title: 'Audit the small instance (Output tab)', onClick: () => this.fuzzAction('audit', s) },
        { name: 'save', id: 'fuzz-save', label: 'Save as regression instance', title: 'Keep the small instance, with its true count when there is one', onClick: () => this.fuzzAction('save', s) },
        ...(step ? [] : [{ name: 'sweep', id: 'fuzz-sweep', label: 'Find a run that loses it',
          title: 'Save the small instance, then run it with a randomized search for seeds 1 to 50 until a run loses a solution, and show that run in the candidate space',
          onClick: () => this.app.sweepAndShow({ instance: this.fuzzSave(s), target: Number.isInteger(s.verdict.solutions) ? s.verdict.solutions : null }) }]),
      ],
    });
  }

  // ---- spaces (PLAN3 phase S7, docs/spec-instances.md section 8, optional) ------------------
  get spaces() { return this.app.project.spaces || (this.app.project.spaces = []); }
  get spaceItem() { return this.spaces.find((x) => x.name === this.space) || null; }

  buildSpaces() {
    this.spSelect = el('select', { id: 'space-list-select', 'aria-label': 'Space' });
    this.spSelect.addEventListener('change', () => { this.space = this.spSelect.value; this.clearSpacePreview(); this.renderSpaces(); });
    this.spName = el('input', { id: 'space-name', size: 14, 'aria-label': 'Space name' });
    this.spName.addEventListener('change', () => this.renameSpace(this.spName.value));
    // not 'space-description': that id is the run bar's description of the chosen space (index.html)
    this.spDesc = el('input', { id: 'space-description-input', size: 48, 'aria-label': 'Space description' });
    this.spDesc.addEventListener('change', () => { const x = this.spaceItem; if (x) { x.description = this.spDesc.value; this.app.dirty(); } });
    this.spParams = el('table', { class: 'internals-table', id: 'space-params' });
    this.spStatus = el('p', { id: 'space-status', class: 'note', role: 'status', 'aria-live': 'polite' });
    const box = el('div', { class: 'instance-editor', id: 'space-editor' });
    // the first k (space.from): for spaces whose instances only make sense from some size on
    this.spFrom = el('input', { id: 'space-from', size: 3, inputmode: 'numeric', 'aria-label': 'First value of the bound' });
    this.spFrom.addEventListener('change', () => {
      const x = this.spaceItem;
      if (!x) return;
      const t = this.spFrom.value.trim(), n = Number(t);
      if (t === '' || n === 1) delete x.from;
      else if (Number.isInteger(n) && n >= 0) x.from = n;
      else { this.spStatus.textContent = `First value of ${spaceBound(x)}: a whole number (0 or more).`; this.spFrom.value = String(x.from ?? 1); return; }
      this.spStatus.textContent = '';
      this.renderSpaces();
      this.spaceEdited();
    });
    this.spK = el('input', { id: 'space-preview-k', size: 3, inputmode: 'numeric', value: '2', 'aria-label': 'Value of the bound for the preview' });
    this.spKLabel = el('span', {}, 'k');
    this.spPreview = el('div', { id: 'space-preview', class: 'generator-preview' });
    this.spBody = el('div', { id: 'space-body', hidden: true },
      el('div', { class: 'instance-fields' }, el('label', {}, 'Name ', this.spName),
        el('button', { class: 'control-button small-button', id: 'delete-space-button', onclick: () => this.removeSpace() }, 'Delete')),
      el('div', { class: 'instance-fields' }, el('label', { class: 'wide-field' }, 'Description ', this.spDesc)),
      el('p', { class: 'note' }, 'Every instance up to a bound: choice rules and constraints over the instance predicates (with the fragment "schema", if there is one). ' +
        'Audit by space (run bar) verifies the loop on all of them; it does not use the run bar\'s instance.'),
      box,
      this.spHint = el('p', { class: 'note', id: 'space-empty-hint', hidden: true }),
      el('div', { class: 'table-wrapper' }, this.spParams),
      el('p', { class: 'note' }, 'Parameters are constants of every solver: one named like a constant of your encoding (#const m = 2.) sets it. ' +
        'The bound runs from its first value up to the value given in the run bar. Every other parameter has a value, or a range lo..hi: the audit checks each value of the range at each value of the bound. ' +
        '"In a regression instance": whether the constant goes into the instance saved from an unsound witness.'),
      el('div', { class: 'instances-bar' },
        el('button', { class: 'control-button small-button', id: 'add-space-param-button', onclick: () => this.addSpaceParam() }, 'Add parameter'),
        el('label', {}, this.spKLabel, ' = ', this.spK),
        el('button', { class: 'control-button small-button', id: 'preview-space-button', onclick: () => this.previewSpace(),
          title: 'The first instances of the space at this value of the bound (up to 6), as facts' }, 'Preview'),
        this.spClear = el('button', { class: 'control-button small-button', id: 'space-preview-clear', hidden: true, onclick: () => this.clearSpacePreview(),
          title: 'Remove the previewed instances (an edit of the space removes them too)' }, 'Clear preview')),
      this.spStatus, this.spPreview);
    this.root.append(el('h3', {}, 'Spaces'),
      el('div', { class: 'instances-bar' }, this.spSelect,
        el('button', { class: 'control-button', id: 'add-space-button', onclick: () => this.addSpace() }, 'New space')),
      this.spBody);
    this.spEditor = makeEditor(box, 'ace/mode/gringo');
    this.spEditor.setOptions({ minLines: 5 });
    this.spEditor.on('change', () => {
      if (this.spLoading) return;
      const x = this.spaceItem;
      if (x) { x.text = this.spEditor.getValue(); this.spaceEdited(); this.renderSpaceHint(); }
    });
  }

  renderSpaces() {
    const list = this.spaces, x = this.spaceItem;
    this.spSelect.textContent = '';
    this.spSelect.hidden = !list.length;
    for (const y of list) this.spSelect.append(el('option', { value: y.name }, y.name));
    if (x) this.spSelect.value = x.name;
    this.renderSpaceBar();
    this.spBody.hidden = !x;
    if (!x) return;
    this.spName.value = x.name;
    this.spDesc.value = x.description || '';
    this.spLoading = true;
    if (this.spEditor.getValue() !== x.text) this.spEditor.setValue(x.text || '', -1);
    this.spLoading = false;
    const bound = spaceBound(x);
    this.renderSpaceHint();
    this.spFrom.value = String(x.from ?? 1);
    this.spKLabel.textContent = bound;
    if (this.spPreviewOf !== x.name) { this.spPreview.textContent = ''; this.spPreviewOf = x.name; this.spK.value = String(x.from ?? 2); }
    this.spParams.textContent = '';
    this.spParams.append(el('tr', {}, ...['Parameter', 'Bound', 'Values', 'In a regression instance', ''].map((h) => el('th', {}, h))));
    const names = Object.keys(x.params || {});
    for (const k of names) {
      const isBound = k === bound;
      const radio = el('input', { type: 'radio', name: 'space-bound-pick', class: 'space-bound-pick', value: k, 'aria-label': `${k} is the bound` });
      radio.checked = isBound;
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        // the new bound has no range or fixed value; the old one gets its first value as value
        if (x.ranges) { delete x.ranges[k]; if (!Object.keys(x.ranges).length) delete x.ranges; }
        if (k === names[0]) delete x.bound; else x.bound = k;
        this.renderSpaces(); this.renderSpaceBar(); this.spaceEdited();
      });
      let values;
      if (isBound) values = el('span', {}, 'from ', this.spFrom, ' up to the run bar\'s value');
      else {
        const r = x.ranges && x.ranges[k];
        const val = el('input', { size: 8, class: 'space-param-value', 'data-param': k, placeholder: '3 or 1..3',
          value: r ? `${r[0]}..${r[1]}` : x.defaults && x.defaults[k] !== undefined ? String(x.defaults[k]) : '', 'aria-label': `Value or range of ${k}` });
        val.addEventListener('change', () => this.setSpaceValue(x, k, val));
        values = val;
      }
      const keep = el('input', { type: 'checkbox', class: 'space-param-keep', 'data-param': k, 'aria-label': `${k} goes into a regression instance` });
      keep.checked = spaceKeeps(x, k);
      keep.addEventListener('change', () => {
        if (keep.checked) { if (x.regression) { delete x.regression[k]; if (!Object.keys(x.regression).length) delete x.regression; } }
        else x.regression = { ...(x.regression || {}), [k]: false };
        this.app.dirty();
      });
      this.spParams.append(el('tr', { 'data-param': k }, el('td', {}, k), el('td', {}, radio), el('td', {}, values), el('td', {}, keep),
        el('td', {}, el('button', { class: 'control-button small-button', disabled: names.length < 2, onclick: () => {
          delete x.params[k];
          for (const o of [x.defaults, x.ranges, x.regression]) if (o) delete o[k];
          if (x.bound === k) delete x.bound;
          this.renderSpaces(); this.renderSpaceBar(); this.spaceEdited(); } }, 'Remove'))));
    }
    requestAnimationFrame(() => this.spEditor.resize());
  }

  // settings.audit (optional): the run bar's audit mode, space and bound, kept with the project.
  // A project without it audits by enumeration. The space and bound are applied by renderSpaceBar
  // (called by renderSpaces right after this), once the space select has its options.
  applyAuditSetting() {
    const mode = document.getElementById('audit-mode'), bound = document.getElementById('space-bound');
    if (!mode) return;
    const a = (this.app.project.settings || {}).audit;
    const m = a && ['symbolic', 'space'].includes(a.mode) ? a.mode : 'enumerate';
    mode.value = m === 'space' && !this.spaces.length ? 'enumerate' : m;
    this.pendingAudit = a && a.mode === 'space' ? { space: a.space, bound: a.bound } : null;
    if (bound) { bound.value = ''; delete bound.dataset.space; }
  }

  // The run bar changed (mode, space or bound): keep it in settings.audit; enumeration (the
  // default) is not kept, nor are a space and bound outside the Space mode.
  storeAuditSetting() {
    const mode = document.getElementById('audit-mode');
    const st = this.app.project.settings || (this.app.project.settings = {});
    if (!mode || mode.value === 'enumerate') { delete st.audit; return; }
    const a = { mode: mode.value };
    if (mode.value === 'space') {
      const sel = document.getElementById('space-select'), k = Math.floor(Number(document.getElementById('space-bound').value));
      if (sel.value) a.space = sel.value;
      if (Number.isInteger(k) && k >= 0 && document.getElementById('space-bound').value.trim() !== '') a.bound = k;
    }
    st.audit = a;
  }

  // The run bar: the Space mode of Audit appears only for a project with spaces.
  renderSpaceBar() {
    const list = this.spaces;
    const mode = document.getElementById('audit-mode'), opt = document.getElementById('audit-mode-space');
    const sel = document.getElementById('space-select'), bound = document.getElementById('space-bound');
    if (!mode || !sel) return;
    opt.hidden = opt.disabled = !list.length;
    if (!list.length && mode.value === 'space') mode.value = 'enumerate';
    const keep = this.pendingAudit && this.pendingAudit.space !== undefined ? this.pendingAudit.space : sel.value;
    sel.textContent = '';
    for (const y of list) sel.append(el('option', { value: y.name }, y.name));
    if (list.some((y) => y.name === keep)) sel.value = keep;
    if (this.pendingAudit) {
      const p = this.pendingAudit;
      this.pendingAudit = null;
      if (Number.isInteger(p.bound) && list.some((y) => y.name === sel.value)) { bound.value = String(p.bound); bound.dataset.space = sel.value; }
    }
    const on = mode.value === 'space' && list.length > 0;
    sel.hidden = bound.hidden = !on;
    document.getElementById('space-bound-label').hidden = !on;
    const y = list.find((z) => z.name === sel.value);
    if (y && (!bound.value || bound.dataset.space !== y.name)) { bound.value = String(y.expected ? y.expected.k : Math.max(3, y.from ?? 1)); bound.dataset.space = y.name; }
    // a space that starts later than k = 1 says so in the bar
    // the bound by its own name; the run bar says that the audit does not use an instance
    const B = y ? spaceBound(y) : 'k';
    document.getElementById('space-bound-label').textContent = y && (y.from ?? 1) !== 1 ? `every instance with ${B} = ${y.from} up to` : `every instance with ${B} up to`;
    bound.setAttribute('aria-label', `Largest value of ${B} for the space audit`);
    const il = document.getElementById('instance-select-label');
    if (il) {
      il.textContent = on ? 'Instance (for Run; the space audit uses none):' : 'Instance:';
      il.title = on ? 'Audit by space checks every instance of the space; the instance picked here is used by Run only' : '';
    }
    // the space's description says what the name does not: in the options' tooltips and, greyed,
    // after the select (cut with an ellipsis; the whole text in its tooltip)
    for (const o of sel.options) {
      const z = list.find((q) => q.name === o.value);
      o.title = (z && z.description) || '';
    }
    sel.title = y && y.description ? y.description : 'Space';
    const desc = document.getElementById('space-description');
    if (desc) { desc.textContent = (y && y.description) || ''; desc.title = desc.textContent; desc.hidden = !on || !desc.textContent; }
    if (this.app.control) this.app.control.updateAuditModes();
  }

  addSpace() {
    let name = 'space';
    for (let i = 2; this.spaces.some((x) => x.name === name); i++) name = `space${i}`;
    this.spaces.push({ name, description: 'Every graph on the nodes 1..k.', text: 'node(1..k).\n{ edge(X,Y) : node(X), node(Y), X < Y }.\n', params: { k: 'int' } });
    this.space = name;
    this.renderSpaces();
    this.app.dirty();
  }

  removeSpace() {
    const i = this.spaces.findIndex((x) => x.name === this.space);
    if (i < 0) return;
    this.spaces.splice(i, 1);
    this.space = this.spaces.length ? this.spaces[0].name : null;
    this.renderSpaces();
    this.app.dirty();
  }

  renameSpace(v) {
    const x = this.spaceItem;
    v = v.trim();
    if (!x || v === x.name) return;
    if (!INSTANCE_ID.test(v) || this.spaces.some((y) => y.name === v)) { this.spStatus.textContent = `"${v}" is not a valid new name.`; this.spName.value = x.name; return; }
    x.name = v; this.space = v;
    this.renderSpaces();
    this.app.dirty();
  }

  // An empty space text is the constants family: say so under the editor (the bound by its name).
  renderSpaceHint() {
    const x = this.spaceItem;
    const empty = !!x && !(x.text || '').trim();
    this.spHint.hidden = !empty;
    if (empty) {
      const b = spaceBound(x);
      this.spHint.textContent = `The text is empty: the space is the constants family ${b} = 1, 2, …, one instance per value of ${b}, with no facts ` +
        `(the fragments read the constant ${b}). Or write choice rules over the instance's predicates, e.g. node(1..${b}). { edge(X,Y) : node(X), node(Y), X < Y }.`;
    }
  }

  // A value ("3") or a range ("1..3") of a parameter other than the bound.
  setSpaceValue(x, k, input) {
    const t = input.value.trim();
    const m = /^(-?\d+)\s*\.\.\s*(-?\d+)$/.exec(t);
    const clear = (o) => { if (x[o]) { delete x[o][k]; if (!Object.keys(x[o]).length) delete x[o]; } };
    if (t === '') { clear('defaults'); clear('ranges'); }
    else if (/^-?\d+$/.test(t)) { clear('ranges'); x.defaults = { ...(x.defaults || {}), [k]: Number(t) }; }
    else if (m && Number(m[1]) <= Number(m[2])) {
      clear('defaults');
      x.ranges = { ...(x.ranges || {}), [k]: [Number(m[1]), Number(m[2])] };
      try { spaceCombos(x); } catch (e) { clear('ranges'); this.spStatus.textContent = e.message; return; }
    } else { this.spStatus.textContent = `${k}: a whole number, or a range lo..hi (lo at most hi).`; return; }
    this.spStatus.textContent = '';
    this.spaceEdited();
  }

  // An edit of a space: its preview is of the space as it was (removed), and the space is checked
  // with clingo 500 ms after the last edit, as the fragments are.
  spaceEdited() {
    this.clearSpacePreview();
    this.app.dirty();
    clearTimeout(this.spCheckTimer);
    this.spCheckTimer = setTimeout(() => this.autoCheckSpace(), 500);
  }
  async autoCheckSpace() {
    if (!this.app.ready) return;
    // a run is going: try again a little later (one engine call at a time)
    if (this.app.engine.active) { this.spCheckTimer = setTimeout(() => this.autoCheckSpace(), 1000); return; }
    const errs = await this.checkSpace();
    if (!errs.length) this.spStatus.textContent = '';
  }
  clearSpacePreview() {
    this.spPreview.textContent = '';
    if (!this.spStatus.classList.contains('error')) this.spStatus.textContent = '';
    this.spClear.hidden = true;
  }

  addSpaceParam() {
    const x = this.spaceItem;
    if (!x) return;
    const k = (window.prompt('Parameter name (a lower case letter first):') || '').trim();
    if (!/^[a-z][A-Za-z0-9_]*$/.test(k)) return;
    x.params = { ...(x.params || {}), [k]: 'int' };
    this.renderSpaces();
    this.spaceEdited();
  }

  // The validation messages of the space at its first k (clingo in gringo mode, as for generators).
  async checkSpace() {
    const x = this.spaceItem;
    if (!x || !this.app.ready || this.app.engine.active) return [];
    const errs = await spaceProblems(this.app.collect(), x.name, (p, o) => this.app.engine.exec(p, o), x.from ?? 1);
    this.spEditor.getSession().setAnnotations(errs.filter((e) => !e.where).map((e) => ({ row: e.line - 1, column: (e.col || 1) - 1, text: e.message, type: 'error' })));
    this.spStatus.textContent = errs.length ? `${errs[0].where ? 'schema, ' : ''}line ${errs[0].line}: ${errs[0].message}` : 'No problems.';
    this.spStatus.classList.toggle('error', errs.length > 0);
    return errs;
  }

  // Preview: the first instances of the space at k (models of its text, the schema added), up to 6.
  async previewSpace() {
    const x = this.spaceItem;
    if (!x || !this.app.ready || this.app.engine.active) return;
    const k = Math.max(0, Math.floor(Number(this.spK.value)) || 0);
    this.spPreview.textContent = '';
    const errs = await this.checkSpace();
    if (errs.length) return;
    const project = this.app.collect();
    const schema = project.fragments.find((f) => f.name === 'schema');
    let first = {};
    try { first = spaceCombos(x)[0] || {}; } catch (e) { this.spStatus.textContent = e.message; return; }
    const values = { ...(x.defaults || {}), ...first, [spaceBound(x)]: k };
    const consts = Object.entries(values).filter(([, v]) => v !== undefined).map(([a, v]) => `-c ${a}=${v}`).join(' ');
    const r = await this.app.engine.exec(`${x.text || ''}\n${schema ? schema.text : ''}\n`, `--outf=2 6 ${consts}`);
    let json = null;
    try { json = JSON.parse((r.out || []).join('\n')); } catch { json = null; }
    if (!json) { this.spStatus.textContent = 'No preview: clingo gave no answer.'; return; }
    const models = ((json.Call || [])[0] || {}).Witnesses || [];
    const more = json.Models && json.Models.More === 'yes';
    const B = spaceBound(x);
    this.spStatus.textContent = !models.length ? `No instance at ${B} = ${k} (the space is empty there).`
      : `${more ? `The first ${models.length}` : models.length === 1 ? 'The one' : `All ${models.length}`} instance${models.length === 1 ? '' : 's'} at ${B} = ${k}${more ? ' (there are more)' : ''}${Object.keys(values).length > 1 ? ` (${Object.entries(values).map(([a, v]) => `${a} = ${v}`).join(', ')})` : ''}.`;
    for (const [i, m] of models.entries()) {
      const facts = (m.Value || []).slice().sort();
      this.spPreview.append(el('div', { class: 'generator-card', 'data-space-instance': String(i + 1) },
        el('p', {}, `Instance ${i + 1}`), el('pre', { class: 'generator-facts' }, facts.map((a) => `${a}.`).join('\n') || '(no facts)')));
    }
    this.spClear.hidden = !this.spPreview.childElementCount;
  }

  // "Save as regression instance" of a space audit's witness (as Fuzz saves its instance).
  saveWitness(a) {
    const w = a.witness || {};
    const sp = this.spaces.find((x) => x.name === a.space);
    // named after where it broke: regression-n2 (the bound and its value)
    const id = freshId(this.app.project, `regression-${a.bound || (sp ? spaceBound(sp) : 'k')}${a.k}`);
    const consts = { ...((sp && sp.defaults) || {}), ...(a.params || {}) };
    if (sp) consts[spaceBound(sp)] = a.k;
    // only the constants the space marks "in a regression instance", and not those the project already has
    const constants = Object.fromEntries(Object.entries(consts).filter(([k, v]) => v !== undefined && (!sp || spaceKeeps(sp, k))).map(([k, v]) => [k, String(v)])
      .filter(([k, v]) => this.app.project.settings.constants[k] !== v));
    this.add({ id, facts: (w.instance || '').split(' ').filter(Boolean).join('\n') + '\n', constants, tags: ['regression'] });
    this.say(`Saved instance ${id}: the space ${a.space} at ${spaceAt(a)} breaks the loop there (tag regression${Object.keys(constants).length ? `; constants ${constText(constants)}` : ''}).`);
    return id;
  }

  fuzzSave(s) {
    if (this.fuzzSaved && this.list.some((x) => x.id === this.fuzzSaved)) return this.fuzzSaved;
    const id = freshId(this.app.project, 'regression');
    const constants = Object.fromEntries(Object.entries(s.constants || {}).filter(([k, v]) => this.app.project.settings.constants[k] !== v));
    // the symbolic audit gives no solution count: then no expected count
    const expected = Number.isInteger(s.verdict.solutions) ? { expected: { solutions: s.verdict.solutions } } : {};
    this.add({ id, facts: s.facts.join('\n') + '\n', constants, ...expected, tags: ['regression'] });
    this.fuzzSaved = id;
    return id;
  }

  async fuzzAction(what, s) {
    const id = this.fuzzSave(s);
    if (what === 'save') { this.say(Number.isInteger(s.verdict.solutions) ? `Saved instance ${id} with its true count ${s.verdict.solutions} (tag regression).` : `Saved instance ${id} (tag regression).`); return; }
    const tab = document.getElementById(what === 'trace' ? 'tab5' : 'tab1');
    await this.app.control.run(what === 'audit' ? { mode: 'audit', instance: id } : { instance: id });
    if (tab) { tab.checked = true; tab.dispatchEvent(new Event('change')); }
  }
}
