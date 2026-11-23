// The chapters of the guide, in reading order: the one list the sidebar (guide.js), the
// contents page and the tests are built from. ready: the page is written and linked; the
// contents page lists the others as "in preparation". part: 1 (design) or 2 (loops from the
// literature); the sidebar and the contents page group the chapters by part.
export const PARTS = [
  { part: 1, title: 'Part I: Design' },
  { part: 2, title: 'Part II: Loops from the literature' },
];
export const CHAPTERS = [
  { file: '01-why-a-loop.html', title: 'Why a loop', ready: true, part: 1,
    summary: 'A problem with one quantifier too many for one program, and the idea of the loop.' },
  { file: '02-first-loop.html', title: 'The first loop: guess, check, block', ready: true, part: 1,
    summary: 'Two programs, two solvers, the glue, and blocking one wrong candidate at a time.' },
  { file: '03-learning.html', title: 'Learning from a counterexample', ready: true, part: 1,
    summary: 'relevant/1: a counterexample rules out many candidates at once.' },
  { file: '04-soundness.html', title: 'Soundness: when a refinement says too much', ready: true, part: 1,
    summary: 'A refinement that excludes a solution, how it shows, and how to test for it.' },
  { file: '05-reading-a-run.html', title: 'Reading a run', ready: true, part: 1,
    summary: 'The statistics, the trace and the run history, on a larger graph.' },
  { file: '06-more-per-check.html', title: 'Getting more out of each check', ready: true, part: 1,
    summary: 'Several counterexamples per candidate, and stronger ones.' },
  { file: '07-abstraction.html', title: 'Designing the abstraction', ready: true, part: 1,
    summary: 'What the abstraction knows in advance, and what it should leave to the check.' },
  { file: '08-loop-shapes.html', title: 'Loop shapes', ready: true, part: 1,
    summary: 'One search or many solves, and when each pays.' },
  { file: '09-rule-refinements.html', title: 'Refinements that are rules', ready: true, part: 1,
    summary: 'Grounding a refinement as a program part instead of adding clauses.' },
  { file: '10-witness-and-cores.html', title: 'Checks that look for a witness, and cores', ready: true, part: 1,
    summary: 'When a good candidate is one with an answer set, and refining from a core.' },
  { file: '11-optimisation.html', title: 'Optimisation', ready: true, part: 1,
    summary: 'Bilevel problems: the best candidate that no check can refute.' },
  { file: '12-your-own-loop.html', title: 'Your own loop: a walkthrough and a checklist', ready: true, part: 1,
    summary: 'A fresh problem from start to finish, and the rules of the guide in one list.' },
  { file: '13-qbf.html', title: '2QBF, by clauses and by expansion', ready: true, part: 2,
    summary: 'The loop of Part I is a known QBF algorithm; expansion learns a copy of the formula instead of a clause.' },
  { file: '14-hitting-sets.html', title: 'Implicit hitting sets', ready: true, part: 2,
    summary: 'MaxSAT as an optimal hitting set of cores: lower and upper bounds, and minimal cores.' },
  { file: '15-marco.html', title: 'MARCO: two kinds of answer', ready: true, part: 2,
    summary: 'A map of all subsets, shrink and grow, and refinements in both directions.' },
];

// Pages of the guide that are not chapters: linked from the contents page and the sidebar, with
// the guide's skeleton but without a recap, exercises or a place in the pager.
export const EXTRAS = [
  { file: 'bibliography.html', title: 'Bibliography', summary: 'The papers behind the loops of Part II and the manual\'s table "Loops from the literature".' },
];
