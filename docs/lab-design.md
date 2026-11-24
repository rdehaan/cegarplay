# Refinement lab: design note

The Refinement lab (tab 12) shows what a CEGAR loop *could* have done at a step and over a whole run,
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
  (`app.factoryReset` in `js/init.js`), so it also removes the lab's keys (`cegarplay.lab` and
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
  families, several outgoing links, raw Lua) are checked again in `js/lab/space.js` (`labPlan`).
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
| `js/lab/bounds.js` | The ASP program for exact best and worst runs, its budgeted Lua driver, trivial bounds. |
| `js/lab/simulate.js` | Idealised runs: random order, two option policies, greedy best and worst. |
| `js/lab/runs.js` | A recording read onto the space: steps, alive sets, regret, ladder, decomposition. |
| `js/lab/core.js` | The computations end to end, given an `exec(program, options, onLine)` function. Shared by the worker and `tools/lab.mjs`, so the tab and the tool give the same numbers. |
| `js/lab/worker.js` | The lab's Web Worker: its own clingo-wasm instance, its own space cache, `core.js` behind messages. |
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
- `manual.md`: a new section "Refinement lab tab", plus a row in the tab list, the URL table and
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
  optKind: Uint8Array       0 relevant set, 1 clause group
  CW, bitsT: Uint32Array[n*CW]   bitsT[j]: the candidates with atom j true (CW = count/32 words)
  solBits, badBits: Uint32Array[CW]
  plan: { link, schemes: { loop, omniscient, block } supported or a reason, unsupported? }
}
```

A set is a word mask over atoms plus a value mask. R(M, S, v) is the AND over S of `bitsT[j]` or
its complement. Pruning is the popcount of that AND the alive bitset. D(M, s) is
`words[M] XOR words[s]`. Minimal sound sets are the minimal hitting sets of the inclusion-minimal
members of D(M).

**Exact bounds program** (`js/lab/bounds.js`): facts `opt(O,C)` (option O of bad candidate C)
and `rem(O,D)` (O removes bad candidate D, D not its owner). The choice is
`{ sel(O) : opt(O,C) } 1 :- bad(C)`, with `pick(C)` for a chosen candidate. The constraint is
that every bad candidate is picked or removed by a selected option. The order uses clingo's
acyclicity directive: `#edge (C,D) : sel(O), opt(O,C), rem(O,D), pick(D).` (D must come before
C). The goal is `#minimize` or `#maximize { 1,C : pick(C) }`. I chose `#edge` over integer
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

## Milestones

### 0. Design note

Built: this note. No product code. Open question: none yet.
