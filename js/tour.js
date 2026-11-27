// The guided tour: a first run of CegarPlay, for new users (adapted from logic-game's js/tutorial.js).
//
// A card in a corner of the screen explains one thing at a time, and the part of the page it is
// about is highlighted. Some steps wait until the user did something (opened a tab, ran the
// loop, stepped through the trace, ran the audit); "Do it for me" does it for them. The tour
// loads the example "Sum-free sets"; an edited project is kept as an automatic snapshot first
// (Undo, or Project > Workspace and snapshots, brings it back).
//
// It starts by itself on a first visit (js/init.js) and from "Guided tour" on Home, in Settings
// and with ?tour=1. Only the page uses this module.
//
// What it needs from the page (`app`): loadExample, snapshotBefore, edited, control (busy,
// ends: the number of runs and audits that ended, lastEnd: { mode, state }), output.trace.
import { $ } from './dom.js';
import { escapeHtml as esc } from './util.js';

export const TOUR_KEY = 'cegarplay.tour';
export const TOUR_EXAMPLE = 'tutorial-first-run';
const POLL_MS = 200;

// a tab's label; for a sub-tab whose row is not shown, its group tab (Results, Analyse, Learn)
const tabLabel = (id) => {
  const l = document.querySelector(`#tab-bar label[for="${id}"]`);
  if (!l || l.offsetParent !== null) return l;
  const g = l.closest('.sub-tabs');
  return (g && document.getElementById(`group-${g.dataset.group}`)) || l;
};
const tabOpen = (id) => $(id).checked;
function openTab(id) {
  const r = $(id);
  if (r.checked) return;
  r.checked = true;
  r.dispatchEvent(new Event('change', { bubbles: true }));
}

