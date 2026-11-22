-- CegarPlay generator draws (docs/spec-instances.md section 4): stateless, seeded, integer-only.
-- Every draw is a pure function of (seed, attempt, function name, key terms), so an instance does
-- not depend on the order or the number of times the grounder evaluates a term.
--
--   local ctx = draw.context(seed, attempt)
--   ctl:ground({ { "base", {} } }, ctx)     -- clingo calls ctx.flip(ctx, P, K...)
--   if draw.error then ... end               -- a bad argument: the function returned 0
--
-- The mixer is the one of the generator spike (spike2/gen/draws.lua), unchanged; the Python twin
-- is tools/draw.py. Every function body runs inside xpcall: a Lua error inside a grounding
-- callback would cross a clingo frame and trap the engine.
local clingo = require("clingo")
local draw = { error = nil }

local function mix(z)
  z = (z ~ (z >> 30)) * 0xbf58476d1ce4e5b9
  z = (z ~ (z >> 27)) * 0x94d049bb133111eb
  return z ~ (z >> 31)
end
local function hash_str(h, s)
  for i = 1, #s do h = mix(h ~ s:byte(i)) end
  return h
end
-- the hash of (seed, attempt, name, keys); keys are clingo symbols or numbers, read as text
local function hash(c, name, keys)
  local h = mix(c.seed * 0x9e3779b97f4a7c15 + c.attempt)
  h = hash_str(h, name)
  for i = 1, #keys do h = hash_str(mix(h + i), tostring(keys[i])) end
  return mix(h)
end
draw.mix, draw.hash = mix, hash
local function keytext(name, keys)        -- a cache key for permutations and rankings
  local t = { name }
  for i = 1, #keys do t[#t + 1] = tostring(keys[i]) end
  return table.concat(t, "|")
end
-- an integer in 0..r-1 from the top 53 bits; the bias is below r / 2^53
local function pick(c, r, name, keys)
  if math.type(r) ~= "integer" or r < 1 then error(name .. ": the range must be a positive integer", 0) end
  return (hash(c, name, keys) >> 11) % r
end
draw.pick = pick
local function num(s, what)
  if type(s) ~= "userdata" or s.type ~= clingo.SymbolType.Number then
    error(what .. " must be an integer, got " .. tostring(s), 0)
  end
  return s.number
end
local N = clingo.Number

local F = {}
function F.flip(c, p, ...)                -- 1 with probability p/1000
  local keys = { ... }
  return pick(c, 1000, "flip", keys) < num(p, "flip: the probability") and 1 or 0
end
function F.int(c, lo, hi, ...)            -- uniform in lo..hi
  lo, hi = num(lo, "int: the lower bound"), num(hi, "int: the upper bound")
  if hi < lo then error("int: empty range " .. lo .. ".." .. hi, 0) end
  return lo + pick(c, hi - lo + 1, "int", { ... })
end
function F.weighted(c, ws, ...)           -- index i with probability w_i / sum
  if type(ws) ~= "userdata" or ws.type ~= clingo.SymbolType.Function or ws.name ~= "" then
    error("weighted: the weights must be a tuple (W1, ..., Wm), got " .. tostring(ws), 0)
  end
  local w, total = {}, 0
  for i, a in ipairs(ws.arguments) do
    w[i] = num(a, "weighted: a weight")
    if w[i] < 0 then error("weighted: a weight is negative", 0) end
    total = total + w[i]
  end
  local t = pick(c, total, "weighted", { ... })
  for i = 1, #w do if t < w[i] then return i end; t = t - w[i] end
end
local function size(n, what)
  if n < 1 or n > 100000 then error(what .. " must be in 1..100000", 0) end
  return n
