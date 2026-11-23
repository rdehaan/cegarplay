// PLAN3 phase S7: instance spaces and bounded verification (docs/spec-instances.md section 8,
// docs/spec-soundness.md section 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { read, path, engineRun, GEN_LUA } from './helpers.mjs';
import { resolveProject } from '../js/instances.js';
import { auditProject, loadTarget, spaceAudit } from '../tools/audit.mjs';
import * as P from '../js/project.js';
import { SPACES } from '../tools/library.mjs';


test('S7: a project without spaces round-trips byte-identically; spaces load, validate and save', () => {
  for (const id of ['tutorial-first-run', 'gc-shape3', 'qbf-expansion']) {
    const text = read(`examples/${id}.json`);
    assert.equal(P.save(P.load(text)), text, id);
  }
  const p = P.load(read('examples/tutorial-first-run.json'));
  assert.equal(p.version, 2);
  assert.equal(p.spaces[0].name, 'n');
  assert.equal(P.save(P.load(P.save(p))), P.save(p));
  const base = JSON.parse(read('examples/tutorial-first-run.json'));
  delete base.spaces;
  const bad = (spaces) => () => P.load({ ...base, spaces });
  assert.throws(bad({}), /spaces must be a list/);
  assert.throws(bad([{ name: 'a b', text: '' }]), /name/);
  assert.throws(bad([{ name: 'a', text: '' }]), /at least one parameter/);
  assert.throws(bad([{ name: 'a', text: '', params: { n: 'permille' } }]), /use int/);
  assert.throws(bad([{ name: 'a', text: '', params: { n: 'int' }, bound: 'm' }]), /bound/);
  assert.throws(bad([{ name: 'a', text: '', params: { n: 'int' }, expected: { verdict: 'fine', k: 1 } }]), /expected/);
  assert.throws(bad([{ name: 'a', text: '', params: { n: 'int' } }, { name: 'a', text: '', params: { n: 'int' } }]), /duplicate/);
  assert.throws(() => P.load({ ...base, instances: [{ id: 'x', facts: '', symbolic: 'maybe' }] }), /symbolic/);
});

test('S7: deriveSpace puts the space (and the schema) into the instance fragment, with the bound as a constant', () => {
  const p = P.load(read('examples/af-preferred.json'));
  const d = P.deriveSpace(p, 'frameworks', { size: 3 });
  assert.equal(d.fragments[0].name, 'instance');
  assert.match(d.fragments[0].text, /arg\(1\.\.size\)/);
  assert.equal(d.settings.constants.size, '3');
  assert.deepEqual(d.instances, []);
  const withSchema = { ...p, fragments: [...p.fragments, { name: 'schema', text: ':- att(X,X).' }] };
  assert.match(P.deriveSpace(withSchema, 'frameworks', { size: 2 }).fragments[0].text, /:- att\(X,X\)\./);
  assert.throws(() => P.deriveSpace(p, 'nope', {}), /no space named/);
  const k = P.load(read('examples/knapsack-interdiction.json'));
  assert.deepEqual(P.deriveSpace(k, 'items', { size: 2 }).settings.constants, { budget: '2', capacity: '4', bound: '4', size: '2' });
});

test('S7: tutorial-first-run is bounded-sound up to n = 10; tutorial-weak-relevant breaks where the audit does', async () => {
  const r = await spaceAudit(loadTarget('tutorial-first-run'), { space: 'n', to: 10 });
  assert.equal(r.verdict, 'sound');
  assert.equal(r.k, 10);
  assert.equal(r.perK.length, 10);
  // the enumerative audit over n = 1, 2, ...: the first unsound n
  const weak = loadTarget('tutorial-weak-relevant');
  let first = null;
  for (let n = 1; n <= 6 && first === null; n++) {
    const v = (await auditProject({ ...weak, settings: { ...weak.settings, constants: { n: String(n) } } })).verdict;
    if (v.verdict === 'unsound') first = n;
  }
  const s = await spaceAudit(weak, { space: 'n', to: 6 });
  assert.equal(s.verdict, 'unsound');
  assert.equal(s.k, first);
  assert.equal(s.witness.k, first);
});

test('S7: a glue that depends on a free instance atom is unsupported', async () => {
  const p = loadTarget('clique-colouring');
  const g = p.fragments.find((f) => f.name === 'glue');
  // red(1) always; red(V) only for the neighbours of node 1: equal at k = 1, not from k = 2
  g.text = 'glue(red(1)).\nglue(red(V)) :- edge(1,V).';
  const r = await spaceAudit(p, { space: 'graphs', to: 3 });
  assert.equal(r.verdict, 'unsupported');
  assert.equal(r.k, 2);
  assert.equal(r.reason, 'the interface depends on the instance');
});

