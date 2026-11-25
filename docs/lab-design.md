# Refinery: design note

The Refinery (tab 12) shows what a CEGAR loop *could* have done at a step and over a whole run,
from an enumerated candidate space. This note is for the reviewer: what the lab imports, what it
adds, and how its data looks. Milestone entries are at the end.

## Corrections to the task prompt (checked against the code)

- The audit's enumeration (`lua/audit.lua`) reduces counterexamples to a verdict and emits only
  the candidate and solution vectors (`P` events). It never emits the relevant sets per candidate.
  The lab needs them, so it has its own Lua entry point `rt.lab_space` in a new file
  `lua/lab.lua`. It enumerates the same way: every model of `A` deduplicated on the link's
  interface, every model of `C` under each candidate, one option per distinct relevant set or
  clause group, and `opt_mode = ignore` as the audit sets it.
- The Candidate space (`js/space-view.js`) indexes candidates by their hex vector
  (`Space.fromHex` in `js/space.js`, `index` keyed by the hex without leading zeros), and indexes
  interface atoms 1..n in the order of `rt.link`, which is also the order of the `I` event's
  `links[].atoms`. Every hex writer (`rt.hexvec`, `AUDIT.hex`, `space.lua`) puts atom 1 in the
  lowest bit of the last digit. The lab uses `Space.fromHex` as is, so a recorded step's `c`
  (hex) and `q` (signed 1-based atom indices) land on the same candidate and atoms.
- "Reset everything" already removes every `localStorage` key that starts with `cegarplay`
  (`app.factoryReset` in `js/init.js`), so it also removes the Refinery's keys (`cegarplay.lab` and
  `cegarplay.lab.*`). No change to that control is needed.
- `G.block` appears in nearly every Shape 2 loop, because Shape 2 blocks *accepted solutions*
  with it (gc-shape2). So "the loop uses `G.block`" does not mean bad candidates are blocked. The
  loop scheme is therefore: the relevant sets when the loop uses `G.clause`, plus the clause
  groups when it uses `G.clauses`, and the block (S = I) only when it uses neither (gc-reference).
- clingo-wasm ignores `--time-limit` (a run with it never stops). Budgets are enforced inside the
  lab's Lua programs: a propagator whose `check` hook (fixpoint mode) compares `os.clock()` with
  the deadline and then makes the search unsatisfiable, as `kill_search` in `lua/runtime.lua`
  does. A flag tells a budget stop apart from a proof.

## Existing code imported read-only

| Module | Functions |
| --- | --- |
| `js/project.js` | `load`, `derive`, `pickedVariant`, `selectedInstance` |
| `js/instances.js` | `resolveProject` (instances made by generators) |
| `js/driver.js` | `validate`, `auditPlan`, `declarationLines`, `assemble`, `parseEvent`, `luaLongString` |
| `js/space.js` | `Space` (`fromHex`, `index`, `words`, `bit`), `removedBy` |
| `js/recording.js` | `Recording` (`fromText`, `fromBlob`), `hexBits`, `pairSteps` |
| `js/output.js` (tab only) | `fmt` (number format) |
| `lua/runtime.lua` | `rt.solver`, `rt.link`, `rt.prepare`, `Solver:models`, `Solver:solve`, `Link:of`, `rt.emit`, `rt.hexvec`, `rt.finish`, `rt.array` |
| `lua/ground.lua` | `LIFT.level2` (certificate level 2), `LIFT.lift` (one lifted clause), the captured ground program (`L.to.store`) |
| `js/init.js` (tab only) | `app.collect()`, `app.project`, `app.recording`, the run bar's instance and variant selects (read only) |

`tools/lab.mjs` also imports `loadTarget` from `tools/audit.mjs`.

## Exports added

None. Everything the lab needs is already exported.

## Logic copied (duplication)

- The plan checks of `auditPlan` and `boundedPlan` in `js/driver.js` are reused by calling
  `auditPlan`. The extra unsupported cases (cores, expand, lift for the bounds, `on partial`,
  families, several outgoing links, no link at all, raw Lua) are checked again in `js/lab/space.js` (`labPlan`).
  Their wording follows `boundedPlan`.
- Loading clingo-wasm in a worker (`load` in `js/worker.js`) is repeated in `js/lab/worker.js`
  (about ten lines). The lab worker has no control word and no stdin.
- Candidate enumeration in `lua/lab.lua` repeats `candidates()` and `clause_groups()` from
  `lua/audit.lua` (about forty lines), because those are local functions of that file. Exporting
  them would change `lua/audit.lua`, which every audit runs.
