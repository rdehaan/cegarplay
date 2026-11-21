# Progress

Update this file at every checkpoint. After a context clear, this file is the
only memory of what happened.

## Status

- [x] Phase 1: foundations and the runtime core
- [x] Phase 2: rule refinements and refinement variants
- [x] Phase 3: loop language, validation, project model
- [x] Phase 4: the page
- [x] Phase 5: statistics, trace, texts
- [x] Phase 6: pause, step, stop and threads (optional)
- [x] Final review

## Hand-over (final review, 2026-11-20)

What works: every phase of PLAN.md, including the optional phase 6. `cd test &&
npm test` runs 107 tests (Node and Chromium) in about 40 s: 105 pass, 2 skipped
(row 6, slow; the native clingo export test, as this machine's clingo has no Lua).
`npm run test:slow` also runs row 6 (passes). All browser tests also pass in
Firefox (`BROWSER=firefox npm test`). Screenshots at 1400 px and 700 px show no
layout breakage or horizontal overflow.

Behind a switch: nothing. The isolation shim is on by default; `?nocoi=1` turns
it off. Internals tab only with `?internals=true`.

Not done / for the user: deployment to GitHub Pages (push, enable Pages on
`main`, root); the upstream bug report for the trap; `START-HERE.md` can be
deleted.

## Improvements after the final review (2026-11-21)

- Bug: ACE editors built inside a hidden tab (fragments, loop, the Instructions'
  code examples) were cropped or empty until something resized them. `init.js`
  now resizes the editors of a tab when it is shown and after a project load.
- Ctrl+Enter / Cmd+Enter runs from anywhere (capture listener on `window`).
- Autosave: the project (with run history) is kept in `localStorage`
  (`cegarplay.project`) and restored at start-up unless `?file=` or `?fresh=1`.
  Loading an example or a file over an edited project asks first (`app.edited`).
- clingo messages: the runtime's logger rewrites `<block>:L:C` to
  `fragment:L:C` (line within the fragment) and adds `fragment/line/col` to the
  W event; the page marks these lines in the editors after the run (infos in
  blue do not set the red tab marker).
- Run-time errors: a hint sentence for common errors (`relevant/1 derived
  nothing`, glue derives nothing, no progress); the Lua traceback is collapsed.
- Trace panels: atoms flow inline, one line per predicate.

## Next step

None. Possible extras (PLAN section 6) only on request.

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
- No `T` events for accepted candidates (kind `accept` is never sent): solutions
  are listed in the Output tab, and this keeps both "Done when" checks true: every
  `T` event has literals or facts (phase 2), and step 1 of the default example
  shows a candidate, counterexample and refinement (phase 5).
- `S:models{limit}` sets `configuration.solve.models` to the limit for that call
  and restores it (the default is 1, so without this only one model comes back).
- `SETTINGS.seed` passes `--seed=N`, but with clasp's default heuristics the seed
  changes nothing (row 5 with seed 0 and seed 1 have identical statistics). It
  only matters together with randomising options such as `--rand-freq=0.05` or
  `--sign-def=rnd`. Mention this in the UI next to "Rerun with 5 seeds".
- Propagator `check` returns at once unless `control.assignment.is_total`: after
  clauses were added (stash flush), clasp calls `check` on partial assignments.
  Rows 1-3 are unchanged by this.
- Compiler: an unknown name (never assigned, not declared) is a static error
  (`unknown name 'y'`), in addition to the checks of spec section 3.6. `ipairs`
  and `_` are reserved too (the generated `for` uses them). Lines emitted for
  `end`, labels and the like map to `null`; the `rt.prepare()` line maps to the
  last declaration.
- `validate` for raw Lua projects checks every fragment on its own (spec says
  skip), so a syntax error still cannot reach clingo inside a run.
- `validate` returns the problem list with the compiler result attached as
  `problems.compiled`, so the run flow does not compile twice.
- Examples: glue wrapping also wraps body atoms of predicates defined in the
  glue fragment (`leaf_color(N,C) :- node(N), color(C).` becomes
  `glue(leaf_color(N,C)) :- node(N), glue(color(C)).`), else the rule loses its
  meaning. Rows 11 and 12 confirm identical statistics.
- Example settings: graph-coloring and graph-coloring-original use n = 6 and
  solutions = all (the default example's run must show the reference numbers);
  nash and voting use solutions = 1. The voting example uses Shape 1 without
  `compat`.
- Page modules beyond the plan's list: `js/trace.js` (trace view), `js/loop-tab.js`
  (Loop tab), `js/internals.js` (Internals tab). `js/stats.js` and the trace view
  were written in full during phase 4 (charts, history, copy, rerun with seeds).
- `js/modal.js` rewritten with event delegation (fragment headings are built
  dynamically); behaviour as in logic-game.
- Browser tests live in `test/browser/*.test.mjs` and run in `npm test`; each
  file starts its own `serve.py` on a free port and a headless Chromium
  (`test/browser/harness.mjs`). Playwright 1.65 (Chromium build 1255).

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
- Tests: `H.runProject(project)` compiles + runs; `H.example(name)` loads an
  example; `H.stripTimes(S)` drops time fields for equality checks.
- Native clingo on this machine (conda, 5.8.3) is built without Lua, so the
  native standalone test is skipped.
- The page exposes `window.cegarplay` (app object) for debugging and tests.
  `body[data-ready="true"]` is set when the engine is ready.
- `[hidden] { display: none !important }` is needed: `.control-button` sets
  `display: inline-block`, which otherwise overrides the hidden attribute.
- Instructions text lives in `instructions.html` (an HTML fragment fetched by
  `js/init.js` into `#instructions`; `.example-code` divs become read-only ACE
  editors with `data-mode="loop"|"gringo"`).
- Phase 6: `coi-serviceworker` 0.1.7 is vendored at the root by `tools/vendor.mjs`
  and configured through an inline `window.coi` in `index.html`: `?nocoi=1` neither
  registers nor keeps the service worker. It worked at the first try on the plain
  server (Chromium): one reload, then `crossOriginIsolated` is true. The browser
  harness opens pages with `?nocoi=1` unless `{ coi: true }` is passed, so the
  phase 4/5 tests run on a non-isolated page as before.
- In Firefox the shim's reload interrupts the first document's start-up, which
  logs console errors (aborted font downloads, Playwright's `chrome://juggler`).
  The harness clears the error list once the page is isolated, and `init.js` does
  not log start-up errors while the page is unloading.
