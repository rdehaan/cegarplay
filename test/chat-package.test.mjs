// The chat package: tools/cegarcheck.py (Python clingo), examples/contrib/, tools/make-chat-package.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as H from './helpers.mjs';
import { loadContrib, buildAll } from '../tools/make-examples.mjs';
import { buildPackage } from '../tools/make-chat-package.mjs';

const lib = JSON.parse(H.read('examples/library.json'));
const expected = (id) => lib.examples.find((e) => e.id === id).expected.solutions;
const HAVE_CLINGO = spawnSync('python3', ['-c', 'import clingo'], { encoding: 'utf8' }).status === 0;
const check = (file, ...args) => {
  const r = spawnSync('python3', [H.path('tools/cegarcheck.py').pathname, file, ...args], { encoding: 'utf8' });
  const m = /Solutions: (\d+);/.exec(r.stdout);
  return { code: r.status, out: r.stdout + r.stderr, solutions: m ? Number(m[1]) : null, exhausted: /exhausted: yes/.test(r.stdout) };
};
const ex = (id) => H.path(`examples/${id}.json`).pathname;

const SUPPORTED = ['starter', 'tutorial-first-run', 'lang-basics', 'lang-several-cex', 'lang-optimal', 'lang-clauses',
  'lang-core', 'lang-legacy', 'gc-shape1', 'gc-shape2', 'gc-shape3', 'gc-shape4', 'gc-reference'];
for (const id of SUPPORTED) {
  test(`cegarcheck: ${id} gives the library count, in its own mode and in block mode`, { skip: !HAVE_CLINGO && 'no Python clingo' }, () => {
    for (const args of [[], ['--mode', 'block']]) {
      const r = check(ex(id), '--solutions', 'all', ...args);
      assert.equal(r.code, 0, r.out);
      assert.ok(r.exhausted, r.out);
      assert.equal(r.solutions, expected(id), `${args.join(' ')}\n${r.out}`);
    }
  });
}

test('cegarcheck: refuses raw Lua and multi-solver scripts', { skip: !HAVE_CLINGO && 'no Python clingo' }, () => {
  for (const id of ['lang-raw-lua', 'lang-two-stage', 'lang-second-solver']) {
    const r = check(ex(id));
    assert.equal(r.code, 1);
    assert.match(r.out, /check this one with tools\/run\.mjs/);
  }
});

test('cegarcheck: reports relevant/1 that derives nothing', { skip: !HAVE_CLINGO && 'no Python clingo' }, () => {
  const p = JSON.parse(H.read('examples/starter.json'));
  const c = p.fragments.find((f) => f.name === 'check');
  c.text = c.text.replace(/relevant\(.*\n/g, '');
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'cegarcheck-'));
  const file = join(dir, 'p.json');
  fs.writeFileSync(file, JSON.stringify(p));
  const r = check(file);
  fs.rmSync(dir, { recursive: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /relevant\/1 derived nothing for link G/);
});

test('contrib: a project with a library block becomes a library entry; bad blocks are refused', () => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'contrib-'));
  const url = new URL(`file://${dir}/`);
  const t = JSON.parse(buildPackage()['contrib-template.json']);
  fs.writeFileSync(join(dir, 'a.json'), JSON.stringify({ ...t, library: { ...t.library, id: 'demo' } }));
  try {
    const { files, manifest } = buildAll({ contribDir: url });
    const e = manifest.examples.find((x) => x.id === 'demo');
    assert.deepEqual([e.group, e.expected], ['exists-forall', { solutions: 4 }]);
    // the older group name is sorted by the loop
    fs.writeFileSync(join(dir, 'a.json'), JSON.stringify({ ...t, library: { ...t.library, id: 'demo', group: 'problems' } }));
    assert.equal(loadContrib(url)[0].group, 'exists-forall');
    fs.writeFileSync(join(dir, 'a.json'), JSON.stringify({ ...t, loop: { language: 'lua', text: '' }, library: { ...t.library, id: 'demo', group: 'problems' } }));
    assert.equal(loadContrib(url)[0].group, 'several-solvers');
    assert.equal(files.demo.library, undefined);
    assert.equal(files.demo.title, 'My problem');
    for (const [lib2, msg] of [[{ ...t.library, id: 'nash' }, /already used/], [{ ...t.library, id: 'a b' }, /library\.id/],
      [{ ...t.library, group: 'tutorial' }, /library\.group/], [{ ...t.library, expected: 1.5 }, /expected/], [undefined, /no "library" block/]]) {
      fs.writeFileSync(join(dir, 'a.json'), JSON.stringify({ ...t, library: lib2 }));
      assert.throws(() => loadContrib(url, new Set(['nash'])), msg);
    }
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
  assert.deepEqual(loadContrib(new URL('file:///nonexistent-dir/')), []);
});

test('chat package: flat, every example, ids filled in, files it names exist', () => {
  const files = buildPackage();
  for (const e of lib.examples) assert.ok(files[`example-${e.id}.json`], e.id);
  const start = files['00-START-HERE.md'];
  assert.ok(!start.includes('{{'), 'placeholder left');
  for (const e of lib.examples) assert.ok(start.includes('`' + e.id + '`'), e.id);
  for (const [, name] of start.matchAll(/`([\w.-]+\.(?:json|md|html|py))`/g)) {
    if (name.includes('<') || name.startsWith('my-problem')) continue;
    assert.ok(files[name], `START-HERE names ${name}, which is not in the package`);
  }
  assert.ok(Object.keys(files).every((n) => !n.includes('/')));
});
