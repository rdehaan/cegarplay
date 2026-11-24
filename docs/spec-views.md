# Views specification

Design: `docs/directions/observatory.md`, phase V3. A view is an ASP fragment that turns one
recorded step into marks; the Observatory draws them as SVG.

## 1. Project key

`views[]` (format v2): `{ name, fragments, positions }`. `fragments` names project fragments (one of
them, by convention `view`, holds the view's rules); `positions` maps an element term to `[x, y]`
in the 0..1000 square (written by dragging a node). `load` checks the names and the fragments.

Editing (`js/view-panel.js`, since 2026-11-24): a **view fragment** is one that a view names and the
loop script (and the variants) do not mention (`Editors.isViewFragment`). Its editor is built in
the Observatory's domain view (`#view-fragments`, under *Edit this view*), not in the Programs tab,
which shows a note with a button to it; `?fragment=<view fragment>` opens it there. The panel
shows the editors of the selected view, checkboxes for the program fragments it reads (`fragments`
minus its own, in project order), and New view / Rename / Delete (a rename renames its own fragment
of the same name; a delete removes its own fragments no other view names). An edit redraws the view
after 400 ms. The project format is unchanged.

## 2. Programs

- The **scene**: the instance's facts (when the last run used an instance), the named fragments,
  with `#program scene.` read as `#program base.`. Parts `#program frame.` are not grounded.
- A **frame**: the same with both `scene` and `frame` read as `base`, plus the step facts.
- Both run as plain clingo (`--outf=2 -V0 -n1`, the project's constants): no Lua `main`, so an
  error in a view is a clingo message (status 65), never a trap. Only `draw/1` atoms are marks.

Step facts (`frameFacts(step, iface)`):

| Fact | From a `T` event | From an `R` event |
| --- | --- | --- |
| `step(I)` | `i` | `i` |
| `kind(K)` | `kind` (`reject`, `solution`, ...) | `k` as `reject`, `add`, `expand`, `solution`, `error` |
| `cand(A)` | each atom of `candidate` | each interface atom set in `c` |
| `cex(A)` | each atom of `counterexample` | – |
| `lit(A, true\|false)` | each literal (`-a` = false) | each signed index of `q` |
| `fact(F)` | `facts` | `f` |

`cand/1` holds the candidate's interface atoms that are not facts (in both sources): an interface
atom that is a fact is the same in every step, so a view draws it in the scene, from the instance.
Without `R` events the steps are the `T` events (`traceSteps` in `js/recording.js`). Solutions are
not steps: the trace has no step for an accepted candidate, and stops after `settings.trace` steps,
so a solution found later has no step number. (Until 2026-11-24 the solutions after the last traced
step were appended as steps numbered on from it, which read as "found at step 201" in a run of
thousands of steps.) `solutionSteps(rec)` lists the run's solutions (at most 1,000) apart, each
with `cand(A)` for each of its shown atoms (which may include facts) and what is known of when it
was found: `at.step` (the `R` step, with a recording of every step), or `at.after` / `at.before`
(the traced steps around it; `before = null` after the last one). The domain view's **Show:
steps | solutions** switch picks between the two; a step label says when the trace was cut.

## 3. Marks

`draw(M)` with M one of:

| Mark | Meaning |
| --- | --- |
| `node(X)` | a node (circle), label X |
| `edge(X, Y)` | a line between `node(X)` and `node(Y)` |
| `cell(R, C)` | a grid cell at row R, column C (integers) |
| `item(X, I)` | a list item X at position I |
| `rank(L, I, X)` | in column L, position I holds X |
| `attr(E, K, V)` | attribute K of element E: `fill` / `stroke` (a class name: palette slot 1..8 in order of first use, tokens `--view-1..8`), `label` (text), `weight` (a number: stroke width) |
| `emph(E)` | a heavy ring |
| `ghost(E)` | drawn faint |
| `note(T)` | a line of text under the drawing |
| `layout(L)` | `grid`, `list`, `circle`, `layers` or `graph` |
| `pos(E, X, Y)` | a fixed position (integers, 0..1000) |

Anything else gives a message naming the mark and the view (`view v: unknown mark blob/1 in
blob(1)`). Elements are keyed by the text of their term; `attr`, `emph` and `ghost` name an element
by its term (`node(4)`, `edge(1,2)`, `cell(2,3)`).

Layouts (`layoutScene`, written by hand): `grid` (cells by row and column; nodes in a square),
`list`, `circle`, `layers` (breadth-first depth over the edges), `graph` (Fruchterman–Reingold,
300 rounds, a fixed seed: the same scene always gets the same positions). Without `layout`, cells
give a grid, edges a graph, items a list, else a circle. `pos` marks and stored positions win.

## 4. Rendering and frames

`js/view-panel.js`: the scene is drawn once (positions computed once per scene); a frame only sets
classes, labels and stroke widths of scene elements, with a CSS transition that
`prefers-reduced-motion` turns off. One dedicated `Engine` computes frames (`FrameSource`): one
call at a time, a request the cursor has left is dropped, the last 200 results are cached by a
hash of the program text (so a cached step makes no engine call). The steps are the `T` events of
the last run or replay, else its `R` events (with the interface atoms of the `I` event).

`suggestView(iface, facts)` writes a view from predicate signatures: a binary fact predicate over
the domain of a unary interface predicate gives a graph with `fill` from the candidate and `emph`
from the clause; an interface predicate with two integer arguments gives a grid; `p(X, V)` an
attribute of node X; otherwise one node per interface atom. "Suggest a view" in the Observatory
adds it as a fragment and a views entry, and opens its editor.

Library views (`tools/library.mjs VIEWS`): `guide-03-hit-clique`, `guide-03-relevant-all`,
`guide-04-one-node`, `tutorial-first-run`, `tutorial-weak-relevant`, `clique-colouring`,
`af-preferred`, `arrowing`, `choosability`, `qbf`. Reference row 29: 38 marks for step 3 of
`guide-03-hit-clique`, `emph` on nodes 4, 5 and 6 (`test/views.test.mjs`).

## 5. The candidate space (phase V4)

Inputs: the candidate vectors of the unrefined abstraction (one per interface assignment) and the
solution vectors, from the audit's `P` events (`vectors: true`), or candidates alone from the
assemble mode `enumerate` (`lua/space.lua`, `rt.enumerate{ link, limit }`: every model,
de-duplicated on the interface, P events of 1,024 hex vectors, `A` event `enumerated` or `limit`
above 1,048,576); and the `R` steps of a recording.

`js/space.js` (no DOM): `Space.fromHex(list, n)` packs the vectors into a `Uint32Array` (32 atoms a
word); a clause removes the candidates whose positive-literal bits are all 0 and negative-literal
bits all 1 (one mask and one compare per word). `fates(space, steps, { truth })`: per refinement
`{ ref, i, k, len, removed, fresh, already, lost, accepted }`, per candidate the R step that
removed it; a full-length clause on a candidate reported by a solution step is an acceptance, not
a removal. Also the alive series, the first unsound refinement, `blame`, `mapOrder` (`blame`:
candidates sorted by their bits in blame order and placed along a Z-order curve by rank, one cell
each; `size`: rows by the number of true atoms), `blameMatrix` (greedy seriation on the Jaccard
overlap of blame sets), `redundancy` (clauses that contain an earlier one), `sampleSpace` (random
sign vectors; labelled "sample, not uniform").

`js/space-view.js`: **Compute** audits the current project with vectors (the instance of the last
run) and uses the last run's recording (needs Recording "every step"); the map on a canvas,
coloured at the slider's refinement (alive, alive solution, removed earlier, removed now, lost
solution, accepted); hover shows the atoms, a click on a removed cell moves the slider to the
refinement that removed it; the alive curve with the first unsound refinement; the blame matrix.

Measured from `test/fixtures/recordings/` (copies of the stored replays): `tutorial-weak-relevant`
256 candidates, 61 solutions, 17 refinements, refinement 6 (R step 11) first unsound, 128
removed, 13 lost, alive 11; `tutorial-first-run` alive 61, 2,013 of 2,208 removals overlap;
`gc-shape1` 3,373 candidates, 1,320 refinements, alive 101, 4,636 of 7,908 overlap. The map of
gc-shape1 redraws in about 1 ms.

## 6. The linked cursor, comparison, export, lecture mode (phase V5)

`js/cursor.js`: `Cursor { ticks, index, range, follow }` with `subscribe`; `ticksOf(recording)` = the
`R` steps (else the `T` events) as `{ i, t, k }`; `setByStep(i)` moves to the last tick at or
before step i; `setRange(a, b)` with `timeRange()` and `stepRange()`; `bindKeys` (left/right one
step, Shift ten, Home/End; only on the Observatory tab or in lecture mode, not inside an input).
The cursor bar (`js/observatory.js`, region `#cursor-region`) shows the slider, "follow the run",
the range and the exports. Every view reads the cursor and keeps no step of its own: the domain
view shows the last view step at or before the cursor's step (its slider writes the cursor), the
map the number of refinements at or before it (its slider too), the call timeline draws the
cursor and the range, the line table counts the calls of the range, the alive curve marks both,
and the Output tab's trace moves to the same step.

`js/recording.js align(a, b, by)`: the steps of `a` paired with those of `b` of the same step
number (`by = "step"`) or the last step of `b` at or before the same elapsed time (`"time"`).
Comparison: "Compare with a recording" (map region; `app.space.compareWith(rec)`) needs the same
interface atoms; it computes the second run's fates on the same candidates, draws its alive curve
on the same axis, colours the map by which run removed a candidate by the cursor's step number
(this run, the other, both), and draws the second run's domain view beside the first (with the
export renderer).

