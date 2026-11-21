// The chapters of the guide, in reading order: the one list the sidebar (guide.js), the
// contents page and the tests are built from. ready: the page is written and linked; the
// contents page lists the others as "in preparation".
export const CHAPTERS = [
  { file: '01-why-a-loop.html', title: 'Why a loop', ready: true,
    summary: 'A problem with one quantifier too many for one program, and the idea of the loop.' },
  { file: '02-first-loop.html', title: 'The first loop: guess, check, block', ready: true,
    summary: 'Two programs, two solvers, the glue, and blocking one wrong candidate at a time.' },
  { file: '03-learning.html', title: 'Learning from a counterexample', ready: true,
    summary: 'relevant/1: a counterexample rules out many candidates at once.' },
  { file: '04-soundness.html', title: 'Soundness: when a refinement says too much', ready: true,
    summary: 'A refinement that excludes a solution, how it shows, and how to test for it.' },
  { file: '05-reading-a-run.html', title: 'Reading a run', ready: true,
    summary: 'The statistics, the trace and the run history, on a larger graph.' },
  { file: '06-more-per-check.html', title: 'Getting more out of each check', ready: true,
    summary: 'Several counterexamples per candidate, and stronger ones.' },
  { file: '07-abstraction.html', title: 'Designing the abstraction', ready: true,
    summary: 'What the abstraction knows in advance, and what it should leave to the check.' },
  { file: '08-loop-shapes.html', title: 'Loop shapes', ready: true,
    summary: 'One search or many solves, and when each pays.' },
  { file: '09-rule-refinements.html', title: 'Refinements that are rules', ready: false,
    summary: 'Grounding a refinement as a program part instead of adding clauses.' },
  { file: '10-witness-and-cores.html', title: 'Checks that look for a witness, and cores', ready: false,
    summary: 'When a good candidate is one with an answer set, and refining from a core.' },
  { file: '11-optimisation.html', title: 'Optimisation', ready: false,
    summary: 'Bilevel problems: the best candidate that no check can refute.' },
  { file: '12-your-own-loop.html', title: 'Your own loop: a walkthrough and a checklist', ready: false,
    summary: 'A fresh problem from start to finish, and the rules of the guide in one list.' },
];
