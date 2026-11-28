// Start-up: build the page, load the project, URL parameters.
import { Engine } from './engine.js';
import * as Project from './project.js';
import { Editors } from './editors.js';
import { Output } from './output.js';
import { fmt as fmtNum, escapeHtml as escHtml } from './util.js';
import { Stats } from './stats.js';
import { verdictText } from './compare.js';
import { Control } from './control.js';
import { LoopTab } from './loop-tab.js';
import { Internals } from './internals.js';
import { InstancesTab } from './instances-tab.js';
import { Variants } from './variants.js';
import { Recording, REPLAY_PATTERN, pairSteps } from './recording.js';
import { Anatomy } from './anatomy.js';
import { CampaignTab } from './campaign-tab.js';
import { ViewPanel } from './view-panel.js';
import { SpaceView } from './space-view.js';
import { Cursor, bindKeys } from './cursor.js';
import { ObservatoryBar, lectureMode } from './observatory.js';
import { renderMarkdown } from './markdown.js';
import { tabIndent } from './textarea-tab.js';
import { Workspace, WS_INDEX, WS_NAME } from './workspace.js';
import { Snapshots, SNAP_INDEX, projectKey } from './snapshots.js';
import { setupTopbar } from './topbar.js';
import { bindPageKeys, openShortcuts } from './keys.js';
import { Tour, TAB_TOURS } from './tour.js';
import { walkthroughSteps, walkthroughBegin, WALKTHROUGH_KEY } from './loop-walkthrough.js';
import { attachLoopTips, attachTooltip } from './loop-tips.js';
import { projectModel, lintProject, aspWordHelp } from './asp-scan.js';
import { loopCompletions, aspCompletions } from './completions.js';
import { encodeShare, decodeShare, shareData, SHARE_PREFIX, LONG_LINK } from './share.js';
import { h as make, $, download as saveFile } from './dom.js';
import { buildLibrary, markLoadedExample, wireLibraryFilter, exampleLink } from './library-ui.js';
import { codeBlocks, loadManual, loadTutorial, wireDocLinks } from './docs-tabs.js';

const params = new URLSearchParams(location.search);
setupTopbar();
const app = { ready: false, project: Project.newProject() };
window.cegarplay = app;

// ---- the address bar: ?example=<id> and ?tab=N follow the page (replaceState, no history entries)
const KEEP_PARAMS = ['nocoi', 'internals', 'from', 'tab', 'instance', 'replay', 'view', 'step', 'lecture'];
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
  if (now.has('example') || now.has('fragment') || shareData(location.hash) !== null) setUrl({});
}

// Internals tab only with ?internals=true (opened from the Project menu)
{
  const on = params.get('internals') === 'true';
  $('tab7').hidden = !on;
  document.querySelector('label[for="tab7"]').hidden = !on;
  $('menu-internals').hidden = !on;
}
// ---- every tab is shown (the Tutorial, Manual, Campaign, Observatory and Refinery could be hidden
// until 2026-11-27): forget the old on/off choices kept in this browser
try { for (const k of ['manual', 'campaign', 'observatory', 'tutorial', 'lab']) localStorage.removeItem(`cegarplay.${k}`); } catch { /* no storage */ }

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
if (tab && /^([1-9]|1[012])$/.test(tab) && $('tab' + tab) && (tab !== '7' || params.get('internals') === 'true') && !$('tab' + tab).hidden) $('tab' + tab).checked = true;
if ($('tab8').checked) loadManual();

