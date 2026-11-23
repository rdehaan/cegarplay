# Future directions

What was considered but not built, as of Nov 23, 2026 (branch `claude/loop-breadth`). The
reasoning behind most items is in `docs/directions/breadth.md` and `docs/directions/generality.md`;
`PROGRESS.md` has the history. The items are ordered roughly by value for effort within each
section.

The section "Learning and student projects" was added on the same date. It looks at the project
from the side of a student who knows ASP and wants to learn CEGAR loops, from the first loop to
loops from the literature and to a research project of their own. Sizes: S is a day or less, M is
a few days, L is a week or more.

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

## Learning and student projects

### Where things stand

The learning materials come in two parts.

- **The guide** (`guide/`, 12 chapters) teaches the design of a loop. Each chapter has a Recap,
  exercises with solutions and measured numbers, and there are predict boxes in chapters 1–4, 8
  and 11.
- **The tutorial** (`tutorial.html`, 13 lessons) is a tour of the tool.

Together they take a student from "why a loop" to "your own loop". The gaps are these:

- **Past chapter 12 the material stops.** Each literature loop (MARCO, IHS, OLL, Benders,
  AReQS/RAReQS, CAQE, CEGIS, omission, branch-and-check) exists as a dense example file and one
  row in `manual.md`'s table "Loops from the literature". Chapters 10 and 11 give them one
  paragraph each. None is explained step by step.
- **The guide stays on one problem.** Chapters 1–8 and 11 use clique (triangle) interdiction,
  first on a small graph and then on the Paley graph. A student rarely practises the step that
  matters most in a new problem: finding the quantifiers and the interface.
- **The guide and the tutorial run side by side.** They use different running problems, and
  neither suggests an order for reading them together. The guide never mentions generators,
  recordings, certificates or views. The Observatory, Fuzz and campaigns get one passing mention
  each.
- **The research workflow is mostly in place.** Instances, variants, campaigns, the audit, Fuzz,
  `run.mjs`, `bench.mjs` and `cegarcheck.py` all work on `voting-justification`. Two things are
  weak: reading the results across variants, and the example itself as a project. Its
  description is one sentence, it has no generator, and its two interesting instances have no
  expected value (details in D and E).
- **Run all can report success without having checked anything.** This bug is real (see D1).

So yes, extending the guide makes sense. The case is strongest for a Part II that walks through
loops from the literature, plus short how-to pages for the tool's diagnostic and experiment
features. The tutorial shows where these features are, but not how to use them to answer a
design question.

### Top 10, by value for effort

1. **Fix the Run all report** (D1, S).
2. **An instance × variant results matrix with CSV export** in the Campaign tab, and a report
   script for `bench.mjs` output (D2, D3, M).
3. **A project kit for `voting-justification`** (E1, E2, M).
4. **Guide Part II, first three chapters:** 2QBF, implicit hitting sets and MARCO (A, L).
5. **How-tos:** comparing strategies with a campaign, hunting an unsound refinement, and
   running experiments headlessly (C, M).
6. **A glossary and a combined reading order** of the guide and the tutorial (B3, B4, S).
7. **Self-checking exercises:** a Check button that runs the student's loop against expected
   counts and the audit (F1, M).
8. **Difficulty levels and a learning path in the library** (F2, S–M).
9. **A case-study chapter on `voting-justification`** (A9, M; after items 2 and 3).
10. **The rest of Part II:** CEGIS, OLL, Benders, more than two levels, lazy constraints and
    omission (A, L).

### A. Guide Part II: loops from the literature

Each chapter would keep Part I's format:

- It opens with a problem and a blocking baseline, then derives the published loop in steps.
- It has predict boxes, exercises with solutions, and numbers measured by
  `tools/guide-numbers.mjs` (kept current by `--check`).
- Its examples are `guide-NN-*.json`, built by `tools/guide.mjs`.
- A short "The paper" box gives the reference and maps the paper's pseudocode onto the loop
  script.

`guide/chapters.js` would get a `part` field, so the sidebar and the contents page can show
Part I (design) and Part II (the literature). The proposed chapters, from easier to harder:

1. **2QBF, by CEGAR and by expansion** (`qbf`, `qbf-expansion`).
   - A fresh problem in its rawest form: the quantifiers are given.
   - It sets clause refinement against expansion (AReQS), where the refinement adds a copy of
     the inner variables.
   - It is a good first chapter because it shows that Part I's loop is a known algorithm.
2. **CEGIS** (`cegis-circuit`, `min-dnf`).
   - Synthesis as an ∃∀ problem: the counterexample is an input, and the refinement says "also
     work on this input".
   - It links to the synthesis literature, which students often know by name.
