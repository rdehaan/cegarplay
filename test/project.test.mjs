// Phase 3: project model, import and export, examples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import * as H from './helpers.mjs';
import * as P from '../js/project.js';
import { buildExamples } from '../tools/make-examples.mjs';

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

test('exportLp(importLp(x)) re-imports to the same fragments', () => {
  for (const f of ['graph-coloring.lp', 'nash.lp', 'explain1.lp']) {
    const p = P.importLp(lp(f));
    const q = P.importLp(P.exportLp(p));
    assert.deepEqual(q.fragments, p.fragments, f);
  }
  const p = P.newProject();
  p.fragments.push({ name: 'extra', text: '' });
  assert.equal(P.canExportLp(p), false);
  assert.throws(() => P.exportLp(p));
});

test('the example files are up to date', () => {
  for (const [name, p] of Object.entries(buildExamples())) {
    assert.equal(H.read(`examples/${name}.json`), P.save(p), `${name}.json: run node tools/make-examples.mjs`);
    assert.deepEqual(P.load(H.read(`examples/${name}.json`)), JSON.parse(P.save(p)));
  }
});

test('row 11: nash.lp legacy import equals examples/nash.json', async () => {
  const a = await H.runProject(withSettings(P.importLp(lp('nash.lp')), { solutions: 1 }));
  const b = await H.runProject(withSettings(H.example('nash'), { solutions: 1 }));
  assert.equal(H.last(b, 'E'), undefined);
  assert.equal(H.stripTimes(H.finalStats(a)), H.stripTimes(H.finalStats(b)));
  assert.equal(H.finalStats(a).solutions, 1);
});

test('row 12: graph colouring legacy import equals graph-coloring-original.json, 9,270', async () => {
  const a = await H.runProject(withSettings(P.importLp(lp('graph-coloring.lp')), { solutions: 0, constants: { n: '6' } }));
  const b = await H.runProject(withSettings(H.example('graph-coloring-original'), { solutions: 0 }));
  assert.equal(H.stripTimes(H.finalStats(a)), H.stripTimes(H.finalStats(b)));
  assert.equal(H.finalStats(b).solutions, 9270);
});

test('graph-coloring.json: 10,698 with shape 1 and with shape 4', async () => {
  const p = H.example('graph-coloring');
  const a = await H.runProject(withSettings(p, {}));
  assert.equal(H.finalStats(a).solutions, 10698);
  const b = await H.runProject(withSettings({ ...p, loop: { language: 'loop', text: P.template('shape4') } }, {}));
  assert.equal(H.finalStats(b).solutions, 10698);
});

test('voting-justification.json runs to one solution', async () => {
  const r = await H.runProject(withSettings(H.example('voting-justification'), {}));
  assert.equal(H.last(r, 'E'), undefined);
  assert.equal(H.done(r).outcome, 'solutions');
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