app.engine = new Engine({ threads: false });
app.editors = new Editors(app);
app.output = new Output(app);
app.stats = new Stats(app);
app.loopTab = new LoopTab(app);
app.loopTips = attachLoopTips(app, app.editors.loop, $('loop-hint'));
app.editors.onLoopLanguage = () => app.loopTips.update();
// ---- the editors' warnings and the fragments' tooltips (js/asp-scan.js): from the texts in the
// editors, 400 ms after an edit
app.liveProject = () => {
  const ed = app.editors;
  return { ...app.project,
    fragments: app.project.fragments.map((f) => ({ ...f, text: ed.fragments.has(f.name) ? ed.fragments.get(f.name).editor.getValue() : f.text })),
    loop: { ...app.project.loop, language: ed.loopLanguage || 'loop', text: ed.loop.getValue() } };
};
let lintTimer = 0, model = null;
app.aspModel = () => { if (!model) model = projectModel(app.liveProject()); return model; };
app.lintNow = () => {
  clearTimeout(lintTimer);
  model = null;
  const ed = app.editors;
  let problems = [];
  try { problems = lintProject(app.liveProject(), app.aspModel()); } catch (e) { console.warn('lint:', e); }
  const by = new Map([['loop', []], ...[...ed.fragments.keys()].map((k) => [k, []])]);
  for (const p of problems) {
    const key = p.where.kind === 'loop' ? 'loop' : p.where.name;
    if (by.has(key)) by.get(key).push({ line: p.where.line, col: p.where.col, message: p.message, severity: p.severity });
  }
  for (const [k, list] of by) ed.setLint(k, list);
};
app.editors.onEdit = () => { model = null; clearTimeout(lintTimer); lintTimer = setTimeout(app.lintNow, 400); };
// autocompletion (ACE's language tools): as one types, and with Ctrl+Space
function completeWith(editor, list) {
  if (!ace.require('ace/ext/language_tools')) return;
  editor.completers = [{
    identifierRegexps: [/[#a-zA-Z_0-9]/],
    getCompletions(ed, session, pos, prefix, done) {
      let items = [];
      try { items = list(pos.row, pos.column); } catch (e) { console.warn('completion:', e); }
      done(null, items.map((x) => ({ caption: x.caption, value: x.value, meta: x.meta, score: x.score, docHTML: `<b>${escHtml(x.caption)}</b><br>${escHtml(x.doc || '')}` })));
    },
  }];
  editor.setOptions({ enableBasicAutocompletion: true, enableLiveAutocompletion: true });
  // after a dot (S. G. X.) start afresh: the members of what stands before it
  editor.commands.on('afterExec', (e) => {
    if (e.command.name !== 'insertstring' || e.args !== '.') return;
    if (editor.completer) editor.completer.detach();
    const line = editor.session.getLine(editor.getCursorPosition().row).slice(0, editor.getCursorPosition().column);
    const after = /[A-Za-z_]\w*(\[[^\]]*\])?\.$/;
    if (!after.test(line) || /\.\.$/.test(line)) return;
    setTimeout(() => {
      // only while the cursor is still just after the dot (fast typing: the live completion takes over)
      const p = editor.getCursorPosition();
      if (after.test(editor.session.getLine(p.row).slice(0, p.column)) && !(editor.completer && editor.completer.activated)) editor.execCommand('startAutocomplete');
    }, 0);
  });
}
completeWith(app.editors.loop, (row, col) => ((app.editors.loopLanguage || 'loop') === 'loop'
  ? loopCompletions(app.editors.loop.getValue(), row, col, app.liveProject().fragments) : []));
app.editors.onEditorMade = (name, editor) => {
  completeWith(editor, (row, col) => aspCompletions(app.liveProject(), name, row, col, app.aspModel()));
  attachFragmentTip(name, editor);
};
const attachFragmentTip = (name, editor) => attachTooltip(editor, `frag:${name}`, (row, col) => {
  const h = aspWordHelp(app.liveProject(), name, row, col - 1, app.aspModel());
  const warnings = app.editors.lintAt(name, row).map((a) => ({ type: a.type, text: a.text }));
  // (the warning says it better)
  if (h && warnings.length) h.text = h.text.replace(/^Used here, but nothing [^.]*\. ?/, '');
  return h ? { ...h, warnings } : warnings.length ? { title: 'This line', text: '', warnings } : null;
});
for (const [name, f] of app.editors.fragments) app.editors.onEditorMade(name, f.editor);
app.internals = new Internals(app);
app.control = new Control(app);
app.instancesTab = new InstancesTab(app);
// the audit modes (PLAN3): Space shows the space picker and the bound; a space audit's witness
// can be kept as an instance
$('audit-mode').addEventListener('change', () => { app.instancesTab.renderSpaceBar(); app.instancesTab.storeAuditSetting(); });
$('space-select').addEventListener('change', () => { app.instancesTab.renderSpaceBar(); app.instancesTab.storeAuditSetting(); });
$('space-bound').addEventListener('change', () => app.instancesTab.storeAuditSetting());
app.output.onSaveInstance = (a) => app.instancesTab.saveWitness(a);
// the trace's label also names the recorded step (the Observatory's numbering, which counts
// solutions) when the run was recorded with every step
app.output.trace.stepNote = (t) => {
  const rec = app.recording;
  if (!rec || !rec.steps || !rec.steps.length || !t) return '';
  const p = pairSteps(rec).find((x) => x.t && x.t.i === t.i);
  return p ? ` (recorded step ${p.i} of ${rec.steps.length}, as in the Observatory)` : '';
};
// the verdict panel's next steps (js/output.js nextSteps)
app.output.auditContext = () => ({ spaces: (app.project.spaces || []).length > 0 });
const showTab = (n) => { $('tab' + n).checked = true; $('tab' + n).dispatchEvent(new Event('change', { bubbles: true })); };
// a next step that changes the top bar's mode keeps it with the project, as a choice in the bar does
const auditMode = (m) => { $('audit-mode').value = m; app.instancesTab.renderSpaceBar(); app.instancesTab.storeAuditSetting(); app.dirty(); };
app.output.onAuditAction = async (name, a) => {
  if (name === 'symbolic') { auditMode('symbolic'); return app.control.auditPicked(); }
  if (name === 'space') { auditMode('space'); $('space-bound').focus(); return; }
  if (name === 'write-space') {
    showTab(9);
    $('spaces-part').open = true;
    if (!(app.project.spaces || []).length) app.instancesTab.addSpace();
    requestAnimationFrame(() => $('space-body').scrollIntoView({ block: 'start' }));
    return;
  }
  if (name === 'larger-bound') { auditMode('space'); $('space-select').value = a.space; $('space-bound').value = String(a.k + 2); app.instancesTab.storeAuditSetting(); return app.control.auditPicked(); }
  if (name === 'save-and-audit') {
    const id = app.instancesTab.saveWitness(a);
    auditMode('enumerate');
    await app.control.run({ mode: 'audit', instance: id });
    return;
  }
  if (name === 'candidate-space') { showTab(11); return app.space.recordAndRun(); }
  // the instance the audit was of (the recording's header names it; else the top bar's)
  if (name === 'seed-sweep') return app.sweepAndShow({ instance: (app.recording && app.recording.header && app.recording.header.instance) || undefined, target: Number.isInteger(a.solutions) ? a.solutions : null });
  if (name === 'space-seed-sweep') return app.sweepAndShow({ instance: app.instancesTab.saveWitness(a), target: null });
  if (name === 'space-candidate-space') {
    // the map is of one run: on the instance the space audit broke on
    const id = app.instancesTab.saveWitness(a);
    app.instancesTab.pick(id);
    showTab(11);
    return app.space.recordAndRun();
  }
};
// Seed sweep (js/control.js seedSweep): a run that loses a solution, then that run recorded and
// shown in the candidate space. The seed and the randomized search stay in the settings, so Run
// gives the same run again.
app.sweepAndShow = async ({ instance, target }) => {
  if (instance) app.instancesTab.pick(instance);
  const seeds = 50;
  const r = await app.control.seedSweep({ instance, target, seeds });
  if (!r) return null;
  if (r.seed === null) {
    app.control.runMessage(`Seed sweep: none of ${r.tried} randomized runs lost a solution (each found all ${r.target}). ` +
      'The refinement the audit found is still possible; another instance, more seeds or other solver options may reach it.');
    return r;
  }
  app.project.settings = { ...app.project.settings, seed: r.seed, randomize: true };
  app.loopTab.load(app.project);
  app.dirty();
  const lost = r.target - r.solutions;
  const what = `Seed sweep: seed ${r.seed} loses ${lost} solution${lost === 1 ? '' : 's'} (${r.solutions} of ${r.target} found)`;
  app.control.runMessage(`${what}. The seed (Run options) is now ${r.seed}, randomized, so Run repeats this run.`);
  showTab(11);
  await app.space.recordAndRun();
  app.control.runMessage(`${what}; the candidate space (Observatory) shows the refinement that removes it. The seed (Run options) is now ${r.seed}, randomized: Run repeats this run.`);
  requestAnimationFrame(() => { const c = $('candidate-space'); if (c) c.scrollIntoView({ block: 'start' }); });
  return r;
};
app.variants = new Variants(app);
app.cursor = new Cursor();
bindKeys(app.cursor, () => ($('tab11').checked || document.body.classList.contains('lecture')) && !document.querySelector('dialog[open], .modal.is-visible'));
bindPageKeys(app);
app.tour = new Tour(app);
// the short tours of the Analyse tabs: started from the tab's help ("Tour of this tab") and from
// Settings; they no longer pop up on a tab's first visit
app.tabTours = Object.fromEntries(Object.entries(TAB_TOURS).map(([tab, t]) => [tab, new Tour(app, t)]));
app.loopWalkthrough = new Tour(app, { key: WALKTHROUGH_KEY, steps: walkthroughSteps, begin: walkthroughBegin });
app.startLoopWalkthrough = () => {
  app.tour.stop(false, false);
  for (const x of Object.values(app.tabTours)) x.stop(false, false);
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  app.loopWalkthrough.start();
};
// (delegated: the Tutorial's lesson and the tour's last card are built later)
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('[data-loop-walkthrough]');
  if (!a) return;
  e.preventDefault();
  if (app.tour.running) app.tour.stop(true);
  app.startLoopWalkthrough();
});
const startTabTour = (tab) => {
  const t = app.tabTours[tab];
  if (!t) return;
  app.tour.stop(false, false);
  for (const x of Object.values(app.tabTours)) x.stop(false, false);
  setTimeout(() => { if ($(tab).checked) t.start(); }, 250);      // (the Refinery is built when it opens)
};
// Leaving a tab ends its tour (a tour under way counts as closed); otherwise its card would stay
// on every other tab.
const endOtherTabTours = (tab) => {
  for (const [id, t] of Object.entries(app.tabTours)) if (id !== tab && t.running) t.stop(false, t.index > 0);
};
for (const r of document.querySelectorAll('input[name="tabs"]')) r.addEventListener('change', () => {
  if (!r.checked) return;
  endOtherTabTours(r.id);
});
for (const a of document.querySelectorAll('[data-tab-tour]')) a.addEventListener('click', (e) => {
  e.preventDefault();
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  const tab = a.dataset.tabTour;
  if (!$(tab).checked) { $(tab).checked = true; $(tab).dispatchEvent(new Event('change', { bubbles: true })); }
  startTabTour(tab);
});
for (const a of document.querySelectorAll('[data-tour]')) a.addEventListener('click', (e) => { e.preventDefault(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); app.tour.start(); });
for (const a of document.querySelectorAll('[data-shortcuts]')) a.addEventListener('click', (e) => { e.preventDefault(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); openShortcuts(); });
app.anatomy = new Anatomy(app, $('anatomy'));
app.campaign = new CampaignTab(app);
app.views = new ViewPanel(app, $('domain-view'));
// A view's rules are edited in the Observatory.
app.views.openTab = () => {
  $('tab11').checked = true;
  $('tab11').dispatchEvent(new Event('change', { bubbles: true }));
};
$('open-view-editor').addEventListener('click', () => app.views.openEditor());
app.space = new SpaceView(app, $('candidate-space'));
app.observatory = new ObservatoryBar(app, $('cursor-region'));

