# CegarPlay: generality check and a third-level example

Nov 21, 2026 · @Ronald

## Verdict

No: the loop language is complete for one family of loops and incomplete outside it. Of 18 loop families I checked, 7 are native, 4 work through an idiom, 2 need raw Lua, and 5 cannot be written in the loop language at all.

This time I had the repository (commit `e287c65`). I read the runtime, the compiler, the specifications and every library loop, and ran everything with the real engine through `tools/run.mjs`.

Four findings:

- **More works than the documentation says.** Three-level loops run today. I tested two of them against brute force: 620 runs, no mismatch.
- **The limits are structural.** A script can express a loop only if the five conditions below hold.
- **One defect turned up.** With two outgoing links and a restart, the automatic blocking loses solutions: 6 of 16 are reported, with `exhausted: true`. A six-line fix is tested.
- **The engine is not the obstacle.** Observers, checks at fixpoints, nested searches, externals and growing programs all work in the vendored build.

The five conditions a loop must meet today:

1. Solvers and links are fixed before the run starts.
2. Every refinement is permanent.
3. At most one search runs at a time, and it checks total assignments only.
4. A refinement goes to the source solver of the link that produced it.
5. The script reads nothing from a model except whether it exists and lists of atoms it cannot look into.

Each condition excludes loops that are known to be efficient. The next section says which.

## Coverage: 18 loop families against the language

Seven families are native, and eleven are not. "Idiom" means the loop runs, but only through a trick a newcomer would not find. "No" rows quote the error the compiler or runtime gave me.

| Loop family | Today | Evidence |
| --- | --- | --- |
| Clause learning for exists-forall problems | Native | `qbf`, Shape 1 |
| Expansion and CEGIS: ground the check once per counterexample | Native | `qbf-expansion`, `conformant-planning`, Shapes 3 and 4 |
| Core-guided refinement after a failed witness check | Native | `lang-core` |
| Lazy constraints and feasibility cuts written in ASP | Native | `lang-clauses`, `G.clauses` |
| Staged checks | Native | `lang-two-stage`, `abduction-two-checks` |
| Refinement computed by a separate solver | Native | `lang-second-solver`, `qbf-blame-solver` |
| Smallest-first optimisation by re-solving with `optimal` | Native | `guide-11-fewest-deletions`, `knapsack-optimum` |
| Three-level nested loops | Idiom | Chained links; the inner loop re-solves; cores need a redundant link. Tested here |
| "No candidate can be a solution" | Idiom | The `always` atom in `qbf`; an empty clause is an error |
| Minimal-set loops that block all supersets or subsets | Idiom | A helper solver writes `clause/3` in `reasons-by-size` |
| Optimisation inside one search | Idiom | Runs, but improving models are listed as solutions, and `--opt-mode=optN` lists the optimum twice. Tested here |
| Shrinking a core or a candidate by dropping assumptions | Raw Lua | `reasons-by-shrinking` |
| Bound tightening that reads numbers from models | Raw Lua | `knapsack-bounds` |
| Recursive loops for any quantifier depth, as in RAReQS | No | No procedures; `declarations must come before the first statement` |
| An inner search, or a search under assumptions | No | `'search' cannot be nested inside 'on candidate'` |
| Checks on partial candidates | No | The `check` hook returns unless the assignment is total |
| Retractable lemmas, frames, growing horizons | No | No externals and no activation atoms; a link's atoms are fixed at declaration |
| Lemmas for a solver that is not the link's source | No | `B.add: the clause belongs to solver A` |

Two things stay out of reach whatever the language does. Interpolation-based refinement needs proofs, which clingo does not produce. Parallel checks are blocked by the engine, which serialises Lua callbacks.

The "No" rows are about the loop language. Raw Lua reaches recursion and solver families with the runtime intact, and externals through a solver's `ctl`. An inner search or a partial check needs a propagator of its own, outside the runtime's statistics, trace and trap guards.

### The defect

After each solution of a search, the runtime queues a blocking clause for later searches of the same solver. `docs/spec-runtime.md` asks for one clause over all outgoing links. The code in `Solver:search` queues one clause per link, so a later solution must differ on every link.

