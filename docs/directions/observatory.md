# Implementing the Observatory

Five phases, V1 to V5. V1 is the base of all others and of I4. V4 needs the candidate enumeration it shares with the audit (S1).

## Phase V1: Recording

The runtime gains compact events, the page gains a recording model that can be saved and replayed, and the default output stays the same byte for byte.

**Read first:** `lua/runtime.lua` (`trace`, `literal_texts`, `timer_start`, `timer_stop`, `emit_solution`, `tick`), `js/control.js` (`onEvent`), `js/trace.js`, `js/share.js` (`pipe` and `CompressionStream`), `docs/spec-runtime.md` section 5.

**Measured (spike 7):** recording every step with today's `T` events costs 134% more run time and 1.3 kB per step on `graph-coloring` at n = 6. A `T` line carries the candidate, the counterexample and the literals as text.

**Not verified:** that `debug.getinfo` returns the loop line from inside a propagator callback. `debug.traceback` does, per the runtime spec, so the fallback is to parse its first loop line.

**Tasks:**

1. `js/project.js` and `js/driver.js`: the setting `settings.record = { steps, n, calls }`, where `steps` is `off`, `first`, `every`, `last`, `sample` or `all`. `assemble` writes it into `SETTINGS.record` only when it is set. `settings.trace` keeps its meaning.
2. `lua/runtime.lua`, event `I`, sent after `H` when recording: for each link, `{ link, atoms }` with the texts of `L.str` in link order.
3. `lua/runtime.lua`, event `R`, sent from the places that call `trace` today (`Model:reject`, `queue_clause`, `Solver:expand`, the error step) and from `emit_solution`:

   ```json
   {"i":1731,"k":"r","s":1,"l":1,"c":"3fa9c0de12ab45","q":[-3,5,-9,12],"n":1045,"t":1.234}
   ```
   - `k` is `r` (reject), `a` (add), `e` (expand), `s` (solution) or `x` (error).
   - `c` is the candidate as hex over the link's interface atoms, read from `M[L]`.
   - `q` is the clause as signed interface indices, read from `c.j` and the literal signs.
   - For `e`, `f` holds the expansion facts as texts, with no cap.
   - `n` is the program line of the loop statement; the page maps it with `mapLine`.
4. `lua/runtime.lua`, event `C`, sent from `timer_stop` when `record.calls` is set: `{ s, t0, dt, r, p, n }` with the solver index, start, duration, result (`sat`, `unsat`, `int`), the index of the enclosing call and the loop line.
5. `lua/runtime.lua`: the policies. `first` and `every` need a counter. `last` keeps a ring of encoded lines and prints it before the final `S`. `sample` keeps a reservoir of N lines the same way.
6. `js/recording.js` (no DOM): class `Recording` with `add(kind, data)`, `steps`, `calls`, `solutions`, `stats`, and:
   - `candidateAtoms(step)` and `clauseLiterals(step)`, decoded through the `I` table.
   - `toBlob()` and `Recording.fromBlob(blob)`: line 1 is `{ format: "cegarplay-recording", version: 1, project, engine }`, then the raw event lines, compressed with `CompressionStream("gzip")`.
7. `js/control.js`: every event of a run is also added to `app.recording`. `control.replay(recording)` feeds a recording through the same `onEvent`, with no engine, and ends in the state `replayed`.
8. Page: "Recording" select and count in the Loop tab's limits block; "Download recording" and "Open recording" in the Control tab; `?replay=examples/replays/<id>.cprec`, accepted only when it matches that pattern.
9. `tools/run.mjs --record <file>` writes the same file with Node's `zlib`. `tools/make-replays.mjs` writes one replay per example tagged `fast`.
10. `docs/spec-recording.md`; the manual's event table gains the new kinds.

**Done when:**

