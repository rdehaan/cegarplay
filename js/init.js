// Start-up: build the page, load the project, URL parameters.
import { Engine } from './engine.js';
import * as Project from './project.js';
import { Editors } from './editors.js';
import { Output } from './output.js';
import { Stats } from './stats.js';
import { Control } from './control.js';
import { LoopTab } from './loop-tab.js';
import { Internals } from './internals.js';
import { makeEditor } from './editors.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const app = { ready: false, project: Project.newProject() };
window.cegarplay = app;

// Internals tab only with ?internals=true
if (params.get('internals') !== 'true') {
  $('tab7').style.display = 'none';
  document.querySelector('label[for="tab7"]').style.display = 'none';
}
const tab = params.get('tab');
if (tab && /^[1-7]$/.test(tab) && (tab !== '7' || params.get('internals') === 'true')) $('tab' + tab).checked = true;

app.engine = new Engine({ threads: false });
app.editors = new Editors(app);
app.output = new Output(app);
app.stats = new Stats(app);
app.loopTab = new LoopTab(app);
app.internals = new Internals(app);
app.control = new Control(app);

app.collect = () => app.editors.collect(app.project);

app.setProject = (p, { save = true } = {}) => {
  app.project = p;
  app.editors.build(p);
  app.loopTab.load(p);
  app.stats.history = Array.isArray(p.runs) ? p.runs.map((r) => ({ ...r })) : [];
  app.stats.renderHistory();
  $('project-heading').textContent = p.title || 'Untitled';
  $('project-description').textContent = p.description || '';
  document.title = p.title ? `CegarPlay · ${p.title}` : 'CegarPlay';
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
  try {
    const p = structuredClone(app.collect());
    p.runs = app.stats.history;
    localStorage.setItem(STORE_KEY, Project.save(p));
  } catch { /* storage unavailable or full */ }
}
// edit = false: save, but the project was not edited (e.g. the run history changed)
app.dirty = (edit = true) => {
  if (edit) { app.edited = true; app.saveBlocked = false; }
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

async function loadExample(name, opts) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`invalid example name ${name}`);
  const r = await fetch(`examples/${name}.json`);
  if (!r.ok) throw new Error(`examples/${name}.json: ${r.status} ${r.statusText}`);
  app.setProject(Project.load(await r.text()), opts);
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
$('load-button').addEventListener('click', async () => {
  if (!guard() || !replaceOk()) return;
  const name = $('example-select').value;
  try { await loadExample(name); status('load-status', `Loaded example "${app.project.title}".`); }
  catch (e) { status('load-status', String(e.message || e), true); }
});

$('new-button').addEventListener('click', () => {
  if (!guard() || !replaceOk()) return;
  app.setProject(Project.starterProject());
  status('new-status', 'Started a new project. See the Programs tab.');
});

$('file-input').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f || !guard() || !replaceOk()) return;
  try { app.setProject(Project.load(await f.text())); status('upload-status', `Loaded ${f.name}.`); }
  catch (e) { status('upload-status', `${f.name}: ${e.message || e}`, true); }
});

$('download-button').addEventListener('click', () => {
  const p = structuredClone(app.collect());
  p.runs = $('include-history').checked ? app.stats.history : [];
  download(slug(p.title) + '.json', Project.save(p));
});

$('lp-input').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f || !guard() || !replaceOk()) return;
  try {
    const p = Project.importLp(await f.text(), f.name.replace(/\.lp$/, ''));
    p.description = `Imported from ${f.name}.`;
    app.setProject(p);
    const legacy = /\blegacy\b/.test(p.loop.text);
    status('import-status', `Imported ${f.name}` + (legacy ? ' (no glue(...) atoms found: the link uses legacy).' : '.'));
  } catch (e) { status('import-status', `${f.name}: ${e.message || e}`, true); }
});

$('export-lp-button').addEventListener('click', () => {
  const p = app.collect();
  try { download(slug(p.title) + '.lp', Project.exportLp(p), 'text/plain'); status('export-status', 'Exported as .lp.'); }
  catch (e) { status('export-status', e.message || String(e), true); }
});

$('export-standalone-button').addEventListener('click', () => {
  const p = app.collect();
  try { download(slug(p.title) + '-standalone.lp', Project.exportStandalone(p, app.runtime), 'text/plain'); status('export-status', 'Exported the standalone program (run it with: clingo file.lp --outf=3).'); }
  catch (e) { status('export-status', e.message || String(e), true); }
});

// ---- Instructions tab -----------------------------------------------------------------
async function loadInstructions() {
  const box = $('instructions');
  try {
    const r = await fetch('instructions.html');
    if (!r.ok) throw new Error(r.statusText);
    box.innerHTML = await r.text();
  } catch {
    box.innerHTML = '<p>The instructions could not be loaded.</p>';
    return;
  }
  for (const el of box.querySelectorAll('.example-code')) {
    const mode = el.dataset.mode === 'loop' ? 'ace/mode/loop' : el.dataset.mode === 'lua' ? 'ace/mode/lua' : 'ace/mode/gringo';
    el.textContent = el.textContent.replace(/^\n/, '').replace(/\s+$/, '');
    const ed = makeEditor(el, mode, { readOnly: true });
    ed.setOptions({ minLines: 1, highlightActiveLine: false, highlightGutterLine: false });
    ed.renderer.$cursorLayer.element.style.display = 'none';
  }
  requestAnimationFrame(resizeVisibleEditors);
}

// ---- tabs ---------------------------------------------------------------------------
// ACE editors built inside a hidden tab measure themselves wrongly; resize them when shown.
function resizeVisibleEditors() {
  for (const el of document.querySelectorAll('main > section .ace_editor')) {
    if (el.offsetParent !== null && el.env && el.env.editor) el.env.editor.resize(true);
  }
}
for (const r of document.querySelectorAll('input[name="tabs"]')) {
  r.addEventListener('change', () => requestAnimationFrame(resizeVisibleEditors));
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
async function start() {
  const [runtime, version] = await Promise.all([
    fetch('lua/runtime.lua').then((r) => r.text()),
    fetch('vendor/clingo-wasm/VERSION').then((r) => r.text()).catch(() => 'clingo-wasm'),
  ]);
  app.runtime = runtime;
  loadInstructions();
  app.engineVersion = version.split('\n')[0];
  const file = params.get('file') || 'graph-coloring';
  const stored = params.get('file') || params.get('fresh') === '1' ? null : storedProject();
  let restored = false;
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
    const save = !params.get('file') && params.get('fresh') !== '1' && !stored;
    try { await loadExample(file, { save }); status('load-status', `Loaded example "${app.project.title}".`); }
    catch (e) { status('load-status', String(e.message || e), true); app.setProject(Project.newProject(), { save: false }); }
  }
  app.restoredOrLoaded = true;
  const sel = $('example-select');
  if ([...sel.options].some((o) => o.value === file)) sel.value = file;
  await app.engine.ready;
  app.ready = true;
  app.internals.facts();
  app.control.setState('idle');
  document.body.dataset.ready = 'true';
}
let leaving = false;
addEventListener('pagehide', () => { leaving = true; });
addEventListener('beforeunload', () => { leaving = true; });
start().catch((e) => {
  if (leaving) return;            // e.g. the isolation shim reloads the page during start-up
  console.error(e);
  status('load-status', 'Start-up failed: ' + (e.message || e), true);
});
