// Run bar and run flow (spec-app.md section 6).
import { validate, assemble, mapLine, oneLineMessage, auditPlan, auditBody, boundedPlan, boundedBody, modulesFor } from './driver.js';
import { verifySpace } from './bounded.js';
import { compile } from './compiler.js';
import { TEMPLATES, template, derive, pickedVariant, deriveSpace, spaceBound } from './project.js';
import { resolveProject } from './instances.js';
import { hashText, auditLiveText } from './stats.js';
import { fmt, symbolicText } from './output.js';
import { Recording } from './recording.js';

// What a run's result depends on: the derived project's fragments (instance and variant applied),
// its loop script and constants. The Instances tab compares it with the project as it is now.
export function programHash(project) {
  return hashText(JSON.stringify([project.fragments.map((f) => [f.name, f.text]), project.loop && project.loop.text, project.settings.constants]));
}

const $ = (id) => document.getElementById(id);

export function loopLabel(loop) {
  if (loop.language === 'lua') return 'raw Lua';
  const norm = (s) => s.replace(/\s+$/gm, '').trim();
  const text = norm(loop.text).replace(/ compat\b/g, '');
  for (const [k, t] of Object.entries(TEMPLATES)) {
    for (const legacy of [false, true]) if (norm(template(k, { legacy })) === text) return t.label.replace(/:.*$/, '');
  }
  const first = loop.text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !/^(solver|link)\b/.test(l));
  return first || 'custom';
}

// A sentence of advice for common run-time errors, or null.
export function errorHint(message) {
  const m = String(message || '');
  if (/derive no (glue\/1|shown) atom/.test(m)) {
    return 'The glue fragments derive no glue(T) atom. Wrap the shared atoms as glue(T), or add the keyword legacy to the link for files written for cegar.py.';
  }
  if (/no progress|same candidate/.test(m)) {
    return 'The refinement did not change the abstraction, so the loop would propose the same candidate forever. Check that the clause or the rules of the refine part mention the candidate.';
  }
  return null;
}

const PARALLEL = /^(-t|--parallel-mode)(=|$)/;

// Thrown by a batch's engine calls once the batch was stopped.
export class BatchStopped extends Error { constructor() { super('stopped'); } }

export class Control {
  constructor(app) {
    this.app = app;
    this.state = 'idle';
    this.runButton = $('run-button');
    this.abortButton = $('abort-button');
    this.pauseButton = $('pause-button');
    this.stopButton = $('stop-button');
    this.clearButton = $('clear-button');
    this.statusEl = $('run-status');
    this.auditButton = $('audit-button');
    this.runButton.addEventListener('click', () => this.run());
    this.auditButton.addEventListener('click', () => this.auditPicked());
    for (const ev of ['mouseenter', 'focus']) this.auditButton.addEventListener(ev, () => this.updateAuditModes());
    for (const ev of ['mousedown', 'focus', 'change']) $('audit-mode').addEventListener(ev, () => this.updateAuditModes());
    this.abortButton.addEventListener('click', () => this.abort());
    this.pauseButton.addEventListener('click', () => this.togglePause());
    this.stopButton.addEventListener('click', () => this.stop());
    this.clearButton.addEventListener('click', () => this.clearResults());
    const iso = app.engine.isolated && !!app.engine.control;
    for (const b of [this.pauseButton, this.stopButton]) b.hidden = !iso;
    $('run-message-link').addEventListener('click', (e) => { e.preventDefault(); $('tab5').checked = true; $('tab5').dispatchEvent(new Event('change')); });
    this.setState('idle');
  }

  // A short message under the top bar for runs that end in an error (visible from every tab).
  runMessage(text) {
    $('run-message').hidden = !text;
    $('run-message-text').textContent = text || '';
  }

  // A batch (Run all, Fuzz, Check exercise, Rerun with 5 seeds) keeps the top bar in 'running'
  // between its runs, names itself there ("running fuzz"), and ends at the first Stop or Abort.
  //   const b = control.beginBatch('fuzz'); ... if (b.cancelled) ...; control.endBatch(b)
  beginBatch(name) {
    if (this.busy || !this.app.ready) return null;
    this.batch = { name, cancelled: false, progress: '' };
    this.lastRunState = 'idle';
    this.setState('running');
    return this.batch;
  }
  batchProgress(text) { if (this.batch) { this.batch.progress = text; this.setState(this.state); } }
  endBatch(b) {
    if (!b || this.batch !== b) return;
    this.batch = null;
    this.setState(b.cancelled ? 'aborted' : this.lastRunState || 'idle');
  }
  // An engine call of a batch (Fuzz): it refuses to start, and throws when it ends, once the batch
  // was stopped, so the batch's own code unwinds at once.
  batchExec(b) {
    return async (p, o) => {
      if (b.cancelled) throw new BatchStopped();
      const r = await this.app.engine.exec(p, o);
      if (b.cancelled) throw new BatchStopped();
      return r;
    };
  }

