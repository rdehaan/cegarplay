// ACE editors built from the project: one per fragment, plus the loop editor.
/* global ace */
import { FRAGMENT_NAME, DEFAULT_FRAGMENTS } from './project.js';

export function makeEditor(el, mode, { readOnly = false } = {}) {
  const ed = ace.edit(el);
  ed.setTheme('ace/theme/textmate');
  ed.$blockScrolling = Infinity;
  ed.setOptions({
    useSoftTabs: true,
    tabSize: mode === 'ace/mode/loop' ? 4 : 2,
    maxLines: Infinity,
    minLines: 3,
    mode,
    useWorker: false,
    autoScrollEditorIntoView: true,
    showPrintMargin: false,
  });
  ed.setReadOnly(readOnly);
  return ed;
}

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
};

export class Editors {
  constructor(app) {
    this.app = app;
    this.fragments = new Map();   // name -> { editor, block, heading }
    this.readOnly = false;
    this.loop = makeEditor(document.getElementById('loop-editor'), 'ace/mode/loop');
    this.loop.session.on('change', () => this.clearFor('loop'));
    this.container = document.getElementById('fragments');
    document.getElementById('add-fragment-button').addEventListener('click', () => this.addFragment());
  }

  // Build all editors from the project.
  build(project) {
    for (const f of this.fragments.values()) f.editor.destroy();
    this.fragments.clear();
    this.container.textContent = '';
    for (const f of project.fragments) this.addBlock(f);
    this.setLoop(project.loop);
    this.setReadOnly(this.readOnly);
    this.updateTabMarkers();
  }

  setLoop(loop) {
    this.loopLanguage = loop.language;
    this.loop.session.setMode(loop.language === 'lua' ? 'ace/mode/lua' : 'ace/mode/loop');
    this.loop.setValue(loop.text, -1);
    this.loop.session.getUndoManager().reset();
    document.getElementById('loop-language').textContent = loop.language === 'lua' ? '(raw Lua)' : '';
    document.getElementById('edit-as-lua-button').disabled = loop.language === 'lua' || this.readOnly;
  }

  addBlock(f) {
    const name = f.name;
    const info = DEFAULT_FRAGMENTS.includes(name)
      ? el('a', { href: '#', class: 'modal-link', 'data-open': `modal-${name}`, title: 'About this fragment' }, '') : '';
    const btn = (label, title, fn) => el('button', { class: 'control-button frag-tool', title, onclick: () => fn(name) }, label);
    const tools = el('span', { class: 'fragment-tools' },
      btn('↑', 'Move up', (n) => this.move(n, -1)),
      btn('↓', 'Move down', (n) => this.move(n, 1)),
      btn('Rename', 'Rename this fragment', (n) => this.rename(n)),
      btn('Delete', 'Delete this fragment', (n) => this.remove(n)));
    const heading = el('h3', {}, el('span', { class: 'fragment-name' }, name), info, tools);
    const desc = el('p', { class: 'fragment-description' }, f.description || '');
    const box = el('div', { class: 'editor', id: `editor-${name}` });
    const block = el('div', { class: 'fragment', 'data-fragment': name }, heading, desc, box);
    this.container.append(block);
    const editor = makeEditor(box, 'ace/mode/gringo');
    editor.setValue(f.text || '', -1);
    editor.session.getUndoManager().reset();
    editor.session.on('change', () => this.clearFor(name));
    this.fragments.set(name, { editor, block, heading, desc });
  }

  // Copy the editor contents into the project (in place) and return it.
  collect(project) {
    for (const f of project.fragments) {
      const e = this.fragments.get(f.name);
      if (e) f.text = e.editor.getValue();
    }
    project.loop = { ...project.loop, language: this.loopLanguage || 'loop', text: this.loop.getValue() };
    return project;
  }

  allEditors() { return [...[...this.fragments.values()].map((f) => f.editor), this.loop]; }

