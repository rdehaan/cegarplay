# GUIDE-PLAN: "Designing CEGAR loops", a multi-page guide at `guide/`, and a dark theme

> The plan for the guide and for a dark theme of the whole site. Implement it
> one phase at a time, following this file; read "Rules for the implementer"
> first.

## Context

CegarPlay has a Tutorial tab (`tutorial.html`, 9 lessons) and a Manual tab
(`manual.md`). Both teach the *tool*: its tabs, the loop language, the options.
Neither teaches how to *design* a CEGAR loop: what goes in the abstraction, how
a counterexample becomes a refinement, how a refinement goes wrong, which loop
shape to pick. The guide fills that gap. It is a slow, multi-page course served
at `rdehaan.github.io/cegarplay/guide/`, in which every notion is tied to a
playground example the reader opens with one click.

Decisions taken in the interview:

| Question | Decision |
| --- | --- |
| Reader | Knows ASP (clingo, choice rules, constraints), does not know CEGAR. No ASP recap. |
| Relation to tutorial/manual | Complement. Tutorial = tour of the tool; guide = design course; manual = reference. All three link to each other. |
| Examples | One running problem (clique interdiction) plus side trips to other real problems. |
| Running instance | A small hand-made graph, drawn on the page, for pages 1–4; the Paley graph with constant `n` from page 5 on. |
| Side trips | Graph colouring (the original unsound `relevant/1`), explanations / minimal reasons, bilevel knapsack and fair division. Not 2QBF. |
| Size | 12 chapter pages plus an index; at most 40 new examples. |
| Topics | Core (why a loop, abstraction/check/glue, blocking, `relevant/1`, soundness, reading a run) plus: loop shapes, rule refinements, witness checks and cores, stronger counterexamples, designing the abstraction, optimisation/bilevel, theory boxes. Solver-level effects get no page of their own, only short notes where they change a number. |
| Pages | Hand-written static HTML, no generator, no framework. |
| App additions | `&fragment=` (open a fragment) and `&from=` (back-to-guide link). No run-on-arrival. |
| Teaching devices | On every page: predict-then-run with measured numbers, "what changed" before/after, exercises with solutions, recap. |
| Library | New visible group "Guide" in the library panel; existing examples reused where they fit exactly. |
| Look | Reading layout in the app's palette, with a dark theme; inline SVG diagrams. |
| Dark mode | The main app gets a dark theme too (asked for after the interview). App and guide share one set of colour tokens and one theme setting. |
| Ending | Capstone walkthrough of a fresh problem plus the collected design checklist. |
| Plan detail | This plan fixes each example's purpose and the property a test must verify; the implementer writes the ASP and measures the numbers. |

## Facts about the code the plan relies on

- A URL loads only a library example: `?example=<id>` fetches
  `examples/<id>.json` (`js/init.js:149-163`, id must match `[A-Za-z0-9_-]+`).
  `?tab=1..8` picks a tab (`js/init.js:46-47`). Nothing else is read. A project
  named in the URL does not overwrite the reader's stored project
  (`js/init.js:419-437`).
- Examples are built by `tools/make-examples.mjs` from `tools/library.mjs`
  (`GROUPS` at :229, `buildLibrary` at :237, helper `project(...)` at :40),
  from `reference/declarative-cegar`, and from `examples/contrib/*.json`.
  Output: `examples/<id>.json` and the manifest `examples/library.json`
  (`{groups, examples:[{id,title,group,summary,shape,tags,expected}]}`).
- `test/library.test.mjs`: the manifest must list exactly the files in
  `examples/`; every example outside group `problems` must have a Load button
  in `tutorial.html` (:26-32, this must change); every entry tagged `fast` with
  `expected` is run and its solution count compared (:34-43).
- `tools/run.mjs` exports `runProject(project)`; it runs a project headless
  with the same engine and runtime as the page. `test/helpers.mjs` has
  `example`, `runProject`, `finalStats`, `done`, `last`.
- The existing example `examples/contrib/clique-interdiction.json` (Paley
  graph, n=13, k=6, c=3, 39 solutions, `C.models(limit 3)`) is the endpoint of
  the running example's first half; read it before writing anything.
- The library panel is built in `js/init.js:165-211`; fragment editors live in
  `js/editors.js`.
- `css/main.css` (768 lines, about 90 hard-coded hex colours plus named ones
  such as `orange`) has no CSS variables and no dark mode; fonts are
  self-hosted in `vendor/fonts/fonts.css` (Open Sans). Palette: text `#555`,
  page `#eee`, panel white, borders `#ddd`, links `#2c5f8a`, accent `orange`,
  error `#c0392b`.
