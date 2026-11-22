// Phase V2: loop anatomy helpers (js/anatomy.js; the drawing is tested in the browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { layout, lineTable, binCalls, searchIds } from '../js/anatomy.js';
import { mapLine } from '../js/driver.js';

test('layout: columns by longest path, the abstraction left and the check right', () => {
  const l = layout(['A', 'C', 'D'], [{ from: 'A', to: 'C' }, { from: 'C', to: 'D' }, { from: 'A', to: 'D' }]);
  assert.deepEqual(l.col, { A: 0, C: 1, D: 2 });
  assert.deepEqual(layout(['A', 'B'], [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }]).columns.flat().sort(), ['A', 'B']);
  assert.deepEqual(layout(['A'], []).columns, [['A']]);
});

test('the line table: call counts sum to the calls of the final S event', async () => {
  for (const id of ['lang-basics', 'lang-two-stage', 'gc-shape2', 'gc-shape3', 'kemeny-control', 'lang-raw-lua']) {
    const p = H.example(id);
    p.settings.record = { steps: 'off', calls: true };
    const r = await H.runProject(p);
    const calls = H.ofKind(r, 'C');
    const total = Object.values(H.finalStats(r).solvers).reduce((a, s) => a + s.calls, 0);
    const rows = lineTable(calls, (n) => mapLine(r.assembled, n));
    assert.equal(rows.reduce((a, x) => a + x.calls, 0), total, id);
    assert.ok(rows.every((x) => x.sat + x.unsat + x.int === x.calls), id);
    assert.ok(rows.every((x) => x.time <= x.total + 1e-9), id);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].time >= rows[i].time, `${id}: sorted by time`);
  }
});

test('exclusive time: a search minus the calls nested in it', () => {
  const calls = [{ id: 2, s: 2, t0: 0.1, dt: 0.2, r: 'sat', p: 1, n: 9 }, { id: 1, s: 1, t0: 0, dt: 1, r: 'sat', p: 0, n: 5 }];
  const rows = lineTable(calls);
  assert.deepEqual(rows.map((r) => [r.line, +r.time.toFixed(3)]), [[5, 0.8], [9, 0.2]]);
  assert.deepEqual([...searchIds(calls)], [1]);
});

test('bins: calls narrower than a pixel share a column', () => {
  const calls = [];
  for (let i = 0; i < 1000; i++) calls.push({ id: i + 1, s: 1, t0: i / 1000, dt: 0.0001, r: i % 4 ? 'sat' : 'unsat', p: 0 });
  calls.push({ id: 2000, s: 2, t0: 0, dt: 0.5, r: 'unsat', p: 0 });
  const b = binCalls(calls, { v0: 0, v1: 1, width: 100, lanes: 2, laneOf: (c) => c.s - 1 });
  assert.equal(b.bars.length, 1);
  const sum = [...b.bins[0].values()].reduce((a, [s, u]) => [a[0] + s, a[1] + u], [0, 0]);
  assert.deepEqual(sum, [750, 250]);
  assert.ok(b.bins[0].size <= 100);
});