app.collect = () => app.editors.collect(app.project);
app.genLua = () => ({ draw: app.modules.draw, generate: app.modules.generate });

function showProjectInfo(p) {
  $('project-heading').textContent = p.title || 'Untitled';
  $('project-description').textContent = p.description || '';
  const readme = typeof p.readme === 'string' ? p.readme.trim() : '';
  $('project-readme').hidden = !readme;
  $('project-readme-body').innerHTML = readme ? renderMarkdown(readme, { idPrefix: 'readme-' }) : '';
  if (readme) codeBlocks($('project-readme-body'));
  document.title = p.title ? `CegarPlay · ${p.title}` : 'CegarPlay';
}
function editProjectInfo(on) {
  $('project-info').hidden = on;
  $('project-form').hidden = !on;
  if (!on) return;
  $('project-title-input').value = app.project.title || '';
  $('project-description-input').value = app.project.description || '';
  $('project-readme-input').value = app.project.readme || '';
  $('project-title-input').focus();
}
function saveProjectInfo() {
  app.project.title = $('project-title-input').value.trim() || 'Untitled';
  app.project.description = $('project-description-input').value.trim();
  const readme = $('project-readme-input').value.trim();
  if (readme) app.project.readme = readme; else delete app.project.readme;
  showProjectInfo(app.project);
  editProjectInfo(false);
  app.dirty();
}
$('edit-project-button').addEventListener('click', () => editProjectInfo(true));
tabIndent($('project-readme-input'));
$('save-project-info').addEventListener('click', saveProjectInfo);
$('cancel-project-info').addEventListener('click', () => editProjectInfo(false));
$('project-form').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') editProjectInfo(false);
  else if (e.key === 'Enter' && e.target.id === 'project-title-input') { e.preventDefault(); saveProjectInfo(); }
});

