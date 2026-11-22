// Start-up: build the page, load the project, URL parameters.
import { Engine } from './engine.js';
import * as Project from './project.js';
import { Editors } from './editors.js';
import { Output } from './output.js';
import { Stats } from './stats.js';
import { Control } from './control.js';
import { LoopTab } from './loop-tab.js';
import { Internals } from './internals.js';
import { InstancesTab } from './instances-tab.js';
import { Recording, REPLAY_PATTERN } from './recording.js';
import { makeEditor } from './editors.js';
import { Anatomy } from './anatomy.js';
import { CampaignTab } from './campaign-tab.js';
import { ViewPanel } from './view-panel.js';
import { SpaceView } from './space-view.js';
import { Cursor, bindKeys } from './cursor.js';
import { ObservatoryBar, lectureMode } from './observatory.js';
import { renderMarkdown } from './markdown.js';
import { encodeShare, decodeShare, shareData, SHARE_PREFIX, LONG_LINK } from './share.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const app = { ready: false, project: Project.newProject() };
window.cegarplay = app;

// ---- the address bar: ?example=<id> and ?tab=N follow the page (replaceState, no history entries)
const KEEP_PARAMS = ['nocoi', 'manual', 'internals', 'from', 'tab', 'instance', 'replay', 'view', 'step', 'lecture'];
function setUrl({ example, tab, keepHash = false } = {}) {
  const now = new URLSearchParams(location.search);
  const next = new URLSearchParams();
  if (example) next.set('example', example);
  for (const k of KEEP_PARAMS) if (now.has(k)) next.set(k, now.get(k));
  if (tab !== undefined) { if (tab) next.set('tab', tab); else next.delete('tab'); }
  const q = next.toString();
  const hash = keepHash ? location.hash : '';
  try { history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + hash); } catch { /* sandboxed */ }
}
// The project is no longer the one the URL names (edited, or replaced by a file or a new project).
function urlForgetProject() {
  const now = new URLSearchParams(location.search);
  if (now.has('example') || now.has('file') || now.has('fragment') || shareData(location.hash) !== null) setUrl({});
}

// Internals tab only with ?internals=true
if (params.get('internals') !== 'true') {
  $('tab7').style.display = 'none';
  document.querySelector('label[for="tab7"]').style.display = 'none';
}
// ---- the technical manual (tab 8): hidden unless the toggle is on or ?manual=true ---------
const MANUAL_KEY = 'cegarplay.manual';
const manualForced = params.get('manual') === 'true';
let manualLoading = null;     // the promise of the rendered manual
function manualStored() {
  try { return localStorage.getItem(MANUAL_KEY) === '1'; } catch { return false; }
}
function showManual(on, { store = true } = {}) {
  if (store) {
    try { if (on) localStorage.setItem(MANUAL_KEY, '1'); else localStorage.removeItem(MANUAL_KEY); } catch { /* no storage */ }
  }
  const visible = on || manualForced;
  $('tab8').hidden = !visible;
  $('label-manual').hidden = !visible;
  for (const c of document.querySelectorAll('.manual-checkbox')) c.checked = visible;
  if (!visible && $('tab8').checked) $('tab2').checked = true;
  if (visible) loadManual();
}
showManual(manualStored(), { store: false });
for (const c of document.querySelectorAll('.manual-checkbox')) {
  c.addEventListener('change', () => showManual(c.checked));
}