- A 32-bit FNV hash of the project text for the space's cache key (`js/lab/space.js`). It is
  like `hashText` in `js/stats.js`, which imports DOM code.

## New files

| File | Role |
| --- | --- |
| `lua/lab.lua` | `rt.lab_space` (enumeration kept as data), `rt.lab_detail` (counterexamples of one candidate, justification, lifted clause). Loaded only by the lab. |
| `js/lab/space.js` | `labPlan`, the Lua bodies, parsing `Y` lines into a `LabSpace`, per-atom bitsets. |
| `js/lab/sets.js` | Removal sets, soundness, forced atoms with witnesses, D(M), the one-atom neighbourhood, brute-force minimal sets (tests and tiny spaces). |
| `js/lab/minimal.js` | The clingo program for minimal sound sets (subset-minimal by `domRec`, one cardinality-minimal set), many candidates in one run. |
| `js/lab/bounds.js` | The ASP program for exact best and worst runs, its budgeted Lua driver, the packing and matching bounds. |
| `js/lab/simulate.js` | Idealised runs: random order, two option policies, greedy best and worst. |
| `js/lab/runs.js` | A recording read onto the space: steps, alive sets by replay, regret, percentile. |
| `js/lab/report.js` | Feature C composed: `runReport`, `ladder`, `decomposition`. |
| `js/lab/core.js` | The computations end to end, given an `exec(program, options, onLine)` function. Shared by the worker and `tools/lab.mjs`, so the tab and the tool give the same numbers. |
| `js/lab/worker.js` | The Refinery's Web Worker: its own clingo-wasm instance, its own space cache, `core.js` behind messages. |
| `js/lab/tab.js` | The tab's UI. Talks only to the lab worker. Loaded lazily when the tab is first shown. |
| `css/lab.css` | The tab's styles, with theme tokens from `css/theme.css`. |
| `tools/lab.mjs` | The headless tool. |
| `test/lab-*.test.mjs`, `test/browser/lab.test.mjs` | Tests. |

All modules except `tab.js` use neither the DOM nor Node APIs.

## Touch points in existing files

- `index.html`: radio `tab12`, its label, `section-lab`, the checkbox `.lab-checkbox` in the
  Control tab's **Tabs** block (no id, so the Control tab's ids stay the same), and the
  stylesheet `css/lab.css`.
- `js/init.js`: `TAB_PREFS.lab` (`cegarplay.lab`, off by default, tab `tab12`); `?lab=1` and
  `?tab=12` show it for the visit; the `?tab=` pattern accepts 12; `lab` is kept in the address
  bar; on the first show of tab 12, `import('./lab/tab.js')`. Without the toggle, no lab code is
  loaded and no lab worker is started.
- `manual.md`: a new section "Refinery tab", plus a row in the tab list, the URL table and
  the storage list.

## Data structures

```
LabSpace {
  key: string               project hash | instance | variant | link
  link, atoms[n], n, W      W = 32-bit words per candidate vector (Space)
  count, hex[count], index  Space.fromHex (same indices as the Candidate space)
  words: Uint32Array        candidate vectors, W words each
  sol: Uint8Array[count]    1 = solution (no counterexample)
  ncex: Int32Array[count]   counterexamples per candidate
  optStart: Int32Array[count+1]   options of candidate i: optStart[i] .. optStart[i+1]-1 (CSR)
  optR, optV: Uint32Array[nopt*W] the option's atom set S and the values it fixes (M's values
                            for a relevant set; the group's values for a clause/3 group)
  optN: Int32Array[nopt]    counterexamples giving this option; option 0 of a candidate comes
                            from its first counterexample in clingo's order
  optKind: Uint8Array       0 relevant set, 1 clause group, 2 block (a loop refined only by blocks)
  CW, bitsT: Uint32Array[n*CW]   bitsT[j]: the candidates with atom j true (CW = count/32 words)
  solBits, badBits: Uint32Array[CW]
  plan: { link, schemes: { loop, omniscient, block } supported or a reason, unsupported? }
}
```

A set is a word mask over atoms plus a value mask. R(M, S, v) is the AND over S of `bitsT[j]` or
its complement. Pruning is the popcount of that AND the alive bitset. D(M, s) is
`words[M] XOR words[s]`. Minimal sound sets are the minimal hitting sets of the inclusion-minimal
members of D(M).

