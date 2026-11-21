# CegarPlay: implementation plan

This plan is written for Claude Code. Follow it phase by phase. Everything
marked "verified" was run before this plan was written; the code that proves it
is in `spike/`. Everything marked "not verified" must be tested by you before
you build on it.

## 0. How to work through this plan

1. Read this file fully. Read the spec files only when a phase tells you to.
2. Work on one phase at a time, in order. A phase is done when all of its
   "Done when" checks pass.
3. At the end of each phase:
   - run the whole test suite (`cd test && npm test`);
   - update `PROGRESS.md` (tick the phase, record deviations from the plan,
     known problems, and the exact next step);
   - commit with the message `Phase N: <title>`;
   - print the line `CHECKPOINT N reached. Safe to /clear, then say: continue with PLAN.md`
     and stop. The user clears the context and tells you to continue.
4. After a context clear you know nothing but `CLAUDE.md`. Read `PROGRESS.md`,
   then this file, then the specs listed for the next phase. Do not re-read
   specs of finished phases unless you need a detail.
5. If the user said at the start "do not stop at checkpoints", keep going after
   step 3 instead of stopping. `PROGRESS.md` must still be current at every
   checkpoint, because the context may be compacted at any time.
6. Keep the context small: do not print large files, do not `cat` the WASM
   glue file or `js/ace.js`, pipe long test output through `tail`. Prefer
   running a test over re-reading code. A self-contained chore (vendoring
   fonts, writing the Instructions text) can go to a subagent.
7. If something in this plan turns out to be wrong, trust a test over the
   plan, fix the code, and record the deviation in `PROGRESS.md`. Do not
   silently change the reference numbers in `docs/reference-numbers.md`: if a
   number differs, find out why first.
8. Ask the user only when blocked. Decisions already made are in section 2.

## 1. What is being built

CegarPlay is a browser playground for CEGAR loops (counterexample-guided
abstraction refinement) written in answer set programming and solved with
clingo. It is a browser version of the Python prototype
https://github.com/rdehaan/declarative-cegar, laid out like
https://github.com/rdehaan/logic-game but without the game board.

The user writes:

- **ASP fragments**: the abstraction (proposes candidates), the check (finds
  counterexamples), the glue (which atoms the two share), and optionally
  refinement rules;
- **a loop script** in a small pseudo-code language that declares the solvers
  and says how they call each other;
- **settings**: constants, limits, number of solutions, seed.

Pressing Run executes the loop in a Web Worker. The page shows solutions,
live statistics and a step-by-step trace. A run can be aborted. Projects are
saved to and loaded from JSON files.

### Architecture in one paragraph

The page compiles the loop script to Lua and assembles one program: a
`#script (lua)` block that contains the ASP fragments as strings, a runtime
library (`lua/runtime.lua`) and the compiled loop. A module worker passes that
program to the stock `clingo-wasm` build in a single blocking `run()` call.
Inside it, the Lua code creates one `clingo.Control` per solver; all solvers
live in one WASM instance and exchange truth values as integer literals. The
runtime prints event lines (`@@S {...}`), which the worker forwards in batches
to the page. Abort terminates the worker.

```
Page:   editors -> compiler + driver -> engine client <-> worker
Worker: one WASM instance (clingo 5.8.1 + Lua 5.4.6)
          Lua runtime + compiled loop
            Solver A (abstraction)  --values of glue atoms-->  Solver C (check)
            Solver A  <--clause, or new rules--  Solver C
```

### Two kinds of refinement (both required)

1. **Clauses over glue atoms.** The check model marks atoms with `relevant(T)`;
   the runtime adds a clause "one of these must change" to the abstraction.
   This works while the abstraction is searching (a propagator adds it).
2. **Rules grounded into the abstraction.** The runtime adds facts
   `cex(k, T)` from the counterexample and grounds `#program refine(k).` in
   the abstraction. This needs the abstraction to be between solve calls.

"Optimisations" of a loop means making refinements cheaper or stronger
(several counterexamples per candidate, smallest refinement, unsat cores,
batching). Optimisation problems (`#minimize` in the abstraction) work in
Shape 1 without extra code and are tested, but are not a focus.

## 2. Decisions already made

| Topic | Decision |
| --- | --- |
| Name | CegarPlay |
| Engine | npm `clingo-wasm@0.6.0`, vendored, driven by a Lua runtime. No custom WASM build, no Pyodide. |
| Stack | Static files, native ES modules, no build step, no framework, ACE editor. Tests may use npm under `test/`. |
| Loop notation | The bespoke language in `docs/spec-loop-language.md`, plus raw Lua as an escape hatch. |
| Fragment names | `shared`, `abstraction`, `glue`, `check` by default. The prototype's `guess` is imported as `abstraction`. |
| Keywords | `expand`, `restart` and the others as specified. Do not rename. |
| Solver options | Only in the loop script (`options "..."`). |
| Examples | Shipped corrected (glue wrapped; added `relevant/1` rule for graph colouring), plus the original graph colouring rules as a separate example. |
| Browsers | Chromium must pass the browser tests. Firefox if Playwright can install it. Safari is not required. |
| Share links | Out of scope. |
| Upstream bug report for the trap | Out of scope (the user does it). |

