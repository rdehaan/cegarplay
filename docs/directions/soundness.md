# Implementing checked soundness

Five phases, S1 to S5. S1 needs no theory and comes first; S2 holds both level 2 and level 3, because level 2 alone certifies too little. Row numbers refer to "Numbers the implementation must reproduce" in the Implementation tab.

## Phase S1: Audit

The audit enumerates every candidate and every counterexample of one instance, and reports each pair whose refinement would remove a solution. It is the `audit` mode of the assembled program, and the verdict that Fuzz (I4) and the fate map (V4) consume.

**Read first:** `spike2/audit-loop.lua`, `spike2/sweep.mjs`, `lua/runtime.lua` (`Solver:models`, `snapshot`, `Link:of`, `Link:clause`), `js/driver.js` (`assemble`), `tools/run.mjs`, `test/library.test.mjs`.

**Verified (spikes 6 and 8, and a second audit prototype written for this revision):**

- Rows 14 to 20. The two prototypes were written independently and agree on every count they share.
- The library sweep: every shipped clause-based example is sound for every pair, except the two that teach unsoundness.
- The witness with the fewest differing atoms names the missing atom. For `tutorial-weak-relevant` it is candidate {2, 4}, counterexample `sum(2,2)`, relevant {`pick(4)`}, lost solution {4}: they differ only on `pick(2)`.
- For `guide-04-one-node` it is candidate {4, 8}, relevant {`del(3)`}, lost solution {1, 4, 8}: they differ only on `del(1)`.
- Solutions are counted per interface assignment. `subset-sum-game` has 8 of them and 11 shown models.
- The audit's candidate and solution vectors are enough for the fate numbers. In the shipped run of `tutorial-weak-relevant`, step 6 is the first unsound one: the clause "`pick(2)` must be false" removes 128 candidates, 13 of them solutions.

**Not verified:** the audit of rule refinements (task 4), and memory above 100,000 candidates. Row 19 has 102,508 candidates and took 54 s.

**Tasks:**

1. `lua/audit.lua`: `rt.audit{ link = G, limit = N }`. Candidates are `A:models{}`, one per interface assignment. Above N (default 200,000) the run ends with outcome `limit`.
2. `lua/audit.lua`: per candidate, `C:models{ assume = G:of(M) }`, reduced to distinct relevant sets in Lua. Spike 1 found no projection call in the backend, so clingo cannot do this reduction.
3. `lua/audit.lua`: a candidate without a counterexample is a solution. A pair is unsound when a solution agrees with its candidate on every relevant atom. Vectors are packed 62 atoms to a Lua integer, so one agreement test is a few mask operations.
4. `lua/audit.lua`: for scripts that refine with `expand`, ground `refine(1)` with the counterexample's facts on a scratch control of A's fragments. A solution is at risk when the scratch control is unsatisfiable under its interface values.
5. `lua/audit.lua`: the `A` event. Progress every 0.25 s as `{phase, candidates, pairs, unsound}`. The verdict as `{candidates, solutions, counterexamples, pairs, unsound, at_risk, empty, witness}`, where `witness` holds candidate, counterexample, relevant set, lost solution and the differing atoms.
6. `js/driver.js`: `assemble(..., { mode: 'audit', link })` writes the declarations from `compiled.solvers` and `compiled.links`, then `rt.audit{}`. With several links leaving the top solver, `link` is required.
7. `tools/audit.mjs <project | id> [--instance id] [--link G] [--limit N] [--json]`. Exit code 0 for sound, 1 for unsound, 2 for bad usage, 3 for limit.
8. `js/control.js`, `js/output.js`, `js/stats.js`: an Audit button beside Run, a verdict panel with the witness, and an audit column in the run history.
9. `test/audit.test.mjs`: rows 14 to 18 and 20, the exit codes, and the sweep over every `fast` clause-based example.
10. `manual.md` and `docs/spec-soundness.md` section 1: the audit, the `A` event, and a sixth step in the agent workflow.

**Done when:**

- Rows 14 to 18 and 20 pass in `test/audit.test.mjs`; row 19 passes under `SLOW=1`.
- The sweep reports exactly two unsound examples, `tutorial-weak-relevant` and `guide-04-one-node`.
- For both, `witness.differ` has one atom: `pick(2)` and `del(1)`.
- `node tools/audit.mjs tutorial-weak-relevant` exits with 1 and `node tools/audit.mjs tutorial-first-run` with 0.
- `gc-shape3` audits as sound through task 4.

