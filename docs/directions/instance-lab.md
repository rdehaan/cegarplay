# Implementing the Instance Lab

Five phases, I1 to I5. I1 and I2 need nothing from the other directions. I4 needs the audit (S1) and the compact events (V1).

## Phase I1: Instances

An instance becomes a named set of facts and constants that a run applies on top of the project. The runtime barely changes, because an instance is delivered as one more fragment.

**Read first:** `js/project.js`, `js/driver.js` (`assemble`, `validate`, `joinForValidation`), `lua/runtime.lua` (`rt.solver`, `rt.link`, `join`, `fragment_lines`), `tools/run.mjs`, `test/library.test.mjs`.

**Where instances live today:** in the `shared` fragment. `af-preferred` keeps `arg/1`, `att/2` and `query/1` there, `qbf` keeps `xvar/1`, `xlit/3` and `ylit/3`, and `kemeny-control` keeps `ballot/2`. Graph colouring has only the constant `n`.

**Verified (probe 4):** a plain run returns status 30 for a satisfiable program and 20 for an unsatisfiable one. Task 4 may read that status instead of printing a line.

**Tasks:**

1. `js/project.js`: set `VERSION = 2` and accept versions 1 and 2 in `load`. Validate the new keys:
   - `instances[]`: `id` matching `[A-Za-z0-9_-]+` and unique, `facts` (string), `constants` (object of strings), `expected.solutions` (number or null), `tags` (list), `recipe` (object, used from I2).
   - `variants[]`: `name`, optional `loop`, `swap` (fragment name to fragment name), `constants`.
   - Reserve the fragment name `instance`: `load` rejects a user fragment with that name.
2. `js/project.js`: `save` writes `version: 1` when no new key is in use, so version 1 pages still open such files.
3. `js/project.js`: add `applyVariant(project, name)` and `applyInstance(project, id)`. Both return a new plain project; neither touches the stored one.
4. `js/instances.js`: `checkSchema(project, id, engineRun)` runs the instance facts plus the `schema` fragment through a three-line Lua `main` that prints `@@Q {"sat":true}` or `false`.
5. `lua/runtime.lua`: in `rt.solver` and `rt.link`, put `"instance"` first in the fragment list when `FRAGMENTS.instance` exists and the list lacks it.
6. `js/driver.js`: `validate` adds `instance` to every fragment group by the same rule. `assemble` needs no change.
7. `js/instances.js`: importers `fromFacts`, `fromDimacsGraph` and `fromQdimacs`, each `(text, names) -> { facts, constants }`, where `names` renames predicates. Imported facts pass `clingo --mode=gringo` before they are stored.
8. `tools/run.mjs`: options `--instance <id|all>` and `--variant <name>`; `runProject(project, { instance, variant })`. With `all`, print one line per instance and exit with 1 on an expected-count mismatch.
9. Page:
   - `index.html`: tab 9 "Instances" between Programs and Loop, and `<select id="instance-select">` in the run bar, hidden without instances. `js/init.js` accepts `?tab=9` to `11` and `?instance=<id>`.
   - `js/instances-tab.js`: a list (id, tags, expected, last count), a facts editor in gringo mode, a constants table, Import, and "Run all".
   - `js/control.js`: `run({ seed, instance, variant })` applies both before `validate`. `info.fragmentsHash` includes the instance, so the run history compares like with like.
10. Library, in `tools/library.mjs` and `tools/make-examples.mjs`: move the instance facts of `af-preferred`, `qbf` and `kemeny-control` out of `shared`. Give `graph-coloring` three constants-only instances, n = 4, 5 and 6.
11. `test/library.test.mjs`: check every instance that has an expected count. `docs/spec-instances.md` and the manual's "Project file format" describe the keys.

**Done when:**

- `node tools/run.mjs graph-coloring --instance all` prints three lines, with 101 solutions at n = 5 and 10,698 at n = 6.
- `af-preferred` still gives 3 solutions with its facts moved to an instance.
- A clingo message about an instance fact names `instance:<line>` in the `W` event.
- A project without new keys saves with `"version": 1`.
- A browser test selects an instance, presses Run and reads its count; "Run all" marks a wrong `expected` in red.

**Checkpoint I1.**

## Phase I2: Generators

A generator is an ASP program grounded with a table of seeded draw functions. One engine call turns a recipe into instance facts.

**Read first:** `spike2/probe3.lua` and `spike2/probe3b.lua`, `docs/spec-runtime.md` section 1.1, `js/driver.js` (`validate`), `tools/cegarcheck.py` (`join`, `Checker`).

**Verified (spike 3):**

- `ctl:ground({{"base", {}}}, context)` calls `context.flip(context, P, X, Y)`: the context is the first argument.
- A Lua error inside a draw function traps the engine, so every body runs inside `pcall`.
- A splitmix-style mixer on Lua 5.4 integers gives the same facts on a second run and with the rules in another order.
- Rejection works: with n = 7 and p = 300, five connected graphs took seven draws.

