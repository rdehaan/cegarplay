# CegarPlay: writing library examples (start here)

You are helping to extend the example library of **CegarPlay**, a static browser playground
for CEGAR loops (counterexample-guided abstraction refinement) written in answer set
programming (ASP) and solved with clingo 5.8 (with Lua) compiled to WebAssembly. You do not
have the repository. This package has everything you need to write, check and hand over new
examples. The maintainer integrates what you deliver.

## What CegarPlay does, in one paragraph

A project is one JSON file holding named ASP **fragments**, a **loop script** and
**settings**. The script declares **solvers** (clingo controls built from fragments) and
**links** (which atoms two solvers share). The usual layout: solver `A` (the
*abstraction*) proposes candidates, solver `C` (the *check*) looks for a counterexample to a
candidate with the shared *interface atoms* fixed, and each counterexample becomes a
*refinement* of `A`, usually a clause built from the atoms the check marks with
`relevant/1`. Candidates without a counterexample are solutions. The loop language compiles
to Lua that runs inside clingo.

## Files in this package

| File | What it is | Read |
| --- | --- | --- |
| `00-START-HERE.md` | this guide | first |
| `manual.md` | the technical manual, the full reference | sections *Model and terms*, *Project file format*, *ASP conventions*, *The loop language* (skim), *Templates*, *Refinement variants*; the rest when needed |
| `tutorial.html` | the lessons for people (HTML) | for the ideas and the house tone |
| `library.json` | the current library manifest | to see what exists |
| `example-<id>.json` | every library example as a project file | `example-starter.json`, `example-tutorial-first-run.json`, `example-graph-coloring.json`, then whatever is close to your problem |
| `contrib-template.json` | the skeleton of a deliverable | copy it for each new example |
| `cegarcheck.py` | a checker that runs projects with Python clingo | see *Verification* |

## The task

Write new library examples: problems that suit a CEGAR loop, that is
problems of the form "find X such that no Y exists with ...". The abstraction guesses X; the
check guesses a Y that refutes X. Each example should teach something: a problem class, a
modelling trick, a refinement variant, or a comparison (weak versus strong `relevant/1`,
Shape 1 versus rule refinements). Put alternatives to compare in one project as **variants**: an
extra fragment per alternative and a variant that swaps it in (`"variants": [{ "name": "s1",
"swap": { "relevant": "relevant_s1" } }]`), or a variant with its own `loop`, plus a suite that runs
them on the instances (`example-voting-justification.json`; manual, *Variants* and *Campaigns*).
Every alternative must be correct; only the guide group shows wrong ones on purpose.

Ideas (take one, or propose your own):

- 2QBF: assignments to the ∃-variables such that every ∀-assignment satisfies a formula.
- Minimal models: models of a CNF that no smaller model is below.
- Sudoku-like puzzles with a unique solution: clue sets the check cannot complete in two ways.
- Ramsey-style colourings: edge colourings of K_n without a monochromatic triangle, or graphs
  in which every k-subset has a property.
- Winning strategies or positions in a small game: a move such that every reply loses.
- Conformant planning: a plan that reaches the goal from every initial state.
- Robust hitting sets or covers: a set that still covers after any single failure.
- Explanations or justifications in the style of `example-voting-justification.json`.

Already used ids (do not reuse): {{IDS}}

## The deliverable

One file per example, to be saved by the maintainer as `examples/contrib/<id>.json`. Start
from `contrib-template.json`. It is a normal project plus a top-level `library` block:

```json
"library": {
  "id": "my-problem",
  "group": "graphs",
  "summary": "One sentence for the library list that quotes the solution count (n = 4, 42 solutions).",
  "shape": "shape1",
  "tags": ["fast"],
  "expected": 42
}
```

- `id`: `[A-Za-z0-9_-]+`, short, lower case with hyphens.
- `group`: the category of the problem: `logic` (QBF, minimal formulas, stable models), `reasoning` (abduction, defaults, diagnosis, causality, argumentation, explanation), `graphs`, `games` (equilibria, coalitions, fair division), `voting` (winners, control and justification of elections), `judgment` (judgment aggregation: outcomes of aggregation rules), `planning` (planning, bilevel optimisation) or `puzzles`. Add the tag `several-solvers` when the loop has more than one check, staged searches or raw Lua.
- `shape`: `shape1`, `shape2`, `shape3`, `shape4`, `reference` (the templates in the
  manual) or `custom` when you write your own loop.
