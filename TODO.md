# CegarPlay: improvement todos

Findings from a review of the repository at the commit "Rename the export to
'Export for clingo'; drop the cegar.py import UI" (2026-11-21), tested in
headless Chromium at 1400 px and 390 px and with `tools/run.mjs`.

## How to work through this

- Read `CLAUDE.md` and `PROGRESS.md` first. The rules there still apply: no
  build step, no framework, no request to another origin; `js/compiler.js`,
  `js/driver.js` and `js/project.js` stay free of DOM and Node APIs; never let a
  Lua error cross a clingo frame.
- Do the groups in order (A is the most important). One commit per group.
- Every item has a "Done when" check. Add a test for each fix in the matching
  file under `test/`. Run `cd test && npm test` before each commit.
- Do not change the reference numbers in `docs/reference-numbers.md` or the
  `expected` counts in `examples/library.json`. If one changes, find the cause.
- When behaviour changes, update `manual.md` (and `tutorial.html` if a lesson
  mentions it), then add a short section to `PROGRESS.md`.
- Line numbers below are from the reviewed commit and may have moved.

---

## A. Runtime correctness (`lua/runtime.lua`)

### A1. A stored candidate silently returns another candidate's values

**Problem.** In `Solver:search`, `on_check` sets `M[L] = L.vbuf`, a buffer
shared by all candidates of that link (about line 833). A candidate kept after
its `on candidate` call therefore reads the values of the latest candidate.
`Model:reject` checks `self.done`; `Link:of`, `Link:block` and `Link:clause` do
not.

**Reproduce** (on `examples/tutorial-first-run.json`, declarations as in the
example):

```loop
saved = []
n = 0
search A:
    on candidate M:
        n = n + 1
        if n <= 3:
            saved.push(M)
            log "live", G.block(M)
        if n > 6: restart
for M in saved:
    log "stale", G.block(M)
```

The three "stale" lines are identical and equal the seventh candidate, not the
three "live" lines.

**Fix.** In `check_model` (about line 465), fail when `M.lazy and M.done`, with
a message in the style of the existing one, for example
`G.block: the candidate is no longer valid (it belongs to an earlier step);
store G(M) or a counterexample instead`. Check that `rt.accept` and
`candidate_text` behave sensibly for a finished candidate too. Do not copy the
buffer per candidate unless measurements show no slowdown on `gc-shape1` and
`graph-coloring`.

**Done when.** The script above ends with outcome `error` and that message, with
the loop line marked; all reference rows are unchanged; the new message is in
the manual's runtime error list and troubleshooting table.

### A2. `M.atoms(p/n)` fails on a candidate inside `search`

**Problem.** A lazy candidate has no captured atoms, so `Model:atoms` (about
line 593) fails with `atoms(pick/1): not captured in solver A`. The manual says
every `p/n` used in the script is recorded automatically, and the same call
works on a model from `A.solve()`.

**Reproduce.**

```loop
search A:
    on candidate M:
        log M.atoms(pick/1)
        stop
```

**Fix.** Preferred: support it. In `Model:atoms`, when `self.lazy` and not
`self.done`, build the list from the solver's capture (`s.caps[key].lits` /
`.syms`) with `self.control.assignment:is_true(...)`. Capture literals are
program literals, so map them to solver literals once (as is done for
`L.slit`), and build the list only on demand so that searches that never call
`atoms` pay nothing. If this turns out to be unsafe or slow, keep the
restriction but replace the message by one that says `atoms` is not available
on a candidate inside `search`, and document it.

**Done when.** The script above logs the picked atoms of the first candidate
(or gives the clear error); `manual.md` describes the behaviour chosen.

### A3. Assumption lists are not checked against the solver

**Problem.** `A.solve(assume G(M))`, where `G` targets `C`, applies `C`'s
literals to `A` and returns `none` without an error.

**Reproduce.**

```loop
M = A.solve()
X = A.solve(assume G(M))
log X
```

**Fix.** Tag the array returned by `Link:of` with its link (`self.buf.link =
self`); keep the tag through `rt.concat` (a list of the links it contains). In
`convert_assumptions` (about line 672), fail when a tagged list's `link.to` is
not the solver being solved: `A.solve: the assumptions of G are for solver C`.
Untagged lists (raw Lua) pass as before.

**Done when.** The script above ends with that error; `lang-second-solver`
(two incoming links, `rt.concat`) still gives its expected count.

### A4. The time limit is not checked in a loop without solver calls

**Problem.** `tick` (about line 186) runs once per candidate and once per
solve. A script such as `loop:` / `    x = 1` never reaches it. In the page the
backstop in `js/engine.js` ends the worker 2 s after the limit, but with limit 0
or in `tools/run.mjs` the run never ends.

**Fix.**
1. In `js/compiler.js`, emit a cheap limit check at the top of the body of
   every `loop`, `while`, `repeat` and `for` (for example `rt.tick()`), which
   calls the existing limit logic without sending statistics more often than
   now. Keep the line map intact.
2. In `tools/run.mjs`, add a backstop like the page's: when `--seconds N` (or
   the project's limit) is above 0, end the process `N + 2` s after the start
   with a message and exit code 1.