  setState(state) {
    this.state = state;
    // inside a batch the bar stays 'running' between the batch's runs
    if (this.batch && !['running', 'paused'].includes(state)) {
      if (state !== 'validating') this.lastRunState = state;
      state = 'running';
      this.state = 'running';
    }
    const label = state === 'running' && this.batch ? `running ${this.batch.name}${this.batch.progress ? ` (${this.batch.progress})` : ''}`
      : state === 'running' && this.mode === 'audit' ? 'running audit'
        : state === 'paused' && this.mode === 'audit' ? 'paused audit' : state;
    this.statusEl.textContent = label;
    this.statusEl.dataset.state = state;
    this.statusEl.dataset.task = this.batch ? this.batch.name : this.mode === 'audit' && (state === 'running' || state === 'paused') ? 'audit' : '';
    const active = state === 'running' || state === 'paused';
    this.runButton.disabled = active || state === 'validating' || !this.app.ready;
    this.auditButton.disabled = this.runButton.disabled;
    this.abortButton.disabled = !active;
    this.pauseButton.disabled = !active || !!this.batch;
    this.pauseButton.innerHTML = state === 'paused' ? '&#x23F5; Resume' : '&#x23F8; Pause';
    this.stopButton.disabled = !active;
    // Clear: something of an earlier run is on screen and no run is active
    this.clearButton.disabled = active || state === 'validating' || (state === 'idle' && !this.app.recording);
    const dl = document.getElementById('download-recording-button');
    if (dl) dl.disabled = active || state === 'validating' || !this.app.recording;
    document.body.dataset.runState = state;
    // after the run history's row is written (it follows the state)
    if (this.app.updateShown) setTimeout(() => this.app.updateShown(), 0);
  }

  // Remove the results of the last run (output, statistics, trace, annotations, recording) and
  // go back to idle, as on a fresh load. The run history and the project stay.
  //   keepRecording: for a project load (app.setProject). Resetting the cursor there would make the
  //   view panel ask the engine for a frame before an example's precomputed frames are in.
  clearResults({ keepRecording = false } = {}) {
    const app = this.app;
    if (this.busy && !keepRecording) return false;
    app.output.clear();
    app.stats.reset();
    this.runMessage('');
    app.editors.clearAnnotations();
    if (keepRecording) { this.setState('idle'); return true; }
    app.recording = null;
    if (app.space) app.space.recordingChanged();
    this.assembled = null;
    this.audit = null;
    delete document.body.dataset.lastMode;
    if (app.views) app.views.updateSteps();
    if (app.observatory) app.observatory.update();
    this.setState('idle');
    return true;
  }

  get busy() { return ['validating', 'running', 'paused'].includes(this.state); }
  // a run may start when nothing is active, or between the runs of a batch
  get canStart() { return this.batch ? !this.inRun && !this.batch.cancelled : !this.busy; }

  // ---- live check of the fragments: clingo --mode=gringo on each edited fragment, 800 ms
  // after the last edit, only while no run is active. A newer edit or a run drops the result.
  scheduleFragmentCheck(name) {
    if (!this.fragDirty) this.fragDirty = new Set();
    this.fragDirty.add(name);
    this.fragSeq = (this.fragSeq || 0) + 1;
    clearTimeout(this.fragTimer);
    this.fragTimer = setTimeout(() => this.checkFragments(), 800);
  }

  cancelFragmentCheck() {
    clearTimeout(this.fragTimer);
    this.fragSeq = (this.fragSeq || 0) + 1;
    if (this.fragDirty) this.fragDirty.clear();
  }

