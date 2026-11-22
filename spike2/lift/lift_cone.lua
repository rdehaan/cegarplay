-- Lifting prototype: refinements computed from the ground program of the check, without relevant/1.
-- The solver and link declarations are filled in by lift.py. Runs as a raw Lua CegarPlay project.
local clingo = require("clingo")
local A = rt.solver("A", {%(fa)s}, {%(oa)s})
local C = rt.solver("C", {%(fc)s}, {%(oc)s})

-- 1. Capture the ground program of C with an observer (registered before anything is added to C).
local rules, maxatom, disjunctive, obs_error = {}, 0, false, nil
local function see(l) local a = math.abs(l); if a > maxatom then maxatom = a end end
local function capture(choice, head, body, lower)
  local r = { choice = choice, head = {}, body = {}, lower = lower }
  for i, a in ipairs(head) do r.head[i] = a; see(a) end
  if lower then
    r.w = {}
    for i, e in ipairs(body) do r.body[i] = e[1]; r.w[i] = e[2]; see(e[1]) end
  else
    for i, l in ipairs(body) do r.body[i] = l; see(l) end
  end
  if not choice and #head > 1 then disjunctive = true end
  rules[#rules + 1] = r
end
C.ctl:register_observer({
  rule = function(self, choice, head, body)
    local ok, e = pcall(capture, choice, head, body, nil); if not ok then obs_error = e end
  end,
  weight_rule = function(self, choice, head, lower, body)
    local ok, e = pcall(capture, choice, head, body, lower); if not ok then obs_error = e end
  end })
local G = rt.link("G", A, C, {%(fg)s}, {%(lo)s})
rt.prepare()
if obs_error then rt.fail("observer: " .. tostring(obs_error)) end

local occ = {}                                   -- atom -> rules with the atom in the body
local nweight = 0
for i, r in ipairs(rules) do
  if r.w then nweight = nweight + 1 end
  for _, l in ipairs(r.body) do local a = math.abs(l); occ[a] = occ[a] or {}; occ[a][#occ[a] + 1] = i end
end
rt.log("GROUND", #rules, nweight, maxatom, tostring(disjunctive))

-- 2. One counterexample with the truth value of every atom of the ground program.
local function solveC(assume)
  local h = C.ctl:solve{ assumptions = assume, yield = true }
  local tv
  local ok, err = pcall(function()
    for m in h:iter() do
      tv = {}
      for a = 1, maxatom do tv[a] = m:is_true(a) end
      break
    end
  end)
  h:close()
  if not ok then error(err, 0) end
  return tv
end

-- 3. The certificate. U: set of interface atoms whose value is unknown. tv: the counterexample.
-- D over-approximates the atoms whose value may change. A rule is blocked when its body is false
-- because of a literal outside D (for a weight body: when the bound is out of reach even if every
-- literal on a D atom were true). D shrinks until it is stable.
local function certified(U, tv)
  local D = nil
  local function blocked(r)
    if D == nil then return false end
    if r.w then
      local s = 0
      for i, l in ipairs(r.body) do
        local a = math.abs(l)
        if D[a] or (l > 0) == tv[a] then s = s + r.w[i] end
      end
      return s < r.lower
    end
    for _, l in ipairs(r.body) do
      local a = math.abs(l)
      if not D[a] and (l > 0) ~= tv[a] then return true end
    end
    return false
  end
  while true do
    local nD, stack, size = {}, {}, 0
    for a in pairs(U) do nD[a] = true; stack[#stack + 1] = a; size = size + 1 end
    while #stack > 0 do
      local a = stack[#stack]; stack[#stack] = nil
      for _, i in ipairs(occ[a] or {}) do
        local r = rules[i]
        if #r.head > 0 and not blocked(r) then
          for _, h in ipairs(r.head) do
            if not nD[h] then nD[h] = true; stack[#stack + 1] = h; size = size + 1 end
          end
        end
      end
    end
    local old = 0
    if D then for _ in pairs(D) do old = old + 1 end end
    local stable = D ~= nil and old == size
    D = nD
    if stable then break end
  end
  -- (a) every constraint that reads a D atom must be blocked
  local edges, neg = {}, {}                       -- residual dependency graph on D
  for _, r in ipairs(rules) do
    local touches = false
    for _, l in ipairs(r.body) do if D[math.abs(l)] then touches = true; break end end
    if touches and not blocked(r) then
      if #r.head == 0 then return false, "constraint" end
      for _, h in ipairs(r.head) do
        for _, l in ipairs(r.body) do
          local b = math.abs(l)
          if D[b] then
            edges[b] = edges[b] or {}; edges[b][#edges[b] + 1] = h
            if l < 0 then neg[#neg + 1] = { b, h } end
          end
        end
      end
    end
  end
  -- (b) the rules that define the D atoms must be stratified: no negative edge on a cycle
  for _, e in ipairs(neg) do
    local from, to = e[2], e[1]                   -- is there a path from the head back to the body atom?
    local seen, stack = { [from] = true }, { from }
    while #stack > 0 do
      local a = stack[#stack]; stack[#stack] = nil
      if a == to then return false, "negation" end
      for _, b in ipairs(edges[a] or {}) do if not seen[b] then seen[b] = true; stack[#stack + 1] = b end end
    end
  end
  return true
end

-- 4. Lifting: drop interface atoms one at a time while the certificate holds.
local function lift(tv)
  local U = {}
  for j = 1, G.n do
    local a = G.dst[j]
    U[a] = true
    if not certified(U, tv) then U[a] = nil end
  end
  local R = {}
  for j = 1, G.n do if not U[G.dst[j]] then R[#R + 1] = j end end
  return R
end

local n, lifted, hand, hand_ok, hand_bad, t_lift = 0, 0, 0, 0, 0, 0
while true do
  local M = A:solve{}
  if not M then break end
  local tv = solveC(G:of(M))
  if not tv then
    rt.accept(M)
    A:add(G:block(M))
  else
    n = n + 1
    -- the hand-written set: is it certified?
    local Uh, nh = {}, 0
    for j = 1, G.n do if tv[G.ind[j]] then nh = nh + 1 else Uh[G.dst[j]] = true end end
    hand = hand + nh
    local R
    if disjunctive then
      R = {}
      for j = 1, G.n do R[j] = j end
    else
      if certified(Uh, tv) then hand_ok = hand_ok + 1 else hand_bad = hand_bad + 1 end
      local t0 = os.clock(); R = lift(tv); t_lift = t_lift + os.clock() - t0
    end
    lifted = lifted + #R
    if #R == 0 then rt.log("EMPTY"); break end
    local v, c = M[G], {}
    for k, j in ipairs(R) do c[k] = v[j] and -G.src[j] or G.src[j] end
    A:add(c)
  end
end
rt.log("LIFT", n, lifted, hand, hand_ok, hand_bad, string.format("%%.3f", t_lift))
