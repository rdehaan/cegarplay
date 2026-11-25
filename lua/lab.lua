-- CegarPlay Refinery: the audit's enumeration kept as data.
-- Appended after runtime.lua (and ground.lua for rt.lab_detail) by the lab only: no other run
-- loads this file, so the main engine's events and programs are unchanged.
--
--   rt.lab_space{ link = G, limit = 200000, clause = true, clauses = false }
--     Every candidate of the unrefined abstraction (one per interface assignment, as the audit
--     enumerates them) and every counterexample of each, reduced to its distinct options: the
--     relevant set of a counterexample (G.clause), or each clause/3 group (G.clauses).
--     Y lines (lab only): { t = "p", phase, candidates, done } every 0.25 s;
--     { t = "c", from, c = { { hex, ncex, { { r, n }, { r, n, v }, ... } }, ... } } per chunk;
--     { t = "end", candidates, solutions, counterexamples, options } or { t = "limit", limit }.
--
--   rt.lab_detail{ link = G, cand = "hex", limit = N, sets = { { r = "hex", v = "hex",
--                  members = { "hex", ... }, over = false }, ... }, cap = K, lift = false }
--     The first N counterexamples of one candidate (shown text, relevant set, clause groups),
--     whether each set is justified by one of them, and (lift) one lifted clause.
--     Y lines: { t = "x", ... } per counterexample, { t = "j", ... } per set, { t = "lift", ... },
--     { t = "detail", ncex, checked }.
--
-- Nothing here raises inside a clingo frame: every solve goes through the runtime's guarded
-- calls (Solver:models, Solver:solve), which check their arguments in Lua first.
local clingo = require("clingo")
local clock, concat = os.clock, table.concat

local function emit(obj) print("@@Y " .. rt.json(obj)) end

local last_p = 0
local function progress(phase, cands, done, force)
  local now = clock()
  if not force and now - last_p < 0.25 then return end
  last_p = now
  emit({ t = "p", phase = phase, candidates = cands, done = done })
end