  async checkFragments() {
    const app = this.app;
    if (this.busy || !this.fragDirty || !this.fragDirty.size) return;
    if (!app.ready || app.engine.active) { this.fragTimer = setTimeout(() => this.checkFragments(), 300); return; }
    const seq = this.fragSeq;
    const names = [...this.fragDirty];
    this.fragDirty.clear();
    const p = structuredClone(app.collect());
    p.fragments = p.fragments.filter((f) => names.includes(f.name));
    if (!p.fragments.length) return;
    p.loop = { language: 'lua', text: '' };      // every fragment on its own
    let problems;
    this.fragCheck = validate(p, (prog, o) => app.engine.exec(prog, o));
    try { problems = await this.fragCheck; }
    catch { return; }
    finally { this.fragCheck = null; }
    if (seq !== this.fragSeq || this.busy) {
      if (!this.busy) for (const n of names) this.fragDirty.add(n);   // checked again with the newer edit
      return;
    }
    if (problems.some((x) => x.where && x.where.kind === 'settings')) return;   // constants first
    for (const n of names) {
      const mine = problems.filter((x) => x.where && x.where.kind === 'fragment' && x.where.name === n);
      app.editors.setMarks(n, mine.map((x) => ({ line: x.where.line, col: x.where.col, message: x.message, severity: x.severity })));
    }
  }

  // Validate, assemble and start. Resolves when the run is over.
  //   mode 'audit': the audit of lua/audit.lua instead of the loop (docs/spec-soundness.md).
  //   allSolutions: look for all solutions, whatever settings.solutions says.
  //   instance, variant: the run uses the derived project (js/project.js derive); without
  //   instance, the one picked in the top bar.
  async run(opts = {}) {
    if (!this.canStart || !this.app.ready) return null;
    this.inRun = true;
    try { return await this.runOne(opts); } finally { this.inRun = false; }
  }

