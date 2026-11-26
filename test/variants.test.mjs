// Variants: settings.variant (the run bar's pick), the campaign key, the headless runner, and the
// voting example's strategies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import * as P from '../js/project.js';
import { cellKey } from '../js/campaign.js';
import { parsePairs, showPairs } from '../js/variants.js';
import * as H from './helpers.mjs';

const vote = () => P.load(H.read('examples/voting-justification.json'));

test('settings.variant survives load and save; it is dropped when the project has no variants', () => {
  const p = vote();
  p.settings.variant = 's6';
  assert.equal(JSON.parse(P.save(P.load(P.save(p)))).settings.variant, 's6');
  const q = H.example('tutorial-first-run');
  q.settings.variant = 'x';
  assert.equal('variant' in JSON.parse(P.save(q)).settings, false);
  assert.throws(() => P.load(JSON.stringify({ ...JSON.parse(P.save(p)), settings: { variant: 3 } })), /settings.variant/);
});

test('the run bar picks (settings.instance, settings.variant) do not change campaign cell keys', async () => {
  const p = vote();
  const cell = { inst: p.instances[0], variant: 's1', seed: 0 };
  const suite = { name: 's', limits: { seconds: 30 } };
  const k1 = await cellKey(p, cell, suite, 'e');
  p.settings.instance = p.instances[3].id;
  p.settings.variant = 'multi';
  assert.equal(await cellKey(p, cell, suite, 'e'), k1);
  assert.notEqual(await cellKey(p, { ...cell, variant: 's6' }, suite, 'e'), k1);
});

test('the voting example: a relevant fragment per strategy, a variant per other strategy and per loop, a suite over them', () => {
  const p = vote();
  assert.deepEqual(p.fragments.map((f) => f.name).filter((n) => n.startsWith('relevant')), ['relevant', 'relevant_s1', 'relevant_s6']);
  assert.match(p.loop.text, /solver C = shared \+ check \+ relevant/);
  assert.ok(!/^relevant\(/m.test(p.fragments.find((f) => f.name === 'check').text), 'the check holds no relevant/1 rules');
  assert.deepEqual(p.variants.map((v) => v.name), ['s1', 'reference', 's6', 'fewest', 'multi', 'partial']);
  assert.ok(p.variants.every((v) => typeof v.note === 'string' && v.note.length > 0), 'every variant has a note');
  assert.match(p.variants.find((v) => v.name === 'reference').loop.text, /reject M with G\.block\(M\)/);
  const d = P.derive(p, { variant: 's1' });
  assert.match(d.fragments.find((f) => f.name === 'relevant').text, /strategy 1/);
  const s = p.suites.find((x) => x.name === 'strategies');
  assert.deepEqual(s.variants, ['default', ...p.variants.map((v) => v.name)]);
  assert.ok(s.instances.ids.every((id) => p.instances.find((x) => x.id === id).expected), 'only instances that finish');
  const paper = p.suites.find((x) => x.name === 'paper');
  assert.ok(paper.instances.ids.length >= 15 && paper.instances.ids.every((id) => id.startsWith('paper-')));
  assert.ok(paper.variants.includes('s6') && paper.variants.includes('partial'));
});

test('the voting example: the paper\'s questions have counts, and the k = 8 question is gone', () => {
  const p = vote();
  const paper = p.instances.filter((x) => x.tags.includes('paper'));
  assert.ok(paper.length >= 15);
  for (const x of paper) assert.equal(typeof x.expected.solutions, 'number', x.id);
  assert.ok(!p.instances.some((x) => x.id === 'pareto-neutral-cancel-reinf-k8'));
  // four alternatives: the target profile ranks candidates 1..4
  assert.equal(p.instances.find((x) => x.id === 'paper-c4-v3-k3-p3').constants.num_candidates, '4');
});

test('the voting kit: a readme, a generator with seven recipe questions, a generated suite, a view (E2)', () => {
  const p = vote();
  assert.match(p.readme, /^# Explaining a voting outcome by axioms/);
  assert.match(p.readme, /## Open questions/);
  assert.deepEqual(p.generators.map((g) => g.name), ['vote-question']);
  assert.deepEqual(p.instances.filter((x) => x.recipe).map((x) => [x.id, x.expected.solutions]), [['random-1', 6], ['random-2', 0], ['random-3', 0],
    ['random-4', 17], ['random-5', 27], ['random-6', 4], ['random-7', 10]]);
  const g = p.suites.find((x) => x.name === 'generated');
  assert.equal(g.instances.generator, 'vote-question');
  assert.equal(g.instances.constants.num_voters, 3);
  assert.deepEqual(p.views.map((v) => v.name), ['view']);
});

for (const [variant, solutions] of [['s1', 2], ['reference', 2], ['s6', 2], ['fewest', 2], ['multi', 2], ['partial', 2]]) {
  test(`voting variant ${variant} on cancel-posresp-k2 gives ${solutions} solutions`, async () => {
    const p = vote();
    p.settings = { ...p.settings, solutions: 0, trace: 0, seconds: 0 };
    const r = await H.runProject(P.derive(p, { variant }), { instance: 'cancel-posresp-k2' });
    assert.equal(H.done(r).exhausted, true);
    assert.equal(H.finalStats(r).solutions, solutions);
  });
}

test('tools/run.mjs uses the stored variant pick unless --variant is given', () => {
  const run = (args) => spawnSync('node', [H.path('tools/run.mjs').pathname, ...args], { encoding: 'utf8' });
  const p = JSON.parse(H.read('examples/voting-justification.json'));
  p.settings.variant = 's1';
  const file = nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'cegarplay-')), 'vote-picked.json');
  fs.writeFileSync(file, JSON.stringify(p));
  const inst = 'faith-pareto-neutral-reinf-k4';
  const picked = run([file, '--instance', inst, '--solutions', 'all', '--quiet']).stdout;
  const plain = run([file, '--instance', inst, '--solutions', 'all', '--quiet', '--variant', 'default']).stdout;
  const cands = (s) => Number((/candidates: (\d+)/.exec(s) || [])[1]);
  assert.match(picked, /Solutions: 1;/);
  assert.match(plain, /Solutions: 1;/);
  assert.ok(cands(picked) < cands(plain), `strategy 1 refines more strongly: ${cands(picked)} vs ${cands(plain)}`);
  fs.unlinkSync(file);
});

