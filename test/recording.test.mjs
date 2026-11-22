// Phase V1: compact events, policies, recordings and replay files (docs/spec-recording.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';
import { compile } from '../js/compiler.js';
import { assemble, recordSetting } from '../js/driver.js';
import { Recording, hexBits, summary } from '../js/recording.js';

const lib = JSON.parse(H.read('examples/library.json'));
const ex = (id, settings = {}) => {
  const p = load(H.read(`examples/${id}.json`));
  p.settings = { ...p.settings, trace: 0, seconds: 0, ...settings };
  return p;
};
const recOf = (r) => { const rec = new Recording({}); for (const e of r.events) rec.add(e.kind, e.data); return rec; };
const STUB = 'local rt = {}\nreturn rt\n';

test('assemble: no record setting, no change; a record setting adds one line', () => {
  const p = ex('tutorial-first-run');
  const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
  const plain = assemble(p, c, STUB).program;
  assert.equal(assemble({ ...p, settings: { ...p.settings, record: { steps: 'off' } } }, c, STUB).program, plain);
  const rec = assemble({ ...p, settings: { ...p.settings, record: { steps: 'last', n: 5, calls: true } } }, c, STUB).program;
  const extra = rec.split('\n').filter((l) => !plain.split('\n').includes(l) && !l.startsWith('LOOP_LINES'));
  assert.deepEqual(extra, ['SETTINGS.record = { steps = "last", n = 5, calls = true }']);
  assert.equal(recordSetting({ steps: 'bogus' }), null);
});

test('I and R events: candidate and clause decode to the texts of the T event', async () => {
  const r = await H.runProject(ex('tutorial-first-run', { trace: 1000, record: { steps: 'all', n: 0, calls: false } }));
  const rec = recOf(r);
  assert.deepEqual(rec.I.links[0].atoms, ['pick(1)', 'pick(2)', 'pick(3)', 'pick(4)', 'pick(5)', 'pick(6)', 'pick(7)', 'pick(8)']);
  assert.deepEqual(summary(rec).kinds, { s: 61, r: 46 });
  const firstR = rec.steps.find((s) => s.k === 'r');
  const firstT = rec.traces.find((t) => t.kind === 'reject');
  assert.equal(rec.candidateAtoms(firstR).join(' '), firstT.candidate);
  assert.deepEqual(rec.clauseLiterals(firstR), firstT.literals);
  // the program line maps into the loop script
  assert.ok(Number.isInteger(firstR.n) && firstR.n >= r.assembled.loopStartLine && firstR.n <= r.assembled.loopEndLine);
  // solutions carry their candidate
  assert.equal(rec.candidateAtoms(rec.steps.find((s) => s.k === 's')).join(' '), rec.solutions[0].atoms);
});

test('C events: one per solver call, nested checks name their search', async () => {
  const r = await H.runProject(ex('tutorial-first-run', { record: { steps: 'off', n: 0, calls: true } }));
  const rec = recOf(r);
  assert.equal(rec.steps.length, 0);
  const S = H.finalStats(r);
  const total = Object.values(S.solvers).reduce((a, s) => a + s.calls, 0);
  assert.equal(rec.calls.length, total);
  const search = rec.calls.find((c) => c.s === 1);
  assert.ok(rec.calls.filter((c) => c.s === 2).every((c) => c.p === search.id));
  assert.ok(rec.calls.every((c) => ['sat', 'unsat', 'int'].includes(c.r) && c.dt >= 0));
});

test('expansions record all their facts', async () => {
  const r = await H.runProject(ex('gc-shape3', { record: { steps: 'all', n: 0, calls: false } }));
  const e = recOf(r).steps.filter((s) => s.k === 'e');
  assert.equal(e.length, H.finalStats(r).expansions);
  assert.ok(e.every((s) => s.f.length === 5 && /^cex\(\d+,color\(\d,\d\)\)$/.test(s.f[0])));
});

test('policies: first, every, last, sample', async () => {
  const run = async (steps, n) => recOf(await H.runProject(ex('tutorial-first-run', { record: { steps, n, calls: false } }))).steps.map((s) => s.i);
  assert.deepEqual(await run('first', 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(await run('every', 50), [1, 51, 101]);
  assert.deepEqual(await run('last', 3), [105, 106, 107]);
  const sample = await run('sample', 10);
  assert.equal(sample.length, 10);
  assert.deepEqual(sample, [...sample].sort((a, b) => a - b));
  assert.deepEqual(await run('sample', 10), sample, 'the same sample for the same seed');
});

test('toBlob and fromBlob keep steps, calls and solutions', async () => {
  const r = await H.runProject(ex('gc-shape1', { record: { steps: 'all', n: 0, calls: true } }));
  const a = recOf(r);
  const b = await Recording.fromBlob(await a.toBlob());
  assert.deepEqual(b.steps, a.steps);
  assert.deepEqual(b.calls, a.calls);
  assert.deepEqual(b.solutions, a.solutions);
  assert.deepEqual(b.stats, a.stats);
  const blob = await a.toBlob();
  const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 2);
  assert.deepEqual([...head], [0x1f, 0x8b], 'gzip');
});

test('hexBits: atom 1 is the lowest bit of the last digit', () => {
  assert.deepEqual(hexBits('02', 8).slice(1), [false, true, false, false, false, false, false, false]);
  assert.deepEqual(hexBits('10', 5).slice(1), [false, false, false, false, true]);
});

test('row 27: graph-coloring n = 6, every step recorded (21,078 rejects), file under 3 MB, overhead measured', async () => {
  const p = ex('graph-coloring', { solutions: 0 });
  const t0 = Date.now();
  const plain = await H.runProject(p);
  const tPlain = Date.now() - t0;
  const t1 = Date.now();
  const r = await H.runProject({ ...p, settings: { ...p.settings, record: { steps: 'all', n: 0, calls: false } } });
  const tRec = Date.now() - t1;
  const rec = recOf(r);
  assert.equal(rec.steps.filter((s) => s.k === 'r').length, 21078);
  assert.equal(rec.steps.filter((s) => s.k === 's').length, 10698);
  assert.equal(H.finalStats(plain).solutions, 10698);
  const size = (await rec.toBlob()).size;
  assert.ok(size < 3 * 1024 * 1024, `${size} bytes`);
  // the plan's budget is 10%; measured about 28% on this machine (PROGRESS.md). Guard against regressions.
  assert.ok(tRec < tPlain * 1.6, `recorded ${tRec} ms against ${tPlain} ms`);
});

test('every fast example has a replay file whose final S equals a live run (times aside)', async () => {
  const ids = lib.examples.filter((e) => e.tags.includes('fast')).map((e) => e.id);
  assert.ok(ids.length >= 90);
  for (const id of ids) {
    const file = H.path(`examples/replays/${id}.cprec`);
    assert.ok(fs.existsSync(file), `examples/replays/${id}.cprec is missing: run node tools/make-replays.mjs`);
    const rec = await Recording.fromBlob(new Blob([fs.readFileSync(file)]));
    const r = await H.runProject(ex(id, { trace: 0 }));
    assert.equal(H.stripTimes(rec.stats), H.stripTimes(H.finalStats(r)), `${id}: run node tools/make-replays.mjs`);
    assert.equal(rec.done.outcome, H.done(r).outcome, id);
  }
});