function makeSteps(app) {
  const c = app.control;
  // runs (or audits) that ended since a step began
  let endsAt = 0;
  const mark = () => { endsAt = c.ends; };
  const ended = (mode) => c.ends > endsAt && c.lastEnd && c.lastEnd.mode === mode;
  const trace = () => app.output.trace;
  return [
    {
      title: 'Welcome to CegarPlay',
      text: () => `<p>CegarPlay runs <b>CEGAR loops</b> (counterexample-guided abstraction refinement) written in
        answer set programming, with clingo running in your browser. One solver proposes
        <i>candidates</i>, a second one looks for a <i>counterexample</i> to each, and every counterexample
        becomes a <i>refinement</i> that rules out the candidate and many like it.</p>
        <p>This tour takes about five minutes. It loads a small example, <i>Sum-free sets</i>, runs it and
        shows where to read the results.${app.edited ? ' The project you are editing is kept as a snapshot first: <b>Undo</b> brings it back.' : ''}</p>`,
      next: 'Start the tour',
      skip: true,
    },
    {
      title: 'The project',
      target: () => document.querySelector('.project-box'),
      enter: () => openTab('tab1'),
      text: `<p>The example is loaded: a set of numbers is <b>sum-free</b> if no two members (possibly the
        same one twice) add up to a third. The loop lists all sum-free subsets of 1..8.</p>
        <p>Solver <tt>A</tt> guesses any set of numbers; solver <tt>C</tt> looks for a sum inside it. The
        <b>Example library</b> under this box has more than 150 examples to load later.</p>`,
    },
    {
      title: 'The programs',
      target: () => tabLabel('tab3'),
      text: '<p>The problem is written in the <b>Programs</b> tab. Open it.</p>',
      done: () => tabOpen('tab3'),
      doIt: () => openTab('tab3'),
      autoNext: true,
    },
    {
      title: 'Fragments',
      target: () => $('fragments'),
      enter: () => openTab('tab3'),
      text: `<p>The problem is split into <b>fragments</b>, named pieces of ASP text:</p>
        <ul><li><b>abstraction</b>: <tt>{ pick(X) : num(X) }.</tt> the candidates (any set);</li>
        <li><b>glue</b>: the <i>interface atoms</i>, which both solvers talk about (here <tt>pick/1</tt>);</li>
        <li><b>check</b>: has an answer set exactly when the candidate is wrong (a sum inside it), and marks with
        <tt>relevant/1</tt> the atoms that the counterexample depends on.</li></ul>
        <p>The <b>?</b> next to a fragment's name explains it.</p>`,
    },
    {
      title: 'The loop',
      target: () => tabLabel('tab4'),
      text: '<p>How the solvers work together is written in the <b>Loop</b> tab. Open it.</p>',
      done: () => tabOpen('tab4'),
      doIt: () => openTab('tab4'),
      autoNext: true,
    },
    {
      title: 'The loop script',
      target: () => $('loop-editor'),
      enter: () => openTab('tab4'),
      text: `<p>The first lines declare the <b>solvers</b> (each grounds a list of fragments) and a
        <b>link</b> <tt>G</tt> between them, through the glue.</p>
        <p><tt>search A:</tt> runs solver <tt>A</tt>; for each candidate <tt>M</tt>, solver <tt>C</tt> is asked for a
        counterexample <tt>X</tt>. If there is one, <tt>reject M with G.clause(M, X)</tt> adds the refinement:
        one of the atoms marked relevant must change. A candidate that is not rejected is a solution.</p>
        <p>Point at a word of the script for its meaning; the line under the editor explains the statement
        at the cursor.</p>`,
    },
    {
      title: 'Run it',
      target: () => $('run-button'),
      enter: mark,
      text: `<p>Press <b>Run</b> (or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>, from anywhere on the page). The line under the
        top bar shows the counts while the loop runs.</p>`,
      done: () => ended('run'),
      doIt: () => { if (!c.busy) c.run(); },
      after: () => `<p>Done: <b>${esc($('result-line').textContent.trim())}</b></p>
        <p>107 candidates, 46 counterexamples and 46 refinements: 46 clauses were enough for a search over 256 sets,
        because each clause rules out every set that holds the same sum.</p>`,
    },
    {
      title: 'The results',
      target: () => tabLabel('tab5'),
      text: '<p>The <b>Output</b> tab shows the result of the run. Open it: <b>Results</b> in the tab row, then <b>Output</b>.</p>',
      done: () => tabOpen('tab5'),
      doIt: () => openTab('tab5'),
      autoNext: true,
    },
    {
      title: 'Step through the trace',
      target: () => $('trace'),
      enter: () => openTab('tab5'),
      text: `<p>Above it, <b>Solutions</b> lists the 61 sum-free sets. The <b>Trace</b> shows the run one
        step at a time: the candidate, the counterexample, and the refinement (candidate atoms in the refinement
        are highlighted).</p>
        <p>Go to the next step with <b>Next</b>, or with the <kbd>&#x2192;</kbd> key (<kbd>&#x2190;</kbd> goes back).</p>`,
      done: () => trace().pos > 0,
      doIt: () => trace().go(trace().pos + 1),
      after: () => `<p>In step 1 the candidate <tt>pick(2) pick(4)</tt> has the counterexample <tt>sum(2,2)</tt>
        (2 + 2 = 4), so the clause says: never 2 and 4 together.</p>`,
    },
    {
      title: 'Statistics',
      target: () => tabLabel('tab6'),
      text: `<p>The <b>Statistics</b> tab has the counts, a table per solver (solve calls, time, clasp's counters),
        the lengths of the refinement clauses, charts over time, and the <b>run history</b>: one row per run, to
        compare loops on the same problem. Have a look.</p>`,
      done: () => tabOpen('tab6'),
      doIt: () => openTab('tab6'),
    },
    {
      title: 'Is the loop right? The audit',
      target: () => $('audit-group'),
      enter: mark,
      text: `<p>A loop can be wrong in quiet ways: a refinement that removes a real solution, or a check that misses
        a counterexample. <b>Audit</b> checks every candidate and every refinement of this instance against the
        solutions. Press it.</p>`,
      done: () => ended('audit'),
      doIt: () => { if (!c.busy) c.auditPicked(); },
      // (the result line: one whole sentence; the audit panel has more, in the Output tab)
      after: () => `<p><b>${esc($('result-line').textContent.trim())}</b></p>
        <p>The details (which refinements were checked, and any that would remove a solution) are in the Output tab.</p>`,
    },
    {
      title: 'Help on the way',
      target: () => document.querySelector('#tab-bar'),
      text: `<p>Each tab has a <b>?</b> next to its title that explains it. <kbd>?</kbd> lists the keyboard shortcuts:
        <kbd>1</kbd>&hellip;<kbd>9</kbd> open the tabs, <kbd>&#x2190;</kbd> <kbd>&#x2192;</kbd> step through a trace.</p>
        <p>Your work is kept in this browser as you edit. The <b>Project</b> menu downloads it, shares it as a link,
        and keeps snapshots of versions.</p>`,
    },
    {
      title: 'Where next',
      text: `<p>That is the basic cycle: <b>write</b> (Programs, Loop, Instances), <b>run</b> or <b>audit</b>, and
        <b>read</b> the results (Output, Statistics).</p>
        <p>The <a href="#" data-open-tab="tab2">Tutorial</a> tab has lessons with an example each, the
        <a href="guide/" target="cegarplay-guide">Guide</a> is a course on designing CEGAR loops,
        <a href="#" data-loop-walkthrough>The loop language, step by step</a> explains every line of a loop script, and
        <a href="#" data-dialog="dialog-settings">Settings</a> switches on the advanced tabs (Observatory, Campaign,
        Refinery). This tour is on Home and in Settings, to take again.</p>`,
      next: 'Finish',
    },
  ];
}


