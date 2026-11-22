// Run bar and run flow (spec-app.md section 6).
import { validate, assemble, mapLine, oneLineMessage, auditPlan, auditBody, modulesFor } from './driver.js';
import { TEMPLATES, template, derive } from './project.js';
import { resolveProject } from './instances.js';
import { hashText } from './stats.js';
import { fmt } from './output.js';
import { Recording } from './recording.js';

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
  if (/relevant\/1 derived nothing/.test(m)) {
    return 'The check found a counterexample, but no relevant(T) atom holds in it, so there is nothing to build a clause from. ' +
      'Add relevant/1 rules to the check fragment for the interface atoms the counterexample depends on, or use G.block(M) to rule out the whole candidate.';
  }
  if (/derive no (glue\/1|shown) atom/.test(m)) {
    return 'The glue fragments derive no glue(T) atom. Wrap the shared atoms as glue(T), or add the keyword legacy to the link for files written for cegar.py.';
  }
  if (/no progress|same candidate/.test(m)) {
    return 'The refinement did not change the abstraction, so the loop would propose the same candidate forever. Check that the clause or the rules of the refine part mention the candidate.';
  }
  return null;
}

const PARALLEL = /^(-t|--parallel-mode)(=|$)/;

export class Control {
  constructor(app) {
    this.app = app;
    this.state = 'idle';
    this.runButton = $('run-button');
    this.abortButton = $('abort-button');
    this.pauseButton = $('pause-button');
    this.stepButton = $('step-button');
    this.stopButton = $('stop-button');
    this.statusEl = $('run-status');
    this.auditButton = $('audit-button');
    this.runButton.addEventListener('click', () => this.run());
    this.auditButton.addEventListener('click', () => this.run({ mode: 'audit' }));
    this.abortButton.addEventListener('click', () => this.abort());
    this.pauseButton.addEventListener('click', () => this.togglePause());
    this.stepButton.addEventListener('click', () => this.step());
    this.stopButton.addEventListener('click', () => this.stop());
    const iso = app.engine.isolated && !!app.engine.control;
    for (const b of [this.pauseButton, this.stepButton, this.stopButton]) b.hidden = !iso;
    $('run-message-link').addEventListener('click', (e) => { e.preventDefault(); $('tab5').checked = true; $('tab5').dispatchEvent(new Event('change')); });
    this.setState('idle');
  }

  // A short message under the run bar for runs that end in an error (visible from every tab).
  runMessage(text) {
    $('run-message').hidden = !text;
    $('run-message-text').textContent = text || '';
  }

  setState(state) {
    this.state = state;
    this.statusEl.textContent = state;
    this.statusEl.dataset.state = state;
    const active = state === 'running' || state === 'paused';
    this.runButton.disabled = active || state === 'validating' || !this.app.ready;
    this.auditButton.disabled = this.runButton.disabled;
    this.abortButton.disabled = !active;
    this.pauseButton.disabled = !active;
    this.pauseButton.innerHTML = state === 'paused' ? '&#x23F5; Resume' : '&#x23F8; Pause';
    // Step: from idle it starts a run that pauses after its first candidate; while running it
    // pauses after the next candidate; while paused it advances by one candidate.
    this.stepButton.disabled = !(active || !this.runButton.disabled);
    this.stopButton.disabled = !active;
    const dl = document.getElementById('download-recording-button');
    if (dl) dl.disabled = active || state === 'validating' || !this.app.recording;
    document.body.dataset.runState = state;
  }

