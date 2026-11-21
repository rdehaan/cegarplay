# Spec: the application

Read sections 1–4 for phase 3, sections 5–8 for phase 4, sections 9–11 for
phase 5, section 12 for phase 6.

CegarPlay is a static site: plain files, native ES modules, no build step, no
framework. It is modelled on https://github.com/rdehaan/logic-game (clone it
into `reference/logic-game` and read `index.html`, `css/main.css`,
`js/control.js`, `js/inputs.js` before writing the page).

## 1. Project model (`js/project.js`, no DOM)

```json
{
  "format": "cegarplay",
  "version": 1,
  "title": "Graph colouring",
  "description": "Connected graphs with a leaf colouring that no proper 3-colouring extends.",
  "fragments": [
    { "name": "shared", "text": "...", "description": "Added to every solver." },
    { "name": "abstraction", "text": "..." },
    { "name": "glue", "text": "..." },
    { "name": "check", "text": "..." }
  ],
  "loop": { "language": "loop", "text": "solver A = shared + abstraction\n..." },
  "settings": {
    "constants": { "n": "6" },
    "solutions": 1,
    "seconds": 60,
    "candidates": 0,
    "trace": 200,
    "seed": 0
  },
  "runs": []
}
```

- `fragments` is ordered (tab order). Names match `[a-z][a-z0-9_]*` and are unique.
- `loop.language` is `"loop"` or `"lua"`.
- `solutions`: 0 means all. `seconds`, `candidates`: 0 means no limit.
  `trace`: number of steps recorded, 0 = off. `seed`: 0 = clingo's default.
- `runs`: optional, final statistics of earlier runs (section 10).
- `load(json)` validates the shape, fills defaults, and keeps unknown keys so
  they survive a save. A file without `format` that has logic-game-style keys
  is rejected with a clear message.
- `save(project)` returns pretty-printed JSON (2 spaces).
- A new empty project has the four default fragments (empty), the Shape 1
  template and default settings.

## 2. Import and export (`js/project.js`)

### 2.1 Import of files written for `cegar.py`

`importLp(text, title)` returns a project.

1. Split at the directives `#program shared.`, `#program guess.`,
   `#program base.`, `#program glue.`, `#program check.` into fragments
   `shared`, `abstraction` (for `guess` and `base`, and for text before the
   first directive), `glue`, `check`. Several sections of one name are joined.
2. Any other `#program` directive (for example `#program refine(k).`) is left
   in place inside the fragment where it occurs.
3. The split must ignore directives inside `%` line comments, inside
   `%* ... *%` block comments and inside double-quoted strings. Write a small
   scanner for this; a regular expression over the whole text is not enough.
   `reference/declarative-cegar/explain1.lp` is the test case: it has block
   comments and many commented-out lines.
4. Loop script: the Shape 1 template. If the glue fragment contains no `glue(`
   outside comments, add `legacy` to the link line.

### 2.2 Exports

