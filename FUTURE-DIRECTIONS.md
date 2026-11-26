# Future directions

What was considered but not built, as of Nov 24, 2026 (after PLAN3). Every item of the previous version of this
file (the learning plan A–F, the loop-language, checking, statistics and library items) was built
except the ones below; `PROGRESS.md` says where each built item lives. The reasoning behind the
older items was in `docs/directions/breadth.md` and `docs/directions/generality.md` (removed; in the
git history). Labels such
as D9 or F1 in code comments refer to that version (`git show 652e5bb:FUTURE-DIRECTIONS.md`).

## For the owner (outside the code)

- **Report the grounding problem to clingo.** Choice atoms that the backend adds before
  grounding are grounded wrongly by a rule that projects them away. With `b :- q(X).` over
  `q(1..3)`, only one instance is made. Python clingo 5.8.3 reproduces it in a few lines (see
  `CLAUDE.md`, rule 10, and `test/breadth.test.mjs`). CegarPlay and `cegarcheck.py` work around
  it with program text.
- **File the drafted trap report** (`docs/upstream-trap-report.md`, for clingo-wasm).
- **Run the browser tests in Firefox** (`BROWSER=firefox npm test`); this work used Chromium.
- **Deploy to GitHub Pages, run the first CI, and have a person read the guide, the how-tos,
  the instructor notes and the booklet** (`book/cegarplay.md`; `pandoc` turns it into an EPUB).
- **Push the PLAN3 branch** (`claude/plan3-bounded-verification`; the cloud clone had no remote).
- **CI speed.** The suite takes about 8 minutes; separate CI jobs for the browser tests and for
  `SLOW=1` would keep pull-request feedback fast.

## Loop language and runtime

- **`C.solve(assume E, minimal)`.** A subset-minimal model under assumptions, from the G1–G8
  specification. Never needed: `C.core.minimal` covers minimal cores, and MARCO's shrink and grow
  are written as loops.
- **Cheaper partial checks** (`on partial`). Every call is a full solve of the check, which is
  why partial checks are slower in both examples despite cutting the candidates. Options: a
  trigger on new true atoms, a trigger once the interface is decided, a domain heuristic that
  decides interface atoms first, or a cheap pre-check in ASP. **Blocked on an example** where a
  cheap check meets an expensive completion (a timetable-like abstraction with an external check
  on its interface); none of these should be built before one shows the gain. Guide chapter 20
  says so.
- **Clauses across several links.** `c + d` joins clauses of one link only; a clause over the
  atoms of two links of one solver is not translated. No example needs it yet.
- **Parallel checks.** Several checks of one candidate could run in parallel, but the engine
  serialises Lua callbacks; this needs engine work in clingo-wasm.
- **Caching cores across IHS rounds.** Considered and dropped: a cached core can never be a
  subset of a later core there, so the cache would never hit.
- **Out of reach.** Refinement by interpolants (predicate abstraction): clingo produces no
  proofs. Omission-style refinement is the substitute (`queens-omission`).

## Checking tools

- **More families in an independent checker.** `cegarcheck.py` models Shape 2 with one check;
  `tools/multicheck.py` models one abstraction with several checks by brute force. Loops refined
  by `A.set` (`queens-omission`) or by `G.above`/`G.below` (`marco`), and the chains and
  families, are still checked only by the engine and its audit.
- **Audits of large candidate spaces.** 46 library instances are marked `audit: false`, because
  the audit enumerates every candidate and runs out of time (60 s) or memory there. They include
  most puzzle `example` instances, every `sudoku-unavoidable` instance (its interface is the
  whole grid), `graph-coloring/n6`, `lang-second-solver/n5` (one solve of R per pair),
  `arrowing/example`, the large voting questions and the larger `cegis-circuit`, `maxsat-ihs`,
  `colourable-partial` and `triangle-free-lazy` instances. `triangle-free-lazy/n8` stops at the
  candidate limit. A sampling audit (random candidates and counterexamples, with a confidence
  statement), or an audit restricted to the candidates the loop actually visited, would cover
  them.
- **No blocking baseline for some examples.** `reference` (the blocking loop) cannot finish on
  `cegis-circuit`, `maxsat-ihs`, `conformant-growing`, `triangle-free-lazy`, `slitherlink` and
  the sudoku examples, so they have no `reference` variant. Their counts on small instances were
  checked once by hand (`cegarcheck.py --mode block` or a temporary blocking copy). A checker
  family that handles them would turn that into a test.

