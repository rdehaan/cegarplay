// Phase V3: domain views (docs/spec-views.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load, derive } from '../js/project.js';
import { compile } from '../js/compiler.js';
import { auditPlan } from '../js/driver.js';
import { parseTerm, termText, frameFacts, viewProgram, sceneProgram, viewAtoms, parseMarks, layoutScene, suggestView, FrameSource, VIEW_OPTIONS, Palette } from '../js/views.js';

const lib = JSON.parse(H.read('examples/library.json'));
const ex = (id) => load(H.read(`examples/${id}.json`));
const consts = (d) => Object.entries(d.settings.constants || {}).map(([k, v]) => `-c ${k}=${v}`).join(' ');
const runView = async (d, prog) => viewAtoms(await H.run(prog, `${VIEW_OPTIONS} ${consts(d)}`.trim()));
async function traced(id, extra = {}) {
  const p = ex(id);
  p.settings = { ...p.settings, solutions: 0, trace: 20, ...extra };
  const r = await H.runProject(p);
  return { p, d: derive(p, {}), T: H.ofKind(r, 'T'), I: H.ofKind(r, 'I')[0], R: H.ofKind(r, 'R') };
}

test('terms: parse and print', () => {
  for (const s of ['draw(node(1))', 'attr(edge(1,2),stroke,clique)', 'note("a, b (c)")', '(1,2)', '-p(3)', 'f((1,),x)', 'p(-2)']) assert.equal(termText(parseTerm(s)), s);
});

test('the view fixture: 38 marks for step 3 of guide-03-hit-clique, emph on nodes 4, 5 and 6', async () => {
  const { d, T } = await traced('guide-03-hit-clique');
  const st = T.find((t) => t.i === 3);
  assert.equal(st.candidate, 'del(1) del(2)');
  const facts = frameFacts(st);
  assert.deepEqual(facts.slice(0, 4), ['step(3).', 'kind(reject).', 'cand(del(1)).', 'cand(del(2)).']);
  const v = d.views[0];
  const a = await runView(d, viewProgram(d, v, facts));
  assert.equal(a.error, null);
  assert.equal(a.atoms.length, 38);
  const m = parseMarks(a.atoms, v.name);
  assert.deepEqual(m.problems, []);
  assert.deepEqual([...m.emph].sort(), ['node(4)', 'node(5)', 'node(6)']);
  assert.equal(a.atoms.filter((x) => x.includes('fill,deleted')).length, 2);
  assert.equal(m.notes.length, 1);
});

test('frames of R events: candidate and clause from the interface atoms', async () => {
  const { d, I, R } = await traced('guide-03-hit-clique', { record: { steps: 'all', n: 0, calls: false } });
  const r3 = R.find((x) => x.i === 3);
  const f = frameFacts(r3, I.links[r3.l - 1].atoms);
  assert.ok(f.includes('cand(del(1)).') && f.includes('cand(del(2)).') && f.includes('lit(del(4),true).'), f.join(' '));
  const a = await runView(d, viewProgram(d, d.views[0], f));
  assert.deepEqual([...parseMarks(a.atoms).emph].sort(), ['node(4)', 'node(5)', 'node(6)']);
});

test('one scene, two frames: every scene element keeps its position; the layout is fixed by its seed', async () => {
  const { d } = await traced('guide-03-hit-clique');
  const scene = parseMarks((await runView(d, sceneProgram(d, d.views[0]))).atoms);
  assert.equal(scene.elements.size, 25);
  const a = layoutScene(scene, 'graph'), b = layoutScene(parseMarks((await runView(d, sceneProgram(d, d.views[0]))).atoms), 'graph');
  for (const [k, p] of a) assert.deepEqual(b.get(k), p, k);
  for (const l of ['grid', 'list', 'circle', 'layers']) assert.equal(layoutScene(scene, l).size >= 10, true, l);
  const fixed = layoutScene(scene, 'graph', new Map([['node(1)', [10, 20]]]));
  assert.deepEqual(fixed.get('node(1)'), [10, 20]);
});

