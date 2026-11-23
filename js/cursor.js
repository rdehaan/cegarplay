// The linked cursor of the Observatory (docs/spec-views.md section 6): one model that every view
// reads; none keeps a step of its own. No DOM except bindKeys.
//
//   cursor.ticks: [{ i, t, k }] the recorded steps (R events, else traceSteps: T events and the
//                 solutions after the last of them)
//   cursor.index: 1-based position in ticks (0 = before the first step)
//   cursor.range: [a, b] indices of a brushed range, or null
//   cursor.follow: stay on the last step while a run adds steps
import { traceSteps } from './recording.js';

export function ticksOf(rec) {
  if (!rec) return [];
  if (rec.steps && rec.steps.length) return rec.steps.map((s) => ({ i: s.i, t: s.t ?? 0, k: s.k }));
  return traceSteps(rec).map((s) => ({ i: s.i, t: 0, k: s.t.kind }));
}

export class Cursor {
  constructor() { this.ticks = []; this.index = 0; this.range = null; this.follow = false; this.subs = new Set(); }
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit() { for (const f of this.subs) f(this); }
  setTicks(ticks, { keep = false } = {}) {
    this.ticks = ticks;
    // a new run or replay starts on its first step (as the trace does); follow stays on the last
    if (this.follow) this.index = ticks.length;
    else if (!keep) this.index = ticks.length ? 1 : 0;
    else this.index = Math.min(this.index, ticks.length);
    if (this.range) this.range = [Math.min(this.range[0], ticks.length), Math.min(this.range[1], ticks.length)];
    this.emit();
  }
  get tick() { return this.ticks[this.index - 1] || null; }
  get step() { return this.tick ? this.tick.i : 0; }
  set(index) {
    const n = Math.max(0, Math.min(this.ticks.length, Math.round(index)));
    if (n === this.index) return;
    this.index = n;
    this.emit();
  }
  move(d) { this.set(this.index + d); }
  // the last tick whose step number is at most i
  setByStep(i) {
    let k = 0;
    for (let j = 0; j < this.ticks.length; j++) if (this.ticks[j].i <= i) k = j + 1; else break;
    this.set(k);
  }
  setRange(a, b) {
    if (a == null || b == null) this.range = null;
    else { const lo = Math.max(1, Math.min(a, b)), hi = Math.min(this.ticks.length, Math.max(a, b)); this.range = [lo, hi]; }
    this.emit();
  }
  // the elapsed-time window of the range (for the call timeline and the line table)
  timeRange() {
    if (!this.range) return null;
    const a = this.ticks[this.range[0] - 1], b = this.ticks[this.range[1] - 1];
    return a && b ? [a.t, b.t] : null;
  }
  stepRange() {
    if (!this.range) return null;
    const a = this.ticks[this.range[0] - 1], b = this.ticks[this.range[1] - 1];
    return a && b ? [a.i, b.i] : null;
  }
}

// Left/right move one step, with Shift ten; Home/End the ends. active() decides when.
export function bindKeys(cursor, active) {
  addEventListener('keydown', (e) => {
    if (!active() || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== 'range')) return;
    if (t && t.type === 'range') return;          // a slider handles its own keys
    const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight') { cursor.move(d); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { cursor.move(-d); e.preventDefault(); }
    else if (e.key === 'Home') { cursor.set(0); e.preventDefault(); }
    else if (e.key === 'End') { cursor.set(cursor.ticks.length); e.preventDefault(); }
  });
}
