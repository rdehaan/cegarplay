// A pool of engines for campaigns (docs/spec-instances.md section 5). Each slot owns one Engine
// (one worker); a job { program, seconds } runs through the normal run path, so limits and abort
// behave as for a single run. The default reducer keeps the last S, the D, the solution count
// and an order-independent hash of the solutions.
import { Engine } from './engine.js';
import { Reducer } from './campaign.js';

export const defaultPoolSize = () => Math.max(1, Math.min(8, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1));

export class Pool {
  constructor(size = defaultPoolSize()) {
    this.size = size;
    this.slots = Array.from({ length: size }, () => ({ engine: new Engine({ threads: false }), busy: false }));
    this.waiting = [];
  }
  get busy() { return this.slots.filter((s) => s.busy).length; }
  async slot() {
    const free = this.slots.find((s) => !s.busy);
    if (free) { free.busy = true; return free; }
    return new Promise((resolve) => this.waiting.push(resolve));
  }
  release(s) {
    const w = this.waiting.shift();
    if (w) w(s); else s.busy = false;
  }
  async run(job, makeReducer = () => new Reducer()) {
    const s = await this.slot();
    try {
      await s.engine.ready;
      const red = makeReducer();
      const d = await new Promise((resolve) => {
        s.engine.start(job.program, '--outf=3', { onEvent: (k, data) => red.add(k, data), onDone: resolve }, { seconds: Number(job.seconds) || 0 });
      });
      if (d.aborted) return { outcome: d.timeout ? 'timeout' : 'aborted', exhausted: false, solutions: 0, candidates: 0, refinements: 0, time: 0, hash: '' };
      return red.result(d.status);
    } finally { this.release(s); }
  }
  // Abort every running job; waiting jobs are dropped (they resolve as aborted).
  abortAll() {
    const w = this.waiting; this.waiting = [];
    for (const s of this.slots) if (s.engine.active) s.engine.abort();
    for (const f of w) f({ engine: { ready: Promise.resolve(), start: (p, o, h) => h.onDone({ aborted: true }) }, busy: true, dummy: true });
  }
  get running() { return this.slots.filter((s) => s.engine.active).length; }
  terminate() { this.abortAll(); for (const s of this.slots) s.engine.worker.terminate(); }
}