**Checkpoint S1.**

## Phase S2: Capture, level 2 and level 3

One store holds the ground program of each solver. Two certificates read it: the three-valued evaluation (level 2) and the product query (level 3). Each refinement of a run gets the cheapest level that succeeds, reported as a `K` event.

**Read first:** `spike2/lift.lua`, `spike2/lift-loop.lua`, `spike2/product-loop.lua`, `lua/runtime.lua` (`rt.link`, `snapshot`), and `lift/lift.lua` in the prototype archive of this revision.

**Verified:**

- Every rule and weight rule reaches the observer during `ground`, with atom ids equal to the `symbolic_atoms` literals (spike 2).
- Rows 21, 22 and 24.
- Level 2 as a well-founded model, on 27 library examples: a loop that refines only with lifted sets reproduces the audited solution set in all 27.
- Level 2 certifies every hand-written refinement in 21 of the 25 sound examples among them. It fails on `belief-update` (15 of 66), `integer-expressions`, `subset-sum-game` and `strong-nash`, and on `graph-coloring` (spike 4).
- It certifies no refinement of the two unsound examples.
- A coarser certificate, a reachability cone that ignores support, is sound but certified the hand-written sets of only 8 of 23 examples. It is not worth shipping.
- Level 3 certifies 1,190 of 1,190 refinements of `graph-coloring` at n = 5, at about 0.1 ms a query (spike 5).
- None of the 27 checks is disjunctive.

**Not verified:** level 3 on the four examples where level 2 fails; stores above 100,000 ground rules; negative weights in weight rules, which the evaluator must refuse.

**The level-2 criterion.** Let P be the ground program of the check, X a counterexample under the candidate M, and R the interface atoms to keep.

1. Fix the guesses of X: a choice rule keeps a head atom as a normal rule when the atom is true in X, and loses it otherwise. Call the result P\[X\].
2. Give the atoms of R their values in M and leave the other interface atoms undefined.
3. Compute the well-founded model of P\[X\] by the alternating fixpoint. K is the set of atoms that are true in it, and PT the set of atoms that are not false.
4. The refinement is certified when (a) no constraint has a body that can be true under (K, PT), and (b) the rules whose head lies in PT but not in K, and whose body can be true, are stratified.

**Why it is sound.** Take any candidate M' that agrees with M on R.

1. An answer set of P\[X\] under M' is an answer set of P under M', because a fixed guess is a legal choice.
2. The well-founded model only grows when undefined inputs get values, and every answer set extends it. So K stays true and the complement of PT stays false under M'.
3. Simplifying P\[X\] by K and PT preserves its answer sets. What is left defines the atoms of PT outside K. By (b) it is stratified, so it has exactly one answer set Z.
4. By (a) no constraint body can be true. So K together with Z is an answer set of P under M': the candidate M' has a counterexample.

Weight rules with positive weights are monotone in their positive literals, so the least-model steps stay valid. Steps 2 and 3 rest on standard properties of the well-founded semantics, cited from memory; `docs/spec-soundness.md` must carry the full proof.

**The level-3 query** follows spike 5. A program Q holds a copy of A's rules and a copy of C's rules, with each interface atom of C identified with its source atom in A. Each guess of C is switched by a `sel` atom, and each constraint of C derives `violated`. Under the assumptions "R as in M", "`sel` as in X" and `violated`, an unsatisfiable Q certifies the refinement: no candidate that A allows escapes X.

**Tasks:**

1. `lua/ground.lua`: `LIFT.capture(S)` registers the observer before anything is added to S. The store has rules by head atom, constraints, occurrences by body atom, and the flags `disjunctive` and `stratified`. Every callback body runs in `pcall`.
2. `lua/runtime.lua`: when capture is on, `snapshot` also records the truth of every store atom, bit-packed. This is the one runtime change, and it is skipped when capture is off.
3. `lua/ground.lua`: `LIFT.level2(store, link, M, X, keep)` with one counter per rule, so that a pass is linear and dropping one atom reuses the previous pass. The naive prototype needed 0.12 s per refinement at 1,159 ground rules.
4. `lua/ground.lua`: `LIFT.product(A, C, link)` builds Q once after `rt.prepare()`, and `LIFT.level3(M, X, keep)` is one solve. It answers "outside the certified class" when C is not stratified once its guesses are fixed.
5. `lua/ground.lua`: `LIFT.certify(link, M, X, clause)` tries level 2, then level 3, and emits the `K` event `{step, level, verdict, kept}`. Level 0 is a block and level 1 a core; both are recorded without a check.
6. `js/driver.js`: `SETTINGS.certify` is `off` or `report`. With `off` the module is not appended and the assembled program is unchanged.
7. `js/stats.js`: a Certificates row in the summary: refinements per level and the number left uncertified.
8. `test/ground.test.mjs`: rows 21, 22 and 24; the store equals the text of `clingo --mode=gringo` for three examples; and the safety property below.
9. `docs/spec-soundness.md` sections 2 and 3: the store, both criteria, and the proof.