**Verified (probe 4):** a stub `#script (lua)` block that defines `flip` lets `clingo --mode=gringo` check a generator. Unsafe variables and syntax errors return status 65 with their line, which task 4 shifts by the length of the stub.

**Verified (a prototype of this revision):** `gen/draws.lua` and `gen/draws.py` in the prototype archive are a first version of tasks 1 and 6, with the spike's mixer unchanged.

- All six functions give the same values in Lua and in Python.
- Seeds 1 to 5 of `gnp` equal the facts and attempt numbers that `spike2/probe3.lua` prints, so reference row 26 holds.
- A connected-graph generator with n = 9 and p = 250 gives identical facts in the engine and in the twin for 30 of 30 seeds.
- `mallows` is built by repeated insertion with 30-bit integer weights, not by Fisher–Yates. Task 1 should say so.
- Over 1,500,000 draws of `flip` at 300 the frequency was 0.30034.
- The prototype defines the functions as globals of a `#script (lua)` block. Task 2's context table is the form to ship, because it keeps seed and attempt out of global state.

**Tasks:**

1. `lua/draw.lua`: the mixer and `hash(seed, attempt, name, args)` copied from the spike, then the context table:
   - `flip(P, K…)`, `int(Lo, Hi, K…)`, `weighted((W1,…), K…)`: one hash each.
   - `perm(N, I, K…)`, `subset(M, N, I, K…)`, `mallows(N, Phi, I, K…)`: build the whole permutation once per key by Fisher–Yates over successive hashes, and cache it for the run.
   - Every function checks its argument types in Lua and returns `clingo.Number`. A bad argument sets `draw.error` and returns 0.
2. `lua/generate.lua`: `gen.run{ text, params, seed, attempts }`. For each attempt it creates a control with the parameters as constants, grounds with the context and asks for two models.
   - One model: emit `@@G` with `facts`, `attempt` and `exact = true`.
   - Two models: the same with `exact = false`, the label "solver-completed".
   - No model: next attempt. After `attempts` (default 100) emit `@@G {"error": …}`.
   - `facts` is each shown symbol followed by a full stop, so it is valid ASP by construction.
3. `js/generate.js` (no DOM): `assembleGenerator(generator, params, seed, luaTexts)` and `generate(…, engineRun) -> { facts, attempt, exact }`.
4. `js/driver.js`: `validateGenerator(generator, engineRun)` runs `--mode=gringo` on the text behind a stub script that defines every draw function. A syntax error is then reported with its line, and never reaches `ctl:add`.
5. `js/instances.js`: `resolveInstance(project, id, engineRun)` turns a `recipe` into facts on demand and caches them in memory with a content hash. Project files keep the recipe only.
6. `tools/draw.py`: the same mixer in Python with 64-bit masks. `tools/cegarcheck.py` gains `--instance <id>`. `test/draw-vectors.json` holds 200 values written from Lua and asserted in both languages.
7. Page, inside the Instances tab: a generator list and editor, a parameter table with types `int` and `permille`, a seed field, and "Preview 6". The preview shows six instances as fact lists with attempt number and the exact or solver-completed label. "Add as instance" stores the recipe.
8. Starter generators in `tools/library.mjs`, attached to the examples they fit: `gnp` and `gnm` (for `clique-colouring`, `arrowing`, `choosability`), `af-gnp` (for `af-preferred`, `af-semi-stable`), `qbf-dnf` (for `qbf` and its variants), `ballots-ic` (for `kemeny-control`).
9. `docs/spec-instances.md` gains the generator chapter, including the modulo bias of `int` (below 2^-30 for ranges under 2^23, since a draw uses 53 bits).

**Done when:**

- Reference row 26 holds, and seeds 1 to 5 of `gnp` equal the facts printed by `spike2/probe3.lua`.
- The 200 test vectors agree in Lua and Python.
- Each library generator gives identical facts after its rules are shuffled.
- `@flip(a, 1)` in a generator ends with an error event, not a trap.
- `qbf` with a `qbf-dnf` recipe gives the same solution count in its own loop and in the Reference template.

**Checkpoint I2.**

## Phase I3: Campaigns

A campaign expands a suite into cells, runs them on a pool of engines, and stores one row per cell. The same code runs in the page and in `tools/bench.mjs`.

**Read first:** `js/engine.js`, `js/worker.js`, `tools/run.mjs` (`engineRunWithin`), `js/stats.js` (the hand-built SVG charts and `hashText`), `js/share.js` (use of `CompressionStream`).

**Measured (spike 7):** a fresh engine instance takes 30 ms, and a small run such as `tutorial-first-run` takes 86 ms including it. A thousand small cells therefore cost about 90 s on one worker.