- `tags`: `["fast"]` when a run with `solutions` = all takes under about 2 s (the test suite
  then runs it and checks `expected`), else `[]`.
- `expected`: the solution count with the project's own settings and `solutions = 0` (all),
  or `null` when the run is not meant to finish (then set `settings.solutions` to 1 or 10).

Hand over each file **complete, in one ```json code block, with nothing left out** ("..."
or "unchanged" breaks it). Fragment texts are JSON strings: escape `"` and `\`, write line
breaks as `\n`. After the block, give two or three sentences on what the example shows.

## House style (follow the existing examples)

- Fragments `shared` (domains and constants), `abstraction` (the guess and `#show`), `glue`
  (`glue(T)` rules) and `check` (the counterexample and `relevant/1`), in that order, each with
  a one-line `description`. Extra fragments are fine when a loop needs them (`sums`,
  `neighbours`, `refine`, ...).
- Comment the ASP with `%`: say what each block means in the problem, not in ASP terms.
  British spelling (colour, neighbour).
- `title` short (2–5 words); `description` 1–3 sentences: the problem, what the loop does,
  and what to look at.
- Optional `readme` (Markdown) for an example that makes a good student project: background, the
  baseline with measured numbers, things to try, how to measure, open questions. The template has
  one; delete it if not needed. `readme-voting-justification.md` is the full example of a kit.
- Generators (`generators`, manual *Generators*) draw random instances with `@flip`, `@int`,
  `@perm`, `@subset`, `@weighted` and `@mallows`; an instance can be a recipe
  `{ "id": "random-1", "recipe": { "generator": "g", "params": { "n": 6 }, "seed": 1 } }` instead
  of facts (`example-qbf.json`, `example-af-preferred.json`).
