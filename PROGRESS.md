# Progress

Update this file at every checkpoint. After a context clear, read it first: it says where the
project stands. The dated log of how it got here (2026-11-20 to 2026-11-27, every phase, request
and decision) is `docs/history.md`; search it for the reason behind something.

## Where the project stands (2026-11-27)

Everything planned is built: PLAN, PLAN2 and PLAN3 (all removed; git history), the design guide,
the tutorial, the manual, the Refinery and the UI reorganisation. `manual.md` describes what the
code does now.

- **App** (`index.html`, `js/`, `lua/`): tabs Home (1), Tutorial (2), Programs (3), Loop (4),
  Output (5), Statistics (6), Internals (7, `?internals=true`), Manual (8), Instances (9), Campaign
  (10), Observatory (11), Refinery (12); every tab but Internals is always shown. Top bar
  with the Project menu, Run/Audit, instance, variant, run options. Autosave, workspace, snapshots,
  share links (`#p=`), recordings and replays.
- **Library**: 165 examples in 13 groups (`examples/library.json`; built by
  `tools/make-examples.mjs` from `tools/library.mjs`, `tools/guide.mjs`, `tools/exercises.mjs` and
  `examples/contrib/*.json`); 148 replays in `examples/replays/`.
- **Guide** (`guide/`): 22 chapters in two parts plus how-to pages; every number on a page is
  measured (`tools/guide-numbers.mjs --check`). **Book**: `book/cegarplay.md`, generated.
- **Tests**: 82 files. Full suite on 2026-11-27: 1,534 tests, 1,435 pass, 0 fail, 99 skipped
  (75 benchmark-only, 23 `SLOW=1`, 1 native clingo with Lua), about 18 min on 4 cores; the
  voting-justification coverage tests take about 11 of those minutes.

## Open items

- For the owner: deployment (GitHub Pages or a dedicated origin: storage and the service worker
  are per origin); a first CI run on GitHub (`.github/workflows/test.yml`, never run); filing the
  trap report (`docs/upstream-trap-report.md`, repro in `docs/trap-repro/`); a read of the guide
  by a person; Firefox and Safari checks of recent UI changes.
- Smaller ideas left open are under "Not done" in `docs/history.md`, per feature.

## Known problems

- clasp's default enumeration (backtracking, `--enum-mode=bt`) does not keep
  refinement clauses added during `search` in force: later candidates may
  violate them (seen with `tutorial-weak-relevant` in Shape 1: unit clause
  `-pick(4)`, the next candidate has `pick(4)`). The result stays sound (every
  candidate is checked) but refinements prune less, and a too-weak relevant/1
  may lose no solutions in Shape 1. `options "--enum-mode=record"` on the
  abstraction solver keeps them (sum-free n=8: 77 instead of 107 candidates).
  cegar.py behaves the same (rows 1-3 equal its numbers), so the runtime is
  unchanged; the tutorial shows the weak-relevant loss with Shape 2.

## Notes for the next context

