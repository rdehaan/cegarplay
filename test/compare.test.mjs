// js/compare.js: line diff, hunks, comparing two variants of a project with the run history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../js/project.js';
import { lineDiff, hunks, compareVariants, latestResults, rowInstance, verdictText } from '../js/compare.js';

const ops = (d) => d.map((x) => x.op + x.line).join('|');

test('lineDiff: equal, inserted, deleted, changed lines; the final newline is not a line', () => {
  assert.equal(ops(lineDiff('a\nb\n', 'a\nb')), ' a| b');
  assert.equal(ops(lineDiff('', '')), '');
  assert.equal(ops(lineDiff('', 'x\n')), '+x');
  assert.equal(ops(lineDiff('x\n', '')), '-x');
  assert.equal(ops(lineDiff('a\nb\nc\n', 'a\nc\n')), ' a|-b| c');
  assert.equal(ops(lineDiff('a\nc\n', 'a\nb\nc\n')), ' a|+b| c');
  assert.equal(ops(lineDiff('a\nb\nc\n', 'a\nB\nc\n')), ' a|-b|+B| c');
  // a longest common subsequence, not just prefix and suffix
  const d = lineDiff('x\na\ny\nb\nz\n', 'a\nq\nb\n');
  assert.equal(d.filter((e) => e.op === ' ').map((e) => e.line).join(''), 'ab');
  // both sides rebuild from the diff
  for (const [a, b] of [['1\n2\n3\n4\n5\n', '0\n2\n4\n5\n6\n'], ['p\nq\n', 'q\np\n'], ['a\na\na\n', 'a\n']]) {
    const e = lineDiff(a, b);
    assert.equal(e.filter((x) => x.op !== '+').map((x) => x.line + '\n').join(''), a);
    assert.equal(e.filter((x) => x.op !== '-').map((x) => x.line + '\n').join(''), b);
  }
});

test('lineDiff: a long text with one change is cheap (prefix and suffix are trimmed)', () => {
  const a = Array.from({ length: 50000 }, (_, i) => `line ${i}`).join('\n');
  const b = a.replace('line 25000', 'changed');
  const t = Date.now();
  const d = lineDiff(a, b);
  assert.ok(Date.now() - t < 2000);
  assert.deepEqual(d.filter((x) => x.op !== ' ').map((x) => x.op + x.line), ['-line 25000', '+changed']);
});

test('hunks: changes with their context and line numbers', () => {
  const a = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join('\n');
  const b = a.replace('l5', 'L5').replace('l16\n', '');
  const h = hunks(lineDiff(a, b), 2);
  assert.equal(h.length, 2);
  assert.deepEqual([h[0].aStart, h[0].bStart], [3, 3]);
  assert.equal(ops(h[0].lines), ' l3| l4|-l5|+L5| l6| l7');
  assert.deepEqual([h[1].aStart, h[1].bStart], [14, 14]);
  assert.equal(ops(h[1].lines), ' l14| l15|-l16| l17| l18');
  assert.deepEqual(hunks(lineDiff('a\n', 'a\n')), []);
});

const project = () => {
  const p = P.load(fs.readFileSync(new URL('../examples/tutorial-weak-relevant.json', import.meta.url), 'utf8'));
  p.fragments.push({ name: 'check_alt', text: p.fragments.find((f) => f.name === 'check').text.replace(/relevant\(/, 'relevant2(') + '% alt\n' });
  p.variants.push({ name: 'alt', swap: { check: 'check_alt' }, constants: { n: '6' } });
  p.instances = [{ id: 'n4', facts: '', constants: { n: '4' } }, { id: 'n5', facts: '', constants: { n: '5' } }];
  return p;
};

test('compareVariants: fragments, loop script and constants that differ', () => {
  const p = project();
  const c = compareVariants(p, '', 'alt');
  assert.deepEqual(c.fragments.map((f) => f.name), ['check']);
  assert.ok(c.fragments[0].added >= 1 && c.fragments[0].removed >= 1);
  assert.equal(c.loop, null);
  assert.deepEqual(c.constants, [{ name: 'n', a: p.settings.constants.n ?? null, b: '6' }].filter((x) => x.a !== x.b));
  // the reference variant has its own loop script: a loop diff, no fragment diff
  const r = compareVariants(p, '', 'reference');
  assert.deepEqual(r.fragments, []);
  assert.ok(r.loop && r.loop.added + r.loop.removed > 0);
  // the same side twice: nothing differs
  const s = compareVariants(p, 'alt', 'alt');
  assert.deepEqual([s.fragments, s.loop, s.constants, s.settings], [[], null, [], []]);
  assert.throws(() => compareVariants(p, '', 'nope'), /no variant named/);
});

test('compareVariants: the latest count and verdict per instance from the run history', () => {
  const p = project();
  const history = [
    { mode: 'run', instance: 'n4', variant: null, solutions: 3, exhausted: true, audit: null, time: '10:00:00' },
    { mode: 'run', instance: 'n4', variant: null, solutions: 5, exhausted: false, audit: null, time: '10:01:00' },
    { mode: 'audit', instance: 'n4', variant: null, solutions: 9, audit: { verdict: 'unsound', unsound: 11 } },
    { mode: 'run', instance: 'n4', variant: 'alt', solutions: 9, exhausted: true, audit: null },
    { mode: 'bounded', instance: 'n5', variant: 'alt', solutions: 0, audit: { verdict: 'sound', mode: 'symbolic', k: null, space: null } },
    { mode: 'bounded', instance: null, variant: 'alt', solutions: 0, audit: { verdict: 'sound', mode: 'space', k: 4, space: 'n' } },
    // an older row without the instance field: taken from its loop label
    { mode: 'run', loop: 'loop [n5]', variant: null, solutions: 7, exhausted: true, audit: null },
  ];
  const c = compareVariants(p, '', 'alt', history);
  const by = Object.fromEntries(c.results.map((r) => [r.instance, r]));
  assert.deepEqual(Object.keys(by), ['n4', 'n5', 'space n']);
  assert.deepEqual([by.n4.a.solutions, by.n4.a.exact, by.n4.a.audit], [9, true, 'unsound']);
  assert.deepEqual([by.n4.b.solutions, by.n4.b.exact, by.n4.b.audit], [9, true, null]);
  assert.deepEqual([by.n5.a.solutions, by.n5.b.solutions, by.n5.b.audit], [7, null, 'sound (symbolic)']);
  assert.equal(by['space n'].a, null);
  assert.equal(by['space n'].b.audit, 'sound ≤ 4');
  // a run that stopped before all solutions: not exact
  const only = latestResults(history.slice(0, 2), '');
  assert.deepEqual([only.get('n4').solutions, only.get('n4').exact], [5, false]);
});

test('rowInstance, verdictText', () => {
  assert.equal(rowInstance({ instance: 'a' }), 'a');
  assert.equal(rowInstance({ instance: null, loop: 'x [b]' }), '');
  assert.equal(rowInstance({ loop: 'audit: loop [n4] (variant v)' }), 'n4');
  assert.equal(rowInstance({ loop: 'loop' }), '');
  assert.equal(verdictText({ verdict: 'unsound', mode: 'space', k: 2 }), 'unsound at k = 2');
  assert.equal(verdictText({ verdict: 'limit' }), 'limit');
  assert.equal(verdictText(null), '');
});

test('js/compare.js uses neither the DOM nor Node', () => {
  const src = fs.readFileSync(new URL('../js/compare.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bdocument\b|\bwindow\b|node:|require\(|process\./);
});
