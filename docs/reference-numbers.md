# Reference numbers

Every row was measured with `clingo-wasm@0.6.0` (clingo 5.8.1) under Node.
`spike/test/run.mjs` reproduces most of them (`npm test`, `npm run test:slow`).

"Graph colouring n=6" means `reference/declarative-cegar/graph-coloring.lp`
with `#const n=10.` replaced by `n=6` (in CegarPlay: constant `n = 6`; the
`-c` override reaches every solver and gives the same numbers). A copy is in
`spike/examples/graph-coloring-n6.lp`.

Solvers: A = shared + abstraction, no options. C = shared + check, options
`--heuristic=Domain`. Link G = A -> C via shared + glue.

`compat` = the link option that makes `relevant(T)` a free choice atom as in
`cegar.py`. `legacy` = unwrapped glue atoms. "fix" = the added `relevant/1`
rule from `spec-app.md` section 7. "refine part" = the `#program refine(k).`
part from the same section.

## Exact numbers (must match)

| # | Project | Loop | Settings | Expected |
| --- | --- | --- | --- | --- |
| 1 | Graph colouring n=6, original rules, `legacy compat` | Shape 1 | solutions = all | 9,270 solutions; C: 16,577 calls, 7,307 sat, 9,270 unsat; 7,307 clauses, 55,007 literals in total; A: 25,512 choices, 7,499 conflicts |
| 2 | Same, without `compat` | Shape 1 | all | 9,270 solutions; C: 16,577 calls; 7,307 clauses; A: 25,512 choices, 7,499 conflicts |
| 3 | `explain1.lp`, `compat` | Shape 1 | solutions = 1 | 1 solution; C: 9 calls, 8 sat; 8 clauses; A: 10,269 choices, 822 conflicts |
| 4 | Graph colouring n=6 | Reference run (block only) | all | 10,698 solutions; C: 102,508 calls, 91,810 sat; 91,810 clauses (slow: about 10 s) |
| 5 | Graph colouring n=6, with fix | Shape 1 | all | 10,698 solutions |
| 6 | Graph colouring n=6, with refine part | Shape 3 | all | 10,698 solutions (slow: about 30 s) |
| 7 | Graph colouring n=6, with refine part | Shape 4, batch 20 | all | 10,698 solutions (about 3 s) |
| 8 | Graph colouring n=6, with fix, plus `#maximize { 1,X,Y : edge(X,Y), X < Y }.` in the abstraction | Shape 1 | all | 9 improving solutions; the last has 15 edges |
| 9 | Graph colouring n=10 (the file as shipped), `legacy compat` | Shape 1 | solutions = 1 | 1 solution; C: 1 call; 0 clauses; A: 65 choices, 7 conflicts |

Rows 1, 3 and 9 equal what the Python prototype reports natively (row 1 and 9
with the pre-December-2025 `cegar.py` that used unwrapped glue atoms).

Solution counts (rows 4–7) hold for any clingo version and any search order.
Calls, choices and conflicts (rows 1–3, 9) depend on the search order: they
hold only if interface atoms keep the order of `symbolic_atoms:iter()`, clause
literals keep link order, and no extra options are passed. `--stats` and the
per-solver propagator do not change them (the spike has both).

## Ranges and equalities

| # | Check | Expected |
| --- | --- | --- |
| 10 | Graph colouring n=6, original rules, Shape 2, all | Between 9,270 and 10,697 solutions (the original rules lose solutions; how many depends on the search order; observed 9,277). Slow: about 7 s. |
| 11 | `nash.lp` imported with `legacy`, with the `edge/3` fix of its rules (ii), vs. `examples/nash.json` (glue wrapped), Shape 1, solutions = 1 | Identical statistics in both runs. (Without the fix the loop is unsound from n = 3: the audit at n = 3, w = 1 finds 8,232 of 58,848 refinements removing a solution; 495 of 576 solutions found.) |
| 12 | Graph colouring: `legacy` import of the original file (original rules), n=6, Shape 1, all | 9,270 solutions (the example `graph-coloring-original` that row 12 used to compare with was removed) |
| 13 | Any compiled template vs. the hand-written Lua in `spike/js/shapes.mjs` | Identical statistics |

## Directions (PLAN2): rows 14–30

From `docs/directions/implementation.md`, measured by the planning spikes on clingo-wasm 0.6.0 under Node 22.

These extend `docs/reference-numbers.md`. All were measured by the spikes on clingo-wasm 0.6.0 under Node 22.

| # | Project | Action | Expected |
| --- | --- | --- | --- |
| 14 | `tutorial-weak-relevant`, n = 8 | Audit | 256 candidates, 61 solutions, 640 counterexamples, 499 pairs, 499 unsound, 59 solutions at risk |
| 15 | `tutorial-weak-relevant`, n = 2 | Audit | 4 candidates, 3 solutions, 1 pair, 1 unsound; n = 1 is sound |
| 16 | `tutorial-first-run`, n = 8 | Audit | 640 pairs, 0 unsound |
| 17 | `graph-coloring`, n = 5 | Audit | 3,373 candidates, 101 solutions, 13,950 counterexamples, 13,950 pairs, 0 unsound |
| 18 | (removed with the example `graph-coloring-original`) | | |
| 19 | (removed with the example `graph-coloring-original`) | | |
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

Row 26 and 30: `spike2/probe3.lua` was not delivered; `spike2/gen/draws.lua` held its mixer unchanged (`spike2/` was removed later; see git history).

## Timings (for orientation only; do not assert)

| Run | Time |
| --- | --- |
| Row 1 in Node | 1.0–1.4 s |
| Row 1 in a Chromium worker | 1.3 s |
| Row 1, same search, native Python prototype | 3.1 s |
| Row 5 | 2.4–2.9 s |
| Abort to fresh worker ready, Chromium | 60–70 ms |

## Ground truth by brute force

`spike/test/brute.py` (needs `pip install clingo`) enumerates all 102,508
candidates at n=6 and checks each on its own: 10,698 solutions. Use the same
idea (the Reference run template) to validate any new example.
