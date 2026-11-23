// The booklet: book/cegarplay.md is generated from guide/ and tutorial.html by
// tools/export-book.py and must never drift from a fresh export.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import * as H from './helpers.mjs';

const EXPORTER = H.path('tools/export-book.py').pathname;
const py = (...a) => spawnSync('python3', [EXPORTER, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
const HAVE_PANDOC = spawnSync('pandoc', ['--version']).status === 0;

test('book/cegarplay.md matches a fresh export', () => {
  const r = py('--check');
  assert.equal(r.status, 0, r.stderr + '\nrun: python3 tools/export-book.py');
});

test('the book follows its writing rules', () => {
  const r = py('--lint');
  assert.equal(r.status, 0, r.stdout);
});

test('the book is self-contained: every internal link lands', () => {
  const md = H.read('book/cegarplay.md');
  const ids = new Set([...md.matchAll(/\{[^}\n]*#([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  const links = [...md.matchAll(/\]\((#[^)\s]+)\)/g)].map((m) => m[1].slice(1));
  assert.ok(links.length > 50);
  const missing = links.filter((l) => !ids.has(l));
  assert.deepEqual([...new Set(missing)], []);
  const prose = md.replace(/^(`{3,}).*\n[\s\S]*?^\1\s*$/gm, '');
  assert.doesNotMatch(prose, /\]\((?!#)[^)]*\)/, 'only internal links');
  assert.match(md, /^---\ntitle: Designing CEGAR loops\n/);
  assert.match(md, /^# Part I: Designing CEGAR loops \{#part-1\}$/m);
  assert.match(md, /^# Part II: The playground \{#part-2\}$/m);
});

test('pandoc converts the book to EPUB', { skip: !HAVE_PANDOC && 'no pandoc' }, () => {
  const out = fs.mkdtempSync(os.tmpdir() + '/book-');
  const r = spawnSync('pandoc', [H.path('book/cegarplay.md').pathname, '-o', out + '/x.epub'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  fs.rmSync(out, { recursive: true });
});