## 3. Hard rules (keep these in mind in every phase)

These come from `docs/spec-runtime.md` section 1, which has the details.

1. **An error raised by clingo inside a Lua call kills the WASM instance**,
   even inside `pcall`. So: validate all ASP text before a run; wrap every
   callback body in its own `xpcall`; never let a Lua error cross a clingo
   frame; check preconditions in Lua before calling clingo.
2. A propagator table must have `init`, and all hooks must be present when it
   is registered.
3. After `add_clause` returns false in `check`, return immediately.
4. Never read `ctl.statistics` of a control that is solving.
5. Read models from a handle only with `h:iter()`.
6. Every head atom in a `#program part(k).` used with `expand` must mention
   `k`. clingo does not complain otherwise; the runtime's progress guard does.
7. No request to another origin from the finished site. Everything is vendored.
8. Modules that tests import (`js/compiler.js`, `js/driver.js`,
   `js/project.js`) must not touch the DOM or Node-only APIs.
9. Do not edit files under `spike/` or `reference/`. Copy from them.

## 4. Repository layout (target)

```
index.html
coi-serviceworker.js          phase 6
css/main.css
js/ace.js  js/mode-gringo.js  js/modal.js      copied from logic-game
js/mode-loop.js               ACE mode for the loop language
js/init.js                    start-up, URL parameters
js/project.js                 project model, load/save, .lp import/export
js/compiler.js                loop language -> Lua
js/driver.js                  validation, assembling the program
js/engine.js                  page side of the worker protocol
js/worker.js                  module worker
js/editors.js                 ACE editors built from the project
js/control.js                 run bar and run flow
js/output.js                  Output tab, trace view
js/stats.js                   Statistics tab, charts, run history
lua/runtime.lua               runtime library
vendor/clingo-wasm/           clingo.js clingo.wasm clingo-mt.js clingo-mt.wasm VERSION
vendor/fonts/                 Open Sans, Font Awesome (woff2 + css)
examples/*.json
tools/make-examples.mjs  tools/vendor.mjs
test/package.json  test/*.test.mjs  test/helpers.mjs  test/browser/*.mjs  test/serve.py
docs/                         the specs (already present)
spike/                        verified prototype code (already present; read-only)
reference/                    clones of logic-game and declarative-cegar (git-ignored)
CLAUDE.md  PLAN.md  PROGRESS.md  README.md  LICENSE
```

## 5. Phases

Phases 1–3 are pure logic and are tested in Node. Phases 4–5 build the page.
Phase 6 is optional polish that must not break anything before it.

---

### Phase 1: foundations and the runtime core

Read first: `docs/spec-runtime.md` (all), `docs/reference-numbers.md`,
`spike/README.md`, `spike/lua/runtime.lua`, `spike/js/assemble.mjs`,
`spike/js/shapes.mjs`, `spike/test/run.mjs`.

Tasks:

1. `git init`. Add `.gitignore` (already present: `node_modules`, `reference`).
2. Clone the two reference repositories into `reference/`:
   `git clone --depth 1 https://github.com/rdehaan/logic-game reference/logic-game`
   and `.../declarative-cegar reference/declarative-cegar`.
3. Run the spike to confirm the environment: `cd spike && npm install && npm test`.
   All 9 checks must pass before you write any code. Node 22 or newer is needed.
4. Create `test/package.json` (`"type": "module"`, script `"test": "node --test"`,
   devDependency `clingo-wasm@0.6.0`). Write `tools/vendor.mjs`, which copies
   `clingo.js`, `clingo.wasm`, `clingo-mt.js`, `clingo-mt.wasm` from
   `test/node_modules/clingo-wasm/dist/` to `vendor/clingo-wasm/` and writes
   `VERSION` with the package version and a sha256 per file. Run it. Commit the
   vendored files.
5. `test/helpers.mjs`: `run(program, options)` that creates a fresh module
   instance from `vendor/clingo-wasm/clingo.js`, executes one run and returns
   `{ status, out, err, events }` (events parsed from `@@` lines; status
   `"trap"` if the call throws). This is the `engineRun` used everywhere in tests.
