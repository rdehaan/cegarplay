-- CegarPlay ground-program capture and refinement certificates (manual:
-- Certificates). Appended after runtime.lua when SETTINGS.certify is set.
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

LIFT.stats = { [0] = 0, [1] = 0, [2] = 0, [3] = 0, [4] = 0, none = 0, outside = 0, unsound = 0, t2 = 0, t3 = 0, t4 = 0, expansions = 0, expansions_certified = 0 }

-------------------------------------------------------------------------------
-- 1. Capture
-------------------------------------------------------------------------------
-- store: rules[r] = { choice, head = {..}, body = {..}, w = {..} or nil, lower = n or nil }
--        maxatom, disjunctive, negweight, error
local function new_store()
  return { rules = {}, maxatom = 0, disjunctive = false, negweight = false, error = nil, posocc = nil }
end

local function capture(st, choice, head, body, lower)
  local step = st.solver and st.solver.k or 0
  if step ~= st.step then st.step = step; st.before = st.before or {}; st.before[step] = st.maxatom end
  local r = { choice = choice, head = {}, body = {}, step = step }
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
  st.solver = s
  st.step = 0
  st.before = { [0] = 0 }
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
    -- an #external atom has no rule but may be set true: the evaluators would read it as
    -- false, so a program with externals gets no level-2/3 certificate
    external = function(_, atom, value)
      pcall(function() st.error = st.error or "the program has #external atoms" end)
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
LIFT.stratified = stratified

-- A rule of a store, written to backend b with its body already mapped.
local function add_mapped(b, head, body, r, choice)
  if r.w then
    local wb = {}
    for i, l in ipairs(body) do wb[i] = { l, r.w[i] } end
    b:add_weight_rule{ head = head, lower = r.lower, body = wb, choice = choice }
  else
    b:add_rule{ head = head, body = body, choice = choice }
  end
end

-- An atom map over a backend: map(a) is the copy of store atom a, made on first use (or given by
-- fixed[a], e.g. a check's interface atom identified with the abstraction's copy).
function LIFT.atom_map(b, fixed)
  local m = {}
  local function map(a)
    if fixed then local f = fixed(a); if f then return f end end
    local x = m[a]; if not x then x = b:add_atom(); m[a] = x end
    return x
  end
  return map, m
end