**Not verified:** how many engine workers a browser tab sustains. Task 2 starts at `hardwareConcurrency - 1`, capped at 8, and measures.

**Tasks:**

1. `js/campaign.js` (no DOM): `expandSuite(project, suite)` returns cells `{ key, instance, variant, seed }`.
   - A suite draws instances from a generator grid, from a grid over constants, or from a list of instance ids.
   - `key` is a SHA-256 (`crypto.subtle`) over the derived project's fragments, loop, constants, limits, seed and the engine version.
   - `--shard i/n` keeps the cells whose key, read as a number, is `i` modulo `n`.
2. `js/pool.js`: `new Pool(size)`, `pool.run(job)`, `pool.abortAll()`. Each slot owns one `Engine`. A job carries an assembled program and a reducer; the default reducer keeps the last `S`, the `D`, the solution count and an order-independent hash of the solution texts.
3. `js/campaign.js`: `runSuite(project, suite, { pool, store, onProgress })`.
   - Validate each variant once, not once per cell.
   - Resolve each recipe once, then run its cells.
   - Skip cells whose key is in the store.
   - Evaluate `where` filters when the runs they name exist. The grammar is `solutions(v) <op> N`, `candidates(v) <op> N` and `outcome(v) == "…"`.
4. `js/store.js`: an IndexedDB database `cegarplay` with a store `cells` keyed by cell key. `exportRows()` and `importRows(text)` use JSON lines, the format `tools/bench.mjs` writes.
5. `tools/bench.mjs <project> --suite <name> [--jobs N] [--shard i/n] [--out file.jsonl] [--resume]`, with `worker_threads` as the pool.
6. `js/campaign-tab.js`, tab 10:
   - A suite editor, Start, Pause and Resume.
   - A progress grid on a canvas, one square per cell, coloured by outcome.
   - Four hand-built SVG plots: scaling per variant (median and interquartile band on a log axis), a heat map over two parameters, a scatter of one variant against another, and solved-within-time curves.
   - A growth fit per variant: least squares on the log of the medians, with a 90% interval from 200 bootstrap resamples.
7. Consistency: for each instance, exhausted variants whose solution hashes differ are marked red, and the tab header counts them.
8. `docs/spec-instances.md` gains the suite format and the row format.

**Done when:**

- A 1,000-cell suite over a constants grid finishes; after a page reload, Resume runs zero cells.
- Two shards of `tools/bench.mjs` together produce the rows of an unsharded run, and the page draws the same plots from the imported file.
- A suite with the loop of `tutorial-weak-relevant` and a `reference` variant marks n = 8 red (11 against 61 solutions).
- Abort during a suite leaves no running worker (browser test).

**Checkpoint I3.**

## Phase I4: Fuzz and shrink

Fuzz walks instances from small to large, asks the audit for a verdict on each, shrinks the first unsound instance, and names the refinement that removes a solution. It needs S1 and V1.

**Read first:** `lua/audit.lua` and its `A` event (S1), `js/recording.js` (V1), `js/pool.js`, `test/refine.test.mjs`.

**Verified (spikes 6 and 8):**

- The audit gives a verdict that does not depend on the search order. A count comparison does: `graph-coloring-original` at n = 5 returns the right count, 101, and is in fact sound there.
- `tutorial-weak-relevant` is sound at n = 1 and unsound at n = 2, with the candidate `pick(1) pick(2)` as witness.
- `graph-coloring-original` is sound at n = 3, 4 and 5 and unsound at n = 6.

**Verified (a prototype of this revision):** `audit/fuzz_shrink.py` in the prototype archive runs the whole chain on `guide-04-one-node`. It works in the fallback mode of task 1 and compares solution counts with a reference variant.

- The first `gnp` instance (n = 4, p = 500, seed 1) differs: 7 solutions against 13.
- ddmin over its 8 facts ends with 6, one triangle, where the loop gives 4 solutions and the reference 7. It needed 31 engine runs.
- The audit of the triangle reports one unsound pair, and the first violated step of the recorded run is step 1.
- This fixture complements task 7: it shrinks facts of two predicates under a schema check, which the sum-free fixture does not.

**Not verified:** replaying expansions on a fresh solver from recorded facts (task 5).

**Tasks:**

1. `js/fuzz.js` (no DOM): `fuzz(project, { source, budget, pool })`.
   - `source` is a generator grid or a constants grid, ordered by the product of its numeric parameters.
   - Each instance gets one audit job. The first verdict `unsound` stops the walk; `limit` skips the instance.
   - Without an audit mode for the script (see S1), fall back to comparing solution hashes with a `reference` variant, and say so in the report.
