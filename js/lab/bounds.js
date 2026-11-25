// Refinery, Feature B: exact best-case and worst-case idealised runs (docs/lab-design.md).
// No DOM, no Node APIs.
//
// An idealised run of a scheme proposes alive candidates; a bad candidate M is refined with one
// option S of Opt(M), which removes R(M, S); solutions are accepted at no cost. Its length is its
// number of refinements. A shortest (longest) run is a set of bad candidates M1..Mk with one
// option each such that every bad candidate is chosen or removed by a chosen option, and the
// graph "Sj removes Mi, so Mi comes first" on the chosen candidates is acyclic.
//
//   schemeOptions(sp, scheme, { minimal })   per bad candidate: its options (sets that remove it)
//   incidence(sp, opts, { maxWork })         per option: the bad candidates and solutions it removes
//   boundsProgram(inc, { goal, seconds })    the ASP program with its budgeted Lua driver
//   exactBounds(exec, sp, inc, o)            best and worst, each 'proven', 'budget' or 'none'
import { removalBits, bitList, agrees, valuesOf, maskOf, maskKey } from './sets.js';

export const SCHEMES = ['loop', 'omniscient', 'block'];

// opts[c] for every candidate index c (bad ones only; solutions get []):
// [{ r, v, kind }]. minimal: Map M -> { sets: [[atom...]], capped, budget } (omniscient).
export function schemeOptions(sp, scheme, { minimal = null } = {}) {
  const opts = new Array(sp.count);
  const notes = { dropped: 0, stuck: [], capped: 0, missing: 0 };
  for (let c = 0; c < sp.count; c++) opts[c] = [];
  for (const M of sp.bad) {
    let list = [];
    if (scheme === 'block') list = [{ r: sp.full, v: valuesOf(sp, M, sp.full), kind: 'block' }];
    else if (scheme === 'loop') {
      const seen = new Set();
      for (let o = sp.optStart[M]; o < sp.optStart[M + 1]; o++) {
        const r = sp.optRw(o), v = sp.optVw(o);
        if (!agrees(sp, M, r, v)) { notes.dropped++; continue; }
        const k = maskKey(r) + '|' + maskKey(v);
        if (seen.has(k)) continue;
        seen.add(k);
        list.push({ r, v, kind: sp.optKind[o] === 1 ? 'group' : sp.optKind[o] === 2 ? 'block' : 'relevant', option: o });
      }
    } else if (scheme === 'omniscient') {
      const m = minimal && minimal.get(M);
      if (!m || m.budget || m.error) { notes.missing++; }
      else {
        if (m.capped) notes.capped++;
        for (const a of m.sets) { const r = maskOf(a, sp.W); list.push({ r, v: valuesOf(sp, M, r), kind: 'minimal' }); }
      }
    } else throw new Error(`unknown scheme ${scheme}`);
    if (!list.length) { notes.stuck.push(M); list = [{ r: sp.full, v: valuesOf(sp, M, sp.full), kind: 'block', fallback: true }]; }
    opts[M] = list;
  }
  return { opts, notes, scheme };
}

// Per option (global id, in order of bad candidates): owner, the bad candidates it removes other
// than its owner, and the solutions it removes. maxWork bounds |options| x words x |S| (work units);
// above it returns { tooLarge }.
export function incidence(sp, so, { maxWork = 4e8, onProgress = null } = {}) {
  let work = 0, nopt = 0;
  for (const M of sp.bad) for (const s of so.opts[M]) { nopt++; work += sp.CW * (1 + popc(s.r)); }
  if (work > maxWork) return { tooLarge: true, work, nopt };
  const owner = new Int32Array(nopt), list = [], sols = new Int32Array(nopt), sets = [];
  let o = 0, last = Date.now();
  const bits = new Uint32Array(sp.CW);
  for (const M of sp.bad) {
    for (const s of so.opts[M]) {
      removalBits(sp, s.r, s.v, bits);
      const rem = [];
      let ns = 0;
      for (const c of bitList(bits)) { if (sp.sol[c]) ns++; else if (c !== M) rem.push(c); }
      owner[o] = M; list.push(Int32Array.from(rem)); sols[o] = ns; sets.push(s);
      o++;
      if (onProgress && Date.now() - last > 250) { last = Date.now(); onProgress({ phase: 'incidence', done: o, of: nopt }); }
    }
  }
  let edges = 0;
  for (const l of list) edges += l.length;
  return { owner, rem: list, sols, sets, nopt, edges, bad: sp.bad.length };
}
const popc = (w) => { let c = 0; for (const x of w) { let y = x; while (y) { y &= y - 1; c++; } } return c; };

