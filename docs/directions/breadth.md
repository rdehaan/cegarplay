# CegarPlay: loop shapes from the literature

Nov 23, 2026. A follow-up to `generality.md`.

## Question and verdict

An external survey (the "CEGAR Loop Shapes in the Literature" chat artifact) put twelve loop shapes
from the literature next to CegarPlay. It could read only the README and the landing page, so it
rated most shapes "partial" or "poor". It asked for five new constructs: a core-returning check
mode, optimal calls with bounds, several refinements per iteration, loops as oracles, and an
outcome that both accepts and refines a candidate.

Checked against the repository (`main` at `8e92149`), the machinery is much further along. Most of
what the survey asked for is already in the language, because PLAN2 (G1 to G8) added it.

- **Native or already in the library:** 9 of 12 shapes.
- **Written today with one small gap each:** 2 shapes.
- **Missing:** 1 shape, which is checks during the search (G5, designed but not built).

Three of the five constructs the survey asked for already exist:

| Survey's request | Already in the language |
| --- | --- |
| Core-returning check mode | `if not C.solve(assume G(M)): reject M with G.core(C)` |
| Optimal calls | `A.solve(optimal)` with `M.cost` |
| Loops as oracles | `def` with recursion; `qbf-deep` solves any depth |

The remaining two are also covered:

- **Several refinements per iteration:** several `reject` statements, or a `for` loop over `C.models`.
- **Accept and refine:** in Shape 2, `accept M` followed by `A.add(G.above(E))`.

I ran prototypes of MaxHS and MARCO with `tools/run.mjs`; their scripts are below. MARCO runs
unchanged. MaxHS runs, but the disjoint-cores phase needs one change. The resulting
recommendation is small: **three small additions, one optional larger one, and better
discoverability**. That is no new loop shape, link mode or check mode, so the language stays
the size it is.

## The twelve shapes against the actual machinery