// ---- the short tours of the advanced tabs: started from the tab's help and from Settings (js/init.js)
const tabTarget = (id) => () => { const e = document.getElementById(id); return e && !e.hidden && e.offsetParent !== null ? e : null; };
export const TAB_TOURS = {
  tab11: {
    key: 'cegarplay.tour.observatory',
    steps: () => [
      { title: 'The Observatory', text: `<p>The last run (or an opened recording) as pictures. Run something first if the tab is empty;
        a run recorded with every step and call (Run options, <b>record steps and calls</b>) shows everything.</p>`, next: 'Show me', skip: true },
      { title: 'One cursor for all', target: tabTarget('cursor-region'), text: `<p>The cursor bar picks a step of the run, and every picture
        below follows it. <kbd>&#x2190;</kbd> <kbd>&#x2192;</kbd> move it a step (<kbd>Shift</kbd>: ten), <kbd>Home</kbd> <kbd>End</kbd> to the ends;
        <b>follow the run</b> keeps it on the last step while a run goes on.</p>` },
      { title: 'Loop anatomy', target: tabTarget('anatomy'), text: `<p>One box per solver and one arrow per link, with the calls of each;
        a link flashes at each step through it. With <b>Record calls</b> (Loop tab) a timeline shows every solve call and
        the time each line of the loop script costs.</p>` },
      { title: 'The problem\'s own pictures', target: () => tabTarget('domain-view')() || tabTarget('candidate-space')(), text: `<p>The
        <b>Domain view</b> draws a step in the problem's terms (a small ASP program: <b>New view</b> starts one). The
        <b>Candidate space</b> shows every candidate of a small instance at once, and which refinement removed it.</p>`, next: 'Finish' },
    ],
  },
  tab10: {
    key: 'cegarplay.tour.campaign',
    steps: () => [
      { title: 'The Campaign', text: `<p>Many runs, compared. A <b>suite</b> is a grid of instances &times; variants &times; solver seeds;
        each cell is one run with all solutions, and several run at a time.</p>`, next: 'Show me', skip: true },
      { title: 'A suite', target: tabTarget('suite-select'), text: `<p>Pick a suite of the project (or write one), then <b>Start</b>. The rows are
        kept in this browser: a later Start runs only the cells that are missing, and an edit reruns only the cells it touches.</p>` },
      { title: 'Progress', target: tabTarget('campaign-grid'), text: `<p>One square per cell; hover it to see which. An instance whose
        variants disagree on the solutions turns red: one of the loops is wrong.</p>` },
      { title: 'The matrix and the plots', target: () => tabTarget('campaign-matrix-box')() || tabTarget('campaign-plots')(), text: `<p>One row per
        instance, one column per variant (time, solutions, candidates or refinements); click a heading to sort. The plots
        compare variants as the instances grow.</p>`, next: 'Finish' },
    ],
  },
  tab12: {
    key: 'cegarplay.tour.refinery',
    steps: () => [
      { title: 'The Refinery', text: `<p>What a loop <i>could</i> have done, not only what it did: at one step, every refinement that was
        possible there; over a run, the shortest and the longest runs that the same refinements allow. For small instances:
        it enumerates the candidate space, in a worker of its own.</p>`, next: 'Show me', skip: true },
      { title: 'First: the space', target: tabTarget('lab-compute'), text: `<p><b>Compute space</b> enumerates the candidates of the audited link
        and their counterexamples. Every other part rests on it, and says so while it is disabled.</p>` },
      { title: 'One step, every option', target: tabTarget('lab-inspect'), text: `<p>Pick a refinement of the run (<kbd>&#x2190;</kbd> <kbd>&#x2192;</kbd> step
        through them): the table lists every clause that was possible there, which are sound, and how much each prunes.</p>` },
      { title: 'Best and worst runs', target: tabTarget('lab-bounds'), text: `<p>The shortest and longest runs that the loop's refinements
        allow, next to the length of your run: is the loop's choice of refinement good, or lucky?</p>`, next: 'Finish' },
    ],
  },
};

