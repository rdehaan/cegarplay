# Contributed examples

Drop a project file here to add it to the example library. Each file is a normal
CegarPlay project (`"format": "cegarplay"`) with one extra top-level block:

```json
"library": {
  "id": "my-problem",
  "group": "exists-forall",
  "summary": "One sentence for the library list, with the solution count.",
  "shape": "shape1",
  "tags": ["fast"],
  "expected": 42
}
```

- `id`: `[A-Za-z0-9_-]+`, not used by another example; the page loads it as `?example=<id>`.
- `group`: `exists-forall` (one abstraction and one check solver) or `several-solvers` (more
  solvers, staged searches or raw Lua). The older `problems` is still accepted and sorted by the
  loop (raw Lua or more than two solvers: `several-solvers`).
- `shape`: `shape1` … `shape4`, `reference` or `custom`.
- `tags`: `fast` makes `test/library.test.mjs` run the example and check `expected`
  (the solution count with `solutions = all`); use it when the run takes under ~2 s.
- `expected`: the solution count, or `null` when there is none to check.

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