## Bounded verification (after PLAN3)

- The symbolic audit and spaces cover `G.clause` and `G.clauses` on one link. Not covered:
  `expand` (rule refinements; `LIFT.level3_rules` is half of that encoding), chains and several
  links, `lift` links (certified per clause already).
- **One verifier across k.** Each k of a space is a fresh run that grounds A, C and V again; with
  most steps taking one round, start-up dominates. A multi-shot V that adds the facts of k + 1
  would make long bounds cheap.
- **The remaining `budget` cases** (5 `audit: false` instances, the slow spaces): a sampling audit
  with a confidence statement (see "Checking tools").
- **From diagnosis to repair.** The witness names the atom that should have been relevant; the
  app could propose the missing `relevant/1` rule and check the proposal on the space.
- **Certified bounded verdicts.** "Sound up to k" is trusted today; a log that an independent
  checker replays (as `certcheck.py` does for run counts) would make it checkable.
- **A library example whose check is not stratified**, so that the verifier's block fallback is
  shown in the library and not only in a test.
- Unbounded proofs (every instance): undecidable in general; would need proofs by hand or in Lean.
- An independent Python twin of the verifier (today the enumerative audit is the oracle in tests).
- Spaces derived automatically from an instance's predicates (today they are written by hand).
- Spaces for the examples whose interface depends on the instance (arrowing, subset-sum-game,
  voting-justification, the puzzles with printed cells): the verifier would need instance atoms
  inside the interface.

## Interface

- **First-visit guidance.** A short guided path through Run, the trace, Audit and a space on the
  default example (the tutorial covers it, in a tab of its own).

## Teaching

- **Exercises built on spaces**: "make this loop sound up to k = 6", checked by Check exercise; a
  verdict that does not depend on one instance suits grading.
- **A guide example for bounded verification** (chapter 4 uses library examples now), measured by
  `guide-numbers --check`.
- **Instructor material** for the soundness chapter: a lecture-mode sequence with the candidate
  space and a space audit.

## Engine and performance

- **Parallel steps**: the steps of a space or the cells of a campaign in several workers at once
  (the page has one engine worker per run today).
- **Upgrade clingo-wasm** once a release fixes the trap (`docs/upstream-trap-report.md`).

## Code health

- **Split the page modules**: `js/control.js` and `js/init.js` keep growing; the audit and space
  code could be a module of its own.
- **Types without a build**: JSDoc and `tsc --checkJs` in CI (no build step) would catch slips
  such as a field read from the wrong event.
- **Flaky browser tests**: one browser test timed out once under heavy load, and the Observatory's
  "a cursor move redraws within one frame" (V4, gc-shape1) took 22.6 ms once in a full run; a retry
  or longer timeouts and budgets for the slowest ones would keep CI quiet.

## Library

- **Graded random puzzles.** The `erased` generators of `sudoku-hard` and `sudoku-graded` give
  puzzles that singles or a beginner solve, so their recipe instances have 0 solutions and only
  show the generator. A generator that searches for a grade (erase until the grade is reached,
  as a loop in itself) would give useful random instances.
- **More contributed examples** through the chat package, now that they can carry spaces.
- **Slow `example` runs.** `sudoku-graded` (13 s), `sudoku-unavoidable` (13 s) and
  `sudoku-hard` (7 s) are tagged `fast` but are not; their variants on `example` take as long.
  Make the instances smaller, or tag them and leave them to `SLOW=1`.

## Voting-justification ground truth

- Done (Nov 2026): every question has an expected count. `pareto-neutral-cancel-reinf-k8` was
  dropped (no loop finished it); `cancel-reinf-posresp-k4` takes 15 s with strategy 6.
- Open: a loop that builds profiles from instances (the abstraction is now the bottleneck);
  lifting a counterexample over permutations of the profile numbers; the paper's derived axioms;
  a minimality (explanatoriness) check as a second check; `multi` combined with `partial`. The
  variants s3-s5, shape2, record, deepen and profiles-first were dropped (Nov 2026); the IHS
  formulation is the example `voting-justification-ihs`. See the readmes.

## The booklet

- **Figures as images.** The `{.graph}` and `{.diagram}` blocks keep the data and the SVG; a
  pandoc Lua filter could draw the graphs and inline the SVGs for an EPUB with pictures. The
  booklet is meant to be read by tools that understand these blocks, so this was left out.
