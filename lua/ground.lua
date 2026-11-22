-- CegarPlay ground-program capture and refinement certificates (docs/spec-soundness.md
-- sections 2 and 3). Appended after runtime.lua when SETTINGS.certify is set.
--
--   level 0  a block (G.block): only the candidate is removed, by construction
--   level 1  an unsat core (G.core): the assumptions in the core suffice
--   level 2  three-valued (well-founded) evaluation of the check's ground program with the
--            counterexample's guesses fixed
--   level 3  one unsatisfiable solver call on a ground product of abstraction and check
--
-- Every observer callback runs inside pcall; nothing here may raise inside a clingo frame.
local clingo = require("clingo")
local LIFT = {}
rt.LIFT = LIFT
local abs, clock, concat = math.abs, os.clock, table.concat
local CERT = SETTINGS.certify

LIFT.stats = { [0] = 0, [1] = 0, [2] = 0, [3] = 0, none = 0, outside = 0, t2 = 0, t3 = 0 }

-------------------------------------------------------------------------------
-- 1. Capture
-------------------------------------------------------------------------------
-- store: rules[r] = { choice, head = {..}, body = {..}, w = {..} or nil, lower = n or nil }
--        maxatom, disjunctive, negweight, error
local function new_store()
  return { rules = {}, maxatom = 0, disjunctive = false, negweight = false, error = nil, posocc = nil }
end