**Done when.** The two-line script with `seconds = 3` ends with outcome `limit`
in both the page and `tools/run.mjs`; the generated Lua in the "How it
compiles" table of the manual is updated; the candidates per second of
`graph-coloring` are within noise of before.

### A5. Validation messages show an internal name and are cut off

**Problem.** A rule with an unsafe variable (add `bar(Y).` to a fragment and
press Run) is reported as

```
Error in fragment abstraction, line 6: unsafe variables in:
bar(Y):-[#inc_validate__].
'Y' is unsafe
```

and the message under the run bar keeps only the first line:
`Not started: fragment abstraction, line 6: unsafe variables in:`
(`js/control.js`, about line 114, `first.message.split('\n')[0]`).

**Fix.** Where validation problems are built (search `js/driver.js` for the
place clingo's messages are parsed), remove the `:-[#inc_...]` body that
clingo adds for a non-base part, so the rule reads `bar(Y).`. For the run-bar
message, join the lines of a multi-line message into one sentence, for example
`unsafe variable 'Y' in bar(Y).`.

**Done when.** Neither the Output tab nor the run bar shows `#inc_`; the run-bar
message names the variable; a test in `test/driver.test.mjs` covers it.

---

## B. Accessibility and small screens

### B1. The tabs cannot be reached with the keyboard

**Problem.** `css/main.css` (about line 101) hides the tab radio buttons with
`display: none`, so the Tab key goes from the run bar straight into the Control
tab's content. Measured focus order: Run, Solutions, Edit, library summary, ...

**Fix.** Hide the radios visually instead (position absolute, 1 px, clipped,
opacity 0) so that they keep focus; arrow keys then switch tabs natively. Show
focus on the label: `input[name="tabs"]:focus-visible + label { outline: ... }`.
Replace the invalid attribute `name="tabs"` on the `<label>` elements in
`index.html` by a class (`class="tab-label"`) and update the selectors in
`css/main.css` and any in `js/` and `test/browser/`. Give each radio an
`aria-controls` pointing at its section. The hidden Manual and Internals tabs
must stay out of the focus order while hidden.

**Done when.** A browser test presses Tab from the page start, reaches the tab
row, switches tabs with the arrow keys, and sees a visible focus ring; the
existing `?tab=N` behaviour is unchanged.

### B2. The file input cannot be reached with the keyboard

**Problem.** "Select file" is a `<label>` for a hidden `<input type="file">`.

**Fix.** Make it a real `<button>` that calls `fileInput.click()`, or hide the
input visually (as in B1) and style `:focus-visible` on its label.

**Done when.** The control is in the Tab order and Enter or Space opens the
file dialog.

### B3. Contrast of the tab labels and notes

**Problem.** Inactive tab labels are `#bbb` on white (about 1.9:1); several
notes use `#aaa`.

**Fix.** Use a colour with at least 4.5:1 on white for all text (for example
`#6b6b6b` for inactive tabs and notes); keep the active tab darker. The orange
Tutorial label also needs 4.5:1 or a non-colour cue.

**Done when.** No text colour in `css/main.css` is below 4.5:1 against its
background.

### B4. Tabs on narrow screens have no name

**Problem.** Below 650 px the tab labels get `font-size: 0`, leaving only the
icon: no visible text and no accessible name.

**Fix.** Keep the text for screen readers (wrap it in a span that is visually
hidden below 650 px rather than zero-sized), and add `title` attributes. Check
whether short text under the icons fits at 390 px; if it does, prefer that.

**Done when.** At 390 px every tab has an accessible name and a tooltip.

### B5. The Loop tab overflows sideways at 390 px

**Problem.** At a 390 px viewport the Loop tab's page width is 455 px (the
constants table and the Threads row).

**Fix.** Let the constants table shrink (inputs `width: 100%`, `min-width: 0`),
wrap the Threads note onto its own line, and wrap wide tables in the existing
`.table-wrapper`. Check the Statistics tables the same way.

**Done when.** A browser test at 390 px finds
`document.documentElement.scrollWidth === innerWidth` on every tab.

### B6. Modals and status are not announced

**Fix.** In `index.html` and `js/modal.js`: give `.modal-dialog`
`role="dialog"`, `aria-modal="true"` and `aria-labelledby` its heading; move
focus into the modal when it opens and back to the opener when it closes;
close on Escape; keep Tab inside. Give `#run-status` and `#run-message`
`role="status"` (`aria-live="polite"`). Give the info links (`a.modal-link`,
whose text is only an icon) an `aria-label`.

**Done when.** A browser test opens a fragment's info modal with the keyboard,
closes it with Escape, and focus is back on the link.

---

## C. Features

### C1. Share links for the user's own project

**Problem.** Only library examples have a URL (`?example=<id>`).

