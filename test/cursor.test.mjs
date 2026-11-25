// Phase V5: the linked cursor, alignment, export.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as H from './helpers.mjs';
import { load, derive } from '../js/project.js';
import { Cursor, ticksOf } from '../js/cursor.js';
import { Recording, align } from '../js/recording.js';
import { frameFacts, viewProgram, sceneProgram, viewAtoms, parseMarks, layoutScene, frameSVG, svgFile, Palette, VIEW_OPTIONS, viewProject } from '../js/views.js';

const recOf = (id) => Recording.fromText(zlib.gunzipSync(fs.readFileSync(H.path(`examples/replays/${id}.cprec`))).toString());

test('the cursor model: ticks, set by step, move, range, follow, subscribers', () => {
  const c = new Cursor();
  let calls = 0;
  c.subscribe(() => calls++);
  c.setTicks([{ i: 1, t: 0.1 }, { i: 2, t: 0.2 }, { i: 5, t: 0.5 }, { i: 9, t: 0.9 }]);
  assert.equal(c.index, 1);
  c.setByStep(6);
  assert.equal(c.step, 5);
  c.move(-10);
  assert.equal(c.index, 0);
  assert.equal(c.step, 0);
  c.move(2);
  assert.equal(c.step, 2);
  c.setRange(3, 2);
  assert.deepEqual(c.range, [2, 3]);
  assert.deepEqual(c.timeRange(), [0.2, 0.5]);
  assert.deepEqual(c.stepRange(), [2, 5]);
  c.follow = true;
  c.setTicks([...c.ticks, { i: 10, t: 1 }]);
  assert.equal(c.step, 10);
  assert.ok(calls >= 6);
});

test('ticks of a recording, and the alignment of two recordings by step and by time', () => {
  const a = recOf('tutorial-weak-relevant'), b = recOf('tutorial-first-run');
  const ta = ticksOf(a);
  assert.equal(ta.length, a.steps.length);
  const bySteps = align(a, b, 'step');
  assert.equal(bySteps.length, a.steps.length);
  assert.ok(bySteps.every(([x, y]) => !y || y.i === x.i));
  const byTime = align(a, b, 'time');
  assert.ok(byTime.every(([x, y]) => !y || y.t <= x.t));
  assert.equal(align(a, a, 'step').filter(([x, y]) => y === x).length, a.steps.length);
});

test('the exported SVG of the V3 fixture frame equals the stored file', async () => {
  const p = load(H.read('examples/guide-03-hit-clique.json'));
  p.settings = { ...p.settings, solutions: 0, trace: 20 };
  const r = await H.runProject(p);
  const T = H.ofKind(r, 'T');
  const d = viewProject(derive(p, {}), null);
  const v = d.views[0];
  const scene = parseMarks(viewAtoms(await H.run(sceneProgram(d, v), VIEW_OPTIONS)).atoms);
  const frame = parseMarks(viewAtoms(await H.run(viewProgram(d, v, frameFacts(T.find((t) => t.i === 3))), VIEW_OPTIONS)).atoms);
  const pos = layoutScene(scene, scene.layout, new Map([...scene.pos, ...Object.entries(v.positions || {})]));
  const svg = svgFile(frameSVG(scene, frame, pos, { palette: new Palette() }), 1000, 1000, 'view');
  const file = H.path('test/fixtures/view-fixture.svg');
  if (process.env.UPDATE_FIXTURES) fs.writeFileSync(file, svg);
  assert.equal(svg, fs.readFileSync(file, 'utf8'));
  assert.equal((svg.match(/<circle /g) || []).length, 10);
  assert.equal((svg.match(/stroke-width="8"/g) || []).length, 3);   // the three ringed nodes
});

test('review of wave 5: R steps and T events paired (R counts solutions, T does not); frame channels do not cancel each other', async () => {
  const { pairSteps } = await import('../js/recording.js');
  const { FrameSource } = await import('../js/views.js');
  const rec = recOf('af-preferred');
  const P = pairSteps(rec);
  assert.equal(P.length, rec.steps.length);
  assert.ok(P.every((x) => (x.r.k === 's') === (x.t === null) || x.t === null));
  const paired = P.filter((x) => x.t);
  assert.ok(paired.every((x) => ({ r: 'reject', a: 'add', e: 'expand', x: 'error' })[x.r.k] === x.t.kind), 'kinds agree');
  assert.ok(paired.some((x) => x.i !== x.t.i), 'the numberings differ once a solution has occurred');
  let calls = 0;
  const src = new FrameSource(async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return { status: 30, out: ['{"Result":"SATISFIABLE","Call":[{"Witnesses":[{"Value":["draw(node(1))"]}]}]}'] }; });
  const [a, b] = await Promise.all([src.frame('main program'), src.frame('compare program', 'compare')]);
  assert.ok(a && b, 'both channels get their frame');
});

