// Phase 3: project model, import and export, examples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import * as H from './helpers.mjs';
import * as P from '../js/project.js';
import { buildExamples, buildAll, nashFix } from '../tools/make-examples.mjs';

const lp = (f) => H.read(`reference/declarative-cegar/${f}`);
const withSettings = (p, s) => ({ ...p, settings: { ...p.settings, seconds: 0, trace: 0, ...s } });

test('new project: four empty fragments, shape 1, defaults', () => {
  const p = P.newProject();
  assert.deepEqual(p.fragments.map((f) => f.name), ['shared', 'abstraction', 'glue', 'check']);
  assert.equal(p.loop.text, P.template('shape1'));
  assert.equal(p.settings.solutions, 1);
  assert.deepEqual(P.load(P.save(p)), p);
});

test('load/save round trip keeps unknown keys', () => {
  const p = { ...P.newProject('T'), extra: { a: 1 } };
  p.fragments[0].note = 'x';
  const q = P.load(P.save(p));
  assert.deepEqual(q, p);
  assert.equal(P.save(q), P.save(p));
  assert.ok(P.save(p).includes('\n  "format": "cegarplay"'));
});

test('load fills defaults and rejects bad files', () => {
  const q = P.load({ format: 'cegarplay', fragments: [{ name: 'a', text: 'x.' }] });
  assert.equal(q.loop.language, 'loop');
  assert.equal(q.settings.trace, 200);
  assert.deepEqual(q.runs, []);
  assert.throws(() => P.load({ aux_program: '', goal_program: '' }), /logic-game file/);
  assert.throws(() => P.load('{'), /not a JSON file/);
  assert.throws(() => P.load({ format: 'cegarplay', fragments: [{ name: 'A' }] }), /invalid name/);
  assert.throws(() => P.load({ format: 'cegarplay', fragments: [{ name: 'a' }, { name: 'a' }] }), /duplicate/);
});