  //   mode 'bounded': the symbolic audit of lua/bounded.lua (PLAN3); with spaceRun = { name, k },
  //   on the project derived from that space at bound k (js/project.js deriveSpace).
  //   noHistory: no row in the run history (the steps of a space audit).
  //   recordSteps: record every step of this run (the project's Recording setting is unchanged).
  async runOne({ seed, randomize, mode = 'run', instance, variant, allSolutions = false, spaceRun = null, noHistory = false, recordSteps = false } = {}) {
    const app = this.app;
    this.mode = mode;
    this.setState('validating');
    this.runMessage('');
    if (app.loopTab) app.loopTab.cancelLiveCheck();
    this.cancelFragmentCheck();
    if (this.fragCheck) await this.fragCheck.catch(() => {});
    let project = structuredClone(app.collect());
    if (seed !== undefined) project.settings.seed = seed;
    if (randomize !== undefined) { if (randomize) project.settings.randomize = true; else delete project.settings.randomize; }
    // Run all: an instance with an expected count is run to all solutions (as tools/run.mjs does)
    if (allSolutions) project.settings.solutions = 0;
    // recordSteps: this run records every step, whatever the Recording setting says (the Refinery)
    if (recordSteps) project.settings.record = { ...(project.settings.record || {}), steps: 'all', n: 0 };
    app.editors.clearAnnotations();
    let problems, instanceId = null;
    try {
      if (spaceRun) {
        const sp = (project.spaces || []).find((x) => x.name === spaceRun.name);
        if (!sp) throw new Error(`no space named ${spaceRun.name}`);
        project = deriveSpace(project, sp.name, { ...(spaceRun.params || {}), [spaceBound(sp)]: spaceRun.k }, { variant: variant !== undefined ? variant : pickedVariant(project) });
      } else {
        // an instance stored as a recipe gets its facts from its generator first
        project = await resolveProject(project, instance, (p, o) => app.engine.exec(p, o), app.genLua());
        // without an explicit variant: the one picked in the top bar (a stale name is ignored)
        project = derive(project, { instance, variant: variant !== undefined ? variant : pickedVariant(project) });
      }
      instanceId = project.instance || null;
    } catch (e) {
      app.output.clear();
      app.output.result(`Not started: ${e.message}`, 'error');
      this.runMessage(`Not started: ${e.message}`);
      this.setState('error');
      return { state: 'error', problems: [{ severity: 'error', message: e.message }] };
    }
    try {
      problems = await validate(project, (p, o) => app.engine.exec(p, o));
    } catch (e) {
      problems = [{ where: { kind: 'settings', name: 'engine' }, severity: 'error', message: 'validation failed: ' + (e.message || e) }];
    }
    const compiled = problems.compiled;
    if (compiled && !app.engine.threads) {
      for (const s of compiled.solvers) {
        if (s.options.some((o) => PARALLEL.test(o))) {
          problems.push({ where: { kind: 'loop', name: 'loop', line: 1, col: 1 }, severity: 'error',
            message: `solver ${s.name}: the option -t needs the threaded engine (Threads in the Loop tab, on a cross-origin isolated page)` });
        }
      }
    }
    let plan = null;
    if (mode === 'audit' && !problems.some((p) => p.severity === 'error')) {
      plan = auditPlan(compiled);
      if (plan.error) problems.push({ where: { kind: 'loop', name: 'loop', line: 1, col: 1 }, severity: 'error', message: `audit: ${plan.error}` });
    }
    if (mode === 'bounded' && !problems.some((p) => p.severity === 'error')) {
      plan = boundedPlan(compiled);
      if (plan.error) problems.push({ where: { kind: 'loop', name: 'loop', line: 1, col: 1 }, severity: 'error', message: `symbolic audit: ${plan.error}` });
    }
    if (problems.some((p) => p.severity === 'error')) {
      app.output.clear();
      app.output.result(`Not started: ${problems.filter((p) => p.severity === 'error').length} problem(s) found before the run.`, 'error');
      app.output.problems(problems);
      app.editors.annotate(problems);
      const first = problems.find((p) => p.severity === 'error');
      const w = first.where || {};
      const at = w.kind === 'fragment' ? `fragment ${w.name}, line ${w.line}` : w.kind === 'loop' ? `loop script, line ${w.line}` : 'settings';
      this.runMessage(`Not started: ${at}: ${oneLineMessage(first.message)}`);
      this.setState('error');
      return { state: 'error', problems };
    }
    const iso = app.engine.isolated && !!app.engine.control;
    const auditing = mode === 'audit' || mode === 'bounded';
    const budget = Number(project.settings.seconds) > 0 ? Number(project.settings.seconds) : 60;
    const run = auditing
      ? { ...project, settings: { ...project.settings, solutions: 0, candidates: 0, trace: 0, ...(mode === 'bounded' ? { seconds: budget } : {}) } } : project;
    const modules = modulesFor(run.settings, { mode, compiled, loop: run.loop }).map((m) => app.modules[m]);
    const assembled = assemble(run, compiled, app.runtime, mode === 'audit'
      ? { poll: iso, modules, body: auditBody(compiled, plan) }
      : mode === 'bounded' ? { poll: iso, modules, body: boundedBody(compiled, plan, { seconds: budget, space: !!spaceRun }) } : { poll: iso, modules });
    this.assembled = assembled;
    app.internals && app.internals.program(project, compiled, assembled);
    app.editors.setReadOnly(true);
    app.output.clear();
    app.output.trace.clear(project.settings.trace);
    app.stats.start({});
    app.output.result(mode === 'audit' ? 'Auditing…' : mode === 'bounded' ? (spaceRun ? `Symbolic audit of space ${spaceRun.name} at ${spaceRun.at || `k = ${spaceRun.k}`}…` : 'Symbolic audit…') : 'Running…');
    this.mode = mode;
    document.body.dataset.lastMode = mode;   // shows the audit notes in Statistics and Observatory
    this.audit = null;
    app.recording = new Recording({ title: project.title || '', instance: instanceId, variant: project.variant || null, mode, engine: app.engineVersion || '',
      example: app.exampleId || null, fragmentsHash: hashText(JSON.stringify([project.fragments.map((f) => [f.name, f.text]), project.settings.constants])) });
    // the project as it was at the start (in memory only, not in the recording's header): the
    // top bar's "Shown" line says when the project was edited since
    app.recording.sourceHash = app.sourceHash ? app.sourceHash() : null;
    app.recording.started = new Date().toTimeString().slice(0, 8);
    // the candidate space shows one recorded run: a map of the previous one no longer matches
    if (app.space) app.space.recordingChanged();
    this.D = null;
    this.E = null;
    this.marks = [];
    if (app.anatomy) app.anatomy.start({ assembled, compiled });
    this.setState('running');
    const info = {
      loopLabel: (mode === 'audit' ? 'audit: ' : mode === 'bounded' ? (spaceRun ? `space ${spaceRun.name}: ` : 'symbolic audit: ') : '') + loopLabel(project.loop) + (instanceId ? ` [${instanceId}]` : '') +
        (project.variant ? ` (variant ${project.variant})` : ''), mode, instance: instanceId, variant: project.variant || null, settings: { ...project.settings, constants: { ...project.settings.constants } },
      engine: app.engineVersion, solvers: compiled ? compiled.solvers : [], noHistory,
      fragmentsHash: hashText(JSON.stringify([project.fragments.map((f) => [f.name, f.text]), project.settings.constants])),
      programHash: programHash(project),
      // the facts the run used (a recipe instance's are generated): to tell later whether it still holds
      instanceFacts: ((project.fragments || []).find((f) => f.name === 'instance') || {}).text ?? null,
    };
    return new Promise((resolve) => {
      app.engine.start(assembled.program, '--outf=3', {
        onEvent: (kind, data, raw) => this.onEvent(kind, data, raw),
        onLine: (text, isErr) => { app.internals && app.internals.raw(text); app.output.line(text, isErr); },
        onDone: (d) => resolve(this.onDone(d, info)),
      }, { seconds: mode === 'bounded' ? budget : Number(project.settings.seconds) || 0 });
    });
  }