**Exact bounds program** (`js/lab/bounds.js`; the predicates are one letter long to keep the text
small): facts `b(C)` (bad candidate), `o(O,C)` (option O of C) and `r(O,D)` (O removes bad
candidate D, D not its owner). The choice is `{ s(O) : o(O,C) } 1 :- b(C)`, with `p(C)` for a
chosen candidate and `c(D)` for a removed one. The constraint `:- b(D), not p(D), not c(D).` says
every bad candidate is picked or removed. The order uses clingo's acyclicity directive:
`#edge (C,D) : s(O), o(O,C), r(O,D), p(D).` (D must come before C). The goal is `#minimize` or
`#maximize { 1,C : p(C) }`. I chose `#edge` over integer
positions. It grounds one edge per `rem` fact, linear in the incidence, where positions ground
O(k·|Bad|) atoms and as many ordering constraints per edge. clasp checks acyclicity natively.
Best and worst differ only in the direction of the optimisation: "cover" and "maximal" are the
same condition, because a picked candidate is removed by its own clause.

## Definitions as implemented, and deviations

- Idealised runs propose only alive candidates. A solution is accepted and leaves the alive set
  at no cost. A bad candidate costs one refinement. For an unsound scheme the exact bounds report
  the solutions *at risk* (removed by a chosen clause): an idealised run can accept those
  solutions before the clause, so for exact bounds "lost" ranges from 0 to "at risk". The
  simulation counts lost solutions as they happen.
- A `clause/3` group (`G.clauses`) that does not remove its own candidate makes no progress. It
  is shown in the option map but left out of the bounds and the simulation.
- "Justified by X": X is a counterexample of every M' in R(M, S). It is checked first with
  certificate level 2 on S's values (one evaluation that covers all of R(M, S)). If that does not
  certify, it is checked per M' with one solve of the check under M', with X's choices fixed (the
  heads of choice rules in the check's ground program, as true or false in X), up to a cap.
  Only the first N counterexamples of M (the Limits group) are tried. The result says how many M
  has.
- Percentile of a run: 100·(#simulated runs shorter + ½·#equal)/#runs.
- A run's length counts its refinements of bad candidates (`R` steps of kind `r` or `a` whose
  candidate has a counterexample). A clause on a solution is the block of an accepted solution, and
  a step of kind `s` accepts its candidate. Both remove candidates from the alive set at no cost.
- Greedy runs propose only bad candidates, so for an unsound scheme every solution their clauses
  remove counts as lost.
- The omniscient scheme needs the minimal sound sets of every bad candidate. They are computed in
  one clingo run for up to 20,000 bad candidates (`OMNISCIENT_MAX` in `core.js`); above that the
  scheme is reported as not computed. When a candidate's minimal sets are capped, the omniscient
  bounds are marked as not exact (the best is then an upper bound on the true best).
- Bounds without clingo (`cheapBounds`, added at consolidation): best ≥ max(⌈|Bad| / largest
  removal⌉, a greedy packing: bad candidates no single option removes two of), and worst ≤ |Bad| −
  a greedy matching of pairs whose every option removes the other. The Lua driver stops as soon as
  a model reaches the bound (proven, `by: 'bound'`). On the tutorial examples the packing bound
  proves the best (14, 4) at once. clingo's core-guided strategy (`--opt-strategy=usc`) was tried
  and proved less than the default `bb`. clingo's own lower bound is not used: `bb` has none, and
  after a budget stop clasp's statistics would describe the cut search.
- Refinement strength is clamped at 0 for a sound loop scheme. Choosing, for every sound option, a
  minimal sound subset removes at least as much, so the omniscient best is never longer. Without
  the clamp, two unproven intervals gave "−10 to 10".
- A run longer than every idealised run found (worst found, greedy worst, simulation maximum)
  while the worst is not proven is reported as "not certainly outside", with the count of
  refinements of already removed candidates.
- Unsupported (exit code 4), beyond the prompt's list: refinements other than `G.clause`,
  `G.clauses` and `G.block` (`above`, `below`, hand-made clauses: marco, maxsat-oll), because
  their options are not a function of the counterexample's relevant set.
- The index and size limits: the incidence (option × removed candidate) is built when
  options × words × |S| stays under 4·10⁸ work units. Above that, the greedy policies and the exact
  program are skipped with a reason. The random simulation scans only the alive list and runs at
  any size up to the candidate cap, within its time budget: at 200,000 candidates one run takes about
  0.2 s, so the default 1,000 runs stop at the 30 s budget, and the result says how many were run.

## Milestones

### 0. Design note

Built: this note. No product code.

### 1. Space and headless core

