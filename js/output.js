// Output tab: result line, solutions, messages, trace.
import { TraceView } from './trace.js';
import { costTracker } from './project.js';
import { resultCard } from './result-card.js';

const SHOW_SOLUTIONS = 1000;
// the refinement kinds of an audit as the loop script writes them: G.clause, G.clauses, G.block
const LINK_KINDS = new Set(['clause', 'clauses', 'block', 'core', 'lift']);
const kindText = (link, kinds) => (kinds || []).map((k) => (LINK_KINDS.has(k) ? `${link}.${k}` : k === 'expand' ? 'expansions' : k)).join(' and ');
const AUDIT_NOTE = 'An audit does not run the loop: no solutions are listed here. Its own counts (candidates, solutions, refinements checked) are in the verdict above and in the Statistics tab.';
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
    this.auditShown = false;
    const te = document.getElementById('trace-empty');
    if (te) te.textContent = 'No steps recorded.';
    this.trace.clear();
    this.result('', '');
    if (this.auditEl) { this.auditEl.hidden = true; this.auditEl.textContent = ''; }
  }

  // The verdict of an audit (A event with a verdict), with its witness and the next steps, as a
  // result card (js/result-card.js). A symbolic or space verdict (PLAN3, a.mode) has rounds and
  // refinements instead of counts.
  auditVerdict(a) {
    const el = this.auditEl;
    if (!el) return;
    el.dataset.mode = a.mode || 'enumerate';
    const w = a.witness;
    const set = (l) => `{${(l || []).join(' ')}}`;
    const rows = [], notes = [], paragraphs = [];
    let title;
    if (a.mode) {
      const B = a.bound || 'k';
      title = `${a.mode === 'space' ? `Space ${a.space}` : 'Symbolic audit'}: ${a.mode === 'space' && a.verdict === 'sound' ? `sound up to ${B} = ${a.k}`
        : a.mode === 'space' && a.verdict === 'unsound' ? `unsound at ${spaceAt(a)}` : a.verdict}`;
      paragraphs.push(symbolicDetail(a));
      if (a.mode === 'space' && a.perK && a.perK.length) paragraphs.push({ class: 'note space-steps', text: `Per ${B}: ` + perKText(a.perK) });
      if (w && w.instance != null) {
        const c = Object.entries(w.constants || {}).map(([k, v]) => `${k} = ${v}`).join(', ');
        rows.push([`Instance (${B} = ${w.k ?? a.k})`, [w.instance, c && `constants ${c}`].filter(Boolean).join('; ') || '(no facts)', { class: 'witness-instance' }]);
      }
    } else {
      title = a.verdict === 'sound' ? 'Audit: sound' : a.verdict === 'unsound' ? 'Audit: unsound' : 'Audit: limit';
      paragraphs.push(a.verdict === 'limit' ? `More than ${fmt(a.limit)} candidates.`
        : `Link ${a.link} (refined with ${kindText(a.link, a.kinds)}): ${fmt(a.candidates)} candidates, ${fmt(a.solutions)} solutions, ` +
          `${fmt(a.counterexamples)} counterexamples, ${fmt(a.pairs)} distinct refinements checked. ` +
          (a.verdict === 'sound' ? 'No refinement removes a solution of this instance.'
            : `${fmt(a.unsound)} refinements remove a solution; ${fmt(a.at_risk)} solutions are at risk.`));
    }
    if (w) {
      rows.push(['Candidate', set(w.candidate)], ['Counterexample', w.counterexample || '(no shown atoms)']);
      if (w.kind === 'clause') rows.push(['Relevant', set(w.relevant)]);
      else if (w.kind === 'clauses') rows.push(['Clause', set(w.clause)]);
      else if (w.kind === 'core') rows.push(['Core atoms', set(w.relevant)]);
      else rows.push([`Facts of ${w.part}`, (w.facts || []).join(' ')]);
      rows.push(['Lost solution', set(w.solution)], ['They differ on', set(w.differ)]);
      notes.push(w.kind === 'clauses' ? 'The lost solution falsifies every literal of the clause, so the clause removes it.'
        : w.kind === 'clause' || w.kind === 'core' ? 'The lost solution agrees with the candidate on every relevant atom, so the clause removes it too. An atom on which they differ should have been relevant.'
          : 'Grounding the refine part with these facts leaves the lost solution without a model.');
    }
    // what "unsound" means for a run: it can lose a solution, not that every run does
    if (w && a.verdict === 'unsound') {
      notes.push('Unsound means that the loop can lose a solution: when its search proposes this candidate and the check answers with this counterexample, '
        + 'the refinement removes the lost solution. A run loses it only if its search goes that way; its search order (seed, solver options) decides, '
        + 'so a run on this instance may well find every solution. The audit is the proof that the strategy is wrong; a run is one example.');
    }
    if (a.empty) notes.push(`${fmt(a.empty)} counterexamples have no relevant atom: a run adds the empty clause there, which ends the search (unsound when a solution is still left).`);
    resultCard(el, { verdict: a.verdict, title, paragraphs, rows, notes, actions: this.nextSteps(a) });
    // an audit does not run the loop: say so where its solutions and trace would be
    this.auditShown = true;
    this.solNote.textContent = AUDIT_NOTE;
    const te = document.getElementById('trace-empty');
    if (te) te.textContent = 'An audit does not run the loop, so it has no trace. Press Run to see the loop step by step.';
  }

  // What to do next after a verdict: buttons that call this.onAuditAction(name, a) (js/init.js),
  // and the space witness's "Save as regression instance" (this.onSaveInstance). Which apply
  // depends on the verdict and on the project (this.auditContext()).
  nextSteps(a) {
    const steps = [];
    const act = (name, label, title, extra = {}) => steps.push({ name, label, title, onClick: () => this.onAuditAction(name, a), ...extra });
    if (a.witness && a.witness.instance != null && this.onSaveInstance) {
      steps.push({ name: 'save', label: 'Save as regression instance', class: 'save-witness', title: 'Keep the instance the space broke on', onClick: () => this.onSaveInstance(a) });
    }
    if (!this.onAuditAction) return steps;
    const ctx = this.auditContext ? this.auditContext() : {};
    if (a.mode === 'space') {
      if (a.verdict === 'unsound') act('save-and-audit', 'Save it and audit it', 'Keep the instance as a regression instance and audit it by enumeration: the full list of unsound refinements');
      if (a.verdict === 'unsound') act('space-seed-sweep', 'Find a run that loses it', 'Run the instance to all solutions with a randomized search, seeds 1 to 50, until a run finds fewer solutions than there are; then record that run and show its bad refinement in the candidate space (Observatory)');
      if (a.verdict === 'unsound' && ctx.observatory) act('space-candidate-space', 'See it in the candidate space', 'Keep the instance as a regression instance, run the loop on it with every step recorded, and draw every candidate (Observatory). The map shows the refinements this run makes; its search order may avoid the unsound one, which the witness above shows.');
      if (a.verdict === 'sound') act('larger-bound', 'Try a larger bound', `The same space with ${a.bound || 'k'} two higher`);
    } else {
      if (a.verdict === 'unsound') act('seed-sweep', 'Find a run that loses it', 'Run the instance to all solutions with a randomized search, seeds 1 to 50, until a run finds fewer solutions than there are; then record that run and show its bad refinement in the candidate space (Observatory)');
      if (a.verdict === 'unsound' && ctx.observatory) act('candidate-space', 'See it in the candidate space', 'Run with every step recorded and draw every candidate, with the lost solutions marked (Observatory)');
      if (a.verdict === 'limit') act('symbolic', 'Audit by symbolic search', 'The same question in one search, without listing the candidates');
      if (a.verdict === 'sound' || a.verdict === 'unsound') {
        if (ctx.spaces) act('space', 'Check a space', 'Every instance of a space up to a bound: is the verdict the same on the others?');
        else act('write-space', 'Write a space', 'One instance says little about the others: describe all small instances (Instances tab, Spaces)');
      }
    }
    return steps;
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
    this.solNote.textContent = this.auditShown ? AUDIT_NOTE : this.solutions > SHOW_SOLUTIONS ? `The first ${fmt(SHOW_SOLUTIONS)} solutions are shown.` : '';
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
function perKText(rows0) {
  // with ranged parameters a k has one row per combination: one entry per k (its worst verdict)
  const rows = [];
  for (const r of rows0) {
    const last = rows[rows.length - 1];
    if (last && last.k === r.k) {
      if (last.verdict === 'sound' && r.verdict !== 'sound') last.verdict = r.verdict;
      if (last.rounds !== r.rounds) last.rounds = null;
    } else rows.push({ ...r });
  }
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

// Where a space audit stopped: "n = 4", or "n = 4, m = 2" with ranged parameters.
export function spaceAt(a) {
  return [`${a.bound || 'k'} = ${a.k}`, ...Object.entries(a.params || {}).map(([x, v]) => `${x} = ${v}`)].join(', ');
}

// The panel's explanation under its heading (the result line already says the verdict).
function symbolicDetail(a) {
  const steps = `${plural(a.rounds ?? 0, 'round')} of the inner loop, ${plural(a.refinements ?? 0, 'refinement')}${a.fallback ? ` (${plural(a.fallback, 'block')})` : ''}`;
  const link = a.link ? `Link ${a.link}${(a.kinds || []).length ? ` (refined with ${kindText(a.link, a.kinds)})` : ''}: ` : '';
  if (a.mode === 'space') {
    const B = a.bound || 'k';
    const n = new Set((a.perK || []).map((r) => r.k)).size;
    // the first value of the bound (the space's "from"): a space may start above 1
    const k0 = (a.perK || []).length ? a.perK[0].k : a.k;
    const range = n === 1 ? `${B} = ${a.k}` : k0 > 1 ? `${B} from ${k0} up to ${a.k}` : `${B} up to ${a.k}`;
    const below = k0 > 1 ? `the values of ${B} from ${k0} on below ${a.k} are sound (the space starts at ${B} = ${k0})` : `the smaller values of ${B} are sound`;
    const others = Object.keys(a.params || {}).length ? ` (with every value of ${Object.keys(a.params).join(', ')} in its range)` : '';
    const what = a.verdict === 'sound' ? `every instance of the space for ${range}${others} was checked; no refinement removes a solution on any of them. Larger instances are not covered.`
      : a.verdict === 'unsound' ? (a.k === k0 && k0 > 1 ? `at ${spaceAt(a)}, the first value of the space, a clause removes the lost solution below, on the instance shown.`
        : `${below}; at ${spaceAt(a)} a clause removes the lost solution below, on the instance shown.`)
        : `no verdict at ${spaceAt(a)}${a.reason ? ` (${a.reason})` : ''}${a.k === k0 ? '' : `; ${below}`}.`;
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
    if (a.verdict === 'sound') return `Space ${a.space}: sound for every instance up to ${a.bound || 'k'} = ${a.k} (the strategy loses no solution on any of them).`;
    if (a.verdict === 'unsound') return `Space ${a.space}: unsound at ${spaceAt(a)}: a clause removes a solution on the instance shown.`;
    if (a.verdict === 'budget') return `Space ${a.space}: no verdict at ${spaceAt(a)} within the time budget (sound below it).`;
    return `Space ${a.space}: ${a.verdict} at ${spaceAt(a)}${a.reason ? `: ${a.reason}` : ''}.`;
  }
  if (a.verdict === 'sound') return `Symbolic audit: sound for every candidate and counterexample of this instance (${steps}).`;
  if (a.verdict === 'unsound') return `Symbolic audit: unsound. A clause removes a solution (${steps}).`;
  if (a.verdict === 'budget') return `Symbolic audit: no verdict within ${fmt(a.seconds || 60)} s (${steps}).`;
  return `Symbolic audit: ${a.verdict}${a.reason ? ` (${a.reason})` : ''}.`;
}