// ?from=guide/<page>.html#<anchor>: a link back to the guide page that opened this example.
// Only a guide page of this site is accepted, never an arbitrary URL.
const FROM_PATTERN = /^guide\/[a-z0-9-]+\.html(#[a-z0-9-]+)?$/;
{
  const from = params.get('from');
  if (from && FROM_PATTERN.test(from)) {
    $('back-to-guide').href = from;
    $('back-to-guide').hidden = false;
  }
}

const tab = params.get('tab');
if (tab && /^([1-9]|1[01])$/.test(tab) && $('tab' + tab) && (tab !== '7' || params.get('internals') === 'true') && !$('tab' + tab).hidden) $('tab' + tab).checked = true;

app.engine = new Engine({ threads: false });
app.editors = new Editors(app);
app.output = new Output(app);
app.stats = new Stats(app);
app.loopTab = new LoopTab(app);
app.internals = new Internals(app);
app.control = new Control(app);
app.instancesTab = new InstancesTab(app);
app.cursor = new Cursor();
bindKeys(app.cursor, () => $('tab11').checked || document.body.classList.contains('lecture'));
app.anatomy = new Anatomy(app, $('anatomy'));
app.campaign = new CampaignTab(app);
app.views = new ViewPanel(app, $('domain-view'));
app.space = new SpaceView(app, $('candidate-space'));
app.observatory = new ObservatoryBar(app, $('cursor-region'));

app.collect = () => app.editors.collect(app.project);
app.genLua = () => ({ draw: app.modules.draw, generate: app.modules.generate });

function showProjectInfo(p) {
  $('project-heading').textContent = p.title || 'Untitled';
  $('project-description').textContent = p.description || '';
  document.title = p.title ? `CegarPlay · ${p.title}` : 'CegarPlay';
}
function editProjectInfo(on) {
  $('project-info').hidden = on;
  $('project-form').hidden = !on;
  if (!on) return;
  $('project-title-input').value = app.project.title || '';
  $('project-description-input').value = app.project.description || '';
  $('project-title-input').focus();
}
function saveProjectInfo() {
  app.project.title = $('project-title-input').value.trim() || 'Untitled';
  app.project.description = $('project-description-input').value.trim();
  showProjectInfo(app.project);
  editProjectInfo(false);
  app.dirty();
}
$('edit-project-button').addEventListener('click', () => editProjectInfo(true));
$('save-project-info').addEventListener('click', saveProjectInfo);
$('cancel-project-info').addEventListener('click', () => editProjectInfo(false));
$('project-form').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') editProjectInfo(false);
  else if (e.key === 'Enter' && e.target.id === 'project-title-input') { e.preventDefault(); saveProjectInfo(); }
});

app.setProject = (p, { save = true } = {}) => {
  app.project = p;
  app.exampleId = null;         // set by loadExample
  markLoadedExample();
  // the results of an earlier run belong to the earlier project
  app.output.clear();
  app.stats.reset();
  app.control.runMessage('');
  app.control.setState('idle');
  app.editors.clearAnnotations();
  app.editors.build(p);
  app.loopTab.load(p);
  app.instancesTab.load();
  app.anatomy.load();
  app.campaign.load();
  app.views.load();
  app.stats.history = Array.isArray(p.runs) ? p.runs.map((r) => ({ ...r })) : [];
  app.stats.renderHistory();
  showProjectInfo(p);
  editProjectInfo(false);
  requestAnimationFrame(() => app.resizeVisibleEditors());
  app.saveBlocked = !save;      // until the first edit
  if (save) app.dirty();
  else if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  app.edited = false;           // set again by the first edit (editor change or input)
};

// ---- autosave in this browser ------------------------------------------------------
// The project being edited is kept in localStorage, so a reload or a closed tab does not
// lose it. Browser storage may be missing or full; then nothing is kept.
const STORE_KEY = 'cegarplay.project';
let saveTimer = null;
function saveNow() {
  saveTimer = null;
  if ((!app.ready && !app.restoredOrLoaded) || app.saveBlocked) return;
  let p;
  try { p = structuredClone(app.collect()); } catch { return; }
  // the run history is the part that grows: without it first, then say that nothing was kept
  let note = '';
  try {
    p.runs = app.stats.history;
    localStorage.setItem(STORE_KEY, Project.save(p));
  } catch {
    try {
      localStorage.setItem(STORE_KEY, Project.save(p, { runs: false }));
      if (p.runs && p.runs.length) note = 'Kept in this browser without the run history: storage is full. Download the project with its history to keep that.';
    } catch {
      note = 'Not kept in this browser: storage is full or unavailable; download the project to keep it.';
    }
  }
  const e = $('storage-status');
  e.textContent = note;
  e.hidden = !note;
}
// edit = false: save, but the project was not edited (e.g. the run history changed)
app.dirty = (edit = true) => {
  if (edit) {
    if (app.restoredOrLoaded) urlForgetProject();
    app.edited = true; app.saveBlocked = false;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
};
app.projectChanged = () => app.dirty();
for (const ev of ['input', 'change']) {
  document.querySelector('main').addEventListener(ev, (e) => {
    if (e.target.closest && e.target.closest('#section-programs, #section-loop, .run-bar')) app.dirty();
  }, true);
}
addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); saveNow(); } });
function storedProject() {
  try {
    const t = localStorage.getItem(STORE_KEY);
    return t ? Project.load(t) : null;
  } catch { return null; }
}