test('without R events the steps are the traced ones; solutions are listed apart with where they were found', async () => {
  const { traceSteps, pairSteps, solutionSteps, SOLUTION_FRAMES } = await import('../js/recording.js');
  const rec = new Recording();
  rec.add('M', { n: 1, atoms: 'p(0)' });                         // before the first traced step
  rec.add('T', { i: 1, kind: 'reject', solver: 'A', candidate: 'p(1)', literals: ['p(1)'] });
  rec.add('M', { n: 2, atoms: 'p(2)' });                         // between traced steps 1 and 2
  rec.add('T', { i: 2, kind: 'reject', solver: 'A', candidate: 'p(3)', literals: ['p(3)'] });
  rec.add('M', { n: 3, atoms: 'p(4) q' });                       // after the last traced step
  const S = traceSteps(rec);
  // no made-up step numbers: a solution is not a step of the trace
  assert.deepEqual(S.map((s) => [s.i, s.t.kind]), [[1, 'reject'], [2, 'reject']]);
  assert.deepEqual(pairSteps(rec), S);
  assert.deepEqual(ticksOf(rec).map((t) => [t.i, t.k]), [[1, 'reject'], [2, 'reject']]);
  const L = solutionSteps(rec);
  assert.deepEqual(L.map((x) => [x.n, x.at]), [[1, { after: 0, before: 1 }], [2, { after: 1, before: 2 }], [3, { after: 2, before: null }]]);
  assert.deepEqual(frameFacts(L[2].t), ['step(2).', 'kind(solution).', 'cand(p(4)).', 'cand(q).']);
  for (let n = 4; n < SOLUTION_FRAMES + 10; n++) rec.add('M', { n, atoms: `p(${n + 2})` });
  assert.equal(solutionSteps(rec).length, SOLUTION_FRAMES);
  // a recording with R events: a solution is an R step, with its own number
  const af = recOf('af-preferred');
  assert.equal(pairSteps(af).length, af.steps.length);
  const sAf = solutionSteps(af);
  assert.equal(sAf.length, af.solutions.length);
  assert.deepEqual(sAf.map((x) => x.at.step), af.steps.filter((x) => x.k === 's').map((x) => x.i));
});

test('a generator run without a recording: the view\'s last solution is the puzzle it found', async () => {
  const p = load(H.read('examples/akari.json'));
  p.settings = { ...p.settings, solutions: 1, trace: 200 };
  const r = await H.runProject(p, { instance: 'layout' });
  const rec = new Recording();
  for (const e of r.events) rec.add(e.kind, e.data);
  const { pairSteps, solutionSteps } = await import('../js/recording.js');
  // the trace's steps are refinements only; the puzzle is the run's solution (Show: solutions)
  assert.ok(pairSteps(rec).every((x) => x.t.kind !== 'solution'));
  const last = solutionSteps(rec).at(-1);
  assert.equal(last.t.kind, 'solution');
  assert.equal(last.at.before, null);
  assert.equal(last.t.candidate, H.ofKind(r, 'M')[0].atoms);
  const d = derive(p, { instance: 'layout' });
  const consts = Object.entries(d.settings.constants).map(([k, v]) => `-c ${k}=${v}`).join(' ');
  const a = viewAtoms(await H.run(viewProgram(d, d.views[0], frameFacts(last.t)), `${VIEW_OPTIONS} ${consts}`));
  const m = parseMarks(a.atoms);
  assert.deepEqual(m.problems, []);
  assert.ok(m.notes.includes('One lighting: the puzzle is done.'));
  const labels = [...m.attrs.values()].map((x) => x.label).filter((x) => /^[0-4]$/.test(x || ''));
  assert.equal(labels.length, 2);                                 // k = 2 numbers
});
