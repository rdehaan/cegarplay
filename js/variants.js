// Variants: the top bar's Variant picker and the editor in the Loop tab.
// A variant (project.variants) changes the project for a run:
// swap (fragment -> the fragment whose text it gets), its own loop script, constants. The picker
// sets settings.variant ('' = the project as it is); a run, an audit and "Run all" use it, and a
// campaign suite names variants explicitly.
import { INSTANCE_ID } from './project.js';
import { compareVariants, hunks } from './compare.js';
import { compile } from './compiler.js';

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

// "a=b, c=d" <-> { a: 'b', c: 'd' }
export function parsePairs(text) {
  const out = {};
  for (const part of String(text).split(/[,\n]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^([^=\s]+)\s*=\s*(\S+)$/);
    if (!m) throw new Error(`"${part}" is not name=value`);
    out[m[1]] = m[2];
  }
  return out;
}
export const showPairs = (map) => Object.entries(map || {}).map(([a, b]) => `${a}=${b}`).join(', ');

// "1 fragment and the loop script differ", "the loop script differs": what two sides differ in.
function differText(c) {
  const items = [];
  if (c.fragments.length) items.push({ text: `${c.fragments.length} fragment${c.fragments.length === 1 ? '' : 's'}`, plural: c.fragments.length > 1 });
  if (c.loop) items.push({ text: 'the loop script', plural: false });
  if (c.constants.length) items.push({ text: 'constants', plural: true });
  if (c.settings.length) items.push({ text: 'settings', plural: true });
  const list = items.map((x) => x.text).reduce((s, x, i) => s + (i ? (i === items.length - 1 ? ' and ' : ', ') : '') + x, '');
  return `${list} ${items.length > 1 || items.some((x) => x.plural) ? 'differ' : 'differs'}`;
}

export class Variants {
  constructor(app) {
    this.app = app;
    this.root = $('variants');
    this.select = $('variant-select');
    this.readOnly = false;
    // swaps typed with a fragment that does not exist (yet): variant name -> text. They are not in
    // the project (it would not load); fragmentsChanged() applies one as soon as it is valid.
    this.pending = new Map();
    this.pendingProject = null;
    this.select.addEventListener('change', () => {
      this.app.project.settings = { ...this.app.project.settings, variant: this.select.value };
      if (!this.select.value) delete this.app.project.settings.variant;
      this.app.dirty();
      if (this.app.instancesTab) this.app.instancesTab.renderContext();
    });
  }

  get list() { return this.app.project.variants || (this.app.project.variants = []); }

  // the variant a run uses now ('' = the project as it is)
  selected() {
    const v = this.app.project.settings.variant;
    return v && this.list.some((x) => x.name === v) ? v : '';
  }

  load() { this.pending.clear(); this.compareSides = null; this.render(); }

  setReadOnly(b) {
    this.readOnly = b;
    this.select.disabled = b;
    // comparing changes nothing: it stays usable in a read-only project
    for (const e of this.root.querySelectorAll('input, textarea, button')) if (!e.closest('.variant-compare')) e.disabled = b;
    for (const ed of this.loopEditors || []) { ed.setReadOnly(b); ed.container.classList.toggle('locked', b); }
  }

  // A variant's own loop script: an ACE editor as the project's (highlighting, the loop language's
  // live check with marks in the gutter), made when the variant gets its own script.
  loopEditor(v, host) {
    const lua = v.loop.language === 'lua';
    // through app.editors: this module is also imported by Node tests, where ACE does not exist
    const ed = this.app.editors.make(host, lua ? 'ace/mode/lua' : 'ace/mode/loop', { readOnly: !!this.readOnly });
    ed.container.classList.toggle('locked', !!this.readOnly);
    ed.setValue(v.loop.text, -1);
    ed.session.getUndoManager().reset();
    host.setAttribute('aria-label', `Loop script of variant ${v.name}`);
    const check = () => {
      if (lua) return;
      let r;
      try { r = compile(ed.getValue(), { fragments: this.app.project.fragments.map((f) => f.name) }); } catch { return; }
      ed.session.setAnnotations(r.ok ? [] : r.errors.map((e) => ({ row: Math.max(0, (e.line || 1) - 1), column: Math.max(0, (e.col || 1) - 1), text: e.message, type: e.severity || 'error' })));
    };
    let timer = null;
    ed.session.on('change', () => {
      if (!v.loop) return;
      v.loop = { ...v.loop, text: ed.getValue() };
      ed.session.clearAnnotations();
      clearTimeout(timer);
      timer = setTimeout(() => { check(); this.changed(); }, 400);
    });
    check();
    (this.loopEditors || (this.loopEditors = new Set())).add(ed);
    return ed;
  }