function status(id, text, error = false) {
  const e = $(id);
  e.textContent = text;
  e.classList.toggle('error', error);
}

app.loadExample = (name, opts) => loadExample(name, opts);
async function loadExample(name, opts, { url = false } = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`invalid example name ${name}`);
  const r = await fetch(`examples/${name}.json`);
  if (!r.ok) {
    const lib = await app.library;
    const known = lib && lib.examples.some((e) => e.id === name);
    throw new Error(known ? `examples/${name}.json: ${r.status} ${r.statusText}`
      : `there is no example "${name}" in the library${lib ? ` (known: ${lib.examples.map((e) => e.id).join(', ')})` : ''}`);
  }
  app.setProject(Project.load(await r.text()), opts);
  app.exampleId = name;
  // precomputed frames of its views (tools/make-replays.mjs): a replay shows a picture before
  // the engine has loaded
  if ((app.project.views || []).length) {
    try { const v = await fetch(`examples/views/${name}.json`); if (v.ok) app.views.prefill(await v.json()); } catch { /* computed on demand */ }
  }
  markLoadedExample();
  if (url) setUrl({ example: name });
}

// ---- the example library (examples/library.json) ------------------------------------
app.library = fetch('examples/library.json').then((r) => {
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}).catch(() => null);

const exampleLink = (id) => `${location.origin}${location.pathname}?example=${encodeURIComponent(id)}`;
const make = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
};

async function buildLibrary() {
  const box = $('library');
  const lib = await app.library;
  if (!lib) { box.innerHTML = '<p class="error-text">The example library could not be loaded.</p>'; return; }
  box.textContent = '';
  for (const g of lib.groups) {
    const entries = lib.examples.filter((e) => e.group === g.id);
    if (!entries.length) continue;
    const det = make('details', { class: 'library-group', 'data-group': g.id });
    det.open = false;
    det.append(make('summary', {}, make('span', { class: 'library-group-title' }, g.title), ' ',
      make('span', { class: 'note' }, `${entries.length} · ${g.description}`)));
    const list = make('ul', { class: 'library-list' });
    for (const e of entries) {
      const tags = [e.shape !== 'custom' ? e.shape : null, ...e.tags].filter(Boolean);
      const li = make('li', { class: 'library-entry', 'data-example': e.id,
        'data-search': [e.id, e.title, e.summary, e.shape, ...e.tags, g.title].join(' ').toLowerCase() });
      const text = make('div', { class: 'library-text' },
        make('span', { class: 'library-title' }, e.title), ' ',
        make('code', { class: 'library-id' }, e.id),
        ...tags.map((t) => make('span', { class: 'library-tag' }, t)),
        make('div', { class: 'library-summary' }, e.summary +
          (e.expected ? ` Solutions: ${e.expected.solutions.toLocaleString('en')}.` : ''),
          ...(e.page && FROM_PATTERN.test(e.page)
            ? [make('a', { class: 'library-guide-link', href: e.page, target: 'cegarplay-guide' }, 'Guide page')] : [])));
      const load = make('button', { class: 'control-button small-button', 'data-load-example': e.id }, 'Load');
      const copy = make('button', { class: 'control-button small-button library-copy', 'data-copy-example': e.id, title: exampleLink(e.id) }, 'Copy link');
      li.append(text, make('div', { class: 'library-buttons' }, load, copy));
      list.append(li);
    }
    det.append(list);
    box.append(det);
  }
  markLoadedExample();
  filterLibrary();
}
function markLoadedExample() {
  for (const li of document.querySelectorAll('.library-entry')) li.classList.toggle('loaded', li.dataset.example === app.exampleId);
}
function filterLibrary() {
  const words = $('library-filter').value.toLowerCase().split(/\s+/).filter(Boolean);
  for (const det of document.querySelectorAll('.library-group')) {
    let shown = 0;
    for (const li of det.querySelectorAll('.library-entry')) {
      const ok = words.every((w) => li.dataset.search.includes(w));
      li.hidden = !ok;
      if (ok) shown++;
    }
    det.hidden = shown === 0;
    if (words.length && shown) det.open = true;
  }
}
$('library-filter').addEventListener('input', filterLibrary);

