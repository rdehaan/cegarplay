// Run bar and run flow (spec-app.md section 6).
import { validate, assemble, mapLine } from './driver.js';
import { TEMPLATES, template } from './project.js';
import { hashText } from './stats.js';
import { fmt } from './output.js';

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
    this.runButton.addEventListener('click', () => this.run());
    this.abortButton.addEventListener('click', () => this.abort());
    this.pauseButton.addEventListener('click', () => this.togglePause());
    this.stepButton.addEventListener('click', () => this.step());
    this.stopButton.addEventListener('click', () => this.stop());
    const iso = app.engine.isolated && !!app.engine.control;
    for (const b of [this.pauseButton, this.stepButton, this.stopButton]) b.hidden = !iso;
    this.setState('idle');
  }

  setState(state) {
    this.state = state;
    this.statusEl.textContent = state;
    this.statusEl.dataset.state = state;
    const active = state === 'running' || state === 'paused';
    this.runButton.disabled = active || state === 'validating' || !this.app.ready;
    this.abortButton.disabled = !active;
    this.pauseButton.disabled = !active;
    this.pauseButton.innerHTML = state === 'paused' ? '&#x23F5; Resume' : '&#x23F8; Pause';
    this.stepButton.disabled = state !== 'paused';
    this.stopButton.disabled = !active;
    document.body.dataset.runState = state;
  }

  get busy() { return ['validating', 'running', 'paused'].includes(this.state); }

  // Validate, assemble and start. Resolves when the run is over.
  async run({ seed } = {}) {
    const app = this.app;
    if (this.busy || !app.ready) return null;
    this.setState('validating');
    const project = structuredClone(app.collect());
    if (seed !== undefined) project.settings.seed = seed;
    app.editors.clearAnnotations();
    let problems;
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
    if (problems.some((p) => p.severity === 'error')) {
      app.output.clear();
      app.output.result(`Not started: ${problems.filter((p) => p.severity === 'error').length} problem(s) found before the run.`, 'error');
      app.output.problems(problems);
      app.editors.annotate(problems);
      this.setState('error');
      return { state: 'error', problems };
    }
    const iso = app.engine.isolated && !!app.engine.control;
    const assembled = assemble(project, compiled, app.runtime, { poll: iso });
    this.assembled = assembled;
    app.internals && app.internals.program(project, compiled, assembled);
    app.editors.setReadOnly(true);
    app.output.clear();
    app.output.trace.clear(project.settings.trace);
    app.stats.start({});
    app.output.result('Running…');
    this.D = null;
    this.E = null;
    this.marks = [];
    this.setState('running');
    const info = {
      loopLabel: loopLabel(project.loop), settings: { ...project.settings, constants: { ...project.settings.constants } },
      engine: app.engineVersion, solvers: compiled ? compiled.solvers : [],
      fragmentsHash: hashText(JSON.stringify([project.fragments.map((f) => [f.name, f.text]), project.settings.constants])),
    };
    return new Promise((resolve) => {
      app.engine.start(assembled.program, '--outf=3', {
        onEvent: (kind, data, raw) => this.onEvent(kind, data, raw),
        onLine: (text, isErr) => { app.internals && app.internals.raw(text); app.output.line(text, isErr); },
        onDone: (d) => resolve(this.onDone(d, info)),
      }, { seconds: Number(project.settings.seconds) || 0 });
    });
  }

  onEvent(kind, data, raw) {
    const app = this.app;
    app.internals && app.internals.raw(raw);
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
        const line = mapLine(this.assembled, data.line);
        app.output.error(`Error: ${data.message}${line ? ` (loop script, line ${line})` : ''}`);
        const hint = errorHint(data.message);
        if (hint) app.output.message(hint, 'hint');
        if (data.traceback) app.output.details('Lua traceback (for debugging the runtime)', data.traceback.trim(), 'error trace');
        if (line) this.marks.push({ where: { kind: 'loop', line, col: 1 }, severity: 'error', message: data.message });
        break;
      }
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
    app.stats.done(this.D, this.D ? info : null);
    app.editors.setReadOnly(false);
    if (this.marks.length) app.editors.annotate(this.marks);
    this.setState(state);
    return { state, D: this.D, E: this.E };
  }

  describe(D) {
    const S = this.app.stats.S;
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

  abort() {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.app.engine.abort();
  }

  togglePause() {
    if (this.state === 'running') { this.app.engine.pause(); this.setState('paused'); }
    else if (this.state === 'paused') { this.app.engine.resume(); this.setState('running'); }
  }

  step() { if (this.state === 'paused') this.app.engine.step(); }

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
