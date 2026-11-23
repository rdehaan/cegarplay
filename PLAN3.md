# PLAN3: bounded verification of refinement strategies

## Context

CegarPlay checks soundness per clause (certificates, levels 2–4), per run (proof logs +
`tools/certcheck.py`) and per instance (the audit, `lua/audit.lua`). The audit enumerates every
candidate and every counterexample, so it fails on large candidate spaces (46 library instances are
marked `audit: false`), and nothing says anything about a *strategy* (the check's `relevant/1`
rules, or its `clause/3` atoms) across instances.

PLAN3 adds bounded verification in two steps:

1. **Symbolic audit** (S6): the same question as the audit — "can any clause the strategy builds,
   from any candidate and any counterexample, remove a solution?" — answered by one search with an
   inner CEGAR loop instead of enumeration. Same verdict and witness as the audit.
2. **Instance spaces** (S7): the instance itself becomes free. A project item `spaces[]` describes
   all instances up to a size k (choice rules), and the verifier answers "sound for every instance
   of the space up to k", or returns the smallest breaking instance.

S8 brings both into the app (Audit panel, Fuzz, Instances tab), the CLI and the docs.

Decisions taken with the owner (2026-11-23): both steps, phased; spaces are written fragments with
parameters (like generators); refinement kinds in scope are `G.clause` with `relevant/1` and
`G.clauses(X)` (not `expand`); usable from the app and the CLI.

Phase codes continue the soundness series (S1–S5 in `docs/directions/soundness.md`).

## Requirements across all phases

1. **Optional.** Everything is opt-in. A project without `spaces[]` loads, saves (byte-identical
   to today), runs, audits and certifies as before; the assembled program of a normal run is
   unchanged (`bounded.lua` is loaded only in bounded mode). The enumerative audit stays the
   default audit mode. Tests: the existing suite passes unchanged; a project round trip without
   spaces is byte-identical; `make-examples` without spaces gives today's files.
