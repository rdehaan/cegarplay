-- CegarPlay runtime: solvers, links, models, refinements, limits and events.
-- Loaded inside one `#script (lua)` block after FRAGMENTS, CONSTS and SETTINGS.
-- See docs/spec-runtime.md. Golden rule: no Lua error may cross a clingo frame.
local clingo = require("clingo")
local clock = os.clock
local tointeger, floor, abs = math.tointeger, math.floor, math.abs
local concat, unpack = table.concat, table.unpack

rt = rt or {}
SETTINGS = SETTINGS or {}
CONSTS = CONSTS or {}
FRAGMENTS = FRAGMENTS or {}
for k, v in pairs({ solutions = 1, seconds = 0, candidates = 0, trace = 0, seed = 0, poll = false, plain = false }) do
  if SETTINGS[k] == nil then SETTINGS[k] = v end
end

rt.solvers, rt.links, rt.captures = {}, {}, {}
rt.solutions, rt.candidates, rt.counterexamples = 0, 0, 0
rt.clauses, rt.literals, rt.maxlen = 0, 0, 0
rt.hist = { 0, 0, 0, 0, 0, 0, 0, 0 }
rt.expansions, rt.restarts, rt.blocks = 0, 0, 0
rt.counters, rt.counter_order = {}, {}
rt.traced = 0
rt.t0 = clock()
rt.last_s = rt.t0
rt.stack = {}            -- solves in progress (for exclusive times)
rt.searching = nil       -- the solver whose search is running
rt.END = setmetatable({}, { __tostring = function() return "end of run" end })
rt.exhausted = nil
local NULL = setmetatable({}, { __tostring = function() return "null" end })
rt.NULL = NULL
local ARRAY = {}         -- metatable marking a table as a JSON array
local function array(t) return setmetatable(t or {}, ARRAY) end
rt.array = array
local owner = setmetatable({}, { __mode = "k" })   -- captured array -> model it came from

-------------------------------------------------------------------------------
-- JSON
-------------------------------------------------------------------------------
local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
local function jstr(s)
  return '"' .. s:gsub('[%c"\\]', function(c) return escapes[c] or string.format("\\u%04x", c:byte()) end) .. '"'
end
local function jnum(v)
  if v ~= v or v == math.huge or v == -math.huge then return "null" end
  if math.type(v) == "integer" then return tostring(v) end
  if v == floor(v) and abs(v) < 2^53 then return string.format("%d", tointeger(v)) end
  local s = string.format("%.6f", v):gsub("0+$", ""):gsub("%.$", "")
  return s