**Done when:**

- Rows 21, 22 and 24 pass.
- Safety: over the audited `fast` library, no pair that the audit calls unsound is certified at level 2 or 3.
- With `certify` off, `assemble` returns the same text as before the phase.
- On `fewest-clues`, level 2 takes under 10 ms per refinement.

**Checkpoint S2.**

## Phase S3: `lift` links

With `lift` on a link, `G.clause(M, X)` returns a certified clause computed from the ground programs, and the check needs no `relevant/1` rules.

**Read first:** `js/compiler.js` (`LINK_MEMBERS`, the link keywords), `lua/runtime.lua` (`Link:clause`, `new_clause`), `spike2/lift-loop.lua`, `lua/ground.lua` from S2.

**Verified:**

- Rows 23 and 25. Lifting in place of the weak rules gives 61 solutions on `tutorial-weak-relevant` and 3 on `guide-04-one-node`.
- Deletion from a certified set never made a clause longer. Level-2 lifting gave 2.50 literals against 2.88 hand-written on `qbf`, 4.29 against 4.88 on `hedonic-core`, 8.14 against 8.86 on `stable-models`, and the same length on the other certified examples.
- On `qbf-optimal`, which minimises its relevant set with `#minimize`, lifting matches the 2.50.
- Shorter is not better by itself. Minimising from the full interface gave 7.2 literals but 1,931 refinements on `graph-coloring`, against 13.0 literals and 1,190 refinements hand-written. Minimising inside the hand-written set gave 6.9 literals and 838 refinements.
- Where level 2 fails, a level-2 lift degenerates into a block: 100 literals against 1 on `integer-expressions`, 56 against 1 on `subset-sum-game`.

**Not verified:** the best order in which to drop atoms, and the cost of one product query per atom inside a Shape 1 search.

**Tasks:**

1. `js/compiler.js`: the link keyword `lift`, the member `G.lift(M, X)`, and the static error `'lift' and 'compat' cannot be combined`.
2. `lua/runtime.lua`: `rt.link` with `opts.lift` turns capture on for both ends. `Link:clause` then calls `Link:lift`.
3. `lua/ground.lua`: `Link:lift(M, X)` picks its start set. If `relevant/1` derives atoms and that set is certified, deletion starts inside it; otherwise it starts from the full interface.
4. `lua/ground.lua`: deletion uses level 2 while it succeeds and level 3 for the atoms that level 2 cannot drop. Atoms are tried in order of rising blame count.
5. `lua/ground.lua`: an uncertifiable counterexample falls back to `G.block(M)`, with a `K` event at level 0 and the counter `lift fallbacks`.
6. `js/stats.js`: the coach. Per interface predicate it shows atoms marked by hand, atoms kept by lifting, and the refinements whose hand-written set was not certified.
7. `test/lift.test.mjs`: rows 23 and 25, and every `fast` clause-based example with its `relevant/1` rules deleted and `lift` on its link.
8. `manual.md`: the keyword, `G.lift`, and a row in "Refinement variants". `guide/04-soundness.html` gets a box that points to it.

**Done when:**

- Rows 23 and 25 pass.
- Each of the 27 examples of the S2 list reaches its audited solution count with `relevant/1` deleted.
- On `graph-coloring` at n = 5, `lift` needs fewer refinements than the hand-written rules.
- No run reports a lift fallback on an example whose check is stratified.

**Checkpoint S3.**

## Phase S4: Rule refinements and the exact level

Level 3 is extended from clauses to the rules that `expand` grounds, and level 4 answers the cases that no cheaper level settles.

