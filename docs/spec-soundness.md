# Soundness specification

What CegarPlay checks about refinements, beyond comparing solution counts (design:
`docs/directions/soundness.md`). Sections 4 and 5 follow in phases S4 and S5 of PLAN2.md.

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

P events (with `vectors = true`, used by tests and by the candidate map of V4): `{ set, link, from,
v }`, `set` = `candidates` or `solutions`, `v` = up to 1,024 hex vectors in the `R` event's encoding
(`docs/spec-recording.md`), `from` = the 1-based index of the first.

## 2. Capture and certificates

`settings.certify` = `off` (default) or `report`. With `report`, `assemble` adds the line
`SETTINGS.certify = "report"` and the module `lua/ground.lua` (`modulesFor` in the driver); with
`off` the program text is unchanged.

**Capture.** `rt.solver` calls `rt.on_solver(s)`, which registers a ground-program observer on the
new control before anything is added to it. Every `rule` and `weight_rule` callback (inside
`pcall`) appends to `s.store.rules` `{ choice, head, body, w, lower }`; the store also keeps
`maxatom` and the flags `disjunctive`, `negweight` and `error`. Atom ids are the program literals
of `symbolic_atoms` (the link's backend atoms included). A snapshot of a model of a solver with
incoming links gets `M.tv[a]` for every store atom.

**Which refinements.** The runtime calls `rt.certify(s, c)` for every clause it adds (`reject` and
`S.add`). The values a clause fixes are read from the clause alone: the candidates it removes are
exactly those that falsify every literal, so atom j of the link has the value opposite to its
literal's sign. A block (no counterexample, a model, all atoms) is level 0; a core (no model, no
counterexample) is level 1; a clause with a counterexample X (`G.clause`, `G.clauses`) tries level 2,
then level 3. The result is a `K` event `{ c, i, l, level, verdict, reason }` (`c` clause number,
`i` the R step when recording, `verdict` `certified`, `none` or `outside`), and the final `S`
event gets `certificates = { l0, l1, l2, l3, none, outside, t2, t3 }`.

### Level 2: the well-founded certificate

Let P be the check's ground program, X a counterexample under candidate M, and R the link's atoms
the clause keeps (with their values in M).

1. P[X]: a choice rule keeps a head atom that is true in X, as a normal rule, and loses one that is
   false; the link's interface atoms are never heads (they are inputs).
2. The atoms of R get their values; the link's other interface atoms are undefined.
3. The well-founded model of P[X] by the alternating fixpoint: `K` = the least model of the reduct
   by PT (starting from R's true atoms), `PT` = the least model of the reduct by K (starting from R's
   true atoms and the undefined atoms), repeated until both are stable. Each least model is one
   pass with a counter per rule (positive body literals not yet derived; for a weight rule the sum
   of the weights reached), so a pass is linear in the size of P.
4. Certified when (a) no constraint body can hold with positive literals in PT and negative
   literals outside K, and (b) the rules whose head is in PT but not in K and whose body can hold
   have no negative edge on a cycle among such atoms.

Refused: disjunctive programs, negative weights.

**Why it is sound.** Take any candidate M' that agrees with M on R.

1. An answer set of P[X] under M' is an answer set of P under M': a fixed guess is a legal choice.
2. The well-founded model is monotone in its inputs: when undefined inputs get values, true atoms
   stay true and false atoms stay false, and every answer set extends the well-founded model. So
   K stays true and the atoms outside PT stay false under M'.
3. Simplifying P[X] by K and the complement of PT preserves its answer sets. What remains defines the
   atoms of PT outside K, and by (b) it is stratified, so it has exactly one answer set Z (the
   perfect model).
4. By (a) no constraint body can be true in K ∪ Z (its positive part needs atoms of PT, its negative
   part atoms outside K). So K ∪ Z is an answer set of P under M': M' has a counterexample, and the
   clause removes only candidates that are not solutions. Weight rules with positive weights are
   monotone in their positive literals, so steps 2 and 3 hold for them as well.

Steps 2 and 3 rest on standard properties of the well-founded semantics (Van Gelder, Ross and
Schlipf; the alternating fixpoint) and of stratified programs; they are cited, not re-proved here.
The test is sufficient, not necessary: a failure only moves the refinement up the ladder.

## 3. Level 3: the product

Built once per link on first use (`LIFT.product(L)`), through the backend of a fresh control:

- A copy of every rule of the abstraction A (choices, constraints and weight rules as they are).
- A copy of every rule of the check C, with each interface atom of the link identified with A's
  copy of its source atom. A choice rule of C (a guess) becomes, per head atom h that is not an
  interface atom, `h :- body, sel_h` with a free choice atom `sel_h` (a weight body goes through an
  auxiliary atom). Each constraint of C becomes `violated :- body`.
- Built only when C's rules (choices as positive rules, interface atoms not as heads) have no
  negative edge on a cycle; otherwise every refinement of the link is `outside`.

The query: assume R's atoms as in M, `sel_h` as h in X, and `violated`. Unsatisfiable means
certified: no candidate of A (without refinements, so more candidates than the loop sees) that
agrees with M on R makes X's guesses fail a constraint of C. Because C with fixed guesses is
stratified, those guesses determine C's model uniquely, so "no constraint fails" means "X's
guesses are a counterexample for that candidate". Level 3 uses A's constraints, so it certifies
clauses that level 2 cannot (graph colouring, where relevant sets rely on edge symmetry).

