from spikes import run
run("optimality_proven", r'''
local clingo = require("clingo")
local ctl = clingo.Control({ "--opt-mode=optN", "0" })
ctl:add("base", {}, "1 { p(1..4) }. #minimize { 1,X : p(X) }.")
ctl:ground({ { "base", {} } })
local seen, proven = 0, 0
ctl:solve{ on_model = function(m) seen = seen + 1; if m.optimality_proven then proven = proven + 1 end end }
rt.log("models seen:", seen, "with optimality proven:", proven)
''')
run("solver family and recursion with the runtime", r'''
local depth = 4
local S, G = {}, {}
for i = 1, depth do S[i] = rt.solver("S" .. i, { "shared", "level" }, {}) end
for i = 1, depth - 1 do G[i] = rt.link("G" .. i, S[i], S[i + 1], { "shared", "glue" }, {}) end
rt.prepare()
local function descend(i, M)
  if i > depth then return 0 end
  local Y = S[i]:solve{ assume = i > 1 and G[i - 1]:of(M) or nil }
  if not Y then return 0 end
  return 1 + descend(i + 1, Y)
end
rt.log("levels solved in one recursive descent:", descend(1, nil))
''', frags=[{"name":"shared","text":"i(1..3).\n"},{"name":"level","text":"{ p(I) : i(I) }.\n"},{"name":"glue","text":"glue(p(I)) :- i(I).\n"}])
