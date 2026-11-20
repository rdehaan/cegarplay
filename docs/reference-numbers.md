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
| 11 | `nash.lp` imported with `legacy` vs. `examples/nash.json` (glue wrapped), Shape 1, solutions = 1 | Identical statistics in both runs |
| 12 | Graph colouring: `legacy` import of the original file vs. `examples/graph-coloring-original.json`, n=6, Shape 1, all | Identical statistics; 9,270 solutions |
| 13 | Any compiled template vs. the hand-written Lua in `spike/js/shapes.mjs` | Identical statistics |

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