// Load an example from any element with data-load-example (library, tutorial, manual);
// data-tab="N" then opens tab N.
document.addEventListener('click', async (ev) => {
  const copyBtn = ev.target.closest && ev.target.closest('[data-copy-example]');
  if (copyBtn) {
    const link = exampleLink(copyBtn.dataset.copyExample);
    try { await navigator.clipboard.writeText(link); status('load-status', `Copied the link ${link}`); }
    catch { status('load-status', `Link: ${link}`); }
    return;
  }
  const btn = ev.target.closest && ev.target.closest('[data-load-example]');
  if (!btn) return;
  ev.preventDefault();
  if (!guard() || !replaceOk()) return;
  const name = btn.dataset.loadExample;
  try {
    await loadExample(name, undefined, { url: true });
    status('load-status', `Loaded example "${app.project.title}".`);
    const t = btn.dataset.tab;
    if (t && $('tab' + t)) { $('tab' + t).checked = true; requestAnimationFrame(resizeVisibleEditors); }
    if (btn.closest('#section-tutorial, #section-manual')) flash(btn, `Loaded "${app.project.title}"`);
  } catch (e) {
    status('load-status', String(e.message || e), true);
    if (btn.closest('#section-tutorial, #section-manual')) flash(btn, String(e.message || e), true);
  }
});
// A short note next to a button outside the Control tab.
function flash(btn, text, error = false) {
  let n = btn.nextElementSibling;
  if (!n || !n.classList.contains('load-note')) { n = make('span', { class: 'load-note note' }); btn.after(n); }
  n.textContent = ' ' + text;
  n.classList.toggle('error-text', error);
}

function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const slug = (s) => (s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
const guard = () => {
  if (app.control.busy) { window.alert('Not possible during a run.'); return false; }
  return true;
};
// Before replacing a project that was edited.
const replaceOk = () => !app.edited || window.confirm('Replace the current project? Your changes to it are lost unless you download it first.');

// ---- Control tab ----------------------------------------------------------------
$('new-button').addEventListener('click', () => {
  if (!guard() || !replaceOk()) return;
  app.setProject(Project.starterProject());
  urlForgetProject();
  status('new-status', 'Started a new project. See the Programs tab.');
});

// ---- recordings: download the last run, open one and replay it
$('download-recording-button').addEventListener('click', async () => {
  if (!app.recording) return;
  const blob = await app.recording.toBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = slug(app.project.title) + '.cprec';
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});
$('open-recording-button').addEventListener('click', () => $('recording-input').click());
$('recording-input').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  try {
    const rec = await Recording.fromBlob(f);
    app.control.replay(rec);
    status('recording-status', `Replayed ${f.name}: ${rec.steps.length} steps, ${rec.calls.length} calls, ${rec.solutions.length} solutions.`);
  } catch (e) { status('recording-status', `${f.name}: ${e.message || e}`, true); }
});
async function openReplay(path) {
  if (!REPLAY_PATTERN.test(path)) { status('load-status', `The replay "${path}" is not a file of examples/replays/; ignored.`, true); return; }
  try {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rec = await Recording.fromBlob(await r.blob());
    const ex = rec.header.example;
    if (ex && app.exampleId !== ex && /^[A-Za-z0-9_-]+$/.test(ex)) await loadExample(ex, { save: false });
    app.control.replay(rec);
    status('load-status', `Replayed ${path} (${rec.steps.length} steps) without the engine.`);
  } catch (e) { status('load-status', `The replay ${path} could not be opened: ${e.message || e}`, true); }
}

