-- CegarPlay audit (docs/spec-soundness.md section 1): enumerate every candidate of the
-- unrefined abstraction and every counterexample of each, and report each refinement that
-- would remove a solution. Appended after runtime.lua by assemble(..., { mode = 'audit' }).
--
--   rt.audit{ link = G, limit = N, clause = true, expand = { { part = "refine", facts =
--             { { name = "cex", pred = "color", arity = 2 } } } } }
--
-- Clause refinements (relevant/1): a pair (candidate M, relevant set R) is unsound when a
-- solution agrees with M on every atom of R. Rule refinements (expand): a counterexample is
-- unsound when grounding the part with its facts leaves some solution without a model.
-- Emits A events: progress { phase, candidates, pairs, unsound } every 0.25 s, then the
-- verdict. Solutions are counted per interface assignment.
local clingo = require("clingo")
local AUDIT = {}
rt.AUDIT = AUDIT

local W = 62                              -- atoms per packed word
local clock = os.clock
local concat = table.concat

local function words(n) return (n + W - 1) // W end

-- pack a boolean vector v[1..n] into integer words
local function pack(v, n)
  local out, nw = {}, words(n)
  for w = 1, nw do out[w] = 0 end
  for j = 1, n do
    if v[j] then local w = (j - 1) // W + 1; out[w] = out[w] | (1 << ((j - 1) % W)) end
  end
  return out
end
AUDIT.pack = pack
local function key(p) return concat(p, ",") end
local function popcount(x)
  local c = 0
  while x ~= 0 do x = x & (x - 1); c = c + 1 end
  return c
