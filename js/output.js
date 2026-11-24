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

  // The verdict of an audit (A event with a verdict), with its witness. A symbolic or space verdict
  // (PLAN3, a.mode) has rounds and refinements instead of counts.
  auditVerdict(a) {
    const el = this.auditEl;
    if (!el) return;
    el.textContent = '';
    el.hidden = false;
    el.dataset.verdict = a.verdict;
    el.dataset.mode = a.mode || 'enumerate';
    if (a.mode) { this.symbolicVerdict(el, a); this.nextSteps(el, a); return; }
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
    this.nextSteps(el, a);
  }

  // What to do next after a verdict: buttons that call this.onAuditAction(name, a) (js/init.js).
  // Which ones apply depends on the verdict and on the project (this.auditContext()).
  nextSteps(el, a) {
    if (!this.onAuditAction) return;
    const ctx = this.auditContext ? this.auditContext() : {};
    const steps = [];
    const add = (name, label, title) => steps.push({ name, label, title });
    if (a.mode === 'space') {
      if (a.verdict === 'unsound') add('save-and-audit', 'Save it and audit it', 'Keep the instance as a regression instance and audit it by enumeration: the full list of unsound refinements');
      if (a.verdict === 'sound') add('larger-bound', 'Try a larger bound', 'The same space with k two higher');
    } else {
      if (a.verdict === 'unsound' && ctx.observatory) add('candidate-space', 'See it in the candidate space', 'Run with every step recorded and draw every candidate, with the lost solutions marked (Observatory)');
      if (a.verdict === 'limit') add('symbolic', 'Audit by symbolic search', 'The same question in one search, without listing the candidates');
      if (a.verdict === 'sound' || a.verdict === 'unsound') {
        if (ctx.spaces) add('space', 'Check a space', 'Every instance of a space up to a bound: is the verdict the same on the others?');
        else add('write-space', 'Write a space', 'One instance says little about the others: describe all small instances (Instances tab, Spaces)');
      }
    }
    if (!steps.length) return;
    const box = document.createElement('div');
    box.className = 'audit-next';
    const lead = document.createElement('span');
    lead.className = 'note';
    lead.textContent = 'Next: ';
    box.append(lead);
    for (const s of steps) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'control-button small-button';
      b.dataset.action = s.name;
      b.textContent = s.label;
      b.title = s.title;
      b.addEventListener('click', () => this.onAuditAction(s.name, a));
      box.append(b);
    }
    el.append(box);
  }

  symbolicVerdict(el, a) {
    const h = document.createElement('h3');
    const what = a.mode === 'space' ? `Space ${a.space}` : 'Symbolic audit';
    h.textContent = `${what}: ${a.mode === 'space' && a.verdict === 'sound' ? `sound up to k = ${a.k}` : a.verdict === 'unsound' && a.mode === 'space' ? `unsound at k = ${a.k}` : a.verdict}`;
    el.append(h);
    const p = document.createElement('p');
    p.textContent = symbolicDetail(a);
    el.append(p);
    if (a.mode === 'space' && a.perK && a.perK.length) {
      const q = document.createElement('p');
      q.className = 'note space-steps';
      q.textContent = 'Per k: ' + perKText(a.perK);
      el.append(q);
    }
    const w = a.witness;
    if (w) {
      const dl = document.createElement('dl');
      const row = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); return dd; };
      const set = (l) => `{${(l || []).join(' ')}}`;
      if (w.instance != null) {
        const c = Object.entries(w.constants || {}).map(([k, v]) => `${k} = ${v}`).join(', ');
        row(`Instance (k = ${w.k ?? a.k})`, [w.instance, c && `constants ${c}`].filter(Boolean).join('; ') || '(no facts)').className = 'witness-instance';
      }
      row('Candidate', set(w.candidate));
      row('Counterexample', w.counterexample || '(no shown atoms)');
      if (w.kind === 'clauses') row('Clause', set(w.clause));
      else row('Relevant', set(w.relevant));
      row('Lost solution', set(w.solution));
      row('They differ on', set(w.differ));
      el.append(dl);
      const n = document.createElement('p');
      n.className = 'note';
      n.textContent = w.kind === 'clauses'
        ? 'The lost solution falsifies every literal of the clause, so the clause removes it.'
        : 'The lost solution agrees with the candidate on every relevant atom, so the clause removes it too. An atom on which they differ should have been relevant.';
      el.append(n);
      if (w.instance != null && this.onSaveInstance) {
        const b = document.createElement('button');
        b.className = 'control-button save-witness';
        b.type = 'button';
        b.textContent = 'Save as regression instance';
        b.addEventListener('click', () => this.onSaveInstance(a));
        el.append(b);
      }
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

