// The editors' help without the page: the ASP scan, the warnings, the fragments' tooltips
// (js/asp-scan.js), autocompletion (js/completions.js), the compiler errors' fixes
// (js/error-help.js) and the run in words (js/run-story.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { scanAsp, termPred, lintProject, aspWordHelp } from '../js/asp-scan.js';
import { loopCompletions, aspCompletions } from '../js/completions.js';
import { explainError } from '../js/error-help.js';
import { runStory } from '../js/run-story.js';
import { compile } from '../js/compiler.js';

const BASE = JSON.parse(H.read('examples/tutorial-first-run.json'));
const variant = (fn) => { const p = structuredClone(BASE); fn(p, (n) => p.fragments.find((f) => f.name === n)); return p; };
const lint = (p) => lintProject(p).map((x) => `${x.where.name || 'loop'}:${x.where.line} ${x.severity} ${x.message}`);

test('the scan: heads, bodies, choice elements, aggregates, directives, parts', () => {
  const s = scanAsp(`% c
1 { sum(X,Y) : num(X), num(Y), X + Y <= n } 1.
:- sum(X,Y), not pick(X).
a(X) ; -b(X) :- c(X), X = #count { Y : d(Y) }, n > 2.
#minimize { 1,T : relevant(T) }.
#heuristic e(X) : f(X). [10, true]
g(X) :- h(X).
#show sum/2.
#external q(X) : num(X).
#program refine(k).
w(k,I) :- cex(k, inval(I,1)).
#const n = 8.`);
  const of = (role) => s.atoms.filter((a) => a.role === role).map((a) => `${a.neg ? '-' : ''}${a.name}/${a.arity}`).join(' ');
  assert.equal(of('head'), 'sum/2 a/1 -b/1 g/1 w/2');
  assert.equal(of('body'), 'num/1 num/1 sum/2 pick/1 c/1 d/1 relevant/1 f/1 h/1 num/1 cex/2');
  assert.equal(of('heuristic'), 'e/1');
  assert.equal(of('show'), 'sum/2');
  assert.equal(of('external'), 'q/1');
  assert.deepEqual(s.parts.map((p) => [p.name, p.params]), [['refine', ['k']]]);
  assert.deepEqual(s.consts.map((c) => [c.name, c.value]), [['n', '8']]);
  assert.equal(s.atoms.find((a) => a.name === 'w').part, 'refine');
  assert.deepEqual(termPred('pick(X+Y)'), { name: 'pick', arity: 1 });
  assert.deepEqual(termPred('edge(N, f(M))'), { name: 'edge', arity: 2 });
  assert.equal(termPred('X'), null);
});

