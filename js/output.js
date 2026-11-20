// Output tab: result line, solutions, messages, trace.
import { TraceView } from './trace.js';

const SHOW_SOLUTIONS = 1000;
const MAX_MESSAGES = 2000;
export const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n == null ? '–' : String(n));

export class Output {
  constructor(app) {
    this.app = app;
    this.resultEl = document.getElementById('result-line');
    this.solEl = document.getElementById('solutions');
    this.solCount = document.getElementById('solutions-count');
    this.solNote = document.getElementById('solutions-note');
    this.msgEl = document.getElementById('messages');
    this.trace = new TraceView(document.getElementById('trace'));
    this.clear();
  }

  clear() {
    this.solutions = 0;
    this.pendingSolutions = [];
    this.warnings = new Map();
    this.messages = 0;
    this.lastLines = [];
    this.solEl.textContent = '';
    this.msgEl.textContent = '';
    this.solCount.textContent = '';
    this.solNote.textContent = '';
    this.trace.clear();
    this.result('', '');
  }

  result(text, kind = '') {
    this.resultEl.textContent = text || 'No run yet.';
    this.resultEl.className = 'result-line' + (kind ? ' ' + kind : '');
  }

  // Batched DOM updates.
  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.flush(); });
  }
  flush() {
    if (this.pendingSolutions.length) {
      const frag = document.createDocumentFragment();
      for (const m of this.pendingSolutions) {
        const li = document.createElement('li');
        li.value = m.n;
        li.textContent = m.atoms || '(no shown atoms)';
        if (m.cost && m.cost.length) {
          const c = document.createElement('span');
          c.className = 'cost';
          c.textContent = 'cost ' + m.cost.join(' ');
          li.append(c);
        }
        frag.append(li);
      }
      this.solEl.append(frag);
      this.pendingSolutions = [];
    }
    this.solCount.textContent = this.solutions ? `(${fmt(this.solutions)})` : '';
    this.solNote.textContent = this.solutions > SHOW_SOLUTIONS ? `The first ${fmt(SHOW_SOLUTIONS)} solutions are shown.` : '';
    this.trace.render();
  }

  solution(m) {
    this.solutions++;
    if (this.solutions <= SHOW_SOLUTIONS) this.pendingSolutions.push(m);
    this.schedule();
  }

  message(text, kind = '') {
    if (this.messages >= MAX_MESSAGES) {
      if (this.messages === MAX_MESSAGES) this.addMsg(`(more than ${fmt(MAX_MESSAGES)} messages; the rest is not shown)`, 'warning');
      this.messages++;
      return null;
    }
    this.messages++;
    return this.addMsg(text, kind);
  }
  addMsg(text, kind) {
    const d = document.createElement('div');
    d.className = 'msg' + (kind ? ' ' + kind : '');
    d.textContent = text;
    this.msgEl.append(d);
    return d;
  }

  // clingo messages, grouped by solver + code + message with a count
  warning(w) {
    const key = `${w.solver}|${w.code}|${w.message}`;
    const g = this.warnings.get(key);
    if (g) {
      g.count++;
      g.countEl.textContent = ` (×${fmt(g.count)})`;
      return;
    }
    const d = this.message(`${w.solver}: ${w.code}: ${w.message}`, 'warning');
    if (!d) return;
    const c = document.createElement('span');
    c.className = 'count';
    d.append(c);
    this.warnings.set(key, { count: 1, countEl: c });
  }

  log(text) { this.message(text); }

  line(text, isErr) {
    this.lastLines.push(text);
    if (this.lastLines.length > 20) this.lastLines.shift();
    this.message(text, isErr ? 'error' : '');
  }

  error(text) { this.message(text, 'error'); }

  problems(list) {
    for (const p of list) {
      const w = p.where || {};
      const at = w.kind === 'fragment' ? `fragment ${w.name}, line ${w.line}` : w.kind === 'loop' ? `loop script, line ${w.line}` : `settings (${w.name})`;
      this.message(`${p.severity === 'error' ? 'Error' : 'Warning'} in ${at}: ${p.message}`, p.severity === 'error' ? 'error' : 'warning');
    }
  }
}