-- hex <-> boolean vector [1..n], atom 1 in the lowest bit of the last digit (rt.hexvec)
local function bits(hex, n)
  local v, L = {}, #hex
  for j = 1, n do
    local k = L - ((j - 1) // 4)
    local d = k >= 1 and tonumber(hex:sub(k, k), 16) or 0
    v[j] = ((d >> ((j - 1) % 4)) & 1) == 1
  end
  return v
end

-- The clause/3 groups of a counterexample (as the audit reads them, lua/audit.lua): { r, v }
-- boolean vectors (v = the values that falsify every literal). A group naming an atom outside
-- the link is skipped.
local function groups(L, X)
  local atoms = X["clause/3"]
  if not atoms then return {} end
  local byid, order = {}, {}
  for _, a in ipairs(atoms) do
    local args = a.arguments
    local id, t, val = tostring(args[1]), tostring(args[2]), tostring(args[3])
    local g = byid[id]
    if not g then g = { r = {}, v = {} }; byid[id] = g; order[#order + 1] = g end
    local j = L.jstr[t]
    if not j or (val ~= "true" and val ~= "false") then g.bad = true
    else g.r[j] = true; g.v[j] = val ~= "true" end
  end
  local out = {}
  for _, g in ipairs(order) do if not g.bad then out[#out + 1] = g end end
  return out
end

local function setup(L)
  if getmetatable(L) ~= rt.Link then rt.fail("lab: no link given") end
  if not rt.prepared then rt.prepare() end
  for _, s in ipairs({ L.from, L.to }) do pcall(function() s.ctl.configuration.solve.opt_mode = "ignore" end) end
end

function rt.lab_space(o)
  local L = o.link
  setup(L)
  local A, C = L.from, L.to
  local limit = o.limit or 200000
  local hexvec = rt.hexvec
  progress("candidates", 0, 0, true)
  local all = A:models{ limit = limit + 1 }
  local cands, seen = {}, {}
  for _, M in ipairs(all) do
    local hx = hexvec(M[L], L.n)
    if not seen[hx] then
      seen[hx] = true
      cands[#cands + 1] = { M = M, hx = hx }
      if #cands > limit then break end
    end
  end
  all = nil
  if #cands > limit then
    emit({ t = "limit", limit = limit })
    rt.finish("limit", "more than " .. limit .. " candidates", false)
  end
  local nsol, ncex, nopt = 0, 0, 0
  local chunk, from = rt.array({}), 1
  for i, c in ipairs(cands) do
    local Xs = C:models{ assume = L:of(c.M) }
    local opts, keys = rt.array({}), {}
    for _, X in ipairs(Xs) do
      if o.clause ~= false then
        local r = hexvec(X[L], L.n)
        local k = "r" .. r
        if keys[k] then keys[k][2] = keys[k][2] + 1
        else local e = rt.array({ r, 1 }); keys[k] = e; opts[#opts + 1] = e end
      end
      if o.clauses then
        for _, g in ipairs(groups(L, X)) do
          local r, v = hexvec(g.r, L.n), hexvec(g.v, L.n)
          local k = "g" .. r .. "|" .. v
          if keys[k] then keys[k][2] = keys[k][2] + 1
          else local e = rt.array({ r, 1, v }); keys[k] = e; opts[#opts + 1] = e end
        end
      end
    end
    if #Xs == 0 then nsol = nsol + 1 end
    ncex = ncex + #Xs
    nopt = nopt + #opts
    chunk[#chunk + 1] = rt.array({ c.hx, #Xs, opts })
    c.M = nil
    if #chunk == 256 or i == #cands then
      emit({ t = "c", from = from, c = chunk })
      from = i + 1
      chunk = rt.array({})
    end
    progress("counterexamples", #cands, i)
  end
  emit({ t = "end", candidates = #cands, solutions = nsol, counterexamples = ncex, options = nopt, atoms = rt.array({ table.unpack(L.str, 1, L.n) }) })
end

-------------------------------------------------------------------------------
-- One candidate in detail
-------------------------------------------------------------------------------
-- The heads of choice rules of the check's ground program that are not interface atoms: the
-- counterexample's own choices (kept per link, as the ground program does not change here).
local function choices(L)
  if L.lab_choices then return L.lab_choices end
  local st = L.to.store
  local isint, out, seen = {}, {}, {}
  for j = 1, L.n do isint[L.dst[j]] = true end
  if st and not st.error then
    for _, r in ipairs(st.rules) do
      if r.choice then
        for _, h in ipairs(r.head) do
          if not isint[h] and not seen[h] then seen[h] = true; out[#out + 1] = h end
        end
      end
    end
  end
  L.lab_choices = out
  return out
end

-- assumptions of the check: the candidate's interface values (hex), and X's choices fixed
local function check_assumptions(L, hex, X)
  local v, a = bits(hex, L.n), {}
  for j = 1, L.n do a[#a + 1] = v[j] and L.dst[j] or -L.dst[j] end
  if X and X.tv then
    for _, h in ipairs(choices(L)) do a[#a + 1] = X.tv[h] and h or -h end
  end
  return a
end

function rt.lab_detail(o)
  local L = o.link
  SETTINGS.trace = math.maxinteger         -- counterexample texts (no T events are sent)
  setup(L)
  local A, C = L.from, L.to
  local v = bits(o.cand, L.n)
  local asm = {}
  for j = 1, L.n do asm[j] = v[j] and L.src[j] or -L.src[j] end
  local M = A:solve{ assume = asm }
  if not M then rt.fail("lab: the candidate " .. o.cand .. " is not a model of " .. A.name) end
  local Xs = C:models{ assume = L:of(M), limit = (o.limit or 20) }
  local hexvec = rt.hexvec
  for k, X in ipairs(Xs) do
    local gs = rt.array({})
    for _, g in ipairs(groups(L, X)) do gs[#gs + 1] = rt.array({ hexvec(g.r, L.n), hexvec(g.v, L.n) }) end
    emit({ t = "x", k = k, shown = X.shown or "", r = hexvec(X[L], L.n), groups = gs })
  end
  -- justification: level 2 on the set's values (one evaluation for all of R(M, S)), else one
  -- solve per member M' of R(M, S) with X's choices fixed
  local LIFT = rt.LIFT
  local checked = 0
  local cap = o.cap or 20000
  for si, s in ipairs(o.sets or {}) do
    local r, val = bits(s.r, L.n), bits(s.v, L.n)
    local vals = {}
    for j = 1, L.n do if r[j] then vals[j] = val[j] end end
    local res = { t = "j", i = si, by = rt.NULL, how = rt.NULL, verdict = "no", fails = rt.NULL }
    local fails = {}
    for k, X in ipairs(Xs) do
      local ok = false
      if LIFT and X.tv then
        local good = pcall(function() ok = LIFT.level2(L, X, vals) end)
        if not good then ok = false end
      end
      if ok then res.by = k; res.how = "level 2"; res.verdict = "yes"; break end
      if s.over then res.verdict = "unchecked"
      else
        local all = true
        for _, mh in ipairs(s.members or {}) do
          if checked >= cap then all = nil; break end
          checked = checked + 1
          local Y = C:solve{ assume = check_assumptions(L, mh, X) }
          if not Y then all = false; fails[k] = mh; break end
        end
        if all == nil then res.verdict = "unchecked"; break end
        if all then res.by = k; res.how = "per candidate"; res.verdict = "yes"; break end
      end
    end
    if res.verdict == "no" and Xs[1] then res.fails = fails[1] or rt.NULL end
    emit(res)
  end
  if o.lift and LIFT and Xs[1] then
    local ok, c = pcall(LIFT.lift, L, M, Xs[1])
    if ok and c then
      local r, val = {}, {}
      local lits = M.lazy and L.slit or L.src
      for k = 1, #c do
        local j = c.j[k]
        if j then r[j] = true; val[j] = not (c[k] == lits[j]) end
      end
      emit({ t = "lift", r = hexvec(r, L.n), v = hexvec(val, L.n), level = c.lifted or rt.NULL, fallback = c.x == nil })
    else
      emit({ t = "lift", error = tostring(c) })
    end
  end
  emit({ t = "detail", ncex = #Xs, checked = checked, limit = o.limit or 20 })
end

return rt
