// The example library on Home (examples/library.json): the groups, the entries with their
// Load and Copy link buttons, and the filter. The click handlers (Load, Copy link) stay in
// js/init.js, which owns loading a project.
import { h as make, $ } from './dom.js';
import { plural } from './util.js';

// A link that opens example <id>.
export const exampleLink = (id) => `${location.origin}${location.pathname}?example=${encodeURIComponent(id)}`;

// lib: the manifest (or null when it did not load); app.exampleId marks the loaded entry;
// guidePage: a test of a guide page path (the entry's "Guide page" link).
export function buildLibrary(lib, app, guidePage) {
  const box = $('library');
  if (!lib) { box.innerHTML = '<p class="error-text">The example library could not be loaded.</p>'; return; }
  box.textContent = '';
  // a Projects group first (FUTURE-DIRECTIONS E3): the examples with a readme (tag "project"),
  // also listed in their own group
  const projects = { id: 'projects', title: 'Projects', description: 'Examples with a readme: a research question, a baseline and things to try (shown under the project title once loaded).' };
  for (const g of [projects, ...lib.groups]) {
    const entries = lib.examples.filter((e) => (g === projects ? (e.tags || []).includes('project') : e.group === g.id));
    if (!entries.length) continue;
    const det = make('details', { class: 'library-group', 'data-group': g.id });
    det.open = false;
    det.append(make('summary', {}, make('span', { class: 'library-group-title' }, g.title), ' ',
      make('span', { class: 'note' }, `${entries.length} · ${g.description}`)));
    const list = make('ul', { class: 'library-list' });
    for (const e of entries) list.append(entry(e, g, guidePage));
    det.append(list);
    box.append(det);
  }
  markLoadedExample(app);
  filterLibrary();
}

function entry(e, g, guidePage) {
  const has = e.has || {};
  const tags = [e.shape !== 'custom' ? e.shape : null, ...e.tags,
    has.instances ? plural(has.instances, 'instance') : null, has.generators ? plural(has.generators, 'generator') : null,
    has.suites ? plural(has.suites, 'suite') : null, has.views ? 'view' : null, has.readme ? 'readme' : null].filter(Boolean);
  if (e.level) tags.push(`level ${e.level}`);
  if (e.after) tags.push(`after chapter ${e.after}`);
  const li = make('li', { class: 'library-entry', 'data-example': e.id, 'data-level': String(e.level || ''), 'data-after': String(e.after || 0),
    'data-search': [e.id, e.title, e.summary, ...tags, g.title].join(' ').toLowerCase() });
  const text = make('div', { class: 'library-text' },
    make('span', { class: 'library-title' }, e.title), ' ',
    make('code', { class: 'library-id' }, e.id),
    ...tags.map((t) => make('span', { class: 'library-tag' }, t)),
    make('div', { class: 'library-summary' }, e.summary +
      (e.expected && Number.isInteger(e.expected.solutions) ? ` Solutions: ${e.expected.solutions.toLocaleString('en')}.` : '') +
      (e.expected && e.expected.optimum != null ? ` Optimum: ${[e.expected.optimum].flat().join(' ')}.` : ''),
      ...(e.page && guidePage.test(e.page)
        ? [make('a', { class: 'library-guide-link', href: e.page, target: 'cegarplay-guide' }, 'Guide page')] : [])));
  const load = make('button', { class: 'control-button small-button', 'data-load-example': e.id }, 'Load');
  const copy = make('button', { class: 'control-button small-button library-copy', 'data-copy-example': e.id, title: exampleLink(e.id) }, 'Copy link');
  li.append(text, make('div', { class: 'library-buttons' }, load, copy));
  return li;
}

export function markLoadedExample(app) {
  for (const li of document.querySelectorAll('.library-entry')) li.classList.toggle('loaded', li.dataset.example === app.exampleId);
}

export function filterLibrary() {
  const words = $('library-filter').value.toLowerCase().split(/\s+/).filter(Boolean);
  const level = $('library-level').value, read = $('library-read').value;
  const narrowed = words.length || level || read;
  for (const det of document.querySelectorAll('.library-group')) {
    let shown = 0;
    for (const li of det.querySelectorAll('.library-entry')) {
      // level: exactly this level; read: the guide chapter to read first is one already read
      const ok = words.every((w) => li.dataset.search.includes(w)) && (!level || li.dataset.level === level) &&
        (read === '' || Number(li.dataset.after) <= Number(read));
      li.hidden = !ok;
      if (ok) shown++;
    }
    det.hidden = shown === 0;
    if (narrowed && shown) det.open = true;
  }
}

export function wireLibraryFilter() {
  $('library-filter').addEventListener('input', filterLibrary);
  for (const id of ['library-level', 'library-read']) $(id).addEventListener('change', filterLibrary);
}