test('warnings: none on the library, the typical mistakes on purpose', () => {
  assert.deepEqual(lint(BASE), []);
  const lib = JSON.parse(H.read('examples/library.json'));
  const warn = [];
  for (const e of lib.examples) {
    const p = JSON.parse(H.read(`examples/${e.id}.json`));
    for (const x of lintProject(p)) if (x.severity === 'warning') warn.push(`${e.id} ${x.where.name || 'loop'}:${x.where.line} ${x.message}`);
  }
  // the one example that shows this mistake on purpose
  assert.deepEqual(warn.map((w) => w.split(' ')[0]), ['guide-09-missing-k'], warn.join('\n'));
  const typo = lint(variant((p, F) => { F('check').text = F('check').text.replace('relevant(pick(X)) :- sum(X,Y).', 'relevant(pick(X)) :- summ(X,Y).'); }));
  assert.deepEqual(typo, ['check:10 warning summ/2 is used here, but no rule of solver C (shared + check) and no instance defines it: did you mean sum/2?']);
  const noRel = lint(variant((p, F) => { F('check').text = F('check').text.replace(/relevant/g, 'relevent'); }));
  assert.match(noRel.join('\n'), /^loop:3 warning G\.clause\(M, X\) reads relevant\/1 .* no fragment of solver C/m);
  const noGlue = lint(variant((p, F) => { F('glue').text = '% none\n'; }));
  assert.ok(noGlue.some((x) => /^loop:3 warning Link G: no rule in shared and glue derives glue\/1/.test(x)), noGlue.join('\n'));
  const badRel = lint(variant((p, F) => { F('check').text += '\nrelevant(sum(X,Y)) :- sum(X,Y).\n'; }));
  assert.deepEqual(badRel, ['check:14 warning relevant(sum(X,Y)): sum/2 is not an interface atom of link G (its glue gives pick/1), so this relevant/1 atom is ignored.']);
  const exp = lint(variant((p) => { p.loop.text += '\nA.expand(refine, cex = [])\n'; }));
  assert.match(exp[0], /^loop:11 warning A\.expand\(refine, \.\.\.\) grounds #program refine\(k\), but no fragment of solver A/);
  const kconst = lint(variant((p, F) => { p.settings.constants.k = '3'; F('abstraction').text += '\n#program refine(k).\nbad :- cex(k,X).\n'; p.loop.text += '\nA.expand(refine, cex = [])\n'; }));
  assert.ok(kconst.some((x) => /every head should contain k: bad\/0/.test(x)));
  assert.ok(kconst.some((x) => /The constant k \(Loop tab, Constants\) replaces the parameter k/.test(x)));
  const unused = lint(variant((p) => { p.fragments.push({ name: 'extra', text: 'x.\n' }); }));
  assert.deepEqual(unused.map((x) => x.split(' No')[0]), ['extra:1 info']);
  // raw Lua: nothing is known about the solvers
  assert.deepEqual(lint(variant((p) => { p.loop = { language: 'lua', text: '' }; })), []);
});

test('fragment tooltips: glue, relevant, predicates, constants, directives', () => {
  const h = (frag, row, word, n = 0) => {
    const line = BASE.fragments.find((f) => f.name === frag).text.split('\n')[row];
    let i = -1;
    for (let k = 0; k <= n; k++) i = line.indexOf(word, i + 1);
    return aspWordHelp(BASE, frag, row, i);
  };
  assert.equal(h('glue', 2, 'glue').title, 'glue(pick(X))');
  assert.match(h('glue', 2, 'glue').text, /^Makes pick\/1 an interface atom of link G \(A → C\)/);
  assert.match(h('check', 9, 'relevant').text, /G\.clause\(M, X\) says one of them must change/);
  assert.match(h('abstraction', 1, 'pick').text, /An interface atom of link G .* defined in fragment abstraction \(line 2\)/);
  assert.match(h('check', 1, 'sum').text, /^Defined here; for solver C it is defined in fragment check/);
  assert.equal(h('shared', 1, 'n', 1).text, 'The constant n = 8 (Loop tab, Constants).');
  assert.equal(h('abstraction', 2, '#show').title, '#show');
  assert.equal(h('check', 0, 'Solver'), null, 'nothing in a comment');
});

test('completions: members by receiver, fragments in declarations, project predicates', () => {
  const t = BASE.loop.text;
  const at = (text, row, col) => loopCompletions(text, row, col, BASE.fragments).map((x) => x.value);
  const tt = `${t}\nG.c`;
  const last = tt.split('\n').length - 1;
  assert.deepEqual(at(tt, last, 3).slice(0, 4), ['clause', 'block', 'core', 'clauses']);
  assert.ok(at(`${t}\nC.so`, last, 4).includes('solve'));
  assert.ok(at(`${t}\nX.at`, last, 4).includes('atoms'));
  assert.deepEqual(at('solver B = shared + ', 0, 20), ['abstraction', 'glue', 'check', 'view']);
  assert.ok(at(t, 8, 10).includes('search') && at(t, 8, 10).includes('G'));
  const asp = (frag) => aspCompletions(BASE, frag, 0, 0).map((x) => x.caption);
  assert.ok(asp('check').includes('relevant/1') && asp('check').includes('pick/1') && asp('check').includes('num/1'));
  assert.ok(!asp('abstraction').includes('relevant/1'), 'relevant/1 only where it means something');
  assert.ok(asp('glue').includes('glue/1'));
});

test('compiler errors get a fix and a manual section', () => {
  const errs = (src) => compile(src, { fragments: ['shared', 'abstraction', 'glue', 'check'] }).errors.map((e) => e.message);
  const DECL = 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue\n';
  for (const [src, fix, section] of [
    [`${DECL}reject M with G.block(M)\n`, /Put it inside a search/, 'manual-statements'],
    [`${DECL}x = Y\n`, /^Assign Y before this line/, 'manual-statements'],
    [`${DECL}x = G.foo(M)\n`, /after the dot the editor offers them/, 'manual-expressions'],
    ['solver A = shared + nothere\n', /^Check the spelling/, 'manual-declarations'],
    [`${DECL}x = C.solve(G(M))\n`, /S\.solve\(assume G\(M\)\)/, 'manual-expressions'],
  ]) {
    const m = errs(src)[0];
    assert.ok(m, src);
    const x = explainError(m);
    assert.match(x.fix, fix, m);
    assert.equal(x.section, section, m);
  }
  assert.equal(explainError('something new').section, 'manual-static-errors');
});

test('the run in words', () => {
  const S = { candidates: 107, counterexamples: 46, solutions: 61, clauses: 46, literals: 115, maxlen: 3, expansions: 0 };
  const s = runStory({ D: { outcome: 'finished', exhausted: true }, S, loopText: BASE.loop.text });
  assert.match(s, /^Solver A proposed 107 candidates\. The check \(solver C\) refuted 46 of them with a counterexample; the loop added 46 refinements\./);
  assert.match(s, /2\.5 literals on average \(at most 3\)/);
  assert.match(s, /61 candidates passed the check: they are the solutions\. The search ran to the end \(exhausted\), so these are all the solutions/);
  assert.match(runStory({ D: { outcome: 'solutions' }, S: { ...S, solutions: 1 }, loopText: BASE.loop.text, wanted: 1 }), /stopped at the 1 solution asked for/);
  assert.equal(runStory({ D: { outcome: 'error' }, S, loopText: '' }), '');
});

test('templateFor: a script\'s own declarations stay when they declare A, C and G; otherwise the whole template', async () => {
  const { templateFor, template } = await import('../js/project.js');
  const own = 'solver A = shared + abstraction\nsolver C = shared + check + relevant   options "-t 2"\nlink   G = A -> C via shared + glue legacy\n\nsearch A:\n    on candidate M:\n        log M\n';
  const t = templateFor('reference', own);
  assert.ok(t.startsWith('solver A = shared + abstraction\nsolver C = shared + check + relevant   options "-t 2"\nlink   G = A -> C via shared + glue legacy\n\nsearch A:\n'), t);
  assert.match(t, /reject M with G\.block\(M\)\n$/);
  assert.doesNotMatch(t, /log M/);
  assert.equal(templateFor('shape2', 'solver X = shared\n'), template('shape2'), 'other names: the whole template');
  assert.equal(templateFor('shape1', ''), template('shape1'));
  assert.equal(templateFor('shape1', 'solver A = a\nsolver C = c\nlink G = A -> C via g legacy\n'), 'solver A = a\nsolver C = c\nlink G = A -> C via g legacy\n\n' + template('shape1').split('\n').slice(4).join('\n'));
});
