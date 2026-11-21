// Minimal reproduction: an error raised by clingo inside a Lua call ends the WebAssembly
// instance, even when the call is wrapped in pcall. Run from the repository root:
//
//   node docs/trap-repro/repro.mjs
//
// Uses the vendored clingo-wasm build (vendor/clingo-wasm/, from clingo-wasm 0.6.0, clingo 5.8.1).
import factory from '../../vendor/clingo-wasm/clingo.js';

async function run(name, program, options = '') {
  const out = [], err = [];
  const m = await factory({ print: (l) => out.push(l), printErr: (l) => err.push(l) });   // a fresh instance per case
  let status;
  try { status = m.ccall('run', 'number', ['string', 'string'], [program, options]); }
  catch (e) { status = `TRAP (${e && e.constructor && e.constructor.name}: ${String(e.message || e).split('\n')[0]})`; }
  console.log(`${name}\n  status: ${status}\n  stdout: ${JSON.stringify(out.filter((l) => !/^(clingo version|Reading|Solving|UNKNOWN|Models|Calls|Time|CPU|$)/.test(l)))}\n  stderr: ${JSON.stringify(err.slice(0, 3))}\n`);
  return status;
}

const lua = (body) => `#script (lua)\nfunction main(prg)\n${body}\nend\n#end.\n`;

// 1. A Lua error caught by pcall: fine.
await run('1. pcall(error) in Lua', lua(`
  local ok, e = pcall(function() error("boom") end)
  print("caught: " .. tostring(ok) .. " " .. tostring(e))`));

// 2. An error raised by clingo (a syntax error in prg:add) inside pcall: expected "caught: false",
//    observed: the instance traps and nothing after the call runs.
await run('2. pcall(prg:add with a syntax error)', lua(`
  local ok, e = pcall(function() prg:add("base", {}, "p(") end)
  print("caught: " .. tostring(ok) .. " " .. tostring(e))`));

// 3. The same with a ground error (an unknown part is fine; an unsafe rule is a clingo error).
await run('3. pcall(prg:ground on an unsafe rule)', lua(`
  prg:add("base", {}, "p(X).")
  local ok, e = pcall(function() prg:ground({ { "base", {} } }) end)
  print("caught: " .. tostring(ok) .. " " .. tostring(e))`));

// 4. A clingo error inside a propagator callback, wrapped in pcall (bad argument to add_clause).
await run('4. pcall(control:add_clause with a bad literal) in a propagator check', `
{ a; b }.
#script (lua)
local P = {}
function P:init(init) init:add_watch(init:solver_literal(1)) end
function P:check(control)
  local ok, e = pcall(function() control:add_clause{ { 123456789 } } end)
  print("caught: " .. tostring(ok) .. " " .. tostring(e))
end
function main(prg)
  prg:register_propagator(P)
  prg:ground({ { "base", {} } })
  prg:solve()
  print("after solve")
end
#end.
`);
