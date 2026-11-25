// Refinery: minimal sound sets with clingo (docs/lab-design.md). No DOM, no Node APIs.
//
// The sound sets of a bad candidate M are the hitting sets of D(M) = { D(M, s) : s a solution }.
// One plain clingo run (a Lua main, no runtime) handles many candidates: per family a fresh
// control with  in(T) chosen, every set hit, and a false sign heuristic on in/1, enumerated
// with --heuristic=Domain --enum-mode=domRec (the subset-minimal models). When the enumeration
// is capped, one more control with #minimize gives a cardinality-minimal set.
//
//   minimalProgram(families, { cap, seconds })  families: [[ [atom, ...], ... ], ...] (1-based)
//   parseMinimal(lines, count)                   -> [{ sets, capped, min, budget }]
//   minimalSets(exec, families, o)               runs it (exec(program, options) -> { out })

const ints = (a) => `{${a.join(',')}}`;

export function minimalProgram(families, { cap = 200, seconds = 30 } = {}) {
  const fams = families.map((f) => `{${f.map(ints).join(',')}}`);
  return `#script (lua)
local clingo = require("clingo")
local FAMS = {
${fams.join(',\n')}
}
local CAP, BUDGET = ${Math.max(1, cap | 0)}, ${Number(seconds) > 0 ? Number(seconds) : 30}
local function arr(t) local o = {} for i, x in ipairs(t) do o[i] = tostring(x) end return "[" .. table.concat(o, ",") .. "]" end
local function program(F)
  local t = {}
  for k, s in ipairs(F) do for _, a in ipairs(s) do t[#t + 1] = "s(" .. k .. "," .. a .. ")." end end
  t[#t + 1] = "{ in(T) } :- s(_,T). hit(K) :- s(K,T), in(T). :- s(K,_), not hit(K). #show in/1."
  return table.concat(t, " ")
end
local function sets_of(ctl, limit, last_only)
  local out, h = {}, ctl:solve{ yield = true }
  local ok, err = pcall(function()
    for m in h:iter() do
      local s = {}
      for _, a in ipairs(m:symbols{ shown = true }) do s[#s + 1] = a.arguments[1].number end
      table.sort(s)
      if last_only then out[1] = s else out[#out + 1] = s end
      if not last_only and #out >= limit then break end
    end
  end)
  h:close()
  if not ok then error(err, 0) end
  return out
end
function main(prg)
  local t0, lastp = os.clock(), 0
  for fi, F in ipairs(FAMS) do
    if os.clock() - lastp > 0.25 then lastp = os.clock(); print('@@Z {"p":' .. fi .. ',"of":' .. #FAMS .. '}') end
    if os.clock() - t0 > BUDGET then
      print('@@Z {"f":' .. fi .. ',"budget":true}')
    elseif #F == 0 then
      print('@@Z {"f":' .. fi .. ',"sets":[[]],"capped":false,"min":[]}')
    else
      local ok, err = xpcall(function()
        local text = program(F)
        local ctl = clingo.Control({ "--heuristic=Domain", "--enum-mode=domRec", "--models=0" })
        ctl:add("base", {}, text .. " #heuristic in(T) : s(_,T). [1,false]")
        ctl:ground({ { "base", {} } })
        local sets = sets_of(ctl, CAP + 1, false)
        local capped = #sets > CAP
        if capped then sets[#sets] = nil end
        local min = sets[1]
        for _, s in ipairs(sets) do if #s < #min then min = s end end
        if capped then
          local c2 = clingo.Control({ "--opt-mode=opt", "--models=0" })
          c2:add("base", {}, text .. " #minimize { 1,T : in(T) }.")
          c2:ground({ { "base", {} } })
          min = sets_of(c2, 1, true)[1] or min
        end
        local o = {}
        for i, s in ipairs(sets) do o[i] = arr(s) end
        print('@@Z {"f":' .. fi .. ',"sets":[' .. table.concat(o, ",") .. '],"capped":' .. tostring(capped) .. ',"min":' .. arr(min) .. '}')
      end, debug.traceback)
      if not ok then print('@@Z {"f":' .. fi .. ',"error":true}') end
    end
  end
end
#end.
`;
}

export function parseMinimal(lines, count) {
  const out = Array.from({ length: count }, () => null);
  for (const l of lines) {
    if (!l.startsWith('@@Z ')) continue;
    let z;
    try { z = JSON.parse(l.slice(4)); } catch { continue; }
    if (z.p) continue;
    out[z.f - 1] = z.budget ? { budget: true, sets: [], capped: false, min: null }
      : z.error ? { error: true, sets: [], capped: false, min: null }
        : { sets: z.sets, capped: z.capped, min: z.min };
  }
  return out.map((x) => x || { budget: true, sets: [], capped: false, min: null });
}

export async function minimalSets(exec, families, o = {}) {
  if (!families.length) return [];
  const hook = o.onProgress ? (l) => { if (l.startsWith('@@Z {"p":')) { try { const z = JSON.parse(l.slice(4)); o.onProgress({ phase: 'minimal sound sets', done: z.p, of: z.of }); } catch { /* skip */ } } } : null;
  const r = await exec(minimalProgram(families, o), '--outf=3', hook);
  return parseMinimal(r.out || [], families.length);
}
