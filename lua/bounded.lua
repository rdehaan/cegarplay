-- CegarPlay symbolic audit and bounded verification (docs/spec-soundness.md sections 7 and 8).
-- Appended after runtime.lua and ground.lua by assemble(..., { mode = 'bounded' }).
--
--   rt.bounded{ link = G, clause = true, clauses = false, kinds = { "clause" }, seconds = 60,
--               fewest = true }
--
-- The question of the audit (lua/audit.lua) -- can a clause that the strategy builds, from any
-- candidate M and any counterexample X, remove a solution M'? -- answered by one search over
-- triples (M, X, M') with an inner CEGAR loop instead of enumeration. The verifier program V:
--   A1  A's rules (M)          C1  C's rules under M (X, guesses free)
--   A2  A's rules again (M')   removal: M' falsifies X's clause
--   C3  (C stratified) C under M' with X's guesses: some constraint must fire
-- A model of V is checked against C (the check K): no counterexample means M' is a solution
-- (unsound); a counterexample Y refines V (C stratified: a copy of C under M' with Y's guesses
-- must fire; else M' is blocked). V unsatisfiable means sound.
-- With a space (link built with extra instance atoms, L.inst[j]), A2 shares A1's instance atoms.
-- Emits A events: progress { phase = "symbolic", rounds, refinements } every 0.25 s, then the
-- verdict. Every clingo call is checked in Lua first; nothing raises inside a clingo frame.
local clingo = require("clingo")
local BOUNDED = {}
rt.BOUNDED = BOUNDED
local LIFT = rt.LIFT
local clock, concat = os.clock, table.concat

-------------------------------------------------------------------------------
-- Spaces (docs/spec-instances.md section 8): rt.link(..., { extra = true })
-------------------------------------------------------------------------------
-- The fragment "instance" is a space: choice rules over the instance predicates. Its non-fact
-- atoms (grounded alone) become extra interface atoms of the link, marked L.inst[j]: a choice in
-- the check like any interface atom (and program text, CLAUDE.md rule 10), never in a clause.
-- Wrapping rt.link here keeps lua/runtime.lua, and so every other run, unchanged.
local function space_atoms()
  local ctl = rt.new_control({}, "space", { "instance" })
  ctl:add("base", {}, rt.join({ "instance" }))
  ctl:ground({ { "base", {} } })
  local free, facts = {}, {}
  for a in ctl.symbolic_atoms:iter() do
    if a.is_fact then facts[#facts + 1] = tostring(a.symbol) else free[#free + 1] = a.symbol end
  end
  return free, facts
end

-- The glue's glue/1 atoms in every model (cautious) and in some model (brave): equal sets mean
-- the interface does not depend on the free part of the instance.
local function glue_sets(glue)
  local out = {}
  for _, mode in ipairs({ "brave", "cautious" }) do
    local g = rt.new_control({ "--enum-mode=" .. mode, "0" }, "glue (" .. mode .. ")", glue)
    g:add("base", {}, rt.join(glue))
    g:ground({ { "base", {} } })
    local set, n = {}, 0
    local h = g:solve{ yield = true }
    local ok, err = pcall(function()
      for m in h:iter() do
        set, n = {}, 0
        for _, a in ipairs(m:symbols{ shown = true }) do
          if a.name == "glue" and #a.arguments == 1 then set[tostring(a.arguments[1])] = true; n = n + 1 end
        end
      end
    end)
    h:close()
    if not ok then error(err, 0) end
    out[mode] = { set = set, n = n }
  end
  return out
end

local link0 = rt.link
rt.link = function(name, from, to, glue, opts)
  if not (type(opts) == "table" and opts.extra) or FRAGMENTS.instance == nil then return link0(name, from, to, glue, opts) end
  local L = link0(name, from, to, glue, opts)
  L.inst = {}
  local gs = glue_sets(rt.with_instance(glue))
  local same = gs.brave.n == gs.cautious.n
  if same then for k in pairs(gs.brave.set) do if not gs.cautious.set[k] then same = false end end end
  if not same then L.inst_reason = "the interface depends on the instance"; return L end
  local free, facts = space_atoms()
  L.inst_facts = facts
  local b = to.ctl:backend()
  local ok, err = pcall(function()
    for _, sym in ipairs(free) do
      local key = tostring(sym)
      local j = L.jstr[key]
      if j then L.inst[j] = true
      else
        local a = from.ctl.symbolic_atoms:lookup(sym)
        if a and not a.is_fact then
          local d = b:add_atom(sym)
          b:add_rule{ head = { d }, body = {}, choice = true }
          -- as rt.link's iface_text: the same atom as program text, grounded with the target
          to.iface = to.iface or { choice = {}, facts = {} }
          to.iface.choice[#to.iface.choice + 1] = key
          j = L.n + 1; L.n = j
          L.src[j] = a.literal; L.dst[j] = d; L.ind[j] = b:add_atom(clingo.Function("relevant", { sym }, true))
          L.sym[j] = sym; L.str[j] = key; L.jof[d] = j; L.jstr[key] = j
          L.inst[j] = true
        end
      end
    end
  end)
  b:close()
  if not ok then error(err, 0) end
  return L
end

local last_progress = 0
local function progress(st, force)
  local now = clock()
  if not force and now - last_progress < 0.25 then return end
  last_progress = now
  rt.emit("A", { phase = "symbolic", rounds = st.rounds, refinements = st.refinements })
end

-- The time budget inside one solve: a propagator whose check runs at every propagation fixpoint
-- (check mode Fixpoint), reads the clock every 256 calls and interrupts the search of ctl past
-- B.deadline (setting B.timed_out), as the runtime's guarded() interrupts a search. Both hooks
-- exist at registration (rule 2); nothing here may raise inside clingo (rule 1). Used on V and
-- on the check C. On a page with the pause/stop poll (SETTINGS.poll), it also reads the page's
-- command at most every 0.25 s, as the runtime does between candidates: "pause" blocks until the
-- next command, "stop" interrupts the search and sets B.stopped.
local last_poll = 0
local function watch(ctl, B)
  local calls = 0
  ctl:register_propagator({
    init = function(_, init)
      pcall(function() init.check_mode = clingo.PropagatorCheckMode.Fixpoint end)
    end,
    check = function(_, control)
      calls = calls + 1
      if calls < 256 then return end
      calls = 0
      pcall(function()
        local now = clock()
        if not B.timed_out and now > B.deadline then B.timed_out = true; ctl:interrupt(); return end
        if SETTINGS.poll and not B.stopped and now - last_poll >= 0.25 then
          last_poll = now
          local l = io.read("l")
          if l == "pause" then l = io.read("l") end
          if l == "stop" then B.stopped = true; ctl:interrupt() end
        end
      end)
    end,
  })
end

local function solve_first(ctl, assume)
  local h = ctl:solve{ assumptions = assume, yield = true }
  local m0 = nil
  local ok, err = pcall(function()
    for m in h:iter() do m0 = m; break end
  end)
  return h, m0, ok, err
end

-- the facts text of a set of symbols (sorted, one per line)
local function facts_text(list)
  local t = {}
  for _, s in ipairs(list) do t[#t + 1] = s .. "." end
  table.sort(t)
  return concat(t, " ")
end

-- The verifier program. Returns V = { ctl, a, b, r, picks, cm1, ... } or nil, reason.
local function build(L, o, deadline)
  deadline = deadline or math.huge
  local A, C = L.from, L.to
  local sa, sc = A.store, C.store
  if not sa or not sc then return nil, "no ground program" end
  if sa.error then return nil, "abstraction: " .. sa.error end
  if sc.error then return nil, "check: " .. sc.error end
  if sa.disjunctive or sc.disjunctive then return nil, "disjunctive rules" end
  if sa.negweight or sc.negweight then return nil, "negative weights" end
  local isint, inst, instsrc = {}, L.inst or {}, {}
  for j = 1, L.n do
    isint[L.dst[j]] = j
    if inst[j] then instsrc[L.src[j]] = true end
  end
  local strat = LIFT.stratified(sc, isint)
  local heads = {}
  for _, r in ipairs(sc.rules) do for _, h in ipairs(r.head) do heads[h] = true end end
  local ctl = rt.new_control({}, "verifier " .. L.name, {})
  local V = { ctl = ctl, isint = isint, inst = inst, stratified = strat, a = {}, b = {}, r = {}, picks = {}, ignored = 0,
    deadline = math.huge, timed_out = false }
  watch(ctl, V)
  local b = ctl:backend()
  -- A1, C1
  local am1 = LIFT.atom_map(b)
  LIFT.copy(b, sa, { map = am1 })
  local cm1, cmap1 = LIFT.atom_map(b, function(a) local j = isint[a]; return j and am1(L.src[j]) end)
  LIFT.copy(b, sc, { map = cm1, isint = isint })
  if clock() > deadline then b:close(); return nil, "budget" end
  V.cm1, V.cmap1 = cm1, cmap1
  for j = 1, L.n do V.a[j] = am1(L.src[j]) end
  -- A2: the instance atoms (a space) are A1's
  local am2 = LIFT.atom_map(b, function(a) return instsrc[a] and am1(a) or nil end)
  LIFT.copy(b, sa, { map = am2, shared = instsrc })
  if clock() > deadline then b:close(); return nil, "budget" end
  for j = 1, L.n do V.b[j] = am2(L.src[j]) end
  -- removal: M' falsifies the clause that X yields
  local reasons = {}
  if o.clause then
    local sel = b:add_atom()
    if o.clauses then b:add_rule{ head = { sel }, body = {}, choice = true } else b:add_rule{ head = { sel }, body = {} } end
    reasons[#reasons + 1] = sel
    for j = 1, L.n do
      if not inst[j] and heads[L.ind[j]] then
        local r = cm1(L.ind[j])
        V.r[j] = r
        b:add_rule{ head = {}, body = { sel, r, V.a[j], -V.b[j] } }
        b:add_rule{ head = {}, body = { sel, r, -V.a[j], V.b[j] } }
      end
    end
  end
  if o.clauses then
    -- one picked group clause(Id, _, _) that X derives; M' falsifies each of its literals
    local groups, order = {}, {}
    for atom in C.ctl.symbolic_atoms:by_signature("clause", 3) do
      local args = atom.symbol.arguments
      local id, t, val = tostring(args[1]), tostring(args[2]), tostring(args[3])
      local j = L.jstr[t]
      local lit = cm1(atom.literal)
      if not j or inst[j] or (val ~= "true" and val ~= "false") then
        -- a run stops with an error on such an X: it yields no clause
        b:add_rule{ head = {}, body = { lit } }
        V.ignored = V.ignored + 1
      else
        local g = groups[id]
        if not g then g = { id = id, lits = {} }; groups[id] = g; order[#order + 1] = id end
        g.lits[#g.lits + 1] = { lit = lit, a = atom.literal, j = j, val = val == "true", text = (val == "true" and "" or "-") .. t }
      end
    end
    local all = {}
    for _, id in ipairs(order) do
      local g = groups[id]
      local present, pick = b:add_atom(), b:add_atom()
      for _, l in ipairs(g.lits) do b:add_rule{ head = { present }, body = { l.lit } } end
      b:add_rule{ head = { pick }, body = { present }, choice = true }
      for _, l in ipairs(g.lits) do
        -- M' falsifies the literal: true -> b_T false, false -> b_T true
        b:add_rule{ head = {}, body = { pick, l.lit, l.val and V.b[l.j] or -V.b[l.j] } }
      end
      V.picks[#V.picks + 1] = { atom = pick, g = g }
      all[#all + 1] = { pick, 1 }
      reasons[#reasons + 1] = pick
    end
    if #all > 1 then b:add_weight_rule{ head = {}, lower = 2, body = all } end
  end
  -- no clause/3 atom in the check: no counterexample yields a clause, nothing is removed
  if #reasons == 0 then b:close(); return { empty = true } end
  local any = b:add_atom()
  for _, s in ipairs(reasons) do b:add_rule{ head = { any }, body = { s } } end
  b:add_rule{ head = {}, body = { -any } }
  -- pruning: X's guesses must not still refute M'
  if strat then
    local viol = b:add_atom()
    local cm3 = LIFT.atom_map(b, function(a) local j = isint[a]; return j and V.b[j] end)
    LIFT.copy(b, sc, { map = cm3, isint = isint, violated = viol, guess = function(h) return cm1(h) end })
    b:add_rule{ head = {}, body = { -viol } }
  end
  if clock() > deadline then b:close(); return nil, "budget" end
  -- witness order: the fewest atoms on which M and M' differ
  if o.fewest then
    local lits = {}
    for j = 1, L.n do
      if not inst[j] then
        local d = b:add_atom()
        b:add_rule{ head = { d }, body = { V.a[j], -V.b[j] } }
        b:add_rule{ head = { d }, body = { -V.a[j], V.b[j] } }
        lits[#lits + 1] = { d, 1 }
      end
    end
    if #lits > 0 then b:add_minimize{ priority = 0, body = lits } end
  end
  b:close()
  ctl:ground({ { "base", {} } })
  if clock() > deadline then return nil, "budget" end
  return V
end

-- C_Y: a copy of C under M' with Y's guesses fixed; some constraint of it must fire.
local function refine_copy(V, L, tv)
  local b = V.ctl:backend()
  local ok, err = pcall(function()
    local viol = b:add_atom()
    local cmy = LIFT.atom_map(b, function(a) local j = V.isint[a]; return j and V.b[j] end)
    LIFT.copy(b, L.to.store, { map = cmy, isint = V.isint, violated = viol, guess = function(h) return tv[h] == true end })
    b:add_rule{ head = {}, body = { -viol } }
  end)
  b:close()
  if not ok then error(err, 0) end
end

-- block M''s interface vector (instance atoms included)
local function refine_block(V, L, bv)
  local b = V.ctl:backend()
  local body = {}
  for j = 1, L.n do body[j] = bv[j] and V.b[j] or -V.b[j] end
  b:add_rule{ head = {}, body = body }
  b:close()
end

-- X's shown atoms: C solved under M with every atom of its program as in X
local function shown_of(L, mv, xv)
  local C = L.to
  local assume = {}
  for j = 1, L.n do assume[#assume + 1] = mv[j] and L.dst[j] or -L.dst[j] end
  for a, v in pairs(xv) do assume[#assume + 1] = v and a or -a end
  local h, m, ok = solve_first(C.ctl, assume)
  local s = (ok and m) and tostring(m) or ""
  h:close()
  return s
end

function rt.bounded(o)
  o = o or {}
  local L = o.link
  if getmetatable(L) ~= rt.Link then rt.fail("bounded: no link given") end
  local A, C = L.from, L.to
  local t0 = clock()
  local st = { rounds = 0, refinements = 0, fallback = 0 }
  local kinds = rt.array({})
  for _, k in ipairs(o.kinds or {}) do kinds[#kinds + 1] = k end
  local function verdict(v, extra)
    local e = { verdict = v, mode = o.space and "space" or "symbolic", link = L.name, kinds = kinds, rounds = st.rounds,
      refinements = st.refinements, fallback = st.fallback, atoms = L.n, t = clock() - t0 }
    for k, x in pairs(extra or {}) do e[k] = x end
    rt.emit("A", e)
    BOUNDED.result = e
    return e
  end
  if o.unsupported then return verdict("unsupported", { reason = o.unsupported }) end
  if #A.inn > 0 then return verdict("unsupported", { reason = "solver " .. A.name .. " has incoming links" }) end
  if L.lifting then return verdict("unsupported", { reason = "lift link: certified per clause" }) end
  if not rt.prepared then rt.prepare() end
  if L.inst_reason then return verdict("unsupported", { reason = L.inst_reason }) end
  if not o.clause and not o.clauses then
    -- blocks and cores remove no solution by construction
    return verdict("sound", { reason = "blocks and cores are sound by construction" })
  end
  pcall(function() C.ctl.configuration.solve.opt_mode = "ignore" end)
  local seconds = o.seconds or 60
  -- the budget counts from the start; building V (Lua) checks it between its parts, grounding
  -- (clingo) cannot be interrupted
  local deadline = t0 + seconds
  local ok, V, why = pcall(build, L, o, deadline)
  if not ok then return verdict("unsupported", { reason = tostring(V) }) end
  if not V and why == "budget" then return verdict("budget", { seconds = seconds }) end
  if not V then return verdict("unsupported", { reason = why }) end
  if V.empty then return verdict("sound", { reason = "the check derives no clause/3 atom" }) end
  progress(st, true)
  local inst = V.inst
  V.deadline = deadline
  -- the check of M' (C under M''s values) is interruptible too
  watch(C.ctl, V)
  while true do
    if clock() - t0 > seconds then return verdict("budget", { seconds = seconds }) end
    st.rounds = st.rounds + 1
    -- 1. a triple (M, X, M'); with the witness order, the last model is an optimal one
    local found = nil
    local h = V.ctl:solve{ yield = true }
    local okv, errv = pcall(function()
      for m in h:iter() do
        local f = { a = {}, b = {}, r = {}, x = {}, pick = nil }
        for j = 1, L.n do f.a[j] = m:is_true(V.a[j]); f.b[j] = m:is_true(V.b[j]); f.r[j] = V.r[j] ~= nil and m:is_true(V.r[j]) end
        for a, x in pairs(V.cmap1) do f.x[a] = m:is_true(x) end
        for _, p in ipairs(V.picks) do if m:is_true(p.atom) then f.pick = p.g end end
        found = f
        if not o.fewest then break end
        if clock() - t0 > seconds then break end
      end
    end)
    h:close()
    if not okv then return verdict("unsupported", { reason = tostring(errv) }) end
    -- the propagator ended this solve at the deadline: no model means nothing here, and a model
    -- of an interrupted optimisation need not have the fewest differing atoms
    if V.stopped then rt.finish("stopped", "stopped by user", false) end
    if V.timed_out then
      st.rounds = st.rounds - 1
      progress(st, true)
      return verdict("budget", { seconds = seconds })
    end
    if not found then
      progress(st, true)
      return verdict("sound", V.ignored > 0 and { ignored = V.ignored } or nil)
    end
    -- 2. is M' a solution? (the check under M''s interface values)
    local assume = {}
    for j = 1, L.n do assume[j] = found.b[j] and L.dst[j] or -L.dst[j] end
    local hk, y, okk, errk = solve_first(C.ctl, assume)
    local tv = nil
    if okk and y then
      tv = {}
      for a = 1, C.store.maxatom do tv[a] = y:is_true(a) end
    end
    hk:close()
    if V.stopped then rt.finish("stopped", "stopped by user", false) end
    if V.timed_out then progress(st, true); return verdict("budget", { seconds = seconds }) end
    if not okk then return verdict("unsupported", { reason = tostring(errk) }) end
    if not tv then
      -- unsound: M' has no counterexample and the clause removes it
      local function atoms(v, keep)
        local t = rt.array({})
        for j = 1, L.n do if v[j] and keep(j) then t[#t + 1] = L.str[j] end end
        return t
      end
      local plain = function(j) return not inst[j] end
      local d = {}
      for j = 1, L.n do d[j] = found.a[j] ~= found.b[j] end
      local w = { kind = found.pick and "clauses" or "clause", candidate = atoms(found.a, plain),
        counterexample = shown_of(L, found.a, found.x), solution = atoms(found.b, plain), differ = atoms(d, plain) }
      if found.pick then
        w.clause = rt.array({})
        for _, l in ipairs(found.pick.lits) do if found.x[l.a] then w.clause[#w.clause + 1] = l.text end end
      else
        w.relevant = atoms(found.r, plain)
      end
      local extra = { witness = w }
      if o.space then
        local t = {}
        for j = 1, L.n do if inst[j] and found.a[j] then t[#t + 1] = L.str[j] end end
        for _, s in ipairs(L.inst_facts or {}) do t[#t + 1] = s end
        w.instance = facts_text(t)
      end
      progress(st, true)
      return verdict("unsound", extra)
    end
    -- 3. refine V
    local okr, errr = pcall(function()
      if V.stratified then refine_copy(V, L, tv)
      else refine_block(V, L, found.b); st.fallback = st.fallback + 1 end
    end)
    if not okr then return verdict("unsupported", { reason = tostring(errr) }) end
    st.refinements = st.refinements + 1
    progress(st)
  end
end

return BOUNDED