local function capture(st, choice, head, body, lower)
  local r = { choice = choice, head = {}, body = {} }
  local m = st.maxatom
  for i, a in ipairs(head) do r.head[i] = a; if a > m then m = a end end
  if lower then
    r.w, r.lower = {}, lower
    for i, e in ipairs(body) do
      local l, w = e[1], e[2]
      r.body[i] = l; r.w[i] = w
      if w < 0 then st.negweight = true end
      local a = abs(l); if a > m then m = a end
    end
  else
    for i, l in ipairs(body) do r.body[i] = l; local a = abs(l); if a > m then m = a end end
  end
  st.maxatom = m
  if not choice and #head > 1 then st.disjunctive = true end
  st.rules[#st.rules + 1] = r
  st.posocc = nil
  st.version = (st.version or 0) + 1
end

function LIFT.capture(s)
  if s.store then return s.store end
  local st = new_store()
  s.store = st
  s.ctl:register_observer({
    rule = function(_, choice, head, body)
      local ok, e = pcall(capture, st, choice, head, body, nil)
      if not ok and not st.error then st.error = tostring(e) end
    end,
    weight_rule = function(_, choice, head, lower, body)
      local ok, e = pcall(capture, st, choice, head, body, lower)
      if not ok and not st.error then st.error = tostring(e) end
    end,
  })
  -- the truth of every store atom in a model of this solver (snapshot calls it)
  s.truth = function(m)
    local tv = {}
    for a = 1, st.maxatom do tv[a] = m:is_true(a) end
    return tv
  end
  return st
end

-- every solver captures its ground program from the start (hook called by rt.solver)
rt.on_solver = function(s) LIFT.capture(s) end

-- positive body occurrences: atom -> list of rule indices
local function posocc(st)
  if st.posocc then return st.posocc end
  local occ = {}
  for ri, r in ipairs(st.rules) do
    for _, l in ipairs(r.body) do
      if l > 0 then local o = occ[l]; if not o then o = {}; occ[l] = o end; o[#o + 1] = ri end
    end
  end
  st.posocc = occ
  return occ
end

-------------------------------------------------------------------------------
-- 2. Level 2: the well-founded model of P[X] with the atoms outside R undefined
-------------------------------------------------------------------------------
-- The heads each rule has in P[X]: a choice rule keeps a head atom that is true in X (as a normal
-- rule) and loses it otherwise; the link's interface atoms are inputs, never heads.
-- A normal rule whose head is an interface atom (`a :- g.` with `a` an input) derives nothing in
-- the check; it acts as the constraint `:- body, not a`: H[ri] = { guard = { a } } (no heads).
local function heads_for(st, tv, isint)
  local H = {}
  for ri, r in ipairs(st.rules) do
    if #r.head == 0 then H[ri] = false            -- a constraint
    elseif not r.choice and isint[r.head[1]] then
      local g = {}
      for _, h in ipairs(r.head) do if isint[h] then g[#g + 1] = h end end
      H[ri] = { guard = g }
    else
      local hs = {}
      for _, h in ipairs(r.head) do
        if not isint[h] and (not r.choice or tv[h]) then hs[#hs + 1] = h end
      end
      H[ri] = hs
    end
  end
  return H
end

-- Least model of the reduct of P[X] with respect to negref (a set of atoms taken as true for the
-- negative literals), starting from base. Counters per rule: linear in the size of the program.
local function least(st, H, base, negref)
  local rules, occ = st.rules, posocc(st)
  local L, n, queue, qn = {}, 0, {}, 0
  local function derive(a)
    if not L[a] then L[a] = true; n = n + 1; qn = qn + 1; queue[qn] = a end
  end
  local cnt, sum, dead = {}, {}, {}
  for a in pairs(base) do derive(a) end
  for ri, r in ipairs(rules) do
    local hs = H[ri]
    if hs and #hs > 0 then
      if r.w then
        local s0 = 0
        for i, l in ipairs(r.body) do if l < 0 and not negref[-l] then s0 = s0 + r.w[i] end end
        sum[ri] = s0
        if s0 >= r.lower then for _, h in ipairs(hs) do derive(h) end; dead[ri] = true end
      else
        local c, blocked = 0, false
        for _, l in ipairs(r.body) do
          if l > 0 then c = c + 1 elseif negref[-l] then blocked = true; break end
        end
        if blocked then dead[ri] = true
        else
          cnt[ri] = c
          if c == 0 then for _, h in ipairs(hs) do derive(h) end; dead[ri] = true end
        end
      end
    else dead[ri] = true end
  end
  local qi = 0
  while qi < qn do
    qi = qi + 1
    local a = queue[qi]
    local o = occ[a]
    if o then
      for _, ri in ipairs(o) do
        if not dead[ri] then
          local r = rules[ri]
          if r.w then
            local s1 = sum[ri]
            for i, l in ipairs(r.body) do if l == a then s1 = s1 + r.w[i] end end
            sum[ri] = s1
            if s1 >= r.lower then dead[ri] = true; for _, h in ipairs(H[ri]) do derive(h) end end
          else
            local c = cnt[ri] - 1
            cnt[ri] = c
            if c == 0 then dead[ri] = true; for _, h in ipairs(H[ri]) do derive(h) end end
          end
        end
      end
    end
  end
  return L, n
end

local function holds(r, pos, negref)
  if r.w then
    local s = 0
    for i, l in ipairs(r.body) do
      if l > 0 then if pos[l] then s = s + r.w[i] end elseif not negref[-l] then s = s + r.w[i] end
    end
    return s >= r.lower
  end
  for _, l in ipairs(r.body) do
    if l > 0 then if not pos[l] then return false end elseif negref[-l] then return false end
  end
  return true
end

-- The certificate. vals[j] = true/false for the kept atoms of link L, nil for the dropped ones.
-- Returns true, or false and a reason.
function LIFT.level2(L, X, vals)
  local st = L.to.store
  if not st or st.error then return false, "no ground program" end
  if st.disjunctive then return false, "disjunctive" end
  if st.negweight then return false, "negative weights" end
  local tv = X.tv
  if not tv then return false, "no truth values" end
  local isint = L.isint
  if not isint then
    isint = {}
    for j = 1, L.n do isint[L.dst[j]] = true end
    L.isint = isint
  end
  -- the heads depend on the counterexample and the link only: kept with the counterexample
  local hk = X.heads
  if not hk then hk = {}; X.heads = hk end
  local H = hk[L]
  if not H or hk[L.name] ~= st.version then H = heads_for(st, tv, isint); hk[L] = H; hk[L.name] = st.version end
  local inK, inPT = {}, {}
  for j = 1, L.n do
    local a, v = L.dst[j], vals[j]
    if v == nil then inPT[a] = true
    elseif v then inK[a] = true; inPT[a] = true end
  end
  local K, nK = {}, 0
  for a in pairs(inK) do K[a] = true; nK = nK + 1 end
  local PT, nPT = least(st, H, inPT, K)
  while true do                         -- alternating fixpoint: K grows, PT shrinks
    local K2, nK2 = least(st, H, inK, PT)
    local PT2, nPT2 = least(st, H, inPT, K2)
    local same = nK2 == nK and nPT2 == nPT
    K, nK, PT, nPT = K2, nK2, PT2, nPT2
    if same then break end
  end
  local edges, neg = {}, {}
  for ri, r in ipairs(st.rules) do
    local hs = H[ri]
    if hs == false then
      if holds(r, PT, K) then return false, "constraint" end             -- (a)
    elseif hs.guard then
      -- `:- body, not a` for an interface head a: fine only when a is certainly true
      local safe = false
      for _, a in ipairs(hs.guard) do if K[a] then safe = true end end
      if not safe and holds(r, PT, K) then return false, "an interface atom as a rule head" end
    elseif #hs > 0 and holds(r, PT, K) then
      for _, h in ipairs(hs) do
        if PT[h] and not K[h] then
          for _, l in ipairs(r.body) do
            local b = abs(l)
            if PT[b] and not K[b] then
              local e = edges[b]; if not e then e = {}; edges[b] = e end
              e[#e + 1] = h
              if l < 0 then neg[#neg + 1] = { b, h } end
            end
          end
        end
      end
    end
  end
  for _, e in ipairs(neg) do                                             -- (b)
    local from, to = e[2], e[1]
    local seen, stack = { [from] = true }, { from }
    while #stack > 0 do
      local a = stack[#stack]; stack[#stack] = nil
      if a == to then return false, "negation" end
      for _, b in ipairs(edges[a] or {}) do if not seen[b] then seen[b] = true; stack[#stack + 1] = b end end
    end
  end
  return true
end

-------------------------------------------------------------------------------
-- 3. Level 3: one product of abstraction and check per link
-------------------------------------------------------------------------------
-- Whether a store's rules (choices as positive rules) have a negative edge on a cycle.
local function stratified(st, skip)
  local edges, neg = {}, {}
  for _, r in ipairs(st.rules) do
    for _, h in ipairs(r.head) do
      if not skip[h] then
        for _, l in ipairs(r.body) do
          local b = abs(l)
          local e = edges[b]; if not e then e = {}; edges[b] = e end
          e[#e + 1] = h
          if l < 0 then neg[#neg + 1] = { b, h } end
        end
      end
    end
  end
  for _, e in ipairs(neg) do
    local from, to = e[2], e[1]
    local seen, stack = { [from] = true }, { from }
    while #stack > 0 do
      local a = stack[#stack]; stack[#stack] = nil
      if a == to then return false end
      for _, b in ipairs(edges[a] or {}) do if not seen[b] then seen[b] = true; stack[#stack + 1] = b end end
    end
  end
  return true
end

-- Build Q: A's rules, C's rules with C's interface atoms (of link L) identified with A's, each
-- guess of C switched by a sel atom, and each constraint of C deriving `violated`.
function LIFT.product(L)
  local A, C = L.from, L.to
  local sa, sc = A.store, C.store
  -- rebuilt when either program grew (an expansion) since the last build
  local key = tostring(sa and sa.version) .. ":" .. tostring(sc and sc.version)
  if L.product ~= nil and L.product_key == key then return L.product end
  L.product_key = key
  L.product = false
  if not sa or not sc or sa.error or sc.error then L.product_reason = "no ground program"; return false end
  if sc.disjunctive or sa.disjunctive then L.product_reason = "disjunctive"; return false end
  local isint = {}
  for j = 1, L.n do isint[L.dst[j]] = j end
  if not stratified(sc, isint) then L.product_reason = "the check is not stratified"; return false end
  local ctl = rt.new_control({}, "product " .. L.name, {})
  local ok, err = pcall(function()
    local b = ctl:backend()
    local amap, cmap, sel = {}, {}, {}
    local function am(a) local x = amap[a]; if not x then x = b:add_atom(); amap[a] = x end; return x end
    local function cm(a)
      local j = isint[a]
      if j then return am(L.src[j]) end
      local x = cmap[a]; if not x then x = b:add_atom(); cmap[a] = x end; return x
    end
    local function lits(body, map)
      local t = {}
      for i, l in ipairs(body) do t[i] = l > 0 and map(l) or -map(-l) end
      return t
    end
    local function add(head, body, r, choice)
      if r.w then
        local wb = {}
        for i, l in ipairs(body) do wb[i] = { l, r.w[i] } end
        b:add_weight_rule{ head = head, lower = r.lower, body = wb, choice = choice }
      else
        b:add_rule{ head = head, body = body, choice = choice }
      end
    end
    for _, r in ipairs(sa.rules) do
      local hs = {}
      for i, h in ipairs(r.head) do hs[i] = am(h) end
      add(hs, lits(r.body, am), r, r.choice)
    end
    local violated = b:add_atom()
    for _, r in ipairs(sc.rules) do
      local body = lits(r.body, cm)
      if #r.head == 0 then
        add({ violated }, body, r, false)
      elseif r.choice then
        for _, h in ipairs(r.head) do
          if not isint[h] then
            local s = sel[h]
            if not s then s = b:add_atom(); sel[h] = s; b:add_rule{ head = { s }, body = {}, choice = true } end
            local bb = {}
            for i, l in ipairs(body) do bb[i] = l end
            if r.w then
              -- a guarded weight rule: its head needs the weight body and the switch
              local aux = b:add_atom()
              add({ aux }, body, r, false)
              b:add_rule{ head = { cm(h) }, body = { aux, s } }
            else
              bb[#bb + 1] = s
              b:add_rule{ head = { cm(h) }, body = bb }
            end
          end
        end
      elseif isint[r.head[1]] then
        -- an interface atom as the head of a normal rule: the constraint `:- body, not a`
        local j = isint[r.head[1]]
        local na = -am(L.src[j])
        if r.w then
          local aux = b:add_atom()
          add({ aux }, body, r, false)
          b:add_rule{ head = { violated }, body = { aux, na } }
        else
          local bb = {}
          for i, l in ipairs(body) do bb[i] = l end
          bb[#bb + 1] = na
          b:add_rule{ head = { violated }, body = bb }
        end
      else
        local hs = {}
        for i, h in ipairs(r.head) do hs[i] = cm(h) end
        add(hs, body, r, false)
      end
    end
    b:close()
    L.product = { ctl = ctl, amap = amap, sel = sel, violated = violated }
  end)
  if not ok then L.product = false; L.product_reason = tostring(err); return false end
  ctl:ground({ { "base", {} } })
  return L.product
end

-- Unsatisfiable means certified: no candidate of A that agrees with vals escapes X's guesses.
function LIFT.level3(L, X, vals)
  local Q = LIFT.product(L)
  if not Q then return false, L.product_reason or "no product" end
  local tv = X.tv
  if not tv then return false, "no truth values" end
  local assume = { Q.violated }
  for j = 1, L.n do
    local v = vals[j]
    if v ~= nil then
      local a = Q.amap[L.src[j]]
      if a then assume[#assume + 1] = v and a or -a
      elseif v then return false, "an interface atom is not in the abstraction's program" end
    end
  end
  for h, s in pairs(Q.sel) do assume[#assume + 1] = tv[h] and s or -s end
  local h = Q.ctl:solve{ assumptions = assume, yield = true }
  local sat = false
  local ok, err = pcall(function() for _ in h:iter() do sat = true; break end end)
  h:close()
  if not ok then return false, tostring(err) end
  if sat then return false, "a candidate escapes" end
  return true
end

-------------------------------------------------------------------------------
-- 4. Certifying one refinement
-------------------------------------------------------------------------------
-- The values a clause fixes: the removed candidates falsify every literal, so atom j has the
-- opposite of its literal's sign.
local function clause_vals(c)
  local L = c.link
  local lits = c.lazy and L.slit or L.src
  local vals = {}
  for k = 1, #c do
    local j = c.j[k]
    if j then vals[j] = not (c[k] == lits[j]) end
  end
  return vals
end
LIFT.clause_vals = clause_vals

-- Returns level, verdict, reason.
function LIFT.certify_clause(c)
  local L = c.link
  if not L then return nil, "none", "not a clause of a link" end
  if c.x == nil then
    if c.m ~= nil and #c == L.n then return 0, "certified" end            -- a block
    if c.m == nil then return 1, "certified" end                          -- a core
    return nil, "none", "no counterexample"
  end
  local vals = clause_vals(c)
  local t0 = clock()
  local ok, why = LIFT.level2(L, c.x, vals)
  LIFT.stats.t2 = LIFT.stats.t2 + (clock() - t0)
  if ok then return 2, "certified" end
  local t1 = clock()
  local ok3, why3 = LIFT.level3(L, c.x, vals)
  LIFT.stats.t3 = LIFT.stats.t3 + (clock() - t1)
  if ok3 then return 3, "certified" end
  if not L.product and L.product_reason then return nil, "outside", why .. "; " .. L.product_reason end
  return nil, "none", why .. "; " .. tostring(why3)
end

-------------------------------------------------------------------------------
-- 5. Lifting (phase S3): a clause computed from the ground programs
-------------------------------------------------------------------------------
-- certified(L, X, vals) -> level (2 or 3) or nil
local function certified(L, X, vals)
  local t0 = clock()
  local ok = LIFT.level2(L, X, vals)
  LIFT.stats.t2 = LIFT.stats.t2 + (clock() - t0)
  if ok then return 2 end
  local t1 = clock()
  local ok3 = LIFT.level3(L, X, vals)
  LIFT.stats.t3 = LIFT.stats.t3 + (clock() - t1)
  if ok3 then return 3 end
  return nil
end
LIFT.certified = certified

-- coach data: per interface predicate, atoms marked by relevant/1, atoms kept by lifting
LIFT.coach = { clauses = 0, fallbacks = 0, uncertified = 0, kept = 0, hand = 0, preds = {} }
local function pred_of(L, j)
  local p = L.pred and L.pred[j]
  if p then return p end
  L.pred = L.pred or {}
  local sym = L.sym[j]
  local ok, name = pcall(function() return sym.name .. "/" .. #sym.arguments end)
  p = ok and name or "?"
  L.pred[j] = p
  return p
end
local function coach_pred(name)
  local c = LIFT.coach.preds[name]
  if not c then c = { hand = 0, kept = 0 }; LIFT.coach.preds[name] = c end
  return c
end

local function lift(L, M, X)
  local v = M[L]
  local r = X[L]
  local co = LIFT.coach
  L.blame = L.blame or {}
  local blame = L.blame
  -- the start set: the relevant/1 atoms when they are certified, else the whole interface
  local hand, nh = {}, 0
  for j = 1, L.n do if r[j] then hand[j] = v[j]; nh = nh + 1 end end
  for j = 1, L.n do if r[j] then local c = coach_pred(pred_of(L, j)); c.hand = c.hand + 1 end end
  co.hand = co.hand + nh
  local vals, level = nil, nil
  if nh > 0 then
    level = certified(L, X, hand)
    if level then vals = hand else co.uncertified = co.uncertified + 1 end
  end
  if not vals then
    local full = {}
    for j = 1, L.n do full[j] = v[j] end
    level = certified(L, X, full)
    if not level then return nil end
    vals = full
  end
  -- deletion, atoms in order of rising blame count
  local order = {}
  for j in pairs(vals) do order[#order + 1] = j end
  table.sort(order, function(a, b)
    local ba, bb = blame[a] or 0, blame[b] or 0
    if ba ~= bb then return ba < bb end
    return a < b
  end)
  -- try to drop a group at once; on failure split it (a single atom that cannot go is kept
  -- and blamed). Every accepted drop is certified on the set as it is at that moment.
  local function drop(lo, hi)
    if lo > hi then return end
    local saved = {}
    for i = lo, hi do local j = order[i]; saved[i] = vals[j]; vals[j] = nil end
    local lv = certified(L, X, vals)
    if lv then
      if lv > level then level = lv end
      return
    end
    for i = lo, hi do vals[order[i]] = saved[i] end
    if lo == hi then
      local j = order[lo]
      blame[j] = (blame[j] or 0) + 1
      return
    end
    local mid = (lo + hi) // 2
    drop(lo, mid)
    drop(mid + 1, hi)
  end
  drop(1, #order)
  return vals, level
end

-- G.clause(M, X) on a lift link, and G.lift(M, X).
function LIFT.lift(L, M, X)
  local ok, vals, level = pcall(lift, L, M, X)
  if not ok then vals, level = nil, nil end
  local co = LIFT.coach
  if not vals then
    co.fallbacks = co.fallbacks + 1
    rt.count("lift fallbacks")
    local c = L:block(M)
    c.x = nil
    if CERT ~= "report" then
      LIFT.stats[0] = LIFT.stats[0] + 1
      rt.emit("K", { c = rt.clauses + 1, i = rt.NULL, l = L.index, level = 0, verdict = "certified",
        reason = ok and "lift fallback: the counterexample is not certified" or ("lift fallback: " .. tostring(vals)) })
    end
    return c
  end
  local lits = M.lazy and L.slit or L.src
  local c = rt.new_clause(L, M.lazy, M, X)
  local v = M[L]
  for j = 1, L.n do
    if vals[j] ~= nil then
      local k = #c + 1
      c[k] = v[j] and -lits[j] or lits[j]
      c.j[k] = j
      local cp = coach_pred(pred_of(L, j)); cp.kept = cp.kept + 1
    end
  end
  co.clauses = co.clauses + 1
  co.kept = co.kept + #c
  c.lifted = level
  if #c == 0 then
    -- every candidate fails: the empty clause (the abstraction becomes unsatisfiable)
    c.empty = true
  end
  return c
end

-- Hook called by the runtime for every clause that refines (reject and S.add).
rt.certify = function(s, c)
  if CERT ~= "report" then return end
  local ok, level, verdict, reason = pcall(LIFT.certify_clause, c)
  if not ok then level, verdict, reason = nil, "none", "error: " .. tostring(level) end
  local key = level or (verdict == "outside" and "outside" or "none")
  LIFT.stats[key] = (LIFT.stats[key] or 0) + 1
  rt.emit("K", { c = rt.clauses, i = rt.recorded > 0 and rt.recorded or rt.NULL, l = c.link and c.link.index or rt.NULL,
    level = level or rt.NULL, verdict = verdict, reason = reason or rt.NULL })
end

-- The certificate counts in the S event (only with SETTINGS.certify).
rt.stats_extra = function(e)
  local s = LIFT.stats
  if CERT then
    e.certificates = { l0 = s[0], l1 = s[1], l2 = s[2], l3 = s[3], none = s.none, outside = s.outside, t2 = s.t2, t3 = s.t3 }
  end
  local co = LIFT.coach
  if co.clauses > 0 or co.fallbacks > 0 then
    local preds = {}
    for name, p in pairs(co.preds) do preds[name] = { hand = p.hand, kept = p.kept } end
    e.lift = { clauses = co.clauses, fallbacks = co.fallbacks, uncertified = co.uncertified, kept = co.kept, hand = co.hand, preds = preds }
  end
end

return LIFT
