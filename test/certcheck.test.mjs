// Phase S5: proof logs and tools/certcheck.py (docs/spec-soundness.md section 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as H from './helpers.mjs';

const HAVE_CLINGO = spawnSync('python3', ['-c', 'import clingo'], { encoding: 'utf8' }).status === 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'certcheck-'));
const run = (...a) => spawnSync('node', [H.path('tools/run.mjs').pathname, ...a], { encoding: 'utf8' });
const check = (project, log) => {
  const r = spawnSync('python3', [H.path('tools/certcheck.py').pathname, project, log, '--json'], { encoding: 'utf8' });
  return { code: r.status, v: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
};
function proof(id, extra = []) {
  const file = path.join(dir, `${id}${extra.join('')}.jsonl`);
  const r = run(id, '--solutions', 'all', '--quiet', '--proof', file, ...extra);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return file;
}
const ex = (id) => H.path(`examples/${id}.json`).pathname;
const opts = { skip: !HAVE_CLINGO && 'Python clingo missing' };

test('the proof log: Q table, x and v on every refinement', () => {
  const lines = fs.readFileSync(proof('tutorial-first-run'), 'utf8').trim().split('\n');
  const header = JSON.parse(lines[0]);
  assert.match(header.fragmentsHash, /^[0-9a-f]{8}$/);
  const ev = lines.slice(1).map((l) => ({ k: l[2], d: JSON.parse(l.slice(4)) }));
  assert.equal(ev.filter((e) => e.k === 'Q').length, 1);
  const R = ev.filter((e) => e.k === 'R' && e.d.k === 'r');
  assert.equal(R.length, 46);
  assert.ok(R.every((e) => /^[0-9a-f]+$/.test(e.d.x) && e.d.v === 2));
});

test('certcheck accepts tutorial-first-run, qbf and graph-coloring at n = 5', opts, () => {
  for (const [id, extra, sols] of [['tutorial-first-run', [], 61], ['qbf', [], 5], ['graph-coloring', ['--instance', 'n5'], 101]]) {
    const r = check(ex(id), proof(id, extra));
    assert.equal(r.code, 0, `${id}: ${JSON.stringify(r.v)} ${r.err}`);
    assert.equal(r.v.verdict, 'certified');
    assert.equal(r.v.solutions, sols, id);
  }
});

test('certcheck rejects the log of tutorial-weak-relevant at check 2', opts, () => {
  const r = check(ex('tutorial-weak-relevant'), proof('tutorial-weak-relevant'));
  assert.equal(r.code, 1);
  assert.equal(r.v.check, 2);
});

function mutate(file, fn, name) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const out = fn(lines);
  const f = path.join(dir, name);
  fs.writeFileSync(f, out.join('\n') + '\n');
  return f;
}
const parse = (l) => JSON.parse(l.slice(4));

test('certcheck rejects three mutations: a literal removed, a solution removed, a certificate level changed', opts, () => {
  const fr = proof('tutorial-first-run');
  // one literal removed from the first rejected clause
  const m1 = mutate(fr, (ls) => {
    const i = ls.findIndex((l) => l.startsWith('@@R') && parse(l).k === 'r');
    const d = parse(ls[i]); d.q = d.q.slice(0, 1);
    ls[i] = '@@R ' + JSON.stringify(d);
    return ls;
  }, 'm1.jsonl');
  const r1 = check(ex('tutorial-first-run'), m1);
  assert.equal(r1.code, 1, JSON.stringify(r1.v));
  assert.equal(r1.v.check, 2);
  // one solution removed (its solution step and its M event)
  const m2 = mutate(fr, (ls) => {
    const i = ls.findIndex((l) => l.startsWith('@@R') && parse(l).k === 's');
    const j = ls.findIndex((l) => l.startsWith('@@M'));
    return ls.filter((_, k) => k !== i && k !== j);
  }, 'm2.jsonl');
  const r2 = check(ex('tutorial-first-run'), m2);
  assert.equal(r2.code, 1, JSON.stringify(r2.v));
  assert.equal(r2.v.check, 4);
  // graph-coloring n = 5: a level-3 certificate claimed at level 2 (level 2 certifies none there)
  const gc = proof('graph-coloring', ['--instance', 'n5']);
  const m3 = mutate(gc, (ls) => {
    const i = ls.findIndex((l) => l.startsWith('@@R') && parse(l).v === 3);
    const d = parse(ls[i]); d.v = 2;
    ls[i] = '@@R ' + JSON.stringify(d);
    return ls;
  }, 'm3.jsonl');
  const r3 = check(ex('graph-coloring'), m3);
  assert.equal(r3.code, 1, JSON.stringify(r3.v));
  assert.equal(r3.v.check, 2);
});

