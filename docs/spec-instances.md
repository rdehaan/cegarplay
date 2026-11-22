# Instances specification

Format version 2 of a project (design: `docs/directions/instance-lab.md`). Suites and pools are
added in later phases (I3, I5).

## 1. Instances and variants

Keys (all optional; see the manual, "Instances", for the field table):

- `instances[]`: `{ id, facts, constants, expected: { solutions }, tags, recipe }`.
- `variants[]`: `{ name, loop, swap, constants, settings }`.
- `settings.instance`: the instance a run uses; absent = the first, `""` = none.

`load` accepts versions 1 and 2 (`VERSION = 2`) and validates these keys. A user fragment named
`instance` (possible before version 2) is renamed to `instance_facts`, also in the `solver`/`link`
lines of a loop script; the editor refuses the name. An instance with a `recipe` and no `facts`
keeps `facts` undefined, and `applyInstance` refuses it until the facts are generated. A
`settings.instance` naming no instance falls back to the first; an id passed explicitly must exist. The loaded project's `version` is 2 exactly when `usesV2` holds (a
non-empty list of `instances`, `generators`, `variants`, `suites`, `views` or `pools`, or a
`settings.instance`); `save` writes that version and drops empty lists, so a project that uses
none of them is byte-identical to a version 1 file.

Derived projects (`js/project.js`, DOM-free):

- `applyVariant(project, name)`: a clone; each `swap` entry gives fragment A the text of B (texts
  read before any swap), `loop` replaces the loop, `constants`/`settings` are merged. Sets
  `variant`.
- `applyInstance(project, id)`: a clone with the fragment `{ name: "instance", text: facts }`
  first and the instance's constants merged over the project's. Sets `instance`. The id defaults
  to `selectedInstance(project)`.
- `derive(project, { instance, variant })` = `applyInstance(applyVariant(...))`.

Runtime: `rt.solver` and `rt.link` put `"instance"` first in their fragment list when
`FRAGMENTS.instance` exists (`with_instance`). Validation adds `instance` to every fragment group.
`assemble` is unchanged: a project without instances assembles to the same text as before.

Every run path derives first: the page (`Control.run({ instance, variant })`, the instance picked
in the run bar by default), `tools/run.mjs` and `tools/audit.mjs` (`--instance`, `--variant`),
`test/helpers.mjs runProject(p, { instance, variant })`, the standalone export, and
`tools/cegarcheck.py --instance`. The run history's fragment hash includes the instance, so the ⚠
comparison only compares runs of the same instance.

## 2. Importers and checks (`js/instances.js`, DOM-free)

`(text, names) -> { facts, constants }`, `names` renaming the canonical predicates:

| Importer | Format | Facts |
| --- | --- | --- |
| `fromFacts` | `.lp` | as given |
| `fromDimacsGraph` | DIMACS `p edge N M`, `e U V` | `node(1..N)`, `edge(U,V)` |
| `fromQdimacs` | QDIMACS | `qblock(B, e|a)`, `qvar(V, B)`, `clause(C)`, `qlit(C, V, S)` (S = 1 positive) |
| `fromApx` | ASPARTIX | `arg/1`, `att/2` |
| `fromTgf` | Trivial Graph Format | `arg/1`, `att/2` |
| `fromPreflib` | PrefLib `.soc`/`.soi` strict orders | `ballot(V, (c1, c2, ...))` per voter |
| `fromJagg` | `[variables]` and `[clauses]` sections | `var/1`, `cl/1`, `pos/2`, `neg/2` |

`checkFacts(facts, engineRun, constants)` runs `clingo --mode=gringo` and returns the errors.
`checkSchema(project, id, engineRun)` runs the instance with the fragment `schema` and reads the
exit status (20 = unsatisfiable = violated).

## 3. Library

`graph-coloring` has the constants-only instances `n4` (1), `n5` (101) and `n6` (10,698, tag
`slow`), with `settings.instance = ""` (the project as written, n = 6). `af-preferred`, `qbf` and
`kemeny-control` keep their former facts as the instance `example`; `af-preferred` and `qbf` also
have three generated instances (`random-1..3`) whose counts agree between the loop and the
reference run. `test/instances.test.mjs` runs every instance with an expected count.

