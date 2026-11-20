-- Runtime prototype: named solvers, links (glue), eager and lazy loop shapes,
-- clause refinements and program-level refinements ("expand").
local clingo = require("clingo")
local clock = os.clock
local rt = { solvers = {}, solutions = 0, t0 = clock() }
local function emit(kind, s) print("@@" .. kind .. " " .. s) end
rt.emit = emit

local Solver = {}; Solver.__index = Solver
local Link = {};   Link.__index = Link

local function control(args, name)
  local a = {}
  for _, o in ipairs(args or {}) do a[#a + 1] = o end
  for _, c in ipairs(CONSTS) do a[#a + 1] = "-c"; a[#a + 1] = c end
  return clingo.Control(a, function(code, msg) emit("W", name .. ": " .. msg:gsub("\n", " ")) end, 20)
end
local function text_of(parts)
  local t = {}
  for _, p in ipairs(parts) do t[#t + 1] = "#program base.\n" .. FRAGMENTS[p] end
  return table.concat(t, "\n")
end

function rt.solver(name, parts, options)
  local s = setmetatable({ name = name, parts = parts, grounded = false, out = {}, inn = {}, k = 0,
    caps = {}, n = { calls = 0, sat = 0, unsat = 0, time = 0, ground = 0, clauses = 0, lits = 0, expansions = 0 } }, Solver)
  s.ctl = control(options, name)
  s.pending = {}
  s.hooks = { init = function(_, init)
    local q = s.pending
    for i = 1, #q do
      local c = q[i]
      for j = 1, #c do c[j] = init:solver_literal(c[j]) end
      init:add_clause(c)
    end
    s.pending = {}
    for _, L in ipairs(s.out) do for j = 1, L.n do L.slit[j] = init:solver_literal(L.src[j]) end end
  end,
  check = function(_, control) local f = s.on_check; if f then f(control) end end }
  s.ctl:register_propagator(s.hooks)
  rt.solvers[#rt.solvers + 1] = s
  return s
end

function Solver:ground()
  if self.grounded then return end
  local t0 = clock()
  self.ctl:add("base", {}, text_of(self.parts))
  self.ctl:ground({ { "base", {} } })
  self.grounded = true
  self.n.ground = self.n.ground + (clock() - t0)
end

-- A link carries the truth values of the glue atoms from `from` to `to`.
function rt.link(name, from, to, glue_parts, compat)
  local g = control({ "1" }, name)
  g:add("base", {}, text_of(glue_parts)); g:ground({ { "base", {} } })
  local set = {}
  g:solve{ on_model = function(m)
    for _, a in ipairs(m:symbols{ shown = true }) do
      if a.name == "glue" and #a.arguments == 1 then set[tostring(a.arguments[1])] = true
      elseif GLUE_UNWRAPPED then set[tostring(a)] = true end
    end
  end }
  from:ground()
  assert(not to.grounded, "link " .. name .. ": target solver was already grounded")
  local L = setmetatable({ name = name, from = from, to = to, n = 0, src = {}, slit = {}, dst = {}, ind = {}, sym = {}, buf = {}, vbuf = {} }, Link)
  local b = to.ctl:backend()
  for atom in from.ctl.symbolic_atoms:iter() do
    local sym = atom.symbol
    if set[tostring(sym)] then
      local d = b:add_atom(sym)
      if atom.is_fact then
        b:add_rule{ head = { d }, body = {} }
      else
        local i = b:add_atom(clingo.Function("relevant", { sym }, true))
        b:add_rule{ head = { d }, body = {}, choice = true }
        if compat then b:add_rule{ head = { i }, body = {}, choice = true } end   -- as cegar.py does
        local j = L.n + 1; L.n = j
        L.src[j] = atom.literal; L.dst[j] = d; L.ind[j] = i; L.sym[j] = sym
      end
    end
  end
  b:close()
  from.out[#from.out + 1] = L; to.inn[#to.inn + 1] = L
  return L
end

function rt.capture(name, arity) for _, s in ipairs(rt.solvers) do s.caps[name .. "/" .. arity] = { name = name, arity = arity } end end
function rt.prepare() for _, s in ipairs(rt.solvers) do s:ground(); s:refresh() end end
function Solver:refresh()
  for _, c in pairs(self.caps) do
    c.lits, c.syms = {}, {}
    for atom in self.ctl.symbolic_atoms:by_signature(c.name, c.arity) do c.lits[#c.lits + 1] = atom.literal; c.syms[#c.syms + 1] = atom.symbol end
  end
end

local Model = {}; Model.__index = Model
local function snapshot(s, m)
  local M = setmetatable({ solver = s }, Model)
  for _, L in ipairs(s.out) do local v, src = {}, L.src; for j = 1, L.n do v[j] = m:is_true(src[j]) end; M[L] = v end
  for _, L in ipairs(s.inn) do local r, ind = {}, L.ind; for j = 1, L.n do r[j] = m:is_true(ind[j]) end; M[L] = r end
  for key, c in pairs(s.caps) do
    local t = {}
    for j = 1, #c.lits do if m:is_true(c.lits[j]) then t[#t + 1] = c.syms[j] end end
    M[key] = t
  end
  if rt.want_shown then M.shown = tostring(m) end
  return M
end
function Model:atoms(name, arity) return self[name .. "/" .. arity] end
function Model:reject(clause) self.rejected = true; self.solver.n.clauses = self.solver.n.clauses + 1; self.solver.n.lits = self.solver.n.lits + #clause; self.control:add_clause{ clause } end

function Link:of(M)            -- assumptions for the target solver
  local a, v, dst = self.buf, M[self], self.dst
  for j = 1, self.n do a[j] = v[j] and dst[j] or -dst[j] end
  return a
end
function Link:clause(M, X)     -- "one of the relevant glue atoms must change"
  local v, r, lits, c = M[self], X[self], M.lazy and self.slit or self.src, {}
  for j = 1, self.n do if r[j] then c[#c + 1] = v[j] and -lits[j] or lits[j] end end
  return c
end
function Link:block(M)         -- "this exact candidate must not come back"
  local v, lits, c = M[self], M.lazy and self.slit or self.src, {}
  for j = 1, self.n do c[j] = v[j] and -lits[j] or lits[j] end
  return c
end

function Solver:solve(o)
  local n, X, t0 = self.n, nil, clock()
  n.calls = n.calls + 1
  -- Handle form, so that an unsat core is available.  Models must be read through h:iter():
  -- h:get() followed by h:model() traps in the WASM build, and so does yield + on_model.
  local h = self.ctl:solve{ assumptions = o and o.assume, yield = true }
  for m in h:iter() do X = snapshot(self, m); break end
  if not X then self.last_core = h:core() end
  h:close()
  n.time = n.time + (clock() - t0)
  if X then n.sat = n.sat + 1 else n.unsat = n.unsat + 1 end
  return X
end
function Solver:add_clause(c)  -- between solve calls: an integrity constraint over program literals
  if USE_BACKEND_CLAUSES then
    local body = {}
    for j = 1, #c do body[j] = -c[j] end
    local b = self.ctl:backend(); b:add_rule{ head = {}, body = body }; b:close()
  else
    self.pending[#self.pending + 1] = c      -- injected by the propagator's init at the next solve
  end
  self.n.clauses = self.n.clauses + 1; self.n.lits = self.n.lits + #c
end
-- Program-level refinement: assert facts name(k, Atom) and ground #program part(k).
function Solver:expand(part, facts)
  local t0 = clock()
  self.k = self.k + 1
  local k = clingo.Number(self.k)
  if FACTS_VIA_TEXT then
    local t = {}
    for name, atoms in pairs(facts) do for _, a in ipairs(atoms) do t[#t + 1] = name .. "(" .. self.k .. "," .. tostring(a) .. ")." end end
    local fp = "f__" .. self.k
    self.ctl:add(fp, {}, table.concat(t, " "))
    self.ctl:ground({ { fp, {} }, { part, { k } } })
  else
    local b = self.ctl:backend()
    for name, atoms in pairs(facts) do for _, a in ipairs(atoms) do b:add_rule{ head = { b:add_atom(clingo.Function(name, { k, a }, true)) }, body = {} } end end
    b:close()
    self.ctl:ground({ { part, { k } } })
  end
  self.n.expansions = self.n.expansions + 1
  self.n.ground = self.n.ground + (clock() - t0)
end

-- Lazy shape: run the solver's own search and call on_candidate for each total assignment.
function Solver:search(h)
  local s, t0 = self, clock()
  self.on_check = function(control)
    local ass = control.assignment
    local M = setmetatable({ solver = s, lazy = true, control = control }, Model)
    for _, L in ipairs(s.out) do local v, sl = L.vbuf, L.slit; for j = 1, L.n do v[j] = ass:is_true(sl[j]) end; M[L] = v end
    M.rejected = false
    h.on_candidate(M)
    if not M.rejected and s.block_accepted then          -- remember it, to block it if the search is restarted
      for _, L in ipairs(s.out) do
        local c, v, src = {}, M[L], L.src
        for j = 1, L.n do c[j] = v[j] and -src[j] or src[j] end
        s.pending[#s.pending + 1] = c
      end
    end
  end
  self.n.calls = self.n.calls + 1
  local ret = self.ctl:solve{ on_model = function(m) rt.solutions = rt.solutions + 1; if rt.want_shown then emit("M", tostring(m)) end end }
  self.on_check = nil
  self.n.time = self.n.time + (clock() - t0)
  return not ret.interrupted
end
function Solver:restart() self.ctl:interrupt() end
function rt.accept(M) rt.solutions = rt.solutions + 1; if rt.want_shown then emit("M", M.shown or "") end end

function rt.report()
  emit("R", string.format("solutions=%d wall=%.3f", rt.solutions, clock() - rt.t0))
  for _, s in ipairs(rt.solvers) do
    local st = s.ctl.statistics
    local sv = (st.accu or st).solving.solvers
    emit("S", string.format("%s calls=%d sat=%d unsat=%d time=%.3f ground=%.3f clauses=%d avglen=%.1f expansions=%d | clasp(%s): choices=%d conflicts=%d restarts=%d | atoms=%d rules=%d",
      s.name, s.n.calls, s.n.sat, s.n.unsat, s.n.time, s.n.ground, s.n.clauses, s.n.clauses > 0 and s.n.lits / s.n.clauses or 0, s.n.expansions,
      st.accu and "accu" or "last", sv.choices, sv.conflicts, sv.restarts, st.problem.lp.atoms, st.problem.lp.rules))
  end
end
return rt