2. **Tutorial and guide are updated** (S8, with content written in each phase's terms):
   `tutorial.html` gets a step that runs the symbolic audit and a space on the tutorial example;
   `guide/04-soundness.html` explains symbolic audit and bounded verification (what "sound up to
   k" does and does not mean); `guide/howto-unsound.html` and `guide/howto-check.html` use the new
   modes in their workflows; `guide/howto-instances.html` explains writing a space;
   `guide/glossary.html` gets "symbolic audit", "instance space", "bounded-sound". Book/web
   differences follow CLAUDE.md (`web-only` / `book-only`); `tools/guide-numbers.mjs --check`
   and `python3 tools/export-book.py --check` pass.
3. **The library uses the feature broadly** (S7 for spaces, S6 for symbolic verdicts): every
   clause-based example whose instance is given by facts or constants gets at least one space,
   with a bound K that finishes within 60 s per k — a significant number, at least 25 examples
   (main library and `examples/contrib/`). Examples that cannot have one (interface depends on
   the instance, `expand`, chains, unsupported checks) are listed in `PROGRESS.md` with the reason.
   Every library instance carries its expected symbolic-audit verdict, and the stored bounded
   verdict of each space (`spaces[].expected: { verdict, k }`), checked by a test. Spaces live in
   `tools/library.mjs` (like `GENERATORS`) and are attached by `tools/make-examples.mjs`.

## Definitions

- A **solution** is an interface assignment of A (unrefined) with no model of C — as in the audit
  (solutions are counted per interface assignment).
- A strategy is **sound on instance I** when for every candidate M of A, every model X of C under
  G(M), and every clause c that X yields (`G.clause(M, X)`: the relevant atoms with M's values;
  `G.clauses(X)`: each `clause(Id, _, _)` group), no solution M' falsifies c.
- **Bounded-sound for space S up to k**: sound on every instance that S generates for every bound
  k' ≤ k (checked by iterative deepening, k' = 1, 2, ..., k).
- Every X counts, also when the script asks for `optimal` or `limit` (as in the audit). A strategy
  that relies on optimal counterexamples may be reported unsound; the docs say so.

## The verifier program V (one instance)

Built through the backend of a fresh control from the captured ground programs (stores of
`lua/ground.lua`), like `LIFT.product` (`lua/ground.lua:301`):

| Part | Content |
| --- | --- |
| A1 | A's rules (candidate M); interface atoms a_j |
| C1 | C's rules, interface atoms identified with A1's (`isint`), guesses free: X is any model of C under M; relevance atoms r_j = C1's copy of `L.ind[j]`; `clause(Id,T,S)` atoms of C mapped to (Id, j, S) |
| A2 | A's rules again (candidate M'), interface atoms b_j |
| Removal | `G.clause`: `:- r_j, a_j, not b_j.` and `:- r_j, not a_j, b_j.` per j (M' agrees with M on R). `G.clauses`: a choice of exactly one present Id; per literal, M' falsifies it (`:- pick_Id, clause1(Id,T,true), b_T.` / `... false), not b_T.`) |
| Pruning (C stratified only) | C3 = C with interface → A2 and each guess head h derived as `h3 :- body3, h1` (X's guesses fixed); constraints and interface-headed rules → `violated`; `:- not violated.` (X's guesses must not still refute M') |
| Witness order (optional) | `d_j ↔ a_j xor b_j`, `#minimize` over the d_j: the fewest differing atoms, like the audit's witness |

Inner loop (shape of `LIFT.exact`, `lua/ground.lua:730`):

1. Solve V (optimizing when the witness order is on; read models only with `h:iter()`). No model
   → **sound**.
2. Check M': solve the scratch check K (C with the interface as free choices, as in `LIFT.exact`)
   under M''s interface values. No model → M' is a solution → **unsound**, witness
   `{ candidate M, counterexample X (shown atoms), relevant R, solution M', differ }` (the audit's
   fields, `lua/audit.lua:150`).
3. Model Y → refine V. C stratified: add C_Y (C with interface → A2 and Y's guesses fixed as
   facts of the copy), constraints → `violated_Y`, `:- not violated_Y.` (every M'' that Y still
   refutes is gone, for every M and X). Otherwise: block M''s interface vector in A2. Go to 1.
4. Time budget (`seconds`, default 60) → **budget**.

**Why V unsatisfiable means sound.** Every model of V is a triple (M, X, M') with X a model of C
under M and M' removed by X's clause. The pruning and every C_Y only remove triples whose M' has a
counterexample (with C stratified, fixed guesses give exactly one model, and no violated
constraint means it is an answer set), so they never remove a triple with a solution M'. A block
removes one M' that has a counterexample. So every triple with a solution M' survives, and an
unsatisfiable V has none. An unsound verdict is checked directly: K has no model under M'.

**Preconditions** (else verdict `unsupported` with the reason): a plan from `auditPlan` (one
link, no chains); no disjunctive rules, no negative weights, no store error; the script refines
only with `G.clause`, `G.clauses`, `G.block` or `G.core` (blocks and cores are sound by
construction and are listed in `kinds`, as in the audit); no `expand`, no `lift` link (lift
clauses are certified by construction: verdict `unsupported`, reason "lift link: certified per
clause").

## Phase S6: Symbolic audit (one instance)

**Read first:** `docs/spec-soundness.md` §1–3 and §5 (level 4); `lua/ground.lua` (capture,
`stratified`, `LIFT.product`, `LIFT.exact`); `lua/audit.lua` (verdict, witness, `A` events);
`js/driver.js` (`auditPlan`, `auditBody`, `modulesFor`, `assemble`); `tools/audit.mjs`;
`test/audit.test.mjs`; `lua/runtime.lua` `rt.link` (interface atoms `L.src/dst/ind/sym`).

**Tasks:**

1. Spike (in `spike3/`, kept for the record): build V by hand for `tutorial-weak-relevant`,
   `graph-coloring` n = 5 and one `audit: false` instance; compare verdicts with the audit (where
   it runs) and measure rounds, refinements and time. Record the numbers in `PROGRESS.md`. Stop
   and report if V is not faster than the audit on the `audit: false` instance.
2. `lua/ground.lua`: export `stratified` as `LIFT.stratified`; factor the scratch-check builder of
   `LIFT.exact` into `LIFT.check_scratch(L)` (one builder for level 4 and the verifier); a helper
   that copies a store into a backend under an atom map (A1, A2, C1, C3, C_Y all use it; the
   copy code of `LIFT.product` moves there).
3. New `lua/bounded.lua`: `rt.bounded{ link = G, clause = bool, clauses = bool, seconds = s,
   fewest = bool }` — V, the inner loop, preconditions. Every callback in its own `xpcall`;
   nothing raises inside a clingo frame (CLAUDE.md rules 1, 5).
4. Events: `A` progress `{ phase = "symbolic", rounds, refinements }` at most every 0.25 s; `A`
   verdict `{ verdict = sound | unsound | budget | unsupported, mode = "symbolic", link, kinds,
   rounds, refinements, fallback (blocks used), t, witness, reason }`. The verdict uses the audit's
   field names where they mean the same thing, so `js/output.js auditVerdict` can show it.
5. `js/driver.js`: `boundedBody(compiled, plan, opts)` beside `auditBody`; `modulesFor(..., {
   mode: 'bounded' })` loads `ground.lua` and `bounded.lua`.
6. `tools/audit.mjs --symbolic [--seconds S] [--no-fewest]`: same exit codes (0 sound, 1
   unsound, 2 usage, 3 limit or budget) plus 4 for unsupported.
7. `test/bounded.test.mjs`; library (requirement 3): each clause-based library instance gets
   its expected symbolic verdict (an optional instance field `symbolic: "sound" | "unsound"`,
   written by `tools/make-examples.mjs`), checked by the test (slow ones under `SLOW=1`).
8. `docs/spec-soundness.md` §7 "The symbolic audit": V, the loop, the soundness argument, events,
   preconditions, measured numbers.

**Done when:**

- `tutorial-weak-relevant` unsound with `differ` = `pick(2)`, `guide-04-one-node` unsound with
  `differ` = `del(1)` (as the audit); `tutorial-first-run` and `graph-coloring` n = 5 sound.
- Sweep over every fast clause-based example instance the audit can run: the same verdict as
  the audit, and for unsound ones the same smallest number of differing atoms.
- At least one example with a non-stratified check runs through the block fallback and agrees
  with the audit (find one in the sweep; record which).
- The `audit: false` instances: how many get a verdict within 60 s, recorded in `PROGRESS.md`; one
  fast one becomes reference row 31 (`docs/reference-numbers.md`) with its verdict and rounds.
- A `G.clauses` example (from the sweep) agrees with the audit.

**Checkpoint S6.**

## Phase S7: Instance spaces

**Read first:** `docs/spec-instances.md` §1, §4 (generators: params, validation, recipes);
`js/project.js` (load/validate/save, `usesV2`, `derive`); `js/generate.js`,
`js/driver.js validateGenerator`; `js/instances.js` (`checkSchema`); `rt.link` and
`with_instance` in `lua/runtime.lua`.

**Format.** `spaces[]`: `{ name, text, params: { name: "int" }, defaults, description }`. The
params are passed as `-c` constants to every solver (as generator params are), so a space with an
empty text and the param `n` is the constants family n = 1..k. One param is the bound
(`bound: "k"`, default the first). The text replaces the instance: choice rules over the instance
predicates and constraints (e.g. `node(1..k). { edge(X,Y) : node(X), node(Y), X < Y }.`). A
project's `schema` fragment, when present, is added to the space.

**Mechanism.**

- Derived project: the fragment `instance` = the space text (+ `schema`), constants = params
  with the bound at k.
- Free instance atoms: the non-fact atoms of the space grounded alone. In bounded mode `rt.link`
  makes them extra interface atoms of the link (`opts.extra`; a choice in C like any interface
  atom, with program text per CLAUDE.md rule 10 through `iface_text`), marked `L.inst[j]`.
- In V, A2 shares A1's instance atoms (one instance for M and M'); instance atoms are never in a
  clause, so the removal constraints skip them. K gets them as interface values of M'.
- Precondition: the interface must not depend on the free part: the glue control's brave and
  cautious `glue/1` sets must be equal; otherwise `unsupported`, reason "the interface depends on
  the instance".
- Iterative deepening k' = 1..K, one bounded run per k' (JS side), stopping at the first unsound
  one. The witness adds `instance` (the true instance atoms and the space's facts, as facts text)
  and `k`.

**Tasks:**

1. `js/project.js`: `spaces[]` load/validate/save (format version stays 2; `usesV2` includes
   spaces); `deriveSpace(project, name, params)`.
2. `js/driver.js validateSpace` (as `validateGenerator`: gringo mode on the text with the params as
   constants), run before any `ctl:add`.
3. `lua/runtime.lua` `rt.link` `opts.extra`; `lua/bounded.lua` instance sharing, the glue
   precondition, the witness instance.
4. `js/bounded.js` (no DOM): `verifySpace(project, { space, from, to, seconds, env })` →
   `{ verdict, k, witness, perK: [{ k, verdict, rounds, t }] }`.
5. `tools/audit.mjs --space NAME --bound K [--from K0]`.
6. Library (requirement 3): spaces for `tutorial-first-run`/`tutorial-weak-relevant` (param
   n), `af-preferred` (args and attacks up to k), `clique-colouring` and `qbf` first, then the
   rest of the clause-based examples (at least 25 in all), each with `expected`. Shared space
   texts (graphs up to k nodes, argumentation frameworks, CNF/QBF, number sets) are written once
   in `tools/library.mjs`, as `GENERATORS` are. Then `node tools/make-examples.mjs` and, if the
   runtime changed what runs record, `node tools/make-replays.mjs`.
7. `test/spaces.test.mjs`: every library space reaches its `expected` verdict and k (slow ones
   under `SLOW=1`); a project without spaces round-trips byte-identically.
8. `docs/spec-instances.md` §6 "Spaces" (marked optional); `docs/spec-soundness.md` §8
   "Bounded verification".

**Done when:**

- `tutorial-first-run` is bounded-sound up to n = 10; `tutorial-weak-relevant` first breaks at
  the same n as the enumerative audit over n = 1, 2, ... (measure it with the audit first).
- `af-preferred`, `clique-colouring` and `qbf` are bounded-sound up to a bound K recorded in
  `PROGRESS.md` (the largest that finishes within 60 s per k).
- Mutation test: for each of these, deleting one `relevant/1` rule at a time — every mutation
  that the enumerative audit finds unsound on some library or generated instance is found
  unsound by the space at a k no larger than that instance's size, and the audit is unsound on
  every witness instance the space returns.
- A glue that depends on a free instance atom gives `unsupported` with the reason above.
- Reference row 32: one space verdict (example, K, first breaking k or "sound", time budget).
- Requirement 3 holds: at least 25 examples have spaces with `expected` verdicts, the rest are
  listed with reasons, and `test/spaces.test.mjs` passes.
- Requirement 1 holds: the existing tests pass unchanged and a project without spaces is
  byte-identical after a round trip.

**Checkpoint S7.**

## Phase S8: App, Fuzz, docs

**Read first:** `js/control.js`, `js/output.js` (`auditVerdict`), `js/stats.js` (audit column),
`js/fuzz.js`, `js/instances-tab.js` (generator editor), `docs/spec-app.md` for UI conventions.

**Tasks:**

1. Audit control: a mode select beside the Audit button — Enumerate (today), Symbolic, Space
   (space name and bound). The verdict panel shows mode, rounds, refinements, fallbacks, and for
   spaces the k and the witness instance with "Save as regression instance" (reuse Fuzz's).
2. Run history: the audit column shows symbolic and space verdicts (`sound ≤ k` for spaces).
3. `js/fuzz.js`: instances marked `audit: false` get the symbolic audit instead of being
   skipped; `budget` and `unsupported` are skipped like `limit`.
4. Instances tab: a Spaces list with the generator editor's layout (name, text, params,
   description, validation messages).
5. Docs (requirement 2): `manual.md` (Audit modes, Spaces, both marked optional);
   `tutorial.html` (a new step: symbolic audit, then the tutorial example's space up to n = 10,
   then the weak-relevant variant breaking at its first n); `guide/04-soundness.html` (section
   with a worked example and the limits of "sound up to k"); `guide/howto-unsound.html`,
   `guide/howto-check.html`, `guide/howto-instances.html`, `guide/glossary.html`. If a guide page
   gets a new example, build it with `tools/guide.mjs` and measure it into `guide/numbers.json`.
   Then `node tools/guide-numbers.mjs --check` and `python3 tools/export-book.py` (never edit
   `book/cegarplay.md` by hand); `tools/make-chat-package.mjs` docs (spaces are something a
   chat-written example can carry).
6. Browser test: symbolic audit of `tutorial-weak-relevant` from the page shows "unsound" with
   the witness; a space run shows its k; a project without spaces shows no Space mode.

**Done when:** the browser test passes in chromium; Fuzz on an `audit: false` instance gives a
verdict instead of a skip; the tutorial and the guide pages above describe the feature;
`export-book.py --check` and `guide-numbers --check` pass.

**Checkpoint S8.**

## Working rules

- CLAUDE.md applies (one phase at a time, commit `Phase S6: Symbolic audit` etc. at each
  checkpoint, `PROGRESS.md` updated at each checkpoint, rules 1–10). Checkpoint = `cd test && npm
  test 2>&1 | tail` green.
- When PLAN3 starts: add it to "Where things are" in CLAUDE.md and set "Next step" in
  `PROGRESS.md`.
- Do not change reference rows 1–30. New rows start at 31.
- Deviations from this plan go in `PROGRESS.md` with the cause.

## Out of scope (recorded in FUTURE-DIRECTIONS.md at the end)

- `expand` (rule refinements), chains and several links, `lift` links.
- Unbounded proofs (all instances): undecidable in general; would need hand or Lean proofs.
- An independent Python twin of the verifier (the enumerative audit is the oracle in tests).
- Spaces derived automatically from an instance's predicates.
