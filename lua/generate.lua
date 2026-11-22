-- CegarPlay generator runtime (docs/spec-instances.md section 4). Appended after lua/draw.lua.
--
--   gen.run{ text = "...", params = { "n=7", "p=300" }, seeds = { 1, 2 }, attempts = 100 }
--
-- For each attempt: a fresh control with the parameters as constants, grounded with the draw
-- context of (seed, attempt), asked for two models. One model: the instance is exact. Two: the
-- solver completed it (clingo returns some model, not a uniform one). None: the next attempt.
-- Emits one line per instance:
--   @@G {"facts": "...", "seed": S, "attempt": A, "exact": true}
--   @@G {"error": "...", "seed": S}       (a draw error ends the run; "no accepted draw" does not)
-- `facts` is each shown symbol with a full stop, sorted as text, so it is valid ASP.
-- The caller validates `text` first (js/driver.js validateGenerator): clingo errors raised by
-- ctl:add would trap the engine.
local clingo = require("clingo")
local gen = {}

local function jstr(s)
  return '"' .. tostring(s):gsub('[%c"\\]', function(ch)
    if ch == '"' then return '\\"' elseif ch == '\\' then return '\\\\'
    elseif ch == '\n' then return '\\n' else return string.format('\\u%04x', ch:byte()) end
  end) .. '"'
end
local function emit(t)
  local keys = {}
  for k in pairs(t) do keys[#keys + 1] = k end
  table.sort(keys)
  local o = {}
  for _, k in ipairs(keys) do
    local v = t[k]
    local s = type(v) == "string" and jstr(v) or tostring(v)
    o[#o + 1] = jstr(k) .. ":" .. s
  end
  print("@@G {" .. table.concat(o, ",") .. "}")
end
gen.emit = emit

-- One attempt: returns facts, exact (or nil when unsatisfiable), or nil, nil, message.
function gen.attempt(o, seed, attempt)
  local args = {}
  for _, c in ipairs(o.params or {}) do args[#args + 1] = "-c"; args[#args + 1] = c end
  local ctl = clingo.Control(args, function() end, 20)
  ctl:add("base", {}, o.text)
  draw.error = nil
  ctl:ground({ { "base", {} } }, draw.context(seed, attempt))
  if draw.error then return nil, nil, draw.error end
  local first, n = nil, 0
  local h = ctl:solve{ yield = true }
  for m in h:iter() do
    n = n + 1
    if n == 1 then
      first = {}
      for _, a in ipairs(m:symbols{ shown = true }) do first[#first + 1] = tostring(a) .. "." end
    else break end
  end
  h:close()
  if n == 0 then return nil end
  table.sort(first)
  return table.concat(first, " "), n == 1
end

-- o.seeds: a list of seeds (one instance each), or o.seed for one.
function gen.run(o)
  local attempts = o.attempts or 100
  local seeds = o.seeds or { o.seed or 0 }
  for _, seed in ipairs(seeds) do
    local found = false
    for attempt = 0, attempts - 1 do
      local facts, exact, err = gen.attempt(o, seed, attempt)
      if err then emit({ error = err, seed = seed, attempt = attempt }); return end
      if facts then
        emit({ facts = facts, seed = seed, attempt = attempt, exact = exact })
        found = true
        break
      end
    end
    if not found then emit({ error = "no accepted draw in " .. attempts .. " attempts", seed = seed }) end
  end
end

return gen