| Function | Output |
| --- | --- |
| `save(project)` | Project JSON |
| `exportLp(project)` | The four default fragments joined with `#program shared.` / `guess.` / `glue.` / `check.` headers. Offered only if the project has exactly those four fragments. |
| `exportStandalone(project, runtimeLua)` | The assembled program with `SETTINGS.plain = true` and a comment header: how to run (`clingo file.lp --outf=3`), and that clingo must be built with Lua (the PyPI `clingo` package is not; Ubuntu's `gringo` package and conda-forge builds are). |

## 3. Validation (`js/driver.js`, no DOM)

`validate(project, engineRun)` runs before every run and returns a list of
problems `{ where: {kind: "fragment"|"loop"|"settings", name, line, col}, severity, message }`.
`engineRun(program, options)` is an injected function that executes one clingo
run and returns `{ status, out: string[], err: string[] }` (the worker on the
page, a direct module call in Node tests).

Steps:

1. If `loop.language` is `loop`: `compile`. Compiler errors become problems on
   the loop editor. Stop here if there are any.
2. For each solver and each link (from the compiler's result; for raw Lua
   projects skip steps 2 and 3): join its fragments exactly as the runtime does
   but with `#program validate__.` in place of `#program base.`, and run it with
   options `--mode=gringo -Wnone` and one `-c name=value` per constant. A part
   that is never grounded is still parsed and safety-checked, so this costs
   milliseconds. Verified results:
   - missing dot: status 65, stderr contains `-:3:1-2: error: syntax error, unexpected <IDENTIFIER>`
   - unsafe variable: status 65, stderr contains `-:2:1-11: error: unsafe variables in:` and `-:2:3-4: note: 'X' is unsafe`
   - valid text: status 0
   Parse every stderr line of the form `-:L:C1-C2: error: message` (the end may
   also be `L2:C2`). Map `L` to a fragment and a line with the offsets recorded
   while joining. Following indented lines and `note:` lines belong to the same
   problem. If the same fragment is used by several solvers, report each
   problem once.
3. Name checks: every `expand` part must occur as `#program <part>(` in a
   fragment of that solver (outside comments).
4. Settings: constants' names match `[a-z][A-Za-z0-9_]*`; values are non-empty
   and contain no whitespace or quotes.

A run starts only if there is no problem of severity `error`.

`assemble(project, compiled, runtimeLua, { poll, plain })` builds the program
described in `spec-runtime.md` section 2 and returns
`{ program, loopStartLine, map }` so that an `E` event's line can be mapped to
a loop-script line.

## 4. Engine worker (`js/worker.js`) and client (`js/engine.js`)

### 4.1 Worker

A module worker. It imports `../vendor/clingo-wasm/clingo.js` (or
`clingo-mt.js`) and creates one module instance. `spike/web/worker.js` is a
working version; keep its structure.

Messages to the worker:

| Message | Meaning |
| --- | --- |
| `{ type: "init", threads: bool, control: SharedArrayBuffer or null }` | Load the build. Reply `ready`. |
| `{ type: "run", id, program, options }` | Execute. Replies `lines` (repeatedly) and `done`. |

Messages from the worker:

| Message | Meaning |
| --- | --- |
| `{ type: "ready", ms, threads }` | Module loaded. |
| `{ type: "lines", id, out: string[], err: string[] }` | Batched output. Flush when 50 ms have passed since the last flush (checked on each printed line) and at the end. |
| `{ type: "done", id, status, ms }` | `status` is the exit code, or the string `"trap"` with `message`. After a trap the worker posts `done` and the client must replace it. |

`stdin` handler: exactly as in `spike/web/worker.js`. It must return `null`
after the newline of each answer, or Emscripten keeps reading.

### 4.2 Client

```js
// js/engine.js
export class Engine {
  constructor({ threads = false })     // spawns a worker at once and keeps one warm
  get isolated()                        // self.crossOriginIsolated
  async exec(program, options)          // one plain run (used by validation): { status, out, err }
  start(program, options, handlers)     // a CEGAR run: handlers.onEvent(kind, object), onLine(text, isErr), onDone({status, ms, aborted})
  abort()                               // worker.terminate(); onDone({aborted: true}); spawn a new worker
  pause() resume() step() stop()        // only when isolated; write the control word and Atomics.notify
}
```

- Lines starting with `@@` are parsed: kind = third character, JSON from the
  fifth. Other stdout lines and all stderr lines go to `onLine`.
- Only one run at a time. `exec` while a run is active is an error.
- After `abort()` or a trap, a fresh worker is created immediately so the next
  run does not wait. Measured in Chromium: ready about 60 ms after abort.
- Time limit backstop: if `settings.seconds > 0`, the client aborts the run
  `seconds + 2` after start. (The runtime's own limit ends the run cleanly
  first unless a single solve call never returns.)
- Control word (isolated pages only): `Int32Array` on a 4-byte
  `SharedArrayBuffer`: 0 run, 1 pause, 2 stop. `step()` = set 0, notify, then
  set 1 after the next `lines` message arrives.

## 5. Page layout (`index.html`, `css/main.css`)

Keep logic-game's structure and look: `<h1>`, `<main>` on white, radio-input
tabs driven by CSS sibling selectors, orange top border on the active tab,
`.control-button` styling, ACE editors with `maxLines: Infinity`, modals for
help texts. Remove everything about the game board (`css/visual.css`,
`js/grid-visual.js`, `js/game.js`).

Title: `CegarPlay`. Subtitle line under it: `Play with CEGAR loops in answer set programming`.

### 5.1 Run bar (replaces `.game-controls`; always visible above the tabs)

| Element | id | Behaviour |
| --- | --- | --- |
| Run button | `run-button` | Validate, then start. Disabled while running. |
| Abort button | `abort-button` | Enabled while running or paused. |
| Pause / Resume | `pause-button` | Hidden unless the page is isolated. |
| Step | `step-button` | Hidden unless isolated; enabled while paused. |
| Stop | `stop-button` | Hidden unless isolated. Soft stop with full statistics. |
| Solutions | `solutions-select` | Options: `1`, `10`, `100`, `all`; bound to `settings.solutions`. |
| Status | `run-status` | `idle`, `validating`, `running`, `paused`, `finished`, `aborted`, `error` (also as `data-state` for tests). |
| Live line | `live-line` | `12.3 s · 16,577 candidates · 7,307 counterexamples · 7,307 refinements · 9,270 solutions`, updated on each `S` event. |

While a run is active, all editors are read-only and greyed like logic-game's
locked editors.

### 5.2 Tabs

| # | Label | id of section | Content |
| --- | --- | --- | --- |
| 1 | Control | `section-control` | Example selector + Load; upload JSON; download JSON; import `.lp`; export `.lp`; export standalone. Status lines like logic-game. |
| 2 | Tutorial | `section-tutorial` | Section 11. |
| 3 | Programs | `section-programs` | One block per fragment: heading with the name, description line, ACE editor (`mode-gringo`). Buttons: add fragment, rename, delete, move up/down. |
| 4 | Loop | `section-loop` | Template selector + Insert; loop editor (`mode-loop`, or Lua mode off: plain text for raw Lua); constants table (name, value, add/remove); limits (seconds, candidates), trace steps, seed. "Edit as Lua" button. |
| 5 | Output | `section-output` | Result line; solutions list (numbered, atoms, cost); messages (clingo `W` events grouped by solver + code + message with a count; `L` events; stderr lines; errors in red); trace view (section 9). |
| 6 | Statistics | `section-statistics` | Section 10. |
| 7 | Internals | `section-internals` | Generated Lua (read-only ACE), the assembled program size, the raw event lines of the last run (capped at 2,000), engine facts (clingo-wasm version, threads, isolated). |

URL parameters as in logic-game: `?file=name` loads `examples/name.json`;
`?tab=n`; the Internals tab is shown only with `?internals=true`.
Without `?file`, load `examples/graph-coloring.json`.

### 5.3 Editors (`js/editors.js`)

- `js/ace.js` and `js/mode-gringo.js` are copied from logic-game and loaded
  with classic `<script>` tags before the module script; `ace` is a global.
- Fragment editors are created from the project at load time and rebuilt when
  fragments are added, renamed, removed or reordered.
- `js/mode-loop.js`: an ACE mode (`ace.define("ace/mode/loop", ...)`) with
  highlight rules for keywords, strings, numbers and `#` comments.
- Problems from validation and `E` events are shown with
  `editor.getSession().setAnnotations([...])`; the fragment heading or the tab
  label gets a marker class. Annotations are cleared when the text changes.

### 5.4 Fonts and icons

logic-game loads Open Sans from Google Fonts and Font Awesome from jsDelivr.
CegarPlay vendors both into `vendor/fonts/` (npm packages
`@fontsource/open-sans` and `@fortawesome/fontawesome-free`: copy the woff2
files and write the `@font-face` rules by hand). No request may leave the
site's own origin; phase 6 depends on this.

## 6. Run flow (`js/control.js`)

1. Run pressed: status `validating`; collect the project from the editors;
   `validate`. Problems: show them, status `error`, stop.
2. `assemble`; switch editors to read-only; clear Output and live counters;
   status `running`; `engine.start`.
3. Events: `H` to Internals and Statistics; `S` to the live line and
   Statistics; `M`, `W`, `L`, `T` to Output; `E` to Output and as an annotation
   on the loop editor (line mapped through `loopStartLine` and `map`).
4. `D` or `done`: status from the outcome (`finished`, or `error`); store the
   run in the run history; editors editable again.
5. Trap (`done` with `status: "trap"` and no `D` event): status `error`,
   message `clingo stopped unexpectedly`, followed by the last 20 output lines.
6. Abort: status `aborted`; keep everything received so far on screen.

## 7. Examples (`examples/*.json`)

Build them from `reference/declarative-cegar` with a small Node script kept in
`tools/make-examples.mjs` (so they can be regenerated).

| File | Source | Changes |
| --- | --- | --- |
| `graph-coloring.json` | `graph-coloring.lp` | Glue rules wrapped as `glue(...)`. The added `relevant/1` rule (below). `#program refine(k).` part appended to the abstraction fragment. Constant `n` = 6 in settings. Shape 1. |
| `graph-coloring-original.json` | `graph-coloring.lp` | Glue wrapped only. Description explains that these rules lose solutions and invites a comparison with the reference run. |
| `nash.json` | `nash.lp` | Glue rules wrapped as `glue(...)`. |
| `voting-justification.json` | `explain1.lp` | None (it already uses `glue(...)`). |

Wrapping means: each rule head in the glue fragment `h :- body.` becomes
`glue(h) :- body.`, and facts such as `leaf(1..n).` become `glue(leaf(1..n)).`
Then check that the converted project and the legacy import of the original
file give identical statistics (see reference numbers).

The added rule for the check fragment of graph colouring:

```
% A node that is not a leaf now may become one. Giving it a leaf colour other
% than its colour in the counterexample also breaks the counterexample.
relevant(leaf_color(N,C)) :- node(N), not leaf(N), color(C), not color(N,C).
```

The refinement part for the abstraction fragment of graph colouring:

```
#program refine(k).
% cex(k,color(N,C)): the k-th counterexample colours node N with C. It stops
% being a counterexample once an edge joins two nodes it colours alike, or a
% leaf gets a different colour.
broken(k) :- edge(N,M), N < M, cex(k,color(N,C)), cex(k,color(M,C)).
broken(k) :- leaf(N), leaf_color(N,C), not cex(k,color(N,C)).
broken(k) :- leaf(N), cex(k,color(N,C)), not leaf_color(N,C).
:- not broken(k).
```

## 8. Browser smoke tests (`test/browser/`)

Use Playwright (`npm i -D playwright` in `test/`, `npx playwright install
chromium`; add `firefox` if it installs). Serve the repository root with
`test/serve.py` (copy of `spike/web/serve.py`: plain, or with the two isolation
headers when given `coi`).

1. Page loads with no console errors and no request to another origin.
2. Run the default example: status becomes `finished`; the live line shows the
   reference numbers for graph colouring n=6 with `solutions = all`.
3. Start a long run (n=7, all solutions), press Abort after 1 s: status
   `aborted`, counters above zero; then run the default example again: `finished`.
4. Put a syntax error in a fragment: Run shows an annotation in that editor
   and the status `error`; no run starts.
5. Download JSON, reload the page, upload it: all editors equal.

## 9. Trace and replay (Output tab)

`T` events are stored in order. The view shows one step at a time:

- A slider and Previous / Next buttons over the recorded steps; a label
  `step 17 of 200`.
- Three panels side by side: Candidate (true interface atoms), Counterexample
  (shown atoms), Refinement (clause literals, or the facts of an expansion).
- Atoms of the candidate that occur in the refinement are highlighted in the
  Candidate panel.
- It works during a run (new steps extend the slider) and after it.
- If the cap was reached, a note says so and names the setting.

Atoms are rendered one per line, sorted; long lists scroll inside the panel.

## 10. Statistics tab

All values come from `H`, `S` and `D` events.

- **Summary row:** outcome, elapsed time, candidates, counterexamples,
  refinements (clauses + expansions), solutions.
- **Solver table:** one row per solver: fragments, options, calls, sat, unsat,
  solving time, mean time per call, grounding time, choices, conflicts,
  restarts, atoms, rules, expansions. A dash for values not yet known.
- **Refinements:** clauses, mean and largest length, expansions, restarts,
  automatic blocks.
- **Charts** (inline SVG built by hand in `js/stats.js`, no library): candidates
  and refinements over time (two lines); time split (one stacked bar: solving
  per solver, grounding, rest); clause length distribution (8 bars from `hist`).
  Keep at most 500 points per series; when full, drop every second point.
- **Custom counters:** table of `counters`.
- **Run history:** one row per finished run of this session: time of day, loop
  template or first script line, outcome, elapsed, candidates, refinements,
  mean clause length, solutions, seed. Each entry also stores the engine
  version, every solver's options and the settings. If two runs of the same
  fragments with `solutions = all` both finished exhausted and report different
  solution counts, mark both rows. A "Clear" button.
- **Rerun with 5 seeds:** runs the current project with seeds 1 to 5 one after
  another and adds five history rows.
- **Copy:** the current statistics as tab-separated text, and as JSON.
- On download, a checkbox "include run history" stores the history in `runs`.

## 11. Texts

- **Instructions tab:** what CEGAR is in three sentences; the four concepts
  (fragments, solvers, links, refinements); the ASP conventions (`glue/1`,
  `relevant/1`, `#program part(k).` with `k` in every head, `clause/3`); a
  walk-through of the default example; the loop language reference (statements
  and expressions tables from `spec-loop-language.md`); the five templates;
  how to read the statistics; the reference run as a soundness check. Use
  read-only ACE blocks for code, as logic-game does (`.example-code`).
- **Modals:** an info icon next to each default fragment heading and next to
  the loop editor, with a short explanation.
- **README.md:** what it is, how to serve it locally, how to run the tests,
  where the engine comes from, licences (clingo-wasm Apache-2.0; clingo and
  Lua MIT; examples from `rdehaan/declarative-cegar`, MIT).

## 12. Cross-origin isolation, pause and threads (phase 6)

Isolation needs the response headers `Cross-Origin-Opener-Policy: same-origin`
and `Cross-Origin-Embedder-Policy: require-corp`. GitHub Pages cannot send
them, so a service worker adds them.

- Vendor `coi-serviceworker` (npm package `coi-serviceworker`, file
  `coi-serviceworker.js`) at the site root and load it first in `index.html`.
  It reloads the page once on the first visit. **This shim is not verified by
  the spike.** Verify with Playwright against the plain server: after the
  reload `self.crossOriginIsolated` must be true.
- When isolated: show Pause, Step, Stop; create the control buffer; pass
  `poll = true` to `assemble`.
- When not isolated: hide those buttons. Everything else must work unchanged.
  Keep a test for the non-isolated page (`?nocoi=1` should skip loading the shim).
- Threads: a checkbox in the Loop tab, enabled only when isolated, that makes
  the engine load `clingo-mt.js`. Solvers then accept `-t N` in their options.
  Without it, a `-t` option in a script is a validation error.

Verified in Chromium with real headers (`spike/web`): pause freezes the
counters, resume continues, stop yields `@@`-events and final statistics,
`-t 2` gives correct results.
