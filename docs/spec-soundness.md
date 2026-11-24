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

## 6. Proof logs and certified counts (phase S5)

`settings.record.proof = true` (Loop tab: Recording "proof", which also sets every step; `tools/run.mjs
--proof FILE`) loads `lua/ground.lua` and adds to a recording:

- after `I`, one `Q` event per solver with incoming links: `{ solver, atoms }`, the texts of its
  symbolic atoms in clingo's order (the table for `x`);
- on every `R` event of a clause refinement: `x`, the counterexample as hex over the `Q` table of
  its solver (bit j = atom j true in X; same digit order as `c`), when the clause came from a
  counterexample; `v`, the certificate level (0-4) or `null` when no level holds.

The log is the recording as JSON lines: the header (with `fragmentsHash` = `hashText` of the
derived project's `[[name, text], ...]` and constants), then `@@K json` lines (`.cprec` gzip files
are read too).

`tools/certcheck.py <project.json> <log> [--json]` (Python clingo; it uses `cegarcheck.py` for the
script's declarations and the instance, and none of `lua/`) rebuilds A and C with the link's
semantics, records their ground programs with an observer, and checks:

1. every counterexample: C under the candidate's interface values and the `x` values of every
   `Q` atom has a model (so X is an answer set); its truth values on all of C's program atoms are
   kept for check 2;
2. every refinement has a level and verifies: 0 a full block of its candidate; 1 C has no model
   under the kept values; 2 the checker's own three-valued evaluation (alternating fixpoint by
   plain iteration, constraint and negative-cycle tests); 3 the checker's own product (A's rules,
   C's rules with guesses switched by `sel`, constraints and interface-headed rules deriving
   `violated`; C must be stratified) is unsatisfiable under `violated`, the kept values and X's
   guesses; 4 every candidate of A agreeing with the kept values has a model of C;
3. no solution (a solution step's candidate) has a model of C, no solution twice, one `M` per
   solution step;
4. A with every refinement as a constraint and every solution blocked is unsatisfiable.

A witness check (`if not C.solve(...)`) flips the polarity: a solution must have a model of the check,
a block may remove only a candidate without one, and every other refinement must carry a level-1
(core) certificate.

Verdict `certified` (exit 0), `rejected` with the check (exit 1), `unsupported` (exit 2: raw Lua,
expansions). `--json` prints `{ verdict, check, reason, solutions, refinements,
certificates, counterexamples, fragmentsHash }`; "Import certcheck verdict" in the Statistics tab
marks the runs with the same fragments hash (and solution count) "certified" in the run history.

Measured (`test/certcheck.test.mjs`): `tutorial-first-run` (46 level-2 certificates), `qbf` (10)
and graph-coloring n = 5 (1,320 level 3) certified; `tutorial-weak-relevant` rejected at check 2;
three mutations rejected (a literal removed: check 2; a solution removed: check 4; a level-3
certificate claimed at level 2 on graph-coloring: check 2). Row 27 (graph-coloring n = 6, every
step): proof log 7.9 MB against 7.7 MB for the plain recording (1.03x), certified in 24 s.

## 7. The symbolic audit (PLAN3 phase S6)

The same question as the audit (section 1) — can a clause that the strategy builds, from any
candidate and any counterexample, remove a solution? — answered by one search with an inner
CEGAR loop instead of enumeration (`lua/bounded.lua`, `rt.bounded`). Loaded only in bounded mode
(`modulesFor(settings, { mode: 'bounded' })` = `ground`, `bounded`); a normal run's program is
unchanged.

Definitions as in the audit: a **solution** is an interface assignment of A (unrefined) with no
model of C. The strategy is sound on the instance when for every candidate M, every model X of C
under G(M) and every clause c that X yields (`G.clause`: the relevant atoms with M's values;
`G.clauses`: each `clause(Id, _, _)` group), no solution falsifies c. Every X counts, also when the
loop asks for `optimal` or `limit` counterexamples: a strategy that relies on optimal
counterexamples may be reported unsound (as by the audit).

**The verifier program V**, built through the backend of a fresh control from the captured ground
programs (`lua/ground.lua`: `LIFT.copy` copies a store under an atom map, `LIFT.atom_map`):

| Part | Content |
| --- | --- |
| A1 | A's rules (candidate M); interface atoms a_j |
| C1 | C's rules with the interface atoms identified with A1's (a choice drops them from its heads; a normal rule with one as head becomes `:- body, not a_j`); guesses free: X is any model of C under M. r_j = C1's copy of `relevant(a_j)` |
| A2 | A's rules again (candidate M'), interface atoms b_j |
| Removal | `G.clause`: `:- r_j, a_j, not b_j.` and `:- r_j, not a_j, b_j.` (M' agrees with M on R). `G.clauses`: per group Id, `present_Id` from its `clause/3` atoms and a choice `pick_Id`, at most one pick; `:- pick_Id, clause(Id,T,true), b_T.` and `:- pick_Id, clause(Id,T,false), not b_T.` With both kinds, a selector chooses which clause removes M'; some removal must hold |
| Pruning (C stratified) | C3 = C under M' with each guess head h derived as `h3 :- body3, h1` (X's guesses); constraints and interface-headed rules derive `violated`; `:- not violated.` |
| Witness order | `d_j ↔ a_j xor b_j` and `#minimize` over the d_j (on by default; `--no-fewest`) |

