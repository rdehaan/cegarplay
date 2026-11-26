// ACE editors built from the project: one per fragment, plus the loop editor.
/* global ace */
import { FRAGMENT_NAME, DEFAULT_FRAGMENTS, INSTANCE_FRAGMENT } from './project.js';

// The ACE theme follows the colour theme (js/theme.js); every editor made here switches with it.
const LIVE = new Set();
const aceTheme = () => (window.cegarTheme && window.cegarTheme.isDark() ? 'ace/theme/cegarplay_dark' : 'ace/theme/textmate');
if (window.cegarTheme) {
  window.cegarTheme.onChange(() => {
    const theme = aceTheme();
    for (const ed of LIVE) {
      if (!ed.container.isConnected || !ed.renderer) { LIVE.delete(ed); continue; }
      try { ed.setTheme(theme); } catch (e) { LIVE.delete(ed); }
    }
  });
}

export function makeEditor(el, mode, { readOnly = false } = {}) {
  const ed = ace.edit(el);
  ed.setTheme(aceTheme());
  LIVE.add(ed);
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
    this.loop.session.on('change', () => { this.clearFor('loop'); this.app.dirty && this.app.dirty(); this.app.loopTab && this.app.loopTab.liveCheck(); this.onEdit && this.onEdit('loop'); });
    this.container = document.getElementById('fragments');
    document.getElementById('add-fragment-button').addEventListener('click', () => this.addFragment());
  }

  // Build all editors from the project.
  build(project) {
    for (const f of this.fragments.values()) f.editor.destroy();
    this.fragments.clear();
    this.marked.clear();
    this.serious.clear();
    this.base.clear();
    this.lint.clear();
    this.loop.session.clearAnnotations();
    this.container.textContent = '';
    this.project = project;
    const vc = document.getElementById('view-fragments');
    if (vc) vc.textContent = '';
    for (const f of project.fragments) this.addBlock(f);
    this.setLoop(project.loop);
    this.setReadOnly(this.readOnly);
    this.updateTabMarkers();
    const n = project.fragments.filter((f) => this.isViewFragment(f.name)).length;
    const note = document.getElementById('view-fragments-note');
    if (note) note.hidden = !n;
    this.resizeShown();
    if (this.app.views && this.app.views.editorsBuilt) this.app.views.editorsBuilt();
    if (this.app.variants && this.app.variants.fragmentsChanged) this.app.variants.fragmentsChanged();
    this.onEdit && this.onEdit(null);
  }

  // An editor built while its box has no size (a hidden tab, or before layout) stays a few
  // pixels high until it is resized; resize the ones that are on screen.
  resizeShown() {
    for (const ed of this.allEditors()) if (ed.container.offsetParent !== null) ed.resize(true);
  }

  // A view fragment: one that a view names and that the loop script does not use. It is edited
  // with its view in the Observatory tab (js/view-panel.js), not in the Programs tab.
  isViewFragment(name, project = this.project || this.app.project) {
    if (!project || DEFAULT_FRAGMENTS.includes(name) || name === INSTANCE_FRAGMENT) return false;
    if (!(project.views || []).some((v) => (v.fragments || []).includes(name))) return false;
    const word = new RegExp(`\\b${name}\\b`);
    if (word.test((project.loop && project.loop.text) || '')) return false;
    if ((project.variants || []).length && word.test(JSON.stringify(project.variants))) return false;
    return true;
  }

  setLoop(loop) {
    this.loopLanguage = loop.language;
    this.loop.session.setMode(loop.language === 'lua' ? 'ace/mode/lua' : 'ace/mode/loop');
    this.loop.setValue(loop.text, -1);
    this.loop.session.getUndoManager().reset();
    document.getElementById('loop-language').textContent = loop.language === 'lua' ? '(raw Lua)' : '';
    if (this.onLoopLanguage) this.onLoopLanguage();
    document.getElementById('edit-as-lua-button').disabled = loop.language === 'lua' || this.readOnly;
  }

  addBlock(f) {
    const name = f.name;
    const inView = this.isViewFragment(name);
    const info = DEFAULT_FRAGMENTS.includes(name)
      ? el('a', { href: '#', class: 'modal-link', 'data-open': `modal-${name}`, title: 'About this fragment', 'aria-label': `About the ${name} fragment` }, '?') : '';
    const btn = (label, title, fn) => el('button', { class: 'control-button frag-tool', title, onclick: () => fn(name) }, label);
    const tools = inView ? '' : el('span', { class: 'fragment-tools' },
      btn('↑', 'Move up', (n) => this.move(n, -1)),
      btn('↓', 'Move down', (n) => this.move(n, 1)),
      btn('Rename', 'Rename this fragment', (n) => this.rename(n)),
      btn('Delete', 'Delete this fragment', (n) => this.remove(n)));
    const heading = el('h3', {}, el('span', { class: 'fragment-name' }, name), info, tools);
    const desc = el('p', { class: 'fragment-description' }, f.description || '');
    const box = el('div', { class: 'editor', id: `editor-${name}` });
    const block = el('div', { class: 'fragment', 'data-fragment': name }, heading, desc, box);
    const vc = inView && document.getElementById('view-fragments');
    if (vc) block.classList.add('view-fragment');
    (vc || this.container).append(block);
    const editor = makeEditor(box, 'ace/mode/gringo');
    editor.setValue(f.text || '', -1);
    editor.session.getUndoManager().reset();
    editor.session.on('change', () => {
      this.clearFor(name);
      this.app.dirty && this.app.dirty();
      if (this.app.control && !this.readOnly) this.app.control.scheduleFragmentCheck(name);
      if (this.app.views && this.app.views.fragmentEdited) this.app.views.fragmentEdited(name);
      this.onEdit && this.onEdit(name);
    });
    this.fragments.set(name, { editor, block, heading, desc });
    if (this.onEditorMade) this.onEditorMade(name, editor);
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

  // an editor elsewhere on the page (a variant's loop script) with the same theme and options
  make(el, mode, opts) { return makeEditor(el, mode, opts); }

  allEditors() { return [...[...this.fragments.values()].map((f) => f.editor), this.loop]; }

  setReadOnly(b) {
    this.readOnly = b;
    for (const ed of this.allEditors()) {
      ed.setReadOnly(b);
      ed.container.classList.toggle('locked', b);
    }
    for (const x of document.querySelectorAll('.frag-tool, #add-fragment-button, #insert-template-button, #edit-as-lua-button')) x.disabled = b;
    if (!b) document.getElementById('edit-as-lua-button').disabled = this.loopLanguage === 'lua';
    this.syncMoveButtons();
    if (this.app && this.app.instancesTab) this.app.instancesTab.setReadOnly(b);
    if (this.app && this.app.variants) this.app.variants.setReadOnly(b);
    if (this.app && this.app.views) this.app.views.setReadOnly(b);
  }

  // ↑ on the first fragment of the Programs tab and ↓ on the last do nothing: disabled
  syncMoveButtons() {
    const blocks = [...this.container.querySelectorAll(':scope > .fragment')];
    blocks.forEach((bl, i) => {
      const up = bl.querySelector('button[title="Move up"]'), down = bl.querySelector('button[title="Move down"]');
      if (up) up.disabled = this.readOnly || i === 0;
      if (down) down.disabled = this.readOnly || i === blocks.length - 1;
    });
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
      by.get(key).push({ row: Math.max(0, (w.line || 1) - 1), column: Math.max(0, (w.col || 1) - 1), text: p.message, type: ['error', 'warning', 'info'].includes(p.severity) ? p.severity : 'warning' });
    }
    for (const [key, anns] of by) {
      const ed = key === 'loop' ? this.loop : this.fragments.get(key).editor;
      this.base.set(key, anns);
      this.render(key);
      const serious = anns.some((a) => a.type !== 'info');
      if (key !== 'loop' && serious) this.fragments.get(key).heading.classList.add('has-problem');
      this.marked.add(key);
      if (serious) this.serious.add(key);
    }
    this.updateTabMarkers();
    return by;
  }

  // Marks for one editor only (e.g. live checks of the loop script); others are kept.
  setMarks(key, problems) {
    const ed = key === 'loop' ? this.loop : this.fragments.get(key) && this.fragments.get(key).editor;
    if (!ed) return;
    const anns = problems.map((p) => ({ row: Math.max(0, (p.line || 1) - 1), column: Math.max(0, (p.col || 1) - 1), text: p.message, type: p.severity || 'error' }));
    this.base.set(key, anns);
    this.render(key);
    if (anns.length) { this.marked.add(key); this.serious.add(key); }
    else { this.marked.delete(key); this.serious.delete(key); }
    if (key !== 'loop') this.fragments.get(key).heading.classList.toggle('has-problem', anns.length > 0);
    this.updateTabMarkers();
  }

  get marked() { if (!this._marked) this._marked = new Set(); return this._marked; }
  get base() { if (!this._base) this._base = new Map(); return this._base; }
  get lint() { if (!this._lint) this._lint = new Map(); return this._lint; }
  editorOf(key) { return key === 'loop' ? this.loop : this.fragments.get(key) && this.fragments.get(key).editor; }
  // what an editor's gutter shows: the marks of clingo and the compiler, then the warnings of
  // js/asp-scan.js on lines that have no such mark (the warnings never set the red tab marker)
  render(key) {
    const ed = this.editorOf(key);
    if (!ed) return;
    const base = this.base.get(key) || [];
    const rows = new Set(base.map((a) => a.row));
    ed.session.setAnnotations([...base, ...(this.lint.get(key) || []).filter((a) => !rows.has(a.row))]);
  }
  // problems: [{ line, col, message, severity }] (lines from 1), for one editor
  setLint(key, problems) {
    const anns = problems.map((p) => ({ row: Math.max(0, (p.line || 1) - 1), column: Math.max(0, (p.col || 1) - 1), text: p.message, type: p.severity || 'warning', lint: true }));
    const before = JSON.stringify(this.lint.get(key) || []);
    if (anns.length) this.lint.set(key, anns); else this.lint.delete(key);
    if (JSON.stringify(anns) !== before) this.render(key);
  }
  lintAt(key, row) { return (this.lint.get(key) || []).filter((a) => a.row === row); }
  marksAt(key, row) { return [...(this.base.get(key) || []).filter((a) => a.row === row), ...this.lintAt(key, row)]; }
  get serious() { if (!this._serious) this._serious = new Set(); return this._serious; }

  clearFor(key) {
    if (!this.marked.has(key)) return;
    this.base.delete(key);
    this.render(key);
    if (key !== 'loop' && this.fragments.get(key)) this.fragments.get(key).heading.classList.remove('has-problem');
    this.marked.delete(key);
    this.serious.delete(key);
    this.updateTabMarkers();
  }

  clearAnnotations() { for (const k of [...this.marked]) this.clearFor(k); }

  updateTabMarkers() {
    const frag = [...this.serious].some((k) => k !== 'loop');
    document.getElementById('label-programs').classList.toggle('has-problem', frag);
    document.getElementById('label-loop').classList.toggle('has-problem', this.serious.has('loop'));
  }

  // ---- fragment operations ---------------------------------------------------
  withProject(fn) {
    const p = this.collect(this.app.project);
    fn(p);
    this.build(p);
    this.app.projectChanged && this.app.projectChanged();
  }

  askName(question, current = '', what = 'fragment') {
    const n = (window.prompt(question, current) || '').trim();
    if (!n || n === current) return null;
    if (!FRAGMENT_NAME.test(n)) { window.alert('A fragment name starts with a lower case letter and contains only lower case letters, digits and _.'); return null; }
    if (n === INSTANCE_FRAGMENT) { window.alert(`The name ${n} is reserved for the facts of an instance (Instances tab).`); return null; }
    if (this.app.project.fragments.some((f) => f.name === n)) { window.alert(`There is already a fragment called ${n}${what === 'view' ? ' (a view\'s rules are a fragment of that name)' : ''}.`); return null; }
    return n;
  }

  addFragment() {
    if (this.readOnly) return;
    const n = this.askName('Name of the new fragment:');
    if (!n) return;
    this.withProject((p) => p.fragments.push({ name: n, text: '' }));
    const b = this.fragments.get(n);
    if (b) { b.editor.resize(true); b.block.scrollIntoView({ block: 'center' }); b.editor.focus(); }
  }

  rename(name) {
    if (this.readOnly) return;
    const n = this.askName(`New name for fragment ${name} (the loop script is not changed):`, name);
    if (!n) return;
    this.withProject((p) => { p.fragments.find((f) => f.name === name).name = n; });
    if (this.app && this.app.variants) this.app.variants.fragmentRenamed(name, n);
  }

  remove(name) {
    if (this.readOnly) return;
    if (!window.confirm(`Delete fragment ${name}?`)) return;
    this.withProject((p) => { p.fragments = p.fragments.filter((f) => f.name !== name); });
    if (this.app && this.app.variants) this.app.variants.fragmentDeleted(name);
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