// Bounds without clingo, valid for every scheme (sound or not):
//   best ≥ ⌈|Bad| / largest removal⌉, and best ≥ |P| for a packing P: bad candidates no single option
//   removes two of (every run needs one refinement per member of P; greedy, fewest options first);
//   worst ≤ |Bad| − |N| for a matching N of pairs (c, d) where every option of c removes d and every
//   option of d removes c (whichever comes first removes the other, so at most one is refined).
export function cheapBounds(inc) {
  let maxR = 1;
  for (const l of inc.rem) if (l.length + 1 > maxR) maxR = l.length + 1;
  const ratio = inc.bad ? Math.ceil(inc.bad / maxR) : 0;
  const covers = new Map();
  const optsOf = new Map();
  for (let o = 0; o < inc.nopt; o++) {
    const c = inc.owner[o];
    if (!covers.has(c)) covers.set(c, []);
    if (!optsOf.has(c)) optsOf.set(c, []);
    covers.get(c).push(o); optsOf.get(c).push(o);
    for (const d of inc.rem[o]) { if (!covers.has(d)) covers.set(d, []); covers.get(d).push(o); }
  }
  const used = new Uint8Array(inc.nopt);
  let packing = 0;
  for (const c of [...covers.keys()].sort((a, b) => covers.get(a).length - covers.get(b).length || a - b)) {
    const list = covers.get(c);
    if (list.some((o) => used[o])) continue;
    packing++;
    for (const o of list) used[o] = 1;
  }
  const remSet = new Map();
  const removesAll = (c, d) => optsOf.get(c).every((o) => { if (!remSet.has(o)) remSet.set(o, new Set(inc.rem[o])); return remSet.get(o).has(d); });
  const matched = new Set();
  let matching = 0;
  for (const c of optsOf.keys()) {
    if (matched.has(c)) continue;
    const first = inc.rem[optsOf.get(c)[0]];
    for (const d of first) {
      if (matched.has(d) || !optsOf.has(d)) continue;
      if (removesAll(c, d) && removesAll(d, c)) { matched.add(c); matched.add(d); matching++; break; }
    }
  }
  return { lower: Math.max(ratio, packing), upper: inc.bad - matching, ratio, packing, matching };
}
export const trivialBounds = cheapBounds;

