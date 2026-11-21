# Contributed examples

Drop a project file here to add it to the example library. Each file is a normal
CegarPlay project (`"format": "cegarplay"`) with one extra top-level block:

```json
"library": {
  "id": "my-problem",
  "group": "problems",
  "summary": "One sentence for the library list, with the solution count.",
  "shape": "shape1",
  "tags": ["fast"],
  "expected": 42
}
```

- `id`: `[A-Za-z0-9_-]+`, not used by another example; the page loads it as `?example=<id>`.
- `group`: `problems` (the other groups belong to the tutorial).
- `shape`: `shape1` … `shape4`, `reference` or `custom`.
- `tags`: `fast` makes `test/library.test.mjs` run the example and check `expected`
  (the solution count with `solutions = all`); use it when the run takes under ~2 s.
- `expected`: the solution count, or `null` when there is none to check.

Then rebuild and test:

```
node tools/make-examples.mjs        # writes examples/<id>.json and examples/library.json
node tools/run.mjs <id> --solutions all --quiet
cd test && npm test
```

`python3 tools/cegarcheck.py <file> --solutions all` checks a project with Python clingo
(compare with `--mode block`, the reference run).