**Fix.** Add "Copy share link" to the Control tab. Encode `Project.save(p)`
without `runs`, compressed with the browser's `CompressionStream('deflate-raw')`
and base64url, in the URL fragment: `#p=<data>`. The fragment never reaches the
server. On start-up, `#p=` takes precedence over the kept project and behaves
like `?example=`: it does not replace the kept project until the user edits
(`app.saveBlocked`). Decode through `Project.load`, so a bad link gives the
usual error. Warn in the status line when the link is longer than about 8,000
characters, and fall back to an uncompressed form if `CompressionStream` is
missing. Put the encode/decode functions in a DOM-free module so Node tests can
cover them.

**Done when.** A round trip (encode, open the link in a fresh context, compare
`window.cegarplay.collect()`) passes in a browser test for `graph-coloring`
and for a raw-Lua project; the manual's URL table lists `#p=`.

### C2. Keep the example and the tab in the address bar

**Problem.** Loading an example from the library or the tutorial, and switching
tabs, leave the URL unchanged, so the state cannot be bookmarked and Back does
nothing useful.

**Fix.** In `js/init.js`: after an example loads, `history.replaceState` to
`?example=<id>` (keeping `nocoi`, `manual`, `internals`); remove the parameter
once the project is edited or replaced by a file or a new project. On a tab
change, update `tab=N` with `replaceState`. Do not add history entries.

**Done when.** After loading `nash` from the library and opening Output, a
reload shows `nash` on the Output tab.

### C3. Check ASP fragments while typing

**Problem.** The loop script is compiled 500 ms after each edit; fragments are
validated only on Run.

**Fix.** About 800 ms after the last edit of a fragment, and only when no run
is active, run the existing fragment validation (the `--mode=gringo` parse
from `js/driver.js`) and mark problems with `Editors.setMarks`. A run must
cancel a pending check (as it does for the loop check). Keep it off the engine
while a run is active, and make sure a stale result of an older edit is
dropped.

**Done when.** Typing an unsafe rule marks the line without pressing Run, and
fixing it clears the mark; the run flow and its tests are unchanged.

### C4. A faster first impression

**Problem.** The default project (`graph-coloring`, n = 6, all solutions) takes
about 5 s for 31,776 candidates, and its clauses average 18 of about 20
literals, so the first run shows little of what refinement gains.
`tutorial-first-run` takes 0.07 s (61 solutions, 107 candidates, 46
refinements).

**Fix.** Ask the owner first: this changes what the page opens with. Proposal:
open with `tutorial-first-run` when nothing is kept in the browser, and keep
`graph-coloring` in the library unchanged. Tests that rely on the default
example must name their example.

**Done when.** A fresh visit (`?fresh=1`) finishes its first run in well under
a second, and the reference rows still pass.

### C5. Make the library easier to see and to scan

**Problem.** The library (58 examples, 41 of them in "problems") sits in a
closed `<details>`; its groups are closed too.

**Fix.** Open the library section by default when no project is kept in the
browser. Split "problems" in `tools/library.mjs` / `tools/make-examples.mjs`
into the groups the manual's table already uses (original, contributed
exists-forall, contributed with several solvers or raw Lua), or add tags and
tag chips to the filter. Regenerate with `node tools/make-examples.mjs`; the
example files must stay byte-identical apart from the manifest.

**Done when.** `test/library.test.mjs` passes and the manual's library table
matches the manifest's groups.

---

## D. Polish

### D1. Page metadata and credits

- Add a real favicon (an inline SVG data URL is enough; no request to another
  origin) in place of `href="data:,"`.
- Add `<meta name="description">` and Open Graph title and description.
- Add a small footer: link to the GitHub repository, the licence, and
  "clingo 5.8.1 via clingo-wasm" (the version is already known in
  `app.engineVersion`).

### D2. Smaller font downloads

`vendor/fonts/fonts.css` declares four Font Awesome faces under one family, so
the browser fetches `fa-brands-400.woff2` (115 KB) although no brand icon
appears to be used, and `fa-solid-900.woff2` (119 KB) for about ten icons.
Confirm with a search for brand code points, then drop the unused faces in
`tools/vendor.mjs` (the vendored files are generated; do not edit them by
hand). Optional: replace the ten icons by inline SVG and drop Font Awesome.

**Done when.** A browser test sees no request for `fa-brands-400.woff2` and
every icon still renders (tabs, info links).

### D3. Say when the project could not be kept

`saveNow` in `js/init.js` ignores a storage error. When `localStorage.setItem`
throws, show one line in the Control tab ("Not kept in this browser: storage is
full or unavailable; download the project to keep it"), and retry without
`runs` first, since the run history is the part that grows.

### D4. Continuous integration

Add `.github/workflows/test.yml`: Node 22, `cd test && npm ci`,
`npx playwright install --with-deps chromium`, `npm test`. Cache the npm and
Playwright downloads. The native clingo export test and the Python checker
tests may stay skipped.

### D5. Open item from `PROGRESS.md`

Write the upstream bug report for the trap (an error raised by clingo inside a
Lua call ends the WebAssembly instance, even inside `pcall`). Prepare a minimal
reproduction from `spike/` and a draft text in `docs/`; the owner files it.

---

## Not verified in the review

- Firefox and Safari were not tested; the findings are from Chromium.
- The live site was only fetched as text; the tests ran on a local copy of
  `main`.
- The repository's own test suite was not run during the review.