  onEvent(kind, data, raw) {
    const app = this.app;
    if (app.recording && !this.replaying) app.recording.add(kind, data);
    app.internals && raw && app.internals.raw(raw);
    if (app.anatomy) app.anatomy.event(kind, data);
    switch (kind) {
      case 'H': app.stats.header(data); app.internals && app.internals.header(data); break;
      case 'S': app.stats.update(data); break;
      case 'M': app.output.solution(data); break;
      case 'N': app.output.named(data); break;
      case 'W': {
        app.output.warning(data);
        if (data.fragment && this.marks.length < 200) {
          const sev = /: error: /.test(data.message) ? 'error' : /: warning: /.test(data.message) ? 'warning' : 'info';
          this.marks.push({ where: { kind: 'fragment', name: data.fragment, line: data.line, col: data.col }, severity: sev,
            message: `solver ${data.solver}: ${data.message.replace(/^[a-z_0-9]+:\d+:[\d:-]+: (info|warning|error): /, '')}` });
        }
        break;
      }
      case 'L': app.output.log(data.text); break;
      case 'V': app.stats.track(data); break;
      case 'T': app.output.trace.add(data); app.output.schedule(); break;
      case 'E': {
        this.E = data;
        const line = this.assembled ? mapLine(this.assembled, data.line) : null;
        app.output.error(`Error: ${data.message}${line ? ` (loop script, line ${line})` : ''}`);
        const hint = errorHint(data.message);
        if (hint) app.output.message(hint, 'hint');
        if (data.traceback) app.output.details('Lua traceback (for debugging the runtime)', data.traceback.trim(), 'error trace');
        if (line) this.marks.push({ where: { kind: 'loop', line, col: 1 }, severity: 'error', message: data.message });
        break;
      }
      case 'A':
        if (data.verdict) { this.audit = data; app.output.auditVerdict(data); }
        else if (data.phase === 'symbolic') app.output.result(`Symbolic audit: ${fmt(data.rounds)} rounds, ${fmt(data.refinements)} refinements so far…`);
        else app.output.result(`Auditing: ${fmt(data.candidates)} candidates, ${fmt(data.pairs)} refinements checked, ${fmt(data.unsound)} unsound so far…`);
        break;
      case 'D': this.D = data; break;
      default: break;
    }
  }

  onDone(d, info) {
    const app = this.app;
    app.output.flush();
    let state;
    if (d.aborted) {
      state = 'aborted';
      app.output.result(d.timeout ? 'Aborted: the time limit backstop ended a solve call that did not return.' : 'Aborted.', 'error');
    } else if (this.D) {
      const D = this.D;
      state = D.outcome === 'error' ? 'error' : 'finished';
      const lost = this.mode === 'run' && D.outcome === 'finished' && D.exhausted ? this.knownCount(info) : null;
      if (lost && app.stats.S && app.stats.S.solutions < lost.n) {
        app.output.result(`${this.describe(D)} But the instance has ${fmt(lost.n)} (${lost.from}): this run lost ${fmt(lost.n - app.stats.S.solutions)}.`, 'error');
      } else app.output.result(this.describe(D), state === 'error' ? 'error' : '');
    } else {
      state = 'error';
      app.output.result('clingo stopped unexpectedly', 'error');
      app.output.error('clingo stopped unexpectedly' + (d.message ? ` (${d.message})` : '') + '. The last output lines:');
      for (const l of app.output.lastLines) app.output.message(l, 'error');
    }
    if (this.audit) info.audit = this.audit;
    app.stats.done(this.D, this.D ? info : null);
    if (info.mode !== 'audit' && info.mode !== 'bounded' && app.instancesTab) app.instancesTab.noteRun(info.instance, app.stats.S, this.D, app.output.costs, info);
    app.editors.setReadOnly(false);
    if (this.marks.length) app.editors.annotate(this.marks);
    if (app.anatomy) app.anatomy.done();
    if (app.views) app.views.updateSteps();
    if (app.observatory) app.observatory.update();
    if (app.views) app.views.show();
    // the Refinery reads the latest run: it may have drawn its parts while this run was going on
    if (app.lab) app.lab.runDone();
    if (state === 'error') {
      const line = this.E && this.assembled ? mapLine(this.assembled, this.E.line) : null;
      this.runMessage(this.E ? `Error: ${this.E.message}${line ? ` (loop script, line ${line})` : ''}` : app.output.resultEl.textContent);
    }
    this.setState(state);
    return { state, D: this.D, E: this.E, audit: this.audit, S: app.stats.S, info };
  }