Export (`views.js frameSVG`, `svgFile`; pure, no DOM, fixed light palette, coordinates rounded to
0.1): "Export view (SVG)", "Storyboard (SVG)" (the frames of chosen steps side by side, 1,100 units
apart), "Export candidate map (PNG)" (`canvas.toBlob`; this and "Export view (SVG)" are disabled,
with the reason in their tooltip, until there is a map or a view: `ObservatoryBar.syncExports`), "Data as table" (the frame's marks per element; the
fates per refinement). `test/fixtures/view-fixture.svg` is the export of the V3 fixture frame.

URL: `?replay=examples/replays/<id>.cprec&step=N&view=<name>` opens the recording on step N (the
last tick at or before it) and that view; `?lecture=1` shows the domain view alone, the notes as
large captions, the arrow keys moving the cursor. `tools/make-replays.mjs` also writes
`examples/views/<id>.json` (program hash -> marks of the scene and of the frames of the replay's
steps, at most 200) for the examples with a view; the page loads them with the example, so a
replay shows its picture before the engine has loaded (the frame engine starts only on a miss).
View programs now carry the project's constants as `#const` lines (the page did not pass them).
A `#const k = v.` in a fragment the view includes is rewritten to the project's value instead
(before, such a constant kept its default in the view: a 5 x 5 drawing of a 7 x 7 run).