- `control:add_clause{ c }` fails with "bad argument" if `c` has non-integer
  fields (the runtime's clause tables carry `link`, `j`, ...). Always pass a plain
  copy (`plain(c)`). The error is catchable, not a trap.
- `test/helpers.mjs`: `run`, `runLua(project, lua)`, `LUA.shape1..4/reference`
  hand-written loops, `GC6()`, `FIX`, `REFINE_PART`, `splitLp`.
- Rows 4 and 10 take 10 s and 7 s; they run in the default suite (concurrency 4).
  Row 6 (18 s) runs only with `SLOW=1` (`npm run test:slow`).
- **A Lua error in the propagator hooks outside `xpcall` traps silently.** A local
  function used in a hook but defined further down the file is a nil global at
  that point -> trap. Cost an hour in phase 2 (it looked like a clasp problem with
  satisfied clauses; it was not). Test "strict _G" in `test/refine.test.mjs` runs
  the main paths with an `_G` that raises on undeclared globals. Keep helper
  locals above `rt.solver`.
- Tests: `H.runProject(project)` compiles + runs; `H.example(name)` loads an
  example; `H.stripTimes(S)` drops time fields for equality checks.
- Native clingo on this machine (conda, 5.8.3) is built without Lua, so the
  native standalone test is skipped.
- The page exposes `window.cegarplay` (app object) for debugging and tests.
  `body[data-ready="true"]` is set when the engine is ready.
- `[hidden] { display: none !important }` is needed: `.control-button` sets
  `display: inline-block`, which otherwise overrides the hidden attribute.
- Tutorial text lives in `tutorial.html` (an HTML fragment fetched by
  `js/init.js` into `#tutorial`; `.example-code` divs become read-only ACE
  editors with `data-mode="loop"|"gringo"`).
- Phase 6: `coi-serviceworker` 0.1.7 is vendored at the root by `tools/vendor.mjs`
  and configured by `js/coi-config.js` (loaded just before it): `?nocoi=1` neither
  registers nor keeps the service worker. It worked at the first try on the plain
  server (Chromium): one reload, then `crossOriginIsolated` is true. The browser
  harness opens pages with `?nocoi=1` unless `{ coi: true }` is passed, so the
  phase 4/5 tests run on a non-isolated page as before.
- In Firefox the shim's reload interrupts the first document's start-up, which
  logs console errors (aborted font downloads, Playwright's `chrome://juggler`).
  The harness clears the error list once the page is isolated, and `init.js` does
  not log start-up errors while the page is unloading.

## Consolidation (2026-11-27)

Review of UI, security, implementation and docs debt; the owner chose four groups, in order.

- **Group 1, security and bugs: done.**
  - Readme links: `safeUrl` (`js/markdown.js`) is an allowlist (http(s), mailto, relative) and
    drops any URL with a control character, whitespace or backslash (a leading `\x01` before
    `javascript:` reached the href). Link pattern bounded (`[^\[\]]{1,500}`), quotes nested at
    most 16 deep: a share link of `[[[...` froze the page. External links `noopener noreferrer`.
  - Share links unpack to at most 8 MB (`MAX_SHARE_BYTES`, `js/share.js`); readmes at most
    200,000 characters (`MAX_README`, `js/project.js`).
  - Content-Security-Policy meta in `index.html` and every guide page (`script-src 'self'
    'wasm-unsafe-eval'`, styles may be inline for ACE). The inline `window.coi` script moved to
    `js/coi-config.js`. Checked in Chromium: no violations on every tab, a threaded run, a guide page.
  - A run whose engine failed to start now ends as a trap (`js/engine.js`); the Lua files are
    fetched with a status check (`init.js` `start`); the Refinery's staleness poll runs only while
    it is on screen; leaving a tab ends that tab's tour card; the Refinery's info links show `?`;
    the anatomy box puts its counts on two lines; the Loop tab fits 390 px (variant cards and
    note labels could not shrink); "Shown:" becomes "Still shown (the new run did not start):"
    after a run that did not start (test 4b in `browser/page.test.mjs`).
- **Group 2, small UI polish: done.**
  - The global `label { padding: 5px 15px; text-align: center; ... }` was the tab labels' rule
    applied to every label (form labels were indented); now only `label.tab-label` has it, and a
    label that wraps its control leaves 4 px before the box. Form controls take the page font
    (`font-family: inherit; font-size: 13px`; they were Arial 13.3 px). Dead `label[for=tab2]`
    accent rule removed; CSS comments say Home, not Control tab.
  - Home's "advanced tabs can be switched on" sentence hides while all three are on; the name
    is "advanced tabs" everywhere (Home, Tutorial, tour). The Refinery toggle stays in Settings
    only (`browser/lab.test.mjs` asserts it).
  - Campaign: a hint instead of an empty grey text area when the project has no suite.
    Internals: a folded intro like the other tabs. Instances: the import format and CSV column
    map are folded under "Import options". Project-menu items show a focus bar.
  - Below 760 px only the top bar sticks (the run summary scrolls; `topbar.js` leaves it out of
    the scroll padding there).
  - Not done (a design question for the owner): graph-coloring's first run is at n = 6 (about
    20 s) because no instance is picked by default; the restructuring of tabs and help is a
    separate proposal.
- **Group 3, docs and CI: done.**
  - `PROGRESS.md` cut from 2,700 lines to this hand-over; the dated log is `docs/history.md`
    (verbatim, with a note on removed files). References to it in tests, tools and docs updated.
  - CLAUDE.md: rule 5 names what it forbids (`h:get`/`h:model`; `on_model` in an `xpcall` is fine,
    as `Solver:search` does); the missing tools and `npm run test:slow` listed; what `docs/` holds.
  - README (`?tab=4` is the Loop tab; the guide has 22 chapters) and `llms.txt` (the guide's two
    parts) corrected.
  - CI: `permissions: contents: read`, Python clingo installed (the certcheck, draw and multicheck
    tests ran as skips there), timeout 45 min (the suite takes about 18). The slow voting coverage
    tests stay in the default suite: cutting them is the owner's call.
  - `test/generators.test.mjs`: `tools/make-aspq.py --check` and `tools/make-bsml.py --check` (the
    committed contrib files equal what the generators write). `make-ja.py` has no `--check`; it
    rewrote identical files on 2026-11-27.
- **Group 4, code consolidation: done.**
  - `js/dom.js` (`$`, `h`, `svg`, `cssVar`, `download`) and `js/util.js` (DOM-free: `hashText`, `fmt`,
    `plural`, `escapeHtml`, `csvField`, `csvRows`) replace 12 DOM builders (some set `"null"`
    attributes or appended `null` children: the shared `h` skips null/undefined/false attributes
    and children and flattens arrays), 7 downloads, 4 FNV hashes and the number, plural, CSV and
    escape copies. `run-story.js` and `loop-walkthrough.js` keep their own `fmt` (0 for a missing
    value, not a dash); `anatomy.js` and `stats.js` keep their own `secs` (different formats).
  - Project hashes in `js/project.js`: `fragmentsHash`, `programHash`, `sourceHash` (JSON shapes
    unchanged: recordings and replays store them).
  - `tools/engine.mjs` (`engineRun`, `lua`): the one Node engine wrapper (run, bench, lab,
    make-replays). The page's two workers and `test/helpers.mjs` (stdin) keep their own.
  - `js/init.js` 1,275 -> 1,089 lines: `js/library-ui.js` (the library on Home) and
    `js/docs-tabs.js` (Manual and Tutorial tabs, code blocks, `#manual-`/`#tut-` links).
    `js/instances-tab.js` 1,277 -> 550: `instances-generators.js`, `instances-fuzz.js`,
    `instances-spaces.js` hold classes whose methods are copied onto `InstancesTab.prototype`
    (`this` is the tab); `instances-common.js` the shared helpers.
  - Removed (owner: no need to keep old links working): `?file=`, `?lab=1`, `?advanced=1` and the
    migration of `cegarplay.advanced`; `?example=` and `?refinery=1` remain. Dead exports
    `DRAW_FUNCTIONS`, `markCount`, `trivialBounds`, `isAgree`, `maskCount`, `Recording.solverName`.
  - Not done: `compile()` in `js/compiler.js` is still one 556-line closure (a Codegen class
    would be the next step); the loop-header `DECL` of `tools/library.mjs` lacks
    `options "--heuristic=Domain"` for C, unlike `js/project.js` and `tools/guide.mjs` (changing
    it would change generated examples, replays and numbers).
- **Tab bar and help (owner approved the proposal): done.**
  - Tab row: Home · Write: Programs, Loop, Instances · Read: the group tabs **Results** (Output,
    Statistics), **Analyse** (Observatory, Campaign, Refinery; hidden while all three are off) and
    **Learn** (Tutorial, Manual, links to the guide, the guided tour and the loop walkthrough).
    A group's sub-tabs are a second row (`.sub-tabs`, shown by CSS `:has` on the checked radio);
    a group tab opens the sub-tab last used in it (`js/topbar.js`). Every radio, section and
    `?tab=N` id is unchanged. Internals is a Project-menu item (`#menu-internals`, with
    `?internals=true`). Digits 1-7 number the tab row (a group tab opens its last sub-tab).
  - Deviation from the proposal: Statistics stays a tab of its own (a sub-tab of Results) instead
    of a section of Output; the run summary and many tests address it as tab 6.
  - Help: the tab tours no longer pop up on a tab's first visit; "Tour of this tab" in each tab's
    fold and Settings start them. The Refinery's "?" already opened inline like the others.
  - Tests: `B.openTab(page, n)` (harness) opens a sub-tab through its group; a new test in
    `browser/tabs.test.mjs` covers the groups. Gotcha: a MutationObserver on `hidden` sees every
    write, even of the same value; `syncGroups` writes only on a change (it looped and the page
    never fired load).
- **Every tab always shown (owner's request): done.** No tab toggles remain (Settings, Tutorial tab,
  Shift+letter keys); old stored choices are removed at start-up; a line after the Analyse sub-tabs
  says what the open one is for; the Manual is fetched on its tab's first opening. `?manual=true`
  and `?refinery=1` are ignored. Details in `docs/history.md`.
- **Empty states and folds (owner's request): done.** Output and the Refinery show one line before
  there is anything; Instances folds Generators and Spaces with a summary; the Observatory folds its
  exports; Campaign row buttons are disabled without rows; Tutorial and Manual have the tabs' help
  fold; the status says "ready". Details in `docs/history.md`.
