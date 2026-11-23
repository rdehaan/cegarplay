// The workspace (FUTURE-DIRECTIONS D9): named projects in browser storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace, WS_PREFIX } from '../js/workspace.js';

const store = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('save, list newest first, overwrite, load and remove', () => {
  const s = store();
  const w = new Workspace(s);
  w.save('baseline', '{"a":1}', 'Sum-free', '2026-01-01T10:00');
  w.save('experiment 2', '{"a":2}', 'Sum-free', '2026-01-02T10:00');
  assert.deepEqual(w.list().map((x) => x.name), ['experiment 2', 'baseline']);
  w.save('baseline', '{"a":3}', 'Sum-free', '2026-01-03T10:00');
  assert.deepEqual(w.list().map((x) => x.name), ['baseline', 'experiment 2']);
  assert.equal(w.load('baseline'), '{"a":3}');
  assert.equal(w.has('baseline'), true);
  w.remove('baseline');
  assert.equal(s.m.has(WS_PREFIX + 'baseline'), false);
  assert.deepEqual(w.list().map((x) => x.name), ['experiment 2']);
  assert.throws(() => w.save('', '{}'), /a name of letters/);
  assert.throws(() => w.save('a/b', '{}'), /a name of letters/);
});