$('file-button').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f || !guard() || !replaceOk()) return;
  try { app.setProject(Project.load(await f.text())); urlForgetProject(); status('upload-status', `Loaded ${f.name}.`); }
  catch (e) { status('upload-status', `${f.name}: ${e.message || e}`, true); }
});

$('download-button').addEventListener('click', () => {
  const p = structuredClone(app.collect());
  p.runs = $('include-history').checked ? app.stats.history : [];
  download(slug(p.title) + '.json', Project.save(p));
});

$('share-button').addEventListener('click', async () => {
  try {
    const data = await encodeShare(structuredClone(app.collect()));
    const link = `${location.origin}${location.pathname}${SHARE_PREFIX}${data}`;
    const long = link.length > LONG_LINK ? ` It is ${link.length.toLocaleString('en')} characters long: some mail and chat programs cut links that long; download the project file instead.` : '';
    try { await navigator.clipboard.writeText(link); status('share-status', `Copied a share link for "${app.project.title || 'Untitled'}".${long}`, !!long); }
    catch { status('share-status', `Share link (copy it by hand): ${link}`, !!long); }
  } catch (e) { status('share-status', `No share link: ${e.message || e}`, true); }
});

$('export-standalone-button').addEventListener('click', () => {
  const p = app.collect();
  try { download(slug(p.title) + '-standalone.lp', Project.exportStandalone(p, app.runtime, app.modules), 'text/plain'); status('export-status', 'Exported the standalone program (run it with: clingo file.lp --outf=3).'); }
  catch (e) { status('export-status', e.message || String(e), true); }
});

// Read-only ACE editors for the .example-code blocks of the Tutorial and the Manual.
function codeBlocks(box) {
  for (const el of box.querySelectorAll('.example-code')) {
    const mode = el.dataset.mode === 'loop' ? 'ace/mode/loop' : el.dataset.mode === 'lua' ? 'ace/mode/lua' : 'ace/mode/gringo';
    el.textContent = el.textContent.replace(/^\n/, '').replace(/\s+$/, '');
    const ed = makeEditor(el, mode, { readOnly: true });
    ed.setOptions({ minLines: 1, highlightActiveLine: false, highlightGutterLine: false });
    ed.renderer.$cursorLayer.element.style.display = 'none';
  }
  requestAnimationFrame(resizeVisibleEditors);
}

// ---- Manual tab -----------------------------------------------------------------------
function loadManual() {
  if (!manualLoading) manualLoading = buildManual();
  return manualLoading;
}
async function buildManual() {
  const box = $('manual');
  let text;
  try {
    const r = await fetch('manual.md');
    if (!r.ok) throw new Error(r.statusText);
    text = await r.text();
  } catch {
    box.innerHTML = '<p class="error-text">The manual could not be loaded.</p>';
    return;
  }
  const headings = [];
  box.innerHTML = renderMarkdown(text, { headings });
  // contents: the second-level headings, with their third-level headings
  const toc = make('ol');
  let last = null;
  for (const h of headings) {
    if (h.level === 2) {
      last = make('li');
      last.innerHTML = `<a href="#${h.id}">${h.html}</a>`;
      toc.append(last);
    } else if (h.level === 3 && last) {
      let sub = last.querySelector('ol');
      if (!sub) { sub = make('ol'); last.append(sub); }
      const li = make('li');
      li.innerHTML = `<a href="#${h.id}">${h.html}</a>`;
      sub.append(li);
    }
  }
  $('manual-toc').textContent = '';
  $('manual-toc').append(make('b', {}, 'Contents'), toc);
  codeBlocks(box);
}
// Links to #manual-<slug> (from the Tutorial, the modals or the Manual itself) open the Manual
// tab, turning it on if needed, and scroll to that section.
document.addEventListener('click', async (ev) => {
  const a = ev.target.closest && ev.target.closest('a[href^="#manual-"]');
  if (!a) return;
  ev.preventDefault();
  const modal = a.closest('.modal');
  if (modal) modal.classList.remove('is-visible');
  if ($('tab8').hidden) showManual(true);
  await loadManual();
  $('tab8').checked = true;
  requestAnimationFrame(() => {
    resizeVisibleEditors();
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (target) target.scrollIntoView({ block: 'start' });
  });
});