- **Test.** A solver with free atoms `p(1..2)` and `q(1..2)`, one link per predicate, and a restart every third candidate.
- **Result.** 6 solutions instead of 16, reported as exhausted. With one link over all four atoms the count is 16.
- **Reach.** No shipped example is hit: every two-link source in the library uses the same glue for both links.
- **Fix.** Join the literals of all outgoing links into one clause. With the patch the test gives 16, and the repository's runtime, refinement and library tests give the same results as before.

## Plan: eight additions and one fix

Eight additions to the loop language close all eleven gaps, and each rests on an engine feature I ran in the vendored build. Existing scripts keep their meaning: no library script uses a proposed keyword as a variable.

|  | Addition | Closes | Engine basis, as tested |
| --- | --- | --- | --- |
| G1 | Clauses as sets of signed atoms | Lemmas for any solver, cores along a chain, superset blocks, the empty refinement | Links already match atoms by name |
| G2 | Assumption lists and named atoms as values | Shrinking, activation atoms | `solve` takes any list of literals |
| G3 | Reading models | Bound tightening | Captured atoms are clingo symbols |
| G4 | Inner searches, searches under assumptions | Inner loops that re-solve | A search with its own propagator ran inside another solver's `check`: 8 outer, 32 inner candidates |
| G5 | Checks on partial candidates | Early pruning | `check_mode = Fixpoint` gave 21 partial and 21 total calls |
| G6 | Retractable refinements, growing programs | Frames, growing horizons | Externals, release, and backend atoms added after grounding all worked |
| G7 | Procedures and solver families | Any quantifier depth | Four solvers and three links built in a Lua loop, driven by a recursive function |
| G8 | Optimisation as an outcome of a search | Improving models listed as solutions | `m.optimality_proven` separated 4 optimal models from 5 seen |

### G0. Fix the blocking clause

Apply the patch from the defect section, and add its two-link restart case to `test/runtime.test.mjs`. Document chained links in the manual, since they already work.

Phase 0 now exists as one patch, `cegarplay-phase0.patch`. It holds the fix, a regression test for the two-link restart case, a manual section "Chains of solvers", and both examples in `examples/contrib/` with the rebuilt library. The test reports 6 solutions without the fix and 16 with it.

### G1. Clauses as sets of signed atoms

Today a clause is a list of literals of one solver, so it can only go back to the source of its link. Make a clause a set of signed interface atoms, and translate it when it is added.

```loop
reject M with C.core.on(GX)            # the x-part of a core, without an extra link
B.add(GXY.clause(Y, W))                # unchanged
A.add(G.above(M))                      # removes M and all its supersets
A.add(G.clause(X))                     # a lemma from a counterexample alone
c = GF.clause(M, Y) + C.core.on(GF)    # two reasons joined into one clause
```

- `S.add(c)` and `reject M with c` accept any clause whose atoms S knows through one of its links. An unknown atom is an error that names it.
- `C.core` is the whole core of the last solve of C. `c.on(G)` keeps the atoms of link G. `G.core(C)` stays as shorthand for `C.core.on(G)`.
- `G.above(M)` and `G.below(M)` replace the helper solver of `reasons-by-size`.
- `G.clause(X)` uses the interface values in X itself. It needs the snapshot of a target model to keep those values, which it drops today.
- An empty clause is legal. Rejecting with it ends the search, and adding it makes the solver unsatisfiable. This retires the `always` atom.

### G2. Assumption lists and named atoms as values

`G(M)` is already a list. Let scripts walk and edit it, and let them name an atom.

```loop
E = G(M)                                   # M passed the check: shrink it
for a in E:
    if a.true and not C.solve(assume E.flip(a)): E = E.flip(a)
A.add(G.above(E))

A.solve(assume A.atom("bound", n))         # a named atom as an assumption
```