- The editors are ACE with the one bundled theme `ace/theme/textmate`
  (`js/editors.js:7`); `js/ace.js` contains no dark theme. The statistics
  charts are SVG built in `js/stats.js` (`createElementNS`, :21); the trace is
  in `js/trace.js`, dialogs in `js/modal.js`.
- Known numbers and pitfalls to draw on: `docs/reference-numbers.md`,
  `tutorial.html` lessons 5–6, `manual.md` (Refinement variants,
  Troubleshooting, Settings), `docs/chat-package/START-HERE.md` (soundness
  checklist), the descriptions inside the `problems` examples.

## Rules for the implementer

1. CLAUDE.md applies in full (no build step, no other origin, the three
   DOM-free modules stay DOM-free, tests over plan).
2. **Examples first, prose second.** For each page: write the examples, prove
   them (rule 3), measure them (rule 4), and only then write the text. If the
   measurement contradicts the claim planned below (for instance a "better"
   design needs more candidates), do not bend the text: change the instance or
   the constants until the effect is real, or change the claim to what is true.
   Record every such deviation in `PROGRESS.md`.
3. **Every guide example has a verified status.** `sound` examples must give
   the same solution count as their `baseline` (a blocking run of the same
   problem and constants, both runs with all solutions and exhausted).
   `unsound` examples are unsound on purpose and must give strictly fewer.
   A test enforces both.
4. **No number is typed by hand.** Every number in a page that comes from a run
   is a `<span data-stat="<id>:<key>">` whose text a test compares with
   `guide/numbers.json` (see Infrastructure).
5. **Code on a page is code in an example.** Every listing names the example
   and fragment it comes from, and a test checks it is still there.
6. One notion at a time. A page never uses a term that no earlier page (or the
   page itself) has introduced; the terms are those of the manual's "Model and
   terms" table (fragment, solver, link, interface atom, candidate, check,
   counterexample, relevant atom, refinement, solution, run).
7. Style: British spelling (house style), second person, short paragraphs,
   plain words, no ASP recap, no marketing tone. A page takes 10–20 minutes.
8. Do not edit `spike/` or `reference/`. Do not change existing examples'
   counts. Do not touch `tutorial.html` beyond adding links to the guide.
9. Progress is kept in a new section "Guide" of `PROGRESS.md`. Commits:
   `Guide N: <title>`. At each checkpoint print
   `CHECKPOINT G<N> reached. Safe to /clear, then say: continue with GUIDE-PLAN.md`.

## Dark theme for the whole site (phase G0a, before the guide)

Done first, so that the guide is written against the final colour tokens.

**Tokens.** A new `css/theme.css` defines every colour as a CSS variable on
`:root`: the light values are today's colours (the light look must not change
visibly), the dark values are new. It is loaded by `index.html` and by every
guide page before the page's own stylesheet. Name tokens by role, not by
colour: `--page`, `--panel`, `--text`, `--text-soft`, `--border`,
`--border-soft`, `--link`, `--accent`, `--error`, `--ok`, `--code-bg`,
`--highlight`, `--chart-1 … --chart-n`, and whatever further roles
`main.css` turns out to need. Dark values: dark grey rather than black,
contrast of body text against its background at least 4.5:1 (also for notes,
links, tags and error text; check with a script, not by eye), the orange
accent kept.

**Selection.** Three states: auto (follows `prefers-color-scheme`), light,
dark. The choice is stored in `localStorage` under `cegarplay.theme` (app and
guide are one origin, so they share it) and applied as `data-theme` on
`<html>`:

```css
:root { /* light */ }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* dark */ } }
:root[data-theme="dark"] { /* dark */ }
```

A tiny `js/theme.js` (classic script, loaded in `<head>` without `defer`, so
there is no flash of the wrong theme) reads the setting and sets the
attribute; it also exposes the toggle behaviour. A small three-state control
sits in the app header and in the guide header. Storage may be unavailable:
wrap access in try/catch and fall back to auto. Add
`<meta name="color-scheme" content="light dark">`.

**The app, piece by piece.**
- `css/main.css`: replace every colour literal by a token. Afterwards a test
  allows no hex or named colour in `main.css` and `guide.css` outside
  `theme.css` (a short allow-list for `transparent`, `currentColor`,
  `inherit`).
