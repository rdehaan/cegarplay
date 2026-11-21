// The example library: manifest, files, and the solution counts it promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';

const lib = JSON.parse(H.read('examples/library.json'));
const files = fs.readdirSync(H.path('examples/')).filter((f) => f.endsWith('.json') && f !== 'library.json').map((f) => f.slice(0, -5)).sort();

test('library.json lists exactly the example files, in known groups', () => {
  assert.equal(lib.format, 'cegarplay-library');
  assert.deepEqual(lib.examples.map((e) => e.id).sort(), files);
  const groups = new Set(lib.groups.map((g) => g.id));
  for (const e of lib.examples) {
    assert.ok(groups.has(e.group), e.id);
    assert.match(e.id, /^[A-Za-z0-9_-]+$/);
    for (const k of ['title', 'summary', 'shape']) assert.equal(typeof e[k], 'string', `${e.id}.${k}`);
    assert.ok(Array.isArray(e.tags));
    assert.equal(load(H.read(`examples/${e.id}.json`)).title, e.title);
  }
  for (const g of lib.groups) assert.ok(lib.examples.some((e) => e.group === g.id), `group ${g.id} is empty`);
});

test('every Load button of the tutorial names a library example', () => {
  const ids = [...H.read('tutorial.html').matchAll(/data-load-example="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 15, `only ${ids.length} buttons`);
  const known = new Set(lib.examples.map((e) => e.id));
  for (const id of ids) assert.ok(known.has(id), `unknown example ${id}`);
  for (const e of lib.examples.filter((x) => !['problems', 'guide'].includes(x.group))) assert.ok(ids.includes(e.id), `${e.id} is not in the tutorial`);
});

for (const e of lib.examples.filter((x) => x.tags.includes('fast') && x.expected)) {
  test(`library: ${e.id} gives ${e.expected.solutions} solutions`, async () => {
    const p = H.example(e.id);
    p.settings = { ...p.settings, solutions: 0, trace: 0 };
    const r = await H.runProject(p);
    assert.equal(H.last(r, 'E'), undefined, JSON.stringify(H.last(r, 'E')));
    assert.equal(H.finalStats(r).solutions, e.expected.solutions);
    assert.equal(H.done(r).outcome, 'finished');
  });
}

test('library: every loop shape gives the reference count on graph colouring n = 5', () => {
  const ids = lib.examples.filter((e) => e.group === 'shapes');
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids.map((e) => e.expected.solutions)).size, 1);
});

test('library: the solutions of gc-shape4 are distinct (no duplicates after a final search)', async () => {
  const r = await H.runProject(H.example('gc-shape4'));
  const sols = H.ofKind(r, 'M').map((m) => m.atoms.split(' ').sort().join(' '));
  assert.equal(new Set(sols).size, sols.length);
});

test('tools/run.mjs runs a library id and a file', () => {
  const out = execFileSync(process.execPath, [H.path('tools/run.mjs').pathname, 'tutorial-first-run', '--quiet'], { encoding: 'utf8' });
  assert.match(out, /Solutions: 61;/);
  const out2 = execFileSync(process.execPath, [H.path('tools/run.mjs').pathname, H.path('examples/starter.json').pathname, '-c', 'n=3'], { encoding: 'utf8' });
  assert.match(out2, /Solutions: 3;/);
  assert.match(out2, /^Solution 1: /m);
});