- `E.flip(a)` and `E.without(a)` return new lists. `a.true` tells the sign.
- `S.atom(name, args…)` looks the atom up in S and fails with a clear message when it does not exist.
- `C.solve(assume E, core minimal)` runs the same deletion loop inside the runtime.

With G1 and G2, `reasons-by-shrinking` becomes a loop script of about ten lines.

### G3. Reading models

```loop
lower = M.value(value/1)                   # the argument of the one true atom value(N)
reply = X.value(gain/1)
if reply < upper: upper = reply
```

Add `X.value(p/1)`, `X.count(p/n)`, `X.cost` and `a.arg(i)`. That is all `knapsack-bounds` needs from Lua.

### G4. Inner searches and searches under assumptions

```loop
search A:
    on candidate M:
        search B assume GX(M) keep Y:
            on candidate Y:
                W = C.solve(assume GXY(Y))
                if W: reject Y with GXY.clause(Y, W)
        if Y: reject M with C.core.on(GX)
```

- `keep Y` ends the inner search at the first candidate that is not rejected and stores a snapshot of it. Y is `none` when B is exhausted.
- `rt.searching` becomes a stack. `reject` already names its candidate, so the static check only widens to enclosing searches.
- Clauses rejected in an inner search are also queued for B's next `init`, as `S.add` does. Otherwise clasp may drop them between solves.

In a three-level loop the inner solver works hardest, so this is where a kept search pays most.

### G5. Checks on partial candidates

*Built on Nov 23, 2026; see `breadth.md` (G5) and the manual's "Checks on partial candidates".*

```loop
search A:
    on partial M every 32:
        if not C.solve(assume G(M)): reject M with C.core.on(G)
    on candidate M:
        if not C.solve(assume G(M)): reject M with C.core.on(G)
```

- On a partial candidate, `G(M)` lists the assigned atoms only.
- Two refinements are sound there. A core of a witness check refutes every completion. `G.clause(X)` from G1 is a lemma that holds whatever the candidate is.
- `every n` throttles the hook. It is off unless the script asks for it.

### G6. Retractable refinements and growing programs

```loop
A.ground(step, t)                          # grounds #program step(t).
G.extend()                                 # new glue/1 atoms become interface atoms
A.add(c, while A.atom("frame", t))         # c holds only while frame(t) is assumed
A.set(A.atom("frame", t), false)           # an #external atom; A.release(...) frees it
```

This opens growing horizons for planning and bounded model checking, and frame-based loops in the style of property-directed reachability. `S.expand` stays as the special case with an automatic counter.

### G7. Procedures and solver families

```loop
solver S[i in 1..depth] = shared + level       # member i is grounded with -c level=i
link   G[i in 1..depth-1] = S[i] -> S[i+1] via shared + glue

def refute(i, M):                              # a clause that removes M, or none if M stands
    loop:
        Y = S[i].solve(assume G[i-1](M))
        if not Y: return none
        if i == depth: return G[i-1].clause(M, Y)
        c = refute(i + 1, Y)
        if not c: return G[i-1].clause(M, Y) + S[i+1].core.on(G[i-1])
        S[i].add(c)

search S[1]:
    on candidate M:
        c = refute(2, M)
        if c: reject M with c
```

