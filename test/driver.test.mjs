// Phase 3: validation and assembly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { validate, assemble, parseClingoErrors, luaLongString } from '../js/driver.js';
import { template } from '../js/project.js';

const proj = (frags, text = template('shape1', { legacy: true }), settings = {}) =>
  ({ ...H.projectOf(frags, settings), loop: { language: 'loop', text } });

test('valid project: no problems', async () => {
  const ps = await validate(proj(H.GC6(), template('shape1', { legacy: true }), { constants: { n: '6' } }), H.engineRun);
  assert.deepEqual([...ps], []);
  assert.ok(ps.compiled.ok);
});

test('missing dot, mapped to the check fragment (second in its solver)', async () => {
  const f = H.GC6();
  f.check = 'a :- b\nc.\n' + f.check;
  const ps = await validate(proj(f), H.engineRun);
  assert.equal(ps.length, 1, JSON.stringify(ps));
  assert.deepEqual(ps[0].where, { kind: 'fragment', name: 'check', line: 2, col: 1 });
  assert.match(ps[0].message, /syntax error, unexpected <IDENTIFIER>/);
  assert.equal(ps[0].severity, 'error');
});

test('unsafe variable, mapped to its line, with the note', async () => {
  const f = H.GC6();
  f.check = '\np(X) :- q.\n' + f.check;
  const ps = await validate(proj(f), H.engineRun);
  assert.equal(ps.length, 1, JSON.stringify(ps));
  assert.deepEqual(ps[0].where, { kind: 'fragment', name: 'check', line: 2, col: 1 });
  assert.match(ps[0].message, /unsafe variables in/);
  assert.match(ps[0].message, /'X' is unsafe/);
});

test('a fragment used by several solvers is reported once', async () => {
  const f = H.GC6();
  f.shared += '\nbroken(\n';
  const ps = await validate(proj(f), H.engineRun);
  assert.equal(ps.length, 1, JSON.stringify(ps));
  assert.equal(ps[0].where.name, 'shared');
});

test('a never-grounded refine part is checked too', async () => {
  const f = H.GC6();
  f.abstraction += '\n#program refine(k).\nfoo(X) :- bar(k).\n';
  const ps = await validate(proj(f), H.engineRun);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].where.name, 'abstraction');
  assert.match(ps[0].message, /'X' is unsafe/);
});

test('compile errors stop validation and point at the loop', async () => {
  const ps = await validate(proj(H.GC6(), 'solver A = nope\n'), H.engineRun);
  assert.deepEqual(ps[0].where, { kind: 'loop', name: 'loop', line: 1, col: 12 });
});

test('expand part missing from the fragments of that solver', async () => {
  const ps = await validate(proj(H.GC6(), template('shape3', { legacy: true })), H.engineRun);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].where.kind, 'loop');
  assert.match(ps[0].message, /no fragment of solver A contains '#program refine\(k\).'/);
  const f = H.GC6();
  f.abstraction += '\n% #program refine(k).\n';
  assert.equal((await validate(proj(f, template('shape3', { legacy: true })), H.engineRun)).length, 1);
  f.abstraction += H.REFINE_PART;
  assert.equal((await validate(proj(f, template('shape3', { legacy: true })), H.engineRun)).length, 0);
});

test('settings: constant names and values', async () => {
  const ps = await validate(proj(H.GC6(), undefined, { constants: { N: '6', m: 'a b', k: '' } }), H.engineRun);
  assert.equal(ps.filter((p) => p.where.kind === 'settings').length, 3);
});

test('raw Lua projects: every fragment checked on its own', async () => {
  const f = H.GC6();
  f.glue += '\nx :- \n';
  const p = { ...H.projectOf(f), loop: { language: 'lua', text: 'rt.log("hi")' } };
  const ps = await validate(p, H.engineRun);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].where.name, 'glue');
});