test('row 27: the proof log stays under twice the size of the plain recording', { skip: (!H.SLOW && 'slow (SLOW=1)') || (!HAVE_CLINGO && 'Python clingo missing') }, () => {
  const p = proof('graph-coloring', ['--instance', 'n6']);
  const rec = path.join(dir, 'gc6.cprec');
  assert.equal(run('graph-coloring', '--instance', 'n6', '--solutions', 'all', '--quiet', '--record', rec, '--record-steps', 'all').status, 0);
  const plain = zlib.gunzipSync(fs.readFileSync(rec)).length;   // (spawnSync's 1 MB buffer would cut it)
  const size = fs.statSync(p).size;
  console.log(`# row 27: proof log ${size} bytes, plain recording ${plain} bytes (${(size / plain).toFixed(2)}x)`);
  assert.ok(size < 2 * plain);
  assert.equal(check(ex('graph-coloring'), p).v.verdict, 'certified');
});

test('review of wave 5: a level-0 block of an unreported solution, a fake solution, a level-4 claim that loses a solution are rejected', opts, () => {
  const fr = proof('tutorial-first-run');
  // a solution step replaced by a level-0 block of the same candidate (and its M dropped)
  const m1 = mutate(fr, (ls) => {
    const i = ls.findIndex((l) => l.startsWith('@@R') && parse(l).k === 's');
    const d = parse(ls[i]);
    const n = 8;
    const bits = parseInt(d.c, 16);
    const q = Array.from({ length: n }, (_, j) => ((bits >> j) & 1 ? -(j + 1) : j + 1));
    ls[i] = '@@R ' + JSON.stringify({ i: d.i, k: 'r', s: d.s, l: d.l, n: d.n, t: d.t, c: d.c, q, v: 0 });
    const j = ls.findIndex((l) => l.startsWith('@@M'));
    return ls.filter((_, k) => k !== j);
  }, 'w5a.jsonl');
  const r1 = check(ex('tutorial-first-run'), m1);
  assert.equal(r1.code, 1, JSON.stringify(r1.v));
  // a fake solution: a candidate the abstraction does not have (pick(9) does not exist: bit 9)
  const m2 = mutate(fr, (ls) => {
    const i = ls.findIndex((l) => l.startsWith('@@R') && parse(l).k === 's');
    const d = parse(ls[i]);
    const fake = { ...d, i: 9999, c: (parseInt(d.c, 16) ^ 0x3).toString(16) };
    const j = ls.findIndex((l) => l.startsWith('@@M'));
    ls.splice(i + 1, 0, '@@R ' + JSON.stringify(fake));
    ls.splice(j + 2, 0, ls[j + 1]);
    return ls;
  }, 'w5b.jsonl');
  const r2 = check(ex('tutorial-first-run'), m2);
  assert.equal(r2.code, 1, JSON.stringify(r2.v));
  // tutorial-weak-relevant: every uncertified refinement claimed at level 4
  const wr = proof('tutorial-weak-relevant');
  const m3 = mutate(wr, (ls) => ls.map((l) => (l.startsWith('@@R') && parse(l).v === null ? '@@R ' + JSON.stringify({ ...parse(l), v: 4 }) : l)), 'w5c.jsonl');
  const r3 = check(ex('tutorial-weak-relevant'), m3);
  assert.equal(r3.code, 1, JSON.stringify(r3.v));
  assert.equal(r3.v.check, 2);
  assert.match(r3.v.reason, /level 4/);
});