app.setProject = (p, { save = true } = {}) => {
  clearOriginLines();
  app.project = p;
  app.exampleId = null;         // set by loadExample
  markLoadedExample(app);
  // the results of an earlier run belong to the earlier project
  app.control.clearResults({ keepRecording: true });
  // the candidate space of the earlier project's run no longer applies
  if (app.space) app.space.forget('another project was loaded');
  // the recording stays for the Observatory, but it is of the earlier project
  if (app.recording) app.recording.otherProject = true;
  app.editors.build(p);
  app.loopTab.load(p);
  app.instancesTab.load();
  app.variants.load();
  app.anatomy.load();
  app.campaign.load();
  app.views.load();
  app.stats.history = Array.isArray(p.runs) ? p.runs.map((r) => ({ ...r })) : [];
  app.stats.renderHistory();
  showProjectInfo(p);
  editProjectInfo(false);
  requestAnimationFrame(() => app.resizeVisibleEditors());
  // the snapshot list follows the project (its title); not yet drawn while the page starts
  try { renderSnapshots(); } catch { /* the snapshot block has not run yet */ }
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
  if ((!app.ready && !app.restoredOrLoaded) || app.saveBlocked || app.resetting) return;
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
// ---- reset everything ("factory settings") ------------------------------------------------
// Forget all that this site keeps in this browser (localStorage keys cegarplay.*, the campaign
// rows in IndexedDB) and load the page afresh, without query or hash.
app.factoryReset = async () => {
  const ok = window.confirm('Reset everything?\n\nThis forgets the project being edited and its run history, the workspace, ' +
    'all snapshots, the campaign rows, the theme, the opened help and the Refinery settings, in this browser. It cannot be undone.');
  if (!ok) return false;
  app.resetting = true;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('cegarplay')) keys.push(k); }
    for (const k of keys) localStorage.removeItem(k);
  } catch { /* no storage */ }
  try {
    const store = await Promise.race([app.campaign.storeP, new Promise((r) => setTimeout(() => r(null), 2000))]);
    if (store) await store.clear();
  } catch { /* no IndexedDB */ }
  location.replace(location.pathname);
  return true;
};

// edit = false: save, but the project was not edited (e.g. the run history changed)
// The lines that say how the project came (loaded, uploaded, opened, started) are about the
// project as it came: the first edit, or another project, removes them.
const ORIGIN_LINES = ['load-status', 'upload-status', 'new-status', 'workspace-status'];
function clearOriginLines() { for (const id of ORIGIN_LINES) { const e = $(id); if (e) { e.textContent = ''; e.classList.remove('error'); } } }
app.dirty = (edit = true) => {
  if (edit) {
    if (!app.edited) clearOriginLines();
    if (app.restoredOrLoaded) urlForgetProject();
    app.edited = true; app.saveBlocked = false;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 800);
  if (shownTimer) clearTimeout(shownTimer);
  shownTimer = setTimeout(() => { shownTimer = null; app.updateShown(); if (edit) { try { renderSnapshots(); } catch { /* not yet */ } if (app.instancesTab) app.instancesTab.markStale(); } }, 300);
};
let shownTimer = null;
app.projectChanged = () => app.dirty();