test('parseClingoErrors handles L2:C2 ranges and continuation lines', () => {
  const es = parseClingoErrors(['-:2:1-3:4: error: unsafe variables in:', '  p(X):-q.', '-:2:3-4: note: \'X\' is unsafe', '-:5:1-2: error: syntax error']);
  assert.equal(es.length, 2);
  assert.equal(es[0].line, 2);
  assert.match(es[0].message, /p\(X\):-q\.\n'X' is unsafe/);
});

test('long strings choose a safe level', () => {
  assert.equal(luaLongString('a'), '[==[\na]==]');
  assert.equal(luaLongString('x ]==] y'), '[===[\nx ]==] y]===]');
});

test('assemble: settings, constants and the loop position', () => {
  const p = proj(H.GC6(), 'rt.log(1)', { constants: { n: '6' }, solutions: 3, seconds: 5, candidates: 7, trace: 2, seed: 4 });
  const a = assemble(p, 'rt.log(1)\nrt.log(2)', H.RUNTIME, { poll: true });
  const lines = a.program.split('\n');
  assert.equal(lines[a.loopStartLine - 1], 'rt.log(1)');
  assert.equal(lines[a.loopEndLine - 1], 'rt.log(2)');
  assert.ok(a.program.includes('CONSTS = { "n=6" }'));
  assert.ok(a.program.includes('SETTINGS = { solutions = 3, seconds = 5, candidates = 7, trace = 2, seed = 4, poll = true, plain = false }'));
  assert.ok(a.program.startsWith('#script (lua)\n') && a.program.endsWith('#end.\n'));
});

// TODO A5: clingo's internal part literal is not shown; the run bar gets one sentence.
import { cleanClingoMessage, oneLineMessage } from '../js/driver.js';
test('A5: unsafe variables: no #inc_ in the message, one-line form names the variable', async () => {
  const p = H.example('tutorial-first-run');
  p.fragments[1].text += '\nbar(Y).\n#program step(k).\nfoo(X) :- num(k).\n';
  const probs = (await validate(p, H.engineRun)).filter((x) => x.severity === 'error');
  assert.equal(probs.length, 2);
  for (const pr of probs) assert.doesNotMatch(pr.message, /#inc_/);
  assert.equal(probs[0].message, "unsafe variables in:\nbar(Y).\n'Y' is unsafe");
  assert.equal(oneLineMessage(probs[0].message), "unsafe variable 'Y' in bar(Y).");
  assert.match(probs[1].message, /^unsafe variables in:\nfoo\(X\):-num\(#Inc0\)\.\n'X' is unsafe$/);
  assert.equal(cleanClingoMessage('a(X):-[#inc_base];b(X).'), 'a(X):-b(X).');
  assert.equal(oneLineMessage('syntax error, unexpected .'), 'syntax error, unexpected .');
});

test('a fragment with its own #script (lua) ... #end. part does not end the program\'s Lua block', async () => {
  const lua = '#script (lua)\nfunction twice(x) return clingo.Number(2 * x.number) end\n#end.\n';
  assert.equal(luaLongString(lua).includes('#end'), false);
  // the long strings put back together give the text again
  const parts = [...luaLongString('a #end. b #end').matchAll(/\[(=+)\[\n?([\s\S]*?)\]\1\]/g)].map((m) => m[2]);
  assert.equal(parts.join(''), 'a #end. b #end');
  const p = H.projectOf({ shared: 'num(1..3).', abstraction: '{ pick(X) } :- num(X).', glue: 'glue(pick(X)) :- num(X).', check: 'bad :- pick(1).\n:- not bad.\nrelevant(pick(1)).', view: lua + 'draw(note(@twice(2))).' }, { solutions: 0 });
  p.loop = { language: 'loop', text: 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue\nsearch A:\n    on candidate M:\n        X = C.solve(assume G(M))\n        if X: reject M with G.clause(M, X)\n' };
  const r = await H.runProject(p);
  assert.equal(H.done(r).outcome, 'finished');
  assert.equal(H.finalStats(r).solutions, 4);
});