-- Copy the rules of store st into backend b under the atom map o.map (the symbolic
-- audit). Options:
--   isint     atom -> j for the interface atoms of a check: they are inputs. A choice drops
--             them from its heads; a normal rule with one as head becomes `:- body, not a`
--             (with map(a) the input's copy).
--   violated  constraints (and those interface-headed rules) derive this atom instead of
--             being constraints.
--   guess     function(h) for the heads of choice rules: nil -> the rule stays a choice; else
--             each head h is derived from the body when guess(h) is true (no extra literal), a
--             literal (added to the body), or skipped when it is false.
-- Disjunctive stores are not supported (callers check st.disjunctive).
--   shared    atom -> true: heads another copy already defines (lua/bounded.lua: the instance
--             atoms of a space); a rule left without heads is dropped.
function LIFT.copy(b, st, o)
  local map, isint, violated, guess, shared = o.map, o.isint or {}, o.violated, o.guess, o.shared
  local function lits(body)
    local t = {}
    for i, l in ipairs(body) do t[i] = l > 0 and map(l) or -map(-l) end
    return t
  end
  for _, r in ipairs(st.rules) do
    if shared and #r.head > 0 then
      local keep = false
      for _, h in ipairs(r.head) do if not shared[h] then keep = true end end
      if not keep then goto continue end
    end
    local body = lits(r.body)
    if #r.head == 0 then
      add_mapped(b, violated and { violated } or {}, body, r, false)
    elseif r.choice then
      local hs = {}
      for _, h in ipairs(r.head) do if not isint[h] and not (shared and shared[h]) then hs[#hs + 1] = h end end
      if #hs > 0 then
        if not guess then
          local mh = {}
          for i, h in ipairs(hs) do mh[i] = map(h) end
          add_mapped(b, mh, body, r, true)
        else
          local base = body
          if r.w then
            -- a guarded weight rule: its head needs the weight body (as one atom) and the switch
            local aux = b:add_atom()
            add_mapped(b, { aux }, body, r, false)
            base = { aux }
          end
          for _, h in ipairs(hs) do
            local g = guess(h)
            if g then
              local bb = {}
              for i, l in ipairs(base) do bb[i] = l end
              if g ~= true then bb[#bb + 1] = g end
              b:add_rule{ head = { map(h) }, body = bb }
            end
          end
        end
      end
    elseif isint[r.head[1]] then
      -- an interface atom as the head of a normal rule: the constraint `:- body, not a`
      local na = -map(r.head[1])
      local head = violated and { violated } or {}
      if r.w then
        local aux = b:add_atom()
        add_mapped(b, { aux }, body, r, false)
        b:add_rule{ head = head, body = { aux, na } }
      else
        local bb = {}
        for i, l in ipairs(body) do bb[i] = l end
        bb[#bb + 1] = na
        b:add_rule{ head = head, body = bb }
      end
    else
      local hs = {}
      for i, h in ipairs(r.head) do hs[i] = map(h) end
      add_mapped(b, hs, body, r, false)
    end
    ::continue::
  end
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
    local am, amap = LIFT.atom_map(b)
    local cm = LIFT.atom_map(b, function(a) local j = isint[a]; return j and am(L.src[j]) end)
    local sel = {}
    LIFT.copy(b, sa, { map = am })
    local violated = b:add_atom()
    LIFT.copy(b, sc, { map = cm, isint = isint, violated = violated, guess = function(h)
      local s = sel[h]
      if not s then s = b:add_atom(); sel[h] = s; b:add_rule{ head = { s }, body = {}, choice = true } end
      return s
    end })
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
-- 3b. Level 3 for rule refinements (phase S4): the rules of expansion step k
-------------------------------------------------------------------------------
-- Q_k: A's rules of steps below k; the rules of step k, with each constraint deriving `removed`;
-- C's rules as in LIFT.product. A model with removed and violated, under X's guesses, is a
-- candidate that step k removes although X is no counterexample of it. Unsatisfiable means
-- certified.
-- Step k must define new atoms only (no head that existed before the step) by stratified rules,
-- so that a candidate is removed exactly when a constraint of the step fires in its one
-- extension (choices only make the query find more escapes: conservative).
function LIFT.level3_rules(L, k, X)
  local A, C = L.from, L.to
  local sa, sc = A.store, C.store
  if not sa or not sc or sa.error or sc.error then return false, "no ground program" end
  if sa.disjunctive or sc.disjunctive then return false, "disjunctive" end
  local tv = X and X.tv
  if not tv then return false, "no truth values" end
  local isint = {}
  for j = 1, L.n do isint[L.dst[j]] = j end
  if not stratified(sc, isint) then return false, "the check is not stratified" end
  local bound = sa.before and sa.before[k] or 0
  local stepk, any = {}, false
  for _, r in ipairs(sa.rules) do
    if r.step == k then
      any = true
      for _, h in ipairs(r.head) do if h <= bound then return false, "step " .. k .. " defines an atom of an earlier step" end end
      if #r.head > 0 then stepk[#stepk + 1] = r end
    end
  end
  if not any then return true end                      -- nothing grounded: nothing removed
  if not stratified({ rules = stepk }, {}) then return false, "the rules of step " .. k .. " are not stratified" end
  local ctl = rt.new_control({}, "rules " .. L.name, {})
  local result, why = false, nil
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
    local removed, violated = b:add_atom(), b:add_atom()
    for _, r in ipairs(sa.rules) do
      if r.step < k or (r.step == k and #r.head > 0) then
        local hs = {}
        for i, h in ipairs(r.head) do hs[i] = am(h) end
        add(hs, lits(r.body, am), r, r.choice)
      elseif r.step == k then
        add({ removed }, lits(r.body, am), r, false)
      end
    end
    for _, r in ipairs(sc.rules) do
      local body = lits(r.body, cm)
      if #r.head == 0 then add({ violated }, body, r, false)
      elseif r.choice then
        for _, h in ipairs(r.head) do
          if not isint[h] then
            local s = sel[h]
            if not s then s = b:add_atom(); sel[h] = s; b:add_rule{ head = { s }, body = {}, choice = true } end
            if r.w then
              local aux = b:add_atom()
              add({ aux }, body, r, false)
              b:add_rule{ head = { cm(h) }, body = { aux, s } }
            else
              local bb = {}
              for i, l in ipairs(body) do bb[i] = l end
              bb[#bb + 1] = s
              b:add_rule{ head = { cm(h) }, body = bb }
            end
          end
        end
      elseif isint[r.head[1]] then
        local na = -am(L.src[isint[r.head[1]]])
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
    ctl:ground({ { "base", {} } })
    local assume = { removed, violated }
    for h, s in pairs(sel) do assume[#assume + 1] = tv[h] and s or -s end
    local hd = ctl:solve{ assumptions = assume, yield = true }
    local sat = false
    for _ in hd:iter() do sat = true; break end
    hd:close()
    if sat then result, why = false, "a removed candidate escapes" else result = true end
  end)
  if not ok then return false, tostring(err) end
  return result, why
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
  if CERT == "exact" and c.m then
    local t4 = clock()
    local ok4, r, atoms = pcall(LIFT.exact, L, c.m, vals, SETTINGS.exact_seconds or 2)
    LIFT.stats.t4 = (LIFT.stats.t4 or 0) + (clock() - t4)
    if ok4 and r == "none" then return 4, "certified" end
    if ok4 and r == "lost" then return nil, "unsound", "lost solution {" .. concat(atoms, ", ") .. "}" end
    if ok4 then return nil, "none", "level 4: budget of " .. (SETTINGS.exact_seconds or 2) .. " s" end
    return nil, "none", "level 4: " .. tostring(r)
  end
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
    -- every candidate fails, but the runtime adds no empty clause: keep one atom (a clause with
    -- more literals removes fewer candidates, so it stays certified)
    local j = 1
    c[1] = v[j] and -lits[j] or lits[j]
    c.j[1] = j
    co.kept = co.kept + 1
  end
  return c
end

-------------------------------------------------------------------------------
-- 6. Level 4, the exact level (phase S4): a search on scratch controls
-------------------------------------------------------------------------------
-- Is there a candidate of A's unrefined program that agrees with M on the kept atoms (vals) and
-- has no counterexample? Candidates with a counterexample are blocked, as the reference run
-- does. Returns "lost", the solution's interface atoms | "none" | "budget".
local function scratch(s)
  local ctl = rt.new_control({}, "exact " .. s.name, s.frags)
  ctl:add("base", {}, rt.join(s.frags))
  ctl:ground({ { "base", {} } })
  return ctl
end
-- The check of link L on a scratch control, with the interface atoms as free choices (the link's
-- glue, as rt.link does: glue atoms that are facts of A are facts here). Returns the control
-- and clit[j], the literal of interface atom j. Used by level 4 and by lua/bounded.lua.
function LIFT.check_scratch(L, name)
  local C2 = rt.new_control({}, (name or "exact") .. " " .. L.to.name, L.to.frags)
  local b = C2:backend()
  local clit, lines = {}, {}
  for _, sym in ipairs(L.fsym or {}) do
    b:add_rule{ head = { b:add_atom(sym) }, body = {} }
    lines[#lines + 1] = tostring(sym) .. "."
  end
  local choice = {}
  for j = 1, L.n do
    local d = b:add_atom(L.sym[j])
    b:add_rule{ head = { d }, body = {}, choice = true }
    clit[j] = d
    choice[#choice + 1] = L.str[j]
    local i = b:add_atom(clingo.Function("relevant", { L.sym[j] }, true))
    if L.compat then b:add_rule{ head = { i }, body = {}, choice = true }; choice[#choice + 1] = "relevant(" .. L.str[j] .. ")" end
  end
  b:close()
  -- the same atoms as program text (CLAUDE.md rule 10)
  if #choice > 0 then lines[#lines + 1] = "{ " .. concat(choice, "; ") .. " }." end
  C2:add("cegarplay_iface", {}, concat(lines, "\n"))
  C2:add("base", {}, rt.join(L.to.frags))
  C2:ground({ { "base", {} }, { "cegarplay_iface", {} } })
  return C2, clit
end

function LIFT.exact(L, M, vals, budget)
  budget = budget or 2
  local t0 = clock()
  local v = M[L]
  if not L.exact then
    local A2 = scratch(L.from)
    local alit = {}
    for j = 1, L.n do
      local a = A2.symbolic_atoms:lookup(L.sym[j])
      alit[j] = a and a.literal or nil
    end
    local C2, clit = LIFT.check_scratch(L, "exact")
    L.exact = { A = A2, C = C2, alit = alit, clit = clit }
  end
  local E = L.exact
  -- fresh blocks for every query: a block is added as an assumption-guarded clause
  local guard = E.A:backend()
  local g = guard:add_atom()
  guard:add_rule{ head = { g }, body = {}, choice = true }
  guard:close()
  local assume = { g }
  for j = 1, L.n do
    if vals[j] ~= nil then
      local a = E.alit[j]
      if a then assume[#assume + 1] = vals[j] and a or -a
      elseif vals[j] then return "none" end              -- an atom A cannot make true: nothing removed
    end
  end
  while true do
    if clock() - t0 > budget then return "budget" end
    local cand = nil
    local h = E.A:solve{ assumptions = assume, yield = true }
    for m in h:iter() do
      cand = {}
      for j = 1, L.n do cand[j] = E.alit[j] ~= nil and m:is_true(E.alit[j]) or false end
      break
    end
    h:close()
    if not cand then return "none" end
    local ca = {}
    for j = 1, L.n do ca[#ca + 1] = cand[j] and E.clit[j] or -E.clit[j] end
    local hc = E.C:solve{ assumptions = ca, yield = true }
    local cex = false
    for _ in hc:iter() do cex = true; break end
    hc:close()
    if not cex then
      local atoms = {}
      for j = 1, L.n do if cand[j] then atoms[#atoms + 1] = L.str[j] end end
      return "lost", atoms
    end
    -- block this candidate under the guard
    local bb = E.A:backend()
    local body = { g }
    for j = 1, L.n do local a = E.alit[j]; if a then body[#body + 1] = cand[j] and a or -a end end
    bb:add_rule{ head = {}, body = body }
    bb:close()
  end
end

-- The certificate of a clause, computed once (proof logs read it before the K event).
local function cert_of(c)
  if not c.cert then
    local ok, level, verdict, reason = pcall(LIFT.certify_clause, c)
    if not ok then level, verdict, reason = nil, "none", "error: " .. tostring(level) end
    c.cert = { level = level, verdict = verdict, reason = reason }
  end
  return c.cert
end
rt.certificate = function(c)
  local k = cert_of(c)
  return k.verdict == "certified" and k.level or nil
end

-- Hook called by the runtime for every clause that refines (reject and S.add).
rt.certify = function(s, c)
  if CERT ~= "report" and CERT ~= "exact" and not (SETTINGS.record and SETTINGS.record.proof) then return end
  local k = cert_of(c)
  local ok, level, verdict, reason = true, k.level, k.verdict, k.reason
  if not ok then level, verdict, reason = nil, "none", "error: " .. tostring(level) end
  local key = level or ((verdict == "outside" or verdict == "unsound") and verdict or "none")
  LIFT.stats[key] = (LIFT.stats[key] or 0) + 1
  rt.emit("K", { c = rt.clauses, i = rt.recorded > 0 and rt.recorded or rt.NULL, l = c.link and c.link.index or rt.NULL,
    level = level or rt.NULL, verdict = verdict, reason = reason or rt.NULL })
end

-- Hook called by Solver:expand: certify the rules of expansion step k (level 3), X the
-- counterexample whose atoms were the facts (nil when unknown).
rt.certify_expand = function(s, k, X)
  if CERT ~= "report" and CERT ~= "exact" then return end
  local level, verdict, reason = nil, "none", nil
  local L
  if X then for _, l in ipairs(s.out) do if l.to == X.solver then L = l end end end
  if not L then reason = "the facts do not come from a counterexample of a check of " .. s.name
  else
    local t0 = clock()
    local ok, r, why = pcall(LIFT.level3_rules, L, k, X)
    LIFT.stats.t3 = LIFT.stats.t3 + (clock() - t0)
    if ok and r then level, verdict = 3, "certified" else reason = ok and why or tostring(r) end
  end
  local key = level or "none"
  LIFT.stats[key] = (LIFT.stats[key] or 0) + 1
  LIFT.stats.expansions = (LIFT.stats.expansions or 0) + 1
  if level then LIFT.stats.expansions_certified = (LIFT.stats.expansions_certified or 0) + 1 end
  rt.emit("K", { e = k, solver = s.name, c = rt.NULL, i = rt.recorded > 0 and rt.recorded or rt.NULL, l = L and L.index or rt.NULL,
    level = level or rt.NULL, verdict = verdict, reason = reason or rt.NULL })
end

-- The certificate counts in the S event (only with SETTINGS.certify).
rt.stats_extra = function(e)
  local s = LIFT.stats
  if CERT then
    e.certificates = { l0 = s[0], l1 = s[1], l2 = s[2], l3 = s[3], l4 = s[4], none = s.none, outside = s.outside, unsound = s.unsound, t2 = s.t2, t3 = s.t3, t4 = s.t4,
      expansions = s.expansions, expansions_certified = s.expansions_certified }
  end
  local co = LIFT.coach
  if co.clauses > 0 or co.fallbacks > 0 then
    local preds = {}
    for name, p in pairs(co.preds) do preds[name] = { hand = p.hand, kept = p.kept } end
    e.lift = { clauses = co.clauses, fallbacks = co.fallbacks, uncertified = co.uncertified, kept = co.kept, hand = co.hand, preds = preds }
  end
end

return LIFT
