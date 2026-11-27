// Spaces (instance spaces and the space audit) of the Instances tab. These are methods of InstancesTab:
// js/instances-tab.js copies them onto its prototype, so `this` is the tab.
import { makeEditor } from './editors.js';
import { freshId } from './instances.js';
import { spaceBound, spaceCombos, spaceKeeps, INSTANCE_ID } from './project.js';
import { spaceAt } from './output.js';
import { spaceProblems } from './bounded.js';
import { h as el, $ } from './dom.js';
import { added, constText, partFold } from './instances-common.js';

export class SpacesPart {
  // ---- spaces (PLAN3 phase S7, optional) ------------------
  get spaces() { return this.app.project.spaces || (this.app.project.spaces = []); }
  get spaceItem() { return this.spaces.find((x) => x.name === this.space) || null; }

  buildSpaces() {
    this.spSelect = el('select', { id: 'space-list-select', 'aria-label': 'Space' });
    this.spSelect.addEventListener('change', () => { this.space = this.spSelect.value; this.clearSpacePreview(); this.renderSpaces(); });
    this.spName = el('input', { id: 'space-name', size: 14, 'aria-label': 'Space name' });
    this.spName.addEventListener('change', () => this.renameSpace(this.spName.value));
    // not 'space-description': that id is the top bar's description of the chosen space (index.html)
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
        'Audit by space (top bar) verifies the loop on all of them; it does not use the top bar\'s instance.'),
      box,
      this.spHint = el('p', { class: 'note', id: 'space-empty-hint', hidden: true }),
      el('div', { class: 'table-wrapper' }, this.spParams),
      el('p', { class: 'note' }, 'Parameters are constants of every solver: one named like a constant of your encoding (#const m = 2.) sets it. ' +
        'The bound runs from its first value up to the value given in the top bar. Every other parameter has a value, or a range lo..hi: the audit checks each value of the range at each value of the bound. ' +
        '"In a regression instance": whether the constant goes into the instance saved from an unsound witness.'),
      el('div', { class: 'instances-bar' },
        el('button', { class: 'control-button small-button', id: 'add-space-param-button', onclick: () => this.addSpaceParam() }, 'Add parameter'),
        el('label', {}, this.spKLabel, ' = ', this.spK),
        el('button', { class: 'control-button small-button', id: 'preview-space-button', onclick: () => this.previewSpace(),
          title: 'The first instances of the space at this value of the bound (up to 6), as facts' }, 'Preview'),
        this.spClear = el('button', { class: 'control-button small-button', id: 'space-preview-clear', hidden: true, onclick: () => this.clearSpacePreview(),
          title: 'Remove the previewed instances (an edit of the space removes them too)' }, 'Clear preview')),
      this.spStatus, this.spPreview);
    this.spSummary = el('span', { class: 'note', id: 'spaces-summary' });
    this.root.append(partFold('spaces', 'Spaces', this.spSummary,
      el('div', { class: 'instances-bar' }, this.spSelect,
        el('button', { class: 'control-button', id: 'add-space-button', onclick: () => this.addSpace() }, 'New space')),
      this.spBody));
    this.spEditor = makeEditor(box, 'ace/mode/gringo');
    this.spEditor.setOptions({ minLines: 5 });
    $('spaces-part').addEventListener('toggle', () => { if ($('spaces-part').open) this.spEditor.resize(true); });
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
    this.spSummary.textContent = list.length ? `${list.map((y) => y.description ? `${y.name} (${y.description})` : y.name).join(', ')}`
      : 'none: a space is every instance up to a bound, for Audit by space';
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
      if (isBound) values = el('span', {}, 'from ', this.spFrom, ' up to the top bar\'s value');
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

  // settings.audit (optional): the top bar's audit mode, space and bound, kept with the project.
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

  // The top bar changed (mode, space or bound): keep it in settings.audit; enumeration (the
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

  // The top bar: the Space mode of Audit appears only for a project with spaces.
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
    // the bound by its own name; the top bar says that the audit does not use an instance
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
}