end
local json
function json(v)
  local t = type(v)
  if v == nil or v == NULL then return "null"
  elseif t == "boolean" then return v and "true" or "false"
  elseif t == "number" then return jnum(v)
  elseif t == "string" then return jstr(v)
  elseif t == "table" then
    local mt = getmetatable(v)
    if mt == ARRAY or (mt == nil and v[1] ~= nil) then
      local o = {}
      for i = 1, #v do o[i] = json(v[i]) end
      return "[" .. concat(o, ",") .. "]"
    end
    local keys = {}
    for k in pairs(v) do if type(k) == "string" then keys[#keys + 1] = k end end
    table.sort(keys)
    local o = {}
    for _, k in ipairs(keys) do o[#o + 1] = jstr(k) .. ":" .. json(v[k]) end
    return "{" .. concat(o, ",") .. "}"
  end
  return jstr(tostring(v))
end
rt.json = json

-------------------------------------------------------------------------------
-- Events
-------------------------------------------------------------------------------
local plain_table
local function emit(kind, obj)
  if SETTINGS.plain then
    if kind == "M" then
      print("Answer: " .. obj.n)
      print(obj.atoms or "")
      if obj.cost then print("Optimization: " .. concat(obj.cost, " ")) end
    elseif kind == "L" then print(obj.text)
    elseif kind == "W" then print("Warning (" .. obj.solver .. "): " .. obj.message)
    elseif kind == "E" then print("Error: " .. obj.message); if obj.traceback then print(obj.traceback) end
    elseif kind == "D" then plain_table(obj) end
    return
  end
  print("@@" .. kind .. " " .. json(obj))
end
rt.emit = emit

-------------------------------------------------------------------------------
-- Errors, ending a run
-------------------------------------------------------------------------------
function rt.fail(msg) error(msg, 0) end
local fail = rt.fail

-- End the run with an outcome. Raises the sentinel; callback wrappers catch it.
function rt.finish(outcome, detail, exhausted)
  if not rt.ending then rt.ending = { outcome = outcome, detail = detail or "", exhausted = exhausted } end
  error(rt.END, 0)
end

local function errinfo(e)
  if e == rt.END then return e end
  if type(e) == "table" and e.message then return e end
  return { message = tostring(e), traceback = debug.traceback("", 2) }
end

-- Run a callback body; never let an error escape into clingo.
local function guarded(s, f, ...)
  local ok, err = xpcall(f, errinfo, ...)
  if ok then return true, err end
  if err ~= rt.END and not rt.fatal then rt.fatal = err end
  if s then s.ctl:interrupt() end
  return false
end

local function reraise()
  if rt.fatal then local f = rt.fatal; error(f, 0) end
  if rt.ending then error(rt.END, 0) end
end

-------------------------------------------------------------------------------
-- Statistics helpers
-------------------------------------------------------------------------------
local function bucket(len)
  if len <= 1 then return 1 elseif len == 2 then return 2 elseif len <= 4 then return 3
  elseif len <= 8 then return 4 elseif len <= 16 then return 5 elseif len <= 32 then return 6
  elseif len <= 64 then return 7 end
  return 8
end
local function count_clause(c)
  local n = #c
  rt.clauses = rt.clauses + 1
  rt.literals = rt.literals + n
  if n > rt.maxlen then rt.maxlen = n end
  local b = bucket(n); rt.hist[b] = rt.hist[b] + 1
end

local function num(v) if v == nil then return NULL end return v end

local function read_clasp(s)
  if s.busy then return end
  local st = s.ctl.statistics
  if not st then return end
  local acc = st.accu or st
  local sv = acc.solving and acc.solving.solvers
  if sv then s.clasp.choices, s.clasp.conflicts, s.clasp.restarts = sv.choices, sv.conflicts, sv.restarts end
  local pr = st.problem
  if pr then
    if pr.lp then s.clasp.atoms, s.clasp.rules = pr.lp.atoms, pr.lp.rules end
    if pr.generator then s.clasp.vars, s.clasp.constraints = pr.generator.vars, pr.generator.constraints end
  end
end

local function stats_event()
  local sv = {}
  for _, s in ipairs(rt.solvers) do
    read_clasp(s)
    local c = s.clasp
    sv[s.name] = { calls = s.n.calls, sat = s.n.sat, unsat = s.n.unsat, time = s.n.time, ground = s.n.ground,
      busy = s.busy and true or false, choices = num(c.choices), conflicts = num(c.conflicts), restarts = num(c.restarts),
      atoms = num(c.atoms), rules = num(c.rules), vars = num(c.vars), constraints = num(c.constraints), k = s.k }
  end
  local counters = {}
  for k, v in pairs(rt.counters) do counters[k] = v end
  local hist = array({})
  for i = 1, 8 do hist[i] = rt.hist[i] end
  return { t = clock() - rt.t0, candidates = rt.candidates, counterexamples = rt.counterexamples,
    solutions = rt.solutions, clauses = rt.clauses, literals = rt.literals, maxlen = rt.maxlen, hist = hist,
    expansions = rt.expansions, restarts = rt.restarts, blocks = rt.blocks, solvers = sv, counters = counters }
end

local function send_stats()
  rt.last_s = clock()
  emit("S", stats_event())
end
rt.send_stats = send_stats

-- Called once per candidate and once per solve: periodic statistics, limits, pause poll.
local function tick(poll)
  local now = clock()
  if now - rt.last_s >= 0.25 and not SETTINGS.plain then send_stats() end
  if SETTINGS.seconds > 0 and now - rt.t0 >= SETTINGS.seconds then
    rt.finish("limit", "time limit of " .. SETTINGS.seconds .. " s reached", false)
  end
  if poll and SETTINGS.poll then
    local l = io.read("l")
    if l == "stop" then rt.finish("stopped", "stopped by user", false) end
  end
end
local function count_candidate()
  if SETTINGS.candidates > 0 and rt.candidates >= SETTINGS.candidates then
    rt.finish("limit", "candidate limit of " .. SETTINGS.candidates .. " reached", false)
  end
  rt.candidates = rt.candidates + 1
end

-- Timing with exclusive times: nested solve time is subtracted from the enclosing one.
local function timer_start(s)
  local fr = { s = s, t0 = clock(), child = 0 }
  rt.stack[#rt.stack + 1] = fr
  s.busy = true
  return fr
end
local function timer_stop(fr)
  local el = clock() - fr.t0
  rt.stack[#rt.stack] = nil
  fr.s.n.time = fr.s.n.time + (el - fr.child)
  fr.s.busy = false
  local parent = rt.stack[#rt.stack]
  if parent then parent.child = parent.child + el end
end

-------------------------------------------------------------------------------
-- Solvers
-------------------------------------------------------------------------------
local Solver = {}; Solver.__index = Solver
local Link = {}; Link.__index = Link
local Model = {}; Model.__index = Model
rt.Solver, rt.Link, rt.Model = Solver, Link, Model

local function join(frags, header)
  local t = {}
  for _, p in ipairs(frags) do t[#t + 1] = (header or "#program base.") .. "\n" .. FRAGMENTS[p] end
  return concat(t, "\n")
end
local function check_frags(what, name, frags)
  if type(frags) ~= "table" or #frags == 0 then fail(what .. " " .. name .. ": no fragments given") end
  for _, p in ipairs(frags) do
    if FRAGMENTS[p] == nil then fail(what .. " " .. name .. ": unknown fragment '" .. tostring(p) .. "'") end
  end
end
-- Where each fragment starts in the text that join(frags) builds: { {name, first, last}, ... }.
local function fragment_lines(frags)
  local out, line = {}, 1
  for _, p in ipairs(frags or {}) do
    local text = FRAGMENTS[p] or ""
    local _, nl = text:gsub("\n", "")
    out[#out + 1] = { name = p, first = line + 1, last = line + 1 + nl }
    line = line + 2 + nl
  end
  return out
end
-- Rewrites "<block>:L:C" in a clingo message to "fragment:L:C"; returns the text and the
-- first location found ({ fragment, line, col } or nil).
local function locate_message(msg, starts)
  local first
  local text = msg:gsub("<block>:(%d+):(%d+)(%-?[%d:]*)", function(l, c, rest)
    l = tonumber(l)
    for _, s in ipairs(starts) do
      if l >= s.first and l <= s.last then
        local line = l - s.first + 1
        if not first then first = { fragment = s.name, line = line, col = tonumber(c) } end
        local l2, c2 = rest:match("^%-(%d+):(%d+)$")
        if l2 then rest = "-" .. (tonumber(l2) - s.first + 1) .. ":" .. c2 end
        return s.name .. ":" .. line .. ":" .. c .. rest
      end
    end
    return nil
  end)
  return text, first
end
local function new_control(args, name, frags)
  local a = {}
  for _, o in ipairs(args or {}) do a[#a + 1] = o end
  a[#a + 1] = "--stats"
  for _, c in ipairs(CONSTS) do a[#a + 1] = "-c"; a[#a + 1] = c end
  if SETTINGS.seed ~= 0 then a[#a + 1] = "--seed=" .. SETTINGS.seed end
  local starts = fragment_lines(frags)
  return clingo.Control(a, function(code, msg)
    -- a Lua error here would cross a clingo frame: keep it inside pcall
    local ok = pcall(function()
      local text, at = locate_message((tostring(msg):gsub("\n+$", "")), starts)
      local w = { solver = name, code = tostring(code), message = text }
      if at then w.fragment, w.line, w.col = at.fragment, at.line, at.col end
      emit("W", w)
    end)
    if not ok then pcall(emit, "W", { solver = name, code = tostring(code), message = tostring(msg) }) end
  end, 20)
end

local function plain(c)
  local t = {}
  for k = 1, #c do t[k] = c[k] end
  return t
end

local function inject(s, init, q)
  for i = 1, #q do
    local c, lits = q[i], {}
    for j = 1, #c do lits[j] = init:solver_literal(c[j]) end
    if not init:add_clause(lits) then return end
  end
end

function rt.solver(name, frags, options)
  if type(name) ~= "string" then fail("rt.solver: the name must be a string") end
  for _, s in ipairs(rt.solvers) do if s.name == name then fail("solver " .. name .. " is declared twice") end end
  check_frags("solver", name, frags)
  if rt.prepared then fail("solver " .. name .. ": declare all solvers before rt.prepare()") end
  local s = setmetatable({ name = name, frags = frags, options = options or {}, grounded = false, out = {}, inn = {},
    k = 0, caps = {}, queue = {}, blocks = {}, stash = {}, busy = false, searching = false,
    n = { calls = 0, sat = 0, unsat = 0, time = 0, ground = 0 }, clasp = {} }, Solver)
  s.ctl = new_control(s.options, name, frags)
  s.hooks = {
    init = function(_, init)
      guarded(s, function()
        if #s.queue > 0 then local q = s.queue; s.queue = {}; inject(s, init, q) end
        if #s.blocks > 0 then local q = s.blocks; s.blocks = {}; rt.blocks = rt.blocks + #q; inject(s, init, q) end
        for _, L in ipairs(s.out) do
          local sl, src = L.slit, L.src
          for j = 1, L.n do sl[j] = init:solver_literal(src[j]) end
        end
      end)
    end,
    check = function(_, control)
      if rt.fatal or rt.ending then return end
      -- clasp may call check on a partial assignment after clauses were added in an earlier
      -- check; candidates are total assignments only
      if not control.assignment.is_total then return end
      -- stashed clauses: the 2nd, 3rd, ... clause of one reject
      if #s.stash > 0 then
        local conflict = false
        guarded(s, function()
          local st = s.stash
          for i = 1, #st do
            if not control:add_clause{ plain(st[i]), lock = true } then
              local rest = {}
              for j = i + 1, #st do rest[#rest + 1] = st[j] end
              s.stash = rest
              conflict = true
              return
            end
          end
          s.stash = {}
        end)
        if conflict or rt.fatal then return end
        -- an added clause may have changed the assignment; check runs again when it is total
        if not control.assignment.is_total then return end
      end
      local f = s.on_check
      if f then guarded(s, f, control) end
    end }
  s.ctl:register_propagator(s.hooks)
  for _, c in ipairs(rt.captures) do s.caps[c.key] = { name = c.name, arity = c.arity } end
  rt.solvers[#rt.solvers + 1] = s
  return s
end

function Solver:ground()
  if self.grounded then return end
  local t0 = clock()
  self.ctl:add("base", {}, join(self.frags))
  self.ctl:ground({ { "base", {} } })
  self.grounded = true
  self.n.ground = self.n.ground + (clock() - t0)
end

function Solver:resolve()
  for _, c in pairs(self.caps) do
    local lits, syms = {}, {}
    for atom in self.ctl.symbolic_atoms:by_signature(c.name, c.arity) do
      lits[#lits + 1] = atom.literal; syms[#syms + 1] = atom.symbol
    end
    c.lits, c.syms = lits, syms
  end
end

function rt.capture(pred, arity)
  local key = pred .. "/" .. arity
  for _, c in ipairs(rt.captures) do if c.key == key then return end end
  rt.captures[#rt.captures + 1] = { key = key, name = pred, arity = arity }
  for _, s in ipairs(rt.solvers) do s.caps[key] = { name = pred, arity = arity } end
  if rt.prepared then for _, s in ipairs(rt.solvers) do s:resolve() end end
end

function rt.prepare()
  if rt.prepared then fail("rt.prepare() may be called only once") end
  for _, s in ipairs(rt.solvers) do s:ground() end
  -- clause/3 in the target of a link is captured automatically (for G.clauses)
  for _, L in ipairs(rt.links) do
    local it = L.to.ctl.symbolic_atoms:by_signature("clause", 3)
    for _ in it do L.to.caps["clause/3"] = { name = "clause", arity = 3 }; break end
  end
  for _, s in ipairs(rt.solvers) do s:resolve() end
  rt.prepared = true
  local hs = array({})
  for _, s in ipairs(rt.solvers) do
    local n = 0
    for _ in s.ctl.symbolic_atoms:iter() do n = n + 1 end
    hs[#hs + 1] = { name = s.name, fragments = array(s.frags), options = array(s.options), atoms = n,
      rules = NULL, ground = s.n.ground }
  end
  local hl = array({})
  for _, L in ipairs(rt.links) do hl[#hl + 1] = { name = L.name, from = L.from.name, to = L.to.name, atoms = L.n } end
  emit("H", { solvers = hs, links = hl, settings = { solutions = SETTINGS.solutions, seconds = SETTINGS.seconds,
    candidates = SETTINGS.candidates, trace = SETTINGS.trace, seed = SETTINGS.seed, poll = SETTINGS.poll,
    constants = array(CONSTS) } })
end

-------------------------------------------------------------------------------
-- Links
-------------------------------------------------------------------------------
function rt.link(name, from, to, glue, opts)
  opts = opts or {}
  if getmetatable(from) ~= Solver or getmetatable(to) ~= Solver then fail("link " .. tostring(name) .. ": both ends must be solvers") end
  if from == to then fail("link " .. name .. ": a solver cannot be linked to itself") end
  for _, L in ipairs(rt.links) do if L.name == name then fail("link " .. name .. " is declared twice") end end
  check_frags("link", name, glue)
  if to.grounded then fail("link " .. name .. ": solver " .. to.name .. " was already grounded; declare links before using it") end
  local set, found = {}, false
  local g = new_control({ "1" }, name, glue)
  g:add("base", {}, join(glue))
  g:ground({ { "base", {} } })
  local h = g:solve{ yield = true }
  for m in h:iter() do
    for _, a in ipairs(m:symbols{ shown = true }) do
      if a.name == "glue" and #a.arguments == 1 and a.positive ~= false then set[tostring(a.arguments[1])] = true; found = true
      elseif opts.legacy then set[tostring(a)] = true; found = true end
    end
    break
  end
  h:close()
  if not found then
    fail("link " .. name .. ": the glue fragments derive no " .. (opts.legacy and "shown atom" or "glue/1 atom"))
  end
  from:ground()
  local L = setmetatable({ name = name, from = from, to = to, n = 0, src = {}, slit = {}, dst = {}, ind = {}, sym = {},
    str = {}, jof = {}, jstr = {}, buf = {}, vbuf = {}, legacy = opts.legacy, compat = opts.compat, facts = 0 }, Link)
  local b = to.ctl:backend()
  for atom in from.ctl.symbolic_atoms:iter() do
    local sym = atom.symbol
    local key = tostring(sym)
    if set[key] then
      local d = b:add_atom(sym)
      if atom.is_fact then
        b:add_rule{ head = { d }, body = {} }
        L.facts = L.facts + 1
      else
        local i = b:add_atom(clingo.Function("relevant", { sym }, true))
        b:add_rule{ head = { d }, body = {}, choice = true }
        if opts.compat then b:add_rule{ head = { i }, body = {}, choice = true } end
        local j = L.n + 1; L.n = j
        L.src[j] = atom.literal; L.dst[j] = d; L.ind[j] = i; L.sym[j] = sym; L.str[j] = key
        L.jof[d] = j; L.jstr[key] = j
      end
    end
  end
  b:close()
  from.out[#from.out + 1] = L
  to.inn[#to.inn + 1] = L
  rt.links[#rt.links + 1] = L
  return L
end

local function check_model(L, M, what, side)
  if getmetatable(M) ~= Model then fail(L.name .. "." .. what .. ": expected a model, got " .. tostring(M)) end
  local want = side == "from" and L.from or L.to
  if M.solver ~= want then
    fail(L.name .. "." .. what .. ": expected a model of " .. want.name .. ", got one of " .. M.solver.name)
  end
  if M[L] == nil then fail(L.name .. "." .. what .. ": the model has no values for link " .. L.name) end
end

function Link:of(M)
  check_model(self, M, "of", "from")
  local a, v, dst = self.buf, M[self], self.dst
  for j = 1, self.n do a[j] = v[j] and dst[j] or -dst[j] end
  return a
end

local function new_clause(L, lazy, m, x)
  return { link = L, lazy = lazy, m = m, x = x, j = {} }
end

function Link:clause(M, X)
  check_model(self, M, "clause", "from")
  check_model(self, X, "clause", "to")
  local v, r = M[self], X[self]
  local lits = M.lazy and self.slit or self.src
  local c = new_clause(self, M.lazy, M, X)
  local idx = c.j
  for j = 1, self.n do
    if r[j] then
      local k = #c + 1
      c[k] = v[j] and -lits[j] or lits[j]
      idx[k] = j
    end
  end
  if #c == 0 then fail("relevant/1 derived nothing for link " .. self.name) end
  return c
end

function Link:block(M)
  check_model(self, M, "block", "from")
  local v = M[self]
  local lits = M.lazy and self.slit or self.src
  local c = new_clause(self, M.lazy, M, nil)
  local idx = c.j
  for j = 1, self.n do c[j] = v[j] and -lits[j] or lits[j]; idx[j] = j end
  return c
end

function Link:core(S)
  if S ~= self.to then fail(self.name .. ".core: expected solver " .. self.to.name) end
  if not S.last_core then fail(self.name .. ".core: the last solve of " .. S.name .. " was not unsatisfiable") end
  local lazy = self.from.searching
  local lits = lazy and self.slit or self.src
  local c = new_clause(self, lazy, nil, nil)
  local seen = {}
  for _, l in ipairs(S.last_core) do
    local j = self.jof[abs(l)]
    if j and not seen[j] then
      seen[j] = true
      local k = #c + 1
      c[k] = l > 0 and -lits[j] or lits[j]
      c.j[k] = j
    end
  end
  if #c == 0 then fail(self.name .. ".core: the unsat core contains no atom of link " .. self.name) end
  return c
end

function Link:clauses(X)
  check_model(self, X, "clauses", "to")
  local atoms = X["clause/3"]
  if not atoms then fail(self.name .. ".clauses: solver " .. self.to.name .. " derives no clause/3 atoms") end
  local lazy = self.from.searching
  local lits = lazy and self.slit or self.src
  local out, byid = array({}), {}
  for _, a in ipairs(atoms) do
    local args = a.arguments
    local id, t, val = tostring(args[1]), tostring(args[2]), tostring(args[3])
    local j = self.jstr[t]
    if not j then fail(self.name .. ".clauses: " .. t .. " is not an interface atom of link " .. self.name) end
    if val ~= "true" and val ~= "false" then fail(self.name .. ".clauses: the third argument of clause/3 must be true or false, got " .. val) end
    local c = byid[id]
    if not c then c = new_clause(self, lazy, nil, X); byid[id] = c; out[#out + 1] = c end
    local k = #c + 1
    c[k] = val == "true" and lits[j] or -lits[j]
    c.j[k] = j
  end
  return out
end

-------------------------------------------------------------------------------
-- Models
-------------------------------------------------------------------------------
local function tracing() return rt.traced < SETTINGS.trace end

local function snapshot(s, m)
  local M = setmetatable({ solver = s }, Model)
  for _, L in ipairs(s.out) do
    local v, src = {}, L.src
    for j = 1, L.n do v[j] = m:is_true(src[j]) end
    M[L] = v
  end
  for _, L in ipairs(s.inn) do
    local r, ind = {}, L.ind
    for j = 1, L.n do r[j] = m:is_true(ind[j]) end
    M[L] = r
  end
  for key, c in pairs(s.caps) do
    local t, lits, syms = array({}), c.lits, c.syms
    if lits then for j = 1, #lits do if m:is_true(lits[j]) then t[#t + 1] = syms[j] end end end
    M[key] = t
    owner[t] = M
  end
  if #s.inn == 0 or tracing() then M.shown = tostring(m) end
  local cost = m.cost
  if cost and #cost > 0 then M.cost = cost end
  return M
end

function Model:atoms(pred, arity)
  local t = self[pred .. "/" .. tostring(arity)]
  if not t then fail("atoms(" .. pred .. "/" .. tostring(arity) .. "): not captured in solver " .. self.solver.name) end
  return t
end

-- The candidate as text: the true interface atoms over all outgoing links.
local function candidate_text(M)
  if not M then return nil end
  local t = {}
  for _, L in ipairs(M.solver.out) do
    local v = M[L]
    if v then for j = 1, L.n do if v[j] then t[#t + 1] = L.str[j] end end end
  end
  return concat(t, " ")
end
Model.__tostring = function(M) return M.shown or candidate_text(M) or "model" end

local function literal_texts(c)
  local L, out = c.link, array({})
  if not L then return out end
  for k = 1, #c do
    local j = c.j[k]
    if j then out[#out + 1] = (c[k] < 0 and "-" or "") .. L.str[j] end
  end
  return out
end

local function trace(kind, s, c, M, facts)
  if not tracing() then return end
  rt.traced = rt.traced + 1
  local x = c and c.x
  emit("T", { i = rt.traced, kind = kind, solver = s.name, candidate = candidate_text(M or (c and c.m)),
    counterexample = x and x.shown or nil, literals = c and literal_texts(c) or nil, facts = facts })
end

local function is_clause_list(c) return type(c) == "table" and type(c[1]) == "table" end

function Model:reject(c)
  if not self.lazy then fail("reject works only on a candidate inside search; use S.add between solves") end
  if self.done then fail("reject: the candidate is no longer valid (it belongs to an earlier step)") end
  local list = is_clause_list(c) and c or { c }
  if #list == 0 then fail("reject: the refinement is empty") end
  local s = self.solver
  for i, cl in ipairs(list) do
    if type(cl) ~= "table" or #cl == 0 then fail("reject: an empty clause cannot refine the candidate") end
    if cl.lazy == false then fail("reject: the clause was built from a model outside the search; use S.add") end
    count_clause(cl)
    trace("reject", s, cl, self)
    if not self.rejected and i == 1 then
      local ass = self.control.assignment
      for k = 1, #cl do
        if ass:value(cl[k]) ~= false then fail("refinement does not exclude the candidate") end
      end
      self.rejected = true
      self.control:add_clause{ plain(cl) }
    else
      self.rejected = true
      s.stash[#s.stash + 1] = cl
    end
  end
end

-------------------------------------------------------------------------------
-- Solving
-------------------------------------------------------------------------------
local function wanted_left()
  if SETTINGS.solutions == 0 then return 0 end
  return SETTINGS.solutions - rt.solutions
end

local function check_idle(s, what)
  if getmetatable(s) ~= Solver then fail(what .. ": not a solver") end
  if not rt.prepared then fail(s.name .. "." .. what .. ": call rt.prepare() first") end
  if s.busy then fail(s.name .. "." .. what .. ": the solver is busy (searching or solving)") end
end

local function convert_assumptions(a)
  if a == nil then return {} end
  if type(a) ~= "table" then fail("assume: expected a list of literals") end
  return a
end

-- Same candidate twice in a row on all outgoing links: the refinement made no progress.
local function progress_guard(s, X)
  if #s.out == 0 or #s.inn > 0 then return end
  local last = s.last_vals
  local vals = {}
  for i, L in ipairs(s.out) do vals[i] = X[L] end
  s.last_vals = vals
  if not last then return end
  for i, L in ipairs(s.out) do
    local a, b = last[i], vals[i]
    for j = 1, L.n do if a[j] ~= b[j] then return end end
  end
  fail("the refinement made no progress: the same candidate came back")
end

local function run_solve(s, o, limit, optimal)
  check_idle(s, "solve")
  o = o or {}
  local assume = convert_assumptions(o.assume)
  tick(rt.searching == nil)
  local fr = timer_start(s)
  s.n.calls = s.n.calls + 1
  s.last_core = nil
  local models = {}
  local conf = s.ctl.configuration.solve
  local saved
  if limit > 1 then saved = conf.models; conf.models = limit == math.huge and "0" or tostring(limit) end
  local h = s.ctl:solve{ assumptions = assume, yield = true }
  local ok, err = pcall(function()
    for m in h:iter() do
      local X = snapshot(s, m)
      if optimal then models[1] = X else models[#models + 1] = X end
      if not optimal and #models >= limit then break end
    end
  end)
  if ok and #models == 0 then
    local core = h:core()
    local c = {}
    if core then for i, l in ipairs(core) do c[i] = tointeger(l) or floor(l) end end
    s.last_core = c
  end
  h:close()
  if saved then conf.models = saved end
  timer_stop(fr)
  if not ok then error(err, 0) end
  reraise()
  if #models > 0 then s.n.sat = s.n.sat + 1 else s.n.unsat = s.n.unsat + 1 end
  if #assume > 0 then rt.counterexamples = rt.counterexamples + #models
  else rt.exhausted = (#models == 0) end
  if #s.inn == 0 then
    for _ = 1, #models do count_candidate() end
  end
  return models
end

function Solver:solve(o)
  local models = run_solve(self, o, 1, o and o.optimal)
  local X = models[1]
  if X then progress_guard(self, X); self.last_model = X end
  return X
end

function Solver:models(o)
  local limit = o and o.limit or 0
  if type(limit) ~= "number" then fail(self.name .. ".models: limit must be a number") end
  if limit <= 0 then limit = math.huge end
  return array(run_solve(self, o, limit, false))
end

function rt.concat(...)
  local out = {}
  for i = 1, select("#", ...) do
    local a = select(i, ...)
    if a ~= nil then
      if type(a) ~= "table" then fail("concat: expected lists of literals") end
      for j = 1, #a do out[#out + 1] = a[j] end
    end
  end
  return out
end

local function queue_clause(s, c)
  if type(c) ~= "table" or #c == 0 then fail(s.name .. ".add: an empty clause") end
  if c.lazy then fail(s.name .. ".add: the clause was built from a candidate inside a search; use reject") end
  if c.link and c.link.from ~= s then fail(s.name .. ".add: the clause belongs to solver " .. c.link.from.name) end
  local q = {}
  for k = 1, #c do q[k] = c[k] end
  s.queue[#s.queue + 1] = q
  count_clause(c)
  trace("add", s, c, c.m)
end

function Solver:add(c)
  if getmetatable(self) ~= Solver then fail("add: not a solver") end
  if self.busy then fail(self.name .. ".add: the solver is searching; use reject inside on candidate") end
  if is_clause_list(c) then for _, x in ipairs(c) do queue_clause(self, x) end else queue_clause(self, c) end
end

function Solver:expand(part, facts)
  check_idle(self, "expand")
  if type(part) ~= "string" then fail(self.name .. ".expand: the part name must be a string") end
  facts = facts or {}
  local t0 = clock()
  self.k = self.k + 1
  local k = clingo.Number(self.k)
  local names = {}
  for name in pairs(facts) do names[#names + 1] = name end
  table.sort(names)
  local texts = array({})
  local b = self.ctl:backend()
  local ok, err = pcall(function()
    for _, name in ipairs(names) do
      local atoms = facts[name]
      if type(atoms) ~= "table" then error(self.name .. ".expand: " .. name .. " must be a list of atoms", 0) end
      for _, a in ipairs(atoms) do
        if type(a) ~= "userdata" then error(self.name .. ".expand: " .. name .. " must be a list of atoms", 0) end
        b:add_rule{ head = { b:add_atom(clingo.Function(name, { k, a }, true)) }, body = {} }
        if #texts < 50 and tracing() then texts[#texts + 1] = name .. "(" .. self.k .. "," .. tostring(a) .. ")" end
      end
    end
  end)
  b:close()
  if not ok then error(err, 0) end
  self.ctl:ground({ { part, { k } } })
  self:resolve()
  rt.expansions = rt.expansions + 1
  self.n.ground = self.n.ground + (clock() - t0)
  if tracing() then
    local src
    for _, name in ipairs(names) do src = src or owner[facts[name]] end
    local M = self.last_model
    rt.traced = rt.traced + 1
    emit("T", { i = rt.traced, kind = "expand", solver = self.name, candidate = candidate_text(M),
      counterexample = src and src.shown or nil, facts = texts })
  end
end

local function emit_solution(atoms, cost)
  rt.solutions = rt.solutions + 1
  emit("M", { n = rt.solutions, atoms = atoms, cost = cost and array(cost) or nil })
end

function Solver:search(h)
  check_idle(self, "search")
  if rt.searching then fail(self.name .. ".search: a search is already running (" .. rt.searching.name .. ")") end
  if type(h) ~= "table" or type(h.on_candidate) ~= "function" then fail(self.name .. ".search: on_candidate is missing") end
  local s, f = self, h.on_candidate
  local want = wanted_left()
  if SETTINGS.solutions ~= 0 and want <= 0 then rt.finish("solutions", "", false) end
  s.ctl.configuration.solve.models = tostring(want)
  s.restart_requested = false
  local found = 0
  local block = SETTINGS.solutions ~= 1
  local cur
  s.on_check = function(control)
    tick(true)
    count_candidate()
    local ass = control.assignment
    local M = setmetatable({ solver = s, lazy = true, control = control, rejected = false }, Model)
    for _, L in ipairs(s.out) do
      local v, sl = L.vbuf, L.slit
      for j = 1, L.n do v[j] = ass:is_true(sl[j]) end
      M[L] = v
    end
    cur = M
    f(M)
    M.done = true
  end
  local on_model = function(m)
    if rt.fatal or rt.ending then return false end
    local ok = guarded(s, function()
      local cost = m.cost
      emit_solution(tostring(m), cost and #cost > 0 and cost or nil)
      found = found + 1
      if block then
        for _, L in ipairs(s.out) do
          local c, src = {}, L.src
          for j = 1, L.n do c[j] = m:is_true(src[j]) and -src[j] or src[j] end
          s.blocks[#s.blocks + 1] = c
        end
      end
    end)
    return ok
  end
  s.searching = true
  rt.searching = s
  local fr = timer_start(s)
  s.n.calls = s.n.calls + 1
  local res = s.ctl:solve{ on_model = on_model }
  timer_stop(fr)
  s.searching = false
  rt.searching = nil
  s.on_check = nil
  if cur then cur.done = true end
  -- clauses still stashed hold solver literals: keep them as program literals for the next solve
  if #s.stash > 0 then
    if s.restart_requested then
      for _, c in ipairs(s.stash) do
        local L = c.link
        if L then
          local q = {}
          for k = 1, #c do local j = c.j[k]; q[k] = c[k] < 0 and -L.src[j] or L.src[j] end
          s.queue[#s.queue + 1] = q
        end
      end
    end
    s.stash = {}
  end
  if not s.restart_requested then s.blocks = {} end
  reraise()
  if res.satisfiable then s.n.sat = s.n.sat + 1 elseif res.unsatisfiable then s.n.unsat = s.n.unsat + 1 end
  s.exhausted = (not res.interrupted) and not (want > 0 and found >= want)
  rt.exhausted = s.exhausted
  if SETTINGS.solutions ~= 0 and rt.solutions >= SETTINGS.solutions then rt.finish("solutions", "", false) end
  return s.exhausted
end

function rt.restart()
  local s = rt.searching
  if not s then fail("restart works only inside on candidate") end
  s.restart_requested = true
  rt.restarts = rt.restarts + 1
  s.ctl:interrupt()
end

function rt.accept(M)
  if getmetatable(M) ~= Model then fail("accept: expected a model") end
  if M.lazy then return end
  emit_solution(M.shown or candidate_text(M), M.cost)
  if SETTINGS.solutions ~= 0 and rt.solutions >= SETTINGS.solutions then rt.finish("solutions", "", false) end
end

function rt.stop(message)
  if message == nil then rt.finish("finished", "", rt.exhausted) end
  rt.finish("stopped", tostring(message), false)
end

function rt.count(name, n)
  n = n or 1
  if type(n) ~= "number" then fail("count " .. tostring(name) .. ": the amount must be a number") end
  if rt.counters[name] == nil then rt.counter_order[#rt.counter_order + 1] = name; rt.counters[name] = 0 end
  rt.counters[name] = rt.counters[name] + n
end

local function fmt(v)
  if type(v) == "table" and getmetatable(v) ~= Model and getmetatable(v) ~= Solver and getmetatable(v) ~= Link then
    local t = {}
    for i = 1, #v do t[i] = fmt(v[i]) end
    return "[" .. concat(t, ", ") .. "]"
  end
  if getmetatable(v) == Solver or getmetatable(v) == Link then return v.name end
  if v == nil then return "none" end
  return tostring(v)
end
function rt.log(...)
  local t = {}
  for i = 1, select("#", ...) do t[i] = fmt((select(i, ...))) end
  emit("L", { text = concat(t, " ") })
end

function rt.size(l) if type(l) ~= "table" then fail("size: not a list") end return #l end
function rt.push(l, x) if type(l) ~= "table" then fail("push: not a list") end l[#l + 1] = x end
function rt.clear(l) if type(l) ~= "table" then fail("clear: not a list") end for i = #l, 1, -1 do l[i] = nil end end
function rt.list() return {} end

-------------------------------------------------------------------------------
-- Running
-------------------------------------------------------------------------------
local function line_of(msg, tb)
  local lo, hi = (LOOP_LINES or {})[1], (LOOP_LINES or {})[2]
  local first
  for _, text in ipairs({ msg or "", tb or "" }) do
    for n in text:gmatch('%]:(%d+):') do
      n = tonumber(n)
      if lo and n >= lo and n <= hi then return n end
      if not first and text == msg then first = n end
    end
  end
  return first
end

function plain_table(d)
  local e = stats_event()
  print("")
  print(string.format("Outcome      : %s%s", d.outcome, d.detail ~= "" and (" (" .. d.detail .. ")") or ""))
  print(string.format("Solutions    : %d", e.solutions))
  print(string.format("Candidates   : %d", e.candidates))
  print(string.format("Refinements  : %d clauses, %d literals", e.clauses, e.literals))
  print(string.format("Expansions   : %d", e.expansions))
  print(string.format("Time         : %.3f s", e.t))
  for _, s in ipairs(rt.solvers) do
    local c = e.solvers[s.name]
    print(string.format("Solver %-6s: %d calls, %d sat, %d unsat, %.3f s", s.name, c.calls, c.sat, c.unsat, c.time))
  end
  for _, k in ipairs(rt.counter_order) do print(string.format("%-13s: %s", k, tostring(rt.counters[k]))) end
end

function rt.run(f)
  rt.t0 = clock()
  rt.last_s = rt.t0
  local ok, err = xpcall(f, errinfo)
  for _, s in ipairs(rt.solvers) do s.busy = false; s.searching = false end
  rt.stack = {}
  local outcome, detail, exhausted = "finished", "", rt.exhausted
  if not ok then
    if err == rt.END then
      local e = rt.ending or { outcome = "finished" }
      outcome, detail = e.outcome, e.detail or ""
      if e.outcome == "finished" then exhausted = rt.exhausted else exhausted = e.exhausted end
    else
      local msg, tb = tostring(err.message or err), err.traceback
      local line = line_of(msg, tb)
      msg = msg:gsub('^%[string "[^"]*"%]:%d+: ', "")
      emit("E", { message = msg, line = line, traceback = tb })
      outcome, detail, exhausted = "error", msg, nil
    end
  end
  if not SETTINGS.plain then send_stats() end
  if exhausted == nil then exhausted = NULL end
  emit("D", { outcome = outcome, exhausted = exhausted, detail = detail })
end

return rt
