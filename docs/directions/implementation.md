# Implementation plan

These plans follow the repository's own format: phases with "Read first", tasks, "Done when" checks and a checkpoint. I cloned the repository at commit `e287c65`, read the runtime and the page code, and ran eight spikes on the vendored clingo-wasm 0.6.0. Each design point below is marked verified or not verified.

The three sub-tabs hold one phase per milestone. This tab holds what they share.

## What the spikes verified

| Spike | Question | Result |
| --- | --- | --- |
| 1 API probe | Which Lua calls exist in the WebAssembly build? | `register_observer` and `backend` exist. The backend has `add_atom`, `add_rule`, `add_weight_rule`, `add_external` and `add_minimize`, but no projection call. There is no `clingo.ast`. |
| 2 Observer | What does a ground-program observer receive, and when? | Every rule and weight rule arrives during `ground`, with atom ids equal to `symbolic_atoms` literals. Only `end_step` arrives at the first solve. |
| 3 Draws | Do seeded stateless draws work as grounding-time functions? | Yes, through `ctl:ground(parts, context)`. A second run and a run with shuffled rules give the same facts. The function receives the context as first argument, and an error inside it traps. |
| 4 Level 2 | Does three-valued lifting certify real refinements? | `tutorial-first-run`: 14 of 14. `tutorial-weak-relevant`: 0 of 6. `graph-coloring` at n = 5: 0 of 1,190. Lifting in place of the weak `relevant/1` gives 61 solutions instead of 11. |
| 5 Level 3 | Does a ground product with the abstraction certify them? | `graph-coloring` at n = 5: 1,190 of 1,190. `graph-coloring-original` at n = 5: 29 of 157. A product query takes about 0.1 ms. |
| 6 Audit | Does the exhaustive audit find known unsoundness? | `graph-coloring-original` at n = 6: 44,125 of 91,810 pairs unsound and 1,440 solutions at risk, with a witness, in 54 s. At n = 3, 4 and 5 the same rules are sound. |
| 7 Overhead | What does recording every step cost today? | `graph-coloring` at n = 6, Shape 1: 5.0 s becomes 11.7 s, and the `T` lines take 27.5 MB for 21,078 steps. |
| 8 Library sweep | What does the audit say about the shipped examples? | Of 95 examples, 48 fit the spike (one link, `G.clause`). 46 are sound. The 2 unsound ones are the two that teach unsoundness: `tutorial-weak-relevant` and `guide-04-one-node`. |

Four findings changed the plan of the first tab:

1. **Level 2 is not enough.** Hand-written relevant sets often rely on the abstraction's constraints, such as edge symmetry or one colour per leaf. Level 3 therefore moves into the same phase as capture (S2).
2. **Unsat cores do not shrink.** The core that `h:core()` returns for a product query was the full interface. Minimisation is by deletion, one product query per atom.
3. **Fewer literals is not more pruning.** Minimising from the full interface gave 7.2 literals per clause but 1,931 refinements, against 13.0 literals and 1,190 refinements for the hand-written rules. Minimising inside the hand-written set gave 6.9 literals and 838 refinements.
4. **Text events are too heavy to record every step.** The compact `R` event of phase V1 replaces the "extended `T`" of the first tab; `T` stays as it is.

A later revision added six prototypes, in the archive `cegarplay-prototypes.zip`. They were written independently of the spikes, and the sub-tabs record their results:

- A second audit, and the fate numbers of three shipped runs (S1, V4).
- Level 2 as a well-founded model, run on 27 library examples (S2, S3).
- The draw functions with a Python twin, on the spike's mixer (I2).
- Generate, compare, shrink and diagnose, end to end (I4).
- A view fragment on a recorded step (V3).
- The recursive loop for any quantifier depth, which belongs to the second document.

## Codebase today

| File | Role | Phases that touch it |
| --- | --- | --- |
| `lua/runtime.lua` (1,059 lines) | Solvers, links, models, refinements, limits, events | I1, V1, S1 to S5 |
| `js/driver.js` | `validate`, `assemble`, `parseEvent`; no DOM | I1, I2, V1, S1 |
| `js/project.js` | Model, `load` and `save`, templates, `VERSION = 1`; no DOM | I1 |
| `js/compiler.js` | Loop language to Lua; `LINK_MEMBERS`, link keywords | S3 |
| `js/engine.js`, `js/worker.js` | One worker, one blocking `run` per message | I3, V3 |
| `js/control.js` | Run flow and event dispatch | I1, V1, S1 |
| `js/trace.js`, `js/output.js`, `js/stats.js` | Trace view, messages, hand-built SVG charts, run history | V1 to V5, I3, S1 |
| `tools/run.mjs` | Headless runner and `runProject` | I1, I3, V1 |
| `tools/cegarcheck.py` | Python clingo checker for one link | I2, S5 |
| `test/helpers.mjs` | `run`, `runLua`, `runProject`, event accessors | all |

