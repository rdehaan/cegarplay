# Spec: engine, assembled program and Lua runtime

Read this for phases 1 and 2. It defines `lua/runtime.lua`, the program that
`js/driver.js` assembles, and the event stream.

`spike/lua/runtime.lua` is a working 200-line prototype of this spec. Start from
it. It lacks: JSON events, guards, limits, safe callbacks, `models`, `optimal`,
`core`, `clauses`, `concat`, trace, counters, seeds. Everything else in it is
verified by `spike/test/run.mjs`.

## 1. Facts about the engine (all verified, do not re-derive)

Engine: npm `clingo-wasm@0.6.0` = clingo 5.8.1 + Lua 5.4.6, compiled with
Emscripten. Files `dist/clingo.js` (ES module, default export = factory) and
`dist/clingo.wasm`. The factory takes `{ print, printErr, stdin, locateFile }`
and resolves to a module with one useful call:

```js
const status = module.ccall('run', 'number', ['string', 'string'], [program, options]);
```

- The WASM module exports nothing else. There is no C API from JavaScript.
- `#script (lua)` works inside `program`. Lua can create any number of
  `clingo.Control` objects. This is how CegarPlay runs several solvers.
- `print` is called synchronously, line by line, while `run` executes.
- `run` blocks its thread until the program ends.
- The same module instance can execute several `run` calls, one after another.
- After a trap (see 1.1) the instance is unusable. Create a new one.
- `dist/clingo.js` is not in the package's `exports` map. Import it by file path.
  This is one reason the files are vendored.

### 1.1 The trap rule (most important rule in this project)

Any error that clingo raises inside a call made from Lua kills the WASM
instance with `RuntimeError: unreachable` (or `null function or function
signature mismatch`). `pcall` does not help. No message is produced.

Observed triggers:

1. A syntax error or unsafe variable in text passed to `ctl:add` / `ctl:ground`.
2. A Lua error that propagates out of `main`.
3. A Lua error that propagates out of any callback that clingo calls
   (`on_model`, propagator `init` / `check`), even if `ctl:solve` is inside `pcall`.
4. Reading `ctl.statistics` while that control is solving.
5. `control:add_clause` after an earlier `add_clause` in the same `check`
   returned false.
6. Wrong argument shapes to clingo API functions inside callbacks.

What is safe:

- A pure Lua error inside `xpcall(f, debug.traceback)` is caught, as long as no
  clingo frame lies between the error and the `xpcall`.
- Therefore: every callback body is wrapped in its own `xpcall`. On failure the
  callback stores the error in `rt.fatal`, calls `ctl:interrupt()` (or returns
  `false` from `on_model`), and returns normally. The code that called
  `ctl:solve` re-raises `rt.fatal` with `error(rt.fatal, 0)` after `solve`
  returns. Verified: the control stays usable.
- The whole loop script runs inside one outer `xpcall` in `main`.

Consequences for the design:

- Programs are validated before the run (see `spec-app.md`, Validation).
- The runtime checks preconditions in Lua and raises a Lua error with a clear
  message instead of making a clingo call that can fail.

### 1.2 Lua API notes (clingo 5.8.1, verified)

