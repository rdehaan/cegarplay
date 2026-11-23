# Future directions

What was considered but not built, as of Nov 23, 2026. Every item of the previous version of this
file (the learning plan A–F, the loop-language, checking, statistics and library items) was built
except the ones below; `PROGRESS.md` says where each built item lives. The reasoning behind the
older items is in `docs/directions/breadth.md` and `docs/directions/generality.md`. Labels such
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

## Library

- **Graded random puzzles.** The `erased` generators of `sudoku-hard` and `sudoku-graded` give
  puzzles that singles or a beginner solve, so their recipe instances have 0 solutions and only
  show the generator. A generator that searches for a grade (erase until the grade is reached,
  as a loop in itself) would give useful random instances.
- **Slow `example` runs.** `sudoku-graded` (13 s), `sudoku-unavoidable` (13 s) and
  `sudoku-hard` (7 s) are tagged `fast` but are not; their variants on `example` take as long.
  Make the instances smaller, or tag them and leave them to `SLOW=1`.

## Voting-justification ground truth

- `cancel-reinf-posresp-k4` has its expected value (16). `pareto-neutral-cancel-reinf-k8` still
  has none: a 90-minute run of variant `s1` was started for it; when a run is exhausted, put the
  count in `expected` (and tag the instance `slow`).

## The booklet

- **Figures as images.** The `{.graph}` and `{.diagram}` blocks keep the data and the SVG; a
  pandoc Lua filter could draw the graphs and inline the SVGs for an EPUB with pictures. The
  booklet is meant to be read by tools that understand these blocks, so this was left out.