// ---- Tutorial tab ---------------------------------------------------------------------
async function loadTutorial() {
  const box = $('tutorial');
  try {
    const r = await fetch('tutorial.html');
    if (!r.ok) throw new Error(r.statusText);
    box.innerHTML = await r.text();
  } catch {
    box.innerHTML = '<p>The tutorial could not be loaded.</p>';
    return;
  }
  codeBlocks(box);
}

// ---- tabs ---------------------------------------------------------------------------
// ACE editors built inside a hidden tab measure themselves wrongly; resize them when shown.
function resizeVisibleEditors() {
  for (const el of document.querySelectorAll('main > section .ace_editor')) {
    if (el.offsetParent !== null && el.env && el.env.editor) el.env.editor.resize(true);
  }
}
for (const r of document.querySelectorAll('input[name="tabs"]')) {
  r.addEventListener('change', () => {
    requestAnimationFrame(resizeVisibleEditors);
    if (r.checked && r.id === 'tab10') requestAnimationFrame(() => app.campaign.draw());
    if (r.checked && r.id === 'tab11') requestAnimationFrame(() => { app.anatomy.dirty = { diagram: true, timeline: true, table: true }; app.anatomy.render(); app.views.updateSteps(); app.views.show(); });
    if (r.checked) setUrl({ example: new URLSearchParams(location.search).get('example'), tab: r.id === 'tab1' ? '' : r.id.slice(3), keepHash: true });
  });
}
app.resizeVisibleEditors = resizeVisibleEditors;

// Ctrl+Enter (Cmd+Enter) runs, from anywhere on the page, also inside an editor.
addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!app.control.busy && app.ready) app.control.run();
  }
}, true);