- With `settings.record` unset, `assemble` returns the same text as before the phase.
- Reference row 27 holds: 21,078 `R` events, run time within 10% of the unrecorded run, and a recording file under 3 MB.
- A replay of every `fast` example gives the same final `S` event as a live run, times aside.
- `toBlob` followed by `fromBlob` returns equal steps, calls and solutions.
- `candidateAtoms` of step 1 equals the candidate text of the first `T` event of the same run.

**Checkpoint V1.**

## Phase V2: Loop anatomy

A new Observatory tab shows the loop as a diagram with live counters, the run as a timeline of solver calls, and the cost of each script line.

**Read first:** `js/compiler.js` (the `solvers`, `links` and `parts` of its result), `js/stats.js` (`svg` helper, `chartProgress`), `js/loop-tab.js`, `css/theme.css`.

**What exists already:** the compiler returns every solver with its fragments and options, and every link with its ends. The `S` event carries calls, sat, unsat and time per solver. The diagram needs no new data.

**Tasks:**

1. `index.html`: tab 11 "Observatory" after Statistics, with three regions: anatomy, domain view (V3) and candidate space (V4).
2. `js/anatomy.js`, the diagram, as hand-built SVG:
   - Place solvers in columns by longest path over the links, so the abstraction is left and the check right.
   - One box per solver with its name and fragments; one arrow per link, labelled with its name and its interface size from the `H` event.
   - A solver that the script expands gets a `+k` badge, fed by `S.solvers[name].k`.
   - Live counters per box: calls, sat, unsat, time.
   - On each `R` event, pulse the link it belongs to. Above 30 events per second, show a rate instead of pulses.
3. `js/anatomy.js`, the timeline, on a canvas:
   - One lane per solver, in declaration order; a call is a bar from `t0` to `t0 + dt`, coloured by result.
   - A search is a thin band; the checks nested in it sit inside, placed by their parent index.
   - Marks above the lanes for solutions, refinements, expansions and restarts, from the `R` events.
   - Wheel zooms, drag pans. Below one pixel per call, a column shows the share of sat and unsat calls in its time bin.
4. `js/anatomy.js`, the line table: one row per loop line with calls, sat, unsat and exclusive time, sorted by time. A click selects the line in the loop editor and filters the timeline. The loop editor shows the same figures as hover annotations.
5. `css/theme.css`: colour tokens for sat, unsat and interrupted, in the light block and both dark blocks, as `test/theme.test.mjs` requires.

**Done when:**

- For the nine `lang-*` examples and the five shapes, the diagram has one box per declared solver and one arrow per link (browser test).
- The line table's call counts sum to the calls of the final `S` event.
- A redraw of 100,000 synthetic calls takes under 50 ms in the browser test.
- Pausing a run on an isolated page freezes the counters, and Step moves them by one candidate.

**Checkpoint V2.**

## Phase V3: Domain views

A view is an ASP fragment that turns one recorded step into marks. The page grounds it on a dedicated engine and draws the marks as SVG, with a layout that is computed once per instance.

**Read first:** `js/engine.js`, `js/stats.js` (the `svg` helper), `js/recording.js` (V1), `js/project.js`, `css/theme.css`, and `view/view_test.py` in the prototype archive of this revision.

**Verified (a view test of this revision):**

- A view program runs on the vendored engine as plain clingo: the instance, `shared`, the step facts and the view, with a three-line Lua `main` that grounds `base`, `scene` and `frame`. With `--outf=2` the marks come back as the shown atoms `draw/1`.
- For step 3 of `guide-03-hit-clique` (candidate {1, 2}, counterexample the triangle 4, 5, 6) an eleven-line view returns 38 marks. Among them are 3 `emph` marks for the blamed nodes, 3 clique edges, 2 fills for the deleted nodes and 1 note.
- The step facts were built from a `T` event alone: `step/1`, `kind/1`, `cand/1`, `cex/1` and `lit/2`.

**Not verified:** the latency of a frame on a warm engine in the page, and a hand-written force layout above 200 nodes.