**The inner loop.** Solve V (with the witness order, the last model of the optimisation is
kept). No model → **sound**. Otherwise solve C (its own control, under b's values as
assumptions): no model → M' is a solution → **unsound**, with the witness `{ kind, candidate,
counterexample, relevant | clause, solution, differ }` (the audit's fields). A model Y refines V:
C stratified → a copy C_Y of C under M' with Y's guesses fixed must fire a constraint
(`violated_Y`), which removes every M'' that Y still refutes, for every M and X; otherwise
M''s interface vector is blocked (a **fallback**). A time budget (`seconds`, default 60, counted
from the start) gives **budget**: it is checked between rounds, between the parts of V while V is
built, and inside every solve of V by a propagator whose `check` (check mode Fixpoint) reads the
clock every 256 calls and interrupts the search past the deadline. Grounding cannot be
interrupted; a run whose grounding alone outlasts the budget is ended by the run's backstop
(budget + 2 s) and reported as `budget` without counts. The check of M' (C under M''s values)
has the same hook.

**Why V unsatisfiable means sound.** Every model of V is a triple (M, X, M') with X a model of C
under M (A1 ∪ C1 splits on A1) and M' removed by X's clause. The pruning and every C_Y remove only
triples whose M' has a counterexample (with C stratified, fixed guesses give one model, and no
violated constraint means it is an answer set), and a block removes one M' with a counterexample.
So every triple with a solution M' survives, and an unsatisfiable V has none. An unsound verdict
is checked directly: C has no model under M'.

**Preconditions** (else `unsupported` with the reason): a plan from `boundedPlan` (one link
leaving a top solver, no chain); no disjunctive rules, no negative weights, no `#external` (store
error); refinements only by `G.clause`, `G.clauses`, `G.block` or `G.core` (blocks and cores are
sound by construction, listed in `kinds`; a loop with neither clause kind is `sound` at once); no
`expand`; no `lift` link ("lift link: certified per clause"). A `clause/3` atom naming an atom
outside the link (the run stops with an error there) excludes its X.

The enumerative audit covers `G.clauses` too (PLAN3): `auditPlan` adds `clauses: true` (the key
only when used) and `audit_clauses` adds one pair per `clause/3` group with the values that
falsify each literal (`pr.v`).

**Events.** `A` progress `{ phase: "symbolic", rounds, refinements }` (at most every 0.25 s);
`A` verdict `{ verdict: sound | unsound | budget | unsupported, mode: "symbolic", link, kinds,
rounds, refinements, fallback, atoms, t, witness, reason, seconds }`.

**CLI.** `node tools/audit.mjs <id> --symbolic [--seconds S] [--no-fewest] [--json]`: exit 0 sound,
1 unsound, 2 usage, 3 budget, 4 unsupported.

**Ties.** The witness has the fewest differing atoms (the same number as the audit's); among
witnesses with that number the two may pick different ones (`tutorial-weak-relevant` n = 8: the
audit names `pick(2)`, the symbolic audit `pick(1)`, both lose one solution of one atom).

## 8. Bounded verification (PLAN3 phase S7, optional)

A **space** (`docs/spec-instances.md` section 8) describes every instance up to a bound k. The
strategy is **bounded-sound for the space up to k** when it is sound (section 7) on every instance
the space generates for every k' ≤ k. Checked by iterative deepening, one symbolic audit per k'
(`js/bounded.js verifySpace`), stopping at the first k' that is not sound; the witness adds the
breaking `instance` (facts text) and `k`, and for ranged parameters (`ranges`) `params`: each
combination of ranged values is audited at each k'.

In bounded mode with a space, the link is declared with `extra = true`: `lua/bounded.lua` wraps
`rt.link` (so `lua/runtime.lua` is unchanged) and

- grounds the space alone: its facts are kept for the witness, its other atoms are the **free
  instance atoms**; each becomes an extra interface atom of the link (`L.inst[j]`; a choice in C
  and program text, CLAUDE.md rule 10). An interface atom that is a free instance atom is marked
  too;
- checks that the interface does not depend on the free part: the glue control's brave and
  cautious `glue/1` sets must be equal, else `unsupported` ("the interface depends on the
  instance").

In V, A2 shares A1's instance atoms (one instance for M and M'); instance atoms are never in a
clause and never counted by the witness order; the check of M' and the blocks include them.

What "sound up to k" does and does not say: it covers every instance of the space with k' ≤ k and
nothing else. A strategy that is sound on every small instance can still lose a solution on a
larger one, and a space that leaves out a kind of instance (only one query, no self-attacks, ...)
says nothing about it.

`node tools/audit.mjs <project | id> --space NAME --bound K [--from K0] [--seconds S] [--json]`
prints one line per k and the verdict; exit codes as in section 7 (2 for a space with errors).
