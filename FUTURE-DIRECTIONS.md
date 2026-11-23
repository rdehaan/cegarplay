# Future directions

What was considered but not built, as of Nov 23, 2026 (branch `claude/loop-breadth`). The
reasoning behind most items is in `docs/directions/breadth.md` and `docs/directions/generality.md`;
`PROGRESS.md` has the history. The items are ordered roughly by value for effort within each
section.

## For the owner (outside the code)

- **Report the grounding problem to clingo.** Choice atoms that the backend adds before
  grounding are grounded wrongly by a rule that projects them away. With `b :- q(X).` over
  `q(1..3)`, only one instance is made. Python clingo 5.8.3 reproduces it in a few lines (see
  `CLAUDE.md`, rule 10, and `test/breadth.test.mjs`). CegarPlay and `cegarcheck.py` work around
  it with program text, so a fix upstream is not needed, but other tools probably hit it too.
- **File the drafted trap report** (`docs/upstream-trap-report.md`, for clingo-wasm).
- **Run the browser tests in Firefox.** This work ran them in Chromium only
  (`BROWSER=firefox npm test`).
- **Deploy to GitHub Pages, run the first CI, and have a person read the guide and the new
  manual sections.** These open items are carried over from `PROGRESS.md`.

## Loop language and runtime

- **A stop rule when the bounds meet.** IHS (`maxsat-ihs`) and Benders (`benders-tardiness`)
  could stop as soon as the lower bound reaches the upper bound, as MaxHS does. This is
  expressible today with an `if` on the two numbers. A built-in helper would be one line in the
  examples, but it needs a way to accept the witness that reached the upper bound.
- **A second kind of solution.** MARCO reports its MUSes as solutions but only logs its MSSes.
  An `accept M as mss` (a label per solution, shown and counted separately in Output) would
  suit every loop that has two outcomes worth keeping.
- **Signs in expansion facts.** `S.expand(part, core = K)` names only the atoms. The proposed
  sign facts (`neg(k, T)` for atoms assumed false) were not built; a loop splits the list with
  `a.true` instead.
- **`C.solve(assume E, minimal)`.** In the G1–G8 specification, this was a subset-minimal model
  under assumptions. It was never built. `C.core.minimal` now covers the case that mattered
  (minimal cores).
- **Faster core minimisation.** `C.core.minimal` uses deletion with clause-set refinement: up
  to one solve per assumption. QuickXplain or progression would need fewer solves on large
  cores, and caching cores across rounds would help IHS.
- **Cheaper partial checks** (`on partial`).
  - **The cost.** Every call is a full solve of the check, which is why partial checks were
    slower in both examples despite cutting the candidates.
  - **Options.** A trigger that fires only when new atoms become true, a trigger that fires
    once all interface atoms are decided, a domain heuristic that decides interface atoms
    first, or a cheap pre-check given in ASP. Any of these would make partial checks pay off
    more often.
  - **First, an example.** None of these should be built before an example shows the gain.
- **Clauses across several links.** `c + d` joins clauses of one link only. A clause over the
  atoms of two links of the same solver is not translated.
- **Parallel checks.** Several checks of one candidate (equilibria, several oracles) could run
  in parallel. The engine serialises Lua callbacks, so this needs engine work.
- **Out of reach.** Refinement by interpolants (predicate abstraction) is not possible: clingo
  produces no proofs. Omission-style refinement is the available substitute
  (`queens-omission`).

## Checking tools

- **`cegarcheck.py` covers one shape.** It models one abstraction, one check and one link in a
  Shape 2 loop, and now refuses what it does not model. These loops can only be checked with the
  engine today: MARCO, IHS, OLL, Benders, the knapsack bound loops, `reasons-*`,
  `queens-omission`, chains and families.

  A second checker for the "several solvers" family would be the next step. Each library family
  should be checked by something other than the engine.
- **Witness checks in `certcheck.py`.** It refuses proof logs of witness checks
  (`lang-core`, `colourable-partial`). Level-1 (core) certificates are already defined; the
  checker needs a model of "a solution has a model of the check".
- **The audit covers clause and expansion refinements only.** `tools/audit.mjs` refuses loops
  refined only by cores (`maxsat-ihs`, `colourable-partial`), by `A.set` (`queens-omission`) or
  by `G.above`/`G.below` (`marco`).

  For cores, an audit would test each recorded core against the solutions: a core must not hold
  on any solution.
- **Optima in campaigns.** `expected.optimum` is checked by Run all, the runner and the tests,
  but a campaign suite still compares solution counts only. Cells whose optima disagree should
  be marked like cells whose counts disagree.

## Statistics and views

- **Tracked values in the Observatory.** `track` series appear only in the Statistics tab.
  Drawing them on the Observatory timeline, aligned with the calls, would show which call moved
  a bound.
- **A Lifting-coach view for cores.** The Statistics tab could show the distribution of core
  lengths, and of minimised against plain cores, much as the Lifting coach does for clauses.

## Library and teaching

- **Weighted OLL.** `maxsat-oll` is unweighted. A weighted version, using stratification or WPM
  splitting, would complete the core-guided family.
- **More families from the survey.**
  - **Implicit hitting sets beyond MaxSAT.** Abduction in the style of AbHS (the dual form exists
    as `smallest-mus`).
  - **2-ASP(Q) with weak constraints.** An example in that style (the knapsack optimum loops are
    the nearest).
  - **CAQE-style QBF.** A clausal-abstraction solver with cores flowing both ways (the nearest is
    `qbf-three-blocks`).
- **An example where `on partial` wins on time.** This needs a cheap check and an expensive
  completion, for example an abstraction with a hard non-interface part such as a timetable, and
  an external check on its interface. Neither G5 example is faster than its `total-only`
  variant.
- **A guide chapter on loops from the literature.** Today the literature table is in the manual,
  with short sections in guide chapters 10 and 11. A guide chapter could design one of these
  loops step by step, with measured numbers.
- **The chat-package guide and instances.** It still does not describe generators or recipes in
  instances.
