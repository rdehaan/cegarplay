# CegarPlay technical manual

This manual describes CegarPlay completely and precisely, for lookup. It is written for people
who already know the basics (the **Tutorial** tab teaches them) and for AI agents that write,
validate and run CegarPlay projects. How to design a loop, step by step and with measured examples,
is taught by the [design guide](guide/). The raw Markdown is served at `manual.md`; `llms.txt` points
to it.

CegarPlay runs CEGAR loops (counterexample-guided abstraction refinement) written in answer set
programming. The solver is clingo 5.8.1 with Lua 5.4, compiled to WebAssembly
(`clingo-wasm` 0.6.0), running in a Web Worker. The site is static: no server code, no build step,
no request to another origin.

The page's tabs follow the work: **Control** (the library, files, recordings, share and export) and
**Tutorial**; then the project: **Programs** (the ASP fragments), **Loop** (the loop script,
constants, limits, recording and certificates) and **Instances** (inputs, generators, Run all,
Fuzz); then a run: **Output**, **Statistics** and **Observatory**; and many runs: **Campaign**. The
run bar above the tabs holds **Run**, **Audit**, Abort (and Pause, Step, Stop on an isolated page),
the Solutions and Instance pickers and the live counts. **Manual** and **Internals** appear when
asked for. The Control tab's **Tabs** block has three toggles, kept in this browser: **Tutorial**
(shown by default), **Technical manual**, and **Advanced mode** (off by default), which adds the
Observatory and Campaign tabs. A link that opens one of these tabs (`?tab=2`, `?tab=10`, `?tab=11`,
`?lecture=1`, `?view=`, `?step=`, `?advanced=1`, a link to a tutorial lesson) shows it for that
visit without changing the stored choice.

## Model and terms

| Term | Meaning |
| --- | --- |
| fragment | A named piece of ASP text (a gringo program). A project has an ordered list of fragments. |
| solver | One `clingo.Control` object, built from one or more fragments, with its own options. Declared in the loop script: `solver A = shared + abstraction`. |
| link | A connection from one solver to another: `link G = A -> C via shared + glue`. It defines the *interface atoms*: the atoms `T` for which the glue fragments derive `glue(T)`. |
| interface atom | An atom of the source solver whose value is passed to the target solver as an assumption. Facts of the source are passed as facts and are not interface atoms. |
| candidate | A model of a solver with outgoing links (usually the abstraction solver `A`). |
| check | A solve of the target solver under the candidate's values of the interface atoms. |
| counterexample | A model found by the check. It shows that the candidate is not a solution. |
| relevant atom | An interface atom `T` with `relevant(T)` true in the counterexample: the counterexample depends on its value. |
| refinement | What is added to the source solver after a counterexample: a clause (one of the relevant atoms must change), a list of clauses, or new rules grounded from a `#program part(k).` |
| solution | A candidate for which the check finds no counterexample (or that the script accepts). |
| run | One execution of the loop script, from grounding to the final event. |

The usual setup has four fragments and two solvers:

- `shared`: domains and definitions every solver needs;
- `abstraction`: proposes candidates; every solution must be a candidate (over-approximation);
- `glue`: lists the interface atoms as `glue(T)`;
- `check`: has an answer set exactly when the candidate (given by the interface atoms) is wrong,
  and marks with `relevant(T)` the interface atoms the counterexample depends on.

