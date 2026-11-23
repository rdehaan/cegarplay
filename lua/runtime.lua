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
rt.partials = 0          -- calls of on partial (G5)
rt.clauses, rt.literals, rt.maxlen = 0, 0, 0
rt.hist = { 0, 0, 0, 0, 0, 0, 0, 0 }
rt.expansions, rt.restarts, rt.blocks = 0, 0, 0
rt.counters, rt.counter_order = {}, {}
rt.tracked, rt.track_order, rt.track_n = {}, {}, {}
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
local kill_search   -- defined with Model:reject; used by the check hook of every solver
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
  local e = { t = clock() - rt.t0, candidates = rt.candidates, counterexamples = rt.counterexamples,
    solutions = rt.solutions, clauses = rt.clauses, literals = rt.literals, maxlen = rt.maxlen, hist = hist,
    expansions = rt.expansions, restarts = rt.restarts, blocks = rt.blocks, solvers = sv, counters = counters }
  if rt.partials > 0 then e.partials = rt.partials end
  if rt.labels and #rt.label_order > 0 then
    local lb = {}
    for k, v in pairs(rt.labels) do lb[k] = v end
    e.labels = lb
  end
  if rt.minimised then e.minimised = rt.minimised end
  if rt.core_hist then
    -- the lengths of the clauses made from cores, plain and minimised (same buckets as hist)
    local ch = { plain = array({}), minimal = array({}) }
    for i = 1, 8 do ch.plain[i] = rt.core_hist.plain[i]; ch.minimal[i] = rt.core_hist.minimal[i] end
    e.cores = ch
  end
  if #rt.track_order > 0 then
    local tr = {}
    for k, v in pairs(rt.tracked) do tr[k] = v end
    e.tracked = tr
  end
  if rt.stats_extra then rt.stats_extra(e) end
  return e
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
    -- the page paused the run: fresh statistics, then the read that blocks until resume or step
    if l == "pause" then send_stats(); l = io.read("l") end
    if l == "stop" then rt.finish("stopped", "stopped by user", false) end
  end
end
-- Called at the top of every loop body of the script: the time limit and the stop poll
-- in loops that make no solver call. Cheap: the real check runs every 256 iterations.
rt.ticks = 0
function rt.tick()
  local n = rt.ticks + 1
  if n < 256 then rt.ticks = n; return end
  rt.ticks = 0
  tick(true)
end
local function count_candidate()
  if SETTINGS.candidates > 0 and rt.candidates >= SETTINGS.candidates then
    rt.finish("limit", "candidate limit of " .. SETTINGS.candidates .. " reached", false)
  end
  rt.candidates = rt.candidates + 1
end