3. **Implicit hitting sets** (`maxsat-ihs`, `smallest-mus`).
   - Cores as refinements, an optimal hitting set as the abstraction, the lower and upper
     bounds, and `track`.
   - It explains when the loop may stop. That is the open item "A stop rule when the bounds
     meet" under Loop language; the chapter would motivate it.
4. **MARCO** (`marco`, `reasons-by-shrinking`).
   - A map solver, shrink and grow, `G.above`/`G.below`, and a loop with two outcomes (MUS and
     MSS).
   - That links to "A second kind of solution".
5. **Core-guided optimisation, OLL and Fu-Malik** (`maxsat-oll`). The refinement relaxes the
   abstraction instead of cutting it. It is a useful contrast with chapter 3, and could end with
   the weighted case as an exercise (see "Weighted OLL").
6. **Benders decomposition** (`benders-tardiness`, `knapsack-bounds`).
   - Master and subproblem, feasibility and optimality cuts, bounds with `track`.
   - It connects to the operations-research view of CEGAR that many students meet elsewhere.
7. **More than two quantifier levels** (`qbf-deep`, `qbf-three-blocks`,
   `knapsack-fortification`). Recursion (RAReQS), solver families and procedures, and a
   CAQE/QESTO-style loop with one solver per block. Tutorial lesson 10 covers these only as
   language features.
8. **Lazy constraints and omission** (`colourable-partial`, `triangle-free-lazy`,
   `queens-omission`, `conformant-growing`).
   - Branch-and-check (`on partial`), and abstractions that leave part of the problem out and
     grow it.
   - It needs **an example where `on partial` wins on time**. That example needs a cheap check
     and an expensive completion, for example an abstraction with a hard non-interface part such
     as a timetable, and an external check on its interface. Neither G5 example is faster than
     its `total-only` variant.
9. **A case study: explaining voting outcomes** (`voting-justification`).
   - A research-style chapter, not an algorithm chapter.
   - The steps: a baseline, the five `relevant` strategies as variants, a campaign over the
     questions, reading the matrix (D2), checking soundness on the small questions and getting
     ground truth for the large ones. It ends with the open questions of the project kit (E1).
   - It shows a student what a project with the tool looks like.
10. **From a paper to a loop.**
    - A closing page with a checklist for turning an algorithm given in pseudocode into fragments
      and a loop script, plus a "which loop for which problem" table that extends chapter 12's.
    - It covers what to do when the paper uses something CegarPlay lacks, such as interpolants or
      proofs (see "Out of reach").
    - It also covers how to check the result against the paper's numbers.

A bibliography page, linked from every Part II chapter and from the manual's literature table,
would list the paper behind each loop.

### B. Strengthening Part I

1. **Fresh problems in the exercises from chapter 5 on.**
   - Keep the running example, but give each chapter at least one exercise on a different
     problem: 2QBF, an argumentation semantics (`af-preferred`), a game (`nash`) or a puzzle
     (`sudoku-unique`).
   - Each exercise has a starter project and a solution project. The student then has to find
     the interface again in each chapter.
2. **More checks of understanding in the later chapters.**
   - Chapter 10 has one exercise.
   - Chapters 5–7, 9, 10 and 12 have no predict boxes. A predict box asks for a number before the
     run (candidates, refinements, whether the audit passes) and reveals the measured one.
3. **A glossary page.**
   - It would define candidate, counterexample, interface (glue), refinement, sound and
     complete, blocking, witness check, core, shape, variant, instance and campaign.
   - Each entry links to the chapter that introduces it. The guide's pages could link the first
     use of each term.
   - `manual.md`, "Model and terms", is the closest thing today, written for reference.
4. **A combined reading order.**
   - One page (or a section of `guide/index.html`) that interleaves the two. For example:
     tutorial lessons 1–4, guide chapters 1–4, tutorial lesson 6 (audit), guide chapter 5,
     tutorial lesson 5 (Observatory), and so on.
   - Better still, each guide chapter would end with "Tool skills for this chapter", linking the
     tutorial lessons and how-tos (C) it uses.
5. **A "tool moment" in each chapter.** Use a diagnostic feature where the design question calls
   for it:
   - the candidate space and Fuzz in chapter 4 (soundness);
   - the Observatory's cost per line in chapter 5 or 8 (where the time goes);
   - a campaign in chapter 6 or 8 (one strategy against another on many instances);
   - a recording in chapter 12.

   Today these are taught only in the tutorial, apart from the design questions that call for
   them.

