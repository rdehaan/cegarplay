# CegarPlay: loop shapes from the literature

Nov 23, 2026. Follows `generality.md`. Status: built (commits "Directions: loop shapes from the
literature" and "Breadth: ..."). This note says what was asked, what was found, what was built,
and what remains out of reach.

## The question

An external survey (the "CEGAR Loop Shapes in the Literature" chat artifact) put twelve loop
shapes from the literature next to CegarPlay. The question was how far the machinery reaches, and
how to extend it without making CegarPlay harder to use.

The survey could read only the README, so it rated most shapes "partial" or "poor". It proposed
five new constructs:

- a core-returning check mode;
- optimal calls with bounds;
- several refinements per iteration;
- loops as oracles;
- an outcome that both accepts and refines.

Against the repository, three of the five already existed after PLAN2 (G1 to G8):

| Survey's request | Already in the language |
| --- | --- |
| Core-returning check mode | `if not C.solve(assume G(M)): reject M with G.core(C)` |
| Optimal calls | `A.solve(optimal)`, `M.cost` |
| Loops as oracles | Families and a recursive `def` (`qbf-deep`) |

The other two were also covered:

- **Several refinements per iteration:** several `reject`s, or `C.models`.
- **Accept and refine:** `accept M` followed by `A.add(G.above(E))`.

None of the five was added as a new construct. The additions below are small and fill real
gaps found by writing the loops.

## Coverage of the twelve shapes

| # | Shape (literature) | Example | How |
| --- | --- | --- | --- |
| 1 | ∃∀ CEGAR (circumscription, argumentation, stable-unstable) | `qbf`, `af-preferred`, `stable-models` | Shape 1, `relevant/1` |
| 2 | Expansion (AReQS); CEGIS | `qbf-expansion`; `cegis-circuit`, `min-dnf` | Shape 3, `refine(k)` |
| 3 | Several oracles | `nash`, `boolean-game`, `abduction-two-checks` | several checks or `reject`s |
| 4 | Implicit hitting sets (MaxHS) | `maxsat-ihs` (dual form: `smallest-mus`) | optimal abstraction, `G.core`, disjoint cores via `for a in C.core` |
| 5 | MARCO | `marco` | maximal seeds, grow and shrink over `G(M)`, `G.below` / `G.above` |
| 6 | Core-guided optimisation (OLL) | `maxsat-oll` | one solver under assumptions, `C.expand(relax, core = K)` |
| 7 | Logic-based Benders | `benders-tardiness`, `knapsack-bounds` | optimal master and subproblem, optimality cuts as rules, `track` |
| 8 | Optimisation over a Σ2 check | `knapsack-optimum`, `reasons-by-size` | `A.solve(optimal)`, `search A optimal` |
| 9 | Bound strengthening | `knapsack-bounds`, `conformant-growing` | `M.value`, `X.cost`, `track`, externals |
| 10 | Recursive nesting (RAReQS) | `qbf-deep` | families, `def` |
| 11 | Clausal abstraction (CAQE) | `qbf-three-blocks`, `knapsack-fortification` | chains, `core.on(G)`, inner `search ... keep` |
| 12 | Omission-based abstraction | `queens-omission` | `#external` guards, `A.set` |
| (7) | Branch-and-check, lazy clause generation | `colourable-partial`, `triangle-free-lazy` | `on partial P every n:` (G5), `G(P, false)` |

The manual's section *Loops from the literature* holds the same table for readers, and every
example carries a tag for its algorithm.

Out of reach:

- **Refinement by interpolants** (predicate abstraction). clingo produces no proofs.

## What was built

### B1. A core is a list

- **Iterating a core.** `C.core` is indexable and has a length, so `for a in C.core:` walks the
  assumptions of `C` that are in the core. `E.without(a)` and `E.flip(a)` work on them.
- **`for` refuses non-lists.** `for` compiles to `rt.each`, which raises
  `for: expected a list, got ...` for a model, a solver, a link, `none`, a number or a string.
  Before, it ran zero times, and a MaxHS prototype looped forever: 150,916 clauses in 5 s.
- **`core.on(G)` may be empty.** It gives an empty clause where `G.core(C)` raises an error,
  so `K.size == 0` tells that a core lies outside `G` (for example, unsatisfiable hard clauses).
- **Clearer errors.** The errors of `flip` and `without` say that a clause's atoms belong to the
  solver it refines, not to the check.

### B2. Cores and clauses as facts

`S.expand(part, name = L)` takes a core, a clause or a `G(M)` list as well as `X.atoms(p/n)`. The
facts name the atoms and drop their signs.

The sign facts proposed in the first draft were not built. A loop that needs the signs splits
the list with `a.true`.

### B3. Tracked values

`track n = e` records a number per round:

- **Runtime.** `rt.track` sends a `V` event `{ n, i, v, t }`, at most 2,000 per name. The final `S`
  has `tracked` (the last values) only after a `track`, so the recordings and final statistics
  of other runs are unchanged.
- **Statistics tab.** A "Tracked values" chart (hidden without `track`) and rows in "Custom
  counters and tracked values".
- **`tools/run.mjs`.** Prints the series.

`n` is a label, not a variable. The x axis is the round, not the time: optimisation loops often
run in milliseconds.

### A grounding bug, found by the examples

- **What went wrong.** The runtime gave a link's interface atoms to its target only through
  clingo's backend. clingo 5.8 then grounds a rule that projects such choice atoms away
  (`b :- q(X).`) with a single instance. The check `b :- q(X).  :- not b.` therefore refuted
  every candidate with `q(2)` but without `q(1)`.
- **Where it shows.** It reproduces in Python clingo 5.8.3. `tools/cegarcheck.py` built its check
  the same way and had the same bug, so the cross-check between the engine and the checker could
  not catch it.
- **The fix.** Both now also give the atoms as program text: a choice rule and facts, grounded
  with the target and with the same literals. See `iface_part` in `lua/runtime.lua` and rule 10
  in `CLAUDE.md`.
- **Effect.** No library count changed. Regression tests are in `test/breadth.test.mjs` (engine)
  and `test/chat-package.test.mjs` (checker).

### Examples

Each new example is checked independently, in `test/breadth.test.mjs` and the instance tests.

| Example | Checked against |
| --- | --- |
| `maxsat-ihs` | Optima 8, 3 and 6, the same as clingo's own `#minimize` |
| `marco` | MUS and MSS counts (7/12, 9/3, 4/6, 0/1) from brute force over all subsets |
| `maxsat-oll` | Optima 6, 3 and 4, the same as clingo's own `#minimize` |
| `benders-tardiness` | Optima 20, 16 and 18, the same as one clingo program that assigns and sequences at once |
| `queens-omission` | 92, 4 and 0 placements |
| `cegis-circuit` | 27 and 789 circuits from brute force; the audit is sound |

Notes on the examples:

- **Counts of the optimisation loops.** The three optimisation loops end with `stop` once the
  optimum is proven. Their runs are therefore not exhausted, so their `expected` counts are null
  and they carry the tag `stops-at-optimum`.
- **A `#minimize` pitfall.** The first Benders model, and the single-program reference model,
  merged equal `#minimize` tuples of two statements, so equal (cost, job) and (estimate, machine)
  tuples counted once. Tagged tuples fix it. The manual's troubleshooting table and the
  chat-package checklist now warn about it.
- **A grounding pitfall.** `V = #sum { ... }` over guessed atoms grounds every possible sum, which
  stalled an early Benders check. A comparison (`#sum { ... } > E`) avoids it.

### Findability

The loops are pointed to from these places:

- the manual's section *Loops from the literature*, linked from the manual's introduction, the
  README, `llms.txt` and the library panel;
- the tutorial's lesson 10 (*Cores as lists, and bounds over time*) and lesson 13;
- the guide's chapters 10 and 11 (sections "... in the literature");
- the chat-package guide;
- `examples/contrib/README.md`;
- algorithm tags on the examples.

### G5. Checks on partial candidates (built after the rest)

- **Syntax.** `on partial P every n:` before `on candidate`. It compiles to `on_partial` and
  `every` in the search table. While such a search runs, the propagator checks at every
  fixpoint (`clingo.PropagatorCheckMode.Fixpoint`). It is set in `init`, which clingo calls
  for every solve.
- **Which fixpoints.** The hook runs at every n-th fixpoint. A fixpoint whose interface values
  equal those at the previous call is skipped.
- **The partial candidate.** `G(P)` lists the decided atoms. `G(P, v)` completes `P` with `v`,
  an addition to the design.
- **Refinements.** A reject adds its clauses at once; they need not be false yet.
  Candidate-specific clauses (`G.clause(P, X)`, `G.block`, `G.above`, `G.below`, `G.lift`) are
  errors. Cores and `G.clause(X)` hold for every completion.
- **Recording.** A partial reject is an `r` step whose candidate is the counterexample's
  interface. `certcheck.py` certifies such a log: `triangle-free-lazy`, n = 6, 115 solutions,
  65 refinements at level 2.
- **What it gains.** Fewer total candidates, but more time, because each call is a solve:

  | Example | Total candidates, total-only | With `on partial` |
  | --- | --- | --- |
  | `triangle-free-lazy`, n = 8 | 218 | 136 |
  | `colourable-partial`, n = 7 | 1,725 | 1,372 |
  | `colourable-partial`, n = 8 | 8,614 | 5,073 |

  clasp already learns a clause that cuts the subtree from a refuted total candidate. Cores at
  partial assignments were not shorter (clasp's cores are not minimal), and a bin-packing
  example showed no gain at all (its capacity relaxation already removes most bad candidates),
  so it was dropped. The manual says when partial checks pay off.

## What is left

- **Core minimisation.** Shrinking a core before the reject would make partial checks (and
  `maxsat-ihs`) learn shorter clauses. It can be written with `E.without` today, but a built-in
  `C.core.minimal` would be cheaper.
- **A stop rule for bounds.** IHS and Benders could stop as soon as the lower and upper bound
  meet. Both examples already reach the optimum by accepting the first candidate that passes
  the check, so this is left to the script.
- **Optimisation loops and "Run all".** Their instances have no expected counts. A field such as
  `expected.optimum` would let "Run all" check them too. It was not added, to keep the instance
  format as it is.
