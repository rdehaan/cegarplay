// Variants: the run bar's Variant picker and the editor in the Loop tab.
// A variant (project.variants, docs/spec-instances.md section 1) changes the project for a run:
// swap (fragment -> the fragment whose text it gets), its own loop script, constants. The picker
// sets settings.variant ('' = the project as it is); a run, an audit and "Run all" use it, and a
// campaign suite names variants explicitly.
import { INSTANCE_ID } from './project.js';

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

export class Variants {
  constructor(app) {
    this.app = app;
    this.root = $('variants');
    this.select = $('variant-select');
    this.readOnly = false;
    this.select.addEventListener('change', () => {
      this.app.project.settings = { ...this.app.project.settings, variant: this.select.value };
      if (!this.select.value) delete this.app.project.settings.variant;
      this.app.dirty();
    });
  }

  get list() { return this.app.project.variants || (this.app.project.variants = []); }

  // the variant a run uses now ('' = the project as it is)
  selected() {
    const v = this.app.project.settings.variant;
    return v && this.list.some((x) => x.name === v) ? v : '';
  }

  load() { this.render(); }

  setReadOnly(b) {
    this.readOnly = b;
    this.select.disabled = b;
    for (const e of this.root.querySelectorAll('input, textarea, button')) e.disabled = b;
  }

  changed() {
    this.app.dirty();
    this.renderPicker();
  }

  renderPicker() {
    const list = this.list;
    this.select.textContent = '';
    this.select.hidden = list.length === 0;
    $('variant-select-label').hidden = list.length === 0;
    if (!list.length) return;
    this.select.append(el('option', { value: '' }, '(the project as it is)'));
    for (const v of list) this.select.append(el('option', { value: v.name }, v.name));
    this.select.value = this.selected();
  }

  render() {
    this.renderPicker();
    this.root.textContent = '';
    const fragments = this.app.project.fragments.map((f) => f.name);
    if (!this.list.length) {
      this.root.append(el('p', { class: 'note' }, 'No variants. A variant runs the same project with other fragments, another loop script or other constants; ',
        'the run bar then gets a Variant picker, and a campaign suite can compare variants on the same instances.'));
    }
    if (this.list.length) {
      // the Campaign tab compares variants on many instances; it is shown only in Advanced mode
      const open = el('a', { href: '#', id: 'variants-campaign-link', onclick: (e) => {
        e.preventDefault();
        if (this.app.showTabs) this.app.showTabs('advanced', true, { store: false });
        const t = document.getElementById('tab10');
        if (t) { t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); }
      } }, 'Campaign tab');
      this.root.append(el('p', { class: 'note' }, 'To compare the variants on many instances (a table per instance and variant, plots, CSV), use the ', open,
        ' (an Advanced tab; this link shows it for this visit).'));
    }
    this.list.forEach((v, i) => this.root.append(this.card(v, i, fragments)));
    this.root.append(el('p', { class: 'inline-controls' },
      el('button', { class: 'control-button', id: 'add-variant-button', onclick: () => this.add() }, '+ Add variant')));
    this.setReadOnly(this.readOnly);
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
      this.changed();
    });
    const swap = el('input', { type: 'text', value: showPairs(v.swap), class: 'variant-swap', placeholder: 'check=check_alt, relevant=relevant_s3',
      'aria-label': `Swap of variant ${v.name}` });
    swap.addEventListener('change', () => {
      let map;
      try { map = parsePairs(swap.value); } catch (e) { return fail(`Swap: ${e.message}.`); }
      const bad = Object.entries(map).flat().filter((n) => !fragments.includes(n));
      if (bad.length) return fail(`Swap: no fragment named ${bad.join(', ')}.`);
      v.swap = map;
      ok();
      this.changed();
    });
    const consts = el('input', { type: 'text', value: showPairs(v.constants), class: 'variant-constants', placeholder: 'n=5',
      'aria-label': `Constants of variant ${v.name}` });
    consts.addEventListener('change', () => {
      try { v.constants = parsePairs(consts.value); } catch (e) { return fail(`Constants: ${e.message}.`); }
      ok();
      this.changed();
    });
    const own = el('input', { type: 'checkbox', class: 'variant-own-loop', 'aria-label': `Variant ${v.name} has its own loop script` });
    own.checked = !!v.loop;
    const text = el('textarea', { class: 'variant-loop', rows: 8, spellcheck: 'false', 'aria-label': `Loop script of variant ${v.name}` });
    text.value = v.loop ? v.loop.text : '';
    text.hidden = !v.loop;
    own.addEventListener('change', () => {
      if (own.checked) v.loop = { language: this.app.project.loop.language, text: this.app.project.loop.text };
      else delete v.loop;
      text.value = v.loop ? v.loop.text : '';
      text.hidden = !v.loop;
      this.changed();
    });
    text.addEventListener('change', () => { if (v.loop) { v.loop = { ...v.loop, text: text.value }; this.changed(); } });
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
        el('span', { class: 'note' }, 'starts as a copy of the project\'s loop script')),
      text);
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
