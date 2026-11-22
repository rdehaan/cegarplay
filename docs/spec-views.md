# Views specification

Design: `docs/directions/observatory.md`, phase V3. A view is an ASP fragment that turns one
recorded step into marks; the Observatory draws them as SVG.

## 1. Project key

`views[]` (format v2): `{ name, fragments, positions }`. `fragments` names project fragments (one of
them, by convention `view`, holds the view's rules); `positions` maps an element term to `[x, y]`
in the 0..1000 square (written by dragging a node). `load` checks the names and the fragments.

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
adds it as a fragment and a views entry.

Library views (`tools/library.mjs VIEWS`): `guide-03-hit-clique`, `guide-03-relevant-all`,
`guide-04-one-node`, `tutorial-first-run`, `tutorial-weak-relevant`, `clique-colouring`,
`af-preferred`, `arrowing`, `choosability`, `qbf`. Reference row 29: 38 marks for step 3 of
`guide-03-hit-clique`, `emph` on nodes 4, 5 and 6 (`test/views.test.mjs`).