end
local function permutation(c, n, keys)    -- Fisher-Yates, one draw per position, cached
  local id = keytext("perm" .. n, keys)
  local p = c.perms[id]
  if p then return p end
  p = {}
  for i = 1, n do p[i] = i end
  for j = n, 2, -1 do
    local r = pick(c, j, "perm", { N(n), N(j), table.unpack(keys) }) + 1
    p[j], p[r] = p[r], p[j]
  end
  c.perms[id] = p
  return p
end
local function index(i, n, what)
  if i < 1 or i > n then error(what .. " " .. i .. " is outside 1.." .. n, 0) end
  return i
end
function F.perm(c, n, i, ...)             -- image of i under a uniform permutation of 1..n
  n = size(num(n, "perm: n"), "perm: n")
  return permutation(c, n, { ... })[index(num(i, "perm: i"), n, "perm: i")]
end
function F.subset(c, m, n, i, ...)        -- 1 if i is in a uniform m-subset of 1..n
  n = size(num(n, "subset: n"), "subset: n")
  m = num(m, "subset: m")
  return permutation(c, n, { ... })[index(num(i, "subset: i"), n, "subset: i")] <= m and 1 or 0
end
function F.mallows(c, n, phi, i, ...)     -- position of item i; dispersion phi/1000
  n, phi, i = num(n, "mallows: n"), num(phi, "mallows: phi"), num(i, "mallows: i")
  size(n, "mallows: n"); index(i, n, "mallows: i")
  if phi < 0 or phi > 1000 then error("mallows: phi must be in 0..1000", 0) end
  local keys = { ... }
  local id = keytext("mallows" .. n .. "/" .. phi, keys)
  local pos = c.rankings[id]
  if not pos then
    -- repeated insertion: item k goes to place j of 1..k with weight phi^(k-j), kept as 30-bit
    -- integers (not Fisher-Yates)
    local order = {}
    for k = 1, n do
      local w, total = {}, 0
      local x = 1 << 30
      for j = k, 1, -1 do w[j] = x; total = total + x; x = x * phi // 1000 end
      local t, place = pick(c, total, "mallows", { N(n), N(phi), N(k), table.unpack(keys) }), k
      for j = 1, k do if t < w[j] then place = j; break end; t = t - w[j] end
      table.insert(order, place, k)
    end
    pos = {}
    for p, item in ipairs(order) do pos[item] = p end
    c.rankings[id] = pos
  end
  return pos[i]
end
draw.functions = F

local function message(e) return type(e) == "string" and e or tostring(e) end

-- The context table for one attempt. Each entry is called by the grounder as ctx.f(ctx, ...).
function draw.context(seed, attempt)
  local c = { seed = seed or 0, attempt = attempt or 0, perms = {}, rankings = {} }
  local ctx = {}
  for name, f in pairs(F) do
    ctx[name] = function(_, ...)
      local args = table.pack(...)
      local ok, v = xpcall(function() return f(c, table.unpack(args, 1, args.n)) end, message)
      if ok and math.type(v) == "integer" then
        local ok2, s = pcall(N, v)
        if ok2 then return s end
        v = name .. ": the value is out of range"
      elseif ok then v = name .. ": no value" end
      if not draw.error then draw.error = "@" .. name .. ": " .. message(v):gsub("^" .. name .. ": ", "") end
      return N(0)
    end
  end
  ctx.__state = c
  return ctx
end

-- A plain call outside the grounder (tests): draw.call(seed, attempt, "flip", 300, 1, 2)
-- with Lua integers or strings as arguments; strings become clingo functions/strings.
function draw.call(seed, attempt, name, ...)
  local c = draw.context(seed, attempt)
  local a = table.pack(...)
  for i = 1, a.n do
    local v = a[i]
    if math.type(v) == "integer" then a[i] = N(v)
    elseif type(v) == "table" then local t = {}; for j, x in ipairs(v) do t[j] = N(x) end; a[i] = clingo.Tuple(t)
    elseif type(v) == "string" then a[i] = clingo.parse_term(v) end
  end
  return c[name](c, table.unpack(a, 1, a.n)).number
end

return draw
