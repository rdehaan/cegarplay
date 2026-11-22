# Recording specification

Design: `docs/directions/observatory.md`, phase V1. A recording is the event stream of one run,
with compact step and call events, that the page can save and replay without the engine.

## 1. The setting

`settings.record = { steps, n, calls, proof }`:

| Field | Values | Meaning |
| --- | --- | --- |
| `steps` | `off`, `all`, `first`, `every`, `last`, `sample` | Which steps get an `R` event: all; the first n; every n-th (1, n + 1, ...); the last n; a reservoir sample of n (fixed by the seed). |
| `n` | whole number | The N of the policy. |
| `calls` | boolean | One `C` event per solver call. |
| `proof` | boolean | Phase S5 (proof logs). |

`assemble` writes the line `SETTINGS.record = { steps = "...", n = N, calls = ... }` only when
`recordSetting(settings.record)` is not null (steps not `off`, or calls or proof on). Without it
the program text is the same as before recordings existed. `settings.trace` keeps its meaning;
`T` events are unchanged.

## 2. Events

All only with `SETTINGS.record`.

| Kind | When | Fields |
| --- | --- | --- |
| `I` | right after `H` | `links`: `{ link, from, to, atoms }` per link in declaration order (`atoms` = the interface atom texts, index j = atom j); `solvers`: names in declaration order; `record`: the setting |
| `R` | each step | `i` step number (counts every step, recorded or not), `k` kind, `s` solver index, `l` link index, `n` program line of the loop statement (map with `mapLine`), `t` seconds since the start, `c` candidate, `q` clause, `f` facts |
| `C` | each solve, models call and search | `id`, `s` solver index, `t0` start, `dt` duration, `r` result (`sat`, `unsat`, `int`), `p` id of the enclosing call (0 = none), `n` program line |

Step kinds: `r` reject (`Model:reject`), `a` add (`S.add`), `e` expand (`S.expand`), `s` solution
(an accepted model of a search, or `accept M`), `x` error (a counterexample without relevant atoms).

- `c`: the candidate as hex over the interface atoms of link `l`: atom j is bit `(j - 1) % 4` of hex
  digit `(j - 1) // 4`, digits most significant first (the last character holds atoms 1 to 4).
- `q`: the clause as signed atom indices of link `l`: `j` = the atom must be true, `-j` = false.
- `f`: every fact of an expansion, as `name(k,atom)` texts (no cap).
- `l` for an expansion or a solution: the solver's first outgoing link.

The R line is written by hand (key order `i k s l n t c q f`), not by the generic encoder.
Policies `last` and `sample` keep their lines and print them, in step order, before the final `S`.

Cost (graph-coloring, n = 6, Shape 1, every step, no calls): 31,776 R events (21,078 rejects,
10,698 solutions), 2.4 s becomes 3.1 s (about 28%; the design's budget was 10%). Gzip file 0.9 MB
with calls.

## 3. Files and replay

`js/recording.js` (no DOM): `Recording` with `add(kind, data)`, `steps`, `calls`, `solutions`,
`traces`, `stats` (last S), `done` (D), `H`, `I`, `audit`; `candidateAtoms(step)`,
`clauseLiterals(step)`, `firstViolated(solution, { link })`; `toBlob()` (gzip through
`CompressionStream`) and `Recording.fromBlob(blob)` (gzip or plain), `fromText`.

A file (`.cprec`) is line 1 `{ format: "cegarplay-recording", version: 1, title, instance, variant,
mode, engine, example, fragmentsHash }`, then one raw event line (`@@K json`) per event,
gzip-compressed. `variant` (null for the project as it is) names the variant the run used; the
candidate space and `tools/certcheck.py` apply it, older files without it mean the project as it is.

The page keeps every event of a run in `app.recording` ("Download recording" in the Control tab).
"Open recording" and `?replay=examples/replays/<id>.cprec` (only that pattern) feed a recording
through the same event handling as a run (`Control.replay`), without the engine; the run status is
then `replayed`. A replay URL loads the example the recording names first.

`tools/run.mjs --record FILE [--record-steps POLICY[:N]]` writes the same file;
`tools/make-replays.mjs` writes `examples/replays/<id>.cprec` for every `fast` example (every step and
call). `test/recording.test.mjs` checks that each replay's final S equals a live run.
