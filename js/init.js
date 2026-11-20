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

app.setProject = (p) => {
  app.project = p;
  app.editors.build(p);
  app.loopTab.load(p);
  app.stats.history = Array.isArray(p.runs) ? p.runs.map((r) => ({ ...r })) : [];
  app.stats.renderHistory();
  $('project-heading').textContent = p.title || 'Untitled';
  $('project-description').textContent = p.description || '';
  document.title = p.title ? `CegarPlay · ${p.title}` : 'CegarPlay';
};
app.projectChanged = () => {};

function status(id, text, error = false) {
  const e = $(id);
  e.textContent = text;
  e.classList.toggle('error', error);
}

async function loadExample(name) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`invalid example name ${name}`);
  const r = await fetch(`examples/${name}.json`);
  if (!r.ok) throw new Error(`examples/${name}.json: ${r.status} ${r.statusText}`);
  app.setProject(Project.load(await r.text()));
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

// ---- Control tab ----------------------------------------------------------------
$('load-button').addEventListener('click', async () => {
  if (!guard()) return;
  const name = $('example-select').value;
  try { await loadExample(name); status('load-status', `Loaded example "${app.project.title}".`); }
  catch (e) { status('load-status', String(e.message || e), true); }
});

$('file-input').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f || !guard()) return;
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
  if (!f || !guard()) return;
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
}

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
  try { await loadExample(file); status('load-status', `Loaded example "${app.project.title}".`); }
  catch (e) { status('load-status', String(e.message || e), true); app.setProject(Project.newProject()); }
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