  dropLoopEditor(ed) {
    if (!ed) return;
    this.loopEditors.delete(ed);
    ed.destroy();
    ed.container.textContent = '';
  }

  changed() {
    this.app.dirty();
    this.renderPicker();
    this.refreshCompare();
    if (this.app.instancesTab) this.app.instancesTab.renderContext();
  }

  // The compare selects follow the variants (a rename, an add, a delete); a comparison on
  // screen is made again, as it shows the variants as they are now.
  refreshCompare() {
    if (!this.cmpA || !this.cmpA.isConnected) return;
    for (const [s, i] of [[this.cmpA, 0], [this.cmpB, 1]]) {
      const want = (this.compareSides || [s.value, s.value])[i] ?? s.value;
      s.textContent = '';
      s.append(el('option', { value: '' }, '(no variant)'));
      for (const v of this.list) s.append(el('option', { value: v.name }, v.name));
      s.value = this.list.some((v) => v.name === want) ? want : '';
    }
    if (this.cmpOut.childElementCount) { this.compareSides = [this.cmpA.value, this.cmpB.value]; this.showCompare(); }
  }

  // A swap as typed: { map } when it can be applied now, else { error, later } (later: it names
  // a fragment that does not exist yet, so it is kept and tried again).
  checkSwap(text) {
    let map;
    try { map = parsePairs(text); } catch (e) { return { error: `Swap: ${e.message}.` }; }
    const names = this.app.project.fragments.map((f) => f.name);
    const bad = [...new Set(Object.entries(map).flat().filter((n) => !names.includes(n)))];
    if (bad.length) return { error: `Swap: no fragment named ${bad.join(', ')} yet; the swap is applied once it exists.`, later: true };
    return { map };
  }

  // The fragments changed (Editors.build): a pending swap may be valid now; the cards show the
  // fragments as they are.
  fragmentsChanged() {
    if (this.pendingProject !== this.app.project) { this.pending.clear(); return; }
    let applied = false;
    for (const [name, text] of [...this.pending]) {
      const v = this.list.find((x) => x.name === name);
      const r = v ? this.checkSwap(text) : { error: 'gone' };
      if (!v) this.pending.delete(name);
      else if (r.map) { v.swap = r.map; this.pending.delete(name); applied = true; }
    }
    if (this.pending.size || applied) this.render();
    if (applied) this.changed();
  }

  renderPicker() {
    const list = this.list;
    this.select.textContent = '';
    this.select.hidden = list.length === 0;
    $('variant-select-label').hidden = list.length === 0;
    if (!list.length) return;
    this.select.append(el('option', { value: '' }, '(no variant)'));
    for (const v of list) this.select.append(el('option', { value: v.name }, v.name));
    this.select.value = this.selected();
  }