Rules from `CLAUDE.md` that shape every phase:

- An error raised by clingo inside a Lua call traps the engine. Every new callback (observer, draw function, `on_model`) wraps its body in `pcall`.
- `js/compiler.js`, `js/driver.js` and `js/project.js` stay free of DOM and Node APIs. Every new logic module follows the same rule.
- No build step, no framework, no other origin. Charts and layouts are written by hand, as `js/stats.js` does today.
- Reference numbers do not move. A run with none of the new settings must assemble the same program text as today.

## Shared groundwork

Five pieces are used by more than one direction. Each has one owning phase, which builds it, and a contract the other phases rely on.

**1. Derived projects (owner: I1).** Instances and variants never reach the runtime as new concepts. Two pure functions in `js/project.js` turn a project into the plain project that one run executes:

```js
applyVariant(project, name)   // swaps fragment texts, the loop and constants
applyInstance(project, id)    // adds a fragment named "instance" and merges constants
```

The runtime change is three lines: `rt.solver` and `rt.link` put `"instance"` first in their fragment list when `FRAGMENTS.instance` exists. `join`, `fragment_lines` and the `W` locations then work unchanged.

**2. Modes of the assembled program (owner: S1).** `assemble(project, compiled, runtimeLua, opts)` gains `opts.mode` and `opts.modules`. A mode replaces the loop body and keeps the declarations:

| Mode | Lua appended after `runtime.lua` | Body after `rt.prepare()` | First used in |
| --- | --- | --- | --- |
| `run` (default) | none | the compiled loop | today |
| `audit` | `lua/audit.lua` | `rt.audit{}` | S1 |
| `enumerate` | `lua/space.lua` | `rt.enumerate{}` | V4 |
| `replay` | `lua/replay.lua` | `rt.replay{}` | I4 |
| `run` with capture | `lua/ground.lua` | the compiled loop | S2 |

The compiler already returns `solvers` and `links`, so the driver can write the declaration lines without the loop. The sweep spike does exactly this.

**3. Compact events (owner: V1).** New event kinds are emitted only when `SETTINGS.record` is set, so default output stays byte for byte the same.

| Kind | Content | Consumers |
| --- | --- | --- |
| `I` | Per link: the interface atom texts, in link order | V3, V4, I4, S1 |
| `R` | One step: kind, candidate as hex bits, clause as signed indices, loop line | V2 to V5, I4 |
| `C` | One solver call: solver, start, duration, result, parent, loop line | V2 |
| `K` | One certificate: step, level, verdict | S2, V4 |
| `A` | Audit progress and verdict | S1, I4, V4 |
| `P` | Candidate bit vectors in chunks | V4 |
| `G` | A generated instance: facts, attempt, exact or solver-completed | I2 |

**4. Worker pool (owner: I3).** `js/pool.js` runs jobs on N `Engine` objects. A job is one assembled program plus a reducer that keeps the last `S`, the `D`, and a hash of the solution set. Campaigns, fuzzing and library sweeps use the pool; view frames use one dedicated engine.

**5. Ground-program capture (owner: S2).** `lua/ground.lua` registers an observer per solver before grounding and stores rules by head atom. Lifting, the product check and the precise audit diagnosis read it.

New files, by owning phase:

```
lua/audit.lua          S1   exhaustive audit
lua/ground.lua         S2   capture, three-valued evaluator, product
lua/draw.lua           I2   seeded draws
lua/generate.lua       I2   generator runtime
lua/space.lua          V4   candidate enumeration
lua/replay.lua         I4   replay of recorded expansions
js/instances.js        I1   instance model and importers        (no DOM)
js/instances-tab.js    I1   Instances tab
js/generate.js         I2   generator programs                   (no DOM)
js/pool.js             I3   worker pool
js/store.js            I3   IndexedDB result store
js/campaign.js         I3   suites, cells, filters, fits         (no DOM)
js/campaign-tab.js     I3   Campaign tab and plots
js/fuzz.js             I4   fuzzing and diagnosis                (no DOM)
js/shrink.js           I4   delta debugging                      (no DOM)
js/recording.js        V1   recording model and files            (no DOM)
js/anatomy.js          V2   loop diagram, timeline, line table
js/views.js            V3   draw vocabulary, renderers, layouts
js/space.js            V4   fate computation                     (no DOM)
js/cursor.js           V5   the shared step cursor
tools/audit.mjs  tools/bench.mjs  tools/make-replays.mjs  tools/certcheck.py  tools/draw.py
docs/spec-instances.md  docs/spec-recording.md  docs/spec-views.md  docs/spec-soundness.md
spike2/                the eight spikes, read-only like spike/
```