  // The true number of solutions of the instance a run used, when known: its expected count, or
  // the count of the latest enumeration audit of the same program. { n, from } or null.
  knownCount(info) {
    const app = this.app;
    const x = info && info.instance ? (app.project.instances || []).find((i) => i.id === info.instance) : null;
    if (x && x.expected && Number.isInteger(x.expected.solutions) && !info.variant) return { n: x.expected.solutions, from: 'its expected count' };
    const rows = (app.stats.history || []).filter((r) => r.mode === 'audit' && r.audit && !r.audit.mode && r.audit.verdict !== 'limit' && Number.isInteger(r.solutions) &&
      r.fragmentsHash === info.fragmentsHash && (r.instance || '') === (info.instance || ''));
    const r = rows.at(-1);
    return r ? { n: r.solutions, from: 'the audit of the same program' } : null;
  }

  describe(D) {
    const S = this.app.stats.S;
    const A = this.audit;
    if (this.mode === 'audit' && D.outcome !== 'error') {
      if (!A) return `Audit ended without a verdict: ${D.outcome}${D.detail ? ` (${D.detail})` : ''}.`;
      if (A.verdict === 'limit') return `Audit stopped: more than ${fmt(A.limit)} candidates. Audit a smaller instance.`;
      return A.verdict === 'sound'
        ? `Audit: sound for every candidate and counterexample of this instance (${fmt(A.candidates)} candidates, ${fmt(A.pairs)} refinements checked).`
        : `Audit: unsound. ${fmt(A.unsound)} of ${fmt(A.pairs)} refinements would remove a solution; ${fmt(A.at_risk)} solutions at risk.`;
    }
    if (this.mode === 'bounded' && D.outcome !== 'error') {
      if (!A) return `Symbolic audit ended without a verdict: ${D.outcome}${D.detail ? ` (${D.detail})` : ''}.`;
      return symbolicText(A);
    }
    const n = S ? fmt(S.solutions) : '?';
    const sol = S && S.solutions === 1 ? 'solution' : 'solutions';
    switch (D.outcome) {
      // "exhausted": the loop finds no more; that they are all the solutions holds only for a sound loop
      case 'finished': return `Finished: ${n} ${sol}${D.exhausted ? '; the search is exhausted (the loop finds no more)' : ''}.`;
      case 'solutions': return `Finished: ${n} ${sol} (the number asked for).`;
      case 'limit': return `Finished at a limit: ${D.detail}. ${n} ${sol} so far.`;
      case 'stopped': return `Stopped: ${D.detail || 'stop'}. ${n} ${sol} so far.`;
      case 'error': return `Error: ${D.detail}`;
      default: return D.outcome;
    }
  }

  // Feed a recording through the same event handling, without the engine (state 'replayed').
  replay(rec) {
    const app = this.app;
    if (this.busy) return null;
    this.replaying = true;
    this.assembled = null;
    this.mode = rec.header.mode || 'run';
    document.body.dataset.lastMode = this.mode;
    this.audit = null;
    this.D = null;
    this.E = null;
    this.marks = [];
    this.runMessage('');
    app.output.clear();
    app.output.trace.clear(rec.traces.length || 0);
    app.stats.start({});
    if (app.anatomy) app.anatomy.start({});
    try {
      for (const e of rec.events) this.onEvent(e.kind, e.data, null);
    } finally { this.replaying = false; }
    app.output.flush();
    app.stats.done(this.D, null);
    if (app.anatomy) app.anatomy.done();
    app.recording = rec;
    if (app.space) app.space.recordingChanged();
    if (app.views) app.views.updateSteps();
    if (app.observatory) app.observatory.update();
    if (app.views) app.views.show();
    const what = this.D ? this.describe(this.D) : 'the recording has no final event';
    const h = rec.header || {};
    const of = [h.instance ? `instance ${h.instance}` : '', h.variant ? `variant ${h.variant}` : ''].filter(Boolean).join(', ');
    app.output.result(`Replayed${of ? ` (${of})` : ''}: ${what}`);
    this.setState('replayed');
    return { state: 'replayed', D: this.D };
  }