6. `lua/runtime.lua`: start from the spike runtime and implement
   `docs/spec-runtime.md` sections 2–5 for this subset: `rt.solver`, `rt.link`
   (with `legacy`, `compat`), `rt.prepare`, `S:solve`, `S:search`,
   `M:reject` (single clause), `S:add`, `G:of`, `G:clause`, `G:block`,
   `rt.accept`, `rt.stop`, `rt.count`, `rt.log`, list helpers, `rt.run`,
   safe callbacks, guards, limits, solutions limit, the JSON encoder and the
   events `H`, `S`, `M`, `W`, `L`, `E`, `D`.
7. `js/driver.js`: `assemble` only (validation comes in phase 3), taking a
   project-like object and a Lua loop text.
8. Tests in `test/runtime.test.mjs`, using hand-written Lua loops for Shape 1,
   Shape 2 and the reference run.

Done when:

- Reference rows 1, 2, 3, 9 pass exactly; row 4 passes; row 10 passes.
- A loop that raises a Lua error inside `on_candidate` ends with an `E` event
  and a `D` event with outcome `error`; status is not `trap`.
- A `relevant/1`-free check fragment gives the `E` event
  `relevant/1 derived nothing for link G`.
- `SETTINGS.candidates = 100` ends row 1 early with outcome `limit` and a
  final `S` event with `candidates` = 100.
- `SETTINGS.solutions = 5` ends Shape 1 and Shape 2 with exactly 5 `M` events
  and outcome `solutions`.
- Every run that does not trap ends with exactly one `D` line as its last line.

**CHECKPOINT 1.**

---

### Phase 2: rule refinements and refinement variants

Read first: `PROGRESS.md`, `docs/spec-runtime.md` sections 3 and 5,
`docs/spec-loop-language.md` section 6 (the variants, to know what the runtime
must support), `docs/reference-numbers.md`.

Tasks (all in `lua/runtime.lua`, tests in `test/refine.test.mjs`):

1. `rt.capture`, `X:atoms`, `S:expand`, `S.k`, re-resolving captures after an
   expansion. Verified design: facts through the backend, then `ctl:ground`.
2. `rt.restart`, `S.exhausted`, automatic blocking of accepted solutions
   across restarts.
3. The no-progress guard for eager shapes.
4. `M:reject` with a list of clauses (stash; verified mechanism, not yet
   exercised in a full loop).
5. `S:models{ limit }`, `S:solve{ optimal }`, `rt.concat`.
6. `G:core` (**not verified**: only the core API is). Test it on a small dual
   problem you write yourself, where the candidate is good iff the check is
   satisfiable, and compare the solution count with a reference run.
7. `G:clauses` (**not verified**). Test with a check fragment that derives
   `clause(1, T, false)` for the same atoms `relevant/1` would mark true, and
   expect the same solution count as Shape 1 with the fix.
8. `T` events and `SETTINGS.trace`; `SETTINGS.seed`; `SETTINGS.plain`.
9. A second-solver refinement test (**not verified**): solver R with links
   A -> R and C -> R computing `relevant/1` from both; expect 10,698 with rules
   equivalent to the fixed ones.

Done when:

- Reference rows 5, 6, 7, 8 pass (row 6 may be marked slow and skipped by default).
- A refine part whose heads lack `k` ends with the `E` event
  `the refinement made no progress: the same candidate came back` in Shape 3.
- Tasks 4–7 and 9 each have a passing test that compares against a reference run.
- With `SETTINGS.trace = 5`, exactly 5 `T` events are sent; each has a
  candidate and literals or facts.
- Two runs with the same non-zero seed give identical `S` events; this is
  asserted for seed 1 on row 5.

**CHECKPOINT 2.**

---

### Phase 3: loop language, validation, project model

Read first: `PROGRESS.md`, `docs/spec-loop-language.md` (all),
`docs/spec-app.md` sections 1–3 and 7.

Tasks:

1. `js/compiler.js` as specified. Tests in `test/compiler.test.mjs`:
   - each template compiles and, run through the engine, gives the same
     statistics as the hand-written Lua of phases 1–2 (reference row 13);
   - each variant of spec section 6 compiles and runs;
   - each static check has a test asserting line, column and message;
   - `map` is correct: a script with a deliberate run-time error on a known
     line produces an `E` event whose mapped line is that line.
2. `js/driver.js`: `validate` and the final `assemble`. Tests in
   `test/driver.test.mjs` for the three verified validation cases, mapped to
   the right fragment and line when the fragment is second in a solver.