Measured: `tutorial-first-run` 46 of 46 at level 2; `tutorial-weak-relevant` none at level 2 or 3;
`graph-coloring` at n = 5 none at level 2 and all (1,320 in Shape 1) at level 3, about 0.05 ms per
query; `fewest-clues` 1.3 ms per level-2 certificate. Over 35+ fast single-link clause examples,
no refinement that removes an audited solution is certified at level 2 or 3
(`test/ground.test.mjs`). `strong-nash` keeps 38 sound refinements uncertified (level 4, S4).

## 4. `lift` links (phase S3)

Compiler: the link keyword `lift` (`{ lift = true }` in `rt.link`), the member `G.lift(M, X)`
(two arguments), the error `'lift' and 'compat' cannot be combined`. `modulesFor(settings,
{ compiled, loop })` adds `lua/ground.lua` when a link has `lift` or the script uses `G.lift`
(raw Lua: `lift = true` in the text). The Link field is `lifting` (`L.lift` is the method).

`LIFT.lift(L, M, X)` (`lua/ground.lua` section 5):

1. Start set: the candidate's values on the `relevant/1` atoms of X when that set is certified
   (`certified` = level 2, else level 3), else on the whole interface; if the whole interface is not
   certified either, fall back.
2. Deletion: atoms in order of rising blame (per link: how often an atom could not be dropped),
   ties by index; `drop(lo, hi)` removes the group, keeps it removed when the smaller set is still
   certified, otherwise splits it in halves; a single atom that cannot go is kept and blamed. Every
   accepted drop is certified on the set as it then is, so the final set is certified.
3. The clause: the kept atoms with the opposite of the candidate's values (`c.lifted` = the highest
   level used). An empty clause means no candidate escapes.
4. Fallback: `G.block(M)`, counter `lift fallbacks`, and (without `certify: report`, which emits its
   own) a `K` event `{ level: 0, verdict: "certified", reason: "lift fallback: ..." }`.

The level-2 heads of a counterexample are cached on X per link. The S event gains
`lift = { clauses, fallbacks, uncertified, kept, hand, preds = { "p/n": { hand, kept } } }`,
shown as the "Lifting coach" in the Statistics tab.

Measured (`test/lift.test.mjs`): row 23 (61 on `tutorial-weak-relevant`, also with `relevant/1`
deleted; 3 on `guide-04-one-node`); row 25 (graph-coloring n = 5: 101 solutions, 1,103 lifted
refinements of 7.38 literals against 1,320 of 13.0 hand-written, about 8 s against 0.1 s);
43 fast clause examples (51 with `SLOW=1`) reach the count of their loop (the audited count for
the unsound ones) with `relevant/1` deleted, without a fallback.

## 5. Rule refinements and the exact level (phase S4)

**Steps.** The store tags each captured rule with the expansion step of its solver (`s.k` at
capture time; 0 = the base program) and remembers the largest atom before each step
(`st.before[k]`).

**Level 3 for rules** (`LIFT.level3_rules(L, k, X)`, called by `Solver:expand` through
`rt.certify_expand(s, k, X)`; X is the model whose atom list gave the facts). The query program:
A's rules of steps below k; the rules of step k with each constraint deriving `removed`; C's rules
as in the clause product (guesses switched by `sel`, constraints and interface-headed rules
deriving `violated`). Assumptions: `removed`, `violated`, and every `sel` as in X. A model is a
candidate that the step removes while X is no counterexample of it; unsatisfiable means
certified. Preconditions (else not certified, with the reason): step k defines only atoms created
in the step (no head at or below `st.before[k]`), its non-constraint rules are stratified, the
check is stratified, nothing is disjunctive. Then a candidate (an answer set of the earlier steps)
has exactly one extension by the step's rules, and it is removed exactly when a constraint of the
step fires in it; choices in the step only let the query find more escapes. A K event
`{ e: k, solver, l, level: 3 | null, verdict, reason }` reports each expansion; the S event's
`certificates` gain `expansions` and `expansions_certified`.

**Level 4** (`LIFT.exact(L, M, vals, budget)`, with `settings.certify = "exact"` for every clause
that levels 2 and 3 leave open, `settings.exact_seconds` per clause, default 2): on scratch
controls of A's and C's fragments (C with the interface atoms as free choices), search a
candidate that agrees with the clause's removed values and has no counterexample; candidates
with a counterexample are blocked by clauses guarded with a fresh choice atom per query. Returns
`lost` with the solution (K verdict `unsound`, reason `lost solution {...}`), `none` (level 4,
certified) or `budget`.

Measured: every expansion of `gc-shape3` (121), `gc-shape4` (226), `qbf-expansion` (5) and
`conformant-planning` (8) is certified at level 3; a refine part with an extra
`:- cex(k,color(1,C)).` is not. Level 4 returns `{pick(4)}` for the audit witness of
`tutorial-weak-relevant` (candidate {2, 4}, relevant set {pick(4)}) and names 6 unsound
refinements in its run; `subset-sum-game` and `integer-expressions` are certified at level 3
already (levels 2 fails there, level 3 holds), so level 4 has nothing left to do.

Deviation from the design: the product is not extended in place; the clause product is rebuilt
when either store grows (wave-2 review fix) and the rule query builds its own program per
expansion (gc-shape4: 226 queries, 1.2 s for the run).
