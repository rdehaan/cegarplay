// The loop script's help (js/loop-help.js): tooltips per word and hints per statement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { wordHelp, lineHint, scriptNames, wordAt } from '../js/loop-help.js';

const P = JSON.parse(H.read('examples/tutorial-first-run.json'));
const T = P.loop.text, FR = P.fragments;
const lines = T.split('\n');
// the help of the n-th occurrence of `word` on line `row` (0-based)
const at = (text, row, word, n = 0, frags = FR) => {
  const line = text.split('\n')[row];
  let i = -1;
  for (let k = 0; k <= n; k++) i = line.indexOf(word, i + 1);
  assert.ok(i >= 0, `${word} on line ${row}`);
  return wordHelp(text, row, i + 1, frags);
};

test('the names of a script: solvers, links, candidate, assigned variables, searches', () => {
  const n = scriptNames(T);
  assert.deepEqual(n.solvers.get('A').frags, ['shared', 'abstraction']);
  assert.deepEqual({ ...n.links.get('G'), row: 0 }, { from: 'A', to: 'C', frags: ['shared', 'glue'], flags: [], family: false, row: 0 });
  assert.equal(n.vars.get('M').kind, 'candidate');
  assert.equal(n.vars.get('X').expr, 'C.solve(assume G(M))');
  assert.deepEqual([...n.searched], ['A']);
  assert.deepEqual(wordAt('  X = C.solve(', 6), { word: 'C', start: 6, end: 7 });
  assert.equal(wordAt('  X = ', 4), null);
});

test('tooltips: declared names, fragments, members by their receiver, keywords by their place', () => {
  assert.match(at(T, 0, 'A').text, /^Solver A: grounds shared \+ abstraction; it proposes the candidates \(search A\)\.$/);
  assert.match(at(T, 1, 'C').text, /it checks A's candidates over link G/);
  assert.equal(at(T, 0, 'abstraction').text, 'Fragment abstraction: Proposes candidates (solver A).');
  assert.match(at(T, 2, 'glue').text, /^Fragment glue: /);
  assert.match(at(T, 2, 'G').text, /^Link G: from solver A to solver C/);
  assert.equal(at(T, 6, 'solve').title, 'S.solve([assume E, ...] [, optimal])');
  assert.equal(at(T, 6, 'G').title, 'G(M)');
  assert.match(at(T, 6, 'assume').text, /assumption list/);
  assert.equal(at(T, 8, 'clause').title, 'G.clause(M, X)');
  assert.match(at(T, 8, 'X').text, /a counterexample, or none when the candidate passes/);
  assert.match(at(T, 5, 'M').text, /^The candidate of the search of A/);
  assert.equal(at(T, 5, 'on').title, 'on candidate M:');
  assert.equal(at(T, 4, 'search').title, 'search A:');
  // the same word, different meanings
  const S = 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue\n' +
    'K = C.core\nc = G.core(C)\nk = K.on(G)\ncount n\nm = C.solve()\nlog m.count(p/1)\nC.expand(refine, cex = K)\nstop "the end # here"\n';
  assert.equal(at(S, 3, 'core').title, 'S.core');
  assert.equal(at(S, 4, 'core').title, 'G.core(C)');
  assert.equal(at(S, 5, 'on').title, 'core.on(G)');
  assert.equal(at(S, 6, 'count').title, 'count n [by e]');
  assert.equal(at(S, 6, 'n', 1).title, 'count n');
  assert.equal(at(S, 8, 'count').title, 'X.count(p/n)');
  assert.equal(at(S, 8, 'p').title, 'p/1');
  assert.equal(at(S, 9, 'refine').title, '#program refine(k)');
  assert.equal(at(S, 9, 'cex').title, 'cex = L');
  // nothing inside a string or a comment
  assert.equal(at(S, 10, 'end'), null);
  assert.equal(at('# solver A\n', 0, 'solver'), null);
  assert.match(at('solver A = shared + nothere\n', 0, 'nothere').text, /There is no fragment nothere/);
});

test('hints: each statement in the script\'s own names', () => {
  const h = (row) => lineHint(T, row, FR);
  assert.match(h(0), /^Solver A: grounds shared \+ abstraction/);
  assert.equal(h(3), '');
  assert.match(h(4), /^Runs the search of solver A/);
  assert.match(h(5), /^For every candidate M of the search/);
  assert.equal(h(6), "X = a counterexample from solver C under the values of G's interface atoms in M, or none if there is none (the candidate passes).");
  assert.equal(h(7), 'If X is not none (a counterexample was found), the block below runs.');
  assert.equal(h(8), 'Rejects the candidate M: adds the clause "one atom marked relevant in X must change its value from M" (link G) to the searching solver.');
  const S = 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue\nsearch A:\n  on candidate M:\n' +
    '    if not C.solve(assume G(M)): reject M with G.core(C)\n    for X in C.models(assume G(M), limit 5): reject M with G.clause(M, X)\n';
  assert.match(lineHint(S, 5, FR), /^If not C\.solve\(assume G\(M\)\): rejects the candidate M: adds the clause from the unsat core of C's last solve/);
  assert.match(lineHint(S, 6, FR), /^For each X in a list of up to 5 models of solver C/);
});

test('every word and line of every library loop gets through the help without an error', () => {
  const lib = JSON.parse(H.read('examples/library.json'));
  let words = 0, helped = 0, stmts = 0, hinted = 0;
  for (const e of lib.examples) {
    const p = JSON.parse(H.read(`examples/${e.id}.json`));
    if (p.loop.language !== 'loop') continue;
    const t = p.loop.text;
    t.split('\n').forEach((l, r) => {
      const code = l.replace(/#.*$/, '');
      if (code.trim()) { stmts++; if (lineHint(t, r, p.fragments)) hinted++; }
      for (const m of code.matchAll(/[A-Za-z_]\w*/g)) { words++; if (wordHelp(t, r, m.index + 1, p.fragments)) helped++; }
    });
  }
  assert.ok(helped / words > 0.9, `${helped} of ${words} words`);
  assert.ok(hinted / stmts > 0.95, `${hinted} of ${stmts} statements`);
});
