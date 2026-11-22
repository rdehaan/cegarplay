import json, subprocess
def run(name, lua, frags=None):
    p = {"format":"cegarplay","version":1,"title":name,"description":"",
         "fragments": frags or [{"name":"shared","text":"i(1..3).\n"}],
         "loop":{"language":"lua","text":lua},
         "settings":{"constants":{},"solutions":0,"seconds":20,"candidates":0,"trace":0,"seed":0}}
    json.dump(p, open("spike.json","w"))
    r = subprocess.run(["node","../../cegarplay/tools/run.mjs","spike.json","--solutions","all"],capture_output=True,text=True)
    print("---", name, "exit", r.returncode)
    for l in (r.stdout+r.stderr).strip().splitlines()[-8:]: print("   ", l[:200])

# 1. ground-program observer
run("observer", r'''
local clingo = require("clingo")
local n = { rule = 0, weight = 0, atoms = 0, ext = 0 }
local obs = {
  rule = function(self, choice, head, body) n.rule = n.rule + 1 end,
  weight_rule = function(self, choice, head, lower, body) n.weight = n.weight + 1 end,
  output_atom = function(self, sym, atom) n.atoms = n.atoms + 1 end,
  external = function(self, atom, value) n.ext = n.ext + 1 end,
}
local ctl = clingo.Control({})
ctl:register_observer(obs)
ctl:add("base", {}, "{ p(1..3) }. q :- p(1), not p(2). :- #sum { X : p(X) } > 4. #external e.")
ctl:ground({ { "base", {} } })
rt.log("after ground: rules", n.rule, "weight rules", n.weight, "atoms", n.atoms, "externals", n.ext)
local r = ctl:solve{}
rt.log("after solve: rules", n.rule, "weight rules", n.weight, "atoms", n.atoms, "externals", n.ext, "sat", tostring(r.satisfiable))
''')

# 2. propagator check on partial assignments (fixpoint mode)
run("check at fixpoints", r'''
local clingo = require("clingo")
local total, partial = 0, 0
local ctl = clingo.Control({ "0" })
local prop = {
  init = function(self, init) init.check_mode = clingo.PropagatorCheckMode.Fixpoint end,
  check = function(self, control)
    if control.assignment.is_total then total = total + 1 else partial = partial + 1 end
  end }
ctl:register_propagator(prop)
ctl:add("base", {}, "{ p(1..6) }. :- p(X), p(X+1).")
ctl:ground({ { "base", {} } })
ctl:solve{}
rt.log("check calls on total assignments:", total, "on partial assignments:", partial)
''')

# 3. a search with its own propagator, nested inside another solver's check
run("nested search", r'''
local clingo = require("clingo")
local inner_models, inner_checks, outer = 0, 0, 0
local B = clingo.Control({ "0" })
B:register_propagator({ init = function() end, check = function(self, c)
  if c.assignment.is_total then inner_checks = inner_checks + 1 end end })
B:add("base", {}, "{ y(1..2) }. #external x(1..3).")
B:ground({ { "base", {} } })
local A = clingo.Control({ "0" })
A:register_propagator({ init = function() end, check = function(self, c)
  if not c.assignment.is_total then return end
  outer = outer + 1
  local ok = pcall(function() B:solve{ on_model = function(m) inner_models = inner_models + 1 end } end)
end })
A:add("base", {}, "{ x(1..3) }.")
A:ground({ { "base", {} } })
A:solve{}
rt.log("outer candidates:", outer, "inner candidates:", inner_checks, "inner models:", inner_models)
''')

# 4. externals and release; atoms and rules added after grounding
run("externals and growth", r'''
local clingo = require("clingo")
local ctl = clingo.Control({ "0" })
ctl:add("base", {}, "#external on(1..2). { p }. :- p, on(1). :- not p, on(2).")
ctl:add("step", { "t" }, "q(t) :- late(t). :- not q(t), p.")
ctl:ground({ { "base", {} } })
local function count(assume)
  local n = 0
  ctl:solve{ assumptions = assume or {}, on_model = function() n = n + 1 end }
  return n
end
local on1, on2 = clingo.Function("on", { clingo.Number(1) }), clingo.Function("on", { clingo.Number(2) })
local a = count()
ctl:assign_external(on1, true);  local b = count()
ctl:assign_external(on1, false); ctl:assign_external(on2, true); local c = count()
ctl:release_external(on2);       local d = count()
-- a new interface atom late(1), added through the backend after grounding, then a new part that reads it
local be = ctl:backend()
local late = be:add_atom(clingo.Function("late", { clingo.Number(1) }))
be:add_rule{ head = { late }, body = {}, choice = true }
be:close()
ctl:ground({ { "step", { clingo.Number(1) } } })
local e = count({ late }); local f = count({ -late })
rt.log("models: free", a, "| on(1)", b, "| on(2)", c, "| released", d, "| late(1) true", e, "| late(1) false", f)
''')
