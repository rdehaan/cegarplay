// Loop tab: templates, constants, limits, Edit as Lua, threads.
import { TEMPLATES, template } from './project.js';
import { compile } from './compiler.js';

const $ = (id) => document.getElementById(id);
const NUMERIC = { 'seconds-input': 'seconds', 'candidates-input': 'candidates', 'trace-input': 'trace', 'seed-input': 'seed' };

export class LoopTab {
  constructor(app) {
    this.app = app;
    const sel = $('template-select');
    for (const [k, t] of Object.entries(TEMPLATES)) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = t.label;
      sel.append(o);
    }
    $('insert-template-button').addEventListener('click', () => this.insertTemplate(sel.value));
    $('edit-as-lua-button').addEventListener('click', () => this.editAsLua());
    $('add-constant-button').addEventListener('click', () => { this.addConstantRow('', ''); });
    for (const [id, key] of Object.entries(NUMERIC)) {
      $(id).addEventListener('change', (e) => {
        const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
        e.target.value = v;
        this.app.project.settings[key] = v;
      });
    }
    $('solutions-select').addEventListener('change', (e) => { this.app.project.settings.solutions = Number(e.target.value); });
    const th = $('threads-checkbox');
    const iso = app.engine.isolated && !!app.engine.control;
    th.disabled = !iso;
    $('threads-note').textContent = iso ? 'solvers may use options such as "-t 2"' : 'needs a cross-origin isolated page';
    th.addEventListener('change', () => {
      try { app.engine.setThreads(th.checked); app.internals && app.internals.facts(); } catch (e) { th.checked = !th.checked; window.alert(e.message); }
    });
  }

  // Compile the loop script while it is edited and mark errors at once.
  cancelLiveCheck() { clearTimeout(this.liveTimer); }

  liveCheck() {
    clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => {
      const ed = this.app.editors;
      if (ed.loopLanguage === 'lua' || ed.readOnly) return;
      let r;
      try { r = compile(ed.loop.getValue(), { fragments: [...ed.fragments.keys()] }); } catch { return; }
      ed.setMarks('loop', r.ok ? [] : r.errors);
    }, 500);
  }

  load(project) {
    const st = project.settings;
    for (const [id, key] of Object.entries(NUMERIC)) $(id).value = st[key];
    const sel = $('solutions-select');
    const v = String(st.solutions);
    if (![...sel.options].some((o) => o.value === v)) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v; o.dataset.extra = '1';
      sel.append(o);
    }
    sel.value = v;
    const tb = document.querySelector('#constants-table tbody');
    tb.textContent = '';
    for (const [k, val] of Object.entries(st.constants || {})) this.addConstantRow(k, val);
  }

  addConstantRow(name, value) {
    const tb = document.querySelector('#constants-table tbody');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><input class="const-name" placeholder="name"></td><td><input class="const-value" placeholder="value"></td><td><button class="control-button">Remove</button></td>';
    const [n, v] = tr.querySelectorAll('input');
    n.value = name; v.value = value;
    n.addEventListener('input', () => this.syncConstants());
    v.addEventListener('input', () => this.syncConstants());
    tr.querySelector('button').addEventListener('click', () => { tr.remove(); this.syncConstants(); });
    tb.append(tr);
    if (!name) n.focus();
    this.syncConstants();
  }

  syncConstants() {
    const c = {};
    for (const tr of document.querySelectorAll('#constants-table tbody tr')) {
      const [n, v] = tr.querySelectorAll('input');
      if (n.value.trim()) c[n.value.trim()] = v.value.trim();
    }
    this.app.project.settings.constants = c;
  }

  insertTemplate(key) {
    const ed = this.app.editors;
    if (ed.readOnly) return;
    const cur = ed.loop.getValue();
    const legacy = /^\s*link\b.*\blegacy\b/m.test(cur);
    const text = template(key, { legacy });
    if (ed.loopLanguage === 'lua') {
      if (!window.confirm('Replace the raw Lua loop by this template?')) return;
      ed.setLoop({ language: 'loop', text });
    } else {
      ed.loop.setValue(text, -1);
    }
  }

  editAsLua() {
    const app = this.app;
    const p = app.collect();
    if (p.loop.language === 'lua') return;
    const r = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
    if (!r.ok) {
      app.editors.annotate(r.errors.map((e) => ({ where: { kind: 'loop', line: e.line, col: e.col }, severity: 'error', message: e.message })));
      window.alert('The loop script has errors; fix them first (see the marks in the editor).');
      return;
    }
    if (!window.confirm('Replace the loop script by the Lua it compiles to? This cannot be undone (except by inserting a template).')) return;
    const lua = r.lua.split('\n').map((l) => l.replace(/^ {4}/, '')).join('\n');
    app.editors.setLoop({ language: 'lua', text: lua });
  }
}
