// Shared test helpers: run a program on a fresh engine instance, load example files.
import fs from 'node:fs';
import factory from '../vendor/clingo-wasm/clingo.js';
import { assemble, parseEvent } from '../js/driver.js';

export const ROOT = new URL('..', import.meta.url);
export const path = (p) => new URL(p, ROOT);
export const read = (p) => fs.readFileSync(path(p), 'utf8');
export const RUNTIME = read('lua/runtime.lua');
export const SLOW = !!process.env.SLOW;

// One run on a fresh module instance. Returns { status, out, err, events }.
export async function run(program, options = '--outf=3', { stdin } = {}) {
  const out = [], err = [];
  let pending = '';
  const m = await factory({
    print: (l) => out.push(l),
    printErr: (l) => err.push(l),
    ...(stdin ? {
      stdin: () => {
        if (!pending) { const s = stdin(); if (s == null) return null; pending = s + '\n'; }
        const c = pending.charCodeAt(0); pending = pending.slice(1);
        return c;
      },
    } : {}),
  });
  let status;
  try { status = m.ccall('run', 'number', ['string', 'string'], [program, options]); } catch (e) { status = 'trap'; err.push(String(e)); }
  const events = out.map(parseEvent).filter(Boolean);
  return { status, out, err, events };
}
export const engineRun = (program, options) => run(program, options);

// Event accessors
export const ofKind = (r, k) => r.events.filter((e) => e.kind === k).map((e) => e.data);
export const last = (r, k) => ofKind(r, k).at(-1);
export const done = (r) => last(r, 'D');
export const finalStats = (r) => last(r, 'S');

// Split a file written for cegar.py into the four default fragments (textual, as in the spike).
export function splitLp(text) {
  const parts = { shared: '', guess: '', glue: '', check: '' };
  const re = /#program\s+([a-z_]+)\s*\.\s*/g;
  let cur = 'guess', lastI = 0, m;
  while ((m = re.exec(text))) {
    if (!(m[1] in parts) && m[1] !== 'base') continue;
    parts[cur] += text.slice(lastI, m.index);
    cur = m[1] === 'base' ? 'guess' : m[1];
    lastI = re.lastIndex;
  }
  parts[cur] += text.slice(lastI);
  return { shared: parts.shared, abstraction: parts.guess, glue: parts.glue, check: parts.check };
}

export function projectOf(fragments, settings = {}) {
  return {
    fragments: Object.entries(fragments).map(([name, text]) => ({ name, text })),
    settings: { constants: {}, solutions: 1, seconds: 0, candidates: 0, trace: 0, seed: 0, ...settings },
  };
}

// Run a project with hand-written Lua.
export async function runLua(project, lua, opts = {}) {
  const a = assemble(project, lua, RUNTIME, opts);
  const r = await run(a.program);
  r.assembled = a;
  return r;
}

export const GC6 = () => splitLp(read('spike/examples/graph-coloring-n6.lp'));
export const GC = () => splitLp(read('reference/declarative-cegar/graph-coloring.lp'));
export const FIX = '\n% A node that is not a leaf now may become one. Giving it a leaf colour other\n% than its colour in the counterexample also breaks the counterexample.\nrelevant(leaf_color(N,C)) :- node(N), not leaf(N), color(C), not color(N,C).\n';
export const REFINE_PART = `
#program refine(k).
% cex(k,color(N,C)): the k-th counterexample colours node N with C. It stops
% being a counterexample once an edge joins two nodes it colours alike, or a
% leaf gets a different colour.
broken(k) :- edge(N,M), N < M, cex(k,color(N,C)), cex(k,color(M,C)).
broken(k) :- leaf(N), leaf_color(N,C), not cex(k,color(N,C)).
broken(k) :- leaf(N), cex(k,color(N,C)), not leaf_color(N,C).
:- not broken(k).
`;
// Wrap every rule head of a glue fragment in glue(...).
export function wrapGlue(text) {
  return text.replace(/^([a-z_][A-Za-z0-9_]*(?:\([^:]*?\))?)(\s*(?::-|\.))/gm, 'glue($1)$2');
}

// Hand-written loops (as in spike/js/shapes.mjs), using the runtime API.
const decl = (link = '') => `
    local A = rt.solver("A", {"shared", "abstraction"}, {})
    local C = rt.solver("C", {"shared", "check"}, {"--heuristic=Domain"})
    local G = rt.link("G", A, C, {"shared", "glue"}, {${link}})
`;
export const LUA = {
  shape1: (link = '') => decl(link) + `
    rt.prepare()
    A:search{ on_candidate = function(M)
      local X = C:solve{ assume = G:of(M) }
      if X then M:reject(G:clause(M, X)) end
    end }
`,
  reference: (link = '') => decl(link) + `
    rt.prepare()
    A:search{ on_candidate = function(M)
      local X = C:solve{ assume = G:of(M) }
      if X then M:reject(G:block(M)) end
    end }
`,
  shape2: (link = '') => decl(link) + `
    rt.prepare()
    while true do
      local M = A:solve{}
      if not M then rt.stop() end
      local X = C:solve{ assume = G:of(M) }
      if X then A:add(G:clause(M, X))
      else rt.accept(M); A:add(G:block(M)) end
    end
`,
  shape3: (link = '') => decl(link) + `
    rt.capture("color", 2)
    rt.prepare()
    while true do
      local M = A:solve{}
      if not M then rt.stop() end
      local X = C:solve{ assume = G:of(M) }
      if X then A:expand("refine", { cex = X:atoms("color", 2) })
      else rt.accept(M); A:add(G:block(M)) end
    end
`,
  shape4: (batch = 20, link = '') => decl(link) + `
    rt.capture("color", 2)
    rt.prepare()
    local pending, grounded = {}, 0
    repeat
      A:search{ on_candidate = function(M)
        local X = C:solve{ assume = G:of(M) }
        if X then
          rt.push(pending, X)
          M:reject(G:block(M))
          if rt.size(pending) >= ${batch} then rt.restart() end
        end
      end }
      grounded = rt.size(pending)
      for _, X in ipairs(pending) do A:expand("refine", { cex = X:atoms("color", 2) }) end
      rt.clear(pending)
    until A.exhausted and grounded == 0
`,
};
