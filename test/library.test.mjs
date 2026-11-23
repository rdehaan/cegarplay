// The example library: manifest, files, and the solution counts it promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import nodePath from 'node:path';
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
  for (const e of lib.examples.filter((x) => !['logic', 'reasoning', 'graphs', 'games', 'planning', 'puzzles', 'several-solvers', 'other', 'guide'].includes(x.group))) assert.ok(ids.includes(e.id), `${e.id} is not in the tutorial`);
});

for (const e of lib.examples.filter((x) => x.tags.includes('fast') && x.expected)) {
  test(`library: ${e.id} gives ${e.expected.solutions} solutions`, async () => {
    const p = H.example(e.id);
    p.settings = { ...p.settings, solutions: 0, trace: 0 };
    const r = await H.runProject(p);
    // A guide example may show a guard on purpose (outcome 'error' in the manifest).
    const outcome = e.outcome || 'finished';
    if (outcome === 'finished') assert.equal(H.last(r, 'E'), undefined, JSON.stringify(H.last(r, 'E')));
    assert.equal(H.finalStats(r).solutions, e.expected.solutions);
    assert.equal(H.done(r).outcome, outcome);
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

test('tools/run.mjs: the time limit ends a loop without solver calls, and the backstop a raw Lua spin', () => {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'cegarplay-'));
  const first = JSON.parse(H.read('examples/tutorial-first-run.json'));
  const decls = first.loop.text.split('\n').slice(0, 4).join('\n');
  const spin = { ...first, runs: [], loop: { language: 'loop', text: decls + '\nloop:\n    x = 1\n' } };
  fs.writeFileSync(nodePath.join(dir, 'spin.json'), JSON.stringify(spin));
  const r1 = spawnSync(process.execPath, [H.path('tools/run.mjs').pathname, nodePath.join(dir, 'spin.json'), '--seconds', '1'], { encoding: 'utf8' });
  assert.match(r1.stdout, /Outcome: limit \(time limit of 1 s reached\)/);
  assert.equal(r1.status, 0);
  const raw = { ...spin, loop: { language: 'lua', text: 'local A = rt.solver("A", {"shared", "abstraction"}, {})\nrt.prepare()\nwhile true do end\n' } };
  fs.writeFileSync(nodePath.join(dir, 'raw.json'), JSON.stringify(raw));
  const t0 = Date.now();
  const r2 = spawnSync(process.execPath, [H.path('tools/run.mjs').pathname, nodePath.join(dir, 'raw.json'), '--seconds', '1'], { encoding: 'utf8', timeout: 30000 });
  assert.match(r2.stdout, /did not stop at the time limit of 1 s; ended after 3 s/);
  assert.equal(r2.status, 1);
  assert.ok(Date.now() - t0 < 10000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('C5: the manual\'s library table lists the manifest\'s groups and ids', () => {
  const man = H.read('manual.md');
  const sec = man.slice(man.indexOf('## Example library'), man.indexOf('## For agents'));
  const rows = new Map([...sec.matchAll(/^\| `?([a-z-]+)`? \| (.*) \|$/gm)].map((m) => [m[1], m[2]]));
  for (const g of lib.groups) {
    assert.ok(rows.has(g.id), `the manual has no row for group ${g.id}`);
    if (g.id === 'guide') continue;
    const ids = [...rows.get(g.id).matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
    assert.deepEqual(ids, lib.examples.filter((e) => e.group === g.id).map((e) => e.id).sort(), g.id);
  }
});