// The program. Candidates and options are numbered 1.. in the facts (b/1 bad candidate, o/2
// option of a candidate, r/2 option removes a bad candidate). The Lua main solves with
// --opt-mode=opt, prints each better model (@@B), and stops at the budget: a propagator checks
// the clock at every fixpoint and then makes the search unsatisfiable (clingo-wasm has no
// --time-limit). goal: 'min' (best) or 'max' (worst).
export function boundsProgram(inc, { goal = 'min', seconds = 30, stopAt = null } = {}) {
  const facts = [];
  const cid = new Map();
  let k = 0;
  for (let o = 0; o < inc.nopt; o++) { const M = inc.owner[o]; if (!cid.has(M)) cid.set(M, ++k); }
  for (const [, id] of cid) facts.push(`b(${id}).`);
  for (let o = 0; o < inc.nopt; o++) {
    facts.push(`o(${o + 1},${cid.get(inc.owner[o])}).`);
    for (const d of inc.rem[o]) facts.push(`r(${o + 1},${cid.get(d)}).`);
  }
  const rules = `
{ s(O) : o(O,C) } 1 :- b(C).
p(C) :- s(O), o(O,C).
c(D) :- s(O), r(O,D).
:- b(D), not p(D), not c(D).
#edge (C,D) : s(O), o(O,C), r(O,D), p(D).
#${goal === 'max' ? 'maximize' : 'minimize'} { 1,C : p(C) }.
#show s/1.
`;
  const lua = `#script (lua)
local clingo = require("clingo")
local BUDGET = ${Number(seconds) > 0 ? Number(seconds) : 30}
local STOP = ${stopAt == null ? 'nil' : Number(stopAt) | 0}   -- a model with this value is optimal (a bound computed outside)
local hit = false
local over, t0, lastp = false, 0, 0
local P = { lit = nil }
function P:init(init)
  local ok = xpcall(function()
    init.check_mode = clingo.PropagatorCheckMode.Fixpoint
    for a in init.symbolic_atoms:iter() do
      local l = init:solver_literal(a.literal)
      if l ~= 1 and l ~= -1 then self.lit = l; break end
    end
  end, debug.traceback)
  if not ok then self.lit = nil end
end
function P:check(control)
  local ok, err = xpcall(function()
    local now = os.clock()
    if now - lastp > 0.25 then lastp = now; print('@@B {"t":"p","s":' .. string.format("%.2f", now - t0) .. '}') end
    if not over and now - t0 > BUDGET then over = true end
    if over and self.lit then
      local a = self.lit
      local first = control.assignment:is_true(a) and -a or a
      if control:add_clause{ { first }, lock = true } then control:add_clause{ { -first }, lock = true } end
    end
  end, debug.traceback)
  if not ok then over = true end
end
function main(prg)
  t0 = os.clock()
  prg:register_propagator(P)
  prg:ground({ { "base", {} } })
  print('@@B {"t":"g","s":' .. string.format("%.2f", os.clock() - t0) .. '}')
  local h = prg:solve{ yield = true }
  local n = 0
  local ok, err = pcall(function()
    for m in h:iter() do
      n = n + 1
      local sel = {}
      for _, a in ipairs(m:symbols{ shown = true }) do sel[#sel + 1] = tostring(a.arguments[1].number) end
      local cost = m.cost[1] or 0
      print('@@B {"t":"m","cost":' .. tostring(cost) .. ',"sel":[' .. table.concat(sel, ",") .. ']}')
      if STOP and math.abs(cost) == STOP then hit = true; break end
      if os.clock() - t0 > BUDGET then over = true end
    end
  end)
  h:close()
  print('@@B {"t":"end","over":' .. tostring(over and not hit) .. ',"hit":' .. tostring(hit) .. ',"models":' .. n .. ',"ok":' .. tostring(ok) .. ',"s":' .. string.format("%.2f", os.clock() - t0) .. '}')
end
#end.
`;
  return `${facts.join('\n')}\n${rules}\n${lua}`;
}

// Parse the driver's lines: the last model's selection (options, 0-based) and its status.
export function parseBounds(lines, goal) {
  let last = null, end = null;
  for (const l of lines) {
    if (!l.startsWith('@@B ')) continue;
    let b; try { b = JSON.parse(l.slice(4)); } catch { continue; }
    if (b.t === 'm') last = b; else if (b.t === 'end') end = b;
  }
  if (!last) return { status: end && !end.over ? 'error' : 'none', value: null, sel: [] };
  // clingo reports a #maximize as the negated sum
  const value = Math.abs(last.cost);
  const proven = !!(end && ((!end.over && end.ok) || end.hit));
  return { status: proven ? 'proven' : 'budget', value, sel: last.sel.map((x) => x - 1), seconds: end ? end.s : null, goal, by: end && end.hit ? 'bound' : proven ? 'clingo' : null };
}

