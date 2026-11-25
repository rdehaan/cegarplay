-- CegarPlay replay of rule refinements. Appended after
-- runtime.lua for the assemble mode `replay`.
--
--   rt.replay{ solver = A, link = G, part = "refine", expansions = { { "cex(1,color(1,2))", ... }, ... },
--              solution = { "color(1,2)", ... } }
--
-- Grounds the recorded facts of each expansion on the solver (fresh: nothing else is done with
-- it) and after each one solves under the lost solution's interface values. The first
-- unsatisfiable step is the culprit. Emits @@Y {"culprit": i | null, "steps": n}.
-- The fact texts come from the engine's own output (a recording), so parse_term sees valid terms.
local clingo = require("clingo")

function rt.replay(o)
  local A, L = o.solver, o.link
  A:ground()
  local want = {}
  for _, a in ipairs(o.solution or {}) do want[a] = true end
  local assume = {}
  for j = 1, L.n do assume[#assume + 1] = want[L.str[j]] and L.src[j] or -L.src[j] end
  local function sat()
    local h = A.ctl:solve{ assumptions = assume, yield = true }
    local found = false
    for _ in h:iter() do found = true; break end
    h:close()
    return found
  end
  if not sat() then rt.emit("Y", { culprit = 0, steps = #o.expansions, reason = "the solution is not a candidate" }); return end
  for i, facts in ipairs(o.expansions) do
    local b = A.ctl:backend()
    for _, f in ipairs(facts) do
      local t = clingo.parse_term(f)
      b:add_rule{ head = { b:add_atom(t) }, body = {} }
    end
    b:close()
    A.ctl:ground({ { o.part, { clingo.Number(i) } } })
    if not sat() then rt.emit("Y", { culprit = i, steps = #o.expansions }); return end
  end
  rt.emit("Y", { culprit = rt.NULL, steps = #o.expansions })
end

return rt
