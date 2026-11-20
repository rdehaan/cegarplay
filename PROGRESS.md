# Progress

Update this file at every checkpoint. After a context clear, this file is the
only memory of what happened.

## Status

- [x] Phase 1: foundations and the runtime core
- [ ] Phase 2: rule refinements and refinement variants
- [ ] Phase 3: loop language, validation, project model
- [ ] Phase 4: the page
- [ ] Phase 5: statistics, trace, texts
- [ ] Phase 6: pause, step, stop and threads (optional)
- [ ] Final review

## Next step

Start phase 2, task 1 (runtime already contains most of the phase 2 API, untested).

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

## Known problems

(none yet)

## Notes for the next context

- `control:add_clause{ c }` fails with "bad argument" if `c` has non-integer
  fields (the runtime's clause tables carry `link`, `j`, ...). Always pass a plain
  copy (`plain(c)`). The error is catchable, not a trap.
- `test/helpers.mjs`: `run`, `runLua(project, lua)`, `LUA.shape1..4/reference`
  hand-written loops, `GC6()`, `FIX`, `REFINE_PART`, `splitLp`.
- Rows 4 and 10 take 10 s and 7 s; they run in the default suite (concurrency 4).