  abort() {
    if (this.state !== 'running' && this.state !== 'paused') return;
    if (this.batch) this.batch.cancelled = true;
    if (this.app.engine.busy) this.app.engine.abort();
    if (this.batch) this.setState('running');
  }

  togglePause() {
    if (this.state === 'running') { this.app.engine.pause(); this.setState('paused'); }
    else if (this.state === 'paused') { this.app.engine.resume(); this.setState('running'); }
  }

  // Audit: the instance picked in the top bar, unless it is marked audit: false (too large to
  // enumerate); then every auditable instance, one after the other.
  auditPicked() {
    const app = this.app, it = app.instancesTab;
    const how = $('audit-mode') ? $('audit-mode').value : 'enumerate';
    if (how === 'symbolic') return this.run({ mode: 'bounded' });
    if (how === 'space') return this.auditSpace();
    const id = it ? it.selectedId() : null;
    const x = id ? (app.project.instances || []).find((i) => i.id === id) : null;
    if (x && x.audit === false && it) {
      $('tab9').checked = true; $('tab9').dispatchEvent(new Event('change', { bubbles: true }));
      return it.auditAll();
    }
    return this.run({ mode: 'audit' });
  }

  // Which audit modes the project's loop supports (PLAN3): a mode it does not support stays
  // selectable (Audit then says why) but is marked, and the Audit button's tooltip names the
  // reason. Cheap (one compile); called on load and when the mode select or the button is used.
  updateAuditModes() {
    const p = this.app.project, sel = $('audit-mode');
    if (!p || !sel) return;
    let enumWhy = null, symWhy = null;
    if (!p.loop || p.loop.language !== 'loop') enumWhy = symWhy = 'a raw Lua loop has no audit';
    else {
      const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
      if (!c.ok) enumWhy = symWhy = 'the loop script has errors';
      else {
        const a = auditPlan(c), b = boundedPlan(c);
        if (a.error) enumWhy = a.error;
        if (b.error) symWhy = b.error;
        else if (b.unsupported) symWhy = b.unsupported;
        else if (!b.clause && !b.clauses) symWhy = 'the loop refines only by blocks or cores, which remove no solution by construction';
      }
    }
    const why = { enumerate: enumWhy, symbolic: symWhy, space: symWhy || (!(p.spaces || []).length ? 'the project has no space (Instances tab, Spaces)' : null) };
    const NAMES = { enumerate: 'enumeration', symbolic: 'symbolic search', space: 'space' };
    for (const o of sel.options) {
      if (!o.dataset.title) o.dataset.title = o.title;
      const w = why[o.value];
      o.textContent = NAMES[o.value] + (w ? ' (not for this loop)' : '');
      o.title = w ? `Not for this loop: ${w}` : o.dataset.title;
      o.dataset.unsupported = w ? 'true' : '';
    }
    const cur = sel.options[sel.selectedIndex];
    const b = this.auditButton;
    if (!b.dataset.title) b.dataset.title = b.title;
    b.title = why[sel.value] ? `Audit by ${NAMES[sel.value]}: not for this loop: ${why[sel.value]}` : `Audit by ${NAMES[sel.value]}: ${cur ? cur.dataset.title : b.dataset.title}`;
  }

