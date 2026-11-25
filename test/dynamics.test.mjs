// Phase L3: growing programs, externals, guarded clauses.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from './helpers.mjs';
import { load } from '../js/project.js';

const ex = (id) => load(H.read(`examples/${id}.json`));
const all = (p, extra = {}) => ({ ...p, settings: { ...p.settings, solutions: 0, seconds: 0, trace: 0, ...extra } });
const plans = (r) => H.ofKind(r, 'M').map((m) => m.atoms.split(' ').sort().join(' ')).sort();

test('G6: conformant planning grows its horizon to the shortest plans, the same as the constant set to that length', async () => {
  const g = await H.runProject(all(ex('conformant-growing')));
  assert.equal(H.done(g).outcome, 'finished', JSON.stringify(H.ofKind(g, 'E')));
  assert.deepEqual(H.ofKind(g, 'L').map((l) => l.text), ['shortest horizon: 8']);
  assert.ok(!Object.keys(ex('conformant-growing').settings.constants).length, 'no bound constant');
  const c = ex('conformant-planning');
  const at = async (t) => H.runProject(all({ ...c, settings: { ...c.settings, constants: { ...c.settings.constants, t: String(t) } } }));
  assert.equal(H.finalStats(await at(7)).solutions, 0);
  const eight = await at(8);
  assert.deepEqual(plans(g), plans(eight));
  assert.equal(plans(g).length, 3);
});

test('G6: a guarded clause holds only while its atom is true; set and release of externals', async () => {
  const p = H.projectOf({ shared: '', abstraction: '{ p(1..2) }.\n#external g.\n#show p/1.', glue: 'glue(p(1..2)).', check: ':- p(1).' });
  p.loop = { language: 'loop', text: `solver A = shared + abstraction
solver C = shared + check
link G = A -> C via shared + glue
A.set(A.atom("g"), true)
n = 0
loop:
    M = A.solve()
    if not M: break
    n = n + 1
    A.add(G.block(M), while A.atom("g"))
log "with g", n
A.set(A.atom("g"), false)
M = A.solve()
if M: log "without g: a model"
A.release(A.atom("g"))
` };
  const r = await H.runProject(p);
  assert.equal(H.done(r).outcome, 'finished', JSON.stringify(H.ofKind(r, 'E')));
  assert.deepEqual(H.ofKind(r, 'L').map((l) => l.text), ['with g 4', 'without g: a model']);
  const bad = H.projectOf({ shared: '', abstraction: '{ p(1..2) }.', glue: 'glue(p(1..2)).', check: ':- p(1).' });
  bad.loop = { language: 'loop', text: 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue\nA.set(A.atom("p", 1), true)\n' };
  const rb = await H.runProject(bad);
  assert.match(H.last(rb, 'E').message, /A.set: the atom is not an #external atom of A/);
});

test('G6: certificates are refused for programs with #external atoms', async () => {
  const r = await H.runProject(all(ex('conformant-growing'), { certify: 'report' }));
  const K = H.ofKind(r, 'K');
  assert.ok(K.length > 0);
  assert.ok(K.every((k) => k.level !== 2 && k.level !== 3), JSON.stringify(K.find((k) => k.level === 2 || k.level === 3)));
});

test('final review: G.extend sends a new I event; a guarded clause is recorded without q', async () => {
  const p = all(ex('conformant-growing'), { record: { steps: 'all', n: 0, calls: false } });
  const r = await H.runProject(p);
  const I = H.ofKind(r, 'I').at(-1);
  assert.ok(I.links[0].atoms.length >= 32, `${I.links[0].atoms.length} atoms`);
  const q = H.projectOf({ shared: '', abstraction: '{ p(1..2) }.\n#external g.\n#show p/1.', glue: 'glue(p(1..2)).', check: ':- p(1).' }, { record: { steps: 'all', n: 0, calls: false } });
  q.loop = { language: 'loop', text: 'solver A = shared + abstraction\nsolver C = shared + check\nlink G = A -> C via shared + glue\nA.set(A.atom("g"), true)\nM = A.solve()\nA.add(G.block(M), while A.atom("g"))\n' };
  const rq = await H.runProject(q);
  const a = H.ofKind(rq, 'R').filter((x) => x.k === 'a');
  assert.equal(a.length, 1);
  assert.equal(a[0].q, undefined);
});
