# CegarPlay: three ambitious directions

Nov 21, 2026 · @Ronald

Implementation plans, file by file: Implementation

## Where CegarPlay stands

CegarPlay runs one project on one built-in instance, shows the run as a text trace and summary charts, and leaves soundness to the author. Each direction below removes one of those three limits.

I read the landing page, `llms.txt` and the full technical manual. That first version was written without the tutorial, the example files or the source code. The Implementation tab and this revision were checked against the repository at commit e287c65; what is still open is marked "to verify".

Facts from the manual that the plans build on:

- A project is one JSON file of fragments, a loop script and settings. The instance sits inside it, as facts in `shared` and values in the Constants table.
- Refinements are clauses (from `relevant/1`, unsat cores or `clause/3`) or rules grounded from `#program refine(k)`.
- A run emits typed event lines (`H S M T W L E D`). The page shows a stepwise text trace and aggregate charts.
- Soundness rests on `relevant/1`. The remedy today is to rerun with the Reference template and compare solution counts.
- The site is static, and `tools/run.mjs` runs the same engine headless.

| Direction | Limit it removes | What it adds | Signature demo |
| --- | --- | --- | --- |
| 1. Instance Lab | One instance, baked into the project | Instances as objects, generators written in ASP with seeded draws, campaigns over instances × loop variants | Press Fuzz on `tutorial-weak-relevant`: get the smallest instance that loses a solution, and the step that lost it |
| 2. Observatory | A text trace and summary charts | Replayable recordings, a live loop diagram, domain pictures declared in ASP, a map of the candidate space | Replay `gc-reference` beside `gc-shape1`: one removes single candidates, the other removes whole blocks |
| 3. Checked soundness | Soundness checked by comparing counts | An exhaustive audit, a certificate per refinement, refinements without `relevant/1`, certified counts | Delete the `relevant/1` rules, add `lift` to the link, and get the same count with a certificate |

&#91;embedded content: run pipeline · 4 existing stages, 3 additions\]

Direction 1 acts before a run, Direction 3 inside it and Direction 2 after it, so the three can be built largely in parallel.

Four rules hold across all three directions:

- **Declarative first.** Generators and views are ASP fragments in the `glue(T)` idiom, not page code.
- **One engine.** Every feature runs identically in the page and in the headless tools.
- **Still static.** Workers and IndexedDB only; no server, no framework and no other origin.
- **Old files keep working.** Version 1 projects load and run unchanged.

## Direction 1: Instance Lab

Make the instance a first-class object, generate instances from seeded ASP programs, and run grids of instances × loop variants. This unlocks scaling curves, automatic soundness fuzzing and hard-instance mining, none of which is possible while the instance lives in `shared`.

### 1.1 Instances as objects

An instance is a set of facts plus constant values. Every solver, every link's glue control and the validation receive it, exactly as they receive constants today. The loop language does not change.

Project format version 2 adds four optional keys:

```json
{
  "format": "cegarplay",
  "version": 2,
  "instances": [
    { "id": "triangle",
      "facts": "node(1). node(2). node(4). edge(1,2). edge(1,4). edge(2,4).",
      "constants": { "k": "3" },
      "expected": { "solutions": 7 },
      "tags": ["regression"] },
    { "id": "gnp-7-s1",
      "recipe": { "generator": "gnp", "params": { "n": 7, "p": 300 }, "seed": 1 } }
  ],
  "generators": [
    { "name": "gnp",
      "text": "node(1..n).\nedge(X,Y) :- node(X), node(Y), X < Y, @flip(p, X, Y) = 1.\n#show node/1.\n#show edge/2.\n",
      "params": { "n": "int", "p": "permille" } }
  ],
  "variants": [
    { "name": "reference", "swap": { "check": "check_block" } }
  ],
  "suites": [
    { "name": "scaling",
      "instances": { "generator": "gnp", "grid": { "n": [6, 8, 10], "p": [300] }, "seeds": 20 },
      "variants": ["default", "reference"],
      "limits": { "seconds": 30 } }
  ]
}
```

- `instances[].facts` holds facts inline. `recipe` regenerates them on demand, so a file stores recipes, not megabytes of facts.
- `variants` are named alternatives of one project: another loop script, other solver options, or swapped fragments. Campaigns need them, and so do Directions 2 and 3.
- An optional fragment named `schema` holds constraints every instance must satisfy, such as `:- edge(X,Y), not node(X).` It runs on import, after generation and during shrinking.

Page and tools:

- An **Instances** tab: list, facts editor, tags, expected count, and a "Run all" table that turns green where the count matches `expected`.
- An instance picker in the run bar, and `?example=<id>&instance=<id>` in the URL.
- `node tools/run.mjs <project> --instance <id|all>` for headless runs.
- `test/library.test.mjs` checks every instance that carries an expected count.

Importers turn standard files into facts. Each importer emits canonical predicates, and a small adapter fragment maps them to the project's own names.

| Format | Canonical facts (proposed) | What it feeds, checked against the examples |
| --- | --- | --- |
| DIMACS graph (`.col`) | `node/1`, `edge/2` | The guide's clique examples, whose `shared` fragment is exactly these facts. `clique-interdiction` and `clique-colouring` once their rule-defined graphs are replaced. Not `graph-coloring`: there the graphs are the candidates |
| QDIMACS | `qvar/2` with the block, `qlit/3`, `clause/1` | `qbf-three-blocks` through six adapter rules. `qbf` has a DNF matrix, with `xlit/3` and `ylit/3` per term, so a CNF file is read as its complement |
| ASPARTIX (`.apx`) | `arg/1`, `att/2` | `af-preferred` as it is: the file already consists of these facts. The example also needs a `query/1` fact |
| PrefLib orders (`.soc`) | `voter/1`, `rank/3` | `kemeny-control`. Its shared rules derive these two predicates from ballot tuples of four candidates, so an importer can supply them directly for any number of candidates |
| `.jagg`, the [jaggpy](https://github.com/rdehaan/jaggpy/) scenario format | `var/1`, `cl/2`, `pos/2`, `neg/2` | `agenda-safety`, which uses these predicates for clauses. The importer has to turn each agenda formula into clauses |
| Plain `.lp` facts, CSV with a column map | as given | any |

### 1.2 Generators: ASP with seeded draws

A generator is an ASP program whose shown atoms are the instance. Randomness enters through grounding-time functions; structure and conditioning are ordinary rules and constraints.

```asp
% gnp: a connected random graph with n nodes; each edge is present with probability p/1000
node(1..n).
edge(X,Y) :- node(X), node(Y), X < Y, @flip(p, X, Y) = 1.

reach(1).
reach(Y) :- reach(X), edge(X,Y).
reach(X) :- reach(Y), edge(X,Y).
:- node(X), not reach(X).            % a disconnected draw is rejected and redrawn

#show node/1.  #show edge/2.
```

Five design decisions:

1. **Stateless draws.** `@flip(P, Key…)` hashes the seed, the attempt number, the function name and the key, then compares with P. The grounder may evaluate a function in any order and more than once, and a stateless draw returns the same value each time. An instance is therefore a pure function of generator text, parameters, seed and attempt.
2. **One implementation, twice.** The hash is a 64-bit mixer in Lua 5.4 integers, with a line-by-line twin in Python for `cegarcheck.py`. A test asserts identical facts in the page, in Node and in Python.
3. **Three stages in one program.** Grounding draws the random facts. Choice rules let clingo complete what draws cannot guarantee, such as a planted solution. Constraints filter: an unsatisfiable draw is retried with the next attempt number, and the acceptance rate is stored with the instance.
4. **Honest distributions.** Drawn facts follow the stated distribution exactly, conditioned on acceptance. Solver-completed parts do not, because clingo returns some model, not a uniform one. The generator editor labels each recipe "exact" or "solver-completed".
5. **Semantic filters.** A suite may keep only instances with properties that need a run, such as `solutions in 1..50` or `candidates(reference) >= 1000`. The campaign runner evaluates them.

Draw functions take integers only, since ASP has no floats:

| Function | Value |
| --- | --- |
| `@flip(P, K…)` | 1 with probability P/1000, else 0 |
| `@int(Lo, Hi, K…)` | a uniform integer in Lo..Hi |
| `@weighted((W1,…,Wm), K…)` | index i with probability proportional to Wi |
| `@perm(N, I, K…)` | the image of I under a uniform permutation of 1..N named by K |
| `@subset(M, N, I, K…)` | 1 if I lies in a uniform M-subset of 1..N named by K |
| `@mallows(N, Phi, I, K…)` | the position of I in a Mallows ranking with dispersion Phi/1000 |

A starter library of generators ships as examples, each written in this language: G(n,p) and G(n,m) graphs, planted k-colourable graphs, random geometric graphs, fixed-clause-length random 2-QBF, random attack graphs, and preference profiles (impartial culture, Mallows).

**Tested.** `gen/draws.lua` in the prototype archive implements the six functions with the mixer of the earlier spike, and `gen/draws.py` is its Python twin.

- Engine and twin give identical facts for 30 of 30 seeds of a connected-graph generator with n = 9 and p = 250. Of 80 draws, 30 were accepted.
- All six functions agree between engine and twin, and reversing the rule order changes nothing.
- The library reproduces reference row 26 of the Implementation tab.
- Over 1,500,000 draws of `@flip(300, K)` the frequency was 0.30034.

### 1.3 Campaigns

A suite is a grid, and the runner executes every cell of it.

```json
{ "name": "scaling",
  "instances": { "generator": "gnp",
                 "grid": { "n": [6, 8, 10, 12, 14], "p": [200, 300, 400] },
                 "seeds": 20,
                 "where": ["solutions(reference) >= 1"] },
  "variants": ["shape1", "shape1-record", "shape3", "reference"],
  "solver_seeds": 3,
  "limits": { "seconds": 30 } }
```

- **Worker pool.** Each worker owns one clingo instance and runs one cell through today's run path, so limits and Abort behave as now. Pool size follows `navigator.hardwareConcurrency`.
- **Result store.** One row per instance, variant and solver seed holds the final `S` and `D` events. Rows live in IndexedDB under a hash of fragments, variant, instance and seed. A rerun skips finished cells, and an edit invalidates exactly the cells it touches.
- **Headless twin.** `node tools/bench.mjs <project> --suite scaling --shard 3/16 --out results.jsonl` runs the same suite on a cluster. The page imports result files and does the analysis.
- **Campaign tab.** A progress grid coloured by outcome, then four plots: scaling per variant (median with interquartile band, log axis), a heat map over two parameters, a per-instance scatter of one variant against another, and solved-within-time curves.
- **Free consistency check.** Two exhausted variants that disagree on a solution count are flagged in the grid. This extends the red mark of the run history from one instance to all of them.

### 1.4 What the lab makes possible

**Soundness fuzzing with shrinking.** One button, Fuzz, automates step 5 of the manual's agent workflow:

1. Generate small instances from the project's generator, smallest parameters first.
2. Run each with the project's loop and with the Reference template, all solutions.
3. On the first mismatch, shrink: delta-debug the facts and constants, keeping `schema` valid and the mismatch alive.
4. Diagnose: take a solution the loop lost and replay the recorded refinements in order. The first refinement it violates is the culprit.

The report names a minimal instance, the lost solution, and the candidate, counterexample and relevant set of the culprit step. The instance is saved with the tag `regression` and its true count.

**Hard-instance mining.** Search seeds and parameters for instances that maximise a cost: candidates per solution, refinements, or the ratio between two variants. Start with random search and successive halving, then mutate single facts under `schema`. The best finds join the library as benchmarks, stored as recipes.

**Scaling laws.** The campaign report fits a growth base per variant from the medians, with a bootstrap interval. Sweeping a density parameter also plots the share of instances with a solution next to the cost, which exposes phase transitions.

**Counterexample pools.** Expansion refinements (Shapes 3 and 4) usually say "the candidate must defeat this counterexample". Every solution satisfies that for any well-formed counterexample, wherever it came from. So counterexamples from another seed or run of the same instance can be replayed as a warm start: one `A.expand(refine, cex = X)` per pooled counterexample, before the first search.

The lab stores pools per check domain and measures the saving. Replay on an instance with another domain is unsafe: a colouring of six nodes is only a partial colouring of seven, and the rules then remove solutions. Direction 3's audit checks the precondition that the refine part is sound for any counterexample.

**The pipeline, run end to end.** `audit/fuzz_shrink.py` in the prototype archive does the four steps on `guide-04-one-node`, whose `relevant/1` is too strong.

1. The first generated graph (n = 4, p = 500, seed 1) already differs: 7 solutions with the loop, 13 with the reference run.
2. Delta debugging shrinks its 8 facts to 6, a single triangle on the nodes 1, 2 and 4. There the loop finds 4 solutions and the reference run 7.
3. The audit of that instance finds one unsound pair: the empty candidate, the triangle as counterexample, relevant {`del(4)`}, lost solution {2}.
4. The replay names step 1: the clause "`del(4)` must be true" removes the solution {2}.

The whole run needed 31 engine runs and under 15 seconds. The `triangle` instance in 1.1 is its result.

### 1.5 Milestones

| Milestone | Delivers | Done when |
| --- | --- | --- |
| I1 Instances | Format version 2 (`instances`, `variants`), Instances tab, picker, `--instance`, importers for `.lp`, `.col` and QDIMACS | Every library example runs unchanged, and three examples carry three or more instances with tested expected counts |
| I2 Generators | Draw functions in Lua with a Python twin, generator editor with a six-instance preview and acceptance rate, recipes | One recipe yields byte-identical facts in the page, in Node and in Python |
| I3 Campaigns | Worker pool, IndexedDB store, Campaign tab, `tools/bench.mjs` with shards, result import | A 1,000-cell suite resumes after a page reload without rerunning a finished cell |
| I4 Fuzz and shrink | Fuzz button, delta-debugging shrinker, lost-solution diagnosis | On `tutorial-weak-relevant`, Fuzz reports a minimal instance and the culprit step with no user input |
| I5 Mining and pools | Hardness search, counterexample pools, growth fits, remaining importers | Mining finds an instance at least 10 times costlier than the median of its grid cell, and pool replay passes the audit |

### 1.6 Risks

- **Memory.** N workers mean N WebAssembly heaps. Cap the pool and recycle a worker after each cell.
- **Distribution claims.** Solver-completed generators are not uniform. The label from 1.2 appears in every campaign report.
- **Grounder behaviour.** Draws must not depend on evaluation order. A test grounds each library generator twice with shuffled rule order and compares the facts.
- **Format bump.** Version 1 pages reject version 2 files, so projects without instances keep saving as version 1.

## Direction 2: Observatory

Turn each run into a recording that can be replayed, and draw it at three levels: the loop, the problem domain and the candidate space. Domain pictures are declared in ASP view fragments, so the page needs no drawing code per problem.

### 2.1 Recordings

Every picture is a pure function of a recorded event stream. That gives replay without the engine, comparison of two runs, and deterministic tests for every view.

| Event | When | New fields | Used by |
| --- | --- | --- | --- |
| `H`, extended | After grounding | An indexed table of interface atoms per link | Candidates as bit sets, clauses as integer lists |
| `C`, new | Each solve, models call, search and nested check | Id, parent, solver, loop line, start, duration, result | Timeline, line profile |
| `T`, extended | Each recorded step | Candidate id and bit set, clause id, relevant set | Every step-level view |
| `K`, new | Each certified refinement (Direction 3) | Step, certificate level, verdict | Soundness overlay |

- **Recording policy.** The single "Trace steps" number becomes a policy: first N, every k-th, last N, or a reservoir sample of N. Aggregate `S` events stay always on.
- **Overhead budget.** The default policy must cost under 10% of run time on `gc-shape1`, measured in the test suite.
- **Replay files.** A recording is the project hash plus the event lines, compressed with the browser's CompressionStream. `?replay=<file>` loads one, and each library example ships one, so pictures appear before the engine has loaded.

**Revised by the Implementation tab.** Recording every step as text is too heavy: a full trace of `gc-shape1` takes 1,016 bytes per step. A compact `R` event therefore replaces the "extended `T`" of the table above, and `T` stays as it is. A compact line that still carries the counterexample text took 658 bytes per step in my measurement, and 32 after gzip.

### 2.2 Loop anatomy

Three views explain the loop script itself.

- **Live diagram.** Solvers are boxes and links are arrows labelled with their interface size, drawn from the declarations. During a run the counters tick and tokens move: a candidate along the link, a clause back. With Pause and Step, one press moves one token.
- **Swimlane timeline.** One lane per solver and one bar per call, coloured by result, with nested checks drawn inside the search that triggered them. Marks show solutions, refinements, expansions and restarts. Zoom runs from the whole run down to one call.
- **Line profile.** The loop editor's gutter shows hit count and exclusive time per script line. Clicking a line filters the timeline to its calls.

The diagram pays off most on multi-solver scripts such as `lang-two-stage` and `lang-second-solver`.

### 2.3 Domain views, declared in ASP

A view is one more fragment. The page feeds it the current step as facts, and every atom `draw(T)` it derives becomes a mark on screen, in the same idiom as `glue(T)` and `relevant(T)`.

The page supplies these facts for a step, next to the instance and the `shared` fragment:

| Fact | Meaning |
| --- | --- |
| `step(I)`, `kind(K)` | Step number and kind: `reject`, `add`, `expand`, `solution` or `error` |
| `cand(T)` | T is a true interface atom of the candidate |
| `cex(T)` | T is a shown atom of the counterexample |
| `lit(T, true)`, `lit(T, false)` | T occurs in the refinement clause with that sign |
| `fact(Name, T)` | An expansion added the fact `Name(k, T)` |

The view answers with marks. The vocabulary borrows from Potassco's clingraph and adds marks that are not graphs.

| Mark | Draws |
| --- | --- |
| `node(Id)`, `edge(A, B)` | A graph |
| `cell(R, C)` | A grid or matrix |
| `item(Group, Id)`, `rank(Group, Id, Pos)` | Sets, sequences and rankings |
| `attr(Elem, Key, Value)` | The `fill`, `stroke`, `label` or `weight` of a mark |
| `emph(Elem)`, `ghost(Elem)` | A highlighted or faded mark |
| `note(Text)` | A caption for the step |
| `layout(L)`, `pos(Id, X, Y)` | `graph`, `layers`, `circle`, `grid`, `list`, or fixed coordinates |

```asp
% A view for a colouring project; assumes node/1, edge/2 and interface atoms color(N,C)
#program scene.                                    % grounded once per instance
draw(layout(graph)).
draw(node(N))   :- node(N).
draw(edge(N,M)) :- edge(N,M).

#program frame.                                    % grounded once per displayed step
draw(attr(node(N), fill, C))         :- cand(color(N,C)).
draw(emph(node(N)))                  :- lit(color(N,_), _).
draw(attr(edge(N,M), stroke, clash)) :- edge(N,M), cand(color(N,C)), cand(color(M,C)).
draw(note("Ringed nodes are the ones this refinement blames.")) :- kind(reject).
```

- **Scene and frame.** `scene` is grounded once per instance and fixes identity and layout. `frame` is grounded per displayed step and changes attributes only, so steps animate instead of jumping.
- **Own worker.** A second clingo instance computes frames on demand for the step under the cursor, with neighbours prefetched and cached. A frame slower than 100 ms is skipped while scrubbing.
- **Semantic colour.** A `fill` value is a class name, mapped to a palette that is safe for colour-blind readers in light and dark themes. Raw colours remain possible.
- **Layout.** All layouts are written by hand, as the charts of the page are today: grid, list, circle, layers, and a force layout with a fixed seed. Dragged positions are saved in the project.
- **Auto-views.** Without a view fragment, the page proposes one from predicate signatures. A binary fact predicate over one domain becomes a graph, an interface atom `p(X,V)` an attribute of X, and two integer arguments a grid. "Convert to fragment" writes the proposal as ASP text.
- **Coverage.** Every library example gets a view. The manual gains a "Writing views" chapter for agents, and a test renders step 1 of every view.

**Tested.** `view/view_test.py` in the prototype archive runs an eleven-line view for `guide-03-hit-clique` on a recorded step. For the candidate {1, 2} and the surviving triangle 4, 5, 6 it returns 38 marks: the scene, three `emph` marks, three clique edges, two fills for the deleted nodes, and the note. The view program is plain clingo with a three-line Lua `main` that grounds `base`, `scene` and `frame`.

### 2.4 The candidate space

These pictures are problem-independent: they show what refinement does to the set of candidates.

**Fate map.** One pixel per candidate, where a candidate is a model of the unrefined abstraction projected on the interface atoms. Colour gives its fate: solution, proposed and refuted, removed unseen by refinement k, or still alive. Scrubbing time shows the space being carved.

- A prepass enumerates the candidates, up to about one million by default. Beyond that the map switches to a labelled sample.
- Pixels follow a space-filling curve over the bit vector, with the most-blamed atoms as the high bits. A short clause over often-blamed atoms then removes one contiguous block.
- A second layout puts candidates in rows by their number of true atoms. It suits subset problems, where refinements remove whole up-sets or down-sets.
- Solutions from the reference run are overlaid. A refinement that removes a solution pixel is flagged at that step, so unsoundness is visible as it happens.

The map yields three numbers per refinement: candidates removed, the share already removed earlier, and the alive count after it. Together they replace mean clause length as the measure of refinement quality.

**Blame matrix.** Rows are steps and columns are interface atoms. A cell shows the candidate's value, and a dot marks an atom in the refinement. Columns are reordered by co-blame clustering, with blame frequency as a histogram on top.

**Hindsight redundancy.** A later clause that is a subset of an earlier one makes the earlier one redundant. Their share measures what a better choice of counterexample would have saved. The same pass counts candidates that violate a clause already added, the symptom the manual describes for Shape 1 without `--enum-mode=record`.

**Trajectory.** The Hamming distance between successive candidates, drawn as a sparkline. It makes the difference between continuing one search (Shape 1) and re-solving (Shape 2) measurable.

**Computed for three shipped runs.** `audit/fate.py` in the prototype archive derives these numbers from the audit's candidate vectors and the recorded clauses.

| Run | Candidates | Refinements | Removals that hit a candidate already removed | First unsound step |
| --- | --- | --- | --- | --- |
| `tutorial-first-run` | 256 | 46 | 2,013 of 2,208 | None |
| `tutorial-weak-relevant` | 256 | 17 | 523 of 779 | Step 6: removes 128 candidates, 13 of them solutions |
| `gc-shape1` | 3,373 | 1,320 | 4,636 of 7,908 | None |

One rule had to be added: a full-length clause on a candidate that was just reported is an acceptance, not a loss.

### 2.5 One clock, two runs, and export

- **Linked cursor.** Every view follows one step cursor. Brushing a time range restricts all aggregates to it, and "follow" mode tracks a live run.
- **Compare.** Two recordings share axes: alive-count curves overlaid, a fate-map difference, and domain views side by side, aligned by candidate number.
- **Export.** Any view exports as SVG or PNG. A storyboard lays selected steps out as one strip for papers and slides, and a permalink carries replay, step and view.
- **Lecture mode.** One view fills the screen with the `note` captions of the view fragment, so the narration is written in ASP next to the picture.
- **Accessibility.** Each view has a table fallback and keyboard control, and animation respects the reduced-motion setting.

### 2.6 Milestones

| Milestone | Delivers | Done when |
| --- | --- | --- |
| V1 Recording | Events `C` and `K`, extended `H` and `T`, policies, replay files, `?replay=` | A replay of every `fast` library example reproduces its Statistics tab without the engine |
| V2 Loop anatomy | Live diagram, swimlane timeline, line profile | 100,000 call spans scroll smoothly, and every `lang-*` example draws correctly |
| V3 Domain views | `draw/1` vocabulary, view worker, renderers, views for 10 examples | Scrubbing 200 steps of `gc-shape1` animates without layout jumps |
| V4 Candidate space | Prepass, fate map, blame matrix, alive curve, redundancy | The fate map of `tutorial-weak-relevant` flags the step that removes a solution |
| V5 Linking and reach | Linked cursor, compare, export, lecture mode, auto-views, views for all examples | Every library example opens with a picture |

### 2.7 Risks

- **Volume.** Shape 1 checks every total assignment, so a full recording can be large. Policies and bit-set encoding bound it.
- **Vocabulary creep.** The mark list stays closed and versioned; anything new must be an `attr` first.
- **No build step.** The repository also rules out frameworks, so layouts and charts are written by hand. That bounds what the graph layout can do.
- **Prepass cost.** Enumerating candidates can be infeasible. The map then shows a sample and says it is not uniform.

## Direction 3: Checked soundness

Replace "compare counts with the reference run" by machine-checked guarantees: an exhaustive audit per instance, a certificate per refinement, refinements that need no `relevant/1`, and a certified solution count. The manual says soundness depends on `relevant/1`; this direction makes it depend on a checker instead.

### 3.1 The obligation and a ladder of certificates

After candidate M and counterexample X with relevant set R, the clause says: every candidate that agrees with M on R is wrong. It is sound when each such candidate has some counterexample of its own.

Comparing counts tests this only for the pairs (M, X) that one run happened to visit. Another seed visits other counterexamples, which "Rerun with 5 seeds" can only sample. The levels below turn that sampling into proof.

| Level | What it certifies | How | Cost | Applies to |
| --- | --- | --- | --- | --- |
| 0 Block | Only M is removed | By construction, `G.block(M)` | None | Any check |
| 1 Core | The assumptions in the unsat core suffice | `G.core(C)`, available today | None | Checks that look for a witness |
| 2 Lifting | X's guesses still give a counterexample, whatever the atoms outside R are | Three-valued evaluation of the check's ground program | One fixpoint per check, one check per dropped atom | Clause refinements |
| 3 Product | No candidate removed by the refinement escapes X's guesses | One unsat call on a ground product of abstraction and check | One solver call | Clauses and rules |
| 4 Exact | No solution is removed | A budgeted inner CEGAR search among the removed candidates | A second-level search | Anything, small instances |
| 5 Audit | Every candidate and counterexample of the instance | Enumeration against the reference solution set | Exhaustive | Small instances |

Each refinement gets the cheapest level that succeeds. The Statistics tab reports how many refinements landed at each level and how many stayed uncertified.

### 3.2 Audit

Audit is a new action beside Run, and the first thing to build because it needs no theory.

1. Run the Reference template for all solutions and require an exhausted run. Call the result S.
2. Enumerate the candidates M of the unrefined abstraction.
3. For each M, enumerate counterexamples projected on `relevant/1`, so each distinct relevant set R appears once.
4. Fail when some solution in S agrees with M on R.

The verdict is "sound for every candidate and counterexample of this instance", or a witness: M, X, R and the solution s that would be lost.

- **Diagnosis.** The audit reports the atoms on which the candidate and the lost solution differ, and picks the witness with the fewest. For `tutorial-weak-relevant` that is one atom: candidate {2, 4}, counterexample `sum(2,2)`, relevant {`pick(4)`}, lost solution {4}. So `pick(2)` should have been relevant.
- **Rule refinements.** For Shapes 3 and 4, step 3 grounds `refine(k)` for each counterexample on a scratch copy of the abstraction. Step 4 then checks that every solution in S is still a model.
- **For agents.** `node tools/audit.mjs <project> --instance <id> --json` prints verdict and witness. The manual's agent workflow gains it as the step after the reference comparison.
- **With Direction 1.** Auditing a batch of small generated instances is bounded verification of the encoding, not of one instance.

**Run on the library.** `audit/audit.py` in the prototype archive audited 31 clause-based `fast` examples. All are sound for every pair except `tutorial-weak-relevant`, where all 499 pairs are unsound. `guide-04-one-node`, audited separately, has 64 unsound pairs of 290. The earlier sweep in the Implementation tab covers 48 examples with the same verdicts.

### 3.3 Lifting and `lift` links

Lifting certifies a clause from the check's ground program alone. Fix the counterexample's guesses, keep the interface atoms in R at the candidate's values, and mark the other interface atoms unknown. Then compute the three-valued (well-founded) model of the check's ground program under these inputs.

The refinement is certified when two conditions hold:

1. Every integrity constraint has a definitely false body.
2. The rules that define the atoms left unknown are stratified.

Then every completion of the unknown atoms yields a total model that violates no constraint, hence an answer set of the check. So every candidate that agrees with M on R has a counterexample. The argument rests on the well-founded model growing monotonically with its inputs; the Soundness sub-tab of the Implementation tab writes it out in four steps.

This is the ASP counterpart of lifting by ternary simulation in SAT-based model checking. The test is sufficient, not necessary: a failure only sends the refinement up the ladder.

**Automatic relevance.** Start with all interface atoms in R, drop one at a time, and keep each drop that preserves the certificate. The result needs no `relevant/1` rules and is certified by construction.

```loop
link G = A -> C via shared + glue lift      # G.clause(M, X) now uses the lifted set

search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
```

`lift` is a link keyword beside `legacy` and `compat`. `G.lift(M, X)` is also an expression, so one script can mix hand-written and lifted clauses.

- **Capture.** A ground-program observer on the check's control records rules and weight rules into indexed Lua tables. This is verified in the vendored build: every rule arrives during grounding.
- **Reach.** Aggregates are evaluated by bounds. Disjunctive heads and non-stratified remainders are reported as "not certified at level 2", never as certified. None of 27 library checks is disjunctive.
- **Cost.** One check is a fixpoint over the ground program, and lifting needs one check per dropped atom. A naive prototype took 0.12 s per refinement at 1,159 ground rules, so the implementation needs a counter per rule.
- **Coach.** The Statistics tab compares the hand-written relevant set with the lifted one, per refinement and per predicate. It lists refinements whose hand-written set is not certified, and atoms the hand-written rules mark without need.

**Run on the library.** `lift/lift.lua` in the prototype archive implements capture, the certificate and deletion-based lifting as raw Lua on the runtime.

- On 27 examples, a loop that refines only with lifted sets finds exactly the audited solutions.
- The certificate accepts every hand-written refinement in 21 of the 25 sound examples, and none in the two unsound ones.
- It fails on `belief-update`, `integer-expressions`, `subset-sum-game` and `strong-nash`. Their sets are sound for a reason that the fixed guesses of one counterexample do not show, so they need level 3 or 4.
- Lifted sets were never larger than certified hand-written ones: 2.50 literals against 2.88 on `qbf`, 4.29 against 4.88 on `hedonic-core`.
- With lifting, `tutorial-weak-relevant` gives its 61 solutions and `guide-04-one-node` its 3, with the faulty rules left in place.

### 3.4 Product check

Level 3 asks the solver one question: is there a candidate that the refinement removes, yet against which X's guesses give no counterexample? Unsatisfiable means certified.

- **Construction.** The program joins the abstraction, the negated refinement, and a copy of the check with guesses fixed and each constraint rewritten to derive `violated`. It is built at the ground level through the backend.
- **No text rewriting.** Working on integer atoms makes renaming trivial, so the user's ASP text is never parsed or transformed.
- **Rules too.** The observer records the ground constraints each `expand` adds, and the product negates their conjunction. This covers Shapes 3 and 4.
- **Precision.** The check uses the abstraction's own constraints, so it certifies clauses that lifting cannot.

It needs the same stratification condition as lifting, so that "no counterexample" can be stated positively.

### 3.5 Certified counts

A run can write a proof log, and an independent checker validates it.

- **Log.** JSON lines hold the hashes of project and instance. Each refinement adds its candidate, the full counterexample, the clause or expansion, and the certificate level. Each solution adds its atoms.
- **Checker.** `tools/certcheck.py` runs on Python clingo, deliberately not on the Lua runtime. It extends `cegarcheck.py`, which already reproduces the link semantics.
- **Four checks.** Each X is an answer set of the check under M. Each certificate verifies at its level. Each solution has no counterexample. The abstraction plus all refinements plus blocks of all solutions is unsatisfiable.
- **Result.** "Certified: exactly N solutions", trusting clingo's answers to single solver calls and a checker of a few hundred lines. The run history shows the badge next to the count.

### 3.6 Milestones

| Milestone | Delivers | Done when |
| --- | --- | --- |
| S1 Audit | Audit action, `tools/audit.mjs`, witness diagnosis, JSON output | The audit of `tutorial-weak-relevant` names a missing atom, and all `fast` single-link examples are audited |
| S2 Capture and lifting | Ground-program capture, three-valued evaluator, level 2, `K` events, a written proof of the criterion | Every refinement of `gc-shape1` is certified at level 2 or reported with a reason |
| S3 `lift` links | `lift` keyword, `G.lift`, comparison report | Clause-based library examples reach their expected counts with their `relevant/1` rules deleted |
| S4 Product check | Ground product through the backend, level 3 for clauses and rules | The expansions of `gc-shape3` are certified |
| S5 Certified counts | Proof log, `tools/certcheck.py`, badge, level 4 as fallback | The checker accepts the logs of all `fast` examples and rejects a mutated log |

The Implementation tab moves level 3 into S2, because level 2 alone certifies too little, and leaves rule refinements and the exact level to S4.

### 3.7 Risks

- **Theory.** The lifting criterion needs a written proof before it is trusted. Level 5 ships first because it needs none.
- **Reach.** Disjunctive checks are outside levels 2 and 3. Their refinements stay at levels 0, 4 or 5.
- **Memory.** A captured ground program lives in Lua tables. Capture only the check by default and cap its size with a clear message.
- **Observer timing.** clingo may deliver observer callbacks at the start of solving, after preprocessing, as a [maintainer notes](https://github.com/potassco/clingo/issues/19). In the vendored build every rule arrived during grounding, and only the end-of-step call came at the first solve.

## How the three fit together

The directions share groundwork and feed each other, so the order below builds the shared parts first. If only one thing gets built, build the audit (S1): it is small, and both other directions consume it.

Shared groundwork:

- **Format version 2** with `instances` and `variants`, used by all three.
- **Recording events** with candidate ids, clause ids and relevant sets. The proof log of Direction 3 is a recording plus certificates.
- **A worker pool** for campaigns, view frames and audits.
- **Ground-program capture** for lifting, the product check and the audit's diagnosis.

What feeds what:

- The audit gives the fuzzer its verdict and the fate map its ground truth.
- Generators give the audit small instances and the views their scenes.
- Variants power both campaigns and the compare mode.
- Certificates show up in the trace and the timeline as `K` events.

&#91;embedded content: roadmap · 3 phases, 3 lanes, 2 gates\]

The audit is highlighted because the fuzzer and the fate map both wait for it. Within a phase the three lanes are independent.

### Open questions

1. Answered: the vendored build exposes ground-program observers and the backend to Lua, and both lifting prototypes use them. It has no AST module and no projection call.
2. Should the loop language ever see instances, for example in a loop over instances? The plan says no.
3. Is a format version 2 acceptable, given that version 1 pages reject it?
4. Which library examples have disjunctive or non-stratified checks? That sets the reach of certificate levels 2 and 3.
5. Which use weighs more: teaching, which favours Direction 2, or research, which favours Directions 1 and 3? The roadmap assumes equal weight.

### Sources

- CegarPlay [landing page](https://rdehaan.github.io/cegarplay/), [llms.txt](https://rdehaan.github.io/cegarplay/llms.txt) and [technical manual](https://rdehaan.github.io/cegarplay/manual.md), read on 21 November 2026. All statements about current behaviour come from these.
- [jaggpy](https://github.com/rdehaan/jaggpy/) README, for the `.jagg` scenario format.
- [clingo issue 19](https://github.com/potassco/clingo/issues/19), a 2016 thread on when ground-program observers are called.
- The repository at commit e287c65, read for the Implementation tab and for this revision: runtime, compiler, specifications and every example. Statements about clingraph, PrefLib, ICCMA and DIMACS formats are from memory.
