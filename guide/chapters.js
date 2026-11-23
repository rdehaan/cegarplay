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
  { file: '16-cegis.html', title: 'CEGIS: synthesis from counterexamples', ready: true, part: 2,
    summary: 'The counterexample is an input; the synthesiser learns to be right on it.' },
  { file: '17-oll.html', title: 'Core-guided optimisation: OLL', ready: true, part: 2,
    summary: 'One solver whose cores relax the problem instead of cutting it, against the hitting-set loop.' },
  { file: '18-benders.html', title: 'Benders decomposition', ready: true, part: 2,
    summary: 'Master and subproblem, optimality cuts as rules, and how much a cut should cover.' },
  { file: '19-more-levels.html', title: 'More than two quantifier levels', ready: true, part: 2,
    summary: 'Chains of solvers, recursion over solver families, and cores along the chain.' },
  { file: '20-lazy-and-omission.html', title: 'Lazy constraints and omission', ready: true, part: 2,
    summary: 'Checks at partial assignments, and abstractions that leave part of the problem out.' },
  { file: '21-voting-case-study.html', title: 'A case study: explaining voting outcomes', ready: true, part: 2,
    summary: 'A research project with the tool: strategies as variants, a campaign, ground truth and open questions.' },
  { file: '22-from-a-paper.html', title: 'From a paper to a loop', ready: true, part: 2,
    summary: 'A checklist from pseudocode to loop script, and which loop for which problem.' },
];

// Pages of the guide that are not chapters: linked from the contents page and the sidebar, with
// the guide's skeleton but without a recap, exercises or a place in the pager.
export const EXTRAS = [
  { file: 'reading-order.html', group: 'more', title: 'Reading the guide and the tutorial together', summary: 'One order for both, so that each tool appears when a design question calls for it.' },
  { file: 'glossary.html', group: 'more', title: 'Glossary', summary: 'The terms of the guide, each with the chapter that introduces it.' },
  { file: 'bibliography.html', group: 'more', title: 'Bibliography', summary: 'The papers behind the loops of Part II and the manual\'s table "Loops from the literature".' },
  { file: 'howto-campaign.html', group: 'howto', title: 'How to compare refinement strategies with a campaign', summary: 'Variants, a suite, the instance × variant matrix and the plots.' },
  { file: 'howto-time.html', group: 'howto', title: 'How to find where the time goes', summary: 'Solvers, candidates, clause lengths, the timeline and the cost per line.' },
  { file: 'howto-unsound.html', group: 'howto', title: 'How to hunt an unsound refinement', summary: 'The audit, the candidate space, Fuzz and a regression instance.' },
  { file: 'howto-instances.html', group: 'howto', title: 'How to build an instance set', summary: 'Generators, imports, ground truth and Run all.' },
  { file: 'howto-headless.html', group: 'howto', title: 'How to run experiments headlessly', summary: 'run.mjs, bench.mjs, report.mjs, and when to move to native clingo.' },
  { file: 'howto-check.html', group: 'howto', title: 'How to check a loop independently', summary: 'The reference variant, cegarcheck.py and proof logs with certcheck.py.' },
  { file: 'howto-view.html', group: 'howto', title: 'How to write a domain view', summary: 'Scene and frame, the step facts, and checking a view against the trace.' },
  { file: 'howto-present.html', group: 'howto', title: 'How to record and present a run', summary: 'Recordings, replays, storyboards and lecture links.' },
  { file: 'howto-paper.html', group: 'howto', title: 'How to turn a paper into a loop', summary: 'A checklist from pseudocode to loop script, and what to do when CegarPlay lacks something.' },
];
export const EXTRA_GROUPS = [
  { group: 'howto', title: 'How-to' },
  { group: 'more', title: 'More' },
];