3. `js/project.js`: model, `load`, `save`, `importLp`,
   `exportStandalone` (`exportLp` was removed later at the user's request). Tests in `test/project.test.mjs`: round trip; import of
   the three files in `reference/declarative-cegar` (four fragments each,
   `legacy` detected for two of them, `explain1.lp` split correctly despite its
   comments).
4. `tools/make-examples.mjs` and the four example files of spec-app section 7.
   Tests: reference rows 11 and 12; `examples/graph-coloring.json` gives
   10,698 with Shape 1 and with Shape 4.
5. If a native `clingo` with Lua is on the PATH (`clingo --version` mentions
   `with Lua`), a test runs a standalone export natively and compares the
   solution count. Otherwise the test is skipped.

Done when: all tests above pass, and `cd test && npm test` passes as a whole.

**CHECKPOINT 3.**

---

### Phase 4: the page

Read first: `PROGRESS.md`, `docs/spec-app.md` sections 4–8, and from
`reference/logic-game`: `index.html` (first 130 lines and the script tags at
the end), `css/main.css`, `js/control.js`, `js/inputs.js`, `js/init.js`,
`js/modal.js`. Look at `spike/web/worker.js` and `spike/web/main.js`.

Tasks:

1. Copy `css/main.css`, `js/ace.js`, `js/mode-gringo.js`, `js/modal.js` from
   logic-game. Remove board styles. Vendor the fonts (spec-app 5.4) and point
   the CSS at them. Add logic-game's MIT licence text to `LICENSE` notes in the
   README.
2. `index.html` with the run bar and the seven tabs (ids as specified).
3. `js/worker.js`, `js/engine.js`.
4. `js/editors.js`, `js/mode-loop.js`, `js/project.js` wiring: load example,
   upload, download, import `.lp`, both exports.
5. `js/control.js`: the run flow of spec-app section 6, with validation
   annotations and read-only editors during a run.
6. `js/output.js`: result line, solutions, grouped messages, errors. (Trace
   view comes in phase 5.)
7. Minimal statistics: the live line, and in the Statistics tab the summary
   row and the solver table from the last `S` event.
8. `test/serve.py` and the five browser tests of spec-app section 8.

Done when:

- The five browser tests pass in Chromium.
- Loading `index.html` causes no request to another origin and no console error.
- `?file=nash` and `?tab=4` work.

**CHECKPOINT 4.**

---

### Phase 5: statistics, trace, texts

Read first: `PROGRESS.md`, `docs/spec-app.md` sections 9–11.

Tasks:

1. `js/stats.js`: full Statistics tab: charts, refinements block, custom
   counters, run history with the mismatch marker, "Rerun with 5 seeds", Copy,
   "include run history" on download.
2. Trace and replay view in the Output tab.
3. Template selector, constants table, limits, trace and seed fields,
   "Edit as Lua" in the Loop tab.
4. Internals tab.
5. Instructions tab, modals, `README.md`.
6. Browser tests: charts exist and update during a run; the trace slider shows
   candidate, counterexample and refinement for step 1 of the default example;
   running `graph-coloring-original` with Shape 1 and then with the Reference
   run template (n=6, all solutions) marks both history rows as a mismatch
   (9,270 against 10,698); "Rerun with 5 seeds" adds five rows.

Done when: the browser tests pass and the whole suite passes.

**CHECKPOINT 5.**

---

### Phase 6: pause, step, stop and threads (optional)

Read first: `PROGRESS.md`, `docs/spec-app.md` section 12, `spike/web/worker.js`,
`spike/web/main.js`.

Tasks:

1. Vendor and load the service worker shim. **Not verified.** First prove in a
   Playwright test, against the plain server, that the page becomes
   cross-origin isolated after the automatic reload. If you cannot make it
   work in about an hour, stop, leave the feature behind a `?coi=1` switch,
   record it in `PROGRESS.md`, and finish the phase with the header-based
   server only.
2. Control buffer, `poll = true`, Pause, Step, Stop.
3. Threads checkbox and the `clingo-mt` build.
4. Browser tests on the isolated server (`test/serve.py <port> coi`): pause
   freezes the live line for 700 ms; resume continues; stop ends with status
   `finished`, outcome `stopped` and final statistics; a solver with
   `options "-t 2"` gives 9,270 on reference row 2.
5. Re-run all earlier browser tests on the plain server: nothing may change
   for a page that is not isolated.

Done when: the tests in 4 and 5 pass.

**CHECKPOINT 6.** Then do the final review below.

---

### Final review

1. Run the whole suite once more. Run `npm run test:slow` if you defined it.
2. Read the page in a browser test screenshot at 1400 px and 700 px width;
   fix layout breakage.
3. Check `README.md` describes: purpose, local serving
   (`python3 -m http.server`), tests, vendoring, GitHub Pages deployment (push;
   enable Pages on the main branch root), licences, and the known limitation
   that a clingo-internal error ends a run without a message.
4. Update `PROGRESS.md` with a short hand-over: what works, what is behind a
   switch, what was not done.

## 6. Out of scope and stretch

Do not build these unless every phase is done and the user asks:

- carrying an optimisation bound across re-solves in Shapes 2–4;
- a 2-QBF or conformant-planning example (if you add one, validate it with a
  reference run);
- parallel checks in several workers; a custom WASM build; Pyodide;
- share links; Safari-specific work.