- Editors: write `js/theme-cegarplay-dark.js`, an ACE theme module in the form
  of the bundled textmate theme (`ace.define("ace/theme/cegarplay_dark", …)`
  with `isDark`, `cssClass`, `cssText`), covering the token classes that
  `js/mode-gringo.js`, `js/mode-loop.js` and the Lua mode emit, plus gutter,
  selection, active line, cursor, error markers. `makeEditor`
  (`js/editors.js:5-21`) picks the theme from the current setting; all live
  editors (including the read-only `.example-code` blocks made by `codeBlocks`,
  `js/init.js:308-317`) switch when the setting or the system preference
  changes (`matchMedia` change event).
- Charts (`js/stats.js`): no colour literals in SVG attributes; use
  `currentColor` and `var(--chart-n)` through classes or `style`, so the
  charts follow the theme without redrawing. Chart colours must stay
  distinguishable from each other in both themes.
- Trace highlighting (`js/trace.js`), run-history warning, library tags,
  status and error lines, modal dialogs (`js/modal.js`), the tab strip and its
  active-tab accent, tables, buttons in all states (hover, disabled, active),
  form fields and the slider, the Internals tab, the rendered manual and
  tutorial (code blocks, block quotes, tables), scrollbars
  (`color-scheme` handles the native ones).
- Colours set from JavaScript anywhere else: find them with a search for
  `style.` and `#` in `js/*.js` (not `ace.js`) and move them to classes.
- Document the setting in the manual (one short paragraph in Settings).

**Tests.**
- Node: the no-literal-colours test above; every token used in `main.css` and
  `guide.css` is defined in both themes in `theme.css`; a contrast check over
  the text/background token pairs listed in a small table in the test.
- Browser (`test/browser/theme.test.mjs`): with `colorScheme: 'dark'`
  emulated, the page and an editor have dark backgrounds; with the stored
  setting `light` they stay light under a dark system; the toggle cycles and
  persists across a reload; the setting made in the app is in effect on a
  guide page. Take screenshots of every tab in both themes (after loading an
  example and finishing a run, so Output and Statistics are filled) and look
  at each one: no unreadable text, no white panel left in dark, no invisible
  border or icon.
- The existing browser tests still pass unchanged in light.

## Infrastructure (phase G0)

### Files

```
guide/index.html            contents page: what the guide is, who it is for, how the links work, chapter list
guide/01-why-a-loop.html … guide/12-your-own-loop.html
guide/guide.css             reading layout, light and dark theme
guide/guide.js              ES module: chapter nav, code highlighting, graph figures, solution reveals
guide/chapters.js           the one list of chapters {file, title, summary}; nav and index are built from it
guide/numbers.json          measured numbers per guide example (written by tools/guide-numbers.mjs)
tools/guide.mjs             the guide examples, like tools/library.mjs (exports GUIDE_GROUP, buildGuide())
tools/guide-numbers.mjs     runs every guide example, writes guide/numbers.json; --check compares only
test/guide.test.mjs         the tests listed under "Tests"
test/browser/guide.test.mjs Playwright: pages render, deep links work
```

### Guide examples in the library

- `tools/guide.mjs` builds project objects with template strings, reusing the
  `project(...)` helper pattern of `tools/library.mjs:40` (export it from there
  rather than copying). `tools/make-examples.mjs` merges them and adds the
  group `{id: 'guide', title: 'Guide', description: 'the examples of the
  design guide, in reading order'}` to `GROUPS`, placed after `tutorial`.
- Ids: `guide-<chapter>-<slug>`, e.g. `guide-03-hit-clique`. Exercise
  solutions: `guide-<chapter>-ex<n>`.
- Each manifest entry of the group carries extra fields:
  `page` (e.g. `"guide/03-generalise.html#hit-clique"`),
  `status` (`"sound"`, `"unsound"` or `"baseline"`), and `baseline` (the id of
  its blocking run; absent on baselines). `expected` and the tag `fast` as for
  other examples; a guide example must finish in under about 5 s headless, and
  under 2 s where possible (choose constants accordingly).
- Every guide project has a `description` that says in two sentences what the
  step shows and names its page; every fragment has a `description`.
- The library panel (`js/init.js:165-211`) shows a "Guide page" link for
  entries that have `page`.
- Where an existing example is exactly what a page needs, link it instead of
  copying it (candidates are named per chapter below).

### App additions (`js/init.js`, `js/editors.js`, `index.html`, `css/main.css`, `manual.md`)

- `&fragment=<name>`: after the example has loaded, open the Programs tab
  (tab 3) with that fragment's editor selected; `&fragment=loop` opens the Loop
  tab (tab 4) on the script. An unknown name is ignored with a status-line
  note. It overrides `&tab=`.
- `&from=<path>`: accepted only if it matches
  `^guide/[a-z0-9-]+\.html(#[a-z0-9-]+)?$` (never an arbitrary URL). Shows a
  link "← Back to the guide" in the header, pointing at that path.