- Each link passes on the atoms its source received, so level i sees every level above it.
- When Y stands, the reason has two parts: what made Y legal (`relevant/1` in level i) and what made the next level fail (its core, restricted to the caller's atoms).
- When Y is beaten, the clause that comes back mentions the outer atoms too. It is therefore valid for every later candidate, and level i keeps it.
- At depth 3 this is exactly the two loops tested in the next section.

**Run, not only argued.** The same recursion runs today as raw Lua on the runtime, in `deep/deep.lua` of the prototype archive. Solver families are built in a Lua loop, and clauses are sets of signed atom names that are translated when added. The test formulas are in conjunctive normal form with 2 to 5 quantifier blocks.

| Depth | Formulas | Non-trivial among them | Mismatches with brute force |
| --- | --- | --- | --- |
| 2 | 30 | 4 | 0 |
| 3 | 40 | 22 | 0 |
| 4 | 65 | 30 | 0 |
| 5 | 45 | 24 | 0 |

A formula is non-trivial when some but not all assignments to its first block are solutions. What remains a design is the loop-language syntax, not the algorithm.

### G8. Optimisation as an outcome of a search

`search A optimal:` reports only models whose optimality clingo has proven, once each. It also carries the bound across the re-solves of Shapes 2 to 4, which `PLAN.md` lists as out of scope.

### Full specification of the additions

This section fixes the grammar, the compiled Lua, the runtime interface, the messages and the tests of the eight additions, in the form the manual uses for the current language.

**Grammar.** Six words become keywords: `def`, `return`, `keep`, `partial`, `every` and `minimal`. The rules below replace or extend the rules of the same name in the manual.

```
decl    := "solver" NAME [ family ] "=" frags [ "options" STRING ] NEWLINE
         | "link" NAME [ family ] "=" member "->" member "via" frags { "legacy" | "compat" } NEWLINE
family  := "[" NAME "in" expr ".." expr "]"
member  := NAME [ "[" expr "]" ]
def     := "def" NAME "(" [ NAME { "," NAME } ] ")" ":" block
stmt    := ...                                  (every form of today)
         | "return" [ expr ] NEWLINE
search  := "search" member [ "assume" expr { "," expr } ] [ "optimal" ] [ "keep" NAME ] ":" NEWLINE
           INDENT { "on" "partial" NAME [ "every" expr ] ":" block }
                  "on" "candidate" NAME ":" block DEDENT
arg     := expr | "assume" expr { "," expr } | "limit" expr | "optimal" | "minimal"
         | "while" expr | NAME "=" expr
post    := atom { "." NAME [ "(" [ args ] ")" ] | "(" [ args ] ")" | "[" expr "]" }
```

- `def` statements stand between the declarations and the first statement.
- A `search` may stand inside `on candidate`, for a solver that is not searching already.
- `c + d` joins two clauses. On numbers it stays addition.

**Compilation.** Each new form is still one Lua statement or expression.

| Script | Lua |
| --- | --- |
| `c + d` | `rt.plus(c, d)`: numbers are added, clauses are joined |
| `c.on(G)` | `c:on(G)` |
| `C.core` | `C:core()` |
| `G.above(M)`, `G.below(M)` | `G:above(M)`, `G:below(M)` |
| `G.clause(X)` | `G:clause(nil, X)` |
| `E.flip(a)`, `E.without(a)`, `a.true` | `rt.flip(E, a)`, `rt.without(E, a)`, `a.value` |
| `S.atom("bound", n)` | `S:atom("bound", n)` |
| `C.solve(assume E, minimal)` | `C:solve{ assume = E, minimal = true }` |
| `X.value(gain/1)`, `X.count(p/2)`, `a.arg(1)` | `X:value("gain", 1)`, `X:count("p", 2)`, `rt.arg(a, 1)` |
| `search B assume E keep Y:` with its block | `local Y = B:search{ assume = E, keep = true, on_candidate = function(Y) … end }` |
| `on partial M every n:` | `on_partial = function(M) … end, every = n` in the same table |
| `search A optimal:` | `A:search{ optimal = true, … }` |
| `A.ground(step, t)`, `G.extend()` | `A:ground_part("step", t)`, `G:extend()` |
| `A.add(c, while a)` | `A:add(c, { guard = a })` |
| `A.set(a, true)`, `A.release(a)` | `A:set(a, true)`, `A:release(a)` |
| `def f(x):` … `return e` | `local function f(x) … return e end` |
| `solver S[i in 1..n] = shared + level` | `local S = {}` and a loop over `S[i] = rt.solver("S" .. i, …, { level = i })` |
| `S[i]`, `G[i-1]` | `S[i]`, `G[i - 1]` |

**Runtime.** The changes to `lua/runtime.lua`, by part.

| Part | Change |
| --- | --- |
| Clause value | A table of atom text to required value. A clause that returns to the source of its own link keeps today's literal array as a fast path |
| `Solver:add`, `Model:reject` | Translate each atom through a map from atom text to program literal, built in `rt.prepare` from all links of the solver. Inside a search the literal goes through `solver_literal` |
| Empty clause | `add` and `reject` mark the solver dead and interrupt its search. A dead solver answers every later solve with no model |
| `snapshot` | For an incoming link it keeps the values of the interface atoms next to the `relevant` flags. `G:clause(nil, X)` reads them |
| `Solver:core` | The whole `last_core`, mapped through the `jof` tables of all incoming links |
| `Solver:search` | Takes `assume`, `keep`, `optimal`, `on_partial` and `every`. `rt.searching` becomes a stack, and a solver cannot be on it twice |
| Inner rejects | A clause rejected in a search that is not the outermost is also appended to the solver's queue, so the next `init` adds it as a static clause |
| Partial candidates | With `on_partial`, `init.check_mode` is `Fixpoint`. The candidate has three values per atom, and `Link:of` lists the assigned ones |
| `optimal` search | The runtime sets `--opt-mode=optN` and reports a model only when `m.optimality_proven` holds |
| `ground_part`, `extend` | Ground a named part with one integer parameter. `extend` grounds the same part in the glue control and adds each new `glue(T)` atom to the target, with its `relevant` atom |
| `guard`, `set`, `release` | A guarded clause gets the negated guard as one more literal. `set` and `release` call `assign_external` and `release_external` |
| `Solver:atom` | Looks the symbol up in `symbolic_atoms` and returns solver, literal and text |
| Model reads | `value`, `count` and `arg` read the symbols that `rt.capture` stores today |
| Statistics | The `S` event gains `links`: per link the models passed on, the clauses and the literals. The counterexamples of an inner and an outer level are then told apart |

**Messages.** New static errors follow the wording of the existing ones; new runtime errors carry the loop line as today.

| Kind | When | Text |
| --- | --- | --- |
| Static | `keep` without a name | `'keep' needs a name, as in: search B assume E keep Y:` |
| Static | `on partial` after `on candidate` | `'on partial' must come before 'on candidate'` |
| Static | `return` outside a `def` | `'return' outside 'def'` |
| Static | `def` after the first statement | `'def' must come before the first statement` |
| Static | `reject` names no enclosing candidate | `'reject' must name the candidate of an enclosing search` |
| Static | An index on a plain solver | `'S' is not a solver family` |
| Static | A family range that is not constant | `the range of a family must be made of numbers and project constants` |
| Runtime | A clause with an atom the solver lacks | `B.add: solver B does not know the atom x(3)` |
| Runtime | A search of a solver that is searching | `search B: solver B is already searching` |
| Runtime | `G.clause(M, X)` on a partial candidate | `G.clause(M, X) needs a total candidate; use G.clause(X) or a core` |
| Runtime | `X.value` finds no atom or several | `X.value(gain/1): expected one true atom, found 0` |
| Runtime | `S.atom` finds nothing | `S.atom: solver S has no atom bound(7)` |
| Runtime | `set` on an atom that is not external | `A.set: frame(3) is not an #external atom of A` |

**Tests.** One acceptance test per addition, each against a count that is known today.

| Addition | Test | Expected |
| --- | --- | --- |
| G1 | `qbf-three-blocks` without its third link, using `C.core.on(GX)` | 4 solutions |
| G1 | `reasons-by-size` without its helper solver, using `G.above` | 13 solutions |
| G2 | `reasons-by-shrinking` as a loop script | 13 solutions |
| G3 | `knapsack-bounds` as a loop script | 2 solutions |
| G4 | `knapsack-fortification` with an inner search of B | 2 solutions, with fewer than the 11 solves of B that the re-solving loop needs |
| G5 | `lang-core` with an `on partial` hook | 136 solutions, with fewer total candidates than today |
| G6 | `conformant-planning` with a growing horizon | The same plans as with the constant set to the shortest length |
| G7 | The 180 formulas of the run above, through one loop script | No mismatch with brute force |
| G8 | `knapsack-interdiction` with `#minimize { 1,I : lock(I) }` and `search A optimal:` | One solution, `lock(3) lock(4)`; a plain search with `--opt-mode=optN` lists it twice |

### Order of work

| Phase | Contains | Done when |
| --- | --- | --- |
| 0 Repair | G0, the two examples from this document | The restart test reports 16 of 16; `knapsack-fortification` and `qbf-three-blocks` pass in `test/library.test.mjs` |
| 1 Values | G1, G2, G3 | `reasons-by-shrinking` and `knapsack-bounds` are loop scripts; `reasons-by-size` has no helper solver; `qbf` has no `always` atom; all counts unchanged |
| 2 Control | G4, G5, G8 | `qbf-three-blocks` uses an inner search and needs fewer solves of B; `knapsack-optimum` as one search lists exactly its 2 optimal sets |
| 3 Dynamics | G6 | `conformant-planning` finds a shortest plan by growing the horizon, with no bound constant |
| 4 Structure | G7 | One script solves the multi-level knapsack at depths 2, 3 and 4 |

Phase 1 comes first because it is the cheapest and retires both raw-Lua examples. After phase 4, one `fast` library example per family turns the coverage table into 18 tests.

Phase 0 is done as a patch; see G0. The work that remains starts at phase 1.

### Risks

- **Speed of G1.** Translating atoms on every `add` costs a table lookup per literal. Keep today's path for a clause that returns to its own solver.
- **Traps in G4.** A Lua error that crosses a clingo frame kills the engine. Each search level needs its own `xpcall`, as the runtime does now.
- **Cost of G5.** A check at every fixpoint can dominate a run. The throttle and the off-by-default rule contain it.
- **Size of G7.** Procedures change scoping in the compiler. They are last for that reason.

## Worked example: knapsack interdiction with fortification

The trilevel knapsack with unit fortification and attack costs is complete for the third level, Σ₃ᵖ, and a 17-line loop script solves it in today's CegarPlay. On the library's eight items it finds both solutions after 7 of 37 candidates.

### The problem

A defender fortifies at most B₃ items. An attacker then removes at most B₂ unfortified items. The defender packs what is left within capacity W, and wins when the profit reaches the goal K.

```latex
\exists F \subseteq I,\ |F| \le B_3 \quad \forall A \subseteq I \setminus F,\ |A| \le B_2 \quad \exists P \subseteq I \setminus A :\quad \sum_{i \in P} w_i \le W \ \text{ and } \ \sum_{i \in P} p_i \ge K
```

[Boggio Tomasaz, Carvalho, Cordone and Hosteins](https://arxiv.org/abs/2406.01756) prove this problem Σ₃ᵖ-complete (their Theorem 2.7), by reduction from exists-forall-exists satisfiability of 3CNF formulas. It adds one level to the library's `knapsack-interdiction`.

### Three solvers in a chain

&#91;embedded content: three solvers in a chain · 2 links, 2 kinds of clause\]

A proposes, B tries to refute A, and C tries to refute B. Each fragment below is a few lines.

```asp
% shared: item(I,Weight,Profit)
item(1,4,9).  item(2,3,7).  item(3,5,12). item(4,2,4).
item(5,6,13). item(6,4,8).  item(7,7,16). item(8,3,5).

% fortify (solver A)
{ fortify(I) : item(I,_,_) } fbudget.
#show fortify/1.

% glue_fortify
glue(fortify(I)) :- item(I,_,_).

% attack (solver B)
{ attack(I) : item(I,_,_) } abudget.
:- attack(I), fortify(I).
relevant(fortify(I)) :- attack(I).     % possible while none of its items is fortified

% glue_attack
glue(attack(I)) :- item(I,_,_).

% pack (solver C)
{ pack(I) : item(I,_,_) }.
:- pack(I), attack(I).
:- #sum { W,I : pack(I), item(I,W,_) } > capacity.
:- #sum { P,I : pack(I), item(I,_,P) } < goal.
relevant(attack(I)) :- pack(I).        % possible while none of its items is attacked
```

```loop
solver A = shared + fortify
solver B = shared + attack
solver C = shared + pack
link   GF = A -> B via shared + glue_fortify
link   GA = B -> C via shared + glue_attack

if not C.solve(): stop "the goal is out of reach even without an attack"

search A:
    on candidate M:
        loop:
            Y = B.solve(assume GF(M))
            if not Y: break                      # no attack left: M is a solution
            K = C.solve(assume GA(Y))
            if K:
                B.add(GA.clause(Y, K))           # the attack fails
            else:
                reject M with GF.clause(M, Y)    # the attack stands
                break
```

The constants are `fbudget = 2`, `abudget = 2`, `capacity = 12` and `goal = 27`.

### Why the loop is sound

- **A packing refutes many attacks.** A packing K found by C does not depend on what is fortified. It answers every attack that misses K, so B keeps "attack one item of K" for all later candidates.
- **An attack refutes many candidates.** An attack Y with no reply beats every fortification that leaves Y untouched. So A learns "fortify one item of Y".
- **No attack left means solved.** When B is unsatisfiable under a candidate, every attack within the budget already has a reply.

Both refinements are hitting-set clauses, one level apart. The first script line guards the one case they miss: if the goal is out of reach with no attack at all, the empty attack would stand and `relevant/1` would derive nothing.

### The run, step by step

| Step | Fortified (A) | Attack (B) | Reply (C) | Learned |
| --- | --- | --- | --- | --- |
| 1 | none | none | 1, 2, 3 | B: attack 1, 2 or 3 |
| 2 | none | 1 | 2, 3, 6 | B: attack 2, 3 or 6 |
| 3 | none | 2 | 3, 7 | B: attack 3 or 7 |
| 4 | none | 3 | 2, 4, 7 | B: attack 2, 4 or 7 |
| 5 | none | 2, 3 | no reply | A: fortify 2 or 3 |
| 6 | 2 | 3, 4 | no reply | A: fortify 3 or 4 |
|  | 2, 3 | no attack left |  | Solution 1 |
| 7 | 3 | 2, 7 | no reply | A: fortify 2 or 7 |
| 8 | 2, 4 | 3, 7 | no reply | A: fortify 3 or 7 |
| 9 | 3, 4 | 2, 7 | no reply | A: fortify 2 or 7 |
|  | 3, 7 | no attack left |  | Solution 2 |

B learned its four clauses under the first candidate and needed no other for the remaining six.

### Measurements

The reference loop blocks one attack or one candidate at a time, which is sound here because a reply never depends on the fortified items.

| Instance | Candidate space | A candidates, clause loop | A candidates, reference | Clauses, clause loop | Solves of B, clause loop |
| --- | --- | --- | --- | --- | --- |
| Library items, budgets 2 and 2 | 37 | 7 | 37 | 9 | 11 |
| Library items, budgets 3 and 3 | 93 | 17 | 93 | 11 | 21 |
| 12 random items, budgets 3 and 3 | 299 | 13 | 299 | 25 | 26 |
| 16 random items, budgets 3 and 3 | 697 | 21 | 697 | 49 | 56 |
| 20 random items, budgets 4 and 4 | 6,196 | 55 | not run | 145 | 149 |

The 20-item run took 0.18 s. In every row B is solved more often than A proposes candidates, which is the cost that G4 removes.

### Tests against brute force

- **Knapsack.** 180 random instances with 5 to 9 items, 60 of them chosen so that some but not all candidates are solutions. Three loop variants each, 540 runs: every solution set equals brute force.
- **Larger instances.** The 12- and 16-item rows above also equal brute force.
- **3QBF.** 80 random exists-forall-exists formulas, 34 of them with some but not all assignments as solutions: no mismatch.

### When the innermost check reads the outer candidate

In the knapsack, C never reads `fortify`, so two links suffice. In 3QBF, C needs the x-atoms, and two tricks make the loop work today.

```loop
link GX  = A -> B via shared + glue_x
link GXY = B -> C via shared + glue_xy     # passes on the x-atoms that B received
link GXC = A -> C via shared + glue_x      # never assumed; only for GXC.core(C)

search A:
    on candidate M:
        loop:
            Y = B.solve(assume GX(M))
            if not Y: break
            W = C.solve(assume GXY(Y))
            if W:
                B.add(GXY.clause(Y, W))          # over x- and y-atoms: valid for every x
            else:
                reject M with GXC.core(C)        # the x-part of the core
                break
```

- **Passing atoms on.** A link's glue may name atoms that its source only received over another link. The clause for B then mentions the x-atoms, which makes it valid for every later candidate.
- **A link only for the core.** `GXC` carries the same atoms as `GX`. Its one use is to state the x-part of C's core as a clause for A.
- **Order matters.** A link's target must not be grounded yet, so upstream links are declared first.

### What the plan changes here

- G1 removes the third link: `reject M with C.core.on(GX)`.
- G4 keeps B's search alive between refinements.
- G7 turns both loops into one script for any depth. The same paper proves the multi-level knapsack complete for every level (Theorem 2.8), so it is the natural test family.

## Sources and what was run

Every statement about current behaviour comes from the repository at commit `e287c65` or from a run with its vendored engine. The eight additions are designs: none is implemented, and only their engine prerequisites were run.

| What | How | Result |
| --- | --- | --- |
| Knapsack loop against brute force | 120 random and 60 non-trivial instances, three loop variants, `tools/run.mjs --solutions all` | 540 runs, no mismatch |
| Larger knapsack instances | 12 and 16 items against brute force; 20 items with the loop only | Equal sets; 0.18 s for 20 items |
| 3QBF loop against brute force | 80 random formulas, 34 of them non-trivial | No mismatch |
| Recursive loop for any depth | Raw Lua on the runtime, formulas with 2 to 5 quantifier blocks against brute force | 180 formulas, no mismatch |
| Limits of the language | Eight probe scripts through the compiler and runtime | The errors quoted in the coverage table |
| Blocking defect | One probe project, before and after the fix | 6 of 16, then 16 of 16 |
| Phase-0 patch | `runtime.test.mjs`, `refine.test.mjs` and `library.test.mjs`, with the reference repository cloned | 142 pass, 1 skipped, none fail; the new test fails without the fix |
| Optimisation inside a search | `knapsack-interdiction` with a `#minimize`, with and without `--opt-mode=optN` | Improving models listed as solutions; the optimum listed twice |
| Engine prerequisites | Six raw-Lua spikes | Observers, fixpoint checks, a nested search, externals and growth, optimality marks, a solver family with recursion: all ran |

Four files belong to this document:

- `cegarplay-phase0.patch`: all of phase 0 as one patch. It replaces the earlier `runtime-block-over-all-links.patch`.
- `knapsack-fortification.json` and `qbf-three-blocks.json`: the two examples as project files. The patch contains them as well.
- `cegarplay-prototypes.zip`: every script behind the numbers here and in the first document, with a README that lists what each one showed.

What is argued here and not run:

- The loop-language form of G1 to G8. The specification in the plan is a design: the compiler and runtime changes are not written. The algorithm of G7 is run, as raw Lua.
- The choice of 18 families. It is my selection of loops from the literature and the library, not a complete taxonomy.
- Soundness in general. The tests show agreement on small instances, which is evidence and not proof.

Sources:

- The [CegarPlay repository](https://github.com/rdehaan/cegarplay): `lua/runtime.lua`, `js/compiler.js`, `docs/spec-runtime.md`, `docs/spec-loop-language.md`, `PLAN.md`, `manual.md` and every file in `examples/`.
- Boggio Tomasaz, Carvalho, Cordone and Hosteins, [On the completeness of several fortification-interdiction games in the polynomial hierarchy](https://arxiv.org/html/2406.01756v2), read in full for the problem definition and Theorems 2.7 and 2.8. The journal version in Mathematics of Operations Research was not opened.
- From memory, not looked up: RAReQS, minimal-set loops with superset and subset blocking, and property-directed reachability.

One by-product for the first document: its open question about ground-program observers is answered. They work in the vendored build, and the callbacks arrived during grounding.