test('importLp: the three reference files', () => {
  const cases = { 'graph-coloring.lp': true, 'nash.lp': true, 'explain1.lp': false };
  for (const [f, legacy] of Object.entries(cases)) {
    const p = P.importLp(lp(f), f);
    assert.deepEqual(p.fragments.map((x) => x.name), ['shared', 'abstraction', 'glue', 'check']);
    for (const x of p.fragments) assert.ok(x.text.trim().length > 0, `${f}: ${x.name} is empty`);
    assert.equal(p.loop.text.includes('glue legacy'), legacy, f);
    assert.ok(!p.fragments.some((x) => /#program\s+(shared|guess|glue|check)\s*\./.test(P.stripComments(x.text))), f);
  }
});

test('importLp: explain1.lp is split despite its comments', () => {
  const p = P.importLp(lp('explain1.lp'));
  const g = p.fragments.find((f) => f.name === 'glue').text;
  assert.match(g, /glue\(profile\(Prof,V,Cand,Pos\)\)/);
  assert.ok(!/1 \{ /.test(P.stripComments(g)));
  // a directive inside comments or strings does not split
  const q = P.importLp('a.\n% #program check.\n%* #program glue. *%\nb("#program check.").\n#program check.\nc.\n');
  assert.match(q.fragments[1].text, /a\.[\s\S]*b\("#program check\."\)/);
  assert.equal(q.fragments[3].text.trim(), 'c.');
  // other directives stay in place
  const r = P.importLp('#program guess.\na.\n#program refine(k).\nb(k).\n#program check.\nc.\n');
  assert.match(r.fragments[1].text, /#program refine\(k\)\.\nb\(k\)\./);
});

test('the example files are up to date', () => {
  const { files } = buildAll();
  for (const name of Object.keys(buildExamples())) {
    const p = files[name];
    assert.equal(H.read(`examples/${name}.json`), P.save(p), `${name}.json: run node tools/make-examples.mjs`);
    assert.deepEqual(P.load(H.read(`examples/${name}.json`)), JSON.parse(P.save(p)));
  }
});

test('row 11: nash.lp legacy import (with the edge/3 fix) equals examples/nash.json', async () => {
  const imported = P.importLp(lp('nash.lp'));
  const check = imported.fragments.find((f) => f.name === 'check');
  check.text = nashFix(check.text);
  const a = await H.runProject(withSettings(imported, { solutions: 1 }));
  // instance '' = the project as written (n = 5), as the legacy file
  const b = await H.runProject(withSettings(H.example('nash'), { solutions: 1, instance: '' }));
  assert.equal(H.last(b, 'E'), undefined);
  assert.equal(H.stripTimes(H.finalStats(a)), H.stripTimes(H.finalStats(b)));
  assert.equal(H.finalStats(a).solutions, 1);
});

test('row 12: graph colouring legacy import (original rules) gives 9,270', async () => {
  const a = await H.runProject(withSettings(P.importLp(lp('graph-coloring.lp')), { solutions: 0, constants: { n: '6' } }));
  assert.equal(H.last(a, 'E'), undefined);
  assert.equal(H.finalStats(a).solutions, 9270);
});

test('graph-coloring.json: 10,698 with shape 1 and with shape 4', async () => {
  const p = H.example('graph-coloring');
  const a = await H.runProject(withSettings(p, {}));
  assert.equal(H.finalStats(a).solutions, 10698);
  const b = await H.runProject(withSettings({ ...p, loop: { language: 'loop', text: P.template('shape4') } }, {}));
  assert.equal(H.finalStats(b).solutions, 10698);
});

test('voting-justification.json: the default question has one justification (all solutions)', async () => {
  const r = await H.runProject(withSettings(H.example('voting-justification'), {}));
  assert.equal(H.last(r, 'E'), undefined);
  assert.equal(H.done(r).outcome, 'finished');
  assert.equal(H.finalStats(r).solutions, 1);
});

test('standalone export runs in the engine (plain output)', async () => {
  const p = withSettings(H.example('graph-coloring'), { solutions: 3 });
  const text = P.exportStandalone(p, H.RUNTIME);
  assert.match(text, /^% Graph colouring: standalone program/);
  const r = await H.run(text);
  assert.equal(r.out.filter((l) => l.startsWith('Answer: ')).length, 3);
  assert.ok(r.out.some((l) => /^Outcome\s+: solutions/.test(l)));
});

let nativeLua = false;
try { nativeLua = /with Lua/.test(execFileSync('clingo', ['--version'], { encoding: 'utf8' })); } catch { /* no clingo */ }
test('standalone export runs in a native clingo with Lua', { skip: !nativeLua && 'no native clingo with Lua on the PATH' }, () => {
  const p = withSettings(H.example('graph-coloring'), { solutions: 0 });
  const file = nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'cegarplay-')), 'gc.lp');
  fs.writeFileSync(file, P.exportStandalone(p, H.RUNTIME));
  let out = '';
  try { out = execFileSync('clingo', [file, '--outf=3'], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { out = e.stdout; }
  assert.match(out, /Solutions\s+: 10698/);
});

test('the starter project runs: n = 4 gives the 4 non-empty downward-closed sets', async () => {
  const H = await import('./helpers.mjs');
  const r = await H.runProject(P.starterProject());
  const sols = H.ofKind(r, 'M').map((m) => m.atoms).sort();
  assert.deepEqual(sols, ['pick(1)', 'pick(1) pick(2)', 'pick(1) pick(2) pick(3)', 'pick(1) pick(2) pick(3) pick(4)']);
  assert.equal(H.ofKind(r, 'D')[0].outcome, 'finished');
  assert.equal(H.ofKind(r, 'W').length, 0);
});

test('settings.audit: a project without it saves byte-identically; enumeration is not written', () => {
  const dir = new URL('../examples/', import.meta.url).pathname;
  for (const name of ['tutorial-weak-relevant', 'af-preferred', 'graph-coloring']) {
    const text = fs.readFileSync(dir + name + '.json', 'utf8');
    assert.equal(P.save(P.load(text)), text, name);
  }
  const text = fs.readFileSync(dir + 'tutorial-weak-relevant.json', 'utf8');
  const p = P.load(text);
  // the default mode, as the run bar stores it, leaves the file as it was
  p.settings.audit = { mode: 'enumerate' };
  assert.equal(P.save(p), text);
  // a space mode without spaces is not written either
  const starter = fs.readFileSync(dir + 'starter.json', 'utf8');
  const q = P.load(starter);
  assert.equal((q.spaces || []).length, 0);
  q.settings.audit = { mode: 'space', space: 'x', bound: 2 };
  assert.equal(P.save(q), starter);
  // the other modes round-trip
  p.settings.audit = { mode: 'space', space: 'n', bound: 3 };
  const saved = P.save(p);
  assert.deepEqual(JSON.parse(saved).settings.audit, { mode: 'space', space: 'n', bound: 3 });
  assert.deepEqual(P.load(saved).settings.audit, { mode: 'space', space: 'n', bound: 3 });
  p.settings.audit = { mode: 'symbolic' };
  assert.deepEqual(P.load(P.save(p)).settings.audit, { mode: 'symbolic' });
  // malformed
  for (const bad of [{ mode: 'fast' }, 'symbolic', { mode: 'space', bound: -1 }, { mode: 'space', space: 3 }]) {
    const j = JSON.parse(text); j.settings.audit = bad;
    assert.throws(() => P.load(JSON.stringify(j)), /settings\.audit/);
  }
});