// ---- start ------------------------------------------------------------------------
// What a first visit opens with: small and fast (graph-coloring stays in the library).
const DEFAULT_EXAMPLE = 'tutorial-first-run';
async function start() {
  const [runtime, audit, ground, draw, generate, replayLua, version] = await Promise.all([
    fetch('lua/runtime.lua').then((r) => r.text()),
    fetch('lua/audit.lua').then((r) => r.text()),
    fetch('lua/ground.lua').then((r) => r.text()),
    fetch('lua/draw.lua').then((r) => r.text()),
    fetch('lua/generate.lua').then((r) => r.text()),
    fetch('lua/replay.lua').then((r) => r.text()),
    fetch('vendor/clingo-wasm/VERSION').then((r) => r.text()).catch(() => 'clingo-wasm'),
  ]);
  app.runtime = runtime;
  app.modules = { audit, ground, draw, generate, replay: replayLua };
  loadTutorial();
  app.engineVersion = version.split('\n')[0];
  // ?example=<id> (or the older ?file=<id>) loads an example of the library
  const named = params.get('example') || params.get('file');
  const file = named || DEFAULT_EXAMPLE;
  const shared = shareData(location.hash);
  const stored = named || shared !== null || params.get('fresh') === '1' ? null : storedProject();
  let restored = false, shareError = null;
  if (shared !== null) {
    // #p=<data>: like ?example=, it does not replace the kept project until it is edited
    try {
      app.setProject(await decodeShare(shared), { save: false });
      restored = true;
      status('load-status', `Opened "${app.project.title || 'Untitled'}" from a share link. It is kept in this browser once you edit it.`);
    } catch (e) {
      shareError = `The share link could not be opened: ${e.message || e}`;
    }
  }
  if (stored) {
    try {
      app.setProject(stored);
      app.edited = true;
      restored = true;
      status('load-status', `Restored "${stored.title || 'Untitled'}", the project you were editing in this browser. Load an example to start over.`);
    } catch (e) {
      console.warn('the project kept in the browser could not be restored:', e);
    }
  }
  if (!restored) {
    // A project named in the URL does not replace the one kept in the browser until it is edited.
    const save = !named && shared === null && params.get('fresh') !== '1' && !stored;
    try { await loadExample(file, { save }); status('load-status', `Loaded example "${app.project.title}".`); }
    catch (e) { status('load-status', String(e.message || e), true); app.setProject(Project.newProject(), { save: false }); }
    if (shareError) status('load-status', `${shareError}. Opened the example "${app.project.title}" instead.`, true);
  }
  if (named && !restored && app.exampleId === named && params.get('fragment')) openFragment(params.get('fragment'));
  // ?instance=<id>: the instance the run bar picks (not saved until an edit)
  const wantInstance = params.get('instance');
  if (wantInstance !== null) {
    if ((app.project.instances || []).some((x) => x.id === wantInstance)) {
      app.project.settings.instance = wantInstance;
      app.instancesTab.load();
    } else status('load-status', `The project has no instance "${wantInstance}"; the link's instance= is ignored.`);
  }
  // ?replay=examples/replays/<id>.cprec: its example (when the recording names one) and the replay
  const replay = params.get('replay');
  if (replay !== null) await openReplay(replay);
  // ?view=<name>&step=N: that view at that step (after a replay or a run); ?lecture=1
  if (params.get('lecture') === '1') lectureMode(app);
  const wantView = params.get('view'), wantStep = params.get('step');
  if (wantView && (app.project.views || []).some((v) => v.name === wantView)) { app.views.select.value = wantView; app.views.current = wantView; app.views.resetScene(); }
  if (wantStep !== null && /^\d+$/.test(wantStep)) app.cursor.setByStep(Number(wantStep));
  if (wantView || wantStep !== null) { $('tab11').checked = true; requestAnimationFrame(() => app.views.show()); }
  app.restoredOrLoaded = true;
  // nothing kept in this browser: show the library open
  if (!stored && !named && shared === null) $('library-section').open = true;
  buildLibrary();
  await app.engine.ready;
  // the clingo version, for the footer (the engine is idle here: nothing else runs yet)
  try {
    const v = await app.engine.exec('', '--version');
    const m = /clingo version (\S+)/.exec((v.out || []).join('\n'));
    if (m) app.clingoVersion = m[1];
  } catch { /* the footer keeps its generic text */ }
  $('footer-engine').textContent = `clingo ${app.clingoVersion || ''} via ${app.engineVersion}`.replace('  ', ' ');
  app.ready = true;
  app.internals.facts();
  app.control.setState(app.control.state === 'replayed' ? 'replayed' : 'idle');
  document.body.dataset.ready = 'true';
}
// ?fragment=<name>: open the Programs tab on that fragment's editor; "loop" opens the Loop tab.
function openFragment(name) {
  if (name === 'loop') {
    $('tab4').checked = true;
    requestAnimationFrame(() => { resizeVisibleEditors(); app.editors.loop.focus(); });
    return;
  }
  const f = app.editors.fragments.get(name);
  if (!f) {
    status('load-status', `Loaded example "${app.project.title}". It has no fragment "${name}"; the link's fragment= is ignored.`);
    return;
  }
  $('tab3').checked = true;
  requestAnimationFrame(() => {
    resizeVisibleEditors();
    f.block.scrollIntoView({ block: 'start' });
    f.block.classList.add('fragment-target');
    f.editor.focus();
  });
}

let leaving = false;
addEventListener('pagehide', () => { leaving = true; });
addEventListener('beforeunload', () => { leaving = true; });
start().catch((e) => {
  if (leaving) return;            // e.g. the isolation shim reloads the page during start-up
  console.error(e);
  status('load-status', 'Start-up failed: ' + (e.message || e), true);
});