end
local function iszero(p) for w = 1, #p do if p[w] ~= 0 then return false end end return true end
local function atoms_of(L, p, value)
  local t = {}
  for j = 1, L.n do
    local w = (j - 1) // W + 1
    local bit = (p[w] >> ((j - 1) % W)) & 1
    if (bit == 1) == (value ~= false) then t[#t + 1] = L.str[j] end
  end
  return t
end
AUDIT.atoms_of = atoms_of
-- hex text of a packed vector, atom 1 in the lowest bit of the last digit group (for P events)
function AUDIT.hex(p, n)
  local digits = {}
  for j = 1, n, 4 do
    local d = 0
    for b = 0, 3 do
      local i = j + b
      if i <= n then
        local w = (i - 1) // W + 1
        if (p[w] >> ((i - 1) % W)) & 1 == 1 then d = d | (1 << b) end
      end
    end
    digits[#digits + 1] = string.format("%x", d)
  end
  return string.reverse(concat(digits))
end

local function array(t) return rt.array(t) end

local last_progress = 0
local function progress(phase, st, force)
  local now = clock()
  if not force and now - last_progress < 0.25 then return end
  last_progress = now
  rt.emit("A", { phase = phase, candidates = st.candidates, pairs = st.pairs, unsound = st.unsound })
end

-- every candidate, one per interface assignment (packed), with the models kept for the checks
local function candidates(A, L, limit, st)
  local all = A:models{ limit = limit + 1 }
  local cands, seen = {}, {}
  for _, M in ipairs(all) do
    local p = pack(M[L], L.n)
    local k = key(p)
    if not seen[k] then
      seen[k] = true
      cands[#cands + 1] = { M = M, p = p }
      if #cands > limit then break end
    end
  end
  if #cands > limit then
    st.candidates = #cands - 1
    rt.emit("A", { verdict = "limit", candidates = #cands - 1, limit = limit })
    rt.finish("limit", "more than " .. limit .. " candidates: audit a smaller instance", false)
  end
  st.candidates = #cands
  return cands
end

-- Clause refinements: every counterexample of every candidate, reduced to distinct relevant sets.
local function audit_clauses(A, C, L, cands, st)
  local sols, pairs_ = {}, {}
  for _, c in ipairs(cands) do
    local Xs = C:models{ assume = L:of(c.M) }
    if #Xs == 0 then
      sols[#sols + 1] = c
    else
      local rs = {}
      for _, X in ipairs(Xs) do
        st.counterexamples = st.counterexamples + 1
        local r = pack(X[L], L.n)
        local k = key(r)
        if not rs[k] then
          rs[k] = true
          pairs_[#pairs_ + 1] = { c = c, r = r, shown = X.shown or "" }
          if iszero(r) then st.empty = st.empty + 1 end
        end
      end
      st.pairs = #pairs_
    end
    c.M = nil                              -- the models are no longer needed
    progress("counterexamples", st)
  end
  st.solutions = #sols
  local risk, best = {}, nil
  local nw = words(L.n)
  if nw == 1 then
    -- one word per vector: plain integers, the common case (up to 62 interface atoms)
    local sv, ns = {}, #sols
    for i = 1, ns do sv[i] = sols[i].p[1] end
    for _, pr in ipairs(pairs_) do
      local m, r = pr.c.p[1], pr.r[1]
      local mr, bad = m & r, false
      for si = 1, ns do
        local x = sv[si]
        if x & r == mr then
          bad = true
          risk[si] = true
          local diff = popcount(m ~ x)
          if not best or diff < best.diff then best = { pr = pr, s = sols[si], diff = diff } end
        end
      end
      if bad then st.unsound = st.unsound + 1 end
      progress("pairs", st)
    end
    pairs_ = {}
  end
  for _, pr in ipairs(pairs_) do
    local m, r = pr.c.p, pr.r
    local bad = false
    for si, s in ipairs(sols) do
      local sp, agree = s.p, true
      for w = 1, nw do
        if ((m[w] ~ sp[w]) & r[w]) ~= 0 then agree = false; break end
      end
      if agree then
        bad = true
        risk[si] = true
        local diff = 0
        for w = 1, nw do diff = diff + popcount(m[w] ~ sp[w]) end
        if not best or diff < best.diff then best = { pr = pr, s = s, diff = diff } end
      end
    end
    if bad then st.unsound = st.unsound + 1 end
    progress("pairs", st)
  end
  for _ in pairs(risk) do st.at_risk = st.at_risk + 1 end
  if best then
    local m, sp = best.pr.c.p, best.s.p
    local d = {}
    for w = 1, nw do d[w] = m[w] ~ sp[w] end
    st.witness = { kind = "clause", candidate = array(atoms_of(L, m)), counterexample = best.pr.shown,
      relevant = array(atoms_of(L, best.pr.r)), solution = array(atoms_of(L, sp)), differ = array(atoms_of(L, d)) }
  end
  AUDIT.solutions = sols
  return sols
end

-- Rule refinements: a scratch control of the abstraction's fragments per check.
local function scratch(A, parts)
  local ctl = rt.new_control({}, A.name .. " (audit)", A.frags)
  ctl:add("base", {}, rt.join(A.frags))
  ctl:ground({ { "base", {} } })
  return ctl
end

local function add_facts(ctl, k, facts, part)
  local b = ctl:backend()
  local kn = clingo.Number(k)
  local ok, err = pcall(function()
    for _, f in ipairs(facts) do
      b:add_rule{ head = { b:add_atom(clingo.Function(f.name, { kn, f.sym }, true)) }, body = {} }
    end
  end)
  b:close()
  if not ok then error(err, 0) end
  ctl:ground({ { part, { kn } } })
end

-- interface values of a solution as assumptions of a scratch control
local function assumptions(ctl, L, p)
  local a = {}
  for j = 1, L.n do
    local atom = ctl.symbolic_atoms:lookup(L.sym[j])
    local w = (j - 1) // W + 1
    local on = (p[w] >> ((j - 1) % W)) & 1 == 1
    if atom then a[#a + 1] = on and atom.literal or -atom.literal
    elseif on then a[#a + 1] = -1 end   -- not even an atom there: cannot be true (never happens for a link)
  end
  return a
end

local function satisfiable(ctl, assume)
  local h = ctl:solve{ assumptions = assume, yield = true }
  local sat = false
  local ok, err = pcall(function() for _ in h:iter() do sat = true; break end end)
  h:close()
  if not ok then error(err, 0) end
  return sat
end

local function audit_expand(A, C, L, cands, sols, spec, st)
  -- the counterexamples (when the clause audit ran, it enumerated them already; here the
  -- facts are what matters, so collect distinct fact sets over all candidates)
  local sets, order = {}, {}
  local need_sols = sols == nil
  if need_sols then sols = {} end
  for _, c in ipairs(cands) do
    local M = c.M
    if not M then break end                -- dropped by the clause audit: counted there
    local Xs = C:models{ assume = L:of(M) }
    if #Xs == 0 then
      if need_sols then sols[#sols + 1] = c end
    else
      for _, X in ipairs(Xs) do
        if need_sols then st.counterexamples = st.counterexamples + 1 end
        for pi, part in ipairs(spec) do
          local facts, texts = {}, {}
          for _, f in ipairs(part.facts) do
            for _, sym in ipairs(X:atoms(f.pred, f.arity)) do
              facts[#facts + 1] = { name = f.name, sym = sym }
              texts[#texts + 1] = f.name .. ":" .. tostring(sym)
            end
          end
          table.sort(texts)
          local k = pi .. "|" .. concat(texts, " ")
          if not sets[k] then
            sets[k] = { part = part.part, facts = facts, shown = X.shown or "", candidate = c.p }
            order[#order + 1] = k
          end
        end
      end
    end
    progress("counterexamples", st)
  end
  for _, c in ipairs(cands) do c.M = nil end
  if need_sols then st.solutions = #sols end
  st.pairs = st.pairs + #order
  -- all refinements at once: a solution with a model there is removed by none of them
  local all = scratch(A)
  for i, k in ipairs(order) do add_facts(all, i, sets[k].facts, sets[k].part) end
  local suspects = {}
  for si, s in ipairs(sols) do
    if not satisfiable(all, assumptions(all, L, s.p)) then suspects[#suspects + 1] = si end
    progress("solutions", st)
  end
  if #suspects == 0 then return end
  -- confirm one refinement at a time (a conjunction may fail where no single one does)
  local risk, best = {}, nil
  for _, k in ipairs(order) do
    local set = sets[k]
    local ctl = scratch(A)
    add_facts(ctl, 1, set.facts, set.part)
    local bad = false
    for _, si in ipairs(suspects) do
      local s = sols[si]
      if not satisfiable(ctl, assumptions(ctl, L, s.p)) then
        bad = true
        risk[si] = true
        if not best then
          local facts = {}
          for _, f in ipairs(set.facts) do facts[#facts + 1] = f.name .. "(k," .. tostring(f.sym) .. ")" end
          best = { set = set, s = s, facts = facts }
        end
      end
    end
    if bad then st.unsound = st.unsound + 1 end
    progress("rules", st)
  end
  for _ in pairs(risk) do st.at_risk = st.at_risk + 1 end
  if best and not st.witness then
    local m, sp = best.set.candidate, best.s.p
    local d = {}
    for w = 1, #m do d[w] = m[w] ~ sp[w] end
    st.witness = { kind = "expand", part = best.set.part, candidate = array(atoms_of(L, m)),
      counterexample = best.set.shown, facts = array(best.facts), solution = array(atoms_of(L, sp)),
      differ = array(atoms_of(L, d)) }
  end
end

function rt.audit(o)
  o = o or {}
  local L = o.link
  if getmetatable(L) ~= rt.Link then rt.fail("audit: no link given") end
  local A, C = L.from, L.to
  if #A.inn > 0 then rt.fail("audit: solver " .. A.name .. " has incoming links; audit a link that leaves the top solver") end
  local limit = o.limit or 200000
  local spec = o.expand or {}
  for _, part in ipairs(spec) do
    for _, f in ipairs(part.facts) do rt.capture(f.pred, f.arity) end
  end
  if not rt.prepared then rt.prepare() end
  SETTINGS.trace = math.maxinteger         -- counterexample texts for the witness (no T events are sent)
  -- every model, not only improving ones, when a solver has a #minimize
  for _, s in ipairs({ A, C }) do pcall(function() s.ctl.configuration.solve.opt_mode = "ignore" end) end
  local st = { candidates = 0, solutions = 0, counterexamples = 0, pairs = 0, unsound = 0, at_risk = 0, empty = 0 }
  local t0 = clock()
  progress("candidates", st, true)
  local cands = candidates(A, L, limit, st)
  AUDIT.candidates = cands
  AUDIT.link = L
  progress("counterexamples", st, true)
  local sols
  if o.clause ~= false then sols = audit_clauses(A, C, L, cands, st) end
  if #spec > 0 then
    if sols then
      -- the clause audit dropped the models; enumerate again for the facts
      local again = candidates(A, L, limit, { })
      audit_expand(A, C, L, again, sols, spec, st)
    else
      audit_expand(A, C, L, cands, nil, spec, st)
    end
  end
  local kinds = array({})
  if o.clause ~= false then kinds[#kinds + 1] = "clause" end
  if #spec > 0 then kinds[#kinds + 1] = "expand" end
  rt.emit("A", { verdict = st.unsound > 0 and "unsound" or "sound", link = L.name, kinds = kinds,
    candidates = st.candidates, solutions = st.solutions, counterexamples = st.counterexamples, pairs = st.pairs,
    unsound = st.unsound, at_risk = st.at_risk, empty = st.empty, witness = st.witness, atoms = L.n,
    t = clock() - t0 })
  AUDIT.result = st
  return st
end

return AUDIT