export class Tour {
  // opts: { steps, key, begin } for a tour of its own (TAB_TOURS); none: the guided tour
  constructor(app, opts = {}, storage = (() => { try { return localStorage; } catch { return null; } })()) {
    this.app = app;
    this.storage = storage;
    this.key = opts.key || TOUR_KEY;
    this.main = !opts.steps;
    this.opts = opts;
    this.steps = opts.steps ? opts.steps(app) : makeSteps(app);
    this.lineMarks = [];
    this.index = -1;
    this.timer = 0;
    this.target = null;
    this.card = null;
  }

  // ---- remembering that the tour was seen (offered once; Reset everything forgets it)
  get seen() {
    try { return !!(this.storage && this.storage.getItem(this.key)); } catch { return false; }
  }
  remember(state) {
    try { this.storage.setItem(this.key, JSON.stringify({ state, at: new Date().toISOString() })); } catch { /* offered again */ }
  }

  get running() { return this.index >= 0; }

  // the first card only (the welcome); the example is loaded when the user starts
  offer() {
    if (this.running) return;
    this.makeCard();
    this.go(0);
  }

  async begin() {
    const app = this.app;
    if (this.opts.begin) { const ok = await this.opts.begin(app); if (ok) this.remember('started'); return ok; }
    if (!this.main) { this.remember('started'); return true; }
    if (app.control.busy) { window.alert('Not possible during a run.'); return false; }
    if (app.edited) app.snapshotBefore('the guided tour');
    await app.loadExample(TOUR_EXAMPLE);
    this.remember('started');
    return true;
  }

  // start from the beginning (Home, Settings, ?tour=1)
  start() {
    this.stop(false, false);
    this.offer();
  }

  // leaving a step: its own clean-up, and the lines it marked in the loop editor
  leave() {
    const step = this.steps[this.index];
    if (step && step.leave) step.leave();
    const ed = this.app.editors && this.app.editors.loop;
    for (const id of this.lineMarks) if (ed) ed.session.removeMarker(id);
    this.lineMarks = [];
  }

  // mark lines a..b (from 1) of the loop editor, and bring them into view
  markLines([a, b]) {
    const ed = this.app.editors && this.app.editors.loop;
    if (!ed || !window.ace) return;
    const Range = ace.require('ace/range').Range;
    this.lineMarks.push(ed.session.addMarker(new Range(a - 1, 0, b - 1, 1), 'tour-line', 'fullLine'));
    ed.renderer.updateBackMarkers && ed.renderer.updateBackMarkers();
  }

  stop(finished = false, store = true) {
    clearInterval(this.timer);
    this.timer = 0;
    this.leave();
    this.highlight(null);
    if (this.card) this.card.remove();
    this.card = null;
    const was = this.index;
    this.index = -1;
    if (store && was >= 0) this.remember(finished ? 'finished' : 'closed');
  }

  go(index) {
    clearInterval(this.timer);
    this.leave();
    this.index = index;
    const step = this.steps[index];
    step.completed = false;
    if (step.enter) step.enter();
    this.render();
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.card.querySelector('.tour-body').focus({ preventScroll: true });
  }

  poll() {
    const step = this.steps[this.index];
    if (!step) return;
    // (the target can change, e.g. when a tab opens)
    if (step.target && step.target() !== this.target) this.highlight(step.target(), true);
    if (!step.done || step.completed || !step.done()) return;
    step.completed = true;
    if (step.autoNext) this.go(this.index + 1);
    else this.render();
  }

  highlight(el, scroll = false) {
    if (this.target) this.target.classList.remove('tour-target');
    this.target = el || null;
    if (!this.target) return;
    this.target.classList.add('tour-target');
    if (scroll) this.scrollTo(this.target);
  }