- Document both in the manual's URL-parameter section (`manual.md:635-646`).
- Add a link to the guide from the header or Control tab, from the last
  tutorial lesson ("where next"), from the manual's introduction, from
  `README.md` and from `llms.txt`.

### Page conventions (identical on every chapter page)

Skeleton: header (guide title linking to the index, link to the playground),
chapter sidebar built from `chapters.js` (collapsible on narrow screens),
`<main>` with the article, previous/next links at the foot. Pages are complete
HTML files that read sensibly without JavaScript (nav then shows only
previous/next, which are plain links in the HTML).

Building blocks, each a fixed HTML pattern styled in `guide.css`:

| Block | Markup | Purpose |
| --- | --- | --- |
| Playground link | `<a class="play" href="../?example=ID&fragment=F&from=guide/PAGE.html%23ANCHOR" target="cegarplay">` | Opens the example; all links reuse one tab named `cegarplay`. Every such link sits in an element with an `id`, which is the anchor `from` returns to. |
| Listing | `<pre class="code" data-lang="asp or loop" data-from="ID:FRAGMENT">` | Code quoted from an example; highlighted by `guide.js`. |
| What changed | `<div class="changed" data-before="ID:FRAGMENT" data-after="ID:FRAGMENT">` with `<del>` and `<ins>` lines | The few lines that differ between two successive examples. |
| Predict | `<details class="predict"><summary>question</summary>answer with numbers</details>` | Placed before the reader runs; the answer is hidden until opened. |
| Measured number | `<span data-stat="ID:candidates">` | Keys: `solutions`, `candidates`, `counterexamples`, `refinements`, `checkCalls`, `meanClause` (whatever `finalStats` and the per-solver statistics give; fix the key list in `tools/guide-numbers.mjs`). |
| Results table | `<table class="results">` of such spans | Side-by-side comparison of designs. |
| Theory box | `<aside class="theory">` | Short aside; skippable; never needed for a later page. |
| Pitfall | `<aside class="pitfall">` | A mistake, how it shows, how to find it. |
| Exercise | `<section class="exercise">` with `<details class="solution">` holding a playground link | 1–3 per page. |
| Recap | `<section class="recap">` | The 3–4 rules the page established, each with an `id`; page 12 collects them. |
| Graph figure | `<figure class="graph" data-del="1,4" data-clique="2,5,6">` | The small graph, drawn by `guide.js` from one node/edge table; deleted nodes greyed, a surviving clique highlighted. A `<noscript>` sentence describes it. |
| Diagram | inline `<svg>` using `currentColor` and CSS variables | The loop picture, candidate space pictures. |

`guide.css`: every colour is a token from `css/theme.css` (phase G0a), so the
guide follows the same light/dark setting as the app; text column of
about 70 characters, 17px body type, Open Sans from `../vendor/fonts/fonts.css`,
monospace for code; usable at phone width; a print style that opens all
`<details>`.

`guide.js`: no dependency, no ACE. A tokeniser of about 60 lines colours
comments, strings, numbers, variables, directives (`#program`, `#show`,
`#minimize`, `#const`), the special predicates `glue`, `relevant`, `cex`,
`clause`, and the loop-language keywords (list in `docs/spec-loop-language.md`).

### Tests (`test/guide.test.mjs` unless noted)

1. Change `test/library.test.mjs:31`: the "must be in the tutorial" rule
   excludes the groups `problems` and `guide`.
2. Every guide example is linked from the page its `page` field names, and
   every `?example=` in any guide page is a library id; every `fragment=`
   names a fragment of that example (or `loop`); every `from=` names the page
   it is on and an `id` that exists there.
3. Every `sound` guide example gives its baseline's solution count; every
   `unsound` one gives strictly fewer; every one ends `finished` without an
   error event.
4. `node tools/guide-numbers.mjs --check` semantics: a fresh run reproduces
   `guide/numbers.json`, and every `data-stat` span's text equals the formatted
   number.
5. Every `data-from` listing occurs, line by line and ignoring indentation
   and blank lines, in the named fragment. In every `changed` block the
   `<del>` lines occur in the `before` fragment and the `<ins>` lines in the
   `after` fragment.
6. The graph table in `guide.js` equals the edge facts of the small-graph
   examples.
7. Every page: listed in `chapters.js`, has the skeleton, a recap, at least
   one exercise with a solution, previous/next links that match `chapters.js`,
   no `http(s)://` resource, no dangling internal link or anchor.