const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;

// The steps of a space audit, runs of sound steps joined: "1-11 sound (1 round each) · 12 unsound (3 rounds)".
function perKText(rows) {
  const out = [];
  for (let i = 0; i < rows.length;) {
    const r = rows[i];
    let j = i;
    if (r.verdict === 'sound') while (j + 1 < rows.length && rows[j + 1].verdict === 'sound') j++;
    if (j > i) {
      const rounds = rows.slice(i, j + 1).map((x) => x.rounds);
      const same = rounds.every((x) => x === rounds[0]) && rounds[0] != null;
      out.push(`${r.k}-${rows[j].k} sound${same ? ` (${plural(rounds[0], 'round')} each)` : ''}`);
    } else out.push(`${r.k} ${r.verdict}${r.rounds != null ? ` (${plural(r.rounds, 'round')})` : ''}`);
    i = j + 1;
  }
  return out.join(' · ');
}

// The panel's explanation under its heading (the result line already says the verdict).
function symbolicDetail(a) {
  const steps = `${plural(a.rounds ?? 0, 'round')} of the inner loop, ${plural(a.refinements ?? 0, 'refinement')}${a.fallback ? ` (${plural(a.fallback, 'block')})` : ''}`;
  const link = a.link ? `Link ${a.link}${(a.kinds || []).length ? ` (${a.kinds.join(' and ')})` : ''}: ` : '';
  if (a.mode === 'space') {
    const n = (a.perK || []).length;
    const what = a.verdict === 'sound' ? `every instance of the space for ${n === 1 ? `k = ${a.k}` : `k up to ${a.k}`} was checked; no refinement removes a solution on any of them. Larger instances are not covered.`
      : a.verdict === 'unsound' ? `the smaller values of k are sound; at k = ${a.k} a clause removes the lost solution below, on the instance shown.`
        : `no verdict at k = ${a.k}${a.reason ? ` (${a.reason})` : ''}; the smaller values of k are sound.`;
    return `${link}${what} Last step: ${steps}.`;
  }
  const what = a.verdict === 'sound' ? 'no candidate, counterexample and solution exist such that the clause removes the solution.'
    : a.verdict === 'unsound' ? 'the counterexample\'s clause removes the lost solution below.'
      : a.verdict === 'budget' ? `no verdict within ${fmt(a.seconds || 60)} s.` : `${a.reason || a.verdict}.`;
  return `${link}${what} ${steps[0].toUpperCase()}${steps.slice(1)}.`;
}

// One line for a symbolic or space verdict (PLAN3), for the result line and the panel.
export function symbolicText(a) {
  const steps = `${plural(a.rounds ?? 0, 'round')}, ${plural(a.refinements ?? 0, 'refinement')}${a.fallback ? ` (${plural(a.fallback, 'block')})` : ''}`;
  if (a.mode === 'space') {
    if (a.verdict === 'sound') return `Space ${a.space}: sound for every instance up to k = ${a.k} (the strategy loses no solution on any of them).`;
    if (a.verdict === 'unsound') return `Space ${a.space}: unsound at k = ${a.k}: a clause removes a solution on the instance shown.`;
    if (a.verdict === 'budget') return `Space ${a.space}: no verdict at k = ${a.k} within the time budget (sound below it).`;
    return `Space ${a.space}: ${a.verdict} at k = ${a.k}${a.reason ? `: ${a.reason}` : ''}.`;
  }
  if (a.verdict === 'sound') return `Symbolic audit: sound for every candidate and counterexample of this instance (${steps}).`;
  if (a.verdict === 'unsound') return `Symbolic audit: unsound. A clause removes a solution (${steps}).`;
  if (a.verdict === 'budget') return `Symbolic audit: no verdict within ${fmt(a.seconds || 60)} s (${steps}).`;
  return `Symbolic audit: ${a.verdict}${a.reason ? ` (${a.reason})` : ''}.`;
}
