-- CegarPlay candidate space (docs/spec-views.md section 5): the models of the unrefined
-- abstraction, one per interface assignment of a link, as P events of 1,024 hex vectors.
-- Appended after runtime.lua for the assemble mode `enumerate`.
--
--   rt.enumerate{ link = G, limit = 1048576 }
--
-- Every model of the abstraction, de-duplicated on the link's interface atoms. Above the limit it ends with outcome
-- limit (A event { verdict = "limit" }); otherwise A event { verdict = "enumerated", candidates }.
local clingo = require("clingo")

local function hex(v, n)
  local digits = {}
  local nd = (n + 3) // 4
  for d = 1, nd do
    local x = 0
    for b = 0, 3 do
      local j = (d - 1) * 4 + b + 1
      if j <= n and v[j] then x = x | (1 << b) end
    end
    digits[nd - d + 1] = string.format("%x", x)
  end
  return table.concat(digits)
end

function rt.enumerate(o)
  local L = o.link
  local A = L.from
  local limit = o.limit or 1048576
  -- every model, de-duplicated on the interface (as the audit does); not only improving ones
  pcall(function() A.ctl.configuration.solve.opt_mode = "ignore" end)
  if not rt.prepared then rt.prepare() end
  local all = A:models{ limit = limit + 1 }
  local chunk, from, count, over, seen = rt.array({}), 1, 0, false, {}
  for _, M in ipairs(all) do
    local hx = hex(M[L], L.n)
    if not seen[hx] then
      seen[hx] = true
      count = count + 1
      if count > limit then over = true; break end
      chunk[#chunk + 1] = hx
      if #chunk == 1024 then
        rt.emit("P", { set = "candidates", link = L.name, from = from, v = chunk })
        from = from + #chunk
        chunk = rt.array({})
      end
    end
  end
  if #chunk > 0 or from == 1 then rt.emit("P", { set = "candidates", link = L.name, from = from, v = chunk }) end
  if over then rt.emit("A", { verdict = "limit", limit = limit, candidates = limit }); rt.finish("limit", "more than " .. limit .. " candidates", false) end
  rt.emit("A", { verdict = "enumerated", candidates = count, link = L.name, atoms = L.n })
end

return rt