8. Recap ids collected on page 12 all exist.
9. Browser (`test/browser/guide.test.mjs`): each page loads without console
   errors in light and dark; `?example=guide-03-hit-clique&fragment=check&from=…`
   opens the Programs tab on `check` and shows the back link; a hostile
   `from=` (absolute URL, `javascript:`, `..`) shows no link; one guide
   example run in the page gives the same candidate count as `numbers.json`
   (this is the check that headless and page numbers agree; if they do not,
   find out why before going on).

## The running example

**Problem.** Given a graph and numbers k and c: delete at most k nodes so that
no clique of c nodes is left. "For some set of deletions, for all sets of c
nodes, not a surviving clique": one quantifier too many for a plain
guess-and-test program.

**Small graph (pages 1–4).** Designed in phase G1 and then frozen. Requirements:
8–10 nodes; c = 3; 5–8 triangles, some sharing nodes and at least two
disjoint; a default k for which there are 2–6 solutions and a blocking run
needs clearly more than ten times as many candidates as the clause run;
planar, so it draws cleanly. Written as `edge/2` facts in `shared`. Its
coordinates live once in `guide.js`.

**Paley graph (pages 5–11).** As in `clique-interdiction`: `n` prime of the
form 4m+1, constants `n`, `k`, `c`. Defaults chosen per page so that the
slowest example on the page stays within the time budget; pages suggest
larger values to try by hand.

## Chapters

For each chapter: the notions in order, the examples (new ids unless marked
*existing*), what the tests must show, and the exercises. Example lists are a
budget, not a quota: drop one that teaches nothing, add one where a step is too
large, stay at or under 40 new examples in total.

### index — Designing CEGAR loops
What the guide is and is not (not a tool tour: link to the Tutorial tab; not a
reference: link to the manual). What the reader should know. How the links
work (one playground tab, the back link, numbers are measured). Chapter list
with one-line summaries from `chapters.js`. A diagram of the loop that the
later pages reuse.

### 01 — Why a loop
1. The problem, on the drawn graph. A deletion set, a surviving triangle.
2. The guess is easy: `{ del(V) : node(V) } k.` The test is easy for one
   given guess. Putting both in one program does not work: show the tempting
   wrong program (guess plus "some triangle survives" as a constraint the
   wrong way round) and what it computes instead.
3. The shape "exists … for all …"; where it occurs (the side-trip problems,
   one sentence each).
4. The idea of the loop in a picture: propose, test, learn, repeat.
- `guide-01-guess`: abstraction only, check is `#false.` (accepts
  everything). Shows the size of the candidate space; number of "solutions" =
  number of candidates.
- `guide-01-one-candidate`: the abstraction fixes one bad deletion set as
  facts; the check finds a triangle. The reader sees a counterexample in the
  Output tab's trace.
- Theory box: the second level of the polynomial hierarchy in five sentences;
  saturation as the other way to do it in ASP, and why this guide does not
  take it (one paragraph, no encoding).
- Exercises: pick a deletion set by hand that works; change k and predict the
  number of candidates.

### 02 — The first loop: guess, check, block
1. Two programs, two solvers. The abstraction must over-approximate: every
   solution is a candidate.
2. The check: an answer set exactly when the candidate is wrong.
3. The glue: which atoms the check gets to see. An atom that is not glued is
   silently false in the check.
4. The loop script, line by line (Reference run: `reject M with G.block(M)`).
5. Reading the Output tab: candidates, counterexamples, solutions.
6. Blocking is always sound, and always slow: it learns one candidate per
   check.
- `guide-02-block` (status `baseline` for pages 2–4).
- Pitfall: forgetting to glue; an empty check rejects everything.
- `guide-02-ex1` (solution of "glue missing: what happens and why").
- Exercises: break the glue and explain the result; write the check for
  c = 4 (constant), predict whether more or fewer candidates are rejected.

### 03 — Learning from a counterexample
1. Look at one rejected candidate and its triangle in the trace: most of the
   candidate had nothing to do with the failure.
2. `relevant/1`: the interface atoms the counterexample depends on. The
   refinement becomes a clause over just those atoms: "delete one of these
   three".
3. One clause now removes every candidate that keeps this triangle; picture
   of the candidate space with one blocked point versus one blocked region.
4. Marking everything relevant is blocking again (same numbers).
5. Why this clause is sound: every solution satisfies it. This argument is
   the thing to produce for every refinement you ever write.
- `guide-03-relevant-all`: `relevant` marks every interface atom; numbers
  equal `guide-02-block`.
- `guide-03-hit-clique`: `relevant(del(V)) :- q(V).` Shape 1 with
  `G.clause(M, X)`.
- Results table: block versus clause (candidates, refinements, mean clause
  length, solutions).
