// Instances tab (tab 9) and the instance picker of the run bar (docs/spec-instances.md).
import { makeEditor } from './editors.js';
import { IMPORTERS, importerFor, freshId, checkFacts, ImportError } from './instances.js';
import { INSTANCE_ID } from './project.js';
import { fmt } from './output.js';

const $ = (id) => document.getElementById(id);
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
    this.fileInput = el('input', { type: 'file', id: 'instance-file', hidden: true, onchange: () => this.importFile() });
    this.format = el('select', { id: 'instance-format', 'aria-label': 'Format of the file to import' },
      ...Object.entries(IMPORTERS).map(([k, v]) => el('option', { value: k }, v.label)));
    const auto = el('option', { value: 'auto', selected: true }, 'Format from the file name');
    this.format.prepend(auto);
    const bar = el('div', { class: 'instances-bar' },
      el('button', { class: 'control-button', id: 'add-instance-button', onclick: () => this.add() }, 'New instance'),
      el('button', { class: 'control-button', id: 'import-instance-button', onclick: () => this.fileInput.click() }, 'Import file'),
      this.format,
      el('button', { class: 'control-button', id: 'run-all-instances-button', onclick: () => this.runAll() }, 'Run all'),
      this.fileInput);
    this.form = el('div', { class: 'instance-form', id: 'instance-form', hidden: true });
    this.idInput = el('input', { id: 'instance-id', size: 16, 'aria-label': 'Instance id' });
    this.expInput = el('input', { id: 'instance-expected', size: 8, inputmode: 'numeric', 'aria-label': 'Expected number of solutions' });
    this.tagsInput = el('input', { id: 'instance-tags', size: 20, 'aria-label': 'Tags' });
    this.constInput = el('input', { id: 'instance-constants', size: 24, 'aria-label': 'Constants' });
    const editorBox = el('div', { class: 'instance-editor', id: 'instance-editor' });
    this.form.append(
      el('div', { class: 'instance-fields' },
        el('label', {}, 'Id ', this.idInput), el('label', {}, 'Constants ', this.constInput),
        el('label', {}, 'Expected solutions ', this.expInput), el('label', {}, 'Tags ', this.tagsInput),
        el('button', { class: 'control-button small-button', id: 'delete-instance-button', onclick: () => this.remove() }, 'Delete')),
      el('p', { class: 'note' }, 'Facts of this instance. A run gives them to every solver and every glue control, as the fragment "instance".'),
      editorBox);
    for (const [inp, fn] of [[this.idInput, 'rename'], [this.expInput, 'setExpected'], [this.tagsInput, 'setTags'], [this.constInput, 'setConstants']]) {
      inp.addEventListener('change', () => this[fn](inp.value));
    }
    this.root.append(
      el('p', {}, 'An instance is a set of facts and constant values that a run applies on top of the project. ',
        'The run bar picks the instance a run uses. "Run all" runs each instance and compares its solution count with the expected one.'),
      bar, this.status, el('div', { class: 'table-wrapper' }, this.table), this.form);
    this.editor = makeEditor(editorBox, 'ace/mode/gringo');
    this.editor.on('change', () => {
      if (this.loading) return;
      const x = this.list.find((i) => i.id === this.current);
      if (x) { x.facts = this.editor.getValue(); this.app.dirty(); }
    });
  }

  load() {
    this.results = new Map();
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
      const want = x.expected && Number.isInteger(x.expected.solutions) ? x.expected.solutions : null;
      const bad = r && want !== null && r.exhausted && r.solutions !== want;
      const good = r && want !== null && r.exhausted && r.solutions === want;
      const nfacts = (x.facts || '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('%')).length;
      const tr = el('tr', { 'data-instance': x.id, class: [x.id === this.current ? 'selected' : '', bad ? 'mismatch' : good ? 'match' : ''].filter(Boolean).join(' '),
        ...(bad ? { 'data-mismatch': 'true' } : {}) },
        el('td', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); this.show(x.id); } }, x.id), x.id === sel ? ' (runs)' : ''),
        el('td', {}, x.recipe && !x.facts ? 'recipe' : `${nfacts} lines`),
        el('td', {}, constText(x.constants) || '–'),
        el('td', {}, (x.tags || []).join(', ') || '–'),
        el('td', { class: 'num' }, want === null ? '–' : fmt(want)),
        el('td', { class: 'num' }, r ? `${fmt(r.solutions)}${r.exhausted ? '' : ' (not exhausted)'}${bad ? ' ✗' : good ? ' ✓' : ''}` : '–'),
        el('td', {}, el('button', { class: 'control-button small-button', onclick: () => this.pick(x.id), disabled: x.id === sel }, 'Use')));
      this.table.append(tr);
    }
  }

  showForm() {
    const x = this.list.find((i) => i.id === this.current);
    this.form.hidden = !x;
    if (!x) return;
    this.idInput.value = x.id;
    this.expInput.value = x.expected && Number.isInteger(x.expected.solutions) ? String(x.expected.solutions) : '';
    this.tagsInput.value = (x.tags || []).join(', ');
    this.constInput.value = constText(x.constants);
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
    if (v === '') delete x.expected;
    else if (/^\d+$/.test(v)) x.expected = { solutions: Number(v) };
    else { this.say('The expected count must be a whole number (or empty).', true); return; }
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

  // Import a file as a new instance; the facts are checked with clingo --mode=gringo first.
  async importFile() {
    const f = this.fileInput.files[0];
    this.fileInput.value = '';
    if (!f) return;
    const kind = this.format.value === 'auto' ? importerFor(f.name) : this.format.value;
    let res;
    try { res = IMPORTERS[kind].fn(await f.text()); }
    catch (e) { this.say(`${f.name}: ${e instanceof ImportError ? e.message : e}`, true); return; }
    if (this.app.ready && !this.app.engine.active) {
      const problems = await checkFacts(res.facts, (p, o) => this.app.engine.exec(p, o), { ...this.app.project.settings.constants, ...res.constants });
      if (problems.length) { this.say(`${f.name}: line ${problems[0].line}: ${problems[0].message}`, true); return; }
    }
    const id = this.add({ id: freshId(this.app.project, f.name), facts: res.facts, constants: res.constants, tags: ['imported'] });
    this.say(`Imported ${f.name} as instance ${id} (${IMPORTERS[kind].label}).`);
  }

  // Record a finished run of an instance (called by the control after every run).
  noteRun(id, S, D) {
    if (!id || !S || !D) return;
    this.results.set(id, { solutions: S.solutions, exhausted: D.outcome === 'finished' && D.exhausted === true, outcome: D.outcome });
    this.render();
  }

  async runAll() {
    const c = this.app.control;
    if (c.busy || !this.app.ready || !this.list.length) return;
    this.say('Running every instance…');
    let bad = 0, n = 0;
    for (const x of [...this.list]) {
      const r = await c.run({ instance: x.id });
      if (!r || r.state === 'aborted') { this.say('Stopped.'); return; }
      n++;
      const res = this.results.get(x.id);
      const want = x.expected && Number.isInteger(x.expected.solutions) ? x.expected.solutions : null;
      if (res && want !== null && res.exhausted && res.solutions !== want) bad++;
    }
    this.say(bad ? `Ran ${n} instances: ${bad} with a count other than expected (marked ✗).` : `Ran ${n} instances; every expected count matches.`, bad > 0);
  }
}