2. `js/shrink.js` (no DOM): `shrink(items, test, { pool })`, the ddmin algorithm.
   - Instance facts are first normalised to one ground fact per item, by running them through `clingo --mode=gringo --text`.
   - `test(subset)` is true when the `schema` check passes and the audit is still unsound.
   - The tests of one ddmin round are independent and run in parallel on the pool.
   - A second pass lowers each numeric constant while the test holds.
3. `js/recording.js`: `firstViolated(recording, solutionBits)` returns the first `R` step whose clause the solution falsifies. This covers clause refinements.
4. `js/fuzz.js`: `diagnose(project, instance, witness)` runs the project's own loop once with every step recorded, then calls `firstViolated` with the audit's lost solution. If the run did not lose that solution, it reports the audit witness alone.
5. `lua/replay.lua` and assemble mode `replay`, for rule refinements: ground the recorded facts of each expansion on a fresh solver, and after each one solve under the lost solution's interface values. The first unsatisfiable step is the culprit.
6. Page, Instances tab: a Fuzz button, a progress line, and a result card with the minimal instance, the lost solution, the culprit step and three actions: "Open in trace", "Show audit witness", "Save as regression instance".
7. `test/fuzz.test.mjs` with a fixture: the sum-free project of `tutorial-weak-relevant` with `num/1` given as eight instance facts.

**Done when:**

- Fuzz on `tutorial-weak-relevant` over n = 1 to 8 stops at n = 2 and reports the candidate `pick(1) pick(2)` and the lost solution `pick(2)`.
- Shrinking the fixture ends with two facts, and the audit of those two facts is unsound.
- `firstViolated` returns a step whose clause the lost solution falsifies, while it satisfies every earlier clause.
- Fuzz on `graph-coloring-original` over n = 3 to 6 stops at n = 6 (slow test).
- Fuzz on `tutorial-first-run` over n = 1 to 8 reports no unsound instance.

**Checkpoint I4.**

## Phase I5: Mining, pools and the remaining importers

Three additions that reuse the campaign machinery: a search for hard instances, replay of recorded counterexamples as a warm start, and three more file formats.

**Read first:** `js/campaign.js`, `lua/runtime.lua` (`Solver:expand`, `rt.capture`), `js/compiler.js` (how `atoms` and `expand` compile), the examples `gc-shape3` and `gc-shape4`.

**Verified:** `clingo.parse_term` exists in the WebAssembly build (spike 1).

**Not verified:** that a warm start from a pool reduces check calls; that `parse_term` on bad text raises an error Lua can catch. Task 4 validates pool items first, so the second point cannot trap.

**A correction to the first tab.** A pooled counterexample is only safe on an instance with the same check domain. A colouring of six nodes, replayed on seven nodes, is a partial colouring; the `refine` rules then demand too much and remove solutions. Pools are therefore keyed by a domain hash, and replay across different domains is off unless the user asks for it and the audit passes.

**Tasks:**

1. `js/mine.js` (no DOM): `mine(project, { source, objective, budget, pool })`.
   - Objectives: candidates per solution, clauses, time, or the ratio of one of these between two variants.
   - Stage 1, successive halving: run many seeds under a short time limit, keep the best third, triple the limit, repeat.
   - Stage 2, mutation: add or remove one fact, keep the change when `schema` holds and the objective rises; restart from the best three.
   - Results become instances with the tag `hard`, stored as a recipe plus a list of mutations.
2. `lua/runtime.lua`: `rt.pool(name)` returns the pool's items as lists of symbols, built with `clingo.parse_term`. `rt.pool_key(S, pred, arity)` hashes the sorted atoms of a predicate in a solver, the check domain.
3. `js/compiler.js`: the expression `pool(name)`, compiled to `rt.pool("name")`:

   ```loop
   for P in pool(cex):
       A.expand(refine, cex = P)
   ```
4. `js/project.js` and `js/driver.js`: the key `pools[]` with `name`, `domain` and `items` (lists of atom texts). `validate` passes every item through `--mode=gringo` as facts. `assemble` writes only the pools whose `domain` equals the hash the run reports, unless `settings.pools = "any"`.
5. Page, Statistics tab: "Save counterexamples as pool" after a run with expansions; it reads the `R` events of kind expand. Campaign variants may name a pool, so a suite compares warm against cold.
6. `js/instances.js`: importers `fromApx` and `fromTgf` (to `arg/1`, `att/2`), `fromPreflib` (to `ballot/2`, as `kemeny-control` writes ballots) and `fromJagg`.

**Done when:**

- Mining `qbf` with the `qbf-dnf` generator returns its ten best instances and prints the ratio of the best to the median of its grid cell.
- `gc-shape4` with a pool recorded under another seed gives 101 solutions, and the report states the change in check calls.
- A pool with a different domain hash is skipped with a message.
- A pool item that is not a term is rejected by `validate`, before the run.
- Each importer round-trips a three-line sample file in `test/instances.test.mjs`.

**Checkpoint I5.**