Phases V4 and V5 add two files to this list: `js/space-view.js` for the candidate map and the blame matrix on a canvas, and `js/export.js` for SVG and PNG export.

## Build order

&#91;embedded content: build order · 15 phases in 5 waves, 3 cross-lane needs\]

I1, V1 and S1 depend on nothing new, so three people can start on the same day. Fuzzing (I4) waits for the audit's verdict and the compact recording; the candidate map (V4) waits for the audit's solution flags; the proof log (S5) is a recording with certificates.

## Conventions for every phase

Each phase in the sub-tabs has the same five parts as a phase of `PLAN.md`:

- **Read first**: the files to open before writing code.
- **Verified** and **Not verified**: what a spike already ran, and what the phase must test before building on it.
- **Tasks**: numbered, each naming its file.
- **Done when**: checks a test can assert.
- **Checkpoint**: run `cd test && npm test`, run `node tools/guide-numbers.mjs --check`, update `PROGRESS.md`, commit as `Phase <code>: <title>`.

Three checks apply to every phase and are not repeated below:

1. Rows 1 to 13 of `docs/reference-numbers.md` and `guide/numbers.json` are unchanged.
2. For a project that uses none of the new keys, `assemble` returns the same program text as before the phase. One test compares against a stored copy.
3. The headless tool and the page give the same result for the feature, because both call the same module.

## Numbers the implementation must reproduce

These extend `docs/reference-numbers.md`. All were measured by the spikes on clingo-wasm 0.6.0 under Node 22.

| # | Project | Action | Expected |
| --- | --- | --- | --- |
| 14 | `tutorial-weak-relevant`, n = 8 | Audit | 256 candidates, 61 solutions, 640 counterexamples, 499 pairs, 499 unsound, 59 solutions at risk |
| 15 | `tutorial-weak-relevant`, n = 2 | Audit | 4 candidates, 3 solutions, 1 pair, 1 unsound; n = 1 is sound |
| 16 | `tutorial-first-run`, n = 8 | Audit | 640 pairs, 0 unsound |
| 17 | `graph-coloring`, n = 5 | Audit | 3,373 candidates, 101 solutions, 13,950 counterexamples, 13,950 pairs, 0 unsound |
| 18 | `graph-coloring-original`, n = 5 | Audit | 3,272 pairs, 0 unsound |
| 19 | `graph-coloring-original`, n = 6 | Audit (slow, 54 s) | 102,508 candidates, 10,698 solutions, 606,030 counterexamples, 91,810 pairs, 44,125 unsound, 1,440 at risk |
| 20 | `guide-04-one-node` | Audit | 176 candidates, 3 solutions, 290 pairs, 64 unsound, 2 at risk |
| 21 | `tutorial-first-run` | Level 2 on each refinement | All certified |
| 22 | `tutorial-weak-relevant` | Levels 2 and 3 on each refinement | None certified |
| 23 | `tutorial-weak-relevant` | `lift` link | 61 solutions |
| 24 | `graph-coloring`, n = 5 | Level 2, then level 3 | Level 2 certifies none, level 3 certifies all |
| 25 | `graph-coloring`, n = 5 | `lift` link | 101 solutions, with fewer refinements than without `lift` |
| 26 | `gnp` generator, n = 7, p = 300, seed 1 | Generate | `edge(1,5) edge(1,6) edge(2,3) edge(2,4) edge(3,5) edge(3,6) edge(4,6) edge(4,7) edge(5,7)` at attempt 0 |
| 27 | `graph-coloring`, n = 6, Shape 1, every step recorded | Run | 21,078 `R` events; run time within 10% of the unrecorded run |

Audit counts and solution counts hold for any search order. Counts of refinements depend on the search order, so rows 21 to 25 assert relations, not the spike's exact figures (14, 6, 1,190 and 838).

Row 26 holds only if `lua/draw.lua` copies the mixer of `spike2/probe3.lua` unchanged.

Three fixtures from the later prototypes are independent of the search order as well:

| # | Project | Action | Expected |
| --- | --- | --- | --- |
| 28 | `guide-04-one-node` on the triangle 1, 2, 4 | Audit | 8 candidates, 7 solutions, 1 pair, 1 unsound |
| 29 | `guide-03-hit-clique`, the step with candidate {1, 2} and counterexample {4, 5, 6} | The view of phase V3 | 38 marks, with `emph` on the nodes 4, 5 and 6 |
| 30 | `gnp` generator, n = 7, p = 300, seeds 1 to 5 | Generate | The facts that `spike2/probe3.lua` prints, at attempts 0, 2, 0, 0 and 0 |
