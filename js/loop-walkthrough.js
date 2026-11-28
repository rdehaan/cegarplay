// The loop language, step by step: an interactive walkthrough in the Loop tab (a tour, js/tour.js).
// It takes the script of "Sum-free sets" apart line by line (the cards mark the lines in the
// editor) and changes it to show, by running it, what each part does. The texts follow what the
// runtime does (lua/runtime.lua): rt.solver, rt.link, Solver:search, Solver:solve, Link:clause,
// Model:reject, Solver:add, rt.accept. Only the page uses this module.
import { template } from './project.js';
import { $ } from './dom.js';

export const WALKTHROUGH_KEY = 'cegarplay.tour.loop';
const EXAMPLE = 'tutorial-first-run';

const SHAPE1 = `solver A = shared + abstraction
solver C = shared + check
link   G = A -> C via shared + glue

search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
`;

const SHAPE2 = template('shape2');

const squeeze = (t) => t.replace(/#.*$/gm, '').replace(/\s+/g, '');
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export function walkthroughSteps(app) {
  const ed = () => app.editors.loop;
  const script = () => ed().getValue();
  const setScript = (t) => { if (squeeze(script()) !== squeeze(t)) ed().setValue(t, 1); };
  const openLoop = () => { const r = $('tab4'); if (!r.checked) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); } };
  const loopEditor = () => $('loop-editor');
  const c = app.control;
  // a run (not an audit) that ended after the step began, with the script as it is now
  let endsAt = 0, ranWith = '';
  const mark = () => { endsAt = c.ends; ranWith = ''; };
  const ran = () => c.ends > endsAt && c.lastEnd && c.lastEnd.mode === 'run';
  const S = () => app.stats.S || {};
  const run = () => { if (!c.busy) c.run(); };
  const result = () => ($('result-line').textContent || '').trim();
  // the Template list shows the shape the script has
  const pick = (k) => { const sel = $('template-select'); if (sel && sel.value !== k) { sel.value = k; sel.dispatchEvent(new Event('change')); } };
  const base = (t) => () => { openLoop(); setScript(t); pick(t === SHAPE2 ? 'shape2' : 'shape1'); mark(); };
  // the first run's numbers, to compare the experiments with
  const first = { cand: 107, refuted: 46 };

  return [
    {
      title: 'The loop language, step by step',
      text: () => `<p>A loop script is a small program. It runs <b>once, from top to bottom</b>, inside clingo (it is
        compiled to Lua). It has two parts: <b>declarations</b> (the solvers and the links between them), then
        <b>statements</b> (how they call each other).</p>
        <p>This walkthrough takes one script apart, line by line, and changes it to show what each part does: about
        ten minutes. It loads its own copy of the example <i>Sum-free sets</i>${app.edited ? '; the project you are editing is kept as a snapshot first (Undo brings it back)' : ''}.</p>`,
      next: 'Start',
      skip: true,
    },
    {
      title: 'Declarations come first',
      target: loopEditor, lines: [1, 3], enter: base(SHAPE1),
      text: `<p>Lines 1 to 3 are the declarations. They come before every statement and are carried out in order;
        a declaration solves nothing, except that a <tt>link</tt> reads its glue (next cards). By the time the
        statements run, every solver is <b>grounded</b>: clingo has turned its program into a ground program, once, for
        the whole run. Then the statements run, from line 5 on.</p>
        <p>The rest of the script (from line 5) are statements. Blank lines and comments (<tt>#</tt> to the end of the
        line) do nothing; indentation (spaces) makes the blocks, as in Python.</p>`,
    },
    {
      title: 'solver: a clingo instance',
      target: loopEditor, lines: [1, 2],
      text: `<p><tt>solver A = shared + abstraction</tt> makes a clingo instance named <tt>A</tt>. Its program consists
        of the rules of the fragments <tt>shared</tt> and <tt>abstraction</tt> (Programs tab), plus the instance's facts
        when the project has instances; the constants of the Loop tab are passed as <tt>-c n=8</tt>.</p>
        <p>Solvers share nothing: <tt>A</tt> does not see the rules of <tt>check</tt>, and <tt>C</tt> does not see
        those of <tt>abstraction</tt>. The answer sets of <tt>A</tt> are the <b>candidates</b>: here, all 256 subsets of
        1..8. <tt>options "..."</tt> after the fragments would pass clingo options to this solver only.</p>`,
    },
    {
      title: 'link: what two solvers share',
      target: loopEditor, lines: [3, 3],
      text: `<p><tt>link G = A -&gt; C via shared + glue</tt> grounds <tt>shared + glue</tt> on their own, solves them once
        and reads the first answer set. Every atom <tt>glue(T)</tt> in it makes <tt>T</tt> an <b>interface atom</b> of
        <tt>G</tt>: here <tt>pick(1)</tt>, ..., <tt>pick(8)</tt>.</p>
        <p>For each interface atom that occurs in <tt>A</tt>'s ground program (<tt>A</tt> is grounded now): if it is a
        fact in <tt>A</tt>, it becomes a fact in <tt>C</tt>; otherwise <tt>C</tt> gets a free choice <tt>{ T }</tt> and
        an atom <tt>relevant(T)</tt>, false unless a rule of <tt>C</tt> derives it. So <tt>C</tt> can use
        <tt>pick/1</tt> although none of its fragments defines it: its value comes from the candidate.</p>`,
    },
    {
      title: 'search: one search, a block per candidate',
      target: loopEditor, lines: [5, 6],
      text: `<p><tt>search A:</tt> runs <b>one</b> search of <tt>A</tt>: clasp enumerates <tt>A</tt>'s answer sets. Each
        time it has a total assignment, and before it reports it, it calls the block under <tt>on candidate M:</tt>
        with <tt>M</tt> = that candidate. When the block returns:</p>
        <ul><li>if it <b>rejected</b> <tt>M</tt>, the search goes on with the new clause;</li>
        <li>if not, <tt>M</tt> is a <b>solution</b>: it is printed and counted, and a clause over the interface atoms
        is added so that no later candidate has the same values (unless Run options asks for one solution).</li></ul>
        <p>The search ends when <tt>A</tt> has no answer set left (the run is <i>exhausted</i>), or when the number of
        solutions of Run options is reached. <tt>M</tt> is valid only during its call.</p>`,
    },
    {
      title: 'C.solve(assume G(M)): one call of the check',
      target: loopEditor, lines: [7, 7],
      text: `<p><tt>G(M)</tt> is a list of assumptions: every interface atom of <tt>G</tt> with its value in
        <tt>M</tt> (for the set {2, 4}: <tt>pick(2)</tt> and <tt>pick(4)</tt> true, the six others false).</p>
        <p><tt>C.solve(assume E)</tt> is one solve call of <tt>C</tt> under these assumptions: the interface atoms are
        fixed, <tt>C</tt>'s own atoms (<tt>sum/2</tt>, <tt>relevant/1</tt>) are free. It returns <tt>C</tt>'s first
        model (a <b>counterexample</b>) or <tt>none</tt> if <tt>C</tt> has no model under them. <tt>X = ...</tt>
        stores it; unlike <tt>M</tt>, <tt>X</tt> stays valid after the call.</p>`,
    },
    {
      title: 'if X: what counts as true',
      target: loopEditor, lines: [8, 8],
      text: `<p>Only <tt>none</tt> and <tt>false</tt> are false; everything else is true, also <tt>0</tt> and an empty
        list <tt>[]</tt>. <tt>X</tt> is a model or <tt>none</tt>, so <tt>if X:</tt> reads: if the check found a
        counterexample.</p>`,
    },
    {
      title: 'reject M with G.clause(M, X)',
      target: loopEditor, lines: [9, 9],
      text: `<p><tt>G.clause(M, X)</tt> builds a clause: for every interface atom <tt>T</tt> with <tt>relevant(T)</tt>
        true in <tt>X</tt>, the literal "<tt>T</tt> has the other value than in <tt>M</tt>"; the clause is their
        disjunction. In the first step of the trace, <tt>X</tt> holds <tt>sum(2,2)</tt> (2 + 2 = 4) and marks
        <tt>pick(2)</tt> and <tt>pick(4)</tt>; both are true in <tt>M</tt>, so the clause is
        <tt>-pick(2) &or; -pick(4)</tt>. It removes every set with 2 and 4, not only <tt>M</tt>.</p>
        <p><tt>reject M with c</tt> adds <tt>c</tt> to <tt>A</tt>'s running search. It must be false for
        <tt>M</tt> (else the run stops with an error). With no relevant atom the clause is empty, and rejecting with
        it ends the search.</p>`,
    },
    {
      title: 'Try it: run the script',
      target: () => $('run-button'), enter: base(SHAPE1),
      text: '<p>Press <b>Run</b> (or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>).</p>',
      done: () => { const ok = ran() && S().solutions === 61; if (ok) { first.cand = S().candidates; first.refuted = S().candidates - S().solutions; } return ok; },
      doIt: run,
      after: () => `<p>${fmt(S().candidates)} candidates, of which ${fmt(S().candidates - S().solutions)} were refuted (a
        counterexample, then <tt>reject</tt>) and ${fmt(S().solutions)} are solutions. Keep these numbers in mind for the
        next two steps.</p>`,
    },
    {
      title: 'Experiment: a weaker refinement',
      target: loopEditor, lines: [9, 9], enter: base(SHAPE1),
      text: `<p><tt>G.block(M)</tt> is the clause over <b>all</b> interface atoms: "at least one of them changes its value".
        It removes <tt>M</tt> only. Replace <tt>G.clause(M, X)</tt> on line 9 with <tt>G.block(M)</tt>, then run.</p>`,
      done: () => ran() && /rejectMwithG\.block\(M\)/.test(squeeze(script())) && S().solutions === 61,
      doIt: () => { ed().setValue(script().replace('G.clause(M, X)', 'G.block(M)'), 1); run(); },
      after: () => `<p>Still 61 solutions, but ${fmt(S().candidates)} candidates, ${fmt(S().candidates - S().solutions)} of them refuted
        (with <tt>G.clause</tt>: ${fmt(first.cand)} and ${fmt(first.refuted)}): every set that is not sum-free had to be
        proposed and checked on its own. The relevant atoms make the difference: the shorter the clause, the more
        candidates it removes.</p>
        <p>The line under the top bar now says <b>0 counterexamples</b>. The check still found ${fmt(S().candidates - S().solutions)}, but that
        number counts a counterexample only when a refinement is built from it (<tt>G.clause(M, X)</tt> reads
        <tt>X</tt>); <tt>G.block(M)</tt> uses the candidate alone, so they show up as ${fmt(S().candidates - S().solutions)}
        refinements of the kind <i>blocks</i> instead.</p>`,
    },
    {
      title: 'Experiment: not rejected means accepted',
      target: loopEditor, lines: [8, 9], enter: base(SHAPE1),
      text: `<p>Put a <tt>#</tt> in front of lines 8 and 9 (or delete them), so that nothing is ever rejected, and run.</p>`,
      done: () => ran() && !/reject/.test(squeeze(script())) && S().solutions > 61,
      doIt: () => { ed().setValue(script().replace('        if X:\n            reject M with G.clause(M, X)', '        # if X:\n        #     reject M with G.clause(M, X)'), 1); run(); },
      after: () => `<p>${fmt(S().solutions)} solutions: every subset of 1..8. A candidate that the block does not reject is
        a solution, whatever the check found: the check only matters through <tt>reject</tt>.</p>`,
    },
    {
      title: 'The same loop without search',
      target: loopEditor, lines: [5, 13], enter: base(SHAPE2),
      text: `<p>The script is now the template <b>Shape 2</b> (Loop tab, Template: the list shows it), word for word.
        No search here: each candidate is a separate solve. (The template gives <tt>C</tt> the option
        <tt>--heuristic=Domain</tt>; it acts only on <tt>#heuristic</tt> statements, and this check has none.)</p>
        <ul><li><tt>loop:</tt> repeats its block until <tt>stop</tt> or <tt>break</tt>.</li>
        <li><tt>M = A.solve()</tt>: one solve call of <tt>A</tt>, without assumptions: a model or <tt>none</tt>.
        When it is <tt>none</tt>, no candidate is left: <tt>stop</tt> ends the run (exhausted).</li>
        <li><tt>A.add(c)</tt> adds the clause to <tt>A</tt> for its next solve. (<tt>reject</tt> works only inside a
        search; <tt>add</tt> only outside one.)</li>
        <li><tt>accept M</tt> counts and prints <tt>M</tt> as a solution: outside a search, nothing is accepted
        by itself.</li></ul>
        <p>Run it.</p>`,
      done: () => ran() && S().solutions === 61 && /loop:/.test(script()),
      doIt: run,
      after: () => `<p>The same 61 solutions, with ${fmt(S().candidates)} candidates (${fmt(first.cand)} in the search): each
        was one solve of <tt>A</tt>, and every clause was added for good before the next one. In the search, clasp
        enumerates by backtracking and keeps clauses added during the enumeration only weakly, so it can propose a
        candidate that an earlier clause already excludes (the check refutes it again). A search avoids starting over for
        every candidate, which pays off on large problems.</p>`,
    },
    {
      title: 'Experiment: why block a solution?',
      target: loopEditor, lines: [13, 13], enter: base(SHAPE2),
      text: `<p>Delete the last line, <tt>A.add(G.block(M))</tt>, and run.</p>`,
      done: () => ran() && !/A\.add\(G\.block/.test(squeeze(script())) && c.lastEnd.state === 'error',
      doIt: () => { ed().setValue(script().replace('        A.add(G.block(M))\n', ''), 1); run(); },
      after: () => `<p><b>${result().replace(/</g, '&lt;')}</b></p><p>Nothing changed in <tt>A</tt> after the first solution, so the next
        solve returned the same candidate. The runtime stops a loop whose solve returns the same values twice in a row:
        every solution must be blocked (in a search this happens by itself).</p>`,
    },
    {
      title: 'Counting with your own counters',
      target: loopEditor, lines: [9, 10], enter: base(SHAPE2),
      text: `<p>Statements can also count and record: <tt>count refuted</tt> adds 1 to a counter named
        <tt>refuted</tt> (Statistics tab, Custom counters); <tt>log X</tt> prints a value to the Messages;
        <tt>track best = e</tt> records a series. Add <tt>count refuted</tt> as the first line under <tt>if X:</tt>
        (indented like <tt>A.add</tt>) and run.</p>`,
      done: () => ran() && /ifX:countrefuted/.test(squeeze(script())) && S().solutions === 61,
      doIt: () => { ed().setValue(script().replace('    if X:\n', '    if X:\n        count refuted\n'), 1); run(); },
      after: () => `<p>Statistics, Custom counters: <tt>refuted</tt> = ${fmt(S().counterexamples)}, one per counterexample.</p>`,
    },
    {
      title: 'What the compiler checks',
      target: loopEditor,
      text: `<p>The script is compiled while you type, and mistakes are marked at once, with what to do: a name used
        before it is assigned, <tt>reject</tt> outside <tt>on candidate</tt>, <tt>A.add</tt> inside a search of
        <tt>A</tt>, a member a solver or link does not have (<tt>G.foo</tt>), <tt>break</tt> outside a loop.</p>
        <p>Point at any word of the script for its meaning; the line under the editor explains the statement at the
        cursor; after a dot (<tt>G.</tt>) the editor lists the members.</p>`,
    },
    {
      title: 'Where next',
      text: `<p>The language has more: several counterexamples per candidate (<tt>C.models(..., limit n)</tt>), optimal
        counterexamples (<tt>optimal</tt>), cores (<tt>G.core(C)</tt>), refinements as rules (<tt>S.expand</tt>,
        Shapes 3 and 4), checks on partial candidates, procedures and solver families.</p>
        <p>The manual's <a href="#manual-the-loop-language">loop language</a> has the complete reference, and
        <a href="#manual-templates">Templates</a> the four shapes. The Loop tab's Template list inserts them. The
        Tutorial's lessons use them on examples.</p>
        <p>The project is still the walkthrough's copy of Sum-free sets; load another from Home.</p>`,
      next: 'Finish',
    },
  ];
}

// begin: a fresh copy of the example (an edited project is kept as a snapshot first)
export async function walkthroughBegin(app) {
  if (app.control.busy) { window.alert('Not possible during a run.'); return false; }
  if (app.edited) app.snapshotBefore('the loop walkthrough');
  await app.loadExample(EXAMPLE);
  return true;
}
