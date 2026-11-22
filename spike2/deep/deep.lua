-- The recursive loop for any number of quantifier blocks, in raw Lua on the CegarPlay runtime.
-- Clauses travel as sets of signed atom names (addition G1) and are translated when added.
local depth = DEPTH
local S, G = {}, {}
for i = 1, depth do
  FRAGMENTS["level" .. i] = FRAGMENTS["level"]:gsub("this_level", tostring(i))
  local frags = { "shared", "level" .. i }
  if i == depth then
    FRAGMENTS["inner" .. i] = FRAGMENTS[depth % 2 == 1 and "inner_exists" or "inner_forall"]:gsub("this_level", tostring(i))
    frags[3] = "inner" .. i
  end
  S[i] = rt.solver("S" .. i, frags, {})
end
for i = 1, depth - 1 do
  FRAGMENTS["glue" .. i] = FRAGMENTS["glue"]:gsub("this_level", tostring(i))
  G[i] = rt.link("G" .. i, S[i], S[i + 1], { "shared", "glue" .. i }, {})
end
rt.prepare()

-- A clause: { [atom name] = the value the atom must take }.
local function from_relevant(L, M, Y)            -- one relevant atom must change its value from M
  local c, v, r = {}, M[L], Y[L]
  for j = 1, L.n do if r[j] then c[L.str[j]] = not v[j] end end
  return c
end
local function from_core(T, L)                   -- one assumption in the core of T's last solve must change
  local c = {}
  for _, l in ipairs(T.last_core) do
    local j = L.jof[math.abs(l)]
    if j then c[L.str[j]] = not (l > 0) end
  end
  return c
end
local function on(c, L)                          -- keep the atoms of link L
  local d = {}
  for name, val in pairs(c) do if L.jstr[name] then d[name] = val end end
  return d
end
local function join(c, d) for name, val in pairs(d) do c[name] = val end return c end
local function add(T, L, c)                      -- translate for T, the source of L, and add
  local lits = {}
  for name, val in pairs(c) do
    local j = L.jstr[name]
    if not j then rt.fail("solver " .. T.name .. " does not know the atom " .. name) end
    lits[#lits + 1] = val and L.src[j] or -L.src[j]
  end
  if #lits == 0 then T:add({ L.src[1] }); T:add({ -L.src[1] })      -- the empty clause: nothing is left
  else T:add(lits) end
end

local calls = {}
local function refute(i, M)                      -- a clause that removes M, or nil if M stands
  while true do
    calls[i] = (calls[i] or 0) + 1
    local Y = S[i]:solve{ assume = G[i - 1]:of(M) }
    if not Y then return nil end
    if i == depth then return from_relevant(G[i - 1], M, Y) end
    local c = refute(i + 1, Y)
    if not c then return join(from_relevant(G[i - 1], M, Y), on(from_core(S[i + 1], G[i]), G[i - 1])) end
    add(S[i], G[i], c)
  end
end

while true do
  local M = S[1]:solve{}
  if not M then break end
  local c = depth > 1 and refute(2, M) or nil
  if c then add(S[1], G[1], c)
  else
    rt.accept(M)
    if depth > 1 then S[1]:add(G[1]:block(M)) else break end
  end
end
local t = {}
for i = 2, depth do t[#t + 1] = tostring(calls[i] or 0) end
rt.log("CALLS", table.concat(t, " "))
