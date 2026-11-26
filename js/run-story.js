// A finished run in words, under the result line of the Output tab: who proposed what, what the
// check refuted, how strong the refinements were, and whether the solutions are all of them.
// No DOM: the tests run it in Node.
//
//   runStory({ D, S, loopText, wanted }) -> string ('' when there is nothing to tell)
//     D: the done event ({ outcome, exhausted, detail }), S: the run's statistics (js/stats.js),
//     loopText: the loop script (for the solvers' names), wanted: Run options' Solutions (0: all)
import { scriptNames } from './loop-help.js';
import { refinementCounts, refinementSplitText } from './driver.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

export function runStory({ D, S, loopText = '', wanted = 0 }) {
  if (!D || !S || D.outcome === 'error') return '';
  const names = loopText ? scriptNames(loopText) : null;
  const searcher = names && names.searched.size ? [...names.searched][0] : names && names.links.size ? [...names.links.values()][0].from : null;
  const check = names ? [...names.links.values()].find((l) => !searcher || l.from === searcher) : null;
  const A = searcher ? `Solver ${searcher}` : 'The loop';
  const C = check ? `the check (solver ${check.to})` : 'the check';
  const parts = [];
  const cand = S.candidates || 0, cex = S.counterexamples || 0, sols = S.solutions || 0;
  if (!cand) return D.exhausted ? `${A} found no candidate at all: the abstraction is unsatisfiable, so there is no solution.` : '';
  parts.push(`${A} proposed ${plural(cand, 'candidate')}.`);
  if (cex) {
    const rc = refinementCounts(S) || { total: 0 };
    const len = S.clauses ? (S.literals || 0) / S.clauses : 0;
    let r = `${C[0].toUpperCase()}${C.slice(1)} refuted ${fmt(cex)} of them with a counterexample`;
    if (rc.total) {
      const split = rc.split ? refinementSplitText(rc) : '';
      r += `; the loop added ${plural(rc.total, 'refinement')}${split && split !== 'none' && !/^[\d,]+ from counterexamples$/.test(split) ? ` (${split})` : ''}`;
    }
    parts.push(`${r}.`);
    if (S.clauses && len) parts.push(`The clauses have ${len.toFixed(1)} literals on average${S.maxlen ? ` (at most ${fmt(S.maxlen)})` : ''}: the shorter a clause, the more candidates it rules out besides its own.`);
    if (S.expansions) parts.push(`Each of the ${plural(S.expansions, 'expansion')} grounded the refine part for counterexamples: rules that rule out every candidate those counterexamples refute.`);
  } else parts.push(`${C[0].toUpperCase()}${C.slice(1)} found no counterexample.`);
  const others = cand - cex;
  if (sols && others >= 0) parts.push(`${plural(sols, 'candidate')} passed the check: ${sols === 1 ? 'it is the solution' : 'they are the solutions'}${others > sols ? ` (the other ${fmt(others - sols)} were candidates seen again or rejected otherwise)` : ''}.`);
  else if (!sols) parts.push(`No candidate passed the check${D.exhausted ? ': there is no solution' : ''}.`);
  if (D.outcome === 'finished' && D.exhausted) parts.push('The search ran to the end (exhausted), so these are all the solutions, if the loop is sound; Audit checks that.');
  else if (D.outcome === 'solutions') parts.push(`The run stopped at the ${wanted ? fmt(wanted) : 'wanted number of'} solution${wanted === 1 ? '' : 's'} asked for (Run options, Solutions); there may be more.`);
  else if (D.outcome === 'limit') parts.push(`The run stopped at a limit (${D.detail}); there may be more solutions.`);
  else if (D.outcome === 'stopped') parts.push('The run was stopped before the search ended; there may be more solutions.');
  else if (D.outcome === 'finished' && !D.exhausted) parts.push('The loop ended before its search was exhausted, so there may be more solutions.');
  return parts.join(' ');
}
