// Project snapshots (js/snapshots.js): named copies of a project in browser storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Snapshots, SNAP_PREFIX, SNAP_INDEX, projectKey } from '../js/snapshots.js';

const store = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const at = (i) => `2026-01-01T10:${String(i).padStart(2, '0')}:00.000Z`;

test('save, list per project newest first, load and remove', () => {
  const s = store();
  const n = new Snapshots(s);
  const a = n.save('Sum-free', 'before the fix', '{"a":1}', { now: at(1) });
  const b = n.save('Sum-free', 'after the fix', '{"a":2}', { now: at(2) });
  n.save('Other', 'x', '{"o":1}', { now: at(3) });
  assert.deepEqual(n.list('Sum-free').map((x) => x.name), ['after the fix', 'before the fix']);
  assert.deepEqual(n.list('Other').map((x) => x.name), ['x']);
  assert.equal(n.all().length, 3);
  assert.equal(n.load(a), '{"a":1}');
  n.remove(b);
  assert.equal(s.m.has(SNAP_PREFIX + b), false);
  assert.deepEqual(n.list('Sum-free').map((x) => x.id), [a]);
  assert.equal(n.load('nope'), null);
  assert.throws(() => n.save('Sum-free', '', '{}'), /a name of 1 to 80/);
  assert.throws(() => n.save('Sum-free', 'two\nlines', '{}'), /a name of 1 to 80/);
  // ids are unique also within one millisecond
  const ids = new Set(Array.from({ length: 50 }, () => n.save('Many', 'same', '{}', { now: at(9) })));
  assert.equal(ids.size, 50);
});

test('a project without a title, and a broken index', () => {
  const s = store();
  const n = new Snapshots(s);
  assert.equal(projectKey(''), '(untitled)');
  assert.equal(projectKey('  T '), 'T');
  n.save('', 'one', '{}', { now: at(1) });
  assert.deepEqual(n.list(undefined).map((x) => x.name), ['one']);
  s.setItem(SNAP_INDEX, 'not json');
  assert.deepEqual(n.all(), []);
});

test('at most `cap` snapshots per project: the oldest automatic one goes first, then the oldest', () => {
  const s = store();
  const n = new Snapshots(s, { cap: 3 });
  const named1 = n.save('P', 'named 1', '1', { now: at(1) });
  const auto1 = n.save('P', 'auto 1', '2', { now: at(2), auto: true });
  n.save('P', 'named 2', '3', { now: at(3) });
  n.save('Q', 'other project', 'q', { now: at(4) });
  n.save('P', 'named 3', '4', { now: at(5) });
  assert.deepEqual(n.list('P').map((x) => x.name), ['named 3', 'named 2', 'named 1']);
  assert.equal(s.m.has(SNAP_PREFIX + auto1), false);
  n.save('P', 'named 4', '5', { now: at(6) });
  assert.deepEqual(n.list('P').map((x) => x.name), ['named 4', 'named 3', 'named 2']);
  assert.equal(s.m.has(SNAP_PREFIX + named1), false);
  assert.deepEqual(n.list('Q').map((x) => x.name), ['other project']);
  // the default cap is about 20
  const d = new Snapshots(store());
  for (let i = 0; i < 25; i++) d.save('P', `s${i}`, '{}', { now: at(i) });
  assert.equal(d.list('P').length, 20);
  assert.equal(d.list('P')[0].name, 's24');
});

test('a full storage: the error reaches the caller and nothing half-written stays', () => {
  const s = store();
  const n = new Snapshots(s);
  n.save('P', 'kept', '{}', { now: at(1) });
  const full = { ...s, setItem: (k, v) => { if (k.startsWith(SNAP_PREFIX)) throw new Error('QuotaExceededError'); s.setItem(k, v); } };
  assert.throws(() => new Snapshots(full).save('P', 'too big', 'x'.repeat(10)), /Quota/);
  const indexFull = { ...s, setItem: (k, v) => { if (k === SNAP_INDEX) throw new Error('QuotaExceededError'); s.setItem(k, v); } };
  const before = s.m.size;
  assert.throws(() => new Snapshots(indexFull).save('P', 'no index', '{}'), /Quota/);
  assert.equal(s.m.size, before);
  assert.deepEqual(n.list('P').map((x) => x.name), ['kept']);
});

test('js/snapshots.js uses neither the DOM nor Node', () => {
  const src = fs.readFileSync(new URL('../js/snapshots.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bdocument\b|\bwindow\b|localStorage|node:|require\(|process\./);
});
