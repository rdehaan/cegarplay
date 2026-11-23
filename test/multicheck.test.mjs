// tools/multicheck.py: a brute-force reference for loops with several checks (Checking tools).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as H from './helpers.mjs';

const HAVE_CLINGO = spawnSync('python3', ['-c', 'import clingo'], { encoding: 'utf8' }).status === 0;
const mc = (...a) => spawnSync('python3', [H.path('tools/multicheck.py').pathname, ...a, '--json'], { encoding: 'utf8' });
const lib = JSON.parse(H.read('examples/library.json'));
const expected = (id) => lib.examples.find((e) => e.id === id).expected.solutions;

test('multicheck agrees with the library counts of the several-check loops', { skip: !HAVE_CLINGO && 'Python clingo missing' }, () => {
  for (const [id, nChecks, witness] of [['boolean-game', 1, 0], ['abduction-two-checks', 2, 1], ['minimal-reasons', 2, 1], ['lang-two-stage', 2, 0], ['lang-core', 1, 1]]) {
    const r = mc(H.path(`examples/${id}.json`).pathname);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const v = JSON.parse(r.stdout);
    assert.equal(v.solutions, expected(id), id);
    assert.equal(v.checks.length, nChecks, id);
    assert.equal(v.checks.filter((c) => c.witness).length, witness, id);
  }
  const chain = JSON.parse(mc(H.path('examples/knapsack-fortification.json').pathname).stdout);
  assert.match(chain.error, /chain/);
});