// ---- "Shown:" in the top bar: what the result tabs hold now --------------------------------
// One line: the run, audit or replay whose results the Output, Statistics and Observatory tabs
// show; its instance and variant; how it ended; how much of it was recorded; whether the
// candidate space is of it; and whether the project was edited since (the results are then of the
// earlier version).
app.sourceHash = () => {
  const p = app.project;
  if (!p) return null;
  try { app.collect(); } catch { /* editors not built yet */ }
  return Project.sourceHash(p);
};
app.updateShown = () => {
  const el = $('shown-line');
  if (!el) return;
  const rec = app.recording, c = app.control;
  if (!rec) { el.textContent = 'Shown: no results yet. Run or audit; the Output, Statistics and Observatory tabs then show that run.'; el.dataset.state = 'empty'; return; }
  const hd = rec.header || {};
  const state = c ? c.state : '';
  const space = hd.mode === 'bounded' && /^space-/.test(hd.instance || '') ? hd.instance.slice(6) : null;
  const what = state === 'replayed' ? 'a replayed recording' : space ? `the space audit of space ${space}`
    : hd.mode === 'bounded' ? 'the symbolic audit' : hd.mode === 'audit' ? 'the audit by enumeration' : 'the run';
  const noInstance = (app.project.instances || []).length ? ' with no instance' : ' on the project as written';
  const parts = [what + (space ? '' : hd.instance ? ` on instance ${hd.instance}` : noInstance) + (hd.variant ? ` (variant ${hd.variant})` : '') +
    (rec.started ? `, started ${rec.started}` : '')];
  const active = state === 'running' || state === 'paused' || state === 'validating';
  const row = (app.stats && app.stats.history || []).at(-1);
  if (active) parts.push(state === 'paused' ? 'paused' : 'running');
  else if (row && (row.fragmentsHash === hd.fragmentsHash || space)) {
    if (row.audit) parts.push(verdictText(row.audit));
    else parts.push(`${row.outcome}, ${fmtNum(row.solutions)} solution${row.solutions === 1 ? '' : 's'}${row.exhausted ? ' (all)' : ''}`);
  }
  // (while a run is active its recording is not final: the trace below shows the steps so far)
  if ((hd.mode === 'run' && !active) || state === 'replayed') {
    parts.push(rec.steps.length ? `every step recorded (${fmtNum(rec.steps.length)})` : rec.traces.length ? (rec.traces.length >= Number(app.project.settings.trace ?? 200) ? `trace of the first ${fmtNum(rec.traces.length)} steps only` : `trace of all ${fmtNum(rec.traces.length)} steps`) : 'no steps recorded');
    if (app.space && app.space.rec === rec && app.space.F) parts.push('candidate space computed for it');
  }
  let edited = false;
  if (!active && rec.sourceHash && !rec.otherProject) { const h = app.sourceHash(); edited = !!h && h !== rec.sourceHash; }
  if (rec.otherProject) { parts.push('of a project loaded before this one'); edited = true; }
  else if (edited) parts.push('the project was edited since: these results are of the earlier version');
  const notStarted = !active && c && c.notStarted;
  el.textContent = (notStarted ? 'Still shown (the new run did not start): ' : 'Shown: ') + parts.join(' · ');
  el.dataset.state = edited || notStarted ? 'stale' : active ? 'active' : 'current';
};
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
  markLoadedExample(app);
  if (url) setUrl({ example: name });
}

// ---- the example library (examples/library.json) ------------------------------------
app.library = fetch('examples/library.json').then((r) => {
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}).catch(() => null);

wireLibraryFilter();

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
  const name = btn.dataset.loadExample;
  if (!guard() || !replaceOk(`loading example ${name}`)) return;
  try {
    await loadExample(name, undefined, { url: true });
    status('load-status', `Loaded example "${app.project.title}".`);
    if (undoSnapshot && undoSnapshot.what === `loading example ${name}`) {
      const u = make('button', { class: 'control-button small-button', id: 'load-undo-button', type: 'button' }, 'Undo');
      u.addEventListener('click', () => $('snapshot-undo-button').click());
      $('load-status').append(' ', u);
    }
    const t = btn.dataset.tab;
    if (t && $('tab' + t)) { $('tab' + t).checked = true; requestAnimationFrame(resizeVisibleEditors); }
    if (btn.closest('#section-tutorial, #section-manual')) flash(btn, `Loaded "${app.project.title}"`);
  } catch (e) {
    status('load-status', String(e.message || e), true);
    if (btn.closest('#section-tutorial, #section-manual')) flash(btn, String(e.message || e), true);
  }
});
// A short note next to a button outside Home.
function flash(btn, text, error = false) {
  let n = btn.nextElementSibling;
  if (!n || !n.classList.contains('load-note')) { n = make('span', { class: 'load-note note' }); btn.after(n); }
  n.textContent = ' ' + text;
  n.classList.toggle('error-text', error);
}

