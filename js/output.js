// Output tab: result line, solutions, messages, trace.
import { TraceView } from './trace.js';
import { costTracker } from './project.js';

const SHOW_SOLUTIONS = 1000;
const MAX_MESSAGES = 2000;
const KEEP_SOLUTIONS = 200000;   // kept for the download
export const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n == null ? '–' : String(n));

export class Output {
  constructor(app) {
    this.app = app;
    this.resultEl = document.getElementById('result-line');
    this.solEl = document.getElementById('solutions');
    this.solCount = document.getElementById('solutions-count');
    this.solNote = document.getElementById('solutions-note');
    this.msgEl = document.getElementById('messages');
    this.dlButton = document.getElementById('download-solutions-button');
    this.dlButton.addEventListener('click', () => this.downloadSolutions());
    this.auditEl = document.getElementById('audit-panel');
    this.trace = new TraceView(document.getElementById('trace'));
    this.clear();
  }

  clear() {
    this.solutions = 0;
    this.namedCounts = {};          // accept M as NAME: count per name
    this.costs = costTracker();      // the costs of this run's solutions (expected.optimum)
    this.pendingSolutions = [];
    this.kept = [];
    this.warnings = new Map();
    this.messages = 0;
    this.lastLines = [];
    this.solEl.textContent = '';
    this.msgEl.textContent = '';
    this.solCount.textContent = '';
    this.solNote.textContent = '';
    this.trace.clear();
    this.result('', '');
    if (this.auditEl) { this.auditEl.hidden = true; this.auditEl.textContent = ''; }
  }

  // The verdict of an audit (A event with a verdict), with its witness.
  auditVerdict(a) {
    const el = this.auditEl;
    if (!el) return;
    el.textContent = '';
    el.hidden = false;
    el.dataset.verdict = a.verdict;
    const h = document.createElement('h3');
    h.textContent = a.verdict === 'sound' ? 'Audit: sound' : a.verdict === 'unsound' ? 'Audit: unsound' : 'Audit: limit';
    el.append(h);
    const p = document.createElement('p');
    p.textContent = a.verdict === 'limit' ? `More than ${fmt(a.limit)} candidates.`
      : `Link ${a.link} (${a.kinds.join(' and ')} refinements): ${fmt(a.candidates)} candidates, ${fmt(a.solutions)} solutions, ` +
        `${fmt(a.counterexamples)} counterexamples, ${fmt(a.pairs)} distinct refinements. ` +
        (a.verdict === 'sound' ? 'No refinement removes a solution of this instance.'
          : `${fmt(a.unsound)} refinements remove a solution; ${fmt(a.at_risk)} solutions are at risk.`);
    el.append(p);
    const w = a.witness;
    if (w) {
      const dl = document.createElement('dl');
      const row = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
      const set = (l) => `{${(l || []).join(' ')}}`;
      row('Candidate', set(w.candidate));
      row('Counterexample', w.counterexample || '(no shown atoms)');
      if (w.kind === 'clause') row('Relevant', set(w.relevant));
      else row(`Facts of ${w.part}`, (w.facts || []).join(' '));
      row('Lost solution', set(w.solution));
      row('They differ on', set(w.differ));
      el.append(dl);
      const n = document.createElement('p');
      n.className = 'note';
      n.textContent = w.kind === 'clause'
        ? 'The lost solution agrees with the candidate on every relevant atom, so the clause removes it too. An atom on which they differ should have been relevant.'
        : 'Grounding the refine part with these facts leaves the lost solution without a model.';
      el.append(n);
    }
    if (a.empty) {
      const e = document.createElement('p');
      e.className = 'note';
      e.textContent = `${fmt(a.empty)} counterexamples have no relevant atom (a run stops there with an error).`;
      el.append(e);
    }
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
    const named = Object.entries(this.namedCounts || {}).map(([k, n]) => `${fmt(n)} ${k}`).join(', ');
    this.solCount.textContent = this.solutions || named ? `(${fmt(this.solutions)}${named ? `; also ${named}` : ''})` : '';
    this.dlButton.hidden = this.solutions === 0;
    this.solNote.textContent = this.solutions > SHOW_SOLUTIONS ? `The first ${fmt(SHOW_SOLUTIONS)} solutions are shown.` : '';
    this.trace.render();
  }

  solution(m) {
    this.solutions++;
    this.costs.add(m.cost);
    if (this.kept.length < KEEP_SOLUTIONS) this.kept.push(m);
    if (this.solutions <= SHOW_SOLUTIONS) this.pendingSolutions.push(m);
    this.schedule();
  }

  solutionsText() {
    const lines = this.kept.map((m) => `${m.n}: ${m.atoms || ''}${m.cost && m.cost.length ? `  % cost ${m.cost.join(' ')}` : ''}`);
    if (this.solutions > this.kept.length) lines.push(`% the first ${this.kept.length} of ${this.solutions} solutions`);
    return lines.join('\n') + '\n';
  }

  downloadSolutions() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.solutionsText()], { type: 'text/plain' }));
    a.download = 'solutions.txt';
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
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
    const where = w.fragment ? ` (fragment ${w.fragment}, line ${w.line})` : '';
    const d = this.message(`solver ${w.solver}${where}: ${w.message.replace(/^[a-z_0-9]+:\d+:[\d:-]+: /, '')}`, /: error: /.test(w.message) ? 'error' : 'warning');
    if (!d) return;
    const c = document.createElement('span');
    c.className = 'count';
    d.append(c);
    this.warnings.set(key, { count: 1, countEl: c });
  }

  log(text) { this.message(text); }

  // a second kind of solution (accept M as NAME): a message line, and a count next to Solutions
  named(d) {
    this.namedCounts[d.label] = d.n;
    this.message(`${d.label} ${d.n}: ${d.atoms || '(no shown atoms)'}${d.cost && d.cost.length ? `  cost ${d.cost.join(' ')}` : ''}`, 'named');
    this.schedule();
  }

  line(text, isErr) {
    this.lastLines.push(text);
    if (this.lastLines.length > 20) this.lastLines.shift();
    this.message(text, isErr ? 'error' : '');
  }

  error(text) { this.message(text, 'error'); }

  // A collapsed block, e.g. a traceback.
  details(summary, text, kind = '') {
    const d = this.message('', kind);
    if (!d) return;
    const det = document.createElement('details');
    const s = document.createElement('summary');
    s.textContent = summary;
    const pre = document.createElement('pre');
    pre.textContent = text;
    det.append(s, pre);
    d.append(det);
  }

  problems(list) {
    for (const p of list) {
      const w = p.where || {};
      const at = w.kind === 'fragment' ? `fragment ${w.name}, line ${w.line}` : w.kind === 'loop' ? `loop script, line ${w.line}` : `settings (${w.name})`;
      this.message(`${p.severity === 'error' ? 'Error' : 'Warning'} in ${at}: ${p.message}`, p.severity === 'error' ? 'error' : 'warning');
    }
  }
}