test('parsePairs and showPairs', () => {
  assert.deepEqual(parsePairs('check=check_alt, relevant = relevant_s3'), { check: 'check_alt', relevant: 'relevant_s3' });
  assert.equal(showPairs({ a: 'b', c: 'd' }), 'a=b, c=d');
  assert.deepEqual(parsePairs(''), {});
  assert.throws(() => parsePairs('check'), /not name=value/);
});

// ---- the variant reaches every path: export, Python checker, proof logs -------------------
const HAVE_CLINGO = spawnSync('python3', ['-c', 'import clingo'], { encoding: 'utf8' }).status === 0;
const tmp = (name, text) => {
  const f = nodePath.join(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'cegarplay-')), name);
  fs.writeFileSync(f, text);
  return f;
};

test('Export for clingo applies the picked variant', () => {
  const p = vote();
  const modules = { ground: '', audit: '', draw: '', generate: '', replay: '' };
  // every fragment is exported; with s1 picked, `relevant` holds strategy 1 as well as relevant_s1
  const count = () => P.exportStandalone(p, H.RUNTIME, modules).split('Refinement strategy 1').length - 1;
  p.settings.variant = 's1';
  assert.equal(count(), 2);
  delete p.settings.variant;
  assert.equal(count(), 1);
});

test('cegarcheck.py --variant and certcheck.py on a proof log of a variant run', { skip: !HAVE_CLINGO && 'Python clingo missing' }, () => {
  const inst = 'faith-pareto-neutral-reinf-k4';
  const py = (tool, ...a) => spawnSync('python3', [H.path(`tools/${tool}`).pathname, ...a], { encoding: 'utf8' });
  const file = H.path('examples/voting-justification.json').pathname;
  const s1 = py('cegarcheck.py', file, '--instance', inst, '--variant', 's1', '--solutions', 'all').stdout;
  const s2 = py('cegarcheck.py', file, '--instance', inst, '--solutions', 'all').stdout;
  const cands = (s) => Number((/candidates: (\d+)/.exec(s) || [])[1]);
  assert.match(s1, /Solutions: 1;/);
  assert.ok(cands(s1) < cands(s2), `${cands(s1)} vs ${cands(s2)}`);
  const log = tmp('proof.jsonl', '');
  const r = spawnSync('node', [H.path('tools/run.mjs').pathname, 'voting-justification', '--variant', 's1', '--instance', 'pareto-neutral-reinf-k5',
    '--solutions', 'all', '--proof', log, '--quiet'], { encoding: 'utf8' });
  assert.match(r.stdout, /Solutions: 1;/);
  assert.equal(JSON.parse(fs.readFileSync(log, 'utf8').split('\n')[0]).variant, 's1');
  const v = JSON.parse(py('certcheck.py', file, log, '--json').stdout);
  assert.equal(v.verdict, 'certified', JSON.stringify(v));
});