  get busy() { return ['validating', 'running', 'paused'].includes(this.state); }

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
  //   instance, variant: the run uses the derived project (js/project.js derive); without
  //   instance, the one picked in the run bar.
  async run({ seed, mode = 'run', instance, variant, stepping = false } = {}) {
    const app = this.app;
    if (this.busy || !app.ready) return null;
    this.setState('validating');
    this.runMessage('');
    if (app.loopTab) app.loopTab.cancelLiveCheck();
    this.cancelFragmentCheck();
    if (this.fragCheck) await this.fragCheck.catch(() => {});
    let project = structuredClone(app.collect());
    if (seed !== undefined) project.settings.seed = seed;
    app.editors.clearAnnotations();
    let problems, instanceId = null;
    try {
      // an instance stored as a recipe gets its facts from its generator first
      project = await resolveProject(project, instance, (p, o) => app.engine.exec(p, o), app.genLua());
      project = derive(project, { instance, variant });
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
    const run = mode === 'audit'
      ? { ...project, settings: { ...project.settings, solutions: 0, candidates: 0, trace: 0 } } : project;
    const modules = modulesFor(run.settings, { mode, compiled, loop: run.loop }).map((m) => app.modules[m]);
    const assembled = assemble(run, compiled, app.runtime, mode === 'audit'
      ? { poll: iso, modules, body: auditBody(compiled, plan) } : { poll: iso, modules });
    this.assembled = assembled;
    app.internals && app.internals.program(project, compiled, assembled);
    app.editors.setReadOnly(true);
    app.output.clear();
    app.output.trace.clear(project.settings.trace);
    app.stats.start({});
    app.output.result(mode === 'audit' ? 'Auditing…' : 'Running…');
    this.mode = mode;
    document.body.dataset.lastMode = mode;   // shows the audit notes in Statistics and Observatory
    this.audit = null;
    app.recording = new Recording({ title: project.title || '', instance: instanceId, mode, engine: app.engineVersion || '',
      example: app.exampleId || null, fragmentsHash: hashText(JSON.stringify([project.fragments.map((f) => [f.name, f.text]), project.settings.constants])) });
    this.D = null;
    this.E = null;
    this.marks = [];
    if (app.anatomy) app.anatomy.start({ assembled, compiled });
    this.setState('running');
    const info = {
      loopLabel: (mode === 'audit' ? 'audit: ' : '') + loopLabel(project.loop) + (instanceId ? ` [${instanceId}]` : ''), mode, instance: instanceId, settings: { ...project.settings, constants: { ...project.settings.constants } },
      engine: app.engineVersion, solvers: compiled ? compiled.solvers : [],
      fragmentsHash: hashText(JSON.stringify([project.fragments.map((f) => [f.name, f.text]), project.settings.constants])),
    };
    return new Promise((resolve) => {
      app.engine.start(assembled.program, '--outf=3', {
        onEvent: (kind, data, raw) => this.onEvent(kind, data, raw),
        onLine: (text, isErr) => { app.internals && app.internals.raw(text); app.output.line(text, isErr); },
        onDone: (d) => resolve(this.onDone(d, info)),
      }, { seconds: Number(project.settings.seconds) || 0 });
      // started by Step: the first poll lets one candidate through, then the run waits
      if (stepping && iso) { app.engine.step(); this.setState('paused'); }
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
        else app.output.result(`Auditing: ${fmt(data.candidates)} candidates, ${fmt(data.pairs)} pairs, ${fmt(data.unsound)} unsound so far…`);
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
      app.output.result(this.describe(D), state === 'error' ? 'error' : '');
    } else {
      state = 'error';
      app.output.result('clingo stopped unexpectedly', 'error');
      app.output.error('clingo stopped unexpectedly' + (d.message ? ` (${d.message})` : '') + '. The last output lines:');
      for (const l of app.output.lastLines) app.output.message(l, 'error');
    }
    if (this.audit) info.audit = this.audit;
    app.stats.done(this.D, this.D ? info : null);
    if (info.mode !== 'audit' && app.instancesTab) app.instancesTab.noteRun(info.instance, app.stats.S, this.D);
    app.editors.setReadOnly(false);
    if (this.marks.length) app.editors.annotate(this.marks);
    if (app.anatomy) app.anatomy.done();
    if (app.views) app.views.updateSteps();
    if (app.observatory) app.observatory.update();
    if (app.views) app.views.show();
    if (state === 'error') {
      const line = this.E && this.assembled ? mapLine(this.assembled, this.E.line) : null;
      this.runMessage(this.E ? `Error: ${this.E.message}${line ? ` (loop script, line ${line})` : ''}` : app.output.resultEl.textContent);
    }
    this.setState(state);
    return { state, D: this.D, E: this.E };
  }

  describe(D) {
    const S = this.app.stats.S;
    const A = this.audit;
    if (this.mode === 'audit' && D.outcome !== 'error') {
      if (!A) return `Audit ended without a verdict: ${D.outcome}${D.detail ? ` (${D.detail})` : ''}.`;
      if (A.verdict === 'limit') return `Audit stopped: more than ${fmt(A.limit)} candidates. Audit a smaller instance.`;
      return A.verdict === 'sound'
        ? `Audit: sound for every candidate and counterexample of this instance (${fmt(A.candidates)} candidates, ${fmt(A.pairs)} pairs).`
        : `Audit: unsound. ${fmt(A.unsound)} of ${fmt(A.pairs)} refinements would remove a solution; ${fmt(A.at_risk)} solutions at risk.`;
    }
    const n = S ? fmt(S.solutions) : '?';
    const sol = S && S.solutions === 1 ? 'solution' : 'solutions';
    switch (D.outcome) {
      case 'finished': return `Finished: ${n} ${sol}${D.exhausted ? ', all found (search exhausted)' : ''}.`;
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
    if (app.views) app.views.updateSteps();
    if (app.observatory) app.observatory.update();
    if (app.views) app.views.show();
    const what = this.D ? this.describe(this.D) : 'the recording has no final event';
    app.output.result(`Replayed: ${what}`);
    this.setState('replayed');
    return { state: 'replayed', D: this.D };
  }

  abort() {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.app.engine.abort();
  }

  togglePause() {
    if (this.state === 'running') { this.app.engine.pause(); this.setState('paused'); }
    else if (this.state === 'paused') { this.app.engine.resume(); this.setState('running'); }
  }

  step() {
    if (this.state === 'paused') this.app.engine.step();
    else if (this.state === 'running') { this.app.engine.step(); this.setState('paused'); }
    else if (!this.busy && !this.runButton.disabled) this.run({ stepping: true });
  }

  stop() {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.app.engine.stop();
    if (this.state === 'paused') this.setState('running');
  }

  async rerunSeeds() {
    if (this.busy) return;
    for (let seed = 1; seed <= 5; seed++) {
      const r = await this.run({ seed });
      if (!r || r.state === 'aborted' || (r.problems && r.problems.length)) break;
    }
  }
}