**Tasks:**

1. `js/views.js`: `frameFacts(step, interface)` builds the step facts. A step with a `T` event gets `cex/1`; a step with only an `R` event gets candidate, clause and kind.
2. `js/views.js`: `viewProgram(project, view, facts)` joins the instance, the fragments the view names, the facts and the Lua `main`. `sceneProgram` is the same without `frame` and without step facts.
3. `js/views.js`: `parseMarks(atoms)` accepts `node/1`, `edge/2`, `cell/2`, `item/2`, `rank/3`, `attr/3`, `emph/1`, `ghost/1`, `note/1`, `layout/1` and `pos/3`. Anything else becomes a message that names the mark and the view.
4. `js/views.js`: `attr` keys are `fill`, `stroke`, `label` and `weight`. A `fill` or `stroke` value is a class name, mapped in order of first use to eight palette slots of `css/theme.css`; `weight` is a number.
5. `js/views.js`: the layouts `grid`, `list`, `circle`, `layers` and `graph`, all written by hand. `graph` is a force layout with a fixed seed, so the same scene always gets the same positions.
6. `js/views.js`: the renderer keys every element by the text of its term. A frame only changes attributes of scene elements, with a CSS transition that the reduced-motion setting turns off.
7. `js/views.js`: one dedicated `Engine` computes frames. Requests for steps the cursor has left are dropped, and the last 200 frames are cached by view hash and step.
8. `js/project.js`: the optional key `views`, a list of `{ name, fragments, positions }`. Dragging a node writes `positions`.
9. `js/views.js`: `suggestView(project, interface)` writes a view as ASP text from predicate signatures: a binary fact predicate over one domain is a graph, an interface atom `p(X,V)` an attribute of X, two integer arguments a grid.
10. `examples/`: views for ten examples, starting with the guide's clique examples. `test/views.test.mjs` renders step 1 of each and expects no unknown mark.
11. `docs/spec-views.md` and a manual chapter "Writing views".

**Done when:**

- The fixture of the view test passes: 38 marks for step 3 of `guide-03-hit-clique`, with the three `emph` marks on nodes 4, 5 and 6.
- Two frames of one scene give every scene element the same position.
- A request for a cached step makes no engine call.
- Ten library examples ship a view, and `suggestView` output parses for every clause-based `fast` example.

**Checkpoint V3.**

## Phase V4: Candidate space

The fate of every candidate is computed from two inputs: the candidate vectors of the `enumerate` mode and the clauses of a recording. Maps, the blame matrix and the alive curve are drawn from that one result.

**Read first:** `lua/audit.lua` (S1, for the solution flags), `js/recording.js` (V1), `js/stats.js` (canvas use, if any), and `audit/fate.py` in the prototype archive of this revision.

**Verified (fate numbers computed for this revision from audit vectors and recorded clauses):**

- `tutorial-weak-relevant`: 256 candidates, 61 true solutions, 17 refinements, 11 reported solutions. Steps 1 to 5 block accepted solutions. Step 6 is the first unsound one and removes 128 candidates, 13 of them solutions.
- `tutorial-first-run`: 46 refinements leave exactly the 61 solutions alive. Of 2,208 removals, 2,013 hit a candidate that was already removed.
- `gc-shape1`: 3,373 candidates and 1,320 refinements. Of 7,908 removals, 4,636 hit a candidate that was already removed.
- A full-length clause on a candidate that was just reported is an acceptance, not a loss. Without this rule the first block of a solution is flagged as unsound.
- Size of a full recording of `gc-shape1`: 1,016 bytes per step as `T` events, 658 in compact form, 32 after gzip.

**Not verified:** rendering one million cells on a canvas at interactive speed, and the usefulness of the sample mode.

**Tasks:**