Built: `lua/lab.lua` (`rt.lab_space`, `rt.lab_detail`), `js/lab/space.js`, `sets.js`,
`minimal.js`, `core.js`, and `tools/lab.mjs` for the space, removal sets, soundness, forced
atoms, minimal sound sets and justification. Tests: `test/lab-sets.test.mjs` (brute force over
every subset on synthetic spaces and the two 8-atom tutorial examples) and
`test/lab-library-[1-3].test.mjs`. On every `fast` library example the lab supports, the Refinery's
candidates, solutions, options (= the audit's pairs), soundness, unsound pairs and solutions at
risk equal the audit's. The lab declines the others with a reason: expand, cores, `above`/`below`,
several links, instances with `audit: false`, raw Lua.
Deviation: block-only loops (gc-reference) are supported, although `auditPlan` declines them;
`labPlan` chooses the link the same way.
Observed, not changed: `tools/audit.mjs` on an instance marked `audit: false` only prints a note
and goes on enumerating (lang-second-solver's n5 runs past 120 s). That matches its
documentation; the library test does not audit what the lab declines.

### 2. Tab shell and step inspector

Built: tab 12 with its toggle, `?lab=1`, `?tab=12`, the lab worker (`js/lab/worker.js`), free
and from-a-run modes, the counterexample table, the atom table, the option map with its Pareto
frontier, the lattice, the verdict line, CSV/SVG/JSON exports, and `css/lab.css`. A browser test
(`test/browser/lab.test.mjs`) checks that the default page is unchanged: the same visible tabs,
the same Control-tab ids, no lab module requested. It also checks that a Run finishes while the
lab computes and that Cancel stops only the Refinery.
Deviation: after Cancel the lab worker is gone, and its space with it. The next request computes
the space again with the same parameters, without asking; the results already on screen stay.
Later version: drawing M, the counterexample and a clause with the project's domain view would
need the Observatory's view code to accept a candidate from outside the cursor. Left out.

### 3. Run bounds

Built: `js/lab/bounds.js` (program, budgeted Lua driver, ordering of the selection into a run),
`js/lab/simulate.js` (random order with two option policies, greedy best and worst), and the
histogram. Tests (`test/lab-bounds.test.mjs`): the exact program equals a brute-force enumeration
of every idealised run on 7 synthetic spaces × 3 schemes, and every simulated and greedy length
lies within those bounds. Block best = worst = |Bad| on gc-shape2 n3 and n4. Omniscient best ≤
loop best. The budget stop is checked, and so is the unsound case.
Note: on spaces of a few hundred bad candidates, clingo often finds the best and worst runs but
cannot prove them within 30 s. The tab then shows intervals. Since consolidation, the packing bound
proves tutorial-first-run's best (14); its worst (≥ 16, ≤ 162) and gc-shape2 n4's best (≤ 64, ≥ 6)
stay open.

### 4. Run against bounds

Built: `js/lab/runs.js`, `js/lab/report.js`, the ladder, the decomposition, the regret chart, the
five largest regrets (they open the step in the inspector), and **Compare with a recording**.
Tests (`test/lab-runs.test.mjs`): recorded gc-shape2 and gc-reference runs on n3 and n4 map step
by step (no problem, every clause an option, every refined candidate alive, nothing lost) and lie
within the loop-scheme bounds. gc-reference makes exactly |Bad| refinements. |Sol| equals the
runs' solution count. gc-shape1 is only reported. For tutorial-weak-relevant, the witness, the
unsound pair count and the solutions at risk equal the audit's, and the stored recording loses
solutions.
Observed: gc-shape2 n4's recorded run (77 refinements) is shorter than every one of 200 random
idealised runs (85 to 113). clingo's candidate order is far better than a random one.

### 5. Documentation and polish

Built: the manual section "Refinery tab", plus the tab list, `?tab=12`, `?lab=1` and the
storage keys in the manual. Also: polite live regions for the status, the verdict and the
ladder's sentence; keyboard access (every control is a button, select or range; the option map
has a **Set** list as its keyboard alternative); theme tokens for light and dark; no sideways
scroll from 1400 px down to 400 px (checked in the browser test).
Observed, not changed: `test/browser/directions.test.mjs` "Run all, Fuzz and the audit of many
instances..." failed once in a loaded full run and passed in 3 reruns and in the other full run. It
waits for the short-lived run-bar text "running audit (1 of N: ...)", which a busy machine can skip
past. That page never loads the lab.

### Consolidation (2026-11-25)

The tutorial (lesson 6, "What the loop could have done: the Refinery", `#tut-lab`) and the
guide now mention the lab. In the guide: chapter 4's tool moment and tool list, chapter 3's tool
list, chapter 5's note on enumeration (`#lab`), the unsound how-to (a step "Understand it"), the
glossary (forced atom, idealised run) and the reading order. The guide's numbers stay
`data-stat` spans, so the Refinery's figures appear in the tutorial and the manual only. Code: the
packing and matching bounds, the early stop at a bound, the clamped refinement strength, and the
"not certainly outside" reason. Docs now name the program's facts as the code writes them (`o/2`,
`r/2`).