test('S7: tools/audit.mjs --space', () => {
  const tool = path('tools/audit.mjs').pathname;
  const run = (args) => spawnSync('node', [tool, ...args]);
  assert.equal(run(['tutorial-first-run', '--space', 'n', '--bound', '4']).status, 0);
  const weak = run(['tutorial-weak-relevant', '--space', 'n', '--bound', '4', '--json']);
  assert.equal(weak.status, 1);
  const out = JSON.parse(weak.stdout.toString());
  assert.equal(out.verdict, 'unsound');
  assert.equal(out.k, 2);
  assert.equal(run(['tutorial-first-run', '--space', 'nope', '--bound', '4']).status, 2);
  const sp = run(['af-preferred', '--space', 'frameworks', '--bound', '2', '--from', '2']).stdout.toString();
  assert.match(sp, /^k = 2: sound/m);
});

// Mutation test: one relevant/1 (or clause/3) rule deleted at a time. A mutation that the
// enumerative audit finds unsound on some instance is found unsound by the space at a k no larger
// than that instance's size, and the audit is unsound on the instance the space returns.
const MUTANTS = {
  'af-preferred': { space: 'frameworks', fragment: 'check', rule: /^clause\(.*$/gm, size: ['arg/1'] },
  'clique-colouring': { space: 'graphs', fragment: 'check', rule: /^relevant\(.*$/gm, size: ['node/1'] },
  'qbf': { space: 'formulas', fragment: 'check', rule: /^relevant\(.*$/gm, size: ['xvar/1', 'yvar/1', 'term/1'] },
};
// The size of an instance: the largest number of atoms of the given predicates (grounded with its
// constants and the shared fragment, so that node(0..n-1) and term(T) :- xlit(T,_,_) count).
async function sizeOf(p0, x0, preds) {
  // a recipe instance gets its facts from its generator first
  const p = await resolveProject(p0, x0.id, engineRun, GEN_LUA);
  const x = p.instances.find((i) => i.id === x0.id);
  const shared = (p.fragments.find((f) => f.name === 'shared') || { text: '' }).text;
  const consts = Object.entries({ ...p.settings.constants, ...(x.constants || {}) }).flatMap(([k, v]) => ['-c', `${k}=${v}`]).join(' ');
  const shows = preds.map((q) => `#show ${q}.`).join(' ');
  const r = await engineRun(`${x.facts || ''}\n${shared}\n#show.\n${shows}\n`, `--outf=2 ${consts}`.trim());
  const json = JSON.parse(r.out.join('\n'));
  const atoms = json.Call[0].Witnesses[0].Value;
  return Math.max(...preds.map((q) => atoms.filter((a) => a.startsWith(q.split('/')[0] + '(')).length));
}
function mutants(p, spec) {
  const f = p.fragments.find((x) => x.name === spec.fragment);
  const rules = f.text.match(spec.rule) || [];
  return rules.map((rule) => {
    const q = structuredClone(p);
    const g = q.fragments.find((x) => x.name === spec.fragment);
    g.text = g.text.replace(rule, '% (deleted)');
    return { rule, q };
  });
}

for (const [id, spec] of Object.entries(MUTANTS)) {
  test(`S7: mutation test, ${id}`, async () => {
    const p = loadTarget(id);
    const ms = mutants(p, spec);
    assert.ok(ms.length >= 1);
    for (const { rule, q } of ms) {
      // the smallest library instance on which the audit finds the mutant unsound
      let smallest = null;
      for (const x of P.auditable(q)) {
        const v = (await auditProject(q, { instance: x.id, limit: 50000, seconds: 30 })).verdict;
        if (v && v.verdict === 'unsound') {
          const s = await sizeOf(q, x, spec.size);
          if (smallest === null || s < smallest) smallest = s;
        }
      }
      const r = await spaceAudit(q, { space: spec.space, to: Math.min(smallest ?? 4, 4), seconds: 60 });
      if (smallest !== null) {
        assert.equal(r.verdict, 'unsound', `${rule}: the space finds no loss up to ${smallest}`);
        assert.ok(r.k <= smallest, `${rule}: k = ${r.k} > ${smallest}`);
      }
      if (r.verdict === 'unsound') {
        // the audit agrees on the witness instance
        const sp = q.spaces.find((x) => x.name === spec.space);
        const inst = { id: 'witness', facts: r.witness.instance, constants: { ...(sp.defaults || {}), [P.spaceBound(sp)]: String(r.k) } };
        const w = { ...q, instances: [inst] };
        const v = (await auditProject(w, { instance: 'witness' })).verdict;
        assert.equal(v.verdict, 'unsound', `${rule}: the audit on the witness instance`);
      }
    }
  });
}

test('S7: at least 25 library examples have spaces, each with an expected verdict', () => {
  assert.ok(Object.keys(SPACES).length >= 25);
  for (const [id, spaces] of Object.entries(SPACES)) {
    assert.deepEqual(loadTarget(id).spaces, spaces, `${id}: run node tools/make-examples.mjs`);
    for (const sp of spaces) assert.ok(sp.expected && sp.expected.verdict && Number.isInteger(sp.expected.k), `${id}/${sp.name}`);
  }
});
