# Instances specification

Format version 2 of a project (design: `docs/directions/instance-lab.md`). Generators, suites
and pools are added in later phases (I2, I3, I5).

## 1. Instances and variants

Keys (all optional; see the manual, "Instances", for the field table):

- `instances[]`: `{ id, facts, constants, expected: { solutions }, tags, recipe }`.
- `variants[]`: `{ name, loop, swap, constants, settings }`.
- `settings.instance`: the instance a run uses; absent = the first, `""` = none.

`load` accepts versions 1 and 2 (`VERSION = 2`), validates these keys, and rejects a user
fragment named `instance`. The loaded project's `version` is 2 exactly when `usesV2` holds (a
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