- Optional: a **space** (`spaces`, manual *Spaces*) describes every instance up to a bound k with
  choice rules over the instance's predicates, so that the strategy can be verified on all of them
  (the page's Audit, mode Space; `node tools/audit.mjs ID --space NAME --bound K`). Keep what the
  glue is built from as facts, give the bound a new name (a parameter named like a constant of the
  encoding sets that constant; give it a range to cover several of its values), and say in your notes which
  bound you would expect to check (`example-af-preferred.json` has the space `frameworks`).
- The problem's input (a graph, a formula, an election, items) goes into **instances**, not into
  `shared`: `"instances": [{ "id": "example", "facts": "% what it is\n...", "constants": {},
  "expected": { "solutions": 3 }, "tags": ["library"] }, ...]` and `"version": 2` (manual,
  *Instances*; `example-af-preferred.json`, `example-voting-justification.json`). `shared` then
  keeps the encoding's domains and derived rules. Give two to four instances: the `example`
  (its count is `library.expected`), a smaller one, one with no solution, a larger one; each
  with a comment line and its `expected.solutions`. An optimisation loop that `stop`s at its
  optimum gives `"expected": { "solutions": null, "optimum": 8 }` instead (the cost of every
  solution), and `"optimum": 8` next to `"expected": null` in the `library` block. A parametric problem without data uses
  constants-only instances (`"facts": ""`, `"constants": {"n": "5"}`, as in
  `example-graph-coloring.json`). Keep `settings.constants` equal to the `example`'s values so
  the project as written still runs in seconds.
- Loop scripts: start from a template in the manual (*Templates*). In custom scripts, add
  `#` comments that explain each step, as in `example-lang-*.json`. For an algorithm from the
  literature (MaxHS, MARCO, OLL, Benders, CEGIS, RAReQS, ...), start from the example the
  manual's *Loops from the literature* names, and give the entry the algorithm's tag.
- Settings: copy `settings` from the template (`solutions: 0, seconds: 60, candidates: 0,
  trace: 200, seed: 0`) and change only what you need.

## Design checklist (soundness first)

1. **Every solution is a candidate.** The abstraction may over-approximate, never cut a
   solution.
2. **The check has an answer set exactly when the candidate is wrong** (or, in the witness
   variant with `G.core`, exactly when it is right).
3. **Every atom the check reads from the candidate is glued.** An atom the check uses but the
   glue does not list has no rules in the check and is false there, which silently changes the
   check's meaning.
4. **`relevant/1` marks every interface atom the counterexample depends on**: the atoms whose
   values make it a counterexample, both true ones and false ones. Too few is unsound: the
   clause can cut real solutions (see `example-tutorial-weak-relevant.json`). Too many is safe but slow.
5. In a `#program refine(k).` part, every head contains `k`.
6. `relevant/1` derives at least one atom in every counterexample, unless no solution is left:
   an empty relevant set gives the empty clause, which ends the search (the audit reports it).
7. Keep the ground program small: constants small, domains bounded. Avoid `V = #sum { ... }`
   over atoms the solver guesses (each possible sum is grounded); compare instead
   (`#sum { ... } > E`).
8. A witness check refined by cores learns much more from short ones: use
   `reject M with C.core.minimal.on(G)` (`example-colourable-partial.json`).
9. Two `#minimize` statements add up only distinct tuples: tag them (`{ C,J,cost : ... }`,
   `{ V,M,est : ... }`), else equal tuples are counted once.

## Verification

You cannot run the page. Check every example in two steps.

**(a) In your own sandbox, if you have code execution.** Save the project as a file and run:

```sh
pip install clingo                                    # Python clingo 5.8
python3 cegarcheck.py my-problem.json --solutions all              # the loop's own refinement
python3 cegarcheck.py my-problem.json --solutions all --mode block # reference run
```

Add `--instance ID` for each instance (without it the first instance is used).

Both runs must say `exhausted: yes` and report the same number of solutions; that number is
your `expected`. A smaller count in the loop's mode means `relevant/1` (or the refine part) is
too weak. `cegarcheck.py` reads the mode from the loop script (`G.clause`, `G.clauses`,
`G.core`, `A.expand(refine, ...)`, `optimal`); it supports one abstraction, one check and one
link. Raw Lua and scripts with more solvers or links can only be checked in step (b). If
`pip install` is not possible, say so and go to (b). `--show` prints the solutions;
`-c n=4` overrides a constant.

Only the solution counts of exhausted runs can be compared with the page. Candidate and
counterexample counts differ, because the page's Shape 1 checks inside one running search.

**(b) By the maintainer, in the repository.** End your answer with the commands to run:

```sh
# save the file as examples/contrib/<id>.json, then:
node tools/make-examples.mjs
node tools/run.mjs <id> --solutions all --quiet
node tools/run.mjs <id> --instance all --solutions all --quiet
node tools/audit.mjs <id>
cd test && npm test
```

`tools/run.mjs` uses the real engine. It prints validation problems as
`fragment:line:col: error: message`, and ends with
`Outcome: ...; exhausted: ...` and `Solutions: ...; candidates: ...`. The example is finished
only when the pasted output shows the run finished and the count equals `expected`. If the
maintainer pastes an error, look it up in the manual (*Static errors*, *Troubleshooting*) and
send a corrected complete file.

## Things that differ from plain clingo

- Each fragment is added after its own `#program base.` line; constants from
  `settings.constants` reach every solver and the glue (`#const n = 4.` in a fragment is a
  default that the setting overrides).
- An interface atom that is a fact in the abstraction is a fact in the check; the others are
  free in the check and fixed by assumptions per candidate.
- `relevant(T)` exists for every non-fact interface atom of the link and is false unless a rule
  of the check derives it. Do not write `{ relevant(T) }` yourself.
- Solutions are printed as the shown atoms of the abstraction: write a `#show` for the atoms a
  reader wants to see.
- Prefer the loop language to raw Lua. If you must write raw Lua, follow *Hard rules for raw Lua*
  in the manual: a clingo error inside a Lua call kills the engine without a message.