## 4. Generators

`generators[]`: `{ name, text, params: { name: "int" | "permille" }, defaults, description }`.
A recipe `{ generator, params, seed, attempts }` names one instance: the first accepted attempt
0, 1, ... (at most `attempts`, default 100) of the generator with `defaults` overridden by `params`.

Draws (`lua/draw.lua`; Python twin `tools/draw.py`, checked by `test/draw-vectors.json`, 200 values
written from Lua by `tools/make-draw-vectors.mjs`):

- `hash(seed, attempt, name, keys)`: a splitmix64-style mixer on 64-bit integers (Lua 5.4 wraps;
  Python masks), fed with `seed * 0x9e3779b97f4a7c15 + attempt`, the bytes of the function name,
  and for key i the mixed `h + i` followed by the bytes of the key's clingo text.
- A draw in `0..r-1` is `(hash >> 11) % r`: 53 bits, so the modulo bias of `@int` is below
  r / 2^53, that is below 2^-30 for ranges under 2^23.
- `flip`, `int`, `weighted`: one hash each. `perm` and `subset` build the whole permutation of 1..N
  once per key by Fisher–Yates (position j from N down to 2 swaps with `draw(j, "perm", (N, j, K...)) + 1`)
  and cache it for the attempt. `mallows` builds the ranking by repeated insertion: item k goes to
  place j of 1..k with weight `phi^(k-j)` kept as 30-bit integers (`x = 2^30; x = x * phi // 1000`),
  one draw per item; not Fisher–Yates.
- The functions form a context table passed to `ctl:ground(parts, context)` (the grounder calls
  `ctx.flip(ctx, P, K...)`), so seed and attempt are no globals. Every body runs inside `xpcall`;
  a bad argument (not an integer, an empty range, an index outside 1..N, `phi` outside 0..1000)
  sets `draw.error` and returns 0, and the runner reports it.

Runner (`lua/generate.lua`, `gen.run{ text, params, seeds, attempts }`): per attempt a fresh control
with the parameters as `-c` constants, ground with the context, at most two models read with
`h:iter()`. Output, one line per seed:

```
@@G {"attempt":0,"exact":true,"facts":"edge(1,5). ... node(7).","seed":1}
@@G {"error":"@flip: the probability must be an integer, got a","seed":1,"attempt":0}
@@G {"error":"no accepted draw in 100 attempts","seed":3}
```

`facts` is each shown symbol with a full stop, sorted as text (byte order), joined by one space:
valid ASP by construction. A draw error ends the run; a seed without an accepted draw does not.

JavaScript (`js/generate.js`, no DOM): `paramList(generator, params)`, `assembleGenerator(generator,
params, seeds, luaTexts)`, `generate(generator, params, seeds, luaTexts, engineRun) -> { results,
problems }`, `runRecipe(project, recipe, luaTexts, engineRun)`. `js/driver.js validateGenerator`
runs `clingo --mode=gringo` on the text behind a one-line stub script that defines the six
functions (each returning 0), so a syntax error or an unsafe variable is reported with its line in
the generator and never reaches `ctl:add`. `js/instances.js resolveInstance(project, id,
engineRun, luaTexts)` and `resolveProject(...)` turn a recipe into facts on demand, cached in
memory by a hash of generator text, parameters and seed; every run path (page, `tools/run.mjs`,
`tools/audit.mjs`, `test/helpers.mjs runProject`) resolves before `derive`. `tools/cegarcheck.py
--instance` generates with `tools/draw.py` and Python clingo.

Library (`tools/library.mjs GENERATORS`, attached by `tools/make-examples.mjs`): `gnp` (connected
G(n,p), reference rows 26 and 30), `gnm`, `af-gnp`, `qbf-dnf`, `ballots-ic`, `ballots-mallows`.
`clique-colouring`, `arrowing`, `choosability` and `af-semi-stable` moved their graph into the
instance `example`; `qbf` has the recipe instance `dnf-1` (8 solutions in its loop and in the
Reference template).

