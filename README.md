# CegarPlay

A browser playground for CEGAR loops (counterexample-guided abstraction
refinement) written in answer set programming. clingo runs in your browser,
compiled to WebAssembly; nothing is installed and nothing leaves the page.

You write ASP fragments (an abstraction that proposes candidates, a check that
looks for counterexamples, a glue fragment naming the atoms they share) and a
short loop script that declares the solvers and how they call each other. Press
Run to see solutions, live statistics and a step-by-step trace.

The page's tabs follow the work:

- **Write**: *Programs* (the ASP fragments), *Loop* (the loop script, constants,
  limits, recording, certificates, and variants: the same project with other
  fragments or another loop, chosen in the run bar, compared side by side as
  line diffs, and per instance in a campaign)
  and *Instances* (the problem's inputs as
  facts and constants, generators of random instances, importers for common
  file formats, Run all instances, Fuzz, and optional spaces: every instance up to a bound,
  for verifying a refinement strategy on all of them).
- **Run and look**: the run bar's *Shown* line says which run the result tabs
  hold, and when the project was edited since; *Output* (solutions, trace, messages, the audit's verdict:
  by enumeration, by a symbolic search, or over a space up to a bound),
  *Statistics* (counts, solver tables, charts, the run history) and, in
  Advanced mode, *Observatory* (the loop's anatomy and call timeline, a picture
  of each step in the problem's own terms, every candidate at once in the
  candidate space, all driven by one cursor; exports for slides and a lecture
  mode).
- **Compare** (Advanced mode): *Campaign* (grids of instances × variants ×
  seeds on several engines, with plots and the runs whose counts disagree in
  red).

