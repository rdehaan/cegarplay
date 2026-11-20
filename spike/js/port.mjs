// Port of cegar.py to a Lua driver that runs entirely inside wasm clingo.
import fs from 'node:fs';
import factory from '../node_modules/clingo-wasm/dist/clingo.js';

export function splitParts(text) {
  const parts = { shared: '', guess: '', glue: '', check: '' };
  let cur = 'guess';
  // naive: split on "#program name." directives (fine for the probe)
  const re = /#program\s+([a-z_]+)\s*\.\s*/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    parts[cur] += text.slice(last, m.index);
    cur = m[1] === 'base' ? 'guess' : m[1];
    last = re.lastIndex;
  }
  parts[cur] += text.slice(last);
  return parts;
}
const lstr = s => { let n = 3; while (s.includes(']' + '='.repeat(n) + ']')) n++; const e = '='.repeat(n); return `[${e}[\n${s}]${e}]`; };

export function buildProgram(parts, { glueWrapped }) {
  return `
#script (lua)
local clingo = require("clingo")
local CHECK = ${lstr(parts.shared + '\n' + parts.check)}
local GLUE  = ${lstr(parts.shared + '\n' + parts.glue)}
local GLUE_WRAPPED = ${glueWrapped ? 'true' : 'false'}
local stats = { check_calls = 0, refinements = 0, clause_len = 0 }

local Prop = {}
Prop.__index = Prop
function Prop:init(init)
  local ck = clingo.Control({"--heuristic=Domain"})
  self.ck = ck
  self.map = {}
  self.gluelits = {}
  local seen = {}
  local backend = ck:backend()
  for atom in init.symbolic_atoms:iter() do
    local sym = atom.symbol
    if self.glue[tostring(sym)] then
      local glit = init:solver_literal(atom.literal)
      local truth = init.assignment:value(glit)
      if truth ~= false then
        local clit = backend:add_atom(sym)
        local ilit = backend:add_atom(clingo.Function("relevant", {sym}, true))
        if not seen[glit] then seen[glit] = true; self.gluelits[#self.gluelits+1] = glit end
        if truth == true then
          backend:add_rule{head={clit}, body={}}
        else
          backend:add_rule{head={clit}, body={}, choice=true}
          backend:add_rule{head={ilit}, body={}, choice=true}
          self.map[#self.map+1] = {glit, clit, ilit}
        end
      end
    end
  end
  backend:close()
  ck:add("base", {}, CHECK)
  ck:ground({{"base", {}}})
end
function Prop:check(control)
  local ass = control.assignment
  local map = self.map
  local assumptions = {}
  for i = 1, #map do
    local e = map[i]
    assumptions[i] = ass:value(e[1]) and e[2] or -e[2]
  end
  local mask = nil
  stats.check_calls = stats.check_calls + 1
  local ret = self.ck:solve{assumptions = assumptions, on_model = function(m)
    mask = {}
    for i = 1, #map do
      local e = map[i]
      if m:is_true(e[3]) then mask[e[1]] = true end
    end
  end}
  if ret.satisfiable then
    local conflict = {}
    for _, lit in ipairs(self.gluelits) do
      if mask[lit] then conflict[#conflict+1] = ass:is_true(lit) and -lit or lit end
    end
    stats.refinements = stats.refinements + 1
    stats.clause_len = stats.clause_len + #conflict
    control:add_clause{conflict}
  end
end

function main(prg)
  local gc = clingo.Control({"1"})
  gc:add("base", {}, GLUE)
  gc:ground({{"base", {}}})
  local glue = {}
  gc:solve{on_model = function(m)
    for _, a in ipairs(m:symbols{shown=true}) do
      if GLUE_WRAPPED then
        if a.name == "glue" then glue[tostring(a.arguments[1])] = true end
      else
        glue[tostring(a)] = true
      end
    end
  end}
  prg:register_propagator(setmetatable({glue = glue}, Prop))
  prg:ground({{"base", {}}})
  prg:solve()
  print(string.format("CEGAR-STATS check_calls=%d refinements=%d clause_len=%d", stats.check_calls, stats.refinements, stats.clause_len))
end
#end.
${parts.shared}
${parts.guess}
`;
}

if ((process.argv[1] || '').endsWith('port.mjs')) {
  const [file, wrapped, ...opts] = process.argv.slice(2);
  const parts = splitParts(fs.readFileSync(file, 'utf8'));
  const prog = buildProgram(parts, { glueWrapped: wrapped === 'new' });
  const out = [], err = [];
  const t0 = performance.now();
  const m = await factory({ print: l => out.push(l), printErr: l => err.push(l) });
  const t1 = performance.now();
  let status;
  try { status = m.ccall('run', 'number', ['string','string'], [prog, opts.join(' ')]); } catch (e) { status = 'EXC ' + e; }
  const t2 = performance.now();
  console.log(out.filter(l => /SATIS|UNSAT|^Models|CEGAR-STATS|^Conflicts|^Choices|^Time|UNKNOWN|^Answer/.test(l)).join('\n').slice(0, 1500));
  if (err.length) console.log('STDERR:', err.join('\n').slice(0, 1500));
  console.log(`status=${status} load=${(t1-t0).toFixed(0)}ms run=${(t2-t1).toFixed(0)}ms`);
}
