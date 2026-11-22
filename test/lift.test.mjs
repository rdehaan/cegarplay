// Phase S3: lift links (docs/spec-soundness.md section 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';
import { compile } from '../js/compiler.js';
import { auditPlan, stripAspComments, modulesFor } from '../js/driver.js';
import { auditProject } from '../tools/audit.mjs';

// statements of an ASP text (comments blanked), split at a full stop that is not part of '..'
function dropRelevant(text) {
  const t = stripAspComments(text);
  let out = '', start = 0, depth = 0, inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === '.' && depth === 0 && t[i + 1] !== '.' && t[i - 1] !== '.') {
      const st = text.slice(start, i + 1);
      out += /^\s*relevant\s*\(/.test(t.slice(start, i + 1)) ? st.replace(/[^\n]/g, ' ') : st;
      start = i + 1;
    }
  }
  return out + text.slice(start);
}

const lib = JSON.parse(H.read('examples/library.json'));
const ex = (id) => load(H.read(`examples/${id}.json`));
// lift on link G (default: the first link line), relevant/1 rules deleted from the check
function lifted(p, { link, drop = true } = {}) {
  const q = structuredClone(p);
  const re = link ? new RegExp(`^(\\s*link\\s+${link}\\b.*)$`, 'm') : /^(\s*link\s.*)$/m;
  q.loop.text = q.loop.text.replace(re, '$1 lift');
  if (drop) {
    const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
    const L = link ? c.links.find((x) => x.name === link) : c.links[0];
    const C = c.solvers.find((s) => s.name === L.to);
    for (const f of q.fragments) if (C.fragments.includes(f.name)) f.text = dropRelevant(f.text);
  }
  q.settings = { ...q.settings, solutions: 0, seconds: 0, trace: 0 };
  return q;
}

test('compiler: the lift keyword, G.lift, and lift with compat refused', () => {
  const frag = { fragments: ['shared', 'abstraction', 'glue', 'check'] };
  const c = compile('solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue lift\n' +
    'search A:\n    on candidate M:\n        X = C.solve(assume G(M))\n        if X:\n            reject M with G.lift(M, X)\n', frag);
  assert.ok(c.ok, JSON.stringify(c.errors));
  assert.equal(c.links[0].lift, true);
  assert.match(c.lua, /rt\.link\("G", A, C, \{"shared", "glue"\}, \{lift = true\}\)/);
  assert.match(c.lua, /G:lift\(M, X\)/);
  assert.deepEqual(modulesFor({}, { compiled: c }), ['ground']);
  const bad = compile('solver A = shared\nsolver C = check\nlink G = A -> C via glue compat lift\n', frag);
  assert.match(bad.errors[0].message, /'lift' and 'compat' cannot be combined/);
  const plain = compile('solver A = shared\nsolver C = check\nlink G = A -> C via glue\n', frag);
  assert.deepEqual(modulesFor({}, { compiled: plain }), []);
});

test('row 23: tutorial-weak-relevant with lift gives 61 solutions; guide-04-one-node 3', async () => {
  for (const [id, want] of [['tutorial-weak-relevant', 61], ['guide-04-one-node', 3]]) {
    for (const drop of [false, true]) {
      const r = await H.runProject(lifted(ex(id), { drop }));
      assert.equal(H.done(r).outcome, 'finished', id);
      assert.equal(H.finalStats(r).solutions, want, `${id}${drop ? ' without relevant/1' : ''}`);
      assert.equal(H.finalStats(r).counters['lift fallbacks'], undefined, id);
    }
  }
});

test('row 25: graph-coloring at n = 5 with lift: 101 solutions, fewer refinements than the hand-written rules', async () => {
  const p = ex('graph-coloring');
  const hand = await H.runProject({ ...p, settings: { ...p.settings, solutions: 0, seconds: 0 } }, { instance: 'n5' });
  const r = await H.runProject(lifted(p, { drop: false }), { instance: 'n5' });
  const S = H.finalStats(r), S0 = H.finalStats(hand);
  assert.equal(S.solutions, 101);
  assert.equal(S0.solutions, 101);
  const ref = (s) => s.clauses + s.expansions;
  console.log(`# graph-coloring n = 5: ${ref(S)} lifted refinements (${(S.literals / S.clauses).toFixed(2)} literals), ${ref(S0)} hand-written (${(S0.literals / S0.clauses).toFixed(2)})`);
  assert.ok(ref(S) < ref(S0), `${ref(S)} >= ${ref(S0)}`);
  assert.ok(S.lift && S.lift.clauses === S.clauses && S.lift.preds['leaf_color/2'], JSON.stringify(S.lift));
});

// examples whose lifted run takes more than a few seconds (level 3 per dropped group)
const SLOW_LIFT = new Set(['gc-shape1', 'gc-shape2', 'fewest-clues', 'guide-12-step3-clause', 'integer-expressions', 'subset-sum-game', 'strong-nash', 'choosability']);

