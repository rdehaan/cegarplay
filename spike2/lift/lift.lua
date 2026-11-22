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
-- The program is read with the guesses of the counterexample fixed: a choice atom that is true keeps
-- its choice rule as a normal rule, a choice atom that is false loses it. Its well-founded model is
-- computed with the atoms of U undefined. K: atoms that are true whatever U is. PT: atoms that may be
-- true. The refinement is certified when (a) no constraint body can become true and (b) the rules
-- that define the undecided atoms (PT without K) are stratified.
local isint = {}
for j = 1, G.n do isint[G.dst[j]] = true end
local function prepare(tv)
  local NR = {}
  for _, r in ipairs(rules) do
    if #r.head == 0 then NR[#NR + 1] = { head = 0, body = r.body, w = r.w, lower = r.lower }
    else
      for _, h in ipairs(r.head) do
        if not isint[h] and (not r.choice or tv[h]) then
          NR[#NR + 1] = { head = h, body = r.body, w = r.w, lower = r.lower }
        end
      end
    end
  end
  return NR
end
local function holds(r, pos, negref)               -- positive literals in pos, negated atoms not in negref
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
local function least(NR, base, negref)             -- least model of the reduct with respect to negref
  local L, n = {}, 0
  for a in pairs(base) do L[a] = true; n = n + 1 end
  local changed = true
  while changed do
    changed = false
    for _, r in ipairs(NR) do
      local h = r.head
      if h ~= 0 and not L[h] and holds(r, L, negref) then L[h] = true; n = n + 1; changed = true end
    end
  end
  return L, n
end
local function certified(U, tv, NR)
  local inK, inPT = {}, {}
  for j = 1, G.n do
    local a = G.dst[j]
    if U[a] then inPT[a] = true elseif tv[a] then inK[a] = true; inPT[a] = true end
  end
  local K, nK = {}, 0
  for a in pairs(inK) do K[a] = true end
  local PT, nPT = least(NR, inPT, K)
  while true do                                     -- alternating fixpoint: K grows, PT shrinks
    local K2, nK2 = least(NR, inK, PT)
    local PT2, nPT2 = least(NR, inPT, K2)
    local same = nK2 == nK and nPT2 == nPT
    K, nK, PT, nPT = K2, nK2, PT2, nPT2
    if same then break end
  end
  local edges, neg = {}, {}
  for _, r in ipairs(NR) do
    local h = r.head
    if h == 0 then
      if holds(r, PT, K) then return false, "constraint" end       -- (a)
    elseif PT[h] and not K[h] and holds(r, PT, K) then
      for _, l in ipairs(r.body) do
        local b = math.abs(l)
        if PT[b] and not K[b] then
          edges[b] = edges[b] or {}; edges[b][#edges[b] + 1] = h
          if l < 0 then neg[#neg + 1] = { b, h } end
        end
      end
    end
  end
  for _, e in ipairs(neg) do                        -- (b): no negative edge on a cycle
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

-- 4. Lifting: drop interface atoms one at a time while the certificate holds.
local fallback = 0
local function lift(tv, NR)
  local U = {}
  if not certified(U, tv, NR) then                  -- the counterexample itself is not reproduced: block
    fallback = fallback + 1
    local R = {}
    for j = 1, G.n do R[j] = j end
    return R
  end
  for j = 1, G.n do
    local a = G.dst[j]
    U[a] = true
    if not certified(U, tv, NR) then U[a] = nil end
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
      local NR = prepare(tv)
      if certified(Uh, tv, NR) then hand_ok = hand_ok + 1 else hand_bad = hand_bad + 1 end
      local t0 = os.clock(); R = lift(tv, NR); t_lift = t_lift + os.clock() - t0
    end
    lifted = lifted + #R
    if #R == 0 then rt.log("EMPTY"); break end
    local v, c = M[G], {}
    for k, j in ipairs(R) do c[k] = v[j] and -G.src[j] or G.src[j] end
    A:add(c)
  end
end
rt.log("LIFT", n, lifted, hand, hand_ok, hand_bad, string.format("%%.3f", t_lift), fallback)