Soundness depends on `relevant/1`: a clause built from too few relevant atoms also removes good
candidates. The reference run (`G.block(M)` only) is always sound; compare with it on small
instances. See [Troubleshooting](#manual-troubleshooting).

## Project file format

A project is one JSON file (`format: "cegarplay"`). `Project.load` in `js/project.js` validates it,
fills defaults, and keeps unknown keys so that they survive a save. `Project.save` writes it with
two-space indentation.

```json
{
  "format": "cegarplay",
  "version": 1,
  "title": "Sum-free sets",
  "description": "One sentence shown under the title.",
  "fragments": [
    { "name": "shared", "text": "num(1..n).\n", "description": "Added to every solver." },
    { "name": "abstraction", "text": "{ pick(X) : num(X) }.\n#show pick/1.\n" },
    { "name": "glue", "text": "glue(pick(X)) :- num(X).\n" },
    { "name": "check", "text": "..." }
  ],
  "loop": { "language": "loop", "text": "solver A = shared + abstraction\n..." },
  "settings": {
    "constants": { "n": "8" },
    "solutions": 0,
    "seconds": 60,
    "candidates": 0,
    "trace": 200,
    "seed": 0
  },
  "runs": []
}
```

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `format` | string | (required) | Must be `"cegarplay"`. A file with logic-game keys is rejected as a logic-game file. |
| `version` | number | 1 | 1, or 2 when a key of format version 2 is used (see [Instances](#manual-instances)). A version above 2 is rejected (newer than this CegarPlay). |
| `title` | string | `"Untitled"` | Shown in the Control tab and the page title. |
| `description` | string | `""` | Shown under the title. |
| `fragments` | list | (required) | Ordered (tab order in the Programs tab). |
| `fragments[].name` | string | (required) | Matches `[a-z][a-z0-9_]*`; unique. |
| `fragments[].text` | string | `""` | ASP text. |
| `fragments[].description` | string | none | Optional; shown above the editor. |
| `loop.language` | `"loop"` or `"lua"` | `"loop"` | Any other value is rejected. |
| `loop.text` | string | the Shape 1 template | The loop script, or raw Lua. |
| `settings.constants` | object of strings | `{}` | Passed as `-c name=value` to every solver and to validation. Values are turned into strings. |
| `settings.solutions` | number | 1 | Number of solutions to look for; 0 = all. |
| `settings.seconds` | number | 60 | Time limit in seconds; 0 = none. |
| `settings.candidates` | number | 0 | Candidate limit; 0 = none. |
| `settings.trace` | number | 200 | Number of trace steps recorded; 0 = off. |
| `settings.seed` | number | 0 | Passed as `--seed=N` unless 0. |
| `runs` | list | `[]` | Final statistics of earlier runs (Statistics tab, run history). Written only when "include run history" is ticked on download. |
| `instances` | list | none | Format version 2. See [Instances](#manual-instances). |
| `variants` | list | none | Format version 2. See [Instances](#manual-instances). |
| `settings.instance` | string | the first instance | The instance a run uses; `""` = the project as written. |
| `settings.variant` | string | none | The variant a run uses (the run bar's Variant picker); absent or `""` = the project as it is; a name that is no variant is ignored. Dropped on save when the project has no variants. |

### Instances

An **instance** is a set of facts plus constant values that a run applies on top of the project.
The facts reach every solver and every link's glue control as a fragment named `instance` (put
first; the name is reserved: a fragment of an older project called `instance` is renamed to
`instance_facts` on load, with its uses in the script's declarations), and the instance's constants
override the project's. A `settings.instance` that names no instance falls back to the first. Messages from
clingo about an instance fact name `instance:<line>`. The loop language does not change.

```json
"instances": [
  { "id": "triangle", "facts": "node(1). node(2). node(4). edge(1,2). edge(1,4). edge(2,4).",
    "constants": { "k": "3" }, "expected": { "solutions": 7 }, "tags": ["regression"] }
],
"variants": [
  { "name": "reference", "swap": { "check": "check_block" }, "loop": "solver A = ...", "constants": { "k": "2" } }
]
```

| Field | Rules |
| --- | --- |
| `instances[].id` | Matches `[A-Za-z0-9_-]+`; unique. |
| `instances[].facts` | ASP text (facts, or any rules). |
| `instances[].constants` | Object of strings; override `settings.constants`. |
| `instances[].expected.solutions` | Whole number or null: the solution count of an exhausted run with all solutions (checked by "Run all", `--instance all` and the library tests). |
| `instances[].tags` | List of strings (`slow` instances are skipped by the default test run). |
| `instances[].recipe` | `{ generator, params, seed }`: the facts come from a generator (below) when a run uses the instance; a file stores the recipe only. |
| `variants[].name` | Matches `[A-Za-z0-9_-]+`; unique; not `default`. |
| `variants[].loop` | A loop script (string) or `{ language, text }` that replaces the project's. |
| `variants[].swap` | Fragment name to fragment name: the first gets the text of the second. |
| `variants[].constants`, `variants[].settings` | Merged into the project's. |

A project without any of these keys is saved with `"version": 1`, so older pages still open it;
with a non-empty one it is saved as version 2. `js/project.js` exports `applyInstance(project, id)`,
`applyVariant(project, name)` and `derive(project, { instance, variant })` (variant first), which
return the plain project of one run. An optional fragment named `schema` holds constraints every
instance must satisfy (`checkSchema` in `js/instances.js`).

The **Instances** tab (tab 9) lists the instances with their tags, expected count and the count of
their last run; it edits facts, constants, expected count and tags; **Import file** reads facts
(`.lp`), DIMACS graphs (`.col`: `node/1`, `edge/2`), QDIMACS (`qblock/2`, `qvar/2`, `clause/1`,
`qlit/3`), ASPARTIX (`.apx`: `arg/1`, `att/2`), Trivial Graph Format (`.tgf`: `arg/1`, `att/2`),
PrefLib strict orders (`.soc`, `.soi`: `ballot/2` as `kemeny-control` writes them) and jaggpy
scenarios (`.jagg`: `var/1`, `cl/1`, `pos/2`, `neg/2`); each importer is checked with clingo before
the instance is added. **Run all** runs every instance and marks a count other than the expected one
with ✗ in red. The run bar's **Instance** picker (shown only for a project with instances) chooses
the instance of the next run; the run history names it in brackets.

### Variants

A variant runs the same project with other fragments swapped in, its own loop script, or other
constants (the table above). The **Variants** block at the foot of the Loop tab edits them: a name,
**Swap** as `fragment=other fragment, ...` (the first fragment gets the text of the second; names
are checked), **Constants** as `name=value, ...`, and **its own loop script** (a text box that
starts as a copy of the project's loop). A renamed or deleted fragment is renamed in, or dropped
from, every swap; a renamed or deleted variant also in the suites. The run bar's **Variant** picker
(shown only for a project with variants) chooses the variant of a run, an audit and Run all, and
is stored as `settings.variant`; the run history adds `(variant NAME)`. Alternative fragments
that only a variant uses are not grounded by the project as it is. `tools/run.mjs` and
`tools/audit.mjs` take `--variant NAME` (without it, `settings.variant`); a campaign suite names
its variants (`default` = the project as it is) and ignores the picker.

`voting-justification` is the worked example: its check solver reads the fragment `relevant`
(refinement strategy 2), the fragments `relevant_s1`, `relevant_s3`, `relevant_s4` and
`relevant_s5` hold the other strategies of the original file, the variants `s1` … `s5` swap them
in, `shape2` and `reference` replace the loop, and the suite `strategies` runs all seven on the 15
questions that finish.

### Campaigns

The **Campaign** tab (tab 10) runs a suite: a grid of instances (instance ids, a generator grid
with seeds, or a grid over constants) × variants × solver seeds, every cell with all solutions,
several engines at a time. Rows are kept in this browser (IndexedDB), so **Start** after a reload
runs only the missing cells; an edit of a fragment, the loop or a constant changes the keys of
exactly the cells it touches. Instances whose exhausted variants disagree are marked red (the run
history's ⚠, for a whole grid). Plots: time against a parameter (median and interquartile band),
a heat map over two parameters, one variant against another, solved within time; a growth factor
per variant with a 90% interval. `node tools/bench.mjs <project> --suite NAME [--jobs N]
[--shard i/n] [--out rows.jsonl] [--resume]` runs the same suite headless; **Import rows** reads
its file. Format: `docs/spec-instances.md` section 5.

```json
"suites": [ { "name": "scaling", "instances": { "constants": { "n": [4, 5, 6, 7, 8] } },
              "variants": ["default", "reference"], "limits": { "seconds": 30 },
              "where": ["solutions(reference) >= 1"] } ]
```

### Fuzz

**Fuzz** (Instances tab) audits instances from small to large (constants 1..v, or a suite's grid; with the variant picked in the run bar),
stops at the first unsound one, shrinks its facts and constants (delta debugging, keeping the
`schema` fragment satisfied and the audit unsound) and diagnoses it: the lost solution, the
audit's witness, and the step of the loop's own run whose refinement removes the solution (for
`expand` loops, a replay of the recorded expansions). The card saves the instance as a regression
instance with its true count. Details: `docs/spec-instances.md` section 6.

### Pools and mining

A **pool** stores counterexamples of a run as lists of atoms ("Save counterexamples as pool" in
the run history, after a run with expansions recorded); `for P in pool(cex): A.expand(refine, cex
= P)` replays them as a warm start. A pool is keyed by its check domain: on an instance with
another domain it is skipped with a message (`settings.pools = "any"` uses it anyway, at your own
risk: check with Audit). `js/mine.js` searches a generator grid for hard instances (successive
halving, then single-fact mutations) and returns them as `hard` instances with their recipe.

### Generators

A **generator** is an ASP program whose shown atoms are an instance. Randomness enters through six
seeded draw functions, evaluated while grounding; rules shape the instance and constraints filter
it: an unsatisfiable draw is redrawn with the next attempt number (at most 100).

```json
"generators": [
  { "name": "gnp", "params": { "n": "int", "p": "permille" }, "defaults": { "n": 7, "p": 300 },
    "text": "node(1..n).\nedge(X,Y) :- node(X), node(Y), X < Y, @flip(p, X, Y) = 1.\n#show node/1.  #show edge/2.\n" }
],
"instances": [ { "id": "gnp-s1", "recipe": { "generator": "gnp", "params": { "n": 7 }, "seed": 1 } } ]
```

| Function | Value |
| --- | --- |
| `@flip(P, K...)` | 1 with probability P/1000, else 0 |
| `@int(Lo, Hi, K...)` | a uniform integer in Lo..Hi |
| `@weighted((W1, ..., Wm), K...)` | index i with probability Wi / (W1 + ... + Wm) |
| `@perm(N, I, K...)` | the image of I under a uniform permutation of 1..N named by K |
| `@subset(M, N, I, K...)` | 1 if I lies in a uniform M-subset of 1..N named by K |
| `@mallows(N, Phi, I, K...)` | the position of I in a Mallows ranking of 1..N with dispersion Phi/1000 |

Every draw is a pure function of the seed, the attempt, the function's name and the key terms `K`,
so the instance does not depend on the order of the rules (use different keys for independent
draws). Parameters are constants of type `int` or `permille` (0..1000); a recipe's `params` override
the generator's `defaults`. An instance is **exact** when its program has one model (the drawn facts
follow the stated distribution, conditioned on acceptance) and **solver-completed** when it has
more (clingo returns some model, not a uniform one). A bad argument (`@flip(a, 1)`) stops the
generator with a message. The Instances tab has a generator list and editor, a parameter table, a
seed and **Preview 6** (six instances from six seeds, with attempt and label); **Add as instance**
stores the recipe. `tools/draw.py` is the Python twin used by `tools/cegarcheck.py --instance`; both
give byte-identical facts. Library generators: `gnp`, `gnm` (`clique-colouring`, `arrowing`,
`choosability`), `af-gnp` (`af-preferred`, `af-semi-stable`), `qbf-dnf` (`qbf`), `ballots-ic` and
`ballots-mallows` (`kemeny-control`).

`Project.load` errors (exact texts): `not a JSON file: ...`, `not a CegarPlay project: expected a
JSON object`, `this is a logic-game file, not a CegarPlay project`, `not a CegarPlay project (format
is ..., expected "cegarplay")`, `project version N is newer than this CegarPlay (2)`, `fragments must
be a list`, `instance N: id
must match [A-Za-z0-9_-]+`, `duplicate instance id '...'`, `variant ...: swap names an unknown
fragment (... -> ...)`, `fragment N is not an object`, `fragment N: invalid name "..." (use lower case letters,
digits and _)`, `duplicate fragment name '...'`, `loop.language must be "loop" or "lua"`.
A negative or non-numeric value of `solutions`, `seconds`, `candidates`, `trace` or `seed` is
replaced by its default without an error.

## ASP conventions

### glue/1: the interface

A link's glue fragments are grounded and solved once, on their own (with the constants). Every
shown atom `glue(T)` of the first answer set makes `T` an interface atom of the link. Atoms `T` that
are facts in the source solver are passed to the target as facts; the others become assumptions.

```asp
glue(pick(X)) :- num(X).
glue(edge(N,M)) :- node(N), node(M), N < M.
```

- The glue fragments must derive at least one `glue/1` atom, or the run fails with
  `link G: the glue fragments derive no glue/1 atom`.
- An interface atom that does not occur in the source solver's ground program is ignored.
- With the link keyword `legacy`, every shown atom that is not `glue/1` is also an interface atom
  (files written for `cegar.py`, which list the atoms without `glue(...)`).

### relevant/1: what a counterexample depends on

For each non-fact interface atom `T`, the target solver gets an atom `relevant(T)`. It is false
unless a rule of the target derives it. In a counterexample `X`, the atoms with `relevant(T)` true
are the ones `G.clause(M, X)` uses.

```asp
relevant(pick(X)) :- sum(X,Y).
relevant(pick(Y)) :- sum(X,Y).
relevant(pick(X+Y)) :- sum(X,Y).
```

- If no `relevant/1` atom is true in a counterexample, `G.clause` fails with
  `relevant/1 derived nothing for link G`.
- The more atoms are relevant, the weaker (but safer) the clause. Marking every interface atom is
  the same as `G.block(M)`.
- With the link keyword `compat`, `relevant(T)` is a free choice in the target, as in the Python
  prototype. Use it only to reproduce `cegar.py` numbers.
- `#minimize { 1,T : relevant(T) }.` in the check together with `C.solve(assume G(M), optimal)`
  gives the counterexample with the fewest relevant atoms.

### #program refine(k): rules per counterexample

A solver's fragments may contain a parametrised part. `S.expand(refine, cex = X.atoms(color/2))`
adds the facts `cex(k, T)` for every atom `T` and grounds `refine(k)` with the next `k` (1, 2, ...).

```asp
#program refine(k).
broken(k) :- edge(N,M), N < M, cex(k,color(N,C)), cex(k,color(M,C)).
broken(k) :- leaf(N), leaf_color(N,C), not cex(k,color(N,C)).
broken(k) :- leaf(N), cex(k,color(N,C)), not leaf_color(N,C).
:- not broken(k).
```

- Every head in the part must contain `k`. clingo does not complain when a later step defines an
  atom that an earlier step already defined: the new rules are silently ignored, so the second
  refinement has no effect (and Shapes 2 and 3 stop with the no-progress guard).
- The validation checks that `#program refine(` occurs in a fragment of the solver that is
  expanded: `no fragment of solver A contains '#program refine(k).'`.
- Each fragment is added after its own `#program base.` line, so a part at the end of one fragment
  does not swallow the next fragment.

### clause/3: refinements written in ASP

`G.clauses(X)` reads clauses from the atoms `clause(Id, T, true)` and `clause(Id, T, false)` true in
`X`: one clause per `Id`. `T` must be an interface atom of `G`. `true` puts the positive literal of
`T` in the clause (T must become true), `false` the negative one.

```asp
% one clause: one of the three numbers must leave the set
clause(1, pick(X), false) :- sum(X,Y).
clause(1, pick(Y), false) :- sum(X,Y).
clause(1, pick(X+Y), false) :- sum(X,Y).
```

### Constants

`settings.constants` (the Constants table in the Loop tab) gives each solver, each link's glue
control and the validation the options `-c name=value`. Names match `[a-z][A-Za-z0-9_]*`; values are
non-empty and contain no white space or quotes. Use `#const n = 4.` in a fragment for a default that
the table overrides.

Do not name a constant like the parameter of a program part: with a constant `k`, `-c k=...`
replaces the `k` of `#program refine(k).`, every expansion defines the same atoms, and the loop
loses solutions or stops with the no-progress guard. The same goes for `expand` fact names that are
keywords of the loop language (`limit`, `count`, `by`, `optimal`, `assume`, ...).

### Showing atoms

Solutions are printed as the shown atoms of the candidate's model (`#show` in the abstraction).
Without any `#show`, all atoms are shown. Counterexamples in the trace show the shown atoms of the
check's model.

## The loop language

A loop script declares solvers and links, then says how they call each other. It is compiled to
Lua by `js/compiler.js` (each statement becomes one Lua statement) and runs inside clingo's Lua.
The compiler runs 500 ms after each edit in the Loop tab and marks errors at once.

### Lexical rules

- Indentation-based, like Python. Spaces only; a tab is an error. Blank lines and comment-only
  lines are ignored.
- Comments: `#` to the end of the line.
- Names: `[A-Za-z_][A-Za-z0-9_]*`. Numbers: integers or decimals. Strings: double quotes, with `\"`
  and `\\` escapes.
- Keywords: `solver link via options legacy compat if elif else loop while repeat until for in
  search on candidate reject with accept restart stop break continue count by log assume limit
  optimal and or not true false none`.
- Reserved names (cannot be declared or assigned): every Lua keyword, `rt`, `clingo`, `FRAGMENTS`,
  `CONSTS`, `SETTINGS`, `main`, `ipairs`, `_`, and names starting with `__`.

### Grammar

```
script  := { decl } { stmt }
decl    := "solver" NAME "=" frags [ "options" STRING ] NEWLINE
         | "link" NAME "=" NAME "->" NAME "via" frags { "legacy" | "compat" } NEWLINE
frags   := NAME { "+" NAME }
stmt    := NAME "=" expr NEWLINE
         | "if" expr ":" block { "elif" expr ":" block } [ "else" ":" block ]
         | "loop" ":" block
         | "while" expr ":" block
         | "repeat" ":" block "until" expr NEWLINE
         | "for" NAME "in" expr ":" block
         | "search" NAME ":" NEWLINE INDENT "on" "candidate" NAME ":" block DEDENT
         | "reject" NAME "with" expr NEWLINE
         | "accept" NAME NEWLINE
         | "restart" NEWLINE | "break" NEWLINE | "continue" NEWLINE
         | "stop" [ STRING ] NEWLINE
         | "count" NAME [ "by" expr ] NEWLINE
         | "log" expr { "," expr } NEWLINE
         | expr NEWLINE
block   := simple_stmt                  (on the same line; not a compound statement)
         | NEWLINE INDENT stmt { stmt } DEDENT
expr    := disj
disj    := conj { "or" conj }
conj    := neg { "and" neg }
neg     := [ "not" ] cmp
cmp     := sum [ ("==" | "!=" | "<" | "<=" | ">" | ">=") sum ]
sum     := term { ("+" | "-") term }
term    := unary { ("*" | "/") unary }
unary   := [ "-" ] post
post    := atom { "." NAME [ "(" [ args ] ")" ] | "(" [ args ] ")" }
atom    := NAME | NUMBER | STRING | "true" | "false" | "none" | "[" "]" | "(" expr ")"
args    := arg { "," arg }
arg     := "assume" expr | "limit" expr | "optimal" | NAME "=" expr | NAME "/" NUMBER | expr
```

All declarations come before the first statement. In `frags`, `+` separates fragment names.

### Declarations

| Script | Meaning |
| --- | --- |
| `solver A = shared + abstraction` | A solver that grounds these fragments, in this order. |
| `solver C = shared + check options "--heuristic=Domain"` | The option string is split on white space and passed to `clingo.Control` (plus `--stats`, the constants and the seed). |
| `link G = A -> C via shared + glue` | A link from `A` to `C`; its interface atoms come from `glue/1` in these fragments. |
| `link G = A -> C via shared + glue legacy` | Shown atoms that are not `glue/1` are interface atoms too. |
| `link G = A -> C via shared + glue compat` | `relevant(T)` is a free choice in `C` (Python prototype behaviour). |

A solver may have several outgoing and incoming links. A link's target must not have been grounded
before the link is declared (declarations are processed in order, then all solvers are grounded).
`-t N` in `options` needs the threaded engine (see [Settings](#manual-settings)).

### Statements

| Script | Meaning |
| --- | --- |
| `x = e` | Assign a variable. Variables are local to the main script or to one `on candidate` block. |
| `if a: ... elif b: ... else: ...` | Conditional. Only `false` and `none` are false (0 and `[]` are true). |
| `loop:` | Repeat forever; leave with `break` or `stop`. |
| `while e:` | Repeat while `e` is true. |
| `repeat: ... until e` | Run the block, then stop once `e` is true. |
| `for x in e:` | Run the block for each element of the list `e`. |
| `break`, `continue` | Leave the innermost loop; go to its next round. |
| `search A:` / `on candidate M:` / block | Run `A`'s own search; call the block for every candidate `M` (a total assignment). A candidate that is not rejected is a solution. |
| `reject M with e` | Add the clause (or list of clauses) `e` to the searching solver. Only inside `on candidate`, naming its candidate variable. Several `reject`s of one candidate are allowed: the first clause is added at once, the rest at the next check. |
| `accept M` | Count the model `M` as a solution and print it (for models from `solve`/`models`). Inside a search it does nothing: not rejecting already accepts. When the wanted number of solutions is reached, the run ends with outcome `solutions`. |
| `restart` | Only inside `on candidate`: end the current search early. The next `search` starts afresh; the solutions found so far are not reported again. |
| `stop` | End the run with outcome `finished`. |
| `stop "msg"` | End the run with outcome `stopped` and the message as detail. |
| `count n by e` | Add `e` (default 1) to the custom counter `n` (Statistics tab, Custom counters). |
| `log a, b` | Print the values, separated by spaces, to the Messages in the Output tab. |
| `e` | An expression statement must be a call (such as `A.add(c)`). |

A block may follow the colon on the same line if it is one simple statement: `if not M: stop`.

### Expressions

| Script | Value |
| --- | --- |
| `S.solve()` | One solve of `S` without assumptions: a model, or `none` if unsatisfiable. |
| `S.solve(assume E)` | Solve under the assumption list `E` (usually `G(M)`). |
| `S.solve(assume E1, E2)` | Every positional argument after `assume E1` is one more assumption list. |
| `S.solve(assume E, optimal)` | With a `#minimize` in `S`: the optimal model. |
| `S.models(assume E, limit n)` | A list of up to `n` models (empty if unsatisfiable). |
| `S.add(c)` | Add a clause or a list of clauses to `S` before its next solve. Not inside `on candidate` of `S`. |
| `S.expand(refine, cex = L)` | Add the facts `cex(k, T)` for each atom `T` in the list `L`, then ground `refine(k)` with the next `k`. More named lists are allowed: `S.expand(refine, cex = L1, old = L2)`. Not inside `on candidate` of `S`. |
| `S.exhausted` | Whether the last search of `S` ran to the end (not interrupted, model limit not reached). |
| `S.step` | The number of expansions of `S` so far (the last `k`). |
| `G(M)` | The values of `G`'s interface atoms in `M`, as an assumption list for `G`'s target (a new list: it can be stored). Passing it to another solver is an error (`A.solve: the assumptions of G are for solver C`). |
| `G.clause(M, X)` | Clause: one interface atom with `relevant(T)` true in `X` must change its value from `M`. Error if there is none. |
| `G.block(M)` | Clause: at least one interface atom must change (rules out exactly `M`'s interface values). |
| `G.core(C)` | Clause from the unsat core of the last solve of `C` (the target of `G`), which must have been unsatisfiable: one of the assumed values in the core must change. |
| `G.clauses(X)` | The list of clauses stated by `clause/3` atoms in `X`. |
| `X.atoms(p/n)` | The list of true atoms of predicate `p/n` in model `X`, also for a candidate `M` inside `on candidate` (read from the current assignment). Every `p/n` used in the script is recorded automatically. |
| `[]`, `l.push(e)`, `l.size`, `l.clear()` | A new empty list; append; its length; empty it. |
| `none`, `true`, `false` | The values. `none` is what `solve` returns when unsatisfiable. |
| `==`, `!=`, `<`, `<=`, `>`, `>=`, `+`, `-`, `*`, `/`, `and`, `or`, `not` | As usual (Lua semantics). |

Models and lists can be stored in variables and lists. A candidate `M` inside `on candidate` is
valid only during that call; store `G(M)`, `M.atoms(p/n)` or a counterexample `X` instead. Using a
stored candidate later is an error: `G.block: the candidate is no longer valid (it belongs to an
earlier step); store G(M) or a counterexample instead`.

### Static errors

The compiler reports every error it can find in one pass (a parse error may stop the pass), each
with line and column. Messages (with `...` for names):

- Lexical: `tabs are not allowed; indent with spaces`, `inconsistent indentation: this line matches
  no enclosing block`, `unterminated string`, `unexpected character '...'`.
- Declarations: `unknown fragment '...' (fragments: ...)`, `'...' is not a declared solver`,
  `a link needs two different solvers`, `duplicate declaration of '...'`, `'...' is a reserved name
  and cannot be used as ...`.
- Names: `unknown name '...'` (never assigned and not declared), `'...' is a solver and cannot be
  assigned`, `'...' is a solver or link and cannot be a loop variable`, `... cannot be the candidate
  variable`.
- Placement: `'reject' works only inside 'on candidate'`, `'reject' must name the candidate variable
  '...'`, `'restart' works only inside 'on candidate'`, `'search' cannot be nested inside 'on
  candidate'`, `'break' outside a loop`, `'continue' outside a loop`, `A.add cannot be used inside
  'on candidate' of A; use reject`, `A.expand cannot be used inside 'on candidate' of A; collect the
  counterexamples and expand after the search`.
- Members: `unknown member '...' of solver S; valid: ...`, `unknown member '...' of link G; valid:
  ..., and G(M)`, `unknown member '...'; valid for models and lists: ...`, `S.solve must be called`,
  `S.exhausted is not a method`, `'size' is not a method: write l.size`.
- Arguments: `S.solve: write 'assume' before the first assumption list`, `'assume' given twice`,
  `unexpected argument 'limit' (only models takes a limit)`, `unexpected argument 'optimal' (only
  solve can be optimal)`, `G.clause takes two arguments`, `G.core takes the check solver, as in
  G.core(C)`, `atoms takes one predicate, as in X.atoms(color/2)`, `S.expand: the first argument is
  the name of a program part, ...`, `S.expand: facts are given as name = atoms`.
- Statements: `this expression does nothing; a statement must be an assignment, a call or a command`.

Before a run, the validation adds: `no fragment of solver S contains '#program part(k).'` and, without
threads, `solver S: the option -t needs the threaded engine ...`.

### How it compiles

| Script | Lua |
| --- | --- |
| `solver A = shared + abstraction options "-t 2"` | `local A = rt.solver("A", {"shared", "abstraction"}, {"-t", "2"})` |
| `link G = A -> C via shared + glue legacy` | `local G = rt.link("G", A, C, {"shared", "glue"}, {legacy = true})` |
| end of declarations | `rt.capture("p", n)` for each `p/n` used, then `rt.prepare()` |
| `search A:` / `on candidate M:` | `A:search{ on_candidate = function(M) ... end }` |
| `reject M with e` / `accept M` | `M:reject(e)` / `rt.accept(M)` |
| `S.solve(assume E1, E2, optimal)` | `S:solve{ assume = rt.concat(E1, E2), optimal = true }` |
| `G(M)`, `G.clause(M, X)` | `G:of(M)`, `G:clause(M, X)` |
| `X.atoms(color/2)` | `X:atoms("color", 2)` |
| `S.expand(refine, cex = L)` | `S:expand("refine", { cex = L })` |
| `S.step` | `S.k` |
| `loop:`, `while c:`, `repeat:`, `for x in l:` | `while true do rt.tick()`, `while c do rt.tick()`, `repeat rt.tick()`, `for _, x in ipairs(l) do rt.tick()` (`rt.tick` checks the time limit and Stop every 256 iterations, also in a loop without solver calls) |
| `continue` | `goto __continue_N` |
| `l.push(e)`, `l.size` | `rt.push(l, e)`, `rt.size(l)` |

The Internals tab (`?internals=true`) shows the generated Lua. **Edit as Lua** in the Loop tab
replaces the script by this Lua and switches the project to raw Lua; it is one-way.

## Templates

The Loop tab inserts these scripts (Template, Insert). Each begins with the same declarations:

```loop
solver A = shared + abstraction
solver C = shared + check          options "--heuristic=Domain"
link   G = A -> C via shared + glue
```

The library has each of them on graph colouring at n = 5 (101 solutions each):
[gc-shape1](?example=gc-shape1), [gc-shape2](?example=gc-shape2),
[gc-shape3](?example=gc-shape3), [gc-shape4](?example=gc-shape4),
[gc-reference](?example=gc-reference).

### Shape 1: check inside the search

```loop
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
```

One search of `A` for the whole run. The check runs inside clasp's propagator for every total
assignment; refinement clauses are added to the running search. Fastest for clause refinements.
Unrejected candidates are solutions and are printed as they are found.

### Shape 2: solve, check, refine, solve again

```loop
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        A.add(G.block(M))
```

A new solve of `A` per candidate. Simple to follow and to change; slower, since every solve starts
the search again. Accepted solutions are blocked so that the next solve finds another one.

### Shape 3: ground rules per counterexample

Shape 2 with `A.expand(refine, cex = X.atoms(color/2))` in place of `A.add(G.clause(M, X))`. The
refinement is a set of rules grounded from `#program refine(k).` (adapt `color/2` to the
predicate the refine part reads). Rules can say more than one clause: they generalise the
counterexample.

### Shape 4: search, collect, ground in batches

```loop
pending = []
repeat:
    search A:
        on candidate M:
            X = C.solve(assume G(M))
            if X:
                pending.push(X)
                reject M with G.block(M)
                if pending.size >= 20: restart
    grounded = pending.size
    for X in pending:
        A.expand(refine, cex = X.atoms(color/2))
    pending.clear()
until A.exhausted and grounded == 0
```

Rule refinements without a solve per candidate: counterexamples are collected during a search and
grounded in batches of 20 between searches. Each bad candidate is blocked at once.

### Reference run

Shape 1 with `reject M with G.block(M)` as the only refinement. Each bad candidate is ruled out on
its own, so it is always sound: its solution count is the truth on small instances. Compare a
loop's count with it to find a `relevant/1` that is too weak (or press Audit). The design guide
calls it the *blocking loop*.

## Values: clauses, lists and model reads

| Script | Meaning |
| --- | --- |
| `G.above(M)`, `G.below(M)` | A clause for the source of G that removes M and all its supersets (subsets) on G's atoms; M is a model or a list `G(M)`. |
| `G.clause(X)` | The clause from the counterexample alone: its `relevant/1` atoms with the values X saw. It may be empty: rejecting with an empty clause ends the search, adding it leaves the solver without models. (`G.clause(M, X)` still stops with "relevant/1 derived nothing" on an empty set.) |
| `C.core` and `core.on(G)` | The whole unsat core of C's last solve; `.on(G)` keeps the atoms of link G (`G.core(C)` is short for `C.core.on(G)`). |
| `for a in E:`, `a.true`, `E.flip(a)`, `E.without(a)` | Walk and edit a list of assumptions such as `G(M)`; flip and without return new lists. |
| `S.atom("bound", n)` | The atom `bound(n)` of S as a one-element assumption list (an error names a missing atom). |
| `A.solve(assume G(M))` | A list of link G given to G's source means the same values on the source's atoms. |
| `X.value(p/1)`, `X.count(p/n)`, `X.cost`, `a.arg(i)` | The argument of the one true `p` atom (an error when there are none or several), the number of true atoms, the cost, the i-th argument of an atom. |

A solve under assumptions no longer counts for the "no progress" guard (it may return the same
candidate on purpose). `reasons-by-shrinking` and `knapsack-bounds` are loop scripts now,
`reasons-by-size` needs no helper solver (`G.above`), and `qbf` has no `always` atom
(`G.clause(X)`).

## Inner and optimal searches

```loop
search A:
    on candidate M:
        search B assume GX(M) keep Y:        # a search inside A's check
            on candidate Y:
                W = C.solve(assume GXY(Y))
                if W: reject Y with GXY.clause(Y, W)
        if Y: reject M with GXC.core(C)
```

- `search S assume e, ... [optimal] [keep Y]:` — a search may run inside `on candidate` of another
  solver's search (not of the same solver: `search B: solver B is already searching`).
  `assume` restricts it; `keep Y` ends it at the first candidate that is not rejected and stores
  that candidate in Y (none when S is exhausted); a kept search reports no solution. Clauses
  rejected in a nested or kept search stay for the solver's next solve.
- `search A optimal:` runs with `--opt-mode=optN` and reports a model only when its optimality is
  proven (`knapsack-interdiction` with `#minimize { 1,I : lock(I) }`: one solution).
- `keep` is a keyword. `qbf-three-blocks` uses an inner search: 12 solves of B instead of 30.

## Growing programs and externals

| Script | Meaning |
| --- | --- |
| `A.ground(step, t)` | Grounds `#program step(t).` of A with the number t. |
| `G.extend(step, t)` | Grounds the same part in G's glue; each new `glue(T)` atom becomes an interface atom (a choice of the target with its `relevant` atom, or a fact when T is a fact of the source). Ground the source's part before and the target's part after. A glue with a parameterised part may derive no atom at first. |
| `A.set(A.atom("query", t), true)`, `A.release(...)` | Assign or release an `#external` atom (an error names an atom that is not external). |
| `A.add(c, while a)` | The clause holds only while the atom a is true (it gets the literal "not a"). |

The library example `conformant-growing` finds the shortest conformant plans by growing the
horizon until plans exist (8 steps, the same 3 plans as `conformant-planning` with `t = 8`).
Certificates are refused for programs with `#external` atoms.

## Procedures and solver families

```loop
solver S[i in 1..depth] = shared + level + inner     # members S1, S2, ... grounded with -c level=i
link   G[i in 1..depth-1] = S[i] -> S[i+1] via shared + glue

def refute(i, M):                                     # a clause that removes M, or none
    loop:
        Y = S[i].solve(assume G[i-1](M))
        if not Y: return none
        if i == S.size: return G[i-1].clause(Y)
        c = refute(i + 1, Y)
        if not c: return G[i-1].clause(Y) + S[i+1].core.on(G[i-1])
        S[i].add(c)
```

- A family `solver S[i in lo..hi]` or `link G[i in lo..hi] = S[i] -> S[i+1]` builds one member per
  index; each member is grounded (a link: its glue) with the constant `level` = i. The range is
  made of numbers and project constants. `S[i]` is a member, `S.size` the number of members.
- `def name(a, b):` defines a procedure (between the declarations and the first statement);
  `return [e]` returns from it (an error outside `def`). Procedures may call themselves.
- `c + d` joins two clauses of one link (numbers are added). `core.on(G)` keeps the atoms of a core
  that G knows by name, also along a chain (the core of S[i+1] as a clause for S[i-1]).
- `def`, `return` and `keep` are keywords. The library example `qbf-deep` solves quantified Boolean
  formulas with any number of blocks; 120 formulas at depths 2 to 4 agree with brute force.

## Refinement variants

| Variant | Script | Example |
| --- | --- | --- |
| Several counterexamples per candidate | `for X in C.models(assume G(M), limit 5): reject M with G.clause(M, X)` | [lang-several-cex](?example=lang-several-cex) |
| Smallest refinement | `#minimize { 1,T : relevant(T) }.` in the check; `X = C.solve(assume G(M), optimal)` | [lang-optimal](?example=lang-optimal) |
| Refine from an unsat core (the check looks for a witness) | `if not C.solve(assume G(M)): reject M with G.core(C)` | [lang-core](?example=lang-core) |
| Two-stage check | `X = C1.solve(assume G1(M))` then `if not X: X = C2.solve(assume G2(M))` | [lang-two-stage](?example=lang-two-stage) |
| Refinement computed by its own solver | `Y = R.solve(assume GA(M), GC(X))` then `reject M with GA.clause(M, Y)` | [lang-second-solver](?example=lang-second-solver) |
| Explicit clauses from ASP | `reject M with G.clauses(X)` | [lang-clauses](?example=lang-clauses) |
| Files from `cegar.py` | `link G = A -> C via shared + glue legacy` | [lang-legacy](?example=lang-legacy) |
| Clauses lifted from the ground programs (no `relevant/1` needed) | `link G = A -> C via shared + glue lift`; or `reject M with G.lift(M, X)` on any link | [tutorial-weak-relevant](?example=tutorial-weak-relevant) with `lift` |

**`lift`** (phase S3, `docs/spec-soundness.md` section 4). With the keyword on a link,
`G.clause(M, X)` computes the clause from the ground programs of both ends: it starts from the
`relevant/1` atoms when that set is certified (level 2 or 3 of the certificates), else from the
whole interface, and drops groups of atoms (least blamed first; a group that cannot go is split)
while the smaller set stays certified. The result removes only candidates that X also refutes.
When the counterexample itself cannot be certified (for instance a check with negation on a cycle
through its guess), the clause falls back to `G.block(M)`, with a `K` event at level 0 and the
counter `lift fallbacks`. `G.lift(M, X)` does the same on a link without the keyword. `lift` and
`compat` cannot be combined. Lifting costs time: one evaluation of the check per tried group, and
a solver call on the product of the two programs where level 2 fails (graph-coloring at n = 5:
8 s instead of 0.1 s, but 1,103 refinements of 7.4 literals instead of 1,320 of 13). The
Statistics tab shows a **Lifting coach**: per interface predicate, the atoms `relevant/1` marked
and the atoms lifting kept, and how many hand-written sets were not certified.

In the second-solver variant, `R` has two incoming links: `GA` from `A` (the candidate) and `GC`
from `C` (the counterexample). `GA.clause(M, Y)` reads `relevant/1` from `R`'s model `Y`.

`G.core(C)` is only a refinement for a failed *witness* check. After a check that found no
counterexample it is still a valid lemma, but not a block of the candidate's supersets: the core
contains assumptions that atoms are false, so supersets satisfy the clause. To remove the supersets
of a solution, state the clause with a helper solver and `clause/3` (example `reasons-by-size`) or
build it in Lua (example `reasons-by-shrinking`).

### Chains of solvers

A candidate can be checked by a solver that is itself refined by a third one, `A -> B -> C`, as
problems with three quantifier blocks need. Two properties of links make this work.

- A link's glue may name atoms that its source only received over another link. With
  `link GX = A -> B` and `link GXY = B -> C`, the glue of `GXY` can list the atoms of `GX` next to
  B's own atoms. `GXY.clause(Y, W)` is then a clause for `B` over both, and it stays valid for
  every later candidate of `A`.
- Links with the same target share atoms by name. A further link `GXC = A -> C` over the atoms of
  `GX` is never used for assumptions; `GXC.core(C)` states the part of an unsat core of `C` that
  lies on those atoms as a clause for `A`.

Declare the links in the order of the chain: a link grounds its source, and its target must not be
grounded yet. The inner loop uses `solve` and `add`, since a `search` cannot be nested:

```loop
search A:
    on candidate M:
        loop:
            Y = B.solve(assume GX(M))
            if not Y: break                    # B has no counterexample left: M is a solution
            W = C.solve(assume GXY(Y))
            if W:
                B.add(GXY.clause(Y, W))        # Y is refuted: valid for every candidate of A
            else:
                reject M with GXC.core(C)      # Y stands: the candidate is refuted
                break
```

Examples: [knapsack-fortification](?example=knapsack-fortification) (the innermost solver does
not read the outer candidate, so two links suffice) and
[qbf-three-blocks](?example=qbf-three-blocks). The counter *counterexamples* then counts the
satisfiable solves of both `B` and `C`.

## Raw Lua projects

With `loop.language = "lua"` the compiler is skipped. The text runs as the body of
`rt.run(function() ... end)` inside clingo's `main`. All runtime calls live in the global table `rt`.
See [lang-raw-lua](?example=lang-raw-lua).

```lua
local A = rt.solver("A", {"shared", "abstraction"}, {})
local C = rt.solver("C", {"shared", "check"}, {"--heuristic=Domain"})
local G = rt.link("G", A, C, {"shared", "glue"}, {})
rt.prepare()
A:search{ on_candidate = function(M)
  local X = C:solve{ assume = G:of(M) }
  if X then M:reject(G:clause(M, X)) end
end }
```

### Hard rules for raw Lua

An error that clingo raises inside a call made from Lua kills the WebAssembly instance without a
message ("clingo stopped unexpectedly"), even inside `pcall`. The runtime guards its own calls; raw
Lua must too:

1. Never call `ctl:add` / `ctl:ground` with text that may not parse. Fragments are validated
   before the run; text built at run time is not.
2. Do not let a Lua error escape from a callback that clingo calls (`on_candidate` is wrapped by the
   runtime; your own `on_model` or propagator is not). Wrap callback bodies in `xpcall`.
3. Do not read `ctl.statistics` of a control that is solving.
4. Read models from a solve handle only with `h:iter()`; always `h:close()`.
5. A propagator table needs `init` and every hook at registration time.
6. After `control:add_clause` returns false, return from `check` at once.
7. Clause forms: `control:add_clause{ lits }` in `check`, `init:add_clause(lits)` in `init`. Pass
   plain arrays of integers.
8. A helper function used inside a callback must be defined (as a local) before the callback
   runs; a nil global called there is a Lua error inside clingo.

A pure Lua error outside any clingo callback is caught by `rt.run` and reported as an error with
its line.

### Runtime API

| Call | Behaviour |
| --- | --- |
| `rt.solver(name, fragments, options)` | Create a solver (a `clingo.Control` with `options` + `--stats` + constants + seed). Not grounded yet. Error if a fragment is unknown or the name is taken. |
| `rt.link(name, from, to, glue_fragments, opts)` | Create a link (`opts = { legacy = bool, compat = bool }`). Grounds `from` if needed; `to` must not be grounded yet. |
| `rt.capture(pred, arity)` | Record the true atoms of `pred/arity` in every model snapshot (for `X:atoms`). |
| `rt.prepare()` | Ground every solver not yet grounded, resolve captures, emit the `H` event. Exactly once, after all declarations. |
| `S:solve{ assume = a, optimal = bool }` | A model snapshot, or `nil` if unsatisfiable (then the core is kept for `G:core`). Not while `S` is searching. |
| `S:models{ assume = a, limit = n }` | A list of up to `n` snapshots. |
| `S:search{ on_candidate = f }` | Run `S`'s search; `f(M)` for every candidate; unrejected candidates are solutions. Sets `S.exhausted`. |
| `M:reject(c)` | Only for candidates inside `search`. `c` is a clause or a list of clauses; every literal of the first clause must be false under the candidate (`refinement does not exclude the candidate`). |
| `S:add(c)` | Queue a clause or list of clauses for `S`'s next solve. Not while searching; not with clauses built from a candidate inside a search. |
| `S:expand(part, facts)` | `facts = { name = list_of_symbols }`: increment `S.k`, add `name(k, T)` facts, ground `part(k)`. Not while searching. |
| `rt.concat(a, b, ...)` | One assumption list from several (it remembers the links of the `G:of` lists it contains). |
| `G:of(M)`, `G:clause(M, X)`, `G:block(M)`, `G:core(S)`, `G:clauses(X)` | As in the loop language. `G:of` returns a new array, remembered as belonging to `G`: `S:solve` fails if `G`'s target is not `S`. Raw Lua arrays are not checked. |
| `X:atoms(pred, arity)` | Captured atoms (clingo symbols); for a candidate inside `search`, built on demand from the assignment. Error if not captured. |
| `rt.tick()` | The compiler puts it at the top of every loop body: time limit and Stop poll every 256 calls. Call it in long raw Lua loops without solver calls. |
| `rt.accept(M)`, `rt.restart()`, `rt.stop(msg)` | As `accept`, `restart`, `stop`. |
| `rt.count(name, n)`, `rt.log(...)` | As `count`, `log`. |
| `rt.size(l)`, `rt.push(l, x)`, `rt.clear(l)`, `rt.list()` | List helpers. |

Runtime errors (raised as a Lua error, reported in the Output tab with the loop line): `relevant/1
derived nothing for link G`, `the refinement made no progress: the same candidate came back`
(eager shapes: a solver with outgoing links and no incoming links returned the same interface
values twice in a row), `refinement does not exclude the candidate`, `reject works only on a
candidate inside search; use S.add between solves`, `reject: the clause was built from a model
outside the search; use S.add`, `reject: the candidate is no longer valid (it belongs to an earlier
step)`, `G.block: the candidate is no longer valid (it belongs to an earlier step); store G(M) or a
counterexample instead` (also `G.clause`, `G.of`, `atoms`, `accept`: a candidate used after its `on
candidate` call), `A.solve: the assumptions of G are for solver C`, `reject: an empty clause cannot refine the candidate`, `link G: the glue fragments derive no
glue/1 atom`, `link G: solver C was already grounded; declare links before using it`, `atoms(p/n):
not captured in solver S`, `restart works only inside on candidate`, `rt.prepare() may be called
only once`.

## Settings

| Setting | Where | Meaning |
| --- | --- | --- |
| Solutions | run bar | 1, 10, 100 or all (`settings.solutions`, 0 = all). The run ends with outcome `solutions` when reached. |
| Time limit | Loop tab | Seconds of CPU time in the engine (`os.clock`); 0 = none. Outcome `limit`. The page also aborts the worker 2 s after the limit in case one solve call never returns. |
| Candidate limit | Loop tab | 0 = none. Outcome `limit`. |
| Trace steps | Loop tab | Number of refinement steps recorded for the trace view; 0 = off. Recording costs a little time. |
| Seed | Loop tab | `--seed=N` for every solver; 0 = clingo's default. It changes the search only together with randomising options such as `options "--rand-freq=0.05"`. |
| Threads | Loop tab | Loads the threaded engine (`clingo-mt`); then `options "-t 2"` works. Needs a cross-origin isolated page. Not stored in the project. |
| Constants | Loop tab | `settings.constants`, see [Constants](#manual-constants). |
| Solver options | loop script | `options "..."` on a `solver` line: any clingo option, such as `--heuristic=Domain`, `--enum-mode=record`, `--opt-strategy=usc`. |

Shape 1 note: clasp's default enumeration keeps refinement clauses added during a search only
weakly; later candidates may violate them. The result stays sound (every candidate is checked),
but refinements prune less. `options "--enum-mode=record"` on the abstraction solver keeps them.

Colour theme: the button at the top right of the page cycles through Auto (follow the system's
light or dark setting), Light and Dark. The choice is kept in this browser and also applies to the
pages of the guide. The editors and the charts follow it.

## Running

**Run** (or Ctrl+Enter / Cmd+Enter anywhere on the page) validates the project, then starts the run
in the worker. While a run is active all editors are read-only.

Keyboard: the tab row is in the Tab order (arrow keys switch tabs, as in any group of radio
buttons); **Select file** is a button; an info dialog (the ⓘ links) takes the focus, keeps Tab
inside, closes with Escape and returns the focus to its link. Run status and run messages are
announced to screen readers (`role="status"`). Below 650 px the tabs show their icon with a short
name under it.

Validation, in order: compile the loop script (errors marked in the Loop tab); for each solver and
link, parse its fragments with `clingo --mode=gringo` and the constants (syntax errors and unsafe
variables marked in the Programs tab, with fragment and line); check `expand` parts; check
constants; check `-t` against the engine. A run starts only without errors.

While you type, each edited fragment is parsed on its own with `clingo --mode=gringo` 0.8 s after
the last change (only while no run is active; a run cancels a pending check, and the result of an
older edit is dropped). Syntax errors and unsafe variables are then marked at once, as the loop
script is compiled 0.5 s after each edit.

| Run status | Meaning |
| --- | --- |
| `idle`, `validating`, `running`, `paused` | As named. |
| `finished` | The run ended with outcome `finished`, `solutions`, `limit` or `stopped`. |
| `error` | Problems before the run, a runtime error (outcome `error`), or the engine stopped unexpectedly. |
| `aborted` | Abort was pressed; what arrived so far stays on screen. |

| Outcome (`D` event) | Meaning |
| --- | --- |
| `finished` | The script ended (or `stop` without a message). `exhausted` tells whether the last search or solve without assumptions was complete: then the solution list is complete. |
| `solutions` | The wanted number of solutions was reached. |
| `limit` | The time or candidate limit was reached. |
| `stopped` | `stop "msg"`, or Stop pressed (detail `stopped by user`). |
| `error` | A runtime error; the message is in the Output tab and marked on the loop line. |

**Abort** terminates the worker at once and starts a new one. On a cross-origin isolated page
(see [URL parameters](#manual-url-parameters-and-browser-storage)) there are also **Pause** /
**Resume**, **Step** and **Stop** (ends the run cleanly, with final statistics). Step is enabled
whenever Run is: from idle it starts a run that waits after its first candidate (state `paused`);
on a running run it pauses after the next candidate; on a paused run it moves on by one candidate.
Resume runs on to the end. On a page that is not isolated these buttons are hidden: the worker
cannot be paused there.
A pause makes the runtime send fresh statistics before it waits, so the counters show the state at
the pause; Step lets exactly one poll through (one candidate of a `search`; in a loop of `solve`
calls the poll runs every 256 iterations of a loop body) and pauses again with fresh statistics.

Messages from clingo (infos and warnings, such as `atom does not occur in any rule head`) name the
fragment and the line within it (`check:3:5`), and are marked in that editor after the run (blue
for infos, yellow for warnings). Common runtime errors get a hint sentence. "clingo stopped
unexpectedly" means the engine trapped (see [Hard rules for raw Lua](#manual-hard-rules-for-raw-lua));
the Output tab then shows the last lines received.

### Audit

**Audit** (next to Run) checks the refinements of a loop script against every candidate and every
counterexample of the instance, instead of the pairs one run happens to visit.

1. Every candidate: the models of the abstraction without refinements, one per assignment of the
   interface atoms of the audited link (a `#minimize` is ignored here).
2. Every counterexample of each candidate (all models of the check under the candidate).
3. A candidate without a counterexample is a solution.
4. Clause refinements (`G.clause`): each distinct relevant set R of a candidate M is one pair. The
   pair is unsound when some solution agrees with M on every atom of R: the clause would remove it.
5. Rule refinements (`A.expand(part, name = X.atoms(p/n))` with X a counterexample): each distinct
   set of facts is one refinement. It is unsound when grounding the part with these facts leaves a
   solution without a model.

The verdict is "sound for every candidate and counterexample of this instance", or `unsound` with a
witness: candidate, counterexample, relevant set (or facts), the lost solution and the atoms on
which candidate and lost solution differ. The witness with the fewest such atoms is chosen; one of
them should usually have been relevant. Blocks and cores need no audit (they are sound by
construction); `G.clauses` is not audited.

The audited link is the one that leaves the top solver; with several, the one the script refines
(or name it with `--link`). A check solver that passes models on (a chain) is refused. Above
200,000 candidates the audit stops with outcome `limit`. Its run history row shows the verdict in
the column **Audit**, and runs with the same fragments and constants show it too.

### Certificates

**Certificates** (Loop tab; `settings.certify = "report"`) gives every refinement clause the
cheapest certificate that holds and counts them in the Statistics tab: level 0 a block, level 1 an
unsat core, level 2 a three-valued evaluation of the check's ground program with the
counterexample's guesses fixed, level 3 one unsatisfiable solver call on a product of abstraction
and check. A certified refinement removes no solution, whatever the instance's other candidates
are. Uncertified does not mean unsound (use Audit). Each clause gets a `K` event
(`c`, `i`, `l`, `level`, `verdict`, `reason`), and the final `S` event a `certificates` object.
Details and the proof: `docs/spec-soundness.md`.

Expansions are certified too: the rules that `S.expand` grounds get level 3 when no candidate
they remove escapes the counterexample whose atoms were the facts (the step must define new atoms
by stratified rules). With `settings.certify = "exact"` (the third choice of the select) a clause
that levels 2 and 3 leave open goes to **level 4**: a search on scratch copies of the two programs
for a candidate the clause removes that has no counterexample. It reports the lost solution
(verdict `unsound`), certifies (level 4), or stops after `settings.exact_seconds` (default 2 s).

### Recordings

A recording with **proof** (Loop tab; `settings.record.proof`, `tools/run.mjs --proof FILE`) is a
proof log: every counterexample and the certificate level of every refinement.
`python3 tools/certcheck.py project.json log` confirms the solution count from it with code that
shares nothing with the runtime (four checks: counterexamples are answer sets, certificates
verify, solutions have no counterexample, nothing else is left). Its `--json` verdict can be
imported in the Statistics tab ("Import certcheck verdict"). Details: `docs/spec-soundness.md`
section 6.

**Recording** (Loop tab, limits block) records the steps of a run as compact `R` events: every
step, the first N, every N-th, the last N, or a sample of N; **solver calls** adds a `C` event per
call. The setting is `settings.record` (absent when off). Every run's events are kept:
**Download recording** (Control tab) saves them as a `.cprec` file (gzip; header line, then the event
lines), **Open recording** replays one without the engine (run status `replayed`). Each `fast`
library example has a replay in `examples/replays/`. Details: `docs/spec-recording.md`.

## Output and statistics

After an **Audit**, the Output tab shows its verdict, and the Statistics tab and the Observatory show
the audit's own solving (one check per candidate of the unrefined abstraction), with a note saying
so; the next Run replaces them. The run history keeps both.

### Output tab

- **Result line**: outcome, time, solution count, whether the search was exhausted.
- **Solutions**: numbered, shown atoms and cost. At most 1,000 are shown; **Download** saves all
  kept solutions (up to 200,000) as text, one per line (`n: atoms`).
- **Trace**: one recorded step at a time (slider, Previous, Next): **Candidate** (true interface
  atoms; the atoms in the refinement highlighted), **Counterexample** (shown atoms of the check's
  model), **Refinement** (clause literals such as `-pick(3)`, or the facts of an expansion). Step
  kinds: `reject` (Shape 1 clause), `add` (clause added between solves), `expand` (rules grounded),
  `error` (the counterexample from which `relevant/1` derived nothing; the view jumps to it).
- **Messages**: clingo messages grouped with a count, `log` lines, errors (with a collapsed Lua
  traceback) and hints.

### Statistics tab

| Part | Content |
| --- | --- |
| Summary | Outcome, elapsed time, candidates, counterexamples, refinements (clauses + expansions), solutions. |
| Solvers | Per solver: fragments, options, calls, sat, unsat, solving time (exclusive of nested solves), time per call, grounding time, choices, conflicts, restarts, atoms, rules, expansions. |
| Refinements | Clauses, mean and largest length, expansions, restarts, automatic blocks (solutions blocked so that a later search does not report them again). |
| Charts | Candidates and refinements over time; time split per solver; clause length distribution (1, 2, 3–4, 5–8, 9–16, 17–32, 33–64, 65+). |
| Custom counters | The `count` statements. |
| Run history | One row per run: time, loop, outcome, elapsed, candidates, refinements, mean clause length, solutions, seed. Two runs of the same fragments with all solutions, both exhausted, with different counts are marked red: one of them is unsound. **Rerun with 5 seeds**, **Clear run history** (asks first; disabled while empty), copy as text or JSON. |

Counting rules: *candidates* are the assignments seen by `on candidate` plus models returned by
`solve`/`models` of solvers without incoming links; *counterexamples* are satisfiable solves that
were given assumptions.

### Observatory tab

Tab 11 (`?tab=11`). **Loop anatomy**: one box per solver (name, fragments, calls, sat, unsat,
solving time, a `+k` badge after k expansions), placed in columns by the longest path over the
links, and one arrow per link labelled with its name and interface size (from the `H` event); a
link flashes on each recorded step through it (above 30 steps per second the label shows the rate
instead). **Timeline** (needs **Record calls**, the same setting as in the Loop tab): one lane per
solver; a call is a bar from its start to its end coloured by result (sat, unsat, interrupted); a
search is a thin band; marks above the lanes show solutions, refinements and expansions; calls
narrower than a pixel share a column split by the share of sat and unsat calls. Wheel zooms, drag
pans, double click shows all. **Cost per line**: one row per loop line with calls, sat, unsat,
exclusive time (nested calls subtracted) and time with nested calls, sorted by time; a click
selects the line and filters the timeline; after a run the loop editor shows the same figures as
info annotations. The **Domain view** (see [Writing views](#manual-writing-views)) and the **Candidate space** follow.

### Candidate space

The **Candidate space** region (Observatory) shows every candidate of the unrefined abstraction at
once, one square each, from the audit's enumeration (so the same limit of 200,000 applies).
**Compute** audits the instance and variant the recorded run used, and needs a run recorded with every step (Recording "every step", Loop tab); without one it
offers **Record every step, run, compute**, which sets that recording, runs and computes. The colour of a
square is its fate up to the refinement chosen with the slider or the cursor: alive, alive and a
solution, removed earlier, removed by this refinement, a lost solution (a solution some refinement
removed: the run is unsound), an accepted solution; a legend under the map names them. The summary
names the first unsound refinement and how many solutions it removes, and counts the removals that
hit a candidate already removed (redundant refinements). Hover shows a candidate's atoms, a click
moves the cursor to the step that removed it. Two orders: by the most blamed atoms (a Z-order over
the atoms the refinements rely on most), or rows by the number of true atoms. Below the map: the
number of alive candidates per refinement, and the **blame matrix** (refinements by atoms; a cell is
coloured when the refinement's clause contains the atom, by its sign). **Compare with a recording**
lays a second recording of the same project and instance over the map: removed by this run only, by
the second only, or by both.

### The linked cursor

One cursor (the bar at the top of the Observatory) drives every view: the domain view, the
candidate map, the call timeline, the line table and the trace of the Output tab. The left and
right arrow keys move it one step (Shift: ten); "follow the run" keeps it on the last step; a range
restricts the line table and the alive curve. Exports: the view as SVG, a storyboard strip of
chosen steps, the map as PNG, and the data as tables. "Compare with a recording" lays a second run
of the same instance over the map and beside the domain view. A link with `replay=` (a file of
`examples/replays/`), `step=N` and `view=<name>` opens a recording on a step and view;
`lecture=1` shows the view alone with its notes as captions.

### Writing views

A **view** draws a step of the loop in the problem's own terms (Observatory tab, "Domain view").
It is a fragment with two parts and a `views` entry naming the fragments it reads:

```asp
#program scene.                       % what stays: drawn once
draw(layout(graph)).
draw(node(V))   :- node(V).
draw(edge(U,V)) :- edge(U,V).
#program frame.                       % one step: cand/1, cex/1, lit/2, kind/1, step/1
draw(attr(node(V), fill, deleted)) :- cand(del(V)).
draw(emph(node(V)))                :- lit(del(V), _).
draw(note("A triangle survives.")) :- kind(reject).
#show draw/1.
```

```json
"views": [ { "name": "view", "fragments": ["shared", "view"] } ]
```

Marks: `node/1`, `edge/2`, `cell/2`, `item/2`, `rank/3`, `attr/3` (keys `fill`, `stroke`,
`label`, `weight`; a fill or stroke value is a class, coloured by first use), `emph/1`, `ghost/1`,
`note/1`, `layout/1` (`grid`, `list`, `circle`, `layers`, `graph`), `pos/3`. The step slider picks
a recorded step (the trace's `T` events and the solutions found after the last of them, or `R`
events of a recording); the drawing keeps every
position between steps; dragging a node stores its position in the project. **Suggest a view**
writes a first view from the predicates of the interface. The view runs as plain clingo with the
instance and the named fragments, so a mistake shows as a clingo message. Details:
`docs/spec-views.md`. Nineteen library examples ship a view (the guide's clique examples, the
tutorial, `clique-colouring`, `af-preferred`, `arrowing`, `choosability`, `qbf`, and the puzzle
generators: the five `sudoku-*`, `binairo`, `futoshiki`, `akari`, `slitherlink`); their last
step is the puzzle the run found. A view program gets the project's constants: a fragment's own
`#const k = default.` takes the project's value. `cand/1` holds only interface atoms that are not
facts: draw what the instance fixes in the scene part.

### Event lines

The runtime prints one line per event: `@@` + kind letter + space + JSON. `tools/run.mjs --json`
prints them as `{"kind": ..., "data": ...}`.

| Kind | When | Fields |
| --- | --- | --- |
| `H` | after grounding | `solvers` (`name`, `fragments`, `options`, `atoms`, `ground`), `links` (`name`, `from`, `to`, `atoms` = non-fact interface atoms), `settings` |
| `S` | every 0.25 s and at the end | `t`, `candidates`, `counterexamples`, `solutions`, `clauses`, `literals`, `maxlen`, `hist`, `expansions`, `restarts`, `blocks`, `solvers` (per solver: `calls`, `sat`, `unsat`, `time`, `ground`, `busy`, `choices`, `conflicts`, `restarts`, `atoms`, `rules`, `vars`, `constraints`, `k`), `counters` |
| `M` | each solution | `n`, `atoms`, `cost` |
| `T` | each traced step | `i`, `kind`, `solver`, `candidate`, `counterexample`, `literals`, `facts` |
| `W` | clingo message | `solver`, `code`, `message`, `fragment`, `line`, `col` |
| `L` | `log` | `text` |
| `E` | runtime error | `message`, `line`, `traceback` |
| `D` | last line of a run | `outcome`, `exhausted`, `detail` |
| `I` | with `settings.record`, after `H` | `links` (`link`, `from`, `to`, `atoms`), `solvers`, `record` |
| `R` | with `settings.record`: each recorded step | `i`, `k` (`r` reject, `a` add, `e` expand, `s` solution, `x` error), `s`, `l`, `n`, `t`, `c` (candidate, hex), `q` (clause, signed atom indices), `f` (facts) |
| `K` | with `settings.certify`: each refinement clause | `c`, `i`, `l`, `level` (0-3 or null), `verdict` (`certified`, `none`, `outside`), `reason` |
| `P` | audit with vectors | `set` (`candidates`, `solutions`), `link`, `from`, `v` (hex vectors) |
| `C` | with `settings.record.calls`: each solver call | `id`, `s`, `t0`, `dt`, `r` (`sat`, `unsat`, `int`), `p` (enclosing call), `n` |
| `A` | audit only: every 0.25 s, then the verdict | progress: `phase`, `candidates`, `pairs`, `unsound`; verdict: `verdict` (`sound`, `unsound`, `limit`), `link`, `kinds`, `candidates`, `solutions`, `counterexamples`, `pairs`, `unsound`, `at_risk`, `empty`, `atoms`, `t`, `witness` (`kind`, `candidate`, `counterexample`, `relevant` or `part` + `facts`, `solution`, `differ`) |

## URL parameters and browser storage

| Parameter | Effect |
| --- | --- |
| `?example=<id>` | Load the library example `<id>` (also `?file=<id>`). It does not replace the project kept in the browser until you edit it. |
| `&fragment=<name>` | With `?example`: open the Programs tab on that fragment's editor (`loop` opens the Loop tab). Overrides `?tab`. An unknown name is ignored with a note in the status line. |
| `&from=guide/<page>.html#<anchor>` | Show a link "← Back to the guide" at the top left, to that guide page. Only a page of the guide is accepted. |
| `?tab=N` | Open tab N: 1 Control, 2 Tutorial, 3 Programs, 4 Loop, 5 Output, 6 Statistics, 7 Internals (with `?internals=true`), 8 Manual (when the manual is shown), 9 Instances, 10 Campaign, 11 Observatory. The numbers are fixed; they are not the order on screen. |
| `&instance=<id>` | Pick that instance of the project in the run bar. An unknown id is ignored with a note. |
| `?manual=true` | Show the Manual tab (without changing the remembered toggle). |
| `?advanced=1` | Advanced mode for this visit: the Observatory and Campaign tabs (without changing the remembered toggle). `?tab=10`, `?tab=11`, `?lecture=1`, `?view=` and `?step=` imply it. |
| `?internals=true` | Show the Internals tab: engine facts, generated Lua, raw event lines. |
| `?fresh=1` | Start from the default example (`tutorial-first-run`), ignoring the kept project. |
| `#p=<data>` | A share link (**Copy share link** in the Control tab): the whole project without its run history, in the URL fragment, which never reaches the server. `<data>` is `z` + base64url of the deflate-raw compressed project JSON (`u` + base64url of the plain JSON in a browser without `CompressionStream`). Takes precedence over the kept project and, like `?example`, does not replace it until you edit. A damaged link opens the default example with an error in the status line. Links over 8,000 characters get a warning. |
| `?replay=examples/replays/<id>.cprec` | Replay a library recording without the engine (it loads its example first). Only paths of that form are accepted. |
| `&step=N`, `&view=<name>` | Open the Observatory with the linked cursor on step N and that domain view. |
| `?lecture=1` | Lecture mode: the domain view alone, its notes as captions, the arrow keys move the cursor. |
| `?nocoi=1` | Do not use the isolation service worker (and remove it). Pause, Step, Stop and threads are then unavailable. |

The address bar follows the page (without new history entries): loading an example from the library
or the tutorial sets `?example=<id>`, switching tabs sets `?tab=N` (none for the Control tab), and
the first edit, a new project or an uploaded file removes `?example`, `?fragment` and `#p=`. A reload
therefore shows the same example on the same tab. `nocoi`, `manual`, `internals` and `from` are kept.

With nothing kept in the browser the page opens with `tutorial-first-run` (a run of 0.1 s) and the
example library unfolded.

Example: `?example=gc-shape4&tab=5` loads graph colouring with Shape 4 and opens the Output tab.
The guide's links look like `?example=guide-01-demo-clause&fragment=check&from=guide/01-why-a-loop.html%23demo-clause`.

Browser storage (`localStorage`, per browser and site):

- `cegarplay.project`: the project being edited, with its run history, saved 0.8 s after each
  change and restored at start-up (unless `?example`, `?file`, `#p=` or `?fresh=1`). When the
  browser refuses (storage full or blocked), the project is kept without its run history, and if
  that fails too, the Control tab says "Not kept in this browser"; download the project then.
- `cegarplay.manual`: `"1"` when "Show the technical manual" is ticked.
- `cegarplay.advanced`: `"1"` when Advanced mode is on (absent when off).
- `cegarplay.tutorial`: `"0"` when the Tutorial tab is hidden (absent when shown).
- `cegarplay.theme`: `"light"` or `"dark"` when the colour theme was chosen by hand (absent for Auto).

Keyboard: Ctrl+Enter or Cmd+Enter runs from anywhere, also inside an editor.

Cross-origin isolation: `coi-serviceworker.js` adds the isolation headers through a service worker
and reloads the page once on the first visit. Without it (or with `?nocoi=1`) everything except
Pause, Step, Stop and threads works.

## Import and export

| Action (Control tab) | Result |
| --- | --- |
| Upload project from file | Loads a project JSON (`Project.load`). |
| Download current project | The project JSON; "include run history" adds `runs`. |
| Export for clingo | One `.lp` file with the fragments, the runtime and the loop (with the instance and variant picked in the run bar applied): `clingo file.lp --outf=3` prints `Answer: n` lines and a summary. Needs a clingo built with Lua (conda-forge, Ubuntu's `gringo`; not the PyPI package). |

## Example library

`examples/library.json` lists every example (generated; do not edit by hand):

```json
{ "format": "cegarplay-library", "version": 1,
  "groups": [{ "id": "tutorial", "title": "Tutorial", "description": "..." }],
  "examples": [{ "id": "gc-shape4", "title": "...", "group": "shapes", "summary": "one sentence",
                 "shape": "shape4", "tags": ["fast"], "expected": { "solutions": 101 } }] }
```

`shape` is a template key or `custom`; `expected.solutions` (when present) is the solution count
with the example's own settings, checked by `test/library.test.mjs` for every example tagged `fast`.
`has` (when present) counts the project's `instances`, `generators`, `suites` and `views`; the
Library shows them as tags, and the filter matches them (type `view` or `suite`).

| Group | Ids |
| --- | --- |
| `tutorial` | `starter`, `tutorial-first-run`, `tutorial-weak-relevant` |
| `language` | `lang-basics`, `lang-several-cex`, `lang-optimal`, `lang-two-stage`, `lang-clauses`, `lang-core`, `lang-second-solver`, `lang-legacy`, `lang-raw-lua` |
| `shapes` | `gc-shape1`, `gc-shape2`, `gc-shape3`, `gc-shape4`, `gc-reference` |
| `guide` | `guide-<chapter>-<slug>`: the examples of the design guide (`guide/`), each linked from its page |
| `problems` | `graph-coloring`, `nash`, `voting-justification` |
| `exists-forall` | `qbf`, `qbf-optimal`, `qbf-expansion`, `smallest-mus`, `min-dnf`, `integer-expressions`, `strategic-companies`, `diagnosis`, `stable-models`, `abduction`, `default-extensions`, `belief-update`, `af-preferred`, `af-semi-stable`, `conformant-planning`, `sufficient-reason`, `actual-cause`, `clique-interdiction`, `clique-colouring`, `arrowing`, `choosability`, `subset-sum-game`, `knapsack-interdiction`, `fewest-clues`, `sudoku-unique`, `sudoku-hard`, `sudoku-symmetry`, `sudoku-unavoidable`, `sudoku-graded`, `binairo`, `futoshiki`, `akari`, `slitherlink`, `fair-division`, `hedonic-core`, `boolean-game`, `strong-nash`, `kemeny-control`, `agenda-safety` |
| `several-solvers` | `abduction-two-checks`, `minimal-reasons`, `reasons-by-size`, `qbf-blame-solver`, `knapsack-optimum`, `knapsack-bounds`, `reasons-by-shrinking`, `knapsack-fortification`, `qbf-three-blocks`, `conformant-growing`, `qbf-deep` |

Each example is at `examples/<id>.json` and loads with `?example=<id>`.

Most problems keep their input in [instances](#manual-instances): an instance `example` (tag
`library`, whose count is the entry's `expected`) and two or three more, each with a comment line
and its expected count (a smaller one, one without solutions, a larger one); `test/instances.test.mjs`
runs every instance with an expected count. Parametric problems (`graph-coloring`, `min-dnf`,
`clique-interdiction`) use constants-only instances and `settings.instance: ""`, so that the
project as written runs with its own constants. `voting-justification` has seventeen instances,
one question each. Some examples also have generators (`qbf`, `af-preferred`, `kemeny-control`, the
graph problems), a campaign suite (`tutorial-weak-relevant`, `qbf`, `voting-justification`) or a
domain view (fragment `view`). Every `fast` example has a recording in `examples/replays/`
(`node tools/make-replays.mjs` after a change of the runtime or an example). `reasons-by-shrinking`
and `qbf-three-blocks` deliberately use no format-2 keys: `test/assemble-golden.test.mjs` checks
that such projects assemble to the same program text as before.

Entries of the group `guide` have three more fields: `page` (the guide page and anchor that link
it), `status` (`baseline`, `sound` or `unsound`) and `baseline` (the id of the blocking run of the
same problem; absent on baselines). They are built by `tools/guide.mjs`; `node
tools/guide-numbers.mjs` measures them into `guide/numbers.json`, which the pages quote.

To add an example: add it in `buildLibrary` in `tools/library.mjs` (hand-written examples) or
`buildExamples` in `tools/make-examples.mjs` (examples built from `reference/declarative-cegar`),
run `node tools/make-examples.mjs`, measure its count with `node tools/run.mjs <id>`, and put the
count in `expected`.

Without editing the tools: put a project file with a top-level `library` block
(`{ "id", "group", "summary", "shape", "tags", "expected" }`, where `group` is `exists-forall` or
`several-solvers` and `expected` is the solution count or `null`), with its input in instances, in
`examples/contrib/`; `node tools/make-examples.mjs` adds it to the
library (the block is dropped from `examples/<id>.json`). See `examples/contrib/README.md`.
`node tools/make-chat-package.mjs` writes `dist/chat-package/`, a flat folder (this manual, the
tutorial, every example, a template, the checker below, a guide) for writing examples in a chat
without the repository.

## For agents

### Workflow

1. Start from a library example close to the problem (`examples/<id>.json`), or from `starter`.
2. Write the four fragments: domains and derived rules in `shared`; the candidate guess and
   `#show` in `abstraction`; `glue(T)` for every atom the check reads; in `check`, rules that have
   an answer set exactly when the candidate is wrong, plus `relevant(T)` for the atoms each
   counterexample depends on. Put the problem's input in instances (`example` plus a few small
   ones), not in `shared`.
3. Pick a template (Shape 1 unless rule refinements are needed); set constants small.
4. Run it headless (below) or in the page. Fix validation problems first (they name fragment, line
   and column).
5. Run the same project with the Reference run template. Equal solution counts on small instances
   (with `--solutions all`, both exhausted) are the soundness check. Fewer solutions than the
   reference means `relevant/1` marks too few atoms.
6. Audit the project on small instances (`node tools/audit.mjs <project> --json`). An unsound
   verdict names a lost solution and the atoms it differs on from the candidate; mark one of them
   relevant (or fix the refine part) and audit again.
7. Give every instance its `expected.solutions` and check them all:
   `node tools/run.mjs <project> --instance all --solutions all`.
8. Only then increase the constants or add larger instances (a suite in `suites` measures how the
   run time grows: `node tools/bench.mjs <project> --suite NAME`).

### Headless runner

```sh
node tools/run.mjs <project.json | library id> [-c name=value] [--solutions N|all]
                   [--seconds N] [--trace N] [--instance ID|all] [--variant NAME]
                   [--record FILE] [--record-steps POLICY[:N]] [--json] [--quiet]
```

It uses the same engine, validation and runtime as the page. Output: one `Solution n: atoms` line
per solution, `log:` and clingo lines, then `Outcome: ...; exhausted: ...` and `Solutions: ...;
candidates: ...; counterexamples: ...; clauses: ...; time: ... s`. Validation problems are printed
as `fragment:line:col: error: message`. Exit code 0 when the run ends without an error, 1 on a
problem or error, 2 on bad usage. With a time limit above 0, a run that does not stop by itself (a
raw Lua loop without `rt.tick()`) is ended `N + 2` s after the start with `Outcome: limit (the run
did not stop ...)` and exit code 1, like the page's backstop. `--instance ID` runs one instance
(`-c` still wins over its constants); `--instance all` prints one line per instance with its count
and `as expected` or `MISMATCH: expected N`, and exits with 1 on a mismatch. An unknown instance or
variant exits with 2. Example: `node tools/run.mjs tutorial-first-run --quiet`.

### Audit tool

```sh
node tools/audit.mjs <project.json | library id> [--link G] [--limit N] [-c name=value]
                     [--seconds N] [--json]
```

Runs the [audit](#manual-audit) headless. Prints the counts and the verdict, with the witness when
it is unsound; `--json` prints the verdict event. Exit code 0 sound, 1 unsound or error, 2 bad
usage (also: nothing to audit), 3 candidate or time limit.

### Python checker

```sh
python3 tools/cegarcheck.py <project.json> [--mode auto|block|clause|clauses|core|expand]
        [--instance ID] [--variant NAME] [-c name=value] [--solutions N|all] [--optimal] [--cex NAME=pred/arity] [--show]
```

Runs a project with Python clingo (`pip install clingo`) where the page's engine is not available.
It copies the runtime's link semantics for one abstraction, one check and one link, in a
solve-check-refine loop (Shape 2); the mode is read from the loop script, and `--mode block` is the
reference run. Raw Lua and scripts with more solvers or links are refused. Only solution counts of
exhausted runs compare with the page. `--variant` applies a variant first (without it,
`settings.variant`); `tools/certcheck.py` takes the variant (and instance) from the proof log's
header, so a log of a variant run is checked against that variant.

### Driving the page

- The page sets `body[data-ready="true"]` when the engine is ready.
- `window.cegarplay` is the app object: `project` (the loaded project), `collect()` (the project
  with the editors' current text), `setProject(p)`, `control.run()`, `control.state`
  (also `#run-status[data-state]`), `stats.S` (last `S` event).
- Load a project file in the Control tab, or open `?example=<id>`.

## Troubleshooting

| Symptom | Cause and remedy |
| --- | --- |
| `relevant/1 derived nothing for link G` | A counterexample has no `relevant(T)` atom. Add `relevant/1` rules for every kind of counterexample, or use `G.block(M)`. The trace shows that candidate and counterexample (step kind `error`). |
| `link G: the glue fragments derive no glue/1 atom` | Wrap the interface atoms as `glue(T)`, or add `legacy` to the link for `cegar.py` files. The glue fragments are solved on their own: they need the domains (include `shared`). |
| `the refinement made no progress: the same candidate came back` | Shapes 2 and 3: the refinement did not change the abstraction. In a refine part, a head without `k` (later steps are silently ignored), or a clause that does not mention the candidate's atoms. |
| Fewer solutions than the Reference run | `relevant/1` marks too few atoms: a clause also removes good candidates. Mark more atoms. See [tutorial-weak-relevant](?example=tutorial-weak-relevant). |
| More candidates than expected in Shape 1 | clasp's default enumeration keeps refinement clauses weakly; try `options "--enum-mode=record"` on `A`. |
| Every candidate is rejected | An empty (or too weak) check has an answer set for every candidate. The check must be unsatisfiable when the candidate is correct. |
| clingo stopped unexpectedly | The engine trapped: in raw Lua, a broken clingo call or an error in a callback (see the hard rules). In a loop script this should not happen; report it with the project. |
| `refinement does not exclude the candidate` | A clause given to `reject` has a literal that is true under the candidate. Build clauses with `G.clause`, `G.block`, `G.core`. |
| `... the candidate is no longer valid (it belongs to an earlier step)` | A candidate `M` was stored and used after its `on candidate` call; the solver has moved on and its values are gone. Store `G(M)`, `M.atoms(p/n)` or a counterexample instead. |
| `A.solve: the assumptions of G are for solver C` | `G(M)` was passed to a solver that is not `G`'s target. Solve the target (`C.solve(assume G(M))`). |
| `unsafe variable 'Y' in bar(Y).` | A variable of the rule occurs in no positive body literal. Add a domain atom such as `num(Y)`. |
| The run ends with outcome `limit` | Time (default 60 s) or candidate limit; raise it in the Loop tab, or set 0. |
| Seeds give the same statistics | The seed needs randomising options (`--rand-freq=0.05`, `--sign-def=rnd`). |
| `-t` rejected | Threads need a cross-origin isolated page and the Threads box in the Loop tab. |
