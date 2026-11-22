-- CegarPlay generator draws: stateless, seeded, integer-only.
-- Every draw is a pure function of (SEED, ATTEMPT, function name, key), so the instance does not
-- depend on the order or the number of times the grounder evaluates a term.
-- SEED and ATTEMPT are set by the runner before this text.
local clingo = require("clingo")
SEED = SEED or 0
ATTEMPT = ATTEMPT or 0

-- The mixer of spike2/probe3.lua, unchanged: a splitmix64-style finaliser on Lua 5.4 integers
-- (wrap-around modulo 2^64), fed with seed, attempt, the function name and the printed key terms.
local function mix(z)
  z = (z ~ (z >> 30)) * 0xbf58476d1ce4e5b9
  z = (z ~ (z >> 27)) * 0x94d049bb133111eb
  return z ~ (z >> 31)
end
local function hash_str(h, s)
  for i = 1, #s do h = mix(h ~ s:byte(i)) end
  return h
end
local function hash(name, keys)
  local h = mix(SEED * 0x9e3779b97f4a7c15 + ATTEMPT)
  h = hash_str(h, name)
  for i = 1, #keys do h = hash_str(mix(h + i), tostring(keys[i])) end
  return mix(h)
end
local function keytext(name, keys)                -- only a cache key for permutations and rankings
  local t = { name, tostring(SEED), tostring(ATTEMPT) }
  for i = 1, #keys do t[#t + 1] = tostring(keys[i]) end
  return table.concat(t, "|")
end
-- An integer in 0..r-1 from the top 53 bits. The bias is below r / 2^53.
local function draw(r, name, keys)
  if math.type(r) ~= "integer" or r < 1 then error(name .. ": the range must be a positive integer", 0) end
  return (hash(name, keys) >> 11) % r
end
local function num(s, what)
  if s.type ~= clingo.SymbolType.Number then error(what .. " must be an integer, got " .. tostring(s), 0) end
  return s.number
end
local N = clingo.Number

function flip(p, ...)                                   -- 1 with probability p/1000
  return N(draw(1000, "flip", { ... }) < num(p, "flip: the probability") and 1 or 0)
end
function int(lo, hi, ...)                               -- uniform in lo..hi
  lo, hi = num(lo, "int: the lower bound"), num(hi, "int: the upper bound")
  if hi < lo then error("int: empty range " .. lo .. ".." .. hi, 0) end
  return N(lo + draw(hi - lo + 1, "int", { ... }))
end
function weighted(ws, ...)                              -- index i with probability w_i / sum
  local w, total = {}, 0
  for i, a in ipairs(ws.arguments) do w[i] = num(a, "weighted: a weight"); total = total + w[i] end
  local t = draw(total, "weighted", { ... })
  for i = 1, #w do if t < w[i] then return N(i) end; t = t - w[i] end
end
local perms = {}
local function permutation(n, keys)                     -- Fisher-Yates, one draw per position
  local id = keytext("perm" .. n, keys)
  local p = perms[id]
  if p then return p end
  p = {}
  for i = 1, n do p[i] = i end
  for j = n, 2, -1 do
    local r = draw(j, "perm", { N(n), N(j), table.unpack(keys) }) + 1
    p[j], p[r] = p[r], p[j]
  end
  perms[id] = p
  return p
end
function perm(n, i, ...)                                -- image of i under a uniform permutation of 1..n
  return N(permutation(num(n, "perm: n"), { ... })[num(i, "perm: i")])
end
function subset(m, n, i, ...)                           -- 1 if i is in a uniform m-subset of 1..n
  return N(permutation(num(n, "subset: n"), { ... })[num(i, "subset: i")] <= num(m, "subset: m") and 1 or 0)
end
local rankings = {}
function mallows(n, phi, i, ...)                        -- position of item i; dispersion phi/1000
  n, phi, i = num(n, "mallows: n"), num(phi, "mallows: phi"), num(i, "mallows: i")
  local keys = { ... }
  local id = keytext("mallows" .. n .. "/" .. phi, keys)
  local pos = rankings[id]
  if not pos then
    local order = {}                                    -- repeated insertion: item k goes to place j of 1..k
    for k = 1, n do                                     -- with weight phi^(k-j), kept as 30-bit integers
      local w, total = {}, 0
      local x = 1 << 30
      for j = k, 1, -1 do w[j] = x; total = total + x; x = x * phi // 1000 end
      local t, place = draw(total, "mallows", { N(n), N(phi), N(k), table.unpack(keys) }), k
      for j = 1, k do if t < w[j] then place = j; break end; t = t - w[j] end
      table.insert(order, place, k)
    end
    pos = {}
    for p, item in ipairs(order) do pos[item] = p end
    rankings[id] = pos
  end
  return N(pos[i])
end
