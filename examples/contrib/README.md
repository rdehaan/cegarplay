# Contributed examples

Drop a project file here to add it to the example library. Each file is a normal
CegarPlay project (`"format": "cegarplay"`) with one extra top-level block:

```json
"library": {
  "id": "my-problem",
  "group": "graphs",
  "summary": "One sentence for the library list, with the solution count.",
  "shape": "shape1",
  "tags": ["fast"],
  "expected": 42
}
```

- `id`: `[A-Za-z0-9_-]+`, not used by another example; the page loads it as `?example=<id>`.
- `group`: the category of the problem: `logic` (QBF, minimal formulas, stable models),
  `reasoning` (abduction, defaults, diagnosis, causality, argumentation, explanation), `graphs`,
  `games` (equilibria, coalitions, fair division, voting), `planning` (planning, bilevel
  optimisation) or `puzzles`. The older `exists-forall`, `problems` and `several-solvers` are
  still accepted: they go to the group `other`. Tag a loop with more than one check, staged
  searches or raw Lua `several-solvers` (the library filter finds the tag).
- `shape`: `shape1` … `shape4`, `reference` or `custom`.
- `tags`: `fast` makes `test/library.test.mjs` run the example and check `expected`
  (the solution count with `solutions = all`); use it when the run takes under ~2 s.
- `expected`: the solution count, or `null` when there is none to check. A loop that ends with
  `stop` once it has proved an optimum is not exhausted, so its count is `null`: tag it
  `stops-at-optimum` and give `optimum` instead (the cost of every solution, as clingo reports
  it), here and as `expected.optimum` in its instances (`maxsat-ihs.json`).
- `optimum` (optional): the cost of every solution of the run, checked like `expected`.
- `level` and `after` (optional): the difficulty (1 first steps … 4 literature and research)
  and the guide chapter to read first. Without them `tools/library.mjs LEVELS` decides (level 3,
  after chapter 12 for an example it does not list).
- Algorithm tags help readers find a loop by the name they know: `ihs`, `marco`, `oll`,
  `benders`, `cegis`, `expansion`, `rareqs`, `caqe`, `omission`, `bounds`, `branch-and-check`,
  `lazy-constraints`, `core-minimisation` (see the manual's *Loops from the literature*).
- A loop with a variant that switches a technique off (`total-only` without `on partial`,
  `plain-cores` without `C.core.minimal`) lets readers compare the two in the Statistics tab.

Put the problem's input (graph, formula, items, ...) in `instances` (format version 2, see the
manual's *Instances*): an instance `example` tagged `library` whose `expected.solutions` equals
`library.expected`, and two or three more small ones with a comment line and their own expected
count (one without solutions is useful). `shared` keeps the domains and derived rules of the
encoding. `af-preferred.json` and `knapsack-interdiction.json` are models to follow.

Then rebuild and test:

```
node tools/make-examples.mjs        # writes examples/<id>.json and examples/library.json
node tools/run.mjs <id> --solutions all --quiet
node tools/run.mjs <id> --instance all --solutions all --quiet
node tools/audit.mjs <id>           # every refinement against every solution
cd test && npm test
```

`python3 tools/cegarcheck.py <file> --solutions all` checks a project with Python clingo
(compare with `--mode block`, the reference run; `--instance ID` for each instance).
