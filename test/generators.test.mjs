// The Python generators of examples/contrib (tools/make-aspq.py, tools/make-bsml.py): their
// --check mode compares what they would write with the committed files, so an edit of a
// generated example by hand (or of a generator without a rerun) shows here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as H from './helpers.mjs';

const HAVE_CLINGO = spawnSync('python3', ['-c', 'import clingo'], { encoding: 'utf8' }).status === 0;

for (const tool of ['make-aspq.py', 'make-bsml.py']) {
  test(`tools/${tool} --check: the committed examples are what it writes`, { skip: !HAVE_CLINGO && 'no Python clingo' }, () => {
    const r = spawnSync('python3', [H.path(`tools/${tool}`).pathname, '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}\nrun: python3 tools/${tool}`);
  });
}
