// The Refinement lab's own Web Worker (docs/lab-design.md): its own clingo-wasm instance and its
// own space cache, so the lab never blocks, pauses or resets the main engine. The page side
// (js/lab/tab.js) terminates this worker for Cancel; the main engine's worker is untouched.
//
// Messages in:  { id, type: 'space' | 'inspect' | 'detail' | 'bounds' | 'simulate' | 'run' | 'export', ... }
// Messages out: { id, type: 'progress', data } (at least every 0.25 s while computing),
//               { id, type: 'result', data } or { id, type: 'error', message, code }
import * as Lab from './core.js';
import { Recording } from '../recording.js';
import { mapRun } from './runs.js';
import { runReport, ladder, decomposition } from './report.js';

let module = null, out = [], err = [], onLine = null;
let lastProgress = 0, current = null;

async function load() {
  const { default: factory } = await import('../../vendor/clingo-wasm/clingo.js');
  return factory({ print: (l) => { out.push(l); if (onLine) onLine(l); }, printErr: (l) => err.push(l) });
}
let ready = load().then((m) => { module = m; return m; });

// One clingo run on this worker's instance; a trap loads a fresh instance (an error inside Lua
// can kill it, CLAUDE.md rule 1).
async function exec(program, options = '--outf=3', lineHook = null) {
  if (!module) await ready;
  out = []; err = []; onLine = lineHook;
  let status;
  try { status = module.ccall('run', 'number', ['string', 'string'], [program, options]); }
  catch (e) { status = 'trap'; err.push(String(e && e.message || e)); module = null; ready = load().then((m) => { module = m; return m; }); }
  onLine = null;
  return { status, out, err };
}

const fetchText = (p) => fetch(new URL(p, import.meta.url)).then((r) => { if (!r.ok) throw new Error(`cannot load ${p}`); return r.text(); });
const luaReady = Promise.all(['runtime', 'lab', 'ground', 'draw', 'generate'].map((n) => fetchText(`../../lua/${n}.lua`)))
  .then(([runtime, lab, ground, draw, generate]) => ({ runtime, lab, ground, draw, generate }));

const contexts = new Map();   // key -> { ctx, sp }
function progress(data) {
  const now = Date.now();
  if (now - lastProgress < 100 && !data.force) return;
  lastProgress = now;
  postMessage({ id: current, type: 'progress', data });
}
function entry(key) {
  const e = contexts.get(key);
  if (!e) throw new Lab.LabError('compute the space first', 2);
  return e;
}

const handlers = {
  async space(m) {
    const lua = await luaReady;
    progress({ phase: 'validating the project', force: true });
    const ctx = await Lab.prepare(m.project, { instance: m.instance, variant: m.variant, link: m.link }, exec, lua);
    if (contexts.has(ctx.key) && contexts.get(ctx.key).limit === m.limit) {
      const e = contexts.get(ctx.key);
      return { key: ctx.key, summary: Lab.spaceSummary(e.sp), cached: true, ...view(e.sp) };
    }
    if (ctx.plan.unsupported) throw new Lab.LabError(`unsupported: ${ctx.plan.unsupported}`, 4);
    const sp = await Lab.computeSpace(ctx, { limit: m.limit, onProgress: (p) => progress({ phase: p.phase, done: p.done, of: p.candidates }) });
    contexts.clear();                       // one space at a time in memory
    contexts.set(ctx.key, { ctx, sp, limit: m.limit });
    const sound = Lab.loopSoundness(sp, { onProgress: progress });
    return { key: ctx.key, summary: Lab.spaceSummary(sp, sound), ...view(sp) };
  },
  async inspect(m) {
    const { sp } = entry(m.key);
    let alive = null, chosen = null, step = null;
    if (m.step != null) {
      const rec = Recording.fromText(m.recording);
      const at = Lab.stepAt(sp, rec, m.step);
      alive = at.alive; chosen = at.step.set; step = m.step;
      m.candidate = at.step.cand;
    }
    const M = m.candidate;
    if (sp.sol[M]) return { candidate: M, hex: sp.hex[M], solution: true, atomsTrue: sp.atomsOf(sp.candWords(M)) };
    progress({ phase: 'minimal sound sets', force: true });
    const mins = (await Lab.minimalFor(exec, sp, [M], { cap: m.minimalCap, seconds: m.seconds })).get(M);
    let selected = null;
    if (m.selected) selected = Lab.setOf(sp, Uint32Array.from(m.selected.r), Uint32Array.from(m.selected.v), { kind: m.selected.kind || 'selected' });
    const I = Lab.inspect(sp, M, { alive, minimal: mins, chosen, selected, minimalCap: m.minimalCap });
    return { ...I, step, atomNames: sp.atoms };
  },
  async detail(m) {
    const { ctx, sp } = entry(m.key);
    progress({ phase: 'counterexamples and justification', force: true });
    const sets = m.sets.map((s) => Lab.setOf(sp, Uint32Array.from(s.r), Uint32Array.from(s.v), { kind: s.kind }));
    return Lab.detail(ctx, sp, m.candidate, sets, { limit: m.limit, cap: m.cap, lift: m.lift });
  },
  async bounds(m) {
    const { sp } = entry(m.key);
    return Lab.bounds(exec, sp, m.scheme, { seconds: m.seconds, exact: m.exact, minimalCap: m.minimalCap, onProgress: progress });
  },
  async simulate(m) {
    const { sp } = entry(m.key);
    return Lab.simulation(exec, sp, m.scheme, { runs: m.runs, seed: m.seed, seconds: m.seconds, minimalCap: m.minimalCap, onProgress: progress });
  },
  async run(m) {
    const { sp } = entry(m.key);
    const rec = Recording.fromText(m.recording);
    return runReport(exec, sp, rec, { minimalCap: m.minimalCap, seconds: m.seconds, onProgress: progress });
  },
  async steps(m) {
    const { sp } = entry(m.key);
    const run = mapRun(sp, Recording.fromText(m.recording), { clauseSet: Lab.clauseSet });
    return { steps: run.steps.map((x) => ({ i: x.i, kind: x.kind, cand: x.cand })), problems: run.problems };
  },
  async ladder(m) {
    const { sp } = entry(m.key);
    const L = ladder({ sp, run: m.run, compare: m.compare, loop: m.loop, omni: m.omni, sim: m.sim });
    return { ...L, decomposition: decomposition({ sp, run: m.run, loop: m.loop, omni: m.omni, sim: m.sim }) };
  },
  async export(m) {
    const { sp } = entry(m.key);
    return { space: sp.toJSON(), summary: Lab.spaceSummary(sp) };
  },
};

// What the page needs to list and draw candidates without the whole space.
function view(sp) {
  return {
    atoms: sp.atoms, count: sp.count, hex: sp.hex, sol: Array.from(sp.sol), ncex: Array.from(sp.ncex),
    pop: Array.from({ length: sp.count }, (_, i) => sp.space.popcount(i)),
  };
}

onmessage = async (ev) => {
  const m = ev.data;
  const h = handlers[m.type];
  current = m.id;
  lastProgress = 0;
  if (!h) { postMessage({ id: m.id, type: 'error', message: `unknown request ${m.type}`, code: 2 }); return; }
  try {
    const data = await h(m);
    postMessage({ id: m.id, type: 'result', data: JSON.parse(JSON.stringify(data, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v))) });
  } catch (e) {
    postMessage({ id: m.id, type: 'error', message: e && e.message ? e.message : String(e), code: (e && e.code) || 1 });
  }
};