| Topic | Fact |
| --- | --- |
| Control | `clingo.Control(args, logger, message_limit)`. `logger(code, message)` receives infos and warnings; without it they go to stderr. `code` prints as e.g. `AtomUndefined`. |
| Constants | Two args each: `"-c", "n=6"`. |
| Add / ground | `ctl:add("base", {}, text)`, `ctl:ground({{"base", {}}})`, `ctl:ground({{"refine", {clingo.Number(k)}}})`. |
| Atoms | `for atom in ctl.symbolic_atoms:iter() do` gives `atom.symbol`, `atom.literal`, `atom.is_fact`. `ctl.symbolic_atoms:by_signature(name, arity)` iterates one predicate. `ctl.symbolic_atoms:lookup(symbol)`. |
| Backend | `local b = ctl:backend(); local a = b:add_atom(symbol); b:add_rule{ head = {a}, body = {}, choice = true }; b:close()`. Atoms added before `ground` are visible to the grounder. Always `close`. |
| Solve | `ctl:solve{ assumptions = {lit, -lit, ...}, on_model = function(m) ... end }` returns a result with `.satisfiable`, `.unsatisfiable`, `.interrupted`. Returning `false` from `on_model` stops the solve. |
| Model | `m:is_true(program_literal)`, `tostring(m)` = shown atoms separated by spaces, `m.cost` = list of costs. A model object is only valid inside the callback. |
| Handle | `local h = ctl:solve{ assumptions = a, yield = true }; for m in h:iter() do ... break end; local core = h:core(); h:close()`. Read models **only** through `h:iter()`. `h:get()` followed by `h:model()` traps, and so does `yield = true` combined with `on_model`. `h:core()` is valid when no model was found. Core literals come back as floats (`1.0`, `-2.0`) with the sign they were assumed with: convert with `math.tointeger`. An `on_core` argument is not called. Always `h:close()`. |
| Propagator | A table with `init(self, init)` and `check(self, control)`. **`init` is mandatory** (segfault otherwise, natively too). **Hooks are read at `register_propagator` time**; adding a function to the table later has no effect. `init` runs at the start of every solve call. |
| Literals | `init:solver_literal(program_literal)` maps to solver literals. Clauses in propagators use solver literals. Assumptions and `model:is_true` use program literals. |
| Clause in check | `control:add_clause{ lits }` or `control:add_clause{ lits, lock = true }` (a table wrapping the list). Returns false on conflict; then return from the hook at once. |
| Clause in init | `init:add_clause(lits)` (the list itself). Such clauses persist across later solve calls and grounding steps. |
| Assignment | `control.assignment:is_true(solver_literal)`, `:value(lit)`. |
| Interrupt | `ctl:interrupt()` from inside a callback ends the solve cleanly; result has `.interrupted`. An empty clause does not stop the search. |
| Statistics | `ctl.statistics.solving.solvers.{choices,conflicts,restarts}`, `ctl.statistics.problem.lp.{atoms,rules,bodies}`, `ctl.statistics.problem.generator.{vars,constraints}`, `ctl.statistics.summary.times.{total,solve}`. `ctl.statistics.accu` (same shape, summed over calls) exists only if the control was created with `--stats`. Values can be floats. |
| Configuration | `ctl.configuration.solve.models = n` (0 = all). |
| Std lib | `os.clock()`, `io.read("l")`, `debug.traceback`, `string`, `table`, `math` all work. |
| Silence | Run with option `--outf=3`: clingo prints nothing; only the script's `print` lines appear. |
| Error lines | A Lua error message looks like `[string "-:1:1-304:6"]:298: attempt to ...`. The number after the bracket is the 1-based line in the assembled program. |
| Multi-shot | Grounding a part again with a new parameter works. Redefining an atom in a later step raises **no** message; the later definition is silently ignored. |
| Threads | The `clingo-mt` build accepts `-t N`. clingo serialises Lua callbacks. |

## 2. The assembled program

`js/driver.js` builds one string per run:

```
#script (lua)
FRAGMENTS = {}
FRAGMENTS["shared"] = [==[
...text...
]==]
...
CONSTS = { "n=6" }
SETTINGS = { solutions = 1, seconds = 60, candidates = 0, trace = 200, seed = 0, poll = false, plain = false }
<contents of lua/runtime.lua>
function main(prg)
  rt.run(function()
<compiled loop script, or raw Lua>
  end)
end
#end.
```

Rules:

- Long strings: choose the smallest level of `=` (start at 2) such that the
  closing bracket does not occur in the text.
- The driver records, for the compiled loop, the program line where it starts,
  so `[string "..."]:N:` can be mapped back to a loop-script line.
- `prg` (the control clingo passes to `main`) is never used.
- Options passed to `run`: `--outf=3`.
- `rt.run(f)` is the outer `xpcall`; it emits the `E` event on error and always
  emits the final `S` and `D` events. See section 5.

## 3. Runtime API

All names live in the global table `rt`. Types: `Solver`, `Link`, `Model`,
`Clause` (an array of integer literals with extra fields).

### 3.1 Setup