test('every fast clause example: relevant/1 deleted and lift on reaches the count of the loop (the audited count when unsound), without fallbacks', { timeout: 600000 }, async () => {
  let n = 0;
  for (const e of lib.examples) {
    if (!(e.tags || []).includes('fast') || (!H.SLOW && SLOW_LIFT.has(e.id))) continue;
    if (e.outcome === 'error') continue;                          // a loop that fails by design
    const p = ex(e.id);
    if (p.loop.language !== 'loop') continue;
    const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
    const plan = auditPlan(c);
    if (plan.error || !plan.clause) continue;
    // G.clause(X) (phase L1) has no candidate to lift from: lift applies to G.clause(M, X)
    if (new RegExp(`\\b${plan.link}\\.clause\\(\\s*\\w+\\s*\\)`).test(p.loop.text)) continue;
    const a = await auditProject(p, { limit: 20000, seconds: 10 });
    if (!a.verdict || a.verdict.verdict === 'limit') continue;
    const want = a.verdict.verdict === 'unsound' ? a.verdict.solutions : e.expected && e.expected.solutions;
    if (!Number.isInteger(want)) continue;
    const r = await H.runProject(lifted(p, { link: plan.link }));
    const D = H.done(r), S = H.finalStats(r);
    assert.equal(D.outcome, 'finished', `${e.id}: ${D.detail}`);
    assert.equal(S.solutions, want, e.id);
    assert.equal(S.counters['lift fallbacks'], undefined, `${e.id}: a lift fallback`);
    n++;
  }
  console.log(`# ${n} examples reach their count with lift`);
  assert.ok(n >= (H.SLOW ? 45 : 37), `${n} examples`);
});

test('a counterexample that cannot be certified falls back to a block, with a K event at level 0', async () => {
  // a check with a negative cycle through its guess: level 2 refuses, level 3 needs a stratified check
  const p = {
    fragments: [
      { name: 'shared', text: 'item(1..3).\n' },
      { name: 'abstraction', text: '{ pick(I) : item(I) }.\n#show pick/1.\n' },
      { name: 'glue', text: 'glue(pick(I)) :- item(I).\n' },
      { name: 'check', text: 'a :- not b, pick(1).\nb :- not a.\n:- not a.\n' },
    ],
    loop: { language: 'loop', text: 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue lift\n' +
      'search A:\n    on candidate M:\n        X = C.solve(assume G(M))\n        if X:\n            reject M with G.clause(M, X)\n' },
    settings: { constants: {}, solutions: 0, seconds: 0, candidates: 0, trace: 0, seed: 0 },
  };
  const r = await H.runProject(p);
  const S = H.finalStats(r);
  assert.equal(H.done(r).outcome, 'finished');
  assert.equal(S.solutions, 4);
  assert.ok(S.counters['lift fallbacks'] > 0);
  const k = H.ofKind(r, 'K');
  assert.ok(k.length > 0 && k.every((x) => x.level === 0 && /lift fallback/.test(x.reason)), JSON.stringify(k[0]));
});

test('review of wave 3: a lift clause that would be empty keeps one atom; the standalone export of a lift project runs', async () => {
  const p = {
    fragments: [
      { name: 'shared', text: 'item(1..3).\n' },
      { name: 'abstraction', text: '{ pick(I) : item(I) }.\n#show pick/1.\n' },
      { name: 'glue', text: 'glue(pick(I)) :- item(I).\n' },
      { name: 'check', text: 'cx.\n' },
    ],
    loop: { language: 'loop', text: 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue lift\n' +
      'search A:\n    on candidate M:\n        X = C.solve(assume G(M))\n        if X:\n            reject M with G.clause(M, X)\n' },
    settings: { constants: {}, solutions: 0, seconds: 0, candidates: 0, trace: 0, seed: 0 },
  };
  const r = await H.runProject(p);
  assert.equal(H.done(r).outcome, 'finished', JSON.stringify(H.ofKind(r, 'E')));
  assert.equal(H.finalStats(r).solutions, 0);
  const { exportStandalone } = await import('../js/project.js');
  const q = lifted(ex('tutorial-weak-relevant'));
  const text = exportStandalone(load(JSON.stringify({ format: 'cegarplay', ...q })), H.RUNTIME, { ground: H.read('lua/ground.lua') });
  const out = await H.run(text, '--outf=3');
  assert.ok(out.out.some((l) => /^Solutions\s*:\s*61\b/.test(l) || /"solutions":61/.test(l)) || out.out.join('\n').includes('61'), out.out.slice(-5).join('\n'));
  assert.ok(!out.out.join('\n').includes('lift needs lua/ground.lua'));
});
