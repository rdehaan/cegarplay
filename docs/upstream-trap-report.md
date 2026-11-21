# Draft: upstream bug report for the trap

Status: **draft, not filed.** The owner files it at
<https://github.com/domoritz/clingo-wasm/issues> (the WebAssembly build); the reproduction is
`docs/trap-repro/repro.mjs`. Check the issue tracker for an existing report first, and re-run the
reproduction against the newest clingo-wasm release before filing.

---

**Title:** An error raised by clingo inside a Lua call aborts the instance, even inside `pcall`

**Versions:** clingo-wasm 0.6.0 (`dist/clingo.js`, the single-threaded build; the threaded
build was not tried), clingo 5.8.1 (`clingo --version` inside the instance), Node.js 24.22. The
same happens in Chromium (we saw it in a web worker).

**What happens.** When a clingo API function called from an embedded Lua script raises an error
(for instance `prg:add` with a syntax error, or `prg:ground` on a rule with an unsafe variable),
the WebAssembly instance stops with `RuntimeError: unreachable`. This also happens when the call
is wrapped in `pcall`, so the script cannot recover, and nothing after the call runs: no Lua error
reaches the script, and `run` does not return. clingo's own message is printed to stderr just
before.

A plain Lua error (`error("boom")`) inside `pcall` is caught as expected.

**Expected.** As with native clingo built with Lua: `pcall` returns `false` and the error
message, and the script continues.

**Reproduction** (Node.js, `npm install clingo-wasm@0.6.0`, then adjust the import path):

```js
import factory from 'clingo-wasm/dist/clingo.js';
const m = await factory({ print: console.log, printErr: console.error });
const program = `#script (lua)
function main(prg)
  local ok, e = pcall(function() prg:add("base", {}, "p(") end)
  print("caught: " .. tostring(ok) .. " " .. tostring(e))
end
#end.
`;
try { console.log('status', m.ccall('run', 'number', ['string', 'string'], [program, ''])); }
catch (e) { console.log('trap:', e.message); }
```

Output:

```
<block>:2:1-2: error: syntax error, unexpected EOF, expecting ) or ;
trap: unreachable
```

`docs/trap-repro/repro.mjs` in our repository runs four cases on fresh instances:

| Case | Result |
| --- | --- |
| `pcall(function() error("boom") end)` | caught, status 0 |
| `pcall(function() prg:add("base", {}, "p(") end)` | `RuntimeError: unreachable` |
| `prg:add("base", {}, "p(X).")`, then `pcall(function() prg:ground(...) end)` | `RuntimeError: unreachable` |
| `pcall(function() control:add_clause{ { 123456789 } } end)` in a propagator's `check` | `RuntimeError: memory access out of bounds` |

**A guess at the cause.** clingo's Lua bindings turn a clingo error into a Lua error with
`lua_error`, which unwinds with `longjmp`; or a C++ exception is thrown through Lua's C frames.
If the build disables C++ exceptions or `setjmp`/`longjmp` support (Emscripten's
`-fno-exceptions` / no `-sSUPPORT_LONGJMP`), either path ends in `abort` (`unreachable`).
Building with `-fwasm-exceptions` (or `-sDISABLE_EXCEPTION_CATCHING=0`) and `-sSUPPORT_LONGJMP=wasm`
might fix it; we have not tried.

**Impact and workaround.** A playground that runs user programs through a Lua driver cannot
report these errors in the script. We validate all ASP text with `--mode=gringo` before a run, wrap
every callback in `xpcall` and check preconditions in Lua before calling clingo; an unexpected
error still ends the instance, and the page restarts the worker.