| Call | Behaviour |
| --- | --- |
| `rt.solver(name, fragments, options)` | Creates a `clingo.Control` with `options` (array of strings) + `"--stats"` + for each constant `"-c", c` + `"--seed=" .. SETTINGS.seed` when the seed is not 0. Logger emits `W` events with the solver name. Registers one propagator immediately (section 4). Does not ground yet. Error if a fragment name is unknown. |
| `rt.link(name, from, to, glue_fragments, opts)` | See 3.2. `opts = { legacy = bool, compat = bool }`. |
| `rt.capture(pred, arity)` | Every solver will record the true atoms of `pred/arity` in each model snapshot. |
| `rt.prepare()` | Grounds every solver not yet grounded, in creation order, then resolves captures (`by_signature`), then emits the `H` event. Must be called exactly once, after all declarations. |

Grounding a solver: join its fragments as
`"#program base.\n" .. text` for each fragment, separated by `"\n"`, one
`ctl:add("base", {}, joined)`, then `ctl:ground({{"base", {}}})`. The
`#program base.` prefix stops a trailing `#program refine(k).` in one fragment
from swallowing the next fragment. Measure and store the grounding time.

### 3.2 Links

`rt.link(name, from, to, glue_fragments, opts)`:

1. Build a throwaway control with the glue fragments (joined as above) and the
   constants. Ground, solve once. Collect every shown atom `glue(T)`: the
   interface set is the strings `tostring(T)`. With `opts.legacy`, every shown
   atom that is not `glue/1` is itself an interface atom (old prototype files).
   If the set is empty, raise a Lua error naming the link.
2. `from:ground()` (if not yet). Error if `to` is already grounded.
3. Open `to`'s backend. For each atom of `from.ctl.symbolic_atoms` whose symbol
   string is in the set:
   - `d = backend:add_atom(symbol)`
   - if `atom.is_fact`: `add_rule{ head = {d}, body = {} }`
   - else: `i = backend:add_atom(clingo.Function("relevant", {symbol}, true))`;
     `add_rule{ head = {d}, body = {}, choice = true }`; with `opts.compat` also
     `add_rule{ head = {i}, body = {}, choice = true }`; append to the link's
     parallel arrays: `src` (program literal in `from`), `dst` (`d`), `ind`
     (`i`), `sym` (symbol), and when tracing, `str` (symbol text).
4. Close the backend. Register the link in `from.out` and `to.inn`.

The link also holds `slit` (solver literals in `from`, refreshed in every
propagator `init`), and one reusable buffer for assumptions.

| Method | Returns |
| --- | --- |
| `G:of(M)` | Assumptions for `to`: for each j, `dst[j]` if `M`'s value j is true, else `-dst[j]`. Returns the link's own reusable array. |
| `G:clause(M, X)` | Clause "one relevant atom must change": for each j with `X`'s indicator j true: the literal of atom j in `from`, negated if `M`'s value is true. Error if no indicator is true (message: `relevant/1 derived nothing for link G`). Fields: `link`, `m`, `x`. |
| `G:block(M)` | Clause over all j: flips every value of `M`. |
| `G:core(S)` | Clause from the unsat core of `S`'s last solve: for each core literal that is `±dst[j]`, the literal of atom j in `from` with the opposite sign of its value in the core. `S` must be `to`. Error if the last solve of `S` was not unsatisfiable. |
| `G:clauses(X)` | A list of clauses, one per `Id`, from atoms `clause(Id, T, true)` and `clause(Id, T, false)` true in `X` (captured automatically for links whose target has such atoms). `T` must be an interface atom of the link; unknown atoms are a Lua error. `true` gives the positive literal. |

Literal kind: clauses built from a candidate inside a search (`M.lazy`) use
solver literals (`slit`); otherwise program literals (`src`). The clause carries
`lazy = true/false` so that misuse can be detected.

### 3.3 Solving