  // Space (PLAN3 S7): js/bounded.js verifySpace (the same loop as the CLI) with every step a
  // page run (mode 'bounded' on the space at k), as a batch that stops at the first k that is not
  // sound. One row in the run history.
  async auditSpace() {
    const app = this.app;
    const name = $('space-select') ? $('space-select').value : '';
    const project = app.collect();
    const sp = (project.spaces || []).find((x) => x.name === name);
    if (!sp) { this.runMessage('Not started: the project has no space of that name.'); return null; }
    const from = sp.from ?? 1;
    const bound = spaceBound(sp);
    const to = Math.max(from, Math.floor(Number($('space-bound') && $('space-bound').value) || (sp.expected && sp.expected.k) || from));
    const b = this.beginBatch('space audit');
    if (!b) return null;
    let last = null, result = null;
    try {
      result = await verifySpace(project, { space: sp.name, from, to, env: {
        engineRun: (p, o) => app.engine.exec(p, o),
        runBounded: async (_p, { k, params }) => {
          const at = [`${bound} = ${k}`, ...Object.entries(params || {}).map(([a, v]) => `${a} = ${v}`)].join(', ');
          this.batchProgress(`${at} (${bound} up to ${to})`);
          const r = await this.run({ mode: 'bounded', spaceRun: { name: sp.name, k, params, at }, noHistory: true });
          if (b.cancelled || !r) throw new BatchStopped();
          last = r;
          // a step that the time backstop ended (one solve call longer than the budget): budget
          if (r.state === 'aborted') return { verdict: 'budget', mode: 'symbolic', seconds: Number(app.project.settings.seconds) || 60 };
          return r.audit || { verdict: 'error', reason: r.state };
        },
      } });
    } catch (e) {
      if (!(e instanceof BatchStopped)) throw e;
    } finally { this.endBatch(b); }
    if (!result) { app.output.result('Space audit stopped.'); return null; }
    if (result.verdict === 'error' && !last) {
      const msg = `Not started: ${result.reason}`;
      this.runMessage(msg); app.output.result(msg, 'error');
      return null;
    }
    // the constants of the space at k (a constants-only space has no facts: they are its instance),
    // with the values of the ranged parameters at which it failed
    const consts = { ...(sp.defaults || {}), ...(result.params || {}), [bound]: result.k };
    const witness = result.witness ? { ...result.witness, constants: Object.fromEntries(Object.entries(consts).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) } : null;
    const A = { ...(result.last || {}), verdict: result.verdict, mode: 'space', space: sp.name, k: result.k, bound, params: result.params || null, witness, reason: result.reason, perK: result.perK };
    this.audit = A;
    app.output.auditVerdict(A);
    app.output.result(symbolicText(A), result.verdict === 'unsound' ? 'error' : '');
    if (last && last.info && app.stats.S) { app.stats.record({ ...last.info, noHistory: false, audit: A }); app.stats.render(); }
    app.stats.live.textContent = auditLiveText(A);   // the whole space, not its last step
    app.stats.audit = A; app.stats.render();
    return result;
  }

  stop() {
    if (this.state !== 'running' && this.state !== 'paused') return;
    // a batch ends at once: its current call is aborted (a graceful stop would let it go on)
    if (this.batch) { this.abort(); return; }
    this.app.engine.stop();
    if (this.state === 'paused') this.setState('running');
  }

  // Seed sweep: show an unsound refinement in a run. An audit finds a refinement that removes a
  // solution; a run makes it only if its search goes there. Run the instance to all solutions with
  // a randomized search for seeds 1..n, and stop at the first run that finds fewer than the true
  // count (target; from an enumeration audit when not given). Returns { seed, solutions, target,
  // tried } or { seed: null, ... } (none of the seeds lost one), or null (stopped or no count).
  async seedSweep({ instance, target = null, seeds = 50, onProgress = null } = {}) {
    const app = this.app;
    if (target === null || target === undefined) {
      const a = await this.run({ mode: 'audit', instance });
      const A = a && a.audit;
      if (!A || A.mode || !Number.isInteger(A.solutions)) {
        this.runMessage('Seed sweep: no true count (the enumeration audit of the instance did not finish).');
        return null;
      }
      target = A.solutions;
    }
    const b = this.beginBatch('seed sweep');
    if (!b) return null;
    let found = null, tried = 0;
    try {
      for (let seed = 1; seed <= seeds; seed++) {
        this.batchProgress(`seed ${seed} of ${seeds}`);
        if (onProgress) onProgress(seed, seeds);
        const r = await this.run({ seed, randomize: true, instance, allSolutions: true, noHistory: true });
        if (b.cancelled || !r || r.state === 'aborted' || r.state === 'error') return null;
        tried = seed;
        const n = r.S ? r.S.solutions : null;
        if (r.D && r.D.outcome === 'finished' && Number.isInteger(n) && n < target) { found = { seed, solutions: n }; break; }
      }
    } finally { this.endBatch(b); }
    return found ? { ...found, target, tried } : { seed: null, target, tried };
  }

  async rerunSeeds() {
    const b = this.beginBatch('5 seeds');
    if (!b) return;
    try {
      for (let seed = 1; seed <= 5; seed++) {
        this.batchProgress(`seed ${seed} of 5`);
        // a randomized search: without it every seed searches the same way
        const r = await this.run({ seed, randomize: true });
        if (b.cancelled || !r || r.state === 'aborted' || (r.problems && r.problems.length)) break;
      }
    } finally { this.endBatch(b); }
  }
}