test('a request for a cached step makes no engine call; a request the cursor has left is dropped', async () => {
  const { d, T } = await traced('guide-03-hit-clique');
  let calls = 0;
  const src = new FrameSource(async (p, o) => { calls++; await new Promise((r) => setTimeout(r, 5)); return H.run(p, o); });
  const prog = (i) => viewProgram(d, d.views[0], frameFacts(T[i]));
  assert.equal((await src.frame(prog(2))).atoms.length, 38);
  assert.equal(calls, 1);
  await src.frame(prog(2));
  assert.equal(calls, 1);
  const [x, y, z] = await Promise.all([src.frame(prog(0)), src.frame(prog(1)), src.frame(prog(3))]);
  assert.equal(x, null);              // computed (it was running) but left by the cursor
  assert.equal(y, null);              // left before it started: never computed
  assert.ok(z && z.atoms.length > 0);
  assert.equal(calls, 3);
  assert.ok(await src.frame(prog(0)));  // x was cached when it finished
  assert.equal(calls, 3);
});

test('marks: unknown marks and attributes are named; palette slots in order of first use', () => {
  const m = parseMarks(['draw(blob(1))', 'draw(attr(node(1),colour,red))', 'draw(layout(spiral))', 'draw(node(1))'], 'v');
  assert.equal(m.problems.length, 3);
  assert.match(m.problems[0], /view v: unknown mark blob\/1/);
  const pal = new Palette();
  assert.deepEqual(['a', 'b', 'a', 'c'].map((x) => pal.slot(x)), [1, 2, 1, 3]);
});

test('ten library examples ship a view; step 1 of each renders without an unknown mark', async () => {
  const withView = lib.examples.filter((e) => (ex(e.id).views || []).length);
  assert.ok(withView.length >= 10, `${withView.length} examples with a view`);
  for (const e of withView) {
    const { d, T } = await traced(e.id);
    const v = d.views[0];
    const scene = await runView(d, sceneProgram(d, v));
    assert.equal(scene.error, null, e.id);
    assert.ok(scene.atoms.length > 0, `${e.id}: an empty scene`);
    const a = await runView(d, viewProgram(d, v, T[0] ? frameFacts(T[0]) : []));
    assert.equal(a.error, null, e.id);
    assert.deepEqual(parseMarks(a.atoms, v.name).problems, [], e.id);
  }
});

test('suggestView output parses for every clause-based fast example', async () => {
  let n = 0;
  for (const e of lib.examples) {
    if (!(e.tags || []).includes('fast')) continue;
    const p = ex(e.id);
    if (p.loop.language !== 'loop') continue;
    const c = compile(p.loop.text, { fragments: p.fragments.map((f) => f.name) });
    const plan = auditPlan(c);
    if (plan.error || !plan.clause) continue;
    const { d, T, I } = await traced(e.id, { trace: 2, record: { steps: 'first', n: 1, calls: false } });
    if (!I) continue;
    const L = I.links.find((x) => x.link === plan.link) || I.links[0];
    const shared = ['instance', 'shared'].map((x) => d.fragments.find((f) => f.name === x)).filter(Boolean).map((f) => f.text).join('\n');
    const all = await H.run(shared + '\n', `${VIEW_OPTIONS} ${consts(d)}`.trim());
    let facts = [];
    try { facts = JSON.parse(all.out.join('\n')).Call[0].Witnesses[0].Value; } catch { facts = []; }
    const text = suggestView(L.atoms, facts);
    const q = { ...d, fragments: [...d.fragments.filter((f) => f.name !== 'suggested'), { name: 'suggested', text }] };
    const v = { name: 'suggested', fragments: d.fragments.some((f) => f.name === 'shared') ? ['shared', 'suggested'] : ['suggested'] };
    const a = await runView(q, viewProgram(q, v, T[0] ? frameFacts(T[0]) : []));
    assert.equal(a.error, null, `${e.id}: ${a.error}\n${text}`);
    assert.deepEqual(parseMarks(a.atoms, 'suggested').problems, [], e.id);
    assert.ok(a.atoms.length > 0, e.id);
    n++;
  }
  console.log(`# suggestView parses for ${n} clause-based fast examples`);
  assert.ok(n >= 40, `${n}`);
});

test('review of wave 3: frameFacts on expansion steps and deeply nested atoms', () => {
  const f = frameFacts({ i: 3, kind: 'expand', solver: 'A', candidate: 'p(f(g(1))) q((1,(2,3))) s("a b")', counterexample: 'c(1)', facts: ['cex(1,color(1,2))'] });
  assert.deepEqual(f, ['step(3).', 'kind(expand).', 'cand(p(f(g(1)))).', 'cand(q((1,(2,3)))).', 'cand(s("a b")).', 'cex(c(1)).', 'fact(cex(1,color(1,2))).']);
});