- Theory box: the refinement as a hitting-set constraint; termination (each
  refinement removes at least the current candidate, the space is finite).
- Exercises: predict the first three clauses from the picture; raise k and
  compare growth of both runs.

### 04 — Soundness: when a refinement says too much
1. A refinement that is too strong removes solutions. Nothing warns you: the
   run finishes and prints fewer solutions.
2. A plausible mistake on the running example: marking only one node of the
   triangle ("this node must go"). Show the lost solutions on the picture.
3. How to find it: the blocking run is the ground truth on small instances.
   Same constants, all solutions, both runs exhausted, compare counts; the
   run history's warning sign.
4. The count you lose depends on search order and loop shape, so a wrong
   loop can look right on one instance. Test on several small instances.
5. Too weak is safe but slow; too strong is fast but wrong. Both polarities
   matter: sometimes the counterexample depends on an atom being *false*.
6. A true story: the leaf-colouring problem from declarative-cegar, whose
   original `relevant/1` lost 1,428 of 10,698 solutions at n = 6. What the
   missing case was ("a node that is not a leaf may become one") and the fix.
- `guide-04-one-node` (status `unsound`, baseline `guide-02-block`).
- `guide-04-gc-block`, `guide-04-gc-original` (`unsound`), `guide-04-gc-fixed`:
  leaf colouring at n = 5, built from the same sources as `gc-reference`,
  `graph-coloring-original`, `graph-coloring` (reuse `gcVariant` in
  `tools/library.mjs:200`; if an existing id already is exactly the n = 5
  variant, link it instead). The n = 6 numbers are quoted from
  `docs/reference-numbers.md` with links to *existing* `graph-coloring` and
  `graph-coloring-original`.