**Read first:** `lua/runtime.lua` (`Solver:expand`), `lua/ground.lua`, the loops of `gc-shape3`, `gc-shape4`, `qbf-expansion` and `conformant-planning`.

**Verified:** the product for clause refinements (spike 5), and that the backend can add atoms and rules to a control after grounding (a spike of this revision).

**Not verified:** that the observer also delivers the rules of a part grounded after the first solve, and the size of a product that grows with every expansion.

**Tasks:**

1. `lua/ground.lua`: the store tags each rule with the expansion step that grounded it. Step 0 is the base program.
2. `lua/ground.lua`: `LIFT.level3_rules(k, X)`. The query asks for a model of A's rules of steps below k that violates a constraint of step k, and against which X's guesses do not violate the check. Unsatisfiable means certified.
3. `lua/ground.lua`: the product is extended in place when A expands, through the backend, so it is never rebuilt.
4. `lua/ground.lua`: `LIFT.exact(link, M, keep, budget)` is level 4. On scratch copies it searches for a candidate that agrees with M on the kept atoms and has no counterexample, blocking as the reference run does. It returns a lost solution, `none`, or `budget`.
5. `js/driver.js`: `SETTINGS.certify = "exact"` runs level 4 on every refinement that levels 2 and 3 leave open, with `SETTINGS.exact_seconds` per refinement.
6. `test/ground.test.mjs`: every expansion of `gc-shape3` and `qbf-expansion` is certified; level 4 finds the lost solution for the first refinement of `tutorial-weak-relevant`.

**Done when:**

- The expansions of `gc-shape3`, `gc-shape4` and `qbf-expansion` are certified at level 3.
- Level 4 returns the lost solution {4} for the audit witness of `tutorial-weak-relevant`.
- Level 4 certifies the refinements of `subset-sum-game` and `integer-expressions`, or reports `budget`; it never certifies a pair the audit calls unsound.

**Checkpoint S4.**

## Phase S5: Certified counts

A run writes a proof log, and a checker that shares no code with the runtime confirms the solution count from it.

**Read first:** `tools/cegarcheck.py` (`Checker`, the link semantics), `js/recording.js` (V1), `lua/ground.lua`, `js/stats.js` (`hashText`, the run history).

**Verified:** the three statements the checker needs are single solver calls, and each was run by hand in the spikes: a counterexample is an answer set under its candidate, a solution has none, and the abstraction with all refinements and blocks is unsatisfiable.

**Not verified:** the size of a log with full counterexamples. Spike 7 measured 27.5 MB of text for 21,078 steps without them, so the log must use the compact `R` event.

**Tasks:**

1. `lua/runtime.lua`: the field `proof` in the `settings.record` object of V1. With it, each `R` event also carries `x`, the counterexample as hex over the check's store atoms, and `v`, its certificate level.
2. `js/recording.js`: the log is the `I` events, the `R` events, the `M` events, and a header with the hashes of fragments, constants and instance.
3. `tools/run.mjs`: `--proof out.jsonl`, and the same from the Output tab as a download.
4. `tools/certcheck.py`: check 1, every counterexample is an answer set of the check under its candidate.
5. `tools/certcheck.py`: check 2, every certificate verifies at its level, with the checker's own level-2 evaluator and its own product. A level-0 clause must be a full block.
6. `tools/certcheck.py`: check 3, no solution has a counterexample.
7. `tools/certcheck.py`: check 4, the abstraction with every refinement and the block of every solution is unsatisfiable.
8. `js/stats.js`: a "certified" mark in the run history for a run whose log passed, set by importing the checker's verdict file.
9. `test/certcheck.test.mjs` and `docs/spec-soundness.md` section 5: the log format and the four checks.

**Done when:**

- The checker accepts the logs of `tutorial-first-run`, `qbf` and `graph-coloring` at n = 5.
- It rejects each of three mutations: one literal removed from a clause, one solution removed, one certificate level raised.
- It rejects the log of `tutorial-weak-relevant` at check 2.
- A proof log of row 27's run stays under twice the size of its plain recording.

**Checkpoint S5.**

## What this tab changes in the first tab

- The cost of level 2 is one fixpoint per check and one check per dropped atom, not "one linear pass".
- Level 3 is built in S2, not S4. S4 keeps the rule refinements and the exact level.
- The audit's diagnosis is the set of atoms on which candidate and lost solution differ. It needs no ground program.