### C. How-to pages

These are short, task-oriented pages: one goal, one worked example, the steps, what to look at,
and the pitfalls. They could live in a `howto/` section of the guide (same style, listed by
`chapters.js` or a sibling list, tested the same way), linked from the tutorial and from the
manual's sections. The tutorial says where a feature is; a how-to says how to use it to answer a
question. Candidates:

1. **Compare refinement strategies with a campaign** (`voting-justification`, suite
   `strategies`).
   - Write a variant, write a suite, run it, read the table and the plots, and export the rows.
   - Pitfalls: limits that are too short, outcomes that differ (the disagreement check), and the
     Campaign tab being shown only in Advanced mode.
2. **Find where the time goes.**
   - The Statistics tab per solver, then the Observatory's call timeline and cost per line.
   - Then decide: is the check too slow, are there too many candidates, or are the refinements
     too weak? (Clause lengths and the Lifting coach answer the last one.)
3. **Hunt an unsound refinement.**
   - Run the audit, read the witness, look at the blame matrix in the candidate space, run Fuzz
     to shrink the instance, and save it as a regression instance.
   - The example: guide chapter 4's `guide-04-one-node`, or tutorial lesson 6.
4. **Build an instance set.**
   - Write a generator (draws such as `@flip`, `@perm`, `@mallows`), preview it and add its
     instances. Import files.
   - Get ground truth from the `reference` variant or from native clingo after "Export for
     clingo", tag the hard instances, and write the expected counts and optima.
5. **Run experiments headlessly.**
   - `tools/run.mjs --instance all`, then `tools/bench.mjs` with `--jobs`, `--shard` and
     `--resume`. Then turn the JSONL into a table or plot (with D3 once it exists, by hand
     until then).
   - When to move to native clingo instead of the browser.
   - Today this workflow is written down only for agents (`manual.md`, "For agents").
6. **Check a loop independently.** `tools/cegarcheck.py` (and what it refuses), certificates,
   proof logs and `tools/certcheck.py`, and the `reference` variant as ground truth.
7. **Write a domain view.** `#program scene.` and `#program frame.`, "Suggest a view", and
   checking the view against the trace.
8. **Record and present a run.** `.cprec` recordings, replays, `?lecture=1`, and the linked
   cursor, for a talk or a project report.
9. **Turn a paper into a loop.** A short version of A10 for students who skip Part II.

### D. Experiment and comparison tooling

These items are what a student needs to compare loops on many instances. The first is a bug.

