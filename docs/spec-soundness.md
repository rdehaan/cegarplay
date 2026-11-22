# Soundness specification

What CegarPlay checks about refinements, beyond comparing solution counts. Sections 2 to 5
follow in phases S2 to S5 of PLAN2.md (design: `docs/directions/soundness.md`).

## 1. The audit

Mode `audit` of the assembled program (`assemble(..., { modules: [lua/audit.lua], body })`,
body built by `auditBody(compiled, auditPlan(compiled))` in `js/driver.js`). The body declares
the solvers and links of the script (`declarationLines`) and calls

```lua
rt.audit{ link = G, limit = 200000, clause = true|false,
          expand = { { part = "refine", facts = { { name = "cex", pred = "color", arity = 2 } } } } }
```

`auditPlan` picks the link that leaves a top solver (no incoming links); with several, the only
one the script refines; a link whose target has outgoing links (a chain) is refused. `clause` is
set when the script uses `G.clause`; `expand` lists the parts that the source solver is expanded
with from `X.atoms(p/n)` where X is not known to be a model of the source itself (the compiler
records `parts[].facts[].receiver` and `linkUses`).

Settings in audit mode: `solutions = 0`, `candidates = 0`, `trace = 0`; inside the audit
`SETTINGS.trace` is raised so that counterexamples keep their text (no `T` events are sent).
Both solvers get `opt_mode = ignore`.

Algorithm:

1. Candidates: `A:models{ limit = N + 1 }`, deduplicated by the packed vector of the link's
   interface atoms (62 atoms per Lua integer). Above N: `A {verdict = "limit"}`, outcome `limit`.
2. Clause audit: `C:models{ assume = G(M) }` per candidate. No model: M is a solution. Otherwise
   every model is a counterexample, and each distinct relevant vector R is a pair (M, R).
   A pair is unsound when a solution s has `(M xor s) and R = 0`. `at_risk` counts the solutions
   that agree with at least one pair. The witness is the agreeing (pair, solution) with the fewest
   differing atoms; `differ` lists them. `empty` counts pairs with an empty R.
3. Rule audit: the distinct fact sets `{name(k, a)}` over all counterexamples. One scratch control
   of A's fragments (`rt.new_control`, `rt.join`) gets all of them (part grounded with k = 1, 2,
   ...); a solution with a model there under its interface values (assumptions) is removed by
   none. For the others, each fact set is grounded alone on a fresh scratch control; a solution
   without a model there is at risk, and the fact set is unsound.

Events: `A` progress `{phase, candidates, pairs, unsound}` at most every 0.25 s; `A` verdict
`{verdict, link, kinds, candidates, solutions, counterexamples, pairs, unsound, at_risk, empty,
atoms, t, witness}`; then `S` and `D` as for any run.

Reference rows 14 to 20 (`docs/reference-numbers.md`) are tested in `test/audit.test.mjs`.
Row 19 takes about 40 s (single-word fast path); it runs under `SLOW=1`.
