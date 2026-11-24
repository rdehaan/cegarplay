# Instances specification

Format version 2 of a project (design: `docs/directions/instance-lab.md`). Suites and pools are
added in later phases (I3, I5).

## 1. Instances and variants

Keys (all optional; see the manual, "Instances", for the field table):

- `instances[]`: `{ id, facts, constants, expected: { solutions, optimum }, tags, recipe }`. `optimum`
  (whole number, list of them, or null) is the cost of every solution of a finished run, for
  optimisation loops that stop at their optimum (`expectedCheck` in `js/project.js`).
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
reference run. `test/instances.test.mjs` runs every instance with an expected count or optimum.

## 4. Generators

`generators[]`: `{ name, text, params: { name: "int" | "permille" }, defaults, constants, description }`.
`constants` (optional, since 2026-11-24): `{ name: value }` given to each instance of the generator,
under the instance's own; a value that names a parameter takes that parameter's value
(`generatorConstants` in `js/generate.js`; applied by `resolveInstance`, and written into the
instance by the page's **Add as instance** and **Write out its facts**, which store the facts as text).
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
with the parameters as `-c` constants and `--models=2 --project=show`, ground with the context,
at most two models read with `h:iter()` (a second model, which differs on the shown atoms, makes the
instance not `exact`). Output, one line per seed:

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
| `instances` | `{ ids: [...] }` or `{ ids: "all" }` (the default; a project without instances runs as written); `{ generator, grid: { param: [values] }, seeds: N, attempts, constants: { name: value } }` (one recipe instance per grid point and seed 1..N, id `gen-n6-p300-s2`, each with the given constants); `{ constants: { name: [values] }, base }` (one constants-only instance per grid point, id `n6-k3`, with the facts of instance `base` if given) |
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

## 6. Fuzz, shrink and diagnose

`js/fuzz.js` (no DOM), with `env = { engineRun, runtime, modules: { audit, ground, replay },
luaTexts }`:

- `defaultSource(project)`: a constants grid 1..v over each numeric constant (v <= 50); else all
  instances. `fuzzInstances(project, source)` orders a source (a suite's `instances` spec) by the
  product of its numeric parameters.
- `fuzz(project, { source, env })`: one audit per instance; the first `unsound` verdict stops the
  walk (`limit` and errors skip the instance). A script without an audit mode falls back to
  comparing solution hashes and counts with the variant `reference` (mode `compare`, said in
  `note`). Returns `{ found: { instance, params, verdict, project }, tried, mode, skipped, note }`.
- `shrinkInstance(plain, env)`: the instance facts normalised to one ground fact per item
  (`normaliseFacts`: `clingo --mode=gringo --text`), then `shrink` (ddmin; the tests of one round
  run `jobs` at a time) with the test "the `schema` fragment is satisfiable with the facts and the
  audit is unsound", then `shrinkConstants` lowers each numeric constant while the test holds.
- `diagnose(plain, verdict, env)`: the project's own loop with every step recorded. When the run
  lost the witness's solution: `Recording.firstViolated(solution)` for clause refinements; for an
  expand witness, the assemble mode `replay` (`lua/replay.lua`, `rt.replay`) grounds the recorded
  facts of each expansion on the solver and solves under the solution's interface values after
  each; the first unsatisfiable step is `culprit` (event `@@Y {"culprit", "steps"}`). When the run
  did not lose it (its search order avoided the bad refinement), the witness alone is reported.

Instances tab: **Fuzz** (source: the 1..v constants grid, else the first generator or constants
suite), a progress line, and a card with the minimal instance, the lost solution, the witness,
the culprit step, and "Open in trace" (runs the instance, opens Output), "Show audit witness"
(audits it), "Save as regression instance" (tag `regression`, expected = the audited count).

Measured: `tutorial-weak-relevant` over n = 1..8 stops at n = 2 (candidate `pick(1) pick(2)`, lost
`pick(2)`; this loop's own run finds `pick(2)` before the weak clause, so no culprit step at n = 2;
at n = 8 the run loses 50 of 61 and `firstViolated` names a step for each); the fixture with
`num/1` as eight facts shrinks to `num(1). num(2).` and n = 2 in 15 audits; `tutorial-first-run`
over n = 1..8 is sound; gc-shape3 with `:- cex(k,color(1,C)).` added: culprit expansion 1.

## 7. Pools and mining

**Pools** (`pools[]`, format v2): `{ name, domain, items }`, items = lists of atom texts (one list
per recorded counterexample). `validate` passes every item through `clingo --mode=gringo` as facts
(a bad item is an error before the run). `assemble` writes `POOLS[name] = { domain, items }` only
for a project with pools, and `SETTINGS.pools = "any"` with `settings.pools = "any"`.

- The loop language: `pool(name)` compiles to `rt.pool("name")`, a list of lists of symbols:
  `for P in pool(cex):` / `A.expand(refine, cex = P)`.
- The domain: `rt.pool_key(S, pred, arity)` = FNV-1a (32 bits) of the sorted texts of the atoms of
  pred/arity in solver S; `rt.domain_of(S, pred, arity)` = `"S:pred/arity:key"`. An expansion's `R`
  event carries it as `d` (the solver of the counterexample whose atoms were the facts, the
  predicate of the first fact). `rt.pool` compares a pool's domain with the run's and skips a
  pool recorded on another domain with a `W` message (a colouring of six nodes replayed on seven
  nodes would demand too much), unless `settings.pools = "any"`. Counter `pool items`.
- "Save counterexamples as pool" (Statistics tab, run history) turns the recorded expansions of
  the last run into one pool per fact name.

**Mining** (`js/mine.js`, `mine(project, { source, objective, budget, keep, seconds, rounds,
mutations, env })`): stage 1 successive halving over the instances of a generator grid (run all
under a short time limit, keep the best third, triple the limit, repeat); stage 2 removes single
facts of the best three, kept when `schema` holds and the objective rises. Objectives:
`candidates-per-solution`, `clauses`, `time`, or `{ ratio, of, over }` (two variants). Results:
instances `hard-<id>` with tag `hard`, the recipe and its `mutations` (`- fact.` removes a
generated fact, `+ fact.` adds one; applied by `resolveInstance`), the score and the median score
of its grid cell.

Measured (`test/pool.test.mjs`): gc-shape4 warm-started from a pool of 226 counterexamples
recorded under seed 7: 101 solutions, 101 check calls against 327 cold; at n = 4 the pool is
skipped; mining qbf (t = 6, 8, 10, 12, eight seeds, 60 runs): the best instance has 10 candidates
per solution, 1.9 times the median of its cell. The importers apx, tgf, preflib and jagg were
built in I1 (`test/instances.test.mjs`).

## 8. Spaces (PLAN3 phase S7, optional)

A **space** describes every instance up to a bound, for the bounded verification of a loop's
refinement strategy (`docs/spec-soundness.md` section 8). Nothing else uses spaces; a project
without them loads, saves (byte-identical) and runs as before.

`spaces[]`: `{ name, text, params: { name: "int" }, bound, defaults, ranges, regression, from, description,
expected: { verdict, k } }`.

- `ranges` (optional, 2026-11-24): `{ name: [lo, hi] }` for parameters other than the bound;
  `spaceCombos(space)` (`js/project.js`) lists the combinations (fixed defaults and each ranged
  value; at most 1,000) and `verifySpace` audits each at each k, returning the failing `params`.
- `regression` (optional): `{ name: false }` keeps that constant out of a regression instance
  saved from a witness (`spaceKeeps`).

- `text` replaces the instance: choice rules and constraints over the instance predicates
  (`node(1..size). { edge(U,V) : node(U), node(V), U < V }.`). A project's `schema` fragment is
  added to it. An empty text with one parameter is the constants family (n = 1, 2, ...).
- `params`: at least one, all `int`. They are passed as constants to every solver (as generator
  parameters are): pick names that no fragment uses as a constant. `bound` names the bound
  parameter (default: the first); `defaults` give the others; `from` is the first k (default 1;
  for a space whose smallest instances have no interface, such as one node and no pair).
- `expected` (library): the bounded verdict (`sound`, `unsound`, `budget`, `unsupported`) and the
  k it is reached at (`sound`: the last k checked).

`load` validates the keys (format version 2; `usesV2` counts `spaces`); `save` drops an empty
list. `deriveSpace(project, name, params, { variant })` (`js/project.js`) is the plain project of
one bound: the fragment `instance` = the space text (+ schema), constants = defaults, then params;
no instance or variant left to apply. `validateSpace` (`js/driver.js`) runs clingo in gringo mode
on the text with the parameters as constants before any `ctl:add`; `spaceProblems` (`js/bounded.js`)
calls it at the space's first k. `verifySpace(project, { space, from, to, seconds, env })`
(`js/bounded.js`, DOM-free) runs one symbolic audit per k and returns `{ verdict, k, witness,
reason, perK: [{ k, verdict, rounds, refinements, t }] }`.

Library: `SPACES` and `SPACE_TEXTS` in `tools/library.mjs`, attached by `tools/make-examples.mjs`.
The instance field `symbolic: "sound" | "unsound"` (written by `make-examples` from `SYMBOLIC`)
is the expected verdict of the symbolic audit on that instance.

The page: Audit's mode select (Enumerate, Symbolic, Space; Space only for a project with spaces,
with the space and the bound k); the Instances tab lists the spaces (name, bound, description,
text, parameters, Check). A space audit's witness instance can be saved as a regression
instance. The CLI: `node tools/audit.mjs <id> --space NAME --bound K [--from K0]`.
