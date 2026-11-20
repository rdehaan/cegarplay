// Page side of the worker protocol (spec-app.md section 4.2).
import { parseEvent } from './driver.js';

export class Engine {
  constructor({ threads = false } = {}) {
    this.threads = threads;
    this.control = null;
    if (this.isolated && typeof SharedArrayBuffer !== 'undefined') {
      this.control = new Int32Array(new SharedArrayBuffer(4));
    }
    this.nextId = 1;
    this.active = null;          // the current run or exec
    this.listeners = new Set();  // state listeners (for the UI)
    this.spawn();
  }

  get isolated() { return !!self.crossOriginIsolated; }
  get busy() { return !!this.active; }

  spawn() {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker = w;
    this.readyMs = null;
    this.ready = new Promise((resolve, reject) => {
      this._ready = resolve;
      this._readyFail = reject;
    });
    this.ready.catch(() => {});
    w.onmessage = (ev) => this.onMessage(w, ev.data);
    w.onerror = (e) => {
      if (w !== this.worker) return;
      const a = this.active;
      if (a) { this.active = null; a.finish({ status: 'trap', message: 'worker error: ' + (e.message || e), ms: 0 }); }
      this._readyFail(new Error(e.message || 'worker error'));
    };
    if (this.control) Atomics.store(this.control, 0, 0);
    w.postMessage({ type: 'init', threads: this.threads, control: this.control ? this.control.buffer : null });
  }

  setThreads(threads) {
    if (threads === this.threads) return;
    if (this.active) throw new Error('cannot switch the engine during a run');
    this.threads = threads;
    this.worker.terminate();
    this.spawn();
  }

  onMessage(w, d) {
    if (w !== this.worker) return;
    if (d.type === 'ready') { this.readyMs = d.ms; this._ready(d); return; }
    if (d.type === 'failed') { this._readyFail(new Error(d.message)); return; }
    const a = this.active;
    if (!a || d.id !== a.id) return;
    if (d.type === 'lines') a.lines(d.out, d.err);
    else if (d.type === 'done') {
      this.active = null;
      if (d.status === 'trap') { this.worker.terminate(); this.spawn(); }
      a.finish(d);
    }
  }

  // One plain run (validation): resolves to { status, out, err }.
  async exec(program, options = '') {
    if (this.active) throw new Error('the engine is busy');
    await this.ready;
    return new Promise((resolve) => {
      const id = this.nextId++;
      const out = [], err = [];
      this.active = {
        id,
        lines: (o, e) => { out.push(...o); err.push(...e); },
        finish: (d) => resolve({ status: d.status, out, err, message: d.message }),
      };
      this.worker.postMessage({ type: 'run', id, program, options });
    });
  }

  // A CEGAR run. handlers: onEvent(kind, data), onLine(text, isErr), onDone({ status, ms, aborted, message }).
  start(program, options, handlers, { seconds = 0 } = {}) {
    if (this.active) throw new Error('the engine is busy');
    const id = this.nextId++;
    const t0 = performance.now();
    let timer = null;
    const finish = (d) => {
      if (timer) clearTimeout(timer);
      handlers.onDone && handlers.onDone({ status: d.status, ms: d.ms ?? Math.round(performance.now() - t0), aborted: !!d.aborted, message: d.message, timeout: !!d.timeout });
    };
    this.active = {
      id,
      lines: (out, err) => {
        for (const l of out) {
          const e = l.startsWith('@@') ? parseEvent(l) : null;
          if (e) handlers.onEvent && handlers.onEvent(e.kind, e.data, l);
          else handlers.onLine && handlers.onLine(l, false);
        }
        for (const l of err) handlers.onLine && handlers.onLine(l, true);
        if (this.stepping && this.control) { this.stepping = false; Atomics.store(this.control, 0, 1); }
      },
      finish,
    };
    if (this.control) Atomics.store(this.control, 0, 0);
    this.ready.then(() => {
      if (!this.active || this.active.id !== id) return;
      this.worker.postMessage({ type: 'run', id, program, options });
    });
    if (seconds > 0) {
      timer = setTimeout(() => {
        if (this.active && this.active.id === id) this.abort({ timeout: true });
      }, (seconds + 2) * 1000);
    }
    return id;
  }

  abort(extra = {}) {
    const a = this.active;
    this.active = null;
    this.worker.terminate();
    this.spawn();
    if (a) a.finish({ status: 'aborted', aborted: true, ...extra });
  }

  // Control word: only on isolated pages.
  setControl(v) { if (this.control) { Atomics.store(this.control, 0, v); Atomics.notify(this.control, 0); } }
  pause() { this.setControl(1); }
  resume() { this.stepping = false; this.setControl(0); }
  step() { this.stepping = true; this.setControl(0); }
  stop() { this.stepping = false; this.setControl(2); }
}