  setReadOnly(b) {
    this.readOnly = b;
    for (const ed of this.allEditors()) {
      ed.setReadOnly(b);
      ed.container.classList.toggle('locked', b);
      ed.container.style.background = b ? '#eee' : '';
    }
    for (const x of document.querySelectorAll('.frag-tool, #add-fragment-button, #insert-template-button, #edit-as-lua-button')) x.disabled = b;
    if (!b) document.getElementById('edit-as-lua-button').disabled = this.loopLanguage === 'lua';
  }

  // ---- annotations ---------------------------------------------------------
  // problems: [{ where: { kind, name, line, col }, severity, message }]
  annotate(problems) {
    this.clearAnnotations();
    const by = new Map();
    for (const p of problems) {
      const w = p.where || {};
      let key = null;
      if (w.kind === 'fragment' && this.fragments.has(w.name)) key = w.name;
      else if (w.kind === 'loop') key = 'loop';
      if (!key) continue;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push({ row: Math.max(0, (w.line || 1) - 1), column: Math.max(0, (w.col || 1) - 1), text: p.message, type: p.severity === 'error' ? 'error' : 'warning' });
    }
    for (const [key, anns] of by) {
      const ed = key === 'loop' ? this.loop : this.fragments.get(key).editor;
      ed.session.setAnnotations(anns);
      if (key !== 'loop') this.fragments.get(key).heading.classList.add('has-problem');
      this.marked.add(key);
    }
    this.updateTabMarkers();
    return by;
  }

  get marked() { if (!this._marked) this._marked = new Set(); return this._marked; }

  clearFor(key) {
    if (!this.marked.has(key)) return;
    const ed = key === 'loop' ? this.loop : this.fragments.get(key) && this.fragments.get(key).editor;
    if (ed) ed.session.clearAnnotations();
    if (key !== 'loop' && this.fragments.get(key)) this.fragments.get(key).heading.classList.remove('has-problem');
    this.marked.delete(key);
    this.updateTabMarkers();
  }

  clearAnnotations() { for (const k of [...this.marked]) this.clearFor(k); }

  updateTabMarkers() {
    const frag = [...this.marked].some((k) => k !== 'loop');
    document.getElementById('label-programs').classList.toggle('has-problem', frag);
    document.getElementById('label-loop').classList.toggle('has-problem', this.marked.has('loop'));
  }

  // ---- fragment operations ---------------------------------------------------
  withProject(fn) {
    const p = this.collect(this.app.project);
    fn(p);
    this.build(p);
    this.app.projectChanged && this.app.projectChanged();
  }

  askName(question, current = '') {
    const n = (window.prompt(question, current) || '').trim();
    if (!n) return null;
    if (!FRAGMENT_NAME.test(n)) { window.alert('A fragment name starts with a lower case letter and contains only lower case letters, digits and _.'); return null; }
    if (this.app.project.fragments.some((f) => f.name === n)) { window.alert(`There is already a fragment called ${n}.`); return null; }
    return n;
  }

  addFragment() {
    if (this.readOnly) return;
    const n = this.askName('Name of the new fragment:');
    if (!n) return;
    this.withProject((p) => p.fragments.push({ name: n, text: '' }));
    const b = this.fragments.get(n);
    if (b) { b.block.scrollIntoView({ block: 'center' }); b.editor.focus(); }
  }

  rename(name) {
    if (this.readOnly) return;
    const n = this.askName(`New name for fragment ${name} (the loop script is not changed):`, name);
    if (!n) return;
    this.withProject((p) => { p.fragments.find((f) => f.name === name).name = n; });
  }

  remove(name) {
    if (this.readOnly) return;
    if (!window.confirm(`Delete fragment ${name}?`)) return;
    this.withProject((p) => { p.fragments = p.fragments.filter((f) => f.name !== name); });
  }

  move(name, d) {
    if (this.readOnly) return;
    this.withProject((p) => {
      const i = p.fragments.findIndex((f) => f.name === name), j = i + d;
      if (i < 0 || j < 0 || j >= p.fragments.length) return;
      [p.fragments[i], p.fragments[j]] = [p.fragments[j], p.fragments[i]];
    });
  }
}