-- Timing with exclusive times: nested solve time is subtracted from the enclosing one.
local REC = nil           -- SETTINGS.record when recording (docs/spec-recording.md), set in rt.prepare
local record             -- defined with the recording helpers below (used earlier, in Link:clause)
local rng = 0            -- the state of the sample policy's generator (seeded in rt.prepare)
rt.calls = 0
local function timer_start(s)
  local fr = { s = s, t0 = clock(), child = 0 }
  if REC and REC.calls then
    rt.calls = rt.calls + 1
    fr.id = rt.calls
    local parent = rt.stack[#rt.stack]
    fr.parent = parent and parent.id or 0
  end
  rt.stack[#rt.stack + 1] = fr
  s.busy = true
  return fr
end
local call_event
local function timer_stop(fr, result)
  local el = clock() - fr.t0
  if fr.id and call_event then call_event(fr, el, result) end
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
-- An instance (docs/spec-instances.md) is delivered as the fragment "instance": every solver
-- and every link's glue control gets it first.
local function with_instance(frags)
  if FRAGMENTS.instance == nil or type(frags) ~= "table" then return frags end
  for _, p in ipairs(frags) do if p == "instance" then return frags end end
  local t = { "instance" }
  for _, p in ipairs(frags) do t[#t + 1] = p end
  return t
end
rt.with_instance = with_instance
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
        local trail = rest:match(":$") and ":" or ""
        if trail ~= "" then rest = rest:sub(1, -2) end
        local l2, c2 = rest:match("^%-(%d+):(%d+)$")
        if l2 then rest = "-" .. (tonumber(l2) - s.first + 1) .. ":" .. c2 end
        rest = rest .. trail
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
      local m = tostring(msg):gsub("\n+$", "")
      -- the internal body literal of a non-base part (as in js/driver.js cleanClingoMessage)
      m = m:gsub(":%-%[#inc_[^%]]*%]%.", "."):gsub("%[#inc_[^%]]*%];", ""):gsub(";%[#inc_[^%]]*%]", "")
      local text, at = locate_message(m, starts)
      local w = { solver = name, code = tostring(code), message = text }
      if at then w.fragment, w.line, w.col = at.fragment, at.line, at.col end
      emit("W", w)
    end)
    if not ok then pcall(emit, "W", { solver = name, code = tostring(code), message = tostring(msg) }) end
  end, 20)
end

rt.join, rt.new_control = join, new_control
rt.owner = owner

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
  frags = with_instance(frags)
  if rt.prepared then fail("solver " .. name .. ": declare all solvers before rt.prepare()") end
  local s = setmetatable({ name = name, frags = frags, options = options or {}, grounded = false, out = {}, inn = {},
    k = 0, caps = {}, queue = {}, blocks = {}, stash = {}, busy = false, searching = false,
    n = { calls = 0, sat = 0, unsat = 0, time = 0, ground = 0 }, clasp = {} }, Solver)
  s.ctl = new_control(s.options, name, frags)
  s.hooks = {
    init = function(_, init)
      -- on partial (G5): check at every propagation fixpoint, not only on total assignments
      local mode = (s.searching and s.on_partial) and clingo.PropagatorCheckMode.Fixpoint or clingo.PropagatorCheckMode.Total
      if init.check_mode ~= mode then init.check_mode = mode end
      guarded(s, function()
        if #s.queue > 0 then local q = s.queue; s.queue = {}; inject(s, init, q) end
        if #s.blocks > 0 then local q = s.blocks; s.blocks = {}; rt.blocks = rt.blocks + #q; inject(s, init, q) end
        for _, L in ipairs(s.out) do
          local sl, src = L.slit, L.src
          for j = 1, L.n do sl[j] = init:solver_literal(src[j]) end
        end
        -- captures, for M.atoms(p/n) on a candidate (searches only)
        for _, c in pairs(s.caps) do
          c.slits = nil
          if s.searching and c.lits then
            local sl, lits = {}, c.lits
            for j = 1, #lits do sl[j] = init:solver_literal(lits[j]) end
            c.slits = sl
          end
        end
      end)
    end,
    check = function(_, control)
      if rt.fatal or rt.ending then return end
      -- clasp may call check on a partial assignment after clauses were added in an earlier
      -- check, and calls it at every fixpoint when the search has an on partial hook (G5);
      -- candidates are total assignments, partial ones go to on_partial only
      local total = control.assignment.is_total
      if not total and not s.on_partial then return end
      if s.dead then guarded(s, kill_search, s, control); return end
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
        -- (or at the next fixpoint)
        if not total or not control.assignment.is_total then return end
      end
      local f = total and s.on_check or s.on_partial
      if f then guarded(s, f, control) end
    end }
  s.ctl:register_propagator(s.hooks)
  for _, c in ipairs(rt.captures) do s.caps[c.key] = { name = c.name, arity = c.arity } end
  rt.solvers[#rt.solvers + 1] = s
  s.index = #rt.solvers
  if rt.on_solver then rt.on_solver(s) end       -- lua/ground.lua: capture the ground program
  return s
end

-- Interface atoms reach the target through the backend (so that their literals are known at
-- once) and, again, as program text grounded with the target: a choice rule (or a fact). The
-- grounder does not treat atoms that only the backend added like atoms with a rule: a rule
-- with a variable that only such an atom binds, as in "b :- q(X).", got one instance instead
-- of one per atom (clingo 5.8; the check "b :- q(X). :- not b." then refuted candidates that
-- have q(2) but not q(1)). The text gives the grounder the same atoms with the same literals.
local function iface_text(S, atom, choice)
  S.iface = S.iface or { choice = {}, facts = {} }
  local t = choice and S.iface.choice or S.iface.facts
  t[#t + 1] = atom
end
local iface_parts = 0
-- The pending interface text of S as a program part to ground (its name), or nil.
local function iface_part(S)
  local p = S.iface
  if not p or (#p.choice == 0 and #p.facts == 0) then return nil end
  S.iface = nil
  local lines = {}
  if #p.choice > 0 then lines[#lines + 1] = "{ " .. concat(p.choice, "; ") .. " }." end
  for _, a in ipairs(p.facts) do lines[#lines + 1] = a .. "." end
  iface_parts = iface_parts + 1
  local name = "cegarplay_iface_" .. iface_parts
  S.ctl:add(name, {}, concat(lines, "\n"))
  return name
end
rt.iface_part = iface_part

function Solver:ground()
  if self.grounded then return end
  local t0 = clock()
  self.ctl:add("base", {}, join(self.frags))
  local parts = { { "base", {} } }
  local ip = iface_part(self)
  if ip then parts[2] = { ip, {} } end
  self.ctl:ground(parts)
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
  if type(SETTINGS.record) == "table" then
    REC = SETTINGS.record
    rng = (SETTINGS.seed or 0) % 2147483648
    local links = array({})
    for _, L in ipairs(rt.links) do
      local atoms = array({})
      for j = 1, L.n do atoms[j] = L.str[j] end
      links[#links + 1] = { link = L.name, from = L.from.name, to = L.to.name, atoms = atoms }
    end
    local solvers = array({})
    for _, x in ipairs(rt.solvers) do solvers[#solvers + 1] = x.name end
    emit("I", { links = links, solvers = solvers, record = REC })
    -- proof logs (docs/spec-soundness.md section 6): the symbolic atoms of every check solver,
    -- the table over which R events give a counterexample as hex (x)
    if REC.proof then
      for _, x in ipairs(rt.solvers) do
        if #x.inn > 0 then
          local atoms, lits, facts = array({}), {}, {}
          for a in x.ctl.symbolic_atoms:iter() do
            atoms[#atoms + 1] = tostring(a.symbol); lits[#atoms] = a.literal; facts[#atoms] = a.is_fact
          end
          x.qtable = { lits = lits, facts = facts, n = #atoms }
          emit("Q", { solver = x.name, atoms = atoms })
        end
      end
    end
  end
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
  glue = with_instance(glue)
  if to.grounded then fail("link " .. name .. ": solver " .. to.name .. " was already grounded; declare links before using it") end
  local set, found = {}, false
  local gargs = { "1" }
  for _, c in ipairs(opts.consts or {}) do gargs[#gargs + 1] = "-c"; gargs[#gargs + 1] = c end
  local g = new_control(gargs, name, glue)
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
    -- a glue with a parameterised part may start empty: G.extend adds its atoms later
    local grows = false
    for _, f in ipairs(glue) do if (FRAGMENTS[f] or ""):match("#program%s+[%a_][%w_]*%s*%(") then grows = true end end
    if not grows then fail("link " .. name .. ": the glue fragments derive no " .. (opts.legacy and "shown atom" or "glue/1 atom")) end
  end
  from:ground()
  local glue_ctl, glue_set = g, set
  local L = setmetatable({ name = name, from = from, to = to, n = 0, src = {}, slit = {}, dst = {}, ind = {}, sym = {},
    str = {}, jof = {}, jstr = {}, vbuf = {}, legacy = opts.legacy, compat = opts.compat, lifting = opts.lift, facts = 0 }, Link)
  if opts.lift and not rt.LIFT then fail("link " .. name .. ": lift needs lua/ground.lua (it is loaded for scripts with a lift link)") end
  L.glue_ctl, L.glue_set = glue_ctl, glue_set
  local b = to.ctl:backend()
  for atom in from.ctl.symbolic_atoms:iter() do
    local sym = atom.symbol
    local key = tostring(sym)
    if set[key] then
      local d = b:add_atom(sym)
      if atom.is_fact then
        b:add_rule{ head = { d }, body = {} }
        iface_text(to, key, false)
        L.facts = L.facts + 1
        L.fsym = L.fsym or {}
        L.fsym[#L.fsym + 1] = sym
      else
        local i = b:add_atom(clingo.Function("relevant", { sym }, true))
        b:add_rule{ head = { d }, body = {}, choice = true }
        if opts.compat then b:add_rule{ head = { i }, body = {}, choice = true } end
        iface_text(to, key, true)
        if opts.compat then iface_text(to, "relevant(" .. key .. ")", true) end
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
  L.index = #rt.links
  return L
end

-- Lists of literals made by G(M) (and rt.concat) -> the links they belong to (A.solve checks them).
local list_links = setmetatable({}, { __mode = "k" })

local function stale(what, keep)
  fail(what .. ": the candidate is no longer valid (it belongs to an earlier step); store " .. keep .. " instead")
end

local function check_model(L, M, what, side)
  if getmetatable(M) ~= Model then fail(L.name .. "." .. what .. ": expected a model, got " .. tostring(M)) end
  if M.lazy and M.done then stale(L.name .. "." .. what, L.name .. "(M) or a counterexample") end
  local want = side == "from" and L.from or L.to
  if M.solver ~= want then
    fail(L.name .. "." .. what .. ": expected a model of " .. want.name .. ", got one of " .. M.solver.name)
  end
  if M[L] == nil then fail(L.name .. "." .. what .. ": the model has no values for link " .. L.name) end
  if M.partial and side == "from" and what ~= "of" then
    fail(L.name .. "." .. what .. " needs a total candidate; on a partial candidate use " .. L.name .. ".clause(X), " .. L.name .. ".clauses(X) or a core")
  end
end

function Link:of(M, fill)
  check_model(self, M, "of", "from")
  if fill ~= nil and type(fill) ~= "boolean" then fail(self.name .. "(M, v): v must be true or false (the value of the atoms a partial candidate leaves open)") end
  -- a fresh list: a stored G(M) keeps its values after the candidate is gone
  local a, v, dst = {}, M[self], self.dst
  if M.partial and fill == nil then
    -- a partial candidate: the assigned atoms only (G5)
    for j = 1, self.n do if v[j] ~= nil then a[#a + 1] = v[j] and dst[j] or -dst[j] end end
  elseif M.partial then
    -- G(P, v): the open atoms get the value v, a total candidate that completes P
    for j = 1, self.n do local x = v[j]; if x == nil then x = fill end; a[j] = x and dst[j] or -dst[j] end
  else
    for j = 1, self.n do a[j] = v[j] and dst[j] or -dst[j] end
  end
  list_links[a] = { self }
  return a
end

local function new_clause(L, lazy, m, x)
  return { link = L, lazy = lazy, m = m, x = x, j = {} }
end
rt.new_clause = new_clause

local candidate_text   -- defined below, with the trace helpers

function Link:clause(M, X)
  if M == nil then
    -- G.clause(X): the relevant atoms of X with the values X saw; an empty clause is legal
    check_model(self, X, "clause", "to")
    local r, val = X[self], X.ival and X.ival[self]
    if not val then fail(self.name .. ".clause(X): the model has no interface values of link " .. self.name) end
    local lazy = self.from.searching and true or false
    local lits = lazy and self.slit or self.src
    local c = new_clause(self, lazy, nil, X)
    for j = 1, self.n do
      if r[j] then local k = #c + 1; c[k] = val[j] and -lits[j] or lits[j]; c.j[k] = j end
    end
    c.empty_ok = true
    return c
  end
  check_model(self, M, "clause", "from")
  check_model(self, X, "clause", "to")
  if self.lifting then return rt.LIFT.lift(self, M, X) end
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
  if #c == 0 then
    -- show the step in the trace (even past the trace cap), then fail
    pcall(function()
      emit("T", { i = rt.traced + 1, kind = "error", solver = M.solver.name, candidate = candidate_text(M),
        counterexample = X.shown, literals = array({}) })
      if REC then record("x", M.solver, nil, M) end
    end)
    fail("relevant/1 derived nothing for link " .. self.name)
  end
  return c
end

-- Growing programs (phase L3) ------------------------------------------------------------
-- S.ground(part, n): grounds #program part(t). of S with t = n.
local function idle(S, what)
  if not rt.prepared then fail(S.name .. "." .. what .. ": call rt.prepare() first") end
  if S.busy then fail(S.name .. "." .. what .. ": the solver is busy (searching or solving)") end
end
function Solver:ground_part(part, n)
  idle(self, "ground")
  if type(part) ~= "string" or not part:match("^[a-z_][A-Za-z0-9_]*$") then fail(self.name .. ".ground: the first argument is the name of a program part") end
  if math.type(n) ~= "integer" then fail(self.name .. ".ground: the parameter must be a whole number") end
  self:ground()
  local t0 = clock()
  local parts = { { part, { clingo.Number(n) } } }
  local ip = iface_part(self)
  if ip then parts[2] = { ip, {} } end
  self.ctl:ground(parts)
  self:resolve()
  self.n.ground = self.n.ground + (clock() - t0)
end
-- G.extend(part, n): grounds the same part in the glue; each new glue(T) atom becomes an
-- interface atom of G (a choice of the target with its relevant atom, or a fact when T is a
-- fact of the source). Ground the source's part first and the target's after.
function Link:extend(part, n)
  local A, C = self.from, self.to
  if A.busy or C.busy then fail(self.name .. ".extend: a solver of the link is busy") end
  if type(part) ~= "string" or not part:match("^[a-z_][A-Za-z0-9_]*$") then fail(self.name .. ".extend: the first argument is the name of a program part") end
  if math.type(n) ~= "integer" then fail(self.name .. ".extend: the parameter must be a whole number") end
  local g, set = self.glue_ctl, self.glue_set
  g:ground({ { part, { clingo.Number(n) } } })
  local h = g:solve{ yield = true }
  local new = {}
  for m in h:iter() do
    for _, a in ipairs(m:symbols{ shown = true }) do
      local key
      if a.name == "glue" and #a.arguments == 1 and a.positive ~= false then key = tostring(a.arguments[1]) elseif self.legacy then key = tostring(a) end
      if key and not set[key] then set[key] = true; new[key] = true end
    end
    break
  end
  h:close()
  local b = C.ctl:backend()
  local added = 0
  for atom in A.ctl.symbolic_atoms:iter() do
    local sym = atom.symbol
    local key = tostring(sym)
    if new[key] then
      local d = b:add_atom(sym)
      if atom.is_fact then
        b:add_rule{ head = { d }, body = {} }
        iface_text(C, key, false)
        self.facts = self.facts + 1
        self.fsym = self.fsym or {}
        self.fsym[#self.fsym + 1] = sym
      else
        local i = b:add_atom(clingo.Function("relevant", { sym }, true))
        b:add_rule{ head = { d }, body = {}, choice = true }
        if self.compat then b:add_rule{ head = { i }, body = {}, choice = true } end
        iface_text(C, key, true)
        if self.compat then iface_text(C, "relevant(" .. key .. ")", true) end
        local j = self.n + 1; self.n = j
        self.src[j] = atom.literal; self.dst[j] = d; self.ind[j] = i; self.sym[j] = sym; self.str[j] = key
        self.jof[d] = j; self.jstr[key] = j
        added = added + 1
      end
    end
  end
  b:close()
  self.exact = nil                       -- level 4's scratch controls are for the old interface
  -- recordings: the interface atoms changed, so the I event is sent again (the last one counts)
  if REC and added > 0 then
    local links = array({})
    for _, L in ipairs(rt.links) do
      local atoms = array({})
      for j = 1, L.n do atoms[j] = L.str[j] end
      links[#links + 1] = { link = L.name, from = L.from.name, to = L.to.name, atoms = atoms }
    end
    local solvers = array({})
    for _, x in ipairs(rt.solvers) do solvers[#solvers + 1] = x.name end
    emit("I", { links = links, solvers = solvers, record = REC })
  end
  return added
end
-- Externals: S.set(a, true | false), S.release(a); a is S.atom(...) or a literal.
local function external_of(S, a, what)
  local l = type(a) == "table" and a[1] or a
  if math.type(l) ~= "integer" then fail(S.name .. "." .. what .. ": expected an atom such as " .. S.name .. ".atom(\"frame\", t)") end
  local ok = false
  for x in S.ctl.symbolic_atoms:iter() do if x.literal == l then ok = x.is_external; break end end
  if not ok then fail(S.name .. "." .. what .. ": the atom is not an #external atom of " .. S.name) end
  return l
end
function Solver:set(a, v)
  idle(self, "set")
  local l = external_of(self, a, "set")
  self.ctl:assign_external(l, v and true or false)
end
function Solver:release(a)
  idle(self, "release")
  local l = external_of(self, a, "release")
  self.ctl:release_external(l)
end

-- The values of a model of the source, or of a list G(M) (literals of the target).
local function values_of(L, x, what)
  if getmetatable(x) == Model then
    check_model(L, x, what, "from")
    return x[L], x.lazy and true or false, x
  end
  if type(x) ~= "table" then fail(L.name .. "." .. what .. ": expected a model or a list " .. L.name .. "(M)") end
  local v = {}
  for _, l in ipairs(x) do
    local j = L.jof[abs(l)]
    if not j then fail(L.name .. "." .. what .. ": the list has a literal that is not an atom of link " .. L.name) end
    v[j] = l > 0
  end
  for j = 1, L.n do if v[j] == nil then fail(L.name .. "." .. what .. ": the list does not give every atom of link " .. L.name) end end
  return v, L.from.searching and true or false, nil
end
-- G.above(M): removes M and every superset of its true atoms; G.below(M): M and every subset.
function Link:above(x)
  local v, lazy, M = values_of(self, x, "above")
  local lits = lazy and self.slit or self.src
  local c = new_clause(self, lazy, M, nil)
  for j = 1, self.n do if v[j] then local k = #c + 1; c[k] = -lits[j]; c.j[k] = j end end
  c.empty_ok = true
  return c
end
function Link:below(x)
  local v, lazy, M = values_of(self, x, "below")
  local lits = lazy and self.slit or self.src
  local c = new_clause(self, lazy, M, nil)
  for j = 1, self.n do if not v[j] then local k = #c + 1; c[k] = lits[j]; c.j[k] = j end end
  c.empty_ok = true
  return c
end

-- C.core: the whole core of the last solve of C; core.on(G) keeps the atoms of link G.
-- A core is also a list: its elements are the literals the solver was assumed (target literals,
-- as in G(M)), so `for a in C.core`, E.flip(a) and E.without(a) work on them (phase B1).
local Core = {}
Core.__index = function(t, k)
  if math.type(k) == "integer" then return rawget(t, "lits")[k] end
  return Core[k]
end
Core.__len = function(t) return #rawget(t, "lits") end
rt.Core = Core
-- core.on(G): the atoms of the core that G knows, by name (also when G does not end at the
-- core's solver: a core along a chain, phase L4), as a clause for G's source.
function Core:on(G)
  if getmetatable(G) ~= Link then fail("core.on: expected a link") end
  -- (G ending at the core's solver: as G.core(C), but an empty clause is a value, not an error:
  -- `if K.size == 0` then tells that the core lies outside G, e.g. hard clauses alone)
  -- a core value is counted once, however often .on(G) is asked (K.on(G).size, then A.add(K.on(G)))
  local first = not rawget(self, "counted")
  rawset(self, "counted", true)
  if G.to == self.solver and #G:core_lits(rawget(self, "lits")) > 0 then return G:core(self.solver, rawget(self, "lits"), rawget(self, "minimal"), not first) end
  local lazy = G.from.searching and true or false
  local lits = lazy and G.slit or G.src
  local c = new_clause(G, lazy, nil, nil)
  local seen = {}
  for _, l in ipairs(self.lits) do
    for _, L in ipairs(self.solver.inn) do
      local j0 = L.jof[abs(l)]
      if j0 then
        local j = G.jstr[L.str[j0]]
        if j and not seen[j] then
          seen[j] = true
          local k = #c + 1
          c[k] = l > 0 and -lits[j] or lits[j]
          c.j[k] = j
        end
        break
      end
    end
  end
  c.empty_ok = true
  if #c > 0 and first then rt.core_stat(#c, rawget(self, "minimal")) end
  return c
end
function Solver:core()
  if not self.last_core then fail(self.name .. ".core: the last solve of " .. self.name .. " was not unsatisfiable") end
  return setmetatable({ solver = self, lits = self.last_core }, Core)
end

-- C.core.minimal: a subset-minimal core, by deletion. Each assumption is left out in turn; when
-- the rest is still unsatisfiable it goes, and the smaller core of that solve replaces the rest
-- (clause-set refinement). The extra solves count as calls of the solver, not as
-- counterexamples, and leave its last core alone.
local function core_of(s, assume)
  if s.dead then return {} end
  tick(rt.searching == nil)
  local fr = timer_start(s)
  s.n.calls = s.n.calls + 1
  local h = s.ctl:solve{ assumptions = assume, yield = true }
  local sat, core = false, nil
  local ok, err = pcall(function()
    for _ in h:iter() do sat = true; break end
    if not sat then
      local c = h:core()
      core = {}
      if c then for i, l in ipairs(c) do core[i] = tointeger(l) or floor(l) end end
    end
  end)
  h:close()
  timer_stop(fr, not ok and "int" or sat and "sat" or "unsat")
  if not ok then error(err, 0) end
  reraise()
  if sat then s.n.sat = s.n.sat + 1 else s.n.unsat = s.n.unsat + 1 end
  return core
end
function Core:minimal()
  local s = self.solver
  if s.busy then fail(s.name .. ".core.minimal: the solver is busy (searching or solving)") end
  local K = {}
  for i, l in ipairs(rawget(self, "lits")) do K[i] = l end
  local i = 1
  while i <= #K do
    local trial = {}
    for j = 1, #K do if j ~= i then trial[#trial + 1] = K[j] end end
    local c = core_of(s, trial)
    if c then
      -- still unsatisfiable without K[i]: keep only what this core needs (a subset of trial,
      -- in trial's order); the element now at position i is tried next
      local need = {}
      for _, l in ipairs(c) do need[l] = true end
      K = {}
      for _, l in ipairs(trial) do if need[l] then K[#K + 1] = l end end
    else
      i = i + 1
    end
  end
  rt.minimised = (rt.minimised or 0) + 1
  return setmetatable({ solver = s, lits = K, minimal = true }, Core)
end
function rt.minimal(K)
  if getmetatable(K) ~= Core then fail("minimal: expected a core, as in C.core.minimal") end
  return K:minimal()
end

-- S.atom(name, args...): the literal of an atom of S, as a one-element list of assumptions.
function Solver:atom(name, ...)
  if type(name) ~= "string" or not name:match("^[a-z_][A-Za-z0-9_']*$") then fail(self.name .. ".atom: the first argument is a predicate name") end
  local args = {}
  for i, a in ipairs({ ... }) do
    if math.type(a) == "integer" then args[i] = clingo.Number(a)
    elseif type(a) == "string" and a:match("^[a-z_][A-Za-z0-9_']*$") then args[i] = clingo.Function(a, {}, true)
    elseif type(a) == "string" then args[i] = clingo.String(a)
    elseif type(a) == "userdata" then args[i] = a
    else fail(self.name .. ".atom: argument " .. i .. " must be a number, a name or an atom") end
  end
  self:ground()
  local sym = clingo.Function(name, args, true)
  local at = self.ctl.symbolic_atoms:lookup(sym)
  if not at then fail(self.name .. ".atom: solver " .. self.name .. " has no atom " .. tostring(sym)) end
  return array({ at.literal })
end

-- Lists of assumptions as values: a.true, E.flip(a), E.without(a).
function rt.atrue(a)
  if type(a) ~= "number" then fail("a.true: expected an atom of a list such as G(M)") end
  return a > 0
end
local function list_copy(E, what)
  if type(E) ~= "table" then fail(what .. ": expected a list such as G(M)") end
  local out = {}
  for i = 1, #E do out[i] = E[i] end
  list_links[out] = list_links[E]
  return out
end
local NOT_IN = " (the atoms of a clause belong to the solver it refines; for the assumptions of a check, walk G(M) or C.core)"
function rt.flip(E, a)
  local out = list_copy(E, "flip")
  for i = 1, #out do if out[i] == a then out[i] = -a; return out end end
  fail("flip: the atom is not in the list" .. NOT_IN)
end
function rt.without(E, a)
  local out = list_copy(E, "without")
  for i = 1, #out do if out[i] == a then table.remove(out, i); return out end end
  fail("without: the atom is not in the list" .. NOT_IN)
end
-- for x in e: e must be a list (a plain list, G(M), a clause, a core, atoms); a model, a solver,
-- a link, none, a number or a string is an error instead of zero rounds (phase B1).
function rt.each(l)
  local mt = getmetatable(l)
  if type(l) == "table" and (mt == nil or mt == ARRAY or mt == Core) then return ipairs(l) end
  local what = l == nil and "none" or mt == Model and "a model (use X.atoms(p/n))" or mt == Solver and "a solver"
    or mt == Link and "a link" or type(l) == "table" and "not a list" or "a " .. type(l)
  fail("for: expected a list, got " .. what)
end

-- Model reads: X.value(p/1) (the argument of the one true atom), X.count(p/n), X.cost, a.arg(i).
local function plain_value(sym)
  if sym.type == clingo.SymbolType.Number then return sym.number end
  if sym.type == clingo.SymbolType.String then return sym.string end
  return tostring(sym)
end
function Model:value(pred, arity)
  local t = self:atoms(pred, arity)
  if #t ~= 1 then fail("X.value(" .. pred .. "/" .. arity .. "): expected one true atom, found " .. #t) end
  local a = t[1].arguments
  if #a == 0 then return true end
  return plain_value(a[1])
end
function Model:count(pred, arity) return #self:atoms(pred, arity) end
function rt.cost(X)
  if getmetatable(X) ~= Model then fail("X.cost: expected a model") end
  local c = X.cost
  if not c then return NULL end
  if #c == 1 then return c[1] end
  return array(c)
end
function rt.arg(a, i)
  if type(a) ~= "userdata" then fail("a.arg(i): expected an atom") end
  local args = a.arguments
  if math.type(i) ~= "integer" or i < 1 or i > #args then fail("a.arg(" .. tostring(i) .. "): the atom " .. tostring(a) .. " has " .. #args .. " arguments") end
  return plain_value(args[i])
end

-- G.lift(M, X): a clause computed from the ground programs (lua/ground.lua), on any link.
function Link:lift(M, X)
  check_model(self, M, "lift", "from")
  check_model(self, X, "lift", "to")
  if not rt.LIFT then fail(self.name .. ".lift needs lua/ground.lua") end
  return rt.LIFT.lift(self, M, X)
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

-- the literals of a core that are atoms of the link
function Link:core_lits(lits)
  local out = {}
  for _, l in ipairs(lits) do if self.jof[abs(l)] then out[#out + 1] = l end end
  return out
end
function Link:core(S, core_lits, minimal, uncounted)
  if S ~= self.to then fail(self.name .. ".core: expected solver " .. self.to.name) end
  if not core_lits and not S.last_core then fail(self.name .. ".core: the last solve of " .. S.name .. " was not unsatisfiable") end
  local lazy = self.from.searching
  local lits = lazy and self.slit or self.src
  local c = new_clause(self, lazy, nil, nil)
  local seen = {}
  -- core_lits: the literals of a core value (core.on(G), also a minimised core); else the last core
  for _, l in ipairs(core_lits or S.last_core) do
    local j = self.jof[abs(l)]
    if j and not seen[j] then
      seen[j] = true
      local k = #c + 1
      c[k] = l > 0 and -lits[j] or lits[j]
      c.j[k] = j
    end
  end
  if #c == 0 then fail(self.name .. ".core: the unsat core contains no atom of link " .. self.name) end
  if not uncounted then rt.core_stat(#c, minimal) end
  return c
end

-- the length of a clause made from a core, for the Statistics tab (S event: cores)
function rt.core_stat(n, minimal)
  if not rt.core_hist then rt.core_hist = { plain = { 0, 0, 0, 0, 0, 0, 0, 0 }, minimal = { 0, 0, 0, 0, 0, 0, 0, 0 } } end
  local h = minimal and rt.core_hist.minimal or rt.core_hist.plain
  local b = bucket(n); h[b] = h[b] + 1
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
    local r, ind, val, dst = {}, L.ind, {}, L.dst
    for j = 1, L.n do r[j] = m:is_true(ind[j]); val[j] = m:is_true(dst[j]) end
    M[L] = r
    -- the interface values the target saw (for G.clause(X) from the counterexample alone)
    M.ival = M.ival or {}
    M.ival[L] = val
  end
  for key, c in pairs(s.caps) do
    local t, lits, syms = array({}), c.lits, c.syms
    if lits then for j = 1, #lits do if m:is_true(lits[j]) then t[#t + 1] = syms[j] end end end
    M[key] = t
    owner[t] = M
  end
  if #s.inn == 0 or tracing() then M.shown = tostring(m) end
  if s.truth and #s.inn > 0 then M.tv = s.truth(m) end
  local cost = m.cost
  if cost and #cost > 0 then M.cost = cost end
  return M
end

function Model:atoms(pred, arity)
  local key = pred .. "/" .. tostring(arity)
  local t = self[key]
  if t then return t end
  if self.lazy then
    -- a candidate inside search: built on demand from the assignment (solver literals of
    -- the capture are mapped in the init hook of a searching solver)
    if self.done then stale("atoms(" .. key .. ")", "the list of M.atoms(" .. key .. ")") end
    local c = self.solver.caps[key]
    if c and c.slits then
      local ass, sl, syms = self.control.assignment, c.slits, c.syms
      t = array({})
      for j = 1, #sl do if ass:is_true(sl[j]) then t[#t + 1] = syms[j] end end
      self[key] = t
      owner[t] = self
      return t
    end
  end
  fail("atoms(" .. key .. "): not captured in solver " .. self.solver.name)
end

-- The candidate as text: the true interface atoms over all outgoing links.
candidate_text = function(M)
  if not M then return nil end
  if M.lazy and M.done then return "(a candidate of an earlier step)" end
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
  -- The sign is relative to the atom's own literal: an atom fixed by the solver has the
  -- literal 1 or -1 there, so the sign of c[k] alone says nothing about the atom.
  local lits = c.lazy and L.slit or L.src
  for k = 1, #c do
    local j = c.j[k]
    if j then out[#out + 1] = (c[k] == lits[j] and "" or "-") .. L.str[j] end
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

-------------------------------------------------------------------------------
-- Recording: compact events I, R and C (docs/spec-recording.md). Only with SETTINGS.record.
-------------------------------------------------------------------------------
-- The program line of the innermost loop statement on the stack (mapped to the script by the page).
local function loop_line()
  local lo, hi = (LOOP_LINES or {})[1], (LOOP_LINES or {})[2]
  if not lo then return NULL end
  for level = 3, 40 do
    local info = debug.getinfo(level, "l")
    if not info then break end
    local l = info.currentline
    if l and l >= lo and l <= hi then return l end
  end
  return NULL
end
rt.loop_line = loop_line

-- A boolean vector as hex: atom j is bit (j - 1) % 4 of digit (j - 1) // 4, digits written
-- most significant first (so the last character holds atoms 1 to 4).
local hexdigit = { [0] = "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f" }
local fmt_hex = {}
local function hexvec(v, n)
  if n <= 60 then
    local x = 0
    for j = 1, n do if v[j] then x = x | (1 << (j - 1)) end end
    local f = fmt_hex[n]
    if not f then f = "%0" .. ((n + 3) // 4) .. "x"; fmt_hex[n] = f end
    return string.format(f, x)
  end
  local t, k = {}, 0
  for j = 1, n, 4 do
    local d = 0
    if v[j] then d = 1 end
    if v[j + 1] and j + 1 <= n then d = d + 2 end
    if v[j + 2] and j + 2 <= n then d = d + 4 end
    if v[j + 3] and j + 3 <= n then d = d + 8 end
    k = k + 1
    t[k] = hexdigit[d]
  end
  return string.reverse(concat(t))
end
rt.hexvec = hexvec

rt.recorded = 0          -- R events seen (the step number i)
local ring, ring_n = {}, 0
local function rec_rand(n)          -- a small LCG: the sample is the same for the same seed
  rng = (rng * 1103515245 + 12345) % 2147483648
  return rng % n + 1
end
-- Send or keep one R line according to the policy.
-- The R line, written by hand (the generic encoder sorts keys: too slow for every step).
local function rline(o)
  local t = { '@@R {"i":', o.i, ',"k":"', o.k, '","s":', json(o.s), ',"l":', json(o.l), ',"n":', json(o.n),
    ',"t":', jnum(o.t) }
  if o.c then t[#t + 1] = ',"c":"'; t[#t + 1] = o.c; t[#t + 1] = '"' end
  if o.q then t[#t + 1] = ',"q":['; t[#t + 1] = concat(o.q, ","); t[#t + 1] = "]" end
  if o.f then t[#t + 1] = ',"f":'; t[#t + 1] = json(o.f) end
  if o.d then t[#t + 1] = ',"d":'; t[#t + 1] = json(o.d) end
  if o.x then t[#t + 1] = ',"x":"'; t[#t + 1] = o.x; t[#t + 1] = '"' end
  if o.v ~= nil then t[#t + 1] = ',"v":'; t[#t + 1] = json(o.v) end
  t[#t + 1] = "}"
  return concat(t)
end
local function rec_emit(obj)
  local i = rt.recorded + 1
  rt.recorded = i
  obj.i = i
  local pol, n = REC.steps, REC.n or 0
  if pol == "all" then print(rline(obj))
  elseif pol == "first" then if i <= n then print(rline(obj)) end
  elseif pol == "every" then if n <= 1 or (i - 1) % n == 0 then print(rline(obj)) end
  elseif pol == "last" then
    if n > 0 then ring_n = ring_n % n + 1; ring[ring_n] = rline(obj) end
  elseif pol == "sample" then
    if n > 0 then
      if i <= n then ring[i] = rline(obj)
      else local r = rec_rand(i); if r <= n then ring[r] = rline(obj) end end
    end
  end
end
-- Kept lines of the policies last and sample, in step order, before the final S event.
local function rec_flush()
  if not REC or (REC.steps ~= "last" and REC.steps ~= "sample") then return end
  local lines = {}
  for _, l in pairs(ring) do lines[#lines + 1] = l end
  table.sort(lines, function(a, b) return tonumber(a:match('"i":(%d+)')) < tonumber(b:match('"i":(%d+)')) end)
  for _, l in ipairs(lines) do print(l) end
  ring, ring_n = {}, 0
end

-- kind: r (reject), a (add), e (expand), s (solution), x (error)
record = function(kind, s, c, M, facts, domain)
  if not REC or REC.steps == "off" then return end
  local L = c and c.link or (M and M.solver.out[1]) or (s and s.out[1])
  local obj = { k = kind, s = s and s.index or NULL, l = L and L.index or NULL, n = loop_line(),
    t = clock() - rt.t0 }
  if L and M and M.partial then
    -- a partial candidate (G5): the counterexample's interface values are a total candidate it
    -- refutes; a clause from a core has none
    local X = c and c.x
    if X and X.ival and X.ival[L] then obj.c = hexvec(X.ival[L], L.n) end
  elseif L and M and not (M.lazy and M.done) and M[L] then obj.c = hexvec(M[L], L.n) end
  if c and c.link then
    local lits, q, extra = c.lazy and L.slit or L.src, array({}), false
    for k = 1, #c do
      local j = c.j[k]
      if j then q[#q + 1] = (c[k] == lits[j]) and j or -j else extra = true end
    end
    -- a clause with a literal outside the link (a guard: A.add(c, while a)) is not a clause of
    -- the interface: the step is recorded without q
    if not extra then obj.q = q end
  elseif kind == "x" then obj.q = array({}) end
  if facts then obj.f = facts end
  if domain then obj.d = domain end
  if REC.proof and c and c.link then
    local X = c.x
    local Q = X and X.solver and X.solver.qtable
    if Q and X.tv then
      local v = {}
      for j = 1, Q.n do v[j] = Q.facts[j] or X.tv[Q.lits[j]] == true end
      obj.x = hexvec(v, Q.n)
    end
    if rt.certificate then
      local level = rt.certificate(c)
      obj.v = level == nil and NULL or level
    end
  end
  rec_emit(obj)
end
rt.record = record

call_event = function(fr, el, result)
  emit("C", { id = fr.id, s = fr.s.index, t0 = fr.t0 - rt.t0, dt = el, r = result or NULL, p = fr.parent, n = loop_line() })
end

local function is_clause_list(c) return type(c) == "table" and type(c[1]) == "table" end

-- A dead solver inside its search: two contradicting unit clauses on one solver literal make the
-- search unsatisfiable (the first conflicts with the current assignment, rule 3: then return).
kill_search = function(s, control)
  local a = s.dead_lit
  if not a then
    for _, L in ipairs(s.out) do if L.n > 0 then a = L.slit[1]; break end end
    s.dead_lit = a
  end
  if not a then return end
  local first = control.assignment:is_true(a) and -a or a
  if control:add_clause{ { first }, lock = true } then control:add_clause{ { -first }, lock = true } end
end

function Model:reject(c)
  if not self.lazy then fail("reject works only on a candidate inside search; use S.add between solves") end
  if self.done then fail("reject: the candidate is no longer valid (it belongs to an earlier step)") end
  local list = is_clause_list(c) and c or { c }
  if #list == 0 then fail("reject: the refinement is empty") end
  local s = self.solver
  for i, cl in ipairs(list) do
    if type(cl) == "table" and #cl == 0 and cl.empty_ok then
      -- the empty clause: the search ends (no candidate is left)
      s.dead = true
      count_clause(cl)
      trace("reject", s, cl, self)
      if REC then record("r", s, cl, self) end
      -- an earlier clause of this reject already conflicted (add_clause returned false, rule 3):
      -- add nothing more now; the next check of the dead solver ends the search
      if not self.rejected then kill_search(s, self.control) end
      self.rejected = true
      return
    end
    if type(cl) ~= "table" or #cl == 0 then fail("reject: an empty clause cannot refine the candidate") end
    if cl.lazy == false then fail("reject: the clause was built from a model outside the search; use S.add") end
    count_clause(cl)
    trace(self.partial and "partial" or "reject", s, cl, self)
    if REC then record("r", s, cl, self) end
    if rt.certify then rt.certify(s, cl) end
    if s.rejlog then s.rejlog[#s.rejlog + 1] = cl end
    if self.partial then
      -- a partial candidate (G5): the clause must hold for every completion (a core, G.clause(X));
      -- it need not be false yet. After a conflict (add_clause false) nothing more is added
      -- now (rule 3); the rest waits in the stash for the next check.
      if not self.conflict then
        if not self.control:add_clause{ plain(cl) } then self.conflict = true end
      else
        s.stash[#s.stash + 1] = cl
      end
      self.rejected = true
    elseif not self.rejected and i == 1 then
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

local function convert_assumptions(a, s, what)
  if a == nil then return {} end
  if type(a) ~= "table" then fail("assume: expected a list of literals") end
  if getmetatable(a) == Core then
    -- a core as assumptions: its literals belong to its own solver
    if a.solver ~= s then fail(s.name .. "." .. what .. ": the core is one of solver " .. a.solver.name) end
    local out = {}
    for i, l in ipairs(rawget(a, "lits")) do out[i] = l end
    return out
  end
  local ls = list_links[a]
  if ls then
    -- G(M) given to the source of G: the same values on the source's literals
    if #ls == 1 and ls[1].from == s then
      local L, out = ls[1], {}
      for i, l in ipairs(a) do
        local j = L.jof[abs(l)]
        if not j then fail(s.name .. "." .. what .. ": the list has a literal that is not an atom of link " .. L.name) end
        out[i] = l > 0 and L.src[j] or -L.src[j]
      end
      return out
    end
    for _, L in ipairs(ls) do
      if L.to ~= s then fail(s.name .. "." .. what .. ": the assumptions of " .. L.name .. " are for solver " .. L.to.name) end
    end
  end
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

local function run_solve(s, o, limit, optimal, what)
  check_idle(s, what)
  o = o or {}
  if s.dead then
    s.n.calls = s.n.calls + 1; s.n.unsat = s.n.unsat + 1; s.last_core = {}
    if not (o.assume and #o.assume > 0) then rt.exhausted = true end
    return {}
  end
  local assume = convert_assumptions(o.assume, s, what)
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
  timer_stop(fr, not ok and "int" or #models > 0 and "sat" or "unsat")
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
  local models = run_solve(self, o, 1, o and o.optimal, "solve")
  local X = models[1]
  -- the guard watches refinement loops: a solve under assumptions (a check, or G(M) given back
  -- to the source) may return the same candidate on purpose
  if X then
    if not (o and o.assume and #o.assume > 0) then progress_guard(self, X) end
    self.last_model = X
  end
  return X
end

function Solver:models(o)
  local limit = o and o.limit or 0
  if type(limit) ~= "number" then fail(self.name .. ".models: limit must be a number") end
  if limit <= 0 then limit = math.huge end
  return array(run_solve(self, o, limit, false, "models"))
end

function rt.concat(...)
  local out, links = {}, nil
  for i = 1, select("#", ...) do
    local a = select(i, ...)
    if a ~= nil then
      if type(a) ~= "table" then fail("concat: expected lists of literals") end
      for j = 1, #a do out[#out + 1] = a[j] end
      local ls = list_links[a]
      if ls then links = links or {}; for _, L in ipairs(ls) do links[#links + 1] = L end end
    end
  end
  if links then list_links[out] = links end
  return out
end

local function queue_clause(s, c)
  if type(c) == "table" and #c == 0 and c.empty_ok then
    -- the empty clause: no model of s is left; every later solve answers with none
    if c.lazy then fail(s.name .. ".add: the clause was built from a candidate inside a search; use reject") end
    s.dead = true
    count_clause(c)
    trace("add", s, c, c.m)
    if REC then record("a", s, c, c.m) end
    return
  end
  if type(c) ~= "table" or #c == 0 then fail(s.name .. ".add: an empty clause") end
  if c.lazy then fail(s.name .. ".add: the clause was built from a candidate inside a search; use reject") end
  if c.link and c.link.from ~= s then fail(s.name .. ".add: the clause belongs to solver " .. c.link.from.name) end
  local q = {}
  for k = 1, #c do q[k] = c[k] end
  s.queue[#s.queue + 1] = q
  count_clause(c)
  trace("add", s, c, c.m)
  if REC then record("a", s, c, c.m) end
  if rt.certify then rt.certify(s, c) end
end

function Solver:add(c, o)
  if getmetatable(self) ~= Solver then fail("add: not a solver") end
  if self.busy then fail(self.name .. ".add: the solver is searching; use reject inside on candidate") end
  -- A.add(c, while a): the clause holds only while the atom a is true (one more literal, not a)
  if o and o.guard ~= nil then
    local g = type(o.guard) == "table" and o.guard[1] or o.guard
    if math.type(g) ~= "integer" then fail(self.name .. ".add(c, while a): the guard must be an atom such as " .. self.name .. ".atom(\"frame\", t)") end
    local function guarded_copy(x)
      if type(x) ~= "table" then return x end
      local q = { link = x.link, lazy = x.lazy, m = x.m, x = x.x, j = {} }
      for k = 1, #x do q[k] = x[k]; q.j[k] = x.j and x.j[k] end
      q[#q + 1] = -g
      return q
    end
    if is_clause_list(c) then local out = {}; for i, x in ipairs(c) do out[i] = guarded_copy(x) end; c = out else c = guarded_copy(c) end
  end
  if is_clause_list(c) then for _, x in ipairs(c) do queue_clause(self, x) end else queue_clause(self, c) end
end

-- The atoms a fact list of expand stands for (phase B2): a list of atoms (X.atoms), or a list of
-- literals that says whose they are: a core (C.core, the atoms C was assumed), a clause (the
-- atoms of its link), or G(M). The value of a literal is dropped: the fact names the atom.
local function sym_of_literal(S, l)
  for _, L in ipairs(S.inn) do
    local j = L.jof[abs(l)]
    if j then return L.sym[j] end
  end
  for x in S.ctl.symbolic_atoms:iter() do if x.literal == abs(l) then return x.symbol end end
  return nil
end
-- The atoms of a list, a core or a clause, and which of them are assumed (or kept) false:
-- returns out, neg with neg[i] = true when atom out[i] has the value false there.
function rt.fact_atoms(v, what)
  if type(v) ~= "table" then error(what .. " must be a list of atoms, a core or a clause", 0) end
  local mt = getmetatable(v)
  local out, neg = array({}), {}
  if mt == Core then
    for _, l in ipairs(rawget(v, "lits")) do
      local sym = sym_of_literal(v.solver, l)
      if sym then out[#out + 1] = sym; if l < 0 then neg[#out] = true end end
    end
    return out, neg
  end
  if mt == nil and v.link and v.j then
    -- a clause: a positive literal asks for the atom true, so the candidate had it false
    for k = 1, #v do out[#out + 1] = v.link.sym[v.j[k]]; if v[k] > 0 then neg[#out] = true end end
    return out, neg
  end
  local links = list_links[v]
  if links and #v > 0 and math.type(v[1]) == "integer" then
    for _, l in ipairs(v) do
      local sym
      for _, L in ipairs(links) do local j = L.jof[abs(l)]; if j then sym = L.sym[j]; break end end
      if not sym then error(what .. ": a literal of the list belongs to no link", 0) end
      out[#out + 1] = sym
      if l < 0 then neg[#out] = true end
    end
    return out, neg
  end
  for _, a in ipairs(v) do
    if type(a) ~= "userdata" then error(what .. " must be a list of atoms, a core or a clause", 0) end
  end
  return v, neg
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
  local all_facts = array({})
  local b = self.ctl:backend()
  local ok, err = pcall(function()
    for _, name in ipairs(names) do
      local atoms, neg = rt.fact_atoms(facts[name], self.name .. ".expand: " .. name)
      for i, a in ipairs(atoms) do
        if type(a) ~= "userdata" then error(self.name .. ".expand: " .. name .. " must be a list of atoms", 0) end
        b:add_rule{ head = { b:add_atom(clingo.Function(name, { k, a }, true)) }, body = {} }
        -- sign facts: NAME_false(k,T) for an atom of a core, clause or list that has the value false
        if neg[i] then
          local nf = name .. "_false"
          b:add_rule{ head = { b:add_atom(clingo.Function(nf, { k, a }, true)) }, body = {} }
          if #texts < 50 and tracing() then texts[#texts + 1] = nf .. "(" .. self.k .. "," .. tostring(a) .. ")" end
          if REC then all_facts[#all_facts + 1] = nf .. "(" .. self.k .. "," .. tostring(a) .. ")" end
        end
        if #texts < 50 and tracing() then texts[#texts + 1] = name .. "(" .. self.k .. "," .. tostring(a) .. ")" end
        if REC then all_facts[#all_facts + 1] = name .. "(" .. self.k .. "," .. tostring(a) .. ")" end
      end
    end
  end)
  b:close()
  if not ok then error(err, 0) end
  local parts = { { part, { k } } }
  local ip = iface_part(self)
  if ip then parts[2] = { ip, {} } end
  self.ctl:ground(parts)
  self:resolve()
  rt.expansions = rt.expansions + 1
  self.n.ground = self.n.ground + (clock() - t0)
  if REC then
    -- the check domain of the facts (docs/spec-instances.md section 7): pools are keyed by it
    local domain
    pcall(function()
      local src
      for _, name in ipairs(names) do src = src or owner[facts[name]] end
      for _, name in ipairs(names) do
        local a = facts[name][1]
        if a and src then domain = rt.domain_of(src.solver, a.name, #a.arguments); break end
      end
    end)
    record("e", self, nil, self.last_model, all_facts, domain)
  end
  if rt.certify_expand then
    local src
    for _, name in ipairs(names) do src = src or owner[facts[name]] end
    rt.certify_expand(self, self.k, src)
  end
  if tracing() then
    local src
    for _, name in ipairs(names) do src = src or owner[facts[name]] end
    local M = self.last_model
    rt.traced = rt.traced + 1
    emit("T", { i = rt.traced, kind = "expand", solver = self.name, candidate = candidate_text(M),
      counterexample = src and src.shown or nil, facts = texts })
  end
end

local function emit_solution(atoms, cost, s, M)
  rt.solutions = rt.solutions + 1
  emit("M", { n = rt.solutions, atoms = atoms, cost = cost and array(cost) or nil })
  if REC and REC.steps ~= "off" then record("s", s, nil, M) end
end

-- h: { on_candidate, assume, keep, optimal } (phase L2). Searches nest: a search may run inside
-- on candidate of another solver's search (rt.search_stack). keep: the search ends at the first
-- candidate that is not rejected and returns its snapshot (nil when the solver is exhausted);
-- it reports no solution. optimal: with --opt-mode=optN, only models whose optimality is proven
-- are solutions.
function Solver:search(h)
  if self.searching then fail("search " .. self.name .. ": solver " .. self.name .. " is already searching") end
  check_idle(self, "search")
  if type(h) ~= "table" or type(h.on_candidate) ~= "function" then fail(self.name .. ".search: on_candidate is missing") end
  local s, f = self, h.on_candidate
  local keep, optimal = h.keep and true or false, h.optimal and true or false
  local outer = rt.searching
  local assume = convert_assumptions(h.assume, s, "search")
  local want = keep and 0 or wanted_left()
  if not keep and SETTINGS.solutions ~= 0 and want <= 0 then rt.finish("solutions", "", false) end
  s.ctl.configuration.solve.models = tostring(want)
  local saved_opt
  if optimal then saved_opt = s.ctl.configuration.solve.opt_mode; s.ctl.configuration.solve.opt_mode = "optN" end
  local kept = nil
  -- clauses rejected in a nested or kept search are queued too: the next solve of this solver
  -- keeps them (clasp may drop clauses added in a check between solves)
  s.rejlog = (outer or keep) and {} or nil
  s.restart_requested = false
  local found = 0
  local block = SETTINGS.solutions ~= 1
  local cur
  -- on partial M every n (G5): a candidate with the assigned interface atoms only, at every
  -- n-th propagation fixpoint of a partial assignment
  if h.on_partial ~= nil then
    if type(h.on_partial) ~= "function" then fail(s.name .. ".search: on_partial must be a function") end
    local every = h.every or 1
    if math.type(every) ~= "integer" or every < 1 then fail(s.name .. ".search: every must be a whole number of at least 1") end
    local fp, g = 0, h.on_partial
    local last = {}            -- the values at the previous call: an unchanged candidate is skipped
    s.on_partial = function(control)
      fp = fp + 1
      if fp % every ~= 0 then return end
      local ass = control.assignment
      local P = setmetatable({ solver = s, lazy = true, partial = true, control = control, rejected = false }, Model)
      local same = true
      for _, L in ipairs(s.out) do
        local v, sl, prev = {}, L.slit, last[L]
        for j = 1, L.n do
          v[j] = ass:value(sl[j])     -- true, false or nil (unassigned)
          if not prev or prev[j] ~= v[j] then same = false end
        end
        P[L] = v
      end
      if same then return end
      for _, L in ipairs(s.out) do last[L] = P[L] end
      tick(true)
      rt.partials = rt.partials + 1
      g(P)
      P.done = true
    end
  end
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
    if keep then
      local okk = guarded(s, function() kept = snapshot(s, m) end)
      return false
    end
    if optimal and not m.optimality_proven then return true end
    local ok = guarded(s, function()
      local cost = m.cost
      local SM
      if REC then
        SM = setmetatable({ solver = s }, Model)
        for _, L in ipairs(s.out) do
          local v, src = {}, L.src
          for j = 1, L.n do v[j] = m:is_true(src[j]) end
          SM[L] = v
        end
      end
      emit_solution(tostring(m), cost and #cost > 0 and cost or nil, s, SM)
      found = found + 1
      if block then
        -- one clause over the interface atoms of all outgoing links: a later model has to
        -- differ on at least one of them (a clause per link would ask for a difference on each)
        local c = {}
        for _, L in ipairs(s.out) do
          local src = L.src
          for j = 1, L.n do c[#c + 1] = m:is_true(src[j]) and -src[j] or src[j] end
        end
        if #c > 0 then s.blocks[#s.blocks + 1] = c end
      end
    end)
    return ok
  end
  s.searching = true
  rt.search_stack = rt.search_stack or {}
  rt.search_stack[#rt.search_stack + 1] = s
  rt.searching = s
  local fr = timer_start(s)
  s.n.calls = s.n.calls + 1
  local res = s.ctl:solve{ on_model = on_model, assumptions = assume }
  timer_stop(fr, res.interrupted and "int" or res.satisfiable and "sat" or res.unsatisfiable and "unsat" or "int")
  s.searching = false
  rt.search_stack[#rt.search_stack] = nil
  rt.searching = outer
  if optimal then s.ctl.configuration.solve.opt_mode = saved_opt end
  if s.rejlog then
    for _, c in ipairs(s.rejlog) do
      local L = c.link
      if L and #c > 0 then
        local q = {}
        local lits = c.lazy and L.slit or L.src; for k = 1, #c do local j = c.j[k]; q[k] = (c[k] == lits[j]) and L.src[j] or -L.src[j] end
        s.queue[#s.queue + 1] = q
      end
    end
    s.rejlog = nil
  end
  s.on_check = nil
  s.on_partial = nil
  if cur then cur.done = true end
  -- clauses still stashed hold solver literals: keep them as program literals for the next solve
  if #s.stash > 0 then
    if s.restart_requested then
      for _, c in ipairs(s.stash) do
        local L = c.link
        if L then
          local q = {}
          local lits = c.lazy and L.slit or L.src; for k = 1, #c do local j = c.j[k]; q[k] = (c[k] == lits[j]) and L.src[j] or -L.src[j] end
          s.queue[#s.queue + 1] = q
        end
      end
    end
    s.stash = {}
  end
  -- s.blocks (accepted solutions) stay queued, also after a search that ended normally: a later
  -- search of the same solver (shape 4 after a final expand) must not report them again
  reraise()
  if res.satisfiable then s.n.sat = s.n.sat + 1 elseif res.unsatisfiable then s.n.unsat = s.n.unsat + 1 end
  if keep then
    s.exhausted = kept == nil and not res.interrupted
    return kept
  end
  s.exhausted = (not res.interrupted) and not (want > 0 and found >= want)
  if not outer then rt.exhausted = s.exhausted end
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

-- accept M as NAME (label): a second kind of solution. It is reported as an N event and counted
-- per name (S event: labels); it does not count as a solution and never ends the run.
rt.labels, rt.label_order = {}, {}
function rt.accept(M, label)
  if getmetatable(M) ~= Model then fail("accept: expected a model") end
  if M.lazy and M.done then stale("accept", "a counterexample or the model of a solve") end
  if label ~= nil then
    if M.lazy then fail("accept ... as " .. tostring(label) .. ": inside a search, accept the snapshot of a solve, not the candidate") end
    if rt.labels[label] == nil then rt.label_order[#rt.label_order + 1] = label; rt.labels[label] = 0 end
    rt.labels[label] = rt.labels[label] + 1
    emit("N", { label = label, n = rt.labels[label], atoms = M.shown or candidate_text(M), cost = M.cost and array(M.cost) or nil })
    return
  end
  if M.lazy then return end
  emit_solution(M.shown or candidate_text(M), M.cost, M.solver, M)
  if SETTINGS.solutions ~= 0 and rt.solutions >= SETTINGS.solutions then rt.finish("solutions", "", false) end
end

function rt.stop(message)
  if message == nil then rt.finish("finished", "", rt.exhausted) end
  rt.finish("stopped", tostring(message), false)
end

-- Pools of recorded counterexamples (docs/spec-instances.md section 7).
-- rt.pool_key(S, pred, arity): FNV-1a (32 bits, hex) of the sorted texts of the atoms of pred/arity
-- in solver S, the check domain. rt.domain_of gives "S:pred/arity:key", the pool's domain.
local domain_cache = {}
function rt.pool_key(S, pred, arity)
  S:ground()
  local t = {}
  for a in S.ctl.symbolic_atoms:by_signature(pred, arity) do t[#t + 1] = tostring(a.symbol) end
  table.sort(t)
  local h = 2166136261
  local s = concat(t, "\n")
  for i = 1, #s do h = ((h ~ s:byte(i)) * 16777619) & 0xffffffff end
  return string.format("%08x", h)
end
function rt.domain_of(S, pred, arity)
  local k = S.name .. ":" .. pred .. "/" .. arity
  local d = domain_cache[k]
  if not d then d = k .. ":" .. rt.pool_key(S, pred, arity); domain_cache[k] = d end
  return d
end
-- rt.pool(name): the items of a pool as lists of symbols (validated as facts before the run, so
-- parse_term sees terms). A pool whose domain differs from this run's is skipped with a message,
-- unless settings.pools is "any".
function rt.pool(name)
  local P = POOLS and POOLS[name]
  if not P then fail("pool " .. tostring(name) .. ": the project has no pool of that name") end
  if SETTINGS.pools ~= "any" and P.domain and P.domain ~= "" then
    local sname, pred, ar = P.domain:match("^([^:]+):([^/]+)/(%d+):")
    local S
    for _, x in ipairs(rt.solvers) do if x.name == sname then S = x end end
    local now = S and rt.domain_of(S, pred, tonumber(ar))
    if now ~= P.domain then
      emit("W", { solver = sname or "?", code = "pool", message = "pool " .. name .. " skipped: it was recorded on another domain (" ..
        P.domain .. ", this run " .. tostring(now) .. "); settings.pools = \"any\" uses it anyway" })
      return array({})
    end
  end
  local out = array({})
  for _, item in ipairs(P.items) do
    local l = array({})
    for _, t in ipairs(item) do l[#l + 1] = clingo.parse_term(t) end
    out[#out + 1] = l
  end
  rt.count("pool items", #out)
  return out
end

function rt.count(name, n)
  n = n or 1
  if type(n) ~= "number" then fail("count " .. tostring(name) .. ": the amount must be a number") end
  if rt.counters[name] == nil then rt.counter_order[#rt.counter_order + 1] = name; rt.counters[name] = 0 end
  rt.counters[name] = rt.counters[name] + n
end

-- track name = e (phase B3): a series of numbers drawn in the Statistics tab. Each call sends a
-- V event { n, i, v, t } (i counts the values of that name); after TRACK_CAP values of a name only
-- its last value is kept (in the S event's tracked table). none is skipped.
local TRACK_CAP = 2000
function rt.track(name, v)
  if v == nil then return end
  if type(v) ~= "number" then fail("track " .. tostring(name) .. ": the value must be a number, got " .. type(v)) end
  local n = (rt.track_n[name] or 0) + 1
  rt.track_n[name] = n
  if rt.tracked[name] == nil then rt.track_order[#rt.track_order + 1] = name end
  rt.tracked[name] = v
  if n <= TRACK_CAP then emit("V", { n = name, i = n, v = v, t = clock() - rt.t0 }) end
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

-- c + d (phase L4): numbers are added, clauses of one link are joined.
function rt.plus(a, b)
  if type(a) == "number" and type(b) == "number" then return a + b end
  if type(a) == "string" or type(b) == "string" then return tostring(a) .. tostring(b) end
  if a == nil or b == nil then fail("attempt to perform arithmetic on a nil value (an operand of + is none)") end
  if type(a) ~= "table" or type(b) ~= "table" or not a.link and #a > 0 or not b.link and #b > 0 then fail("+: expected two numbers or two clauses") end
  local L = a.link or b.link
  if a.link and b.link and a.link ~= b.link then fail("+: the clauses belong to different links (" .. a.link.name .. ", " .. b.link.name .. ")") end
  if (#a > 0 and #b > 0) and a.lazy ~= b.lazy then fail("+: one clause was built inside a search, the other outside") end
  local c = new_clause(L, a.lazy or b.lazy or false, a.m or b.m, a.x or b.x)
  local seen = {}
  for _, x in ipairs({ a, b }) do
    for k = 1, #x do
      if not seen[x[k]] then seen[x[k]] = true; local n = #c + 1; c[n] = x[k]; c.j[n] = x.j and x.j[k] end
    end
  end
  c.empty_ok = true
  return c
end
-- A project constant as a value (the ranges of families): a number when it reads as one.
function rt.const(name)
  for _, kv in ipairs(CONSTS) do
    local k, v = kv:match("^([^=]+)=(.*)$")
    if k == name then return tonumber(v) or v end
  end
  fail("the constant " .. tostring(name) .. " is not set (Loop tab: constants)")
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
  for _, k in ipairs(rt.track_order) do print(string.format("%-13s: %s", k, tostring(rt.tracked[k]))) end
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
  pcall(rec_flush)
  if not SETTINGS.plain then send_stats() end
  if exhausted == nil then exhausted = NULL end
  emit("D", { outcome = outcome, exhausted = exhausted, detail = detail })
end

return rt