Advanced mode, the Tutorial and the Manual are toggles under *Tabs* in the
Control tab; the browser remembers them. The Control tab also keeps named
projects (the workspace) and snapshots of the project being edited, with an
Undo after a restore or after loading another project over an edited one.
**Reset everything** forgets all that the page keeps in this browser.
- **Trust**: *Audit* (every candidate and counterexample of an instance against
  the loop's refinements), certificates per refinement, lifted refinements,
  proof logs checked by an independent Python checker, and recordings that
  replay a run without the engine.

**Loops from the literature.** Most CEGAR-style algorithms are a few lines of
loop script: CEGAR for ∃∀ problems, expansion (AReQS) and CEGIS, implicit hitting
sets (MaxHS), MARCO, core-guided optimisation (OLL), logic-based Benders
decomposition, branch-and-check and lazy clause generation (checks at partial
assignments, `on partial`), recursive QBF solving (RAReQS), clausal abstraction
(CAQE) and omission-based abstraction. The manual's section *Loops from the literature*
maps each to the pattern that writes it and a library example (the library
filter finds them by tag: `ihs`, `marco`, `oll`, `benders`, `cegis`, ...).

CegarPlay is a browser version of the Python prototype
[declarative-cegar](https://github.com/rdehaan/declarative-cegar), laid out
like [logic-game](https://github.com/rdehaan/logic-game).

## Serving it locally

The site is static files with native ES modules and no build step. Serve the
repository root with any static server, for example

    python3 -m http.server 8000

and open <http://localhost:8000/>. (Opening `index.html` as a file does not
work: workers and modules need http.) URL parameters: `?example=nash` loads
`examples/nash.json` from the example library (`?file=` is the older name),
`?tab=4` opens the fourth tab, `?manual=true` shows the Manual tab (tab 8),
`?internals=true` shows the Internals tab, `?fresh=1` ignores the project kept
in the browser.

## Tutorial and manual

The Tutorial tab (`tutorial.html`) teaches CEGAR, the loop language and the
tools in thirteen lessons, each with an example to load: a first run, fragments
and links, the trace and statistics, the Observatory, unsound refinements and
the audit, instances, campaigns, loop shapes, loop scripts, certificates and
recordings, and a recipe for your own problem. The technical manual (`manual.md`) is the
complete reference, for lookup and for AI agents; the page renders it in a
Manual tab that "Show the technical manual" (Tutorial or Control tab) turns on.
`llms.txt` points agents to the manual, the library and the headless runner.

The design guide (`guide/`, twelve static pages) teaches how to design a loop:
the abstraction, the check, refinements and their soundness, loop shapes,
rule refinements, cores and optimisation. Every step is a library example
(group "Guide") opened with one click, and every number on a page is measured:
`node tools/guide-numbers.mjs --check` and `test/guide.test.mjs` keep them true.

## Example library

`examples/library.json` lists the examples (groups: tutorial, the loop
language, loop shapes, guide, and problems by category: logic and QBF, knowledge
representation and explanation, graphs, games and social choice, planning and optimisation,
puzzles); the Control tab shows it with a filter, a Load button and a
link per example. Most problems keep their input in instances, with expected
counts that `test/instances.test.mjs` checks; some add generators, a campaign
suite or a domain view. All files are generated by
`node tools/make-examples.mjs` (hand-written ones in `tools/library.mjs` and
`examples/contrib/`); `test/library.test.mjs` checks the solution count each
entry promises, and `examples/replays/` holds a recording of every fast example.

## Running a project without the page

    node tools/run.mjs <project.json | library id> [-c n=6] [--solutions N|all] [--json]

runs a project with the same engine and runtime as the page and prints the
solutions, log lines and a summary (`--json`: every event as a JSON line).

The project being edited is saved in the browser's `localStorage` and restored
after a reload (unless `?file=` or `?fresh=1` is given). Ctrl+Enter runs.

## Deploying on GitHub Pages

Push the repository and enable Pages for the `main` branch, root folder. Nothing
needs building. GitHub Pages cannot send the cross-origin isolation headers, so
`coi-serviceworker.js` (loaded first by `index.html`) adds them through a
service worker: on the first visit the page reloads once and is then isolated.
Isolation enables Pause and Stop, and the threaded engine (`clingo-mt`,
solver options such as `-t 2`). Everything else works without it; `?nocoi=1`
skips the service worker.

## Known limitations

- An error raised inside clingo itself (not in your loop script) ends a run
  without a message: the page reports "clingo stopped unexpectedly" and the last
  output lines. To keep this rare, every run is preceded by a validation of all
  fragments and the loop script.
- A single solve call that never returns can only be ended by Abort (or by the
  time limit backstop, two seconds after the time limit).
- The seed changes the search only with *Randomized search* (Loop tab, or
  *randomized* next to the seed in the run bar) or randomising solver options,
  such as `--rand-freq=0.05`.

## Tests

    cd test && npm install && npm test       # Node tests and Chromium browser tests
    npm run test:slow                        # adds the slow reference rows

The browser tests use Playwright (`npx playwright install chromium` once);
`BROWSER=firefox npm test` runs them in Firefox.
`test/serve.py <port> [coi]` serves the site, optionally with the two
cross-origin isolation headers.

## Engine and vendored files

The engine is the npm package `clingo-wasm@0.6.0` (clingo 5.8.1 with Lua
5.4.6). `node tools/vendor.mjs` copies its build into `vendor/clingo-wasm/`
(with sha256 sums in `VERSION`) and the fonts into `vendor/fonts/`.
`node tools/make-examples.mjs` rebuilds `examples/*.json` from the files of
declarative-cegar (cloned into `reference/`).

## Licences

- CegarPlay: MIT, see `LICENSE`.
- clingo-wasm: Apache-2.0 (Dominik Moritz). clingo: MIT (Potassco). Lua: MIT.
- From [logic-game](https://github.com/rdehaan/logic-game) (MIT, Copyright (c)
  2024 Ronald de Haan): the page layout and `css/main.css`, `js/ace.js` (ACE,
  BSD), `js/mode-gringo.js` (taken in modified form from potassco.github.io,
  MIT) and `js/modal.js`.
- Examples: built from [declarative-cegar](https://github.com/rdehaan/declarative-cegar) (MIT).
- coi-serviceworker: MIT (Guido Zuidhof and contributors).
- Open Sans: SIL Open Font License 1.1. Font Awesome Free: fonts SIL OFL 1.1,
  icons CC BY 4.0. Licence texts in `vendor/fonts/`.