| # | Shape (literature) | Survey said | Actually | Evidence |
| --- | --- | --- | --- | --- |
| 1 | ∃∀ CEGAR, nogood refinement (circumscription, ABA, stable-unstable) | native | **native** | Shape 1, `qbf`, `af-preferred`, `default-extensions` |
| 2 | Expansion / CEGIS / MBQI / 2-ASP(Q) | native | **native** | Shapes 3 and 4, `qbf-expansion`, `conformant-planning` |
| 3 | Several oracles | native/good | **native** | `nash`, `lang-two-stage`; several `reject`s of one candidate are allowed |
| 4 | Implicit hitting sets (MaxHS, IHS beyond NP, AbHS, SMUS) | partial (Lua) | **native, one gap** | Prototype A below; `smallest-mus` uses the dual form (the counterexample's falsified clauses are a correction set, which is the "hit at least one" lemma) |
| 5 | MARCO (MUS/MSS enumeration) | partial | **native** | Prototype B below: 2 MUSes and 5 MSSes, exhausted, no Lua |
| 6 | Core-guided optimisation (Fu-Malik, OLL) | partial | **one gap** | Cores exist (`G.core`, `C.core.on(G)`). A relaxation needs the core's atoms as facts for `expand`, and `expand` takes only atoms read from models |
| 7 | Logic-based Benders | feasibility native, optimality partial, branch-and-check no | **feasibility and optimality native; branch-and-check missing** | `knapsack-bounds` adds optimality cuts with `expand` and tracks LB and UB; branch-and-check needs G5 |
| 8 | Optimisation over a Σ2 check (Δ3^P, 2-ASP(Q) with weak constraints) | partial | **native** | `knapsack-optimum`, `qbf-optimal`, `search A optimal` (G8), `C.solve(…, optimal)` |
| 9 | Bound strengthening | partial (Lua) | **native**; values not shown over time | `knapsack-bounds` (`M.value`, `X.value`, `log`); `conformant-growing` (externals, growing horizon) |
| 10 | Recursive nesting (RAReQS, Σk) | poor | **native** | `qbf-deep` (families and `def`; 120 formulas at depths 2 to 4 agree with brute force) |
| 11 | Clausal abstraction (CAQE, QESTO) | partial | **native** (chains) | `qbf-three-blocks` (inner `search … keep`), `core.on(G)` along a chain |
| 12 | Vocabulary-changing refinement (predicate abstraction, omission, interpolation) | poor | **idiom for omission; out of reach for interpolation** | Activation atoms: `#external active(a)`, `A.set`, `A.add(c, while a)`. clingo produces no proofs, so interpolants cannot be computed |

So the survey's main worry, that cores "cannot be marked as `relevant`", does not apply. A
check that looks for a *witness* is refined from its core (`lang-core`), and the polarity of
the check is chosen in the script, not fixed by the runtime.

## Prototype A: MaxHS (implicit hitting sets)

A weighted MaxSAT instance (6 soft clauses, 2 hard). The abstraction picks the soft clauses to
drop at minimum cost. The check asks whether the hard clauses plus the kept soft clauses are
satisfiable.

```
abstraction:  { drop(C) : soft(C,_) }.  #minimize { W,C : drop(C), soft(C,W) }.
glue:         glue(drop(C)) :- soft(C,_).
check:        a SAT encoding;  :- soft(C,_), not drop(C), not sat(C).
              #minimize { W,C : soft(C,W), not sat(C) }.   % so X.cost is an upper bound
```

```loop
upper = none
loop:
    M = A.solve(optimal)                     # minimum-cost hitting set: M.cost is a lower bound
    if not M: stop "hard clauses unsatisfiable"
    E = G(M)
    found = 0
    loop:                                    # disjoint cores: relax each core, look again
        X = C.solve(assume E)
        if X:
            if upper == none or X.cost < upper: upper = X.cost
            break
        A.add(G.core(C))                     # "hit at least one clause of the core"
        found = found + 1
        for a in C.core:                     # <- does not work today (gap B1)
            E = E.flip(a)
    log "bounds", M.cost, upper, "cores", found
    if found == 0:
        accept M
        stop
```

- **Without the inner loop** (one core per round), the script runs today. It reports the optimum
  `drop(2)` with cost 2 after 2 candidates and 1 core, which matches a hand check.
- **With the inner loop**, it needs the core as a list of the check's assumptions. Two things go wrong:
  - `for a in G.core(C)` walks the literals of the *clause*, which belong to `A`. So `E.flip(a)`
    fails with `flip: the atom is not in the list`.
  - `for a in C.core` runs **no iterations, silently**, because a core is not a list. The run
    then adds the same core forever: 150,916 clauses in 5 s.
- **With the change.** I made `Core` indexable (a one-line `__index` that serves `lits[i]`; tried
  and then reverted). The script then runs and logs `bounds 0 2 cores 1`, then
  `bounds 2 2 cores 0`.

## Prototype B: MARCO

A CNF with 6 clauses. The map solver `A` picks a set of clauses `sel/1`, and
`--heuristic=Domain` with `#heuristic sel(C). [1,true]` makes each seed maximal. The check is
"the picked clauses are satisfiable".

```loop
loop:
    M = A.solve()
    if not M: stop
    E = G(M)
    if C.solve(assume E):                    # satisfiable seed: grow it to an MSS
        for a in E:
            if not a.true and C.solve(assume E.flip(a)): E = E.flip(a)
        log "MSS", A.solve(assume E).atoms(sel/1)
        count mss
        A.add(G.below(E))                    # BlockDown
    else:                                    # unsatisfiable seed: shrink it to a MUS
        for a in E:
            if a.true and not C.solve(assume E.flip(a)): E = E.flip(a)
        accept A.solve(assume E)
        count mus
        A.add(G.above(E))                    # BlockUp
```

Result: the MUSes {1,2,3} and {1,4,5} are the solutions. The MSS log has 5 lines, one per minimal
hitting set of the two MUSes. The run ends with `exhausted: true` after 14 candidates in 0.03 s.
Nothing is missing. The only cosmetic gap is that MSSes can be logged but not reported as a
second kind of solution, which is acceptable.

## Recommended additions

Each item names the shapes it opens up and what it adds to the language. They are ordered by
reach per unit of added complexity.

### B1. A core is a list of assumptions, and `for` refuses a value that is not a list

- **Adds no syntax.** `C.core` already exists. It becomes iterable: its elements are the
  check's assumption literals, so `E.flip(a)`, `E.without(a)` and `a.true` work on them.
- **The `for` fix.** `for x in e` raises `for: expected a list, got <kind>` when `e` is not a list.
  Today it silently runs zero times on a core, a clause or a model. That is the bug that turned
  prototype A into an endless loop, and it would hit any user who tries this.
- **Optional.** `E.minus(C.core)` flips every core atom at once.
- **Opens up:** disjoint-core phases (MaxHS, AbHS); core minimisation by deletion
  (`for a in C.core: if not C.solve(assume E.without(a)) …`); "several refinements per
  iteration" for core checks.
- **Cost:** about 15 lines of Lua, two compiler-free tests, and one manual row.

### B2. Core atoms as facts for rule refinements

- **The change.** `S.expand(part, core = C.core.on(G))`, and more generally any clause or core in
  place of an atom list. The facts are the *atoms* of the literals, for example
  `core(k, drop(3))`. A second fact set gives the signs when needed (`neg(k, T)` for negative
  literals), so `refine(k)` can tell them apart.
- **Opens up:**
  - core-guided relaxation (Fu-Malik, OLL): `#program relax(k).` adds a cardinality atom
    over `core(k,_)`;
  - Benders cuts that name a core;
  - an IHS whose hitting-set constraint is a rule (with weights or cardinalities) instead of
    a clause.
- **Cost:** `Solver:expand` already turns symbols into facts. It needs a branch that maps
  literals back to symbols through the link's atom table, which the runtime keeps for
  `G.clauses`.

### B3. Tracked values over time

- **The change.** One new statement, `track name = e` (or `count name = e`, which would reuse a
  keyword), records a number at each step. The Statistics tab draws one line per tracked name
  in the existing Charts block, and the Custom counters table shows the last value.
- **Opens up:** the view that IHS, Benders and bound-strengthening users look at first: the
  LB/UB trajectory. `knapsack-bounds` logs its bounds as text today.
- **Cost:** a `T` event (or a field on the existing counter event), one chart series in
  `js/stats.js`, and a row in the recording format. There is no change to the runtime's control flow.

### B4 (optional, last). Checks during the search: G5 as designed

- **The change.** `on partial M every n:` inside `search`, as specified in `generality.md` G5
  and verified there in the engine (`check_mode = Fixpoint`). It is off unless written, and
  throttled.
- **Opens up:** branch-and-check and lazy constraint generation. This is the only shape in the
  table that cannot be written today.
- **Cost:** this is the largest item, and the one most exposed to the trap (rule 1 in
  `CLAUDE.md`). A partial candidate's `G(M)` must be built from a partial assignment, and
  `relevant/1` on a partial candidate needs a rule for unassigned atoms (treat them as not
  assumed). Do it only if a library example needs it.

### Not recommended

These are additions the survey asked for that would add a second way of doing something the
language already does.

- **A "core mode" on links** (`link G = … on unsat core`). It duplicates
  `if not C.solve(…): reject M with G.core(C)`. It would also make a link's meaning depend on a
  flag, where today it is fixed by the script.
- **A loop-as-oracle declaration.** `def` already does this with the right scoping. Inner
  lemmas are kept, because `S[i].add` persists. For RAReQS-style forgetting, solve a fresh
  family member.
- **A separate optimal-abstraction construct with automatic LB/UB stopping.** `A.solve(optimal)`
  together with `M.cost` and a two-line `if` is clearer. B3 makes it visible.
- **Interpolation or predicate abstraction.** clingo produces no proofs. Omission-style
  refinement is covered by the activation-atom idiom, which the manual should show once (see
  below).

## Discoverability: the cheapest win

The survey's misreading is itself evidence. A reader who knows the literature by algorithm name
cannot see from the README or the library that MaxHS, MARCO, RAReQS or CAQE can be written. Four
changes, none of which adds to the language:

1. **A manual section, "Loops from the literature".** A table with columns algorithm →
   CegarPlay shape → library example → the lines that matter. It would cover CEGAR for
   circumscription, AReQS/CEGIS, MaxHS, MARCO, OLL (after B2), RAReQS, CAQE, LBBD with
   optimality cuts, 2-ASP(Q) with weak constraints, and omission abstraction. The README links
   to it.
2. **Library examples** for the shapes without one, each `fast`, with a brute-force or
   direct-clingo count:
   - `maxsat-ihs` (prototype A, after B1);
   - `marco` (prototype B, runs now);
   - `maxsat-oll` (after B2);
   - `omission` (an activation-atom refinement);
   - a small `benders-scheduling` with optimality cuts.

   Each gets a tag naming the algorithm (`ihs`, `marco`, `rareqs`, `cegis`, `benders`), and the
   existing Library filter matches tags.
3. **Library tags on existing examples:** `qbf-deep` → `rareqs`; `qbf-three-blocks` → `caqe`;
   `qbf-expansion` → `areqs`/`cegis`; `knapsack-bounds` → `benders`; `smallest-mus` → `ihs`
   (dual form); `reasons-by-shrinking` → `marco` (shrink half).
4. **A guide page** is optional. The guide's chapter on cores and optimisation can point to the
   literature table instead of growing.

## Order of work and effort

| Step | Contains | Done when |
| --- | --- | --- |
| 1 | B1 and the `for` guard | Prototype A with disjoint cores gives cost 2; `for x in M` is an error with a line number; all library counts unchanged |
| 2 | `marco`, `maxsat-ihs` examples; manual table; tags | Both examples `fast`, counts checked against a direct clingo `#minimize` (MaxSAT) and brute force (MUS/MSS); manual links resolve (`test/markdown.test.mjs`) |
| 3 | B3 | `knapsack-bounds` draws two lines that meet at 25; recordings replay with the new event |
| 4 | B2, `maxsat-oll` | OLL and IHS give the same optimum on 50 random small instances |
| 5 | B4 (only if wanted) | A branch-and-check example with fewer full checks than its Shape 1 version and the same count |

Steps 1 to 3 together are about one session of work. They add one statement (`track`) and no
new concepts.

## Sources and what was run

- The survey (chat artifact, pasted into this session). Its literature references are not
  repeated here.
- `manual.md`, sections Loop language, Values, Inner and optimal searches, Procedures and solver
  families, Refinement variants, Chains; `docs/directions/generality.md`; `PROGRESS.md` (G5 not
  built).
- Prototypes, run with `node tools/run.mjs <file>` on `8e92149`: MaxHS without the inner loop
  (cost 2, 2 candidates), MaxHS with `for a in C.core` (endless, 150,916 clauses in 5 s), the same
  with `Core` indexable (patched in place, then reverted: cost 2, bounds logged), and MARCO
  (2 MUSes, 5 MSSes, exhausted).
- Not run: the Python checker (no Python clingo in this container) and the test suite (no code
  changed).