// Order a selection into a run (a topological order of the "removes" graph) and check it:
// returns { order: [options], valid, lost (solutions removed) }.
export function orderSelection(sp, inc, sel) {
  const chosen = new Map(sel.map((o) => [inc.owner[o], o]));
  const indeg = new Map([...chosen.keys()].map((c) => [c, 0]));
  const succ = new Map([...chosen.keys()].map((c) => [c, []]));
  // edge D -> C when C's option removes D (D must come first)
  for (const [C, o] of chosen) for (const D of inc.rem[o]) if (chosen.has(D)) { succ.get(D).push(C); indeg.set(C, indeg.get(C) + 1); }
  const queue = [...chosen.keys()].filter((c) => indeg.get(c) === 0).sort((a, b) => a - b), order = [];
  while (queue.length) {
    const c = queue.shift(); order.push(chosen.get(c));
    for (const d of succ.get(c)) { indeg.set(d, indeg.get(d) - 1); if (indeg.get(d) === 0) queue.push(d); }
  }
  const covered = new Set(chosen.keys());
  for (const o of sel) for (const d of inc.rem[o]) covered.add(d);
  let risk = 0;
  const atRisk = new Set();
  for (const o of sel) if (inc.sols[o]) { const b = removalBits(sp, inc.sets[o].r, inc.sets[o].v); for (const c of bitList(b)) if (sp.sol[c]) atRisk.add(c); }
  risk = atRisk.size;
  return { order, valid: order.length === chosen.size && covered.size === inc.bad, atRisk: risk };
}

// Best and worst for one scheme. Returns { best, worst, trivial } with
// { status: 'proven' | 'budget' | 'none' | 'skipped', value, lower, upper, text, atRisk }.
export async function exactBounds(exec, sp, inc, { seconds = 30, onProgress = null } = {}) {
  const triv = cheapBounds(inc);
  const out = { trivial: triv };
  for (const goal of ['min', 'max']) {
    const prog = boundsProgram(inc, { goal, seconds, stopAt: goal === 'min' ? triv.lower : triv.upper });
    const r = await exec(prog, '--outf=3', onProgress ? (l) => { if (l.startsWith('@@B {"t":"p"')) { try { onProgress({ phase: goal === 'min' ? 'best' : 'worst', s: JSON.parse(l.slice(4)).s }); } catch { /* skip */ } } } : null);
    const p = parseBounds(r.out || [], goal);
    if (r.status === 'trap') p.status = 'error';
    const ord = p.sel.length ? orderSelection(sp, inc, p.sel) : null;
    const res = { ...p, valid: ord ? ord.valid : null, atRisk: ord ? ord.atRisk : 0, order: ord ? ord.order : [] };
    if (goal === 'min') {
      res.lower = p.status === 'proven' ? p.value : triv.lower;
      res.upper = p.value ?? triv.upper;
      res.text = p.status === 'proven' ? `${p.value} (proven${p.by === 'bound' ? ': no run is shorter than the packing bound' : ''})` : p.value != null ? `≤ ${p.value}, ≥ ${triv.lower} (not proven within the budget of ${seconds} s)` : `≥ ${triv.lower} (no run found within ${seconds} s)`;
      out.best = res;
    } else {
      res.lower = p.value ?? triv.lower;
      res.upper = p.status === 'proven' ? p.value : triv.upper;
      res.text = p.status === 'proven' ? `${p.value} (proven${p.by === 'bound' ? ': it reaches the upper bound' : ''})` : p.value != null ? `≥ ${p.value}, ≤ ${triv.upper} (not proven within the budget of ${seconds} s)` : `≤ ${triv.upper} (no run found within ${seconds} s)`;
      out.worst = res;
    }
  }
  return out;
}
