// What the numbers of a run mean: the tooltips of the Statistics tab's column headers and of the
// run history (js/stats.js), and of the trace's atoms (js/trace.js). No DOM.

export const GLOSSARY = {
  Outcome: 'How the run ended: finished, solutions (the wanted number was reached), timeout, candidate limit, stopped, aborted or error. "(exhausted)": the search ran to the end, so the solutions found are all of them.',
  Elapsed: 'Wall-clock time of the run, in seconds.',
  Candidates: 'Candidates the searching solver proposed (each one went to the check).',
  Solutions: 'Candidates that passed the check (not rejected).',
  'Audit verdict': 'sound: every refinement removed only candidates that are not solutions, and every solution was found; unsound: a refinement cut a solution, or a solution was missed.',
  'Refinements checked': 'Refinements the audit tested against every solution of the instance.',
  'Rounds of the inner loop': 'Rounds of the symbolic audit\'s own CEGAR loop.',
  'Refinements of the inner loop': 'Refinements the symbolic audit\'s own loop needed.',
  Solver: 'A solver of the loop script (a clingo instance).',
  Fragments: 'The fragments the solver grounds, in order.',
  Options: 'The solver\'s clingo options (from the loop script).',
  Calls: 'Solve calls of this solver (a search counts as one).',
  Sat: 'Solve calls that found a model. For a check: the counterexamples found.',
  Unsat: 'Solve calls without a model. For a check: the candidates that passed.',
  Solving: 'Time spent solving, in seconds.',
  'Per call': 'Solving time per call.',
  Grounding: 'Time spent grounding (the fragments, and parts grounded by expand).',
  Choices: 'Decisions the solver made (clasp\'s counter): a measure of search effort.',
  Conflicts: 'Conflicts the solver met and learned from (clasp\'s counter).',
  Restarts: 'Restarts of the solver\'s search (clasp\'s counter), or, in the Refinements table, restarts of the loop\'s search (restart).',
  Atoms: 'Atoms of the solver\'s ground program.',
  Rules: 'Rules of the solver\'s ground program.',
  Expansions: 'Parts grounded by expand: refinements written as rules (one per counterexample or batch).',
  Clauses: 'Refinement clauses added (reject, add).',
  'Mean length': 'Literals per clause, on average. Short clauses are strong refinements: each removes many candidates.',
  Largest: 'The longest clause.',
  'Mean clause': 'Literals per refinement clause, on average: the shorter, the more candidates each removes.',
  Time: 'When the run finished.',
  'Loop [instance]': 'The loop script\'s first line, then the instance in brackets and the variant.',
  Seed: 'clingo\'s --seed of the run (r: randomized search).',
  Audit: 'The verdict of an audit of this project, when one was run after it.',
  Counter: 'A custom counter (count n in the loop script) or a series (track n = e).',
  Value: 'The counter\'s total, or the series\' last value.',
  Link: 'A link of the loop script.',
};

// the trace's atoms
export const TRACE_TIPS = {
  candidateHl: 'This atom of the candidate occurs in the refinement: its value must change (or that of another highlighted atom) for a later candidate.',
  candidate: 'An atom of the candidate (true in it).',
  counterexample: 'An atom of the counterexample: what the check found wrong with the candidate.',
  literalNeg: (a) => `The refinement clause: ${a} must become false, or another literal of the clause must hold. Every later candidate satisfies the clause.`,
  literalPos: (a) => `The refinement clause: ${a} must become true, or another literal of the clause must hold. Every later candidate satisfies the clause.`,
  fact: 'A fact grounded with the refine part (expand): the rules of the part read it.',
};
