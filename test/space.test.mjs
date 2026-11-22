// Phase V4: the candidate space (docs/spec-views.md section 5), from stored recordings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';
import { compile } from '../js/compiler.js';
import { assemble, declarationLines } from '../js/driver.js';
import { auditProject } from '../tools/audit.mjs';
import { Recording } from '../js/recording.js';
import { Space, fates, mapOrder, blameMatrix, redundancy, sampleSpace, removedBy } from '../js/space.js';

async function load3(id) {
  const rec = Recording.fromText(zlib.gunzipSync(fs.readFileSync(H.path(`test/fixtures/recordings/${id}.cprec`))).toString());
  const a = await auditProject(load(H.read(`examples/${id}.json`)), { vectors: true, limit: 100000 });
  const v = (set) => a.events.filter((e) => e.kind === 'P' && e.data.set === set).flatMap((e) => e.data.v);
  const space = Space.fromHex(v('candidates'), rec.I.links[0].atoms.length);
  const truth = new Set(v('solutions').map((h) => space.index.get(h.replace(/^0+/, '') || '0')));
  return { rec, space, truth, F: fates(space, rec.steps, { truth }) };
}

test('tutorial-weak-relevant: 256 candidates, 61 solutions, 17 refinements; refinement 6 is the first unsound one, 128 removed and 13 lost', async () => {
  const { space, truth, F, rec } = await load3('tutorial-weak-relevant');
  assert.equal(space.count, 256);
  assert.equal(truth.size, 61);
  assert.equal(F.rows.length, 17);
  assert.equal(rec.solutions.length, 11);
  assert.equal(F.firstUnsound.ref, 6);
  assert.equal(F.firstUnsound.removed, 128);
  assert.equal(F.firstUnsound.lost, 13);
  assert.ok(F.rows.slice(0, 5).every((r) => r.lost === 0 && r.accepted === 1), 'steps 1 to 5 block accepted solutions');
  assert.equal(F.alive, 11);
});

test('tutorial-first-run: 46 refinements leave exactly the 61 solutions; 2,013 of 2,208 removals hit a removed candidate', async () => {
  const { F, truth } = await load3('tutorial-first-run');
  assert.equal(F.rows.length, 46);
  assert.equal(F.alive, 61);
  assert.equal(truth.size, 61);
  assert.equal(F.firstUnsound, null);
  assert.deepEqual([F.already, F.total], [2013, 2208]);
});

test('gc-shape1: 3,373 candidates, 1,320 refinements, alive ends at 101; 4,636 of 7,908 removals overlap', async () => {
  const { space, F } = await load3('gc-shape1');
  assert.equal(space.count, 3373);
  assert.equal(F.rows.length, 1320);
  assert.equal(F.alive, 101);
  assert.deepEqual([F.already, F.total], [4636, 7908]);
  const m = mapOrder(space, [], 'blame');
  const cells = new Set(Array.from(space.words.subarray(0, 0)));
  assert.ok(m.width * m.height >= space.count && cells.size === 0);
  const seen = new Set();
  for (let i = 0; i < space.count; i++) seen.add(m.xs[i] * 65536 + m.ys[i]);
  assert.equal(seen.size, space.count, 'one cell per candidate');
});

test('masks, blame matrix, redundancy, sample mode', () => {
  const sp = Space.fromHex(['0', '1', '2', '3'], 2);
  assert.deepEqual(removedBy(sp, [1]), [0, 2]);           // clause "atom 1 true" removes the candidates with atom 1 false
  assert.deepEqual(removedBy(sp, [1, -2]), [2]);
  const steps = [{ i: 1, k: 'r', q: [1, 2] }, { i: 2, k: 'r', q: [1, 2, -3] }, { i: 3, k: 'r', q: [3] }];
  assert.deepEqual(redundancy(steps), [{ i: 2, subsumedBy: 1 }]);
  assert.deepEqual(blameMatrix(3, steps).cols.sort(), [1, 2, 3]);
  const s = sampleSpace(40, 100, 7);
  assert.equal(s.sample, true);
  assert.equal(s.count, 100);
});

test('rt.enumerate lists one model per interface assignment: as many as the audit', async () => {
  const p = load(H.read('examples/tutorial-first-run.json'));
  const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
  const body = [...declarationLines(c), 'rt.enumerate{ link = G }'].map((l) => '    ' + l).join('\n') + '\n';
  const a = assemble(p, c, H.RUNTIME, { modules: [H.read('lua/space.lua')], body });
  const r = await H.run(a.program);
  const P = H.ofKind(r, 'P').flatMap((x) => x.v);
  assert.equal(P.length, 256);
  assert.equal(new Set(P).size, 256);
  assert.equal(H.ofKind(r, 'A').at(-1).candidates, 256);
});

test('review of wave 4: rt.enumerate reports limit when the raw models reach the cap', async () => {
  const p = H.projectOf({ shared: '', abstraction: '{ p(1..2) }. { q(1..4) }.', glue: 'glue(p(1..2)).', check: ':- p(1).' });
  p.loop = { language: 'loop', text: 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue\nloop:\n    stop\n' };
  const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
  const body = [...declarationLines(c), 'rt.enumerate{ link = G, limit = 3 }'].map((l) => '    ' + l).join('\n') + '\n';
  const a = assemble(p, c, H.RUNTIME, { modules: [H.read('lua/space.lua')], body });
  const r = await H.run(a.program);
  assert.equal(H.ofKind(r, 'A').at(-1).verdict, 'limit');
});