const download = (name, text, type = 'application/json') => saveFile(name, text, type);
const slug = (s) => (s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
const guard = () => {
  if (app.control.busy) { window.alert('Not possible during a run.'); return false; }
  return true;
};
// Before replacing a project that was edited.
// Before another project replaces an edited one: ask, then keep the edited one as an automatic
// snapshot with an Undo (what: "loading example X", for the snapshot's name and the Undo button).
const replaceOk = (what = 'replacing the project') => {
  if (!app.edited) return true;
  if (!window.confirm('Replace the current project? It is kept as an automatic snapshot (Project, Workspace and snapshots), and Undo brings it back.')) return false;
  snapshotBefore(what);
  return true;
};

// ---- the workspace: named projects in this browser (FUTURE-DIRECTIONS D9) ---------------
let workspace = null;
try { workspace = new Workspace(localStorage); localStorage.getItem(WS_INDEX); } catch { workspace = null; }
function renderWorkspace() {
  const ul = $('workspace-list');
  ul.textContent = '';
  if (!workspace) { status('workspace-status', 'Browser storage is not available here.', true); return; }
  for (const x of workspace.list()) {
    const li = make('li', { 'data-name': x.name });
    const open = make('button', { class: 'control-button small-button' }, 'Open');
    open.addEventListener('click', () => {
      if (!guard() || !replaceOk(`opening ${x.name}`)) return;
      try {
        app.setProject(Project.load(workspace.load(x.name)));
        urlForgetProject();
        $('workspace-name').value = x.name;
        status('workspace-status', `Opened ${x.name} from the workspace.`);
      } catch (e) { status('workspace-status', `${x.name}: ${e.message || e}`, true); }
    });
    const del = make('button', { class: 'control-button small-button' }, 'Delete');
    del.addEventListener('click', () => {
      if (!window.confirm(`Delete ${x.name} from the workspace?`)) return;
      workspace.remove(x.name);
      renderWorkspace();
      status('workspace-status', `Deleted ${x.name}.`);
    });
    li.append(make('b', {}, x.name), ` ${x.title ? `(${x.title}) ` : ''}`, make('span', { class: 'note' }, String(x.saved).slice(0, 16).replace('T', ' ')), ' ', open, ' ', del);
    ul.append(li);
  }
}
$('factory-reset-button').addEventListener('click', () => app.factoryReset());
$('workspace-save-button').addEventListener('click', () => {
  if (!workspace) return;
  const name = $('workspace-name').value.trim();
  if (!WS_NAME.test(name)) { status('workspace-status', 'Give a name of letters, digits, spaces, _ . and - (at most 60).', true); return; }
  if (workspace.has(name) && !window.confirm(`The workspace already has a project called ${name}. Overwrite it?`)) return;
  const p = structuredClone(app.collect());
  p.runs = app.stats.history;
  try { workspace.save(name, Project.save(p), p.title || ''); }
  catch (e) {
    try { workspace.save(name, Project.save(p, { runs: false }), p.title || ''); status('workspace-status', `Saved ${name} without the run history: storage is full.`, true); renderWorkspace(); return; }
    catch { status('workspace-status', 'Not saved: browser storage is full.', true); return; }
  }
  renderWorkspace();
  status('workspace-status', `Saved ${name} in the workspace.`);
});
renderWorkspace();

// ---- snapshots: copies of this project to go back to (js/snapshots.js) --------------------
// Kept in browser storage next to the workspace. Before a restore, and before a project replaces
// an edited one (an example, a file, New, the workspace), an automatic snapshot is taken and
// Undo brings that project back. Undo keeps its copy in memory, so it works without storage.
let snapshots = null;
try { snapshots = new Snapshots(localStorage); localStorage.getItem(SNAP_INDEX); } catch { snapshots = null; }
let undoSnapshot = null;   // { text, what }
// What happened last, with the time: the status line of the Snapshots block.
const snapStatus = (text, error = false) => status('snapshot-status', `Last action (${new Date().toLocaleTimeString()}): ${text}`, error);
// Which snapshot the project being edited is the same as (the run history aside). A snapshot
// never changes, so its normal form is computed once per id.
const snapNorm = new Map();
const normText = (text) => { try { return Project.save(Project.load(text), { runs: false }); } catch { return null; } };
function snapNormOf(id) {
  if (!snapNorm.has(id)) { let t = null; try { t = snapshots.load(id); } catch { t = null; } snapNorm.set(id, t ? normText(t) : null); }
  return snapNorm.get(id);
}
function currentNorm() { try { return Project.save(structuredClone(app.collect()), { runs: false }); } catch { return null; } }
// today: the time only; another day: date and time
const when = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toDateString() === new Date().toDateString() ? `today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};
function showUndo() {
  const u = undoSnapshot;
  $('snapshot-undo').hidden = !u;
  if (!u) return;
  $('snapshot-undo-button').textContent = `Undo ${u.what}`;
  $('snapshot-undo-text').textContent = `You replaced the project you were editing (${u.what}). `;
}
function projectText() {
  const p = structuredClone(app.collect());
  p.runs = app.stats.history;
  return p;
}
// Take a snapshot of the project being edited; returns the text kept (for Undo), or null.
function takeSnapshot(name, { auto = false } = {}) {
  let p;
  try { p = projectText(); } catch { return null; }
  let text = Project.save(p);
  if (!snapshots) return { text, kept: false };
  try { snapshots.save(p.title, name, text, { auto }); return { text, kept: true }; } catch { /* full: without the run history */ }
  try { text = Project.save(p, { runs: false }); snapshots.save(p.title, name, text, { auto }); return { text, kept: true, noRuns: true }; } catch { return { text, kept: false }; }
}
// Before the project being edited is replaced: an automatic snapshot and an Undo.
function snapshotBefore(what) {
  const r = takeSnapshot(`before ${what}`, { auto: true });
  if (!r) return;
  undoSnapshot = { text: r.text, what };
  renderSnapshots();
  showUndo();
  snapStatus(r.kept ? `Kept the project before ${what} as the automatic snapshot "before ${what}".`
    : `The project before ${what} could not be kept in browser storage; Undo still brings it back during this visit.`, !r.kept);
}
app.snapshotBefore = snapshotBefore;
function renderSnapshots() {
  const ul = $('snapshot-list'), others = $('snapshot-others');
  ul.textContent = '';
  others.textContent = '';
  const usable = !!snapshots;
  $('snapshot-save-button').disabled = !usable;
  $('snapshot-name').disabled = !usable;
  // said in the list, so that the status line keeps the last action's message
  if (!usable) { ul.append(make('li', { class: 'note', id: 'snapshot-unavailable' }, 'Browser storage is not available here: no snapshots (Undo still works during this visit).')); return; }
  let all = [];
  try { all = snapshots.all(); } catch { all = []; }
  const key = projectKey(app.project && app.project.title);
  const now = currentNorm();
  const same = (x) => now !== null && snapNormOf(x.id) === now;
  const item = (x, showProject) => {
    const cur = same(x);
    const li = make('li', { 'data-snapshot': x.id, class: cur ? 'snapshot-is-current' : '' });
    const restore = make('button', { class: 'control-button small-button', 'aria-label': `Restore snapshot ${x.name}`,
      title: cur ? 'The project you are editing is already the same as this snapshot' : 'Put this copy in place of the project you are editing (that one is kept as an automatic snapshot first)' }, 'Restore');
    if (cur) restore.disabled = true;
    restore.addEventListener('click', () => restoreSnapshot(x));
    const del = make('button', { class: 'control-button small-button', 'aria-label': `Delete snapshot ${x.name}` }, 'Delete');
    del.addEventListener('click', () => {
      try { snapshots.remove(x.id); } catch { /* gone already */ }
      snapNorm.delete(x.id);
      renderSnapshots();
      snapStatus(`Deleted the snapshot ${x.name}.`);
    });
    li.append(make('b', {}, x.name), ' ', x.auto ? make('span', { class: 'note' }, '(automatic) ') : '',
      showProject ? `(${x.project}) ` : '', make('span', { class: 'note' }, `${x.auto ? 'kept' : 'taken'} ${when(x.saved)}`), ' ',
      cur ? make('span', { class: 'snapshot-badge' }, 'same as the project now') : '', ' ', restore, ' ', del);
    return li;
  };
  // the line that says where the project being edited stands
  const cur = $('snapshot-current');
  const mineAll = all.filter((x) => x.project === key);
  const match = mineAll.find(same);
  cur.textContent = '';
  if (match) cur.append('The project you are editing is the same as the snapshot ', make('b', {}, match.name), ` (${match.auto ? 'kept' : 'taken'} ${when(match.saved)}).`);
  else if (mineAll.length) cur.append('The project you are editing differs from every snapshot of it below (the newest is ', make('b', {}, mineAll[0].name),
    `, ${when(mineAll[0].saved)}). Take a snapshot to keep it as it is now.`);
  else cur.append('No snapshot of this project yet. Take one to have a state to come back to.');
  cur.dataset.state = match ? 'same' : mineAll.length ? 'differs' : 'none';
  $('snapshot-list-title').textContent = mineAll.length ? `Snapshots of this project (${mineAll.length}), newest first:` : '';
  const mine = all.filter((x) => x.project === key), rest = all.filter((x) => x.project !== key);
  for (const x of mine) ul.append(item(x, false));
  // (no snapshot of this project: the line above already says so)
  if (rest.length) {
    const d = make('details', {});
    d.append(make('summary', {}, `Other projects (${rest.length})`));
    const u = make('ul', { class: 'workspace-list' });
    for (const x of rest) u.append(item(x, true));
    d.append(u);
    others.append(d);
  }
}
function restoreSnapshot(x) {
  if (!guard()) return;
  let text;
  try { text = snapshots.load(x.id); } catch { text = null; }
  if (!text) { snapStatus(`The snapshot ${x.name} is no longer in this browser.`, true); renderSnapshots(); return; }
  let p;
  try { p = Project.load(text); } catch (e) { snapStatus(`${x.name}: ${e.message || e}`, true); return; }
  snapshotBefore(`restoring ${x.name}`);
  app.setProject(p);
  urlForgetProject();
  renderSnapshots();
  snapStatus(`Restored the snapshot ${x.name}: it is now the project you are editing.`);
}
$('snapshot-save-button').addEventListener('click', () => {
  // without a name: "Snapshot 3" (the time is shown next to it anyway)
  let name = $('snapshot-name').value.trim();
  if (!name) {
    let mine = [];
    try { mine = snapshots ? snapshots.list(app.project.title) : []; } catch { mine = []; }
    let n = mine.length + 1;
    while (mine.some((x) => x.name === `Snapshot ${n}`)) n++;
    name = `Snapshot ${n}`;
  }
  const r = takeSnapshot(name);
  if (!r || !r.kept) { snapStatus('Not kept: browser storage is full or unavailable; download the project to keep it.', true); return; }
  $('snapshot-name').value = '';
  renderSnapshots();
  snapStatus(`Took the snapshot ${name}${r.noRuns ? ' (without the run history: storage is full)' : ''}.`);
});
$('snapshot-undo-button').addEventListener('click', () => {
  if (!undoSnapshot || !guard()) return;
  const u = undoSnapshot;
  undoSnapshot = null;
  showUndo();
  try { app.setProject(Project.load(u.text)); } catch (e) { snapStatus(`Undo failed: ${e.message || e}`, true); return; }
  urlForgetProject();
  renderSnapshots();
  snapStatus(`Undone: back to the project before ${u.what}.`);
});
renderSnapshots();

// ---- Home ----------------------------------------------------------------------
$('new-button').addEventListener('click', () => {
  if (!guard() || !replaceOk('starting a new project')) return;
  app.setProject(Project.starterProject());
  urlForgetProject();
  status('new-status', 'Started a new project. See the Programs tab.');
});

// ---- recordings: download the last run, open one and replay it
$('download-recording-button').addEventListener('click', async () => {
  if (!app.recording) return;
  saveFile(slug(app.project.title) + '.cprec', await app.recording.toBlob());
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
  if (!f || !guard() || !replaceOk(`loading ${f.name}`)) return;
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

wireDocLinks({ resizeVisibleEditors: () => resizeVisibleEditors() });

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
    if (r.checked && r.id === 'tab12' && app.ready) showLab();
    if (r.checked && r.id === 'tab8') loadManual();      // (fetched on the tab's first show)
    if (r.checked && r.id === 'tab11') requestAnimationFrame(() => { app.anatomy.dirty = { diagram: true, timeline: true, table: true }; app.anatomy.render(); app.views.updateSteps(); app.views.show(); });
    if (r.checked) setUrl({ example: new URLSearchParams(location.search).get('example'), tab: r.id === 'tab1' ? '' : r.id.slice(3), keepHash: true });
  });
}
app.resizeVisibleEditors = resizeVisibleEditors;

// ---- the Refinery (tab 12): its code and its own worker are loaded on its first show only
let labLoading = null;
function showLab() {
  if (!labLoading) {
    labLoading = import('./lab/tab.js').then((m) => { app.lab = new m.LabTab(app, $('lab')); return app.lab; })
      .catch((e) => { $('lab').textContent = `The Refinery could not be loaded: ${e.message}`; return null; });
  }
  labLoading.then((lab) => { if (lab) lab.shown(); });
}

// Ctrl+Enter (Cmd+Enter) runs, from anywhere on the page, also inside an editor.
addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!app.control.busy && app.ready) app.control.run();
  }
  // Ctrl+S (Cmd+S) does nothing: the browser's "save page" dialog is never what is meant here.
  if (ev.key.toLowerCase() === 's' && (ev.ctrlKey || ev.metaKey) && !ev.altKey) ev.preventDefault();
}, true);

// ---- start ------------------------------------------------------------------------
// What a first visit opens with: small and fast (graph-coloring stays in the library).
const DEFAULT_EXAMPLE = 'tutorial-first-run';
async function start() {
  const text = (path) => fetch(path).then((r) => {
    if (!r.ok) throw new Error(`cannot load ${path} (HTTP ${r.status})`);
    return r.text();
  });
  const [runtime, audit, ground, draw, generate, replayLua, version, bounded] = await Promise.all([
    text('lua/runtime.lua'),
    text('lua/audit.lua'),
    text('lua/ground.lua'),
    text('lua/draw.lua'),
    text('lua/generate.lua'),
    text('lua/replay.lua'),
    text('vendor/clingo-wasm/VERSION').catch(() => 'clingo-wasm'),
    text('lua/bounded.lua'),
  ]);
  app.runtime = runtime;
  app.modules = { audit, ground, draw, generate, replay: replayLua, bounded };
  loadTutorial();
  app.engineVersion = version.split('\n')[0];
  // ?example=<id> loads an example of the library
  const named = params.get('example');
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
    catch (e) { app.setProject(Project.newProject(), { save: false }); status('load-status', String(e.message || e), true); }
    if (shareError) status('load-status', `${shareError}. Opened the example "${app.project.title}" instead.`, true);
  }
  if (named && !restored && app.exampleId === named && params.get('fragment')) openFragment(params.get('fragment'));
  // ?instance=<id>: the instance the top bar picks (not saved until an edit)
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
  // (the library is open on Home from the start: index.html)
  app.library.then((lib) => buildLibrary(lib, app, FROM_PATTERN));
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
  if ($('tab12').checked) showLab();
  document.body.dataset.ready = 'true';
  // the guided tour: with ?tour=1, or offered on a first visit (a plain link, nothing kept in this
  // browser, the tour not seen before)
  const plain = [...params.keys()].every((k) => k === 'nocoi') && !location.hash;
  if (params.get('tour') === '1') app.tour.start();
  else if (params.get('tour') === 'loop') app.startLoopWalkthrough();
  else if (plain && !restored && !app.tour.seen) app.tour.offer();
}
// ?fragment=<name>: open the Programs tab on that fragment's editor; "loop" opens the Loop tab.
function openFragment(name) {
  if (name === 'loop') {
    $('tab4').checked = true;
    requestAnimationFrame(() => { resizeVisibleEditors(); app.editors.loop.focus(); });
    return;
  }
  if (app.editors.isViewFragment(name)) { app.views.openEditor(name); return; }
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