1. `lua/space.lua`: `rt.enumerate{ link, limit }` lists the models of the unrefined abstraction, one per interface assignment, as `P` events of 1,024 hex vectors each. Above the limit (default 1,048,576) it ends with outcome `limit`.
2. `js/space.js`: `fates(candidates, steps, truth)`. A clause removes the candidates that falsify all its literals; with vectors in typed arrays this is one mask and one compare per word. `truth` is the solution set of an audit, when there is one.
3. `js/space.js`: per step it returns removed, newly removed, already removed, and solutions lost. It applies the acceptance rule above.
4. `js/space.js`: the series for the charts: alive count, removals per refinement, the share that was already removed, and the first unsound step.
5. `js/space.js`: two orders for the map. One sorts atoms by blame count and interleaves their bits into x and y; the other puts candidates in rows by their number of true atoms.
6. `js/space-view.js`: the map on a canvas, one cell per candidate, coloured by fate at the cursor's step. Hovering shows the atoms; clicking a removed cell moves the cursor to the step that removed it.
7. `js/space-view.js`: the blame matrix on a canvas, columns ordered by a greedy seriation on the overlap of blame sets.
8. `js/space.js`: hindsight redundancy (a later clause that is a subset of an earlier one) and the count of candidates that falsify a clause already added.
9. `js/space.js`: the sample mode above the limit draws models with randomised signs and labels every figure "sample, not uniform".
10. `test/space.test.mjs`: the numbers above, computed from stored recordings and not from live runs, because step counts depend on the search order.

**Done when:**

- From the stored recording of `tutorial-weak-relevant`, `fates` returns step 6 as the first unsound step with 128 removed and 13 solutions lost.
- For `tutorial-first-run` the alive count ends at 61 and no step loses a solution.
- For `gc-shape1` the alive count ends at 101.
- The map of 3,373 candidates redraws within one animation frame when the cursor moves.

**Checkpoint V4.**

## Phase V5: Linked cursor, comparison, export, lecture mode

One cursor object drives every view of the Observatory tab. The same object, given two recordings, drives the comparison.

**Read first:** `js/trace.js` (the slider of today's trace), `js/anatomy.js`, `js/views.js`, `js/space.js`, `js/share.js` (links that carry state), `js/init.js` (URL parameters).

**Verified:** nothing in this phase has been run. It only combines parts that earlier phases test.

**Not verified:** export of a canvas view at print resolution, and the alignment of two recordings whose steps differ in number.

**Tasks:**

1. `js/cursor.js`: the model `{ step, range, follow }` with `subscribe`. The trace slider, the timeline, the domain view, the map and the blame matrix all read it and none keeps a step of its own.
2. `js/cursor.js`: the left and right arrow keys move one step, with Shift ten. `follow` keeps the cursor on the last step of a live run.
3. `js/cursor.js`: a brushed range restricts the series of V4 and the line table of V2 to its steps.
4. `js/recording.js`: `align(a, b, by)` pairs the steps of two recordings by step number or by elapsed time.
5. `js/space-view.js`: the comparison draws both alive curves on one axis and a map in which each cell shows which run removed the candidate first.
6. `js/views.js`: two domain views side by side on one cursor, for two recordings of the same instance.
7. `js/export.js`: every SVG view serialises to a file; canvas views go through `toBlob`. A storyboard lays the frames of chosen steps out as one SVG strip.
8. `js/init.js`: `?replay=<file>&step=N&view=<name>` restores recording, cursor and view. `?lecture=1` shows one view full screen with the `note` marks as captions.
9. `js/views.js`, `js/space-view.js`: each view offers its data as a table, and all controls work from the keyboard.
10. `test/cursor.test.mjs`: the model, the alignment, and a stored SVG of the V3 fixture frame.

**Done when:**

- Moving the cursor updates every open view, and no view stores a step itself.
- A link with `replay`, `step` and `view` opens on that step and view.
- The exported SVG of the V3 fixture frame equals the stored file.
- Every library example that has a replay file and a view opens with a picture before the engine has loaded.

**Checkpoint V5.**