  // scroll the target into view, clear of the sticky bars and of the card (on phones it covers
  // the bottom of the screen)
  scrollTo(el) {
    const r = el.getBoundingClientRect();
    if (!r.height && !r.width) return;
    const top = (document.getElementById('topbar')?.offsetHeight || 0) + 10;
    const card = this.card.getBoundingClientRect();
    const bottom = card.left < 100 ? card.top : innerHeight;
    if (r.top < top || r.bottom > bottom - 10) {
      const y = scrollY + r.top - top - Math.max(0, (bottom - top - Math.min(r.height, (bottom - top) * 0.6)) / 3);
      scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  }

  makeCard() {
    if (this.card) return;
    const card = document.createElement('div');
    card.id = 'tour-card';
    card.className = 'tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-labelledby', 'tour-title');
    card.innerHTML = `
      <div class="tour-head">
        <span id="tour-title" class="tour-title"></span>
        <span class="tour-count"></span>
        <button type="button" class="tour-close" title="Close the tour" aria-label="Close the tour">&#x2715;</button>
      </div>
      <div class="tour-body" tabindex="-1" aria-live="polite"></div>
      <div class="tour-buttons">
        <button type="button" class="control-button tour-back">Back</button>
        <button type="button" class="control-button tour-skip">Not now</button>
        <button type="button" class="control-button tour-do-it">Do it for me</button>
        <button type="button" class="control-button primary-button tour-next">Next</button>
      </div>`;
    card.querySelector('.tour-close').addEventListener('click', () => this.stop(this.index === this.steps.length - 1));
    card.querySelector('.tour-skip').addEventListener('click', () => this.stop(false));
    card.querySelector('.tour-back').addEventListener('click', () => this.go(Math.max(this.main ? 1 : 0, this.index - 1)));
    card.querySelector('.tour-next').addEventListener('click', async () => {
      if (this.index === this.steps.length - 1) { this.stop(true); return; }
      if (this.index === 0) {
        const b = card.querySelector('.tour-next');
        b.disabled = true;
        let ok = false;
        try { ok = await this.begin(); } catch (e) { window.alert(`The tour could not load its example: ${e.message || e}`); }
        if (!this.card) return;
        b.disabled = false;
        if (!ok) return;
      }
      this.go(this.index + 1);
    });
    card.querySelector('.tour-do-it').addEventListener('click', async () => {
      const step = this.steps[this.index];
      if (step.doIt) await step.doIt();
      this.poll();
    });
    // the links of the last card (a tab, Settings) end the tour; js/topbar.js follows them
    card.querySelector('.tour-body').addEventListener('click', (e) => {
      if (e.target.closest('a[data-open-tab], a[data-dialog]')) this.stop(this.index === this.steps.length - 1);
    });
    document.body.append(card);
    this.card = card;
  }

  render() {
    const step = this.steps[this.index];
    const card = this.card;
    const waiting = !!step.done && !step.completed;
    card.querySelector('.tour-title').textContent = step.title;
    card.querySelector('.tour-count').textContent = !this.main ? `${this.index + 1} of ${this.steps.length}` : this.index ? `${this.index} of ${this.steps.length - 1}` : '';
    card.querySelector('.tour-body').innerHTML = (typeof step.text === 'function' ? step.text() : step.text) + (step.completed && step.after ? `<div class="tour-after">${step.after()}</div>` : '');
    card.querySelector('.tour-back').hidden = this.index <= (this.main ? 1 : 0);
    card.querySelector('.tour-skip').hidden = !step.skip;
    card.querySelector('.tour-do-it').hidden = !(step.doIt && waiting);
    const next = card.querySelector('.tour-next');
    next.textContent = step.next || 'Next';
    next.disabled = waiting;
    next.title = waiting ? 'Do what the card asks first (or "Do it for me")' : '';
    card.classList.toggle('waiting', waiting);
    this.highlight(step.target ? step.target() : null, true);
    if (step.lines) { this.leaveMarksOnly(); for (const l of (Array.isArray(step.lines[0]) ? step.lines : [step.lines])) this.markLines(l); }
  }

  leaveMarksOnly() {
    const ed = this.app.editors && this.app.editors.loop;
    for (const id of this.lineMarks) if (ed) ed.session.removeMarker(id);
    this.lineMarks = [];
  }
}