1. **Run all says "matches" without checking** (S).
   - Where: `js/instances-tab.js` (`runAll`) and `expectedCheck` in `js/project.js`.
   - The problem: an instance is checked only when its run finished and was exhausted, so a run
     that stops at `settings.solutions` (for example `voting-justification`, which uses 1) is
     never checked. The status line still reads "every expected count and optimum matches"
     when nothing was checked.
   - The fix: count the instances actually checked ("12 of 17 checked, all match; 5 not checked
     because the run stopped at the solution limit"). Better, run with all solutions when an
     instance has an expected count, as `run.mjs` does with `--solutions all`.
2. **An instance × variant matrix in the Campaign tab** (M).
   - Today the tab shows one row per variant (cells, exhausted, median time, median candidates,
     growth) and a progress grid without labels.
   - The matrix: one row per instance and one column per variant. Each cell shows time or
     candidates (switchable), with time-outs and disagreements marked and the best cell per row
     highlighted. It is sortable, with a CSV export next to the JSONL export.
   - Also: tooltips on the progress grid, variant pickers for the scatter plot (now fixed to the
     first two variants), and a cactus plot (solved instances against time), the standard plot
     for comparing solvers.
3. **A report script for campaign rows** (S–M). `tools/report.mjs <rows.jsonl>` writes the same
   matrix as Markdown and CSV, plus an SVG cactus plot. A student can then put the results into a
   report without post-processing by hand.
4. **More metrics in campaign rows** (M).
   - Rows hold time, candidates, refinements, solutions and outcome.
   - Add calls, time and conflicts per solver, the mean clause length, and the time spent in the
     check against the abstraction. These are what explain why one variant beats another; today
     only the single-run Statistics tab shows them.
   - Also optima ("Optima in campaigns" under Checking tools).
5. **Compare with the previous run** (S–M). The run history already turns red when two runs
   disagree. A side-by-side diff of two runs' statistics would make each edit-and-rerun step of a
   design session easy to read.
6. **Smaller items** (S each).
   - A `--seconds` option for `tools/bench.mjs`; today timeouts come only from the suite.
   - The `--instance` option of `tools/audit.mjs` in the manual's usage line.
   - A hint or link to the Campaign tab outside Advanced mode, for example from the Variants
     section of the Loop tab.
7. **Importing many instances** (M).
   - Choose several files or a folder at once.
   - The CSV importer with a column map, planned in `docs/directions/overview.md` but not built.
8. **Mining, reachable** (M). `js/mine.js` searches a generator's grid for hard instances, but
   only `test/pool.test.mjs` uses it. A button in the Instances tab, or a command-line tool, would
   let a student find instances that separate their variants.
9. **A workspace** (M).
   - Autosave keeps one project in `localStorage`, and campaign rows stay in IndexedDB until
     exported.
   - A list of saved projects, with a warning before one overwrites another, would suit students
     who keep a baseline and an experiment side by side.
   - Download and Upload remain the git-friendly route.
10. **A lab notebook** (S–M). A free-text note per variant and per run (in run history), saved
    in the project, so that "why I tried this" travels with the numbers.

### E. Project kits

A student project needs more than a working example. It needs a statement of the problem, a
baseline, instances at several levels of difficulty with ground truth, and open questions.

1. **A `readme` field in projects** (M).
   - Markdown, shown in the app (a panel or tab) and in the chat package.
   - It would hold the domain background, what the abstraction and the check model, the baseline
     and the variants, what "better" means (fewer candidates, less time, more instances solved),
     and the open questions.
   - The `description` stays one paragraph for the library.
2. **The voting-justification kit** (M). The example has 17 instances, 5 `relevant` strategies,
   `shape2` and `reference` variants, and two suites, and the audit and `cegarcheck.py` both
   work on it. What is missing:
   - **Ground truth for the hard instances.** `cancel-reinf-posresp-k4` stops at the 60 s limit
     with 16 solutions after about 80,000 candidates. `pareto-neutral-cancel-reinf-k8` has no
     expected value. Computing both offline, with native clingo and a long run, would give the
     interesting instances a check.
   - **A question generator.** It would draw random axiom sets, profiles and targets, so that
     students can scale and Fuzz has something to grow (today it falls back to the fixed
     instances).
   - **A variant with `--enum-mode=record`.** The manual itself warns that Shape 1 without it
     prunes less.
   - **A domain view and a recorded replay**, for the Observatory and for presenting.
   - **A readme** (E1) with the open questions, for example:
     - Which strategy wins on which kind of question, and why?
     - Can a refinement be lifted over symmetric profiles?
     - Does Shape 2 or a rule refinement pay on the hard instances?
3. **Project cards for other examples** (M). The same treatment, lighter, for about six examples
   that make good projects. Each card gives a research question and baseline numbers.
   - `sudoku-unavoidable` and `fewest-clues` (minimal puzzles; symmetry).
   - `conformant-planning` and `conformant-growing` (growing the abstraction).
   - `af-preferred` and `af-semi-stable` (argumentation; compare with dedicated solvers).
   - `strategic-companies` (a classic Σ2P benchmark).
   - `nash` and `strong-nash` (several oracles).
   - `benders-tardiness` (cuts and bounds).

   A "Projects" group in the library would collect the kits.

### F. Teaching support

1. **Self-checking exercises** (M).
   - An `exercise` block in a project. It holds:
     - the instances and their expected counts or optima;
     - whether the loop must pass the audit;
     - optionally a budget ("at most 40 candidates on instance p13") that forces a stronger
       refinement than blocking.
   - A Check button runs all of this and reports pass or fail per item.
   - A headless grader on top of `tools/run.mjs` and `tools/audit.mjs` would let an instructor
     grade a folder of submissions.
   - The guide's exercises would become starter projects with this block.
   - D1 is a prerequisite: the check must never report success without having checked.
2. **Difficulty levels and a learning path** (S–M).
   - Today `examples/library.json` has topic groups and technique tags, but no level and no
     prerequisite.
   - Add `level` (1–4) and `after` (the guide chapter that should be read first) to the
     manifest and to the contrib `library` block. Set them for all examples.
   - Add a library filter: "what can I read now?"
3. **A bibliography** (S): the papers behind each literature loop, also linked from the manual's
   literature table (see A).
4. **Instructor notes** (M).
   - A suggested course plan, week by week, mapping guide chapters, tutorial lessons, how-tos and
     exercises.
   - Lecture-ready replays for the key moments: the first refinement, an unsound refinement
     caught by the audit, a core shrinking.
   - A list of project kits by size.

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
- **The chat-package guide and instances.** It still does not describe generators or recipes in
  instances.
