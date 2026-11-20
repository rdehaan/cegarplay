# Progress

Update this file at every checkpoint. After a context clear, this file is the
only memory of what happened.

## Status

- [x] Phase 1: foundations and the runtime core
- [x] Phase 2: rule refinements and refinement variants
- [ ] Phase 3: loop language, validation, project model
- [ ] Phase 4: the page
- [ ] Phase 5: statistics, trace, texts
- [ ] Phase 6: pause, step, stop and threads (optional)
- [ ] Final review

## Next step

Start phase 3, task 1 (`js/compiler.js`).

## Deviations from the plan

- Branch renamed `master` -> `main` before the first commit.
- Root `package.json` with `"type": "module"` and `vendor/clingo-wasm/package.json`
  (written by `tools/vendor.mjs`) so Node loads `js/*.js` and the vendored glue as ES
  modules without warnings. The site does not use them.
- `lua/runtime.lua` was written in one go with most of the phase 2 API (expand,
  restart, models, core, clauses, trace); phase 1 tested only the phase 1 subset.
- `rt.stop()` without a message ends with outcome `finished` and `exhausted` =
  whether the last solve without assumptions (or the last search) was exhaustive.
  Shape 2 uses `if not M: stop`, which must count as a normal end. With a message:
  outcome `stopped`.
- `H` event: `atoms` is the number of symbolic atoms after grounding; `rules` is
  null (clasp's lp statistics are empty before the first solve).
- Runtime errors are raised without a position (`error(msg, 0)`); the `E` event's
  `line` is the first line number in the message or traceback that lies inside the
  loop (the driver appends `LOOP_LINES = {first, last}` after `main`).
- No-progress guard applies only to solvers with outgoing links and **no incoming**
  links (abstraction-like). A check solver with an outgoing link (second-solver
  refinement, test "refinement computed by a second solver R") legitimately returns
  identical counterexamples in a row.
- `T` events of kind `accept` carry a candidate but no literals/facts. The phase 2
  check "each has a candidate and literals or facts" is asserted for every
  non-accept event (test "trace = 5 ...").
- `S:models{limit}` sets `configuration.solve.models` to the limit for that call
  and restores it (the default is 1, so without this only one model comes back).
- `SETTINGS.seed` passes `--seed=N`, but with clasp's default heuristics the seed
  changes nothing (row 5 with seed 0 and seed 1 have identical statistics). It
  only matters together with randomising options such as `--rand-freq=0.05` or
  `--sign-def=rnd`. Mention this in the UI next to "Rerun with 5 seeds".
- Propagator `check` returns at once unless `control.assignment.is_total`: after
  clauses were added (stash flush), clasp calls `check` on partial assignments.
  Rows 1-3 are unchanged by this.

## Known problems

(none yet)

## Notes for the next context

- `control:add_clause{ c }` fails with "bad argument" if `c` has non-integer
  fields (the runtime's clause tables carry `link`, `j`, ...). Always pass a plain
  copy (`plain(c)`). The error is catchable, not a trap.
- `test/helpers.mjs`: `run`, `runLua(project, lua)`, `LUA.shape1..4/reference`
  hand-written loops, `GC6()`, `FIX`, `REFINE_PART`, `splitLp`.
- Rows 4 and 10 take 10 s and 7 s; they run in the default suite (concurrency 4).
  Row 6 (18 s) runs only with `SLOW=1` (`npm run test:slow`).
- **A Lua error in the propagator hooks outside `xpcall` traps silently.** A local
  function used in a hook but defined further down the file is a nil global at
  that point -> trap. Cost an hour in phase 2 (it looked like a clasp problem with
  satisfied clauses; it was not). Test "strict _G" in `test/refine.test.mjs` runs
  the main paths with an `_G` that raises on undeclared globals. Keep helper
  locals above `rt.solver`.