## 5. Suites and campaigns

`suites[]` (format v2): `{ name, instances, variants, solver_seeds, limits, where }`.

| Field | Meaning |
| --- | --- |
| `instances` | `{ ids: [...] }` or `{ ids: "all" }` (the default; a project without instances runs as written); `{ generator, grid: { param: [values] }, seeds: N, attempts }` (one recipe instance per grid point and seed 1..N, id `gen-n6-p300-s2`); `{ constants: { name: [values] }, base }` (one constants-only instance per grid point, id `n6-k3`, with the facts of instance `base` if given) |
| `variants` | variant names, `default` = the project as it is (default `["default"]`) |
| `solver_seeds` | N: settings.seed 0..N-1 (default 1) |
| `limits` | `{ seconds, candidates }` (default `{ seconds: 30 }`); every cell runs with all solutions, no trace |
| `where` | instance filters `solutions(v) <op> N`, `candidates(v) <op> N`, `outcome(v) == "..."` (`op` one of `== != >= <= > <`); the cells of the named variants run first, the other cells of an instance that fails a filter are stored as skipped |

`js/campaign.js` (no DOM): `expandSuite(project, suite)` -> cells `{ instance, variant, seed,
params, inst }`; `cellKey(project, cell, suite, engineVersion)` = SHA-256 (`crypto.subtle`) over the
derived project's fragments, loop and constants (for a recipe: the recipe, generator text and
defaults instead of the facts), the cell's settings (seed, limits, all solutions) and the engine
version; `inShard(key, { i, n })` (the key as a number, modulo n); `runSuite(project, suite,
{ runJob, store, onProgress, engineRun, luaTexts, runtime, modules, engineVersion, shard, jobs,
signal })` validates each variant once, resolves each recipe once, skips cells whose key is in the
store, runs `jobs` cells at a time; `Reducer` (last S, D, solution count, order-independent hash =
sum mod 2^32 of FNV-1a of each solution's sorted atoms); `inconsistencies(rows)` (exhausted
finished rows of one instance and seed with different hashes or counts); `scaling`, `growthFit`
(least squares of log median on x; factor per step, 90% bootstrap interval from 200 resamples),
`solvedCurves`.

Row (one JSON line each): `{ key, suite, instance, variant, seed, params, engine, outcome,
exhausted, detail, solutions, candidates, refinements, time, hash }`; a filtered cell:
`{ ..., skipped: "where", outcome: "skipped" }`; a variant that does not validate: `outcome:
"invalid"`.

`js/pool.js`: `Pool(size)` (default `hardwareConcurrency - 1`, at most 8), one `Engine` per slot,
`run(job)` with `job = { program, seconds }` (the normal backstop), `abortAll()`, `terminate()`.
`js/store.js`: `IdbStore` (database `cegarplay`, store `cells`, keyPath `key`), `MemoryStore`,
`exportRows`, `importRows`. `tools/bench.mjs <project> --suite NAME [--jobs N] [--shard i/n]
[--out file.jsonl] [--resume]`: worker threads with the same job interface; a job past its limit
+ 2 s terminates its thread.

Campaign tab (tab 10): suite list and JSON editor, Engines, Start (resumes: stored cells are
skipped), Pause (cells already started finish), Abort (aborts every engine of the pool), Export /
Import rows, Forget rows; a progress grid (one square per cell, coloured by outcome, red frame on
a disagreeing instance), a table per variant (cells, exhausted, median time and candidates, growth
fit), the disagreeing instances (also counted in the tab label "Campaign (k ✗)"), and four plots:
time against the first parameter that varies (median, interquartile band, log axis), a heat map
over two varying parameters, one variant against another per instance, solved within time.

Library: `tutorial-weak-relevant` has the variant `reference` (the Reference template) and the
suite `scaling` (n = 4..8; every n disagrees, n = 8: 11 against 61); `qbf` has the suite `random`
(qbf-dnf, t = 6, 8, 10, 12, five seeds each).