### Review and large-space check (2026-11-25)

An independent code review of the branch found seven bugs and three nits. All were fixed except
the commit names, which were changed afterwards (below); browser and headless regression tests
cover the fixes.
- The omniscient bounds of **Run bounds** (`{ bounds, sim }`) and those the run computes shared one
  slot: the scheme select threw, or the ladder said "not computed". The run's are now
  `results.omniBounds`, and it reuses those of Run bounds when there are any.
- A recording with steps but no refinement on this space (another instance, a run that only
  accepted solutions) crashed the inspector. It now falls back to free mode and says why.
- A request while the lab was busy turned the busy state off, so Cancel was disabled while the
  first computation ran on. The request is now refused with a message; tab switches and source
  changes do not start one while busy.
- `tools/lab.mjs` crashed when the bounds or the simulation were skipped. It now prints the
  reason.
- "(as written)" in the Refinery's variant picker fell back to the run bar's variant. `''` now means
  no variant (`undefined` still means the run bar's).
- A set over the member cap that certificate level 2 justified was shown as "unchecked". It now
  stays justified.
- The space's cache key and the stale-project check left out `generators`, `pools` and
  `settings.pools` (`projectText` in `space.js` now includes them).
- Nits: forced atoms named their witness by a candidate index ("solution 72"). They now name the
  solution's atoms. The bounds propagator's `init` and `check` now run inside `xpcall` (CLAUDE.md
  rule 1).
- Commit names: the checkpoint commits were first named `Lab M0` to `Lab M5`. They are now
  `Phase R0` to `Phase R8` (milestones 0 to 5, then the note, the consolidation and these
  fixes), following CLAUDE.md and the letter of earlier strands (`Phase L4`, `Phase S8`).

Large space, in the browser and headless: gc-shape2 at n = 6 (an instance added to a copy of the
project): 102,508 candidates, 10,698 solutions, 606,030 options, 54 interface atoms.
- Space: 51 s in the browser (46 s headless, almost all of it the enumeration), with steady
  progress. The page's main thread never paused more than 19 ms while it ran.
- The loop-scheme soundness check took 33 s and reported no progress. It now checks each option
  only against the solutions that agree with it on its rarest atom, and reports progress: 5 s, the
  same answers (the library agreement tests pass). The witness keeps the audit's order for ties.
- Inspector 0.5 s; counterexamples and justification 3.4 s; JSON export 17 MB in 1.7 s.
- The simulation is the limit: about 2 s per run, so 10 runs within the budget. The two policies
  now share one budget (two thirds and one third) instead of taking 30 s each. The greedy
  policies are skipped there (the removal-set index is over its limit), with that reason.
- One main-thread pause of about 0.5 s on the page, most likely the JSON export (built on the page).
- The full cap of 200,000 candidates was not run in the browser; by these figures it would take
  about twice as long and use about twice the memory.

## To do later (checks not yet done)

1. **Paths without a test:**
   - `G.clauses` loops (guide-06-clauses, lang-clauses): the inspector, the bounds, and groups that
     do not remove their own candidate.
   - A `lift` link: the loop scheme reported unsupported; the lifted clause in the inspector.
   - Justification's per-candidate fallback (when level 2 does not certify), its "not justified"
     verdict and its cap.
   - Generated instances in the Refinery bar, and the **Link** field.
2. **Browsers and isolation:** the Refinery's browser tests have run only in Chromium on pages without
   cross-origin isolation (`?nocoi=1`). To do: `BROWSER=firefox` (needs Playwright's Firefox), and
   an isolated page (`coi`), where the module worker loads under COEP.
3. **Accessibility:** `test/browser/a11y.test.mjs` does not visit tab 12 (keyboard path, live
   regions, contrast in both themes). The amber "edited since" line has no test.
4. **Exact bounds near the threshold:** the largest exact program run had 195 bad candidates.
   Measure grounding time and memory near the default threshold of 3,000 in the browser, and
   lower the default if needed.
5. **Simulation speed at large sizes:** about 2 s per run at 100,000 candidates, so the
   distribution rests on a handful of runs. Possible fixes: a per-option cache of removal lists,
   or bitset removal on the alive set. Also the greedy policies above the index limit.
6. **The JSON export on the page's thread** (about 0.5 s at 100,000 candidates): build it in the
   worker.