- Pitfall box: the soundness test as a routine (the checklist's first entry).
- Exercises: find by hand a solution that `guide-04-one-node` loses; repair a
  given weak `relevant/1` in the colouring check (`guide-04-ex1`).

### 05 — Reading a run
1. Move to the Paley graph: the same loop, a constant `n`, numbers that are
   large enough to compare designs.
2. The trace, step by step: candidate, counterexample, refinement literals.
3. The Statistics tab: check calls versus candidates, clause lengths, where
   the time goes (abstraction, check, grounding), the progress chart.
4. What a good run looks like: short clauses, few candidates per solution,
   time not dominated by one solver.
5. A note, not a topic: in a Shape 1 run clasp may keep refinement clauses
   only weakly while enumerating (`--enum-mode=record` changes the count of
   candidates, never the solutions); and why the check solver uses
   `--heuristic=Domain`. Link to the manual's Settings section.
- `guide-05-paley-block` (status `baseline` for pages 5–8, smaller default n
  if needed), `guide-05-paley-clause`.
- Exercises: find the longest clause in a run and say which counterexample
  produced it; double the time limit question ("what would you change first,
  and which statistic tells you?").

### 06 — Getting more out of each check
1. Several counterexamples per candidate (`C.models(…, limit 3)`): fewer
   candidates, more check work; measure the trade.
2. Not all counterexamples are equally good. Side trip to explanations: a
   set of features is a sufficient reason if no input agreeing on them is
   classified differently. A counterexample that depends on few features
   gives a short, strong clause.
3. Asking the check for the best counterexample: `#minimize` over
   `relevant/1` with `optimal`. Cost: an optimisation per check.
4. Writing the clauses yourself in ASP (`clause/3`, `G.clauses`): several
   clauses from one counterexample, or a clause that `relevant/1` cannot
   express.
5. A separate solver that computes the refinement (one paragraph and a link
   to *existing* `lang-second-solver`; no new example).
- `guide-06-several` (running example; equals *existing*
  `clique-interdiction` up to constants: link that if identical).
- `guide-06-reason-block` (`baseline`), `guide-06-reason-clause`,
  `guide-06-reason-smallest`: sufficient reasons of at most k features, from
  the sources of *existing* `sufficient-reason`.
- `guide-06-clauses`: the running example with `clause/3`, emitting one
  clause per triangle through a chosen node (or another honest use; if none
  is honest on this problem, use the explanations problem).
- Results tables for both problems.
- Exercises: find the limit beyond which more counterexamples per candidate
  stop paying; `guide-06-ex1`.

### 07 — Designing the abstraction
1. The loop only has to learn what the abstraction does not already know.
   Anything cheap and necessary belongs in the guess.
2. A spectrum on the running example: a constant `m` puts the "no triangle"
   constraint for triangles among the first m nodes into the abstraction.
   m = 0 is pure CEGAR; m = n needs no loop at all. Measure in between:
   grounding size against candidates.
3. Interface atoms need not be the guessed atoms: gluing a derived atom lets
   one clause remove a whole class of candidates (link *existing*
   `subset-sum-game` and `af-semi-stable`, explain one of them).
4. Keeping witnesses private: atoms the abstraction needs but the check must
   not see, and what that does to solution counting (link *existing*
   `diagnosis` or `fewest-clues`).
5. What must never go in: anything that cuts a solution. The soundness test
   of page 4 catches this too.
- `guide-07-spectrum` (constant `m`; numbers quoted for three values of m,
  so `numbers.json` needs per-constant entries: key form
  `ID@m=4:candidates`).
- `guide-07-too-strong` (`unsound`): an abstraction constraint that looks
  necessary and is not.
- Theory box: abstraction and refinement as two ends of one dial; expansion
  in advance versus on demand.
- Exercises: add a symmetry-free necessary condition of your own and test it
  (`guide-07-ex1`).

### 08 — Loop shapes
1. So far the check ran inside one search (Shape 1). The alternative: solve,
   check, add, solve again (Shape 2). What changes: every solution must be
   blocked by hand; the solver restarts with everything it learnt as
   constraints.
2. Batches and restarts (Shape 4): collect counterexamples during a search,
   restart, add them all.
3. Same problem, three shapes, measured. When each tends to win (cheap
   versus expensive checks, few versus many solutions, clause versus rule
   refinements, which need the multi-shot shapes).
4. The guards: "the same candidate came back", "refinement does not exclude
   the candidate"; `A.add` inside `A`'s own search is not allowed.
- `guide-08-shape1` (= `guide-05-paley-clause` if identical: then no new
  example), `guide-08-shape2`, `guide-08-shape4`.
- `guide-08-forgot-block`: Shape 2 without blocking the solution (shows the
  no-progress guard; mark it so the tests expect the error outcome).
- Exercises: turn the Shape 2 script into "first solution only"; predict
  which shape needs the fewest candidates before reading the table.

### 09 — Refinements that are rules
1. A clause speaks only about interface atoms. Some lessons need more:
   arithmetic, or a fresh copy of part of the problem.
2. `#program refine(k)` and `cex(k, T)`: rules grounded once per
   counterexample; `A.expand(...)`; why every head must contain `k` and what
   silently happens if one does not.
3. Warm-up on the running example: the triangle clause written as a refine
   rule; identical numbers. Nothing gained, mechanism understood.
4. Where it pays, side trip to fair division: an allocation is rejected
   because another one makes everyone at least as happy. The lesson "this
   alternative dominates you whenever the sums come out this way" is a rule
   with a sum, not a clause. Compare with the best clause available.
5. The cost: each refinement grows the ground program; watch grounding time.
- `guide-09-clique-rules` (Shape 3, baseline `guide-05-paley-block`).
- `guide-09-fair-block` (`baseline`), `guide-09-fair-clause`,
  `guide-09-fair-rules`: from the sources of *existing* `fair-division`.
- `guide-09-missing-k`: the pitfall, expected to end with the documented
  guard or error.
- Theory box: clause learning versus expansion; a rule refinement as a lazily
  grounded piece of the full quantifier expansion.
- Exercises: write the refine part for "at least one node of the
  counterexample clique's neighbourhood" and test whether it is sound
  (`guide-09-ex1`; it is not, and the soundness test shows it).

### 10 — Checks that look for a witness, and cores
1. Some properties are shown by a witness, not refuted by a counterexample:
   the check is satisfiable when the candidate is *good*. Then an
   unsatisfiable check has to produce the refinement, and the unsat core
   over the assumptions is the natural one.
2. `G.core(C)`: what it contains, why it is a valid refinement after a
   *failed* witness check, and why it is not one after a check that passed.
3. Cores are not minimal: measure it.
4. Two checks in one loop, on minimal sufficient reasons: a counterexample
   check for "sufficient" and a witness check for "no smaller one".
5. Subset-minimal solutions in general: shrinking and blocking supersets
   (link *existing* `reasons-by-shrinking`, described, not rebuilt).
- `guide-10-core`: the simplest witness check; use the sources of *existing*
  `lang-core` (3-colourable graphs) unless a variant of the running example
  is as simple.
- `guide-10-minimal-block` (`baseline`), `guide-10-minimal-two-checks`: from
  *existing* `minimal-reasons`.
- `guide-10-core-misused` (`unsound`): a core taken after a passing check.
- Exercises: decide for three small problem statements whether the check
  should seek a witness or a counterexample.

### 11 — Optimisation
1. "Fewest deletions" on the running example: ask the abstraction for
   candidates smallest-first (`A.solve(optimal)`); the first accepted
   candidate is optimal. Why that is correct, and why refinements must stay
   sound for it to be.
2. When the inner problem optimises too: bilevel knapsack. From the bounded
   decision version to the optimum, with refinements that carry a number.
3. Lower and upper bounds as the loop's by-product (link *existing*
   `knapsack-bounds`, raw Lua, as the advanced version).
- `guide-11-fewest-deletions` (tests: the reported optimum equals the
  smallest k for which `guide-05-paley-block` has a solution).
- *existing* `knapsack-interdiction` and `knapsack-optimum`, linked with
  `fragment=` to the relevant parts; add `guide-11-knapsack-block` only if a
  baseline is needed for the results table.
- Theory box: optimal-first search versus improving solutions; what an
  unsound refinement does to an optimum (it can hide it without any sign).
- Exercises: make `guide-11-fewest-deletions` list all optimal solutions
  (`guide-11-ex1`).

### 12 — Your own loop: a walkthrough and a checklist
1. A fresh problem, from a plain-language statement: conformant planning (a
   plan that reaches the goal from every possible start). Sources: *existing*
   `conformant-planning`. If it resists a clean step-by-step telling, use
   `fewest-clues` (unique-solution puzzle) instead and record the swap.
2. The steps, each with its example and each naming the earlier page it
   applies: state the quantifiers; write the abstraction; write the check
   with `#false.` first, then for real; glue; blocking run as ground truth;
   first `relevant/1`; soundness test; measure; decide clause or rule; pick
   the shape; scale the constants.
- `guide-12-step1-guess`, `guide-12-step2-block` (`baseline`),
  `guide-12-step3-clause`, `guide-12-step4-rules`.
3. The checklist: every recap rule of pages 1–11, grouped (abstraction,
   check, refinement, soundness, measuring, shape), each linking to its page.
4. A decision table: situation → shape and refinement kind → page.
5. Where next: the manual, the `problems` group of the library, the chat
   package for writing examples with an assistant
   (`docs/chat-package/START-HERE.md`), `tools/cegarcheck.py`.

## Phases

| Phase | Work | Checkpoint is reached when |
| --- | --- | --- |
| G0a Dark theme | Everything under "Dark theme for the whole site": `css/theme.css`, `js/theme.js`, the toggle, `main.css` on tokens, the ACE dark theme, charts and trace, tests. | Tests pass; the screenshots of every tab in both themes have been looked at; light looks as before. |
| G0 Infrastructure | Everything under "Infrastructure": the group, `tools/guide.mjs` with one placeholder example, `tools/guide-numbers.mjs`, app additions, `guide.css`, `guide.js`, `chapters.js`, the index page and one skeleton chapter page showing every building block, all tests. | `cd test && npm test` passes including the new tests; the skeleton page looks right in light and dark at desktop and phone width (screenshots via the browser tests); the deep links work in the served page. |
| G1 Pages 1–4 | Design and freeze the small graph; examples and pages 01–04. | Tests pass; all four pages read through once from the reader's side, clicking every link in a served page (`python3 test/serve.py 8811`). |
| G2 Pages 5–8 | Examples and pages 05–08. | As G1. |
| G3 Pages 9–11 | Examples and pages 09–11. | As G1. |
| G4 Page 12 and finish | Page 12, final index, cross-links (tutorial, manual, README, `llms.txt`, library panel), `node tools/make-chat-package.mjs` still works, one read-through of the whole guide for terms used before they are introduced, consistent numbers and dead ends. | Full test suite including browser tests passes; `PROGRESS.md` and `CLAUDE.md` ("Where things are") mention the guide; `examples/` regenerated and committed. |

Within a phase, per page: examples → `node tools/make-examples.mjs` → status
test → `node tools/guide-numbers.mjs` → write the page → tests.

## Verification (end to end)

```
node tools/make-examples.mjs                 # examples/*.json and library.json include the guide group
node tools/guide-numbers.mjs --check         # numbers.json is reproducible
cd test && npm test                          # library, guide and browser tests
python3 test/serve.py 8811                   # then open http://localhost:8811/guide/
```

By hand in the served site: follow the guide from the index to page 12; on
each page open every playground link, confirm it lands on the named fragment,
run it, compare the Output tab's numbers with the page, and return with the
back link. Check one page with the system set to dark, one at phone width,
and one with JavaScript disabled.

## Out of scope

Run-on-arrival links, share links, embedding the playground in the guide,
2QBF chapters, a page on solver options, translations, a search box, further
themes beyond light and dark, and any change to the runtime or the loop
language.