| Call | Behaviour |
| --- | --- |
| `S:solve{ assume = a, optimal = bool }` | One solve of `S`. Returns a `Model` snapshot of the first model, or with `optimal` of the last model reported (for `#minimize` in `S`). Returns `nil` if unsatisfiable, and then stores `S.last_core = h:core()`. Implementation: the handle form with `h:iter()` (see 1.2); verified to give the same search and the same speed as the `on_model` form, also when called from inside `on_candidate`. Error if `S` is searching. |
| `S:models{ assume = a, limit = n }` | Up to `n` model snapshots as a Lua array (empty array if unsatisfiable). Same handle form; stop iterating after `n`. |
| `rt.concat(a, b, ...)` | A fresh array with all assumption lists appended. |
| `S:search{ on_candidate = f }` | Runs `S`'s own search. For each total assignment the propagator's `check` builds a lazy `Model` view and calls `f(M)`. A candidate that `f` does not reject becomes a solution: it is counted and emitted as an `M` event (from the solve's `on_model`, where `tostring(m)` is available). Before solving, sets `ctl.configuration.solve.models` to the number of solutions still wanted (0 = all). After the solve: `S.exhausted = not result.interrupted and the model limit was not reached`. Re-raises `rt.fatal` if set. |
| `M:reject(c)` | Only for lazy models. `c` is a clause or a list of clauses. The first clause is added with `control:add_clause{ c }`. Remaining clauses are stashed in `S.stash` and added at the start of the next `check` (each with `lock = true`; if one returns false, return from `check`). Guard: every literal of the first clause must be false under the current assignment, else Lua error `refinement does not exclude the candidate`. Marks `M.rejected`. |
| `S:add(c)` | Queues a clause (or list of clauses) of program literals. The propagator's `init` injects the queue at the next solve via `init:add_clause`. Error if `S` is searching, or if the clause is lazy. |
| `S:expand(part, facts)` | `facts = { name = array_of_symbols, ... }`. Increments `S.k`; for each symbol `T` adds the fact `name(k, T)` through the backend; grounds `{{part, {clingo.Number(k)}}}`; re-resolves captures for `S`. Error if `S` is searching. |
| `rt.restart()` | Only inside `on_candidate`. Sets `S.restart_requested` and calls `ctl:interrupt()` on the searching solver. |
| `rt.accept(M)` | For non-lazy models: counts a solution, emits `M`. If the wanted number is reached, ends the run with outcome `solutions` (section 5.3). For a lazy model it is a no-op (not rejecting already accepts). |
| `rt.stop(message)` | Ends the run with outcome `stopped`. Inside a callback: sets the flag, interrupts, and the stop is completed after `solve` returns. |
| `rt.count(name, n)` | Adds `n` (default 1) to a custom counter. |
| `rt.log(...)` | Emits an `L` event with the arguments joined by spaces (`tostring`). |
| `rt.size(l)`, `rt.push(l, x)`, `rt.clear(l)`, `rt.list()` | List helpers for the loop language. Lists are plain arrays. |

Blocking accepted solutions across restarts: whenever a search of `S` ends
(with `restart_requested` or normally, as in Shape 4 when a final `expand`
leads to one more search), the solutions accepted during that search must not be
reported again by a later search of `S`. Implementation: during every search, for each accepted
candidate, queue its blocking clause (program literals, over all outgoing
links of `S`) in `S.pending`. They are injected at the next `init`. This costs
one clause per solution, so only do it when `SETTINGS.solutions ~= 1`.

Guard, eager shapes: `S:solve` on a solver with outgoing links remembers the
values of its last snapshot. If the next snapshot of `S` is identical on all
outgoing links, raise `the refinement made no progress: the same candidate
came back`. Skip the guard for solvers without outgoing links.

### 3.4 Models

A `Model` snapshot holds, per outgoing link of its solver, an array of booleans
(values of the interface atoms); per incoming link, an array of booleans
(indicator values); per capture, an array of symbols; and when tracing or when
solutions are shown, `shown = tostring(m)`.

A lazy model (inside `search`) reads the values from
`control.assignment:is_true(slit[j])` into the link's reusable buffer. It is
valid only during the callback. `M.lazy = true`.

`X:atoms(pred, arity)` returns the captured array (error if the predicate was
not captured).

## 4. One propagator per solver

Registered in `rt.solver`, with both hooks present from the start:

```lua
s.hooks = {
  init = function(_, init)
    -- 1. inject queued clauses (program literals -> solver literals)
    -- 2. refresh slit[] of every outgoing link
    -- (do not reorder or merge interface atoms: clause literal order follows link order,
    --  and the reference numbers depend on it)
  end,
  check = function(_, control)
    -- 0. if rt.fatal then return end
    -- 1. flush s.stash with control:add_clause{ c, lock = true }; return if any returns false
    -- 2. if s.on_check then call it inside xpcall; on error set rt.fatal and ctl:interrupt()
  end }
s.ctl:register_propagator(s.hooks)
```

`S:search` sets `s.on_check` for the duration of the solve and clears it after.
Limits (section 5.3) and the pause poll (section 6) are checked at the top of
`on_check`, once per candidate.

## 5. Events

Every event is one printed line: `@@` + kind letter + space + one JSON object.
The runtime contains a small JSON encoder (strings escaped for `"`, `\`,
control characters; numbers; booleans; arrays; objects; `nil` omitted).
Integers that clingo returns as floats are written without a fraction.

### 5.1 Kinds

| Kind | When | Fields |
| --- | --- | --- |
| `H` | End of `rt.prepare` | `solvers`: list of `{name, fragments, options, atoms, rules, ground}`; `links`: list of `{name, from, to, atoms}` (atoms = number of non-fact interface atoms); `settings` |
| `S` | At most every 0.25 s (checked once per candidate and per solve), and once at the end | See 5.2 |
| `M` | Each solution | `n` (running number), `atoms` (shown atoms as one string), `cost` (list, if any) |
| `T` | Each traced step while fewer than `SETTINGS.trace` have been sent | `i`, `kind` (`reject`, `add`, `expand`, `accept`), `solver`, `candidate` (string of true interface atoms), `counterexample` (shown atoms of the model the refinement came from, if known), `literals` (list of strings such as `-edge(1,2)`), `facts` (for `expand`: list of strings, at most 50) |
| `W` | clingo message | `solver`, `code`, `message` |
| `L` | `log` statement | `text` |
| `E` | Script error or guard | `message`, `line` (program line, if the message carries one), `traceback` |
| `D` | Last line of every run that did not trap | `outcome`: `finished`, `solutions`, `limit`, `stopped`, `error`; `exhausted` (bool or null); `detail` (string) |

### 5.2 The `S` event

```json
{ "t": 1.37, "candidates": 16577, "counterexamples": 7307, "solutions": 9270,
  "clauses": 7307, "literals": 55007, "maxlen": 23,
  "hist": [0, 3, 41, 2901, 4100, 262, 0, 0],
  "expansions": 0, "restarts": 0, "blocks": 0,
  "solvers": { "A": { "calls": 1, "sat": 0, "unsat": 0, "time": 0.38, "ground": 0.03,
                      "busy": true, "choices": null, "conflicts": null, "restarts": null,
                      "atoms": 159, "rules": 403, "vars": null, "constraints": null, "k": 0 },
               "C": { "calls": 16577, "sat": 7307, "unsat": 9270, "time": 0.83, "ground": 0.001,
                      "busy": false, "choices": 48211, "conflicts": 120, "restarts": 0,
                      "atoms": 159, "rules": 258, "vars": 300, "constraints": 800, "k": 0 } },
  "counters": { "long_clauses": 12 } }
```

- `candidates`: total assignments seen by `on_candidate` plus models returned
  by `solve`/`models` of solvers that have no incoming link.
- `counterexamples`: satisfiable results of solves that were given assumptions.
- `hist`: clause lengths in buckets 1, 2, 3–4, 5–8, 9–16, 17–32, 33–64, 65+.
- `time` is exclusive: time inside a nested solve (a check called from
  `on_candidate`) is subtracted from the searching solver.
- clasp numbers come from `ctl.statistics.accu` and are read only when the
  solver is not busy. Keep the last values read; send `null` before the first read.

### 5.3 Ending a run

`rt.run(f)`:

1. `xpcall(f, debug.traceback)`.
2. A run ends early by raising the sentinel table `rt.END` with
   `error(rt.END, 0)` from outside any callback. Inside a callback the runtime
   sets `rt.ending = {outcome, detail}`, interrupts, and raises the sentinel
   after `solve` returns.
3. Limits: `SETTINGS.seconds` (0 = none) against `os.clock() - rt.t0`;
   `SETTINGS.candidates` (0 = none). Outcome `limit`.
4. After `xpcall`: if the error is not the sentinel, emit `E` (outcome
   `error`). Then emit the final `S`, then `D`.

`SETTINGS.plain = true` (standalone export): instead of `@@` lines print
readable text: `Answer: n` + atoms per solution, and at the end a small table
of the counters. Keep this to one code path switch inside `emit`.

## 6. Pause poll

When `SETTINGS.poll` is true, `on_check` calls `io.read("l")` once per
candidate (and `S:solve` once per call in eager shapes). The worker's `stdin`
answers `go` or `stop`. On `stop`: outcome `stopped`, detail `stopped by user`.
With `poll` false, never call `io.read`.