  render() {
    this.renderPicker();
    for (const ed of this.loopEditors || []) ed.destroy();
    if (this.loopEditors) this.loopEditors.clear();
    this.root.textContent = '';
    const fragments = this.app.project.fragments.map((f) => f.name);
    if (!this.list.length) {
      this.root.append(el('p', { class: 'note' }, 'No variants. A variant runs the same project with other fragments, another loop script or other constants; ',
        'the top bar then gets a Variant picker, and a campaign suite can compare variants on the same instances.'));
    }
    if (this.list.length) {
      // the Campaign tab compares variants on many instances; it is shown only when ticked (Tabs, Advanced)
      const open = el('a', { href: '#', id: 'variants-campaign-link', onclick: (e) => {
        e.preventDefault();
        if (this.app.showTabs) this.app.showTabs('campaign', true, { store: false });
        const t = document.getElementById('tab10');
        if (t) { t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); }
      } }, 'Campaign tab');
      this.root.append(el('p', { class: 'note' }, 'To compare the variants on many instances (a table per instance and variant, plots, CSV), use the ', open,
        el('span', { class: 'campaign-off-only' }, ' (an Advanced tab, now hidden; this link shows it for this visit)'), '.'));
    }
    this.list.forEach((v, i) => this.root.append(this.card(v, i, fragments)));
    this.root.append(el('p', { class: 'inline-controls' },
      el('button', { class: 'control-button', id: 'add-variant-button', onclick: () => this.add() }, '+ Add variant')));
    if (this.list.length) this.root.append(this.compareBox());
    this.setReadOnly(this.readOnly);
  }

  // ---- compare two variants (js/compare.js) --------------------------------------
  // Two sides ('' = the project as written); the fragments and loop script as line diffs, and the
  // constants and settings that differ. Texts only: results per instance are the Campaign tab's
  // (compare.js still computes `results` from the run history, for its tests and tools).
  compareBox() {
    const opts = (id, label, value) => {
      const s = el('select', { id, 'aria-label': label });
      s.append(el('option', { value: '' }, '(no variant)'));
      for (const v of this.list) s.append(el('option', { value: v.name }, v.name));
      s.value = this.list.some((v) => v.name === value) ? value : '';
      return s;
    };
    const keep = this.compareSides || ['', this.list[0].name];
    this.cmpA = opts('compare-a', 'First side of the comparison', keep[0]);
    this.cmpB = opts('compare-b', 'Second side of the comparison', keep[1]);
    this.cmpOut = el('div', { id: 'compare-result', class: 'compare-result', 'aria-live': 'polite' });
    const run = () => { this.compareSides = [this.cmpA.value, this.cmpB.value]; this.showCompare(); close.hidden = false; };
    // Close: back to nothing compared (both sides the project as written, no result shown)
    const close = el('button', { class: 'control-button', id: 'compare-close-button', type: 'button', hidden: true,
      onclick: () => { this.compareSides = ['', '']; this.cmpA.value = ''; this.cmpB.value = ''; this.cmpOut.textContent = ''; close.hidden = true; } }, 'Close');
    for (const s of [this.cmpA, this.cmpB]) s.addEventListener('change', () => { if (this.cmpOut.childElementCount) run(); });
    return el('div', { class: 'variant-compare', id: 'variant-compare' },
      el('h3', {}, 'Compare variants'),
      el('div', { class: 'variant-row' },
        el('label', {}, 'Compare ', this.cmpA), el('label', {}, 'with ', this.cmpB),
        el('button', { class: 'control-button', id: 'compare-button', type: 'button', onclick: run,
          title: 'The fragments and loop script as line diffs, and the constants and settings that differ' }, 'Compare'), close),
      this.cmpOut);
  }

  showCompare() {
    const out = this.cmpOut;
    out.textContent = '';
    const name = (x) => x || '(no variant)';
    let c;
    try {
      c = compareVariants(this.app.collect ? this.app.collect() : this.app.project, this.cmpA.value, this.cmpB.value,
        (this.app.stats && this.app.stats.history) || []);
    } catch (e) { out.append(el('p', { class: 'error-text' }, String(e.message || e))); return; }
    const A = name(c.a), B = name(c.b);
    const same = !c.fragments.length && !c.loop && !c.constants.length && !c.settings.length;
    out.append(el('p', { class: 'note', id: 'compare-summary' }, c.a === c.b ? 'Both sides are the same.'
      : same ? `${A} and ${B} run the same program.`
        : `${B} against ${A}: ${differText(c)}.`));
    const val = (v) => (v === null ? '(none)' : typeof v === 'string' ? v : JSON.stringify(v));
    if (c.constants.length || c.settings.length) {
      const t = el('table', { class: 'internals-table compare-table', id: 'compare-constants' },
        el('tr', {}, el('th', {}, ''), el('th', {}, A), el('th', {}, B)));
      for (const x of c.constants) t.append(el('tr', {}, el('td', {}, `-c ${x.name}`), el('td', {}, val(x.a)), el('td', {}, val(x.b))));
      for (const x of c.settings) t.append(el('tr', {}, el('td', {}, x.name), el('td', {}, val(x.a)), el('td', {}, val(x.b))));
      out.append(el('div', { class: 'table-wrapper' }, t));
    }
    const diffBlock = (title, d, id) => {
      const pre = el('pre', { class: 'compare-diff', 'aria-label': `Line diff of ${title}` });
      for (const hk of hunks(d.diff, 2)) {
        pre.append(el('span', { class: 'diff-hunk' }, `@@ ${A} line ${hk.aStart}, ${B} line ${hk.bStart}\n`));
        for (const x of hk.lines) {
          pre.append(el('span', { class: x.op === '+' ? 'diff-add' : x.op === '-' ? 'diff-del' : 'diff-same' }, `${x.op} ${x.line}\n`));
        }
      }
      return el('details', { class: 'compare-block', open: true, 'data-compare': id },
        el('summary', {}, `${title}: `, el('span', { class: 'diff-add-count' }, `+${d.added}`), ' ', el('span', { class: 'diff-del-count' }, `-${d.removed}`)), pre);
    };
    for (const f of c.fragments) out.append(diffBlock(`fragment ${f.name}`, f, `fragment:${f.name}`));
    if (c.loop) {
      out.append(diffBlock('the loop script' + (c.loop.languages[0] !== c.loop.languages[1] ? ` (${c.loop.languages.join(' / ')})` : ''), c.loop, 'loop'));
    }
    // results per instance: the Campaign tab runs every variant on every instance (a suite)
    const open = el('a', { href: '#', id: 'compare-campaign-link', onclick: (e) => {
      e.preventDefault();
      if (this.app.showTabs) this.app.showTabs('campaign', true, { store: false });
      const t = document.getElementById('tab10');
      if (t) { t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); }
    } }, 'Campaign tab');
    out.append(el('p', { class: 'note', id: 'compare-results-note' }, 'This compares the texts only. To compare what the two sides compute (solutions, refinements, time per instance), run a suite in the ',
      open, '.'));
  }

  card(v, i, fragments) {
    const err = el('span', { class: 'error-text variant-error', role: 'status' });
    const fail = (msg) => { err.textContent = msg; };
    const ok = () => { err.textContent = ''; };
    const name = el('input', { type: 'text', value: v.name, 'aria-label': 'Variant name', class: 'variant-name' });
    name.addEventListener('change', () => {
      const n = name.value.trim();
      if (n === v.name) return ok();
      if (!INSTANCE_ID.test(n)) return fail('A name uses letters, digits, _ and - only.');
      if (n === 'default' || this.list.some((x) => x !== v && x.name === n)) return fail(`The name ${n} is taken.`);
      this.renameVariant(v.name, n);
      ok();
      // a swap still waiting for its fragment keeps saying so
      if (this.pending.has(n)) { const r = this.checkSwap(this.pending.get(n)); if (r.error) fail(r.error); }
      this.changed();
    });
    const swap = el('input', { type: 'text', value: this.pending.has(v.name) ? this.pending.get(v.name) : showPairs(v.swap), class: 'variant-swap', placeholder: `e.g. ${this.swapExample()}`,
      'aria-label': `Swap of variant ${v.name}` });
    swap.addEventListener('change', () => {
      const r = this.checkSwap(swap.value);
      if (r.error) {
        if (r.later) { this.pending.set(v.name, swap.value); this.pendingProject = this.app.project; } else this.pending.delete(v.name);
        return fail(r.error);
      }
      this.pending.delete(v.name);
      v.swap = r.map;
      ok();
      this.changed();
    });
    if (this.pending.has(v.name)) { const r = this.checkSwap(this.pending.get(v.name)); if (r.error) fail(r.error); }
    const consts = el('input', { type: 'text', value: showPairs(v.constants), class: 'variant-constants', placeholder: 'e.g. n=5',
      'aria-label': `Constants of variant ${v.name}` });
    consts.addEventListener('change', () => {
      try { v.constants = parsePairs(consts.value); } catch (e) { return fail(`Constants: ${e.message}.`); }
      ok();
      this.changed();
    });
    let hint = null;
    const own = el('input', { type: 'checkbox', class: 'variant-own-loop', 'aria-label': `Variant ${v.name} has its own loop script` });
    own.checked = !!v.loop;
    const text = el('div', { class: 'variant-loop editor' });
    text.hidden = !v.loop;
    let editor = null;
    // the editor is made once the card is in the page (ACE measures its container)
    if (v.loop) requestAnimationFrame(() => { if (text.isConnected && v.loop && !editor) editor = this.loopEditor(v, text); });
    own.addEventListener('change', () => {
      if (own.checked) {
        const L = this.app.collect ? this.app.collect().loop : this.app.project.loop;
        v.loop = { language: L.language, text: L.text };
      } else delete v.loop;
      this.dropLoopEditor(editor);
      editor = null;
      text.hidden = !v.loop;
      hint.hidden = !!v.loop;
      if (v.loop) editor = this.loopEditor(v, text);
      this.changed();
    });
    const del = el('button', { class: 'control-button small-button', onclick: () => this.remove(v.name) }, 'Delete');
    // the lab notebook (FUTURE-DIRECTIONS D10): why this variant exists, kept in the project
    const note = el('input', { type: 'text', value: v.note || '', class: 'variant-note', placeholder: 'why I tried this', 'aria-label': `Note on variant ${v.name}` });
    note.addEventListener('change', () => { if (note.value.trim()) v.note = note.value.trim(); else delete v.note; this.changed(); });
    return el('fieldset', { class: 'variant-card', 'data-variant': v.name },
      el('div', { class: 'variant-row' }, el('label', {}, 'Name ', name), del, err),
      el('div', { class: 'variant-row' }, el('label', { title: 'fragment=fragment whose text it gets, ...' }, 'Swap ', swap),
        el('label', { title: 'name=value, ...' }, 'Constants ', consts)),
      el('div', { class: 'variant-row' }, el('label', { class: 'variant-note-label' }, 'Note ', note)),
      el('div', { class: 'variant-row' }, el('label', {}, own, ' its own loop script'),
        hint = el('span', { class: 'note', hidden: !!v.loop }, 'starts as a copy of the project\'s loop script')),
      text);
  }

  // an example swap from the project's own fragments: "check=check2" (another fragment's text)
  swapExample() {
    const names = this.app.project.fragments.map((f) => f.name);
    const a = names.includes('check') ? 'check' : names[0] || 'check';
    const b = names.find((n) => n !== a && n.startsWith(a)) || `${a}2`;
    return `${a}=${b}`;
  }

  add() {
    let k = this.list.length + 1;
    while (this.list.some((x) => x.name === `v${k}`)) k++;
    this.list.push({ name: `v${k}`, swap: {}, constants: {} });
    this.render();
    this.changed();
  }

  remove(name) {
    if (!window.confirm(`Delete variant ${name}?`)) return;
    const p = this.app.project;
    p.variants = this.list.filter((x) => x.name !== name);
    if (p.settings.variant === name) delete p.settings.variant;
    for (const s of p.suites || []) if (Array.isArray(s.variants)) s.variants = s.variants.filter((x) => x !== name);
    this.render();
    this.changed();
    if (this.app.campaign) this.app.campaign.load();
  }

  renameVariant(from, to) {
    const p = this.app.project;
    const v = this.list.find((x) => x.name === from);
    v.name = to;
    if (this.pending.has(from)) { this.pending.set(to, this.pending.get(from)); this.pending.delete(from); }
    const sides = this.compareSides || (this.cmpA && this.cmpA.isConnected ? [this.cmpA.value, this.cmpB.value] : null);
    if (sides) this.compareSides = sides.map((x) => (x === from ? to : x));
    if (p.settings.variant === from) p.settings.variant = to;
    for (const s of p.suites || []) if (Array.isArray(s.variants)) s.variants = s.variants.map((x) => (x === from ? to : x));
    const card = this.root.querySelector(`[data-variant="${CSS.escape(from)}"]`);
    if (card) card.dataset.variant = to;
    if (this.app.campaign) this.app.campaign.load();
  }

  // A fragment was renamed or deleted (Programs tab): keep the swaps consistent.
  fragmentRenamed(from, to) {
    for (const v of this.list) {
      v.swap = Object.fromEntries(Object.entries(v.swap || {}).map(([a, b]) => [a === from ? to : a, b === from ? to : b]));
    }
    this.render();
  }
  fragmentDeleted(name) {
    for (const v of this.list) {
      v.swap = Object.fromEntries(Object.entries(v.swap || {}).filter(([a, b]) => a !== name && b !== name));
    }
    this.render();
  }
}
