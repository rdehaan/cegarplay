# PLAN2: three directions and loop-language generality

Second implementation plan, after PLAN.md, the guide and TODO.md were finished. The design
documents are in `docs/directions/` (copied from the owner's planning docs, 2026-11-22):

| File | Content | Phases |
| --- | --- | --- |
| `overview.md` | The three directions: Instance Lab, Observatory, Checked soundness | – |
| `implementation.md` | Shared groundwork, spike results, file list, reference rows 14–30 | all |
| `soundness.md` | S1–S5, with Read first / Tasks / Done when per phase | S1–S5 |
| `instance-lab.md` | I1–I5 | I1–I5 |
| `observatory.md` | V1–V5 | V1–V5 |
| `generality.md` | Coverage of 18 loop families, the blocking defect, additions G1–G8 | L0–L4 |

For each phase, read its section in the matching file: it has the tasks and the "Done when"
checks. This file only fixes the order and the decisions taken on top of those documents.
`spike2/` holds the prototypes (read-only). The `spike2/...` files that the documents cite by
spike name (probe3.lua, audit-loop.lua, lift-loop.lua, product-loop.lua, sweep.mjs) were not
delivered; use the prototypes instead (see `spike2/README.md`).

## Session rules (override CLAUDE.md's "stop at checkpoint")

- Do not stop at checkpoints and do not ask questions. Where a decision is open, pick the option the documents recommend (or the simplest that keeps old behaviour), and record it under "Deviations" in `PROGRESS.md`.
- Checkpoint = `cd test && npm test 2>&1 | tail` green (slow-only tests may be skipped), `node tools/guide-numbers.mjs --check`, `PROGRESS.md` updated, commit `Phase <code>: <title>` with the attribution line. Never push.
- If a "Done when" check cannot be met after a fair attempt (e.g. a timing budget, an unverified engine behaviour), record the measured value and the cause in `PROGRESS.md`, mark the test `skip` with a reason or relax it to a relation, and move on. Never change rows 1–13 / `guide/numbers.json`.
- After any context summary: read `PROGRESS.md` then `PLAN2.md`, continue at "Next step".
- CLAUDE.md hard rules apply everywhere: validate ASP before `ctl:add`; every new Lua callback (observer, draw function, `on_model`, propagator hooks) in its own `xpcall` (the docs say `pcall`; use `xpcall` per CLAUDE.md); no DOM/Node in logic modules; no build step, no framework, no other origin.
- Work sequentially in the main thread (lanes share `runtime.lua`, `index.html`, `init.js`, `stats.js`, `control.js`; parallel worktrees would conflict). Use an Agent only for an independent review at the end of each wave.

## Phase order (sequential; dependencies satisfied in this order)

| # | Phase | Main new files | Depends on |
|---|---|---|---|
| 1 | **S1 Audit** | `lua/audit.lua`, `tools/audit.mjs`, `test/audit.test.mjs`, `docs/spec-soundness.md` §1 | – |
| 2 | **I1 Instances** (format v2, variants, Instances tab = `tab9`) | `js/instances.js`, `js/instances-tab.js`, `docs/spec-instances.md` | – |
| 3 | **V1 Recording** (`I R C` events, policies, `.cprec`, `?replay=`) | `js/recording.js`, `tools/make-replays.mjs`, `docs/spec-recording.md` | – |
| 4 | **S2 Capture, level 2, level 3** (`K` events, `certify: report`) | `lua/ground.lua`, `test/ground.test.mjs`, spec §2–3 | S1 |
| 5 | **I2 Generators** (draws, `@@G`, preview) | `lua/draw.lua`, `lua/generate.lua`, `js/generate.js`, `tools/draw.py`, `test/draw-vectors.json` | I1 |
| 6 | **V2 Loop anatomy** (Observatory tab = `tab11`) | `js/anatomy.js` | V1 |
| 7 | **S3 `lift` links** | compiler keyword, `Link:lift`, `test/lift.test.mjs` | S2 |
| 8 | **I3 Campaigns** (Campaign tab = `tab10`) | `js/campaign.js`, `js/pool.js`, `js/store.js`, `js/campaign-tab.js`, `tools/bench.mjs` | I1, I2 |
| 9 | **V3 Domain views** | `js/views.js`, `docs/spec-views.md`, views for 10 examples | V1, I1 |
| 10 | **S4 Rule refinements + exact level** | `lua/ground.lua` (level3_rules, exact) | S2 |
| 11 | **I4 Fuzz and shrink** | `js/fuzz.js`, `js/shrink.js`, `lua/replay.lua`, `test/fuzz.test.mjs` | S1, V1, I3 pool |
| 12 | **V4 Candidate space** | `lua/space.lua`, `js/space.js`, `js/space-view.js`, `test/space.test.mjs` | S1, V1 |
| 13 | **S5 Certified counts** | `tools/certcheck.py`, proof log, `test/certcheck.test.mjs` | V1, S2–S4 |
| 14 | **I5 Mining, pools, importers** | `js/mine.js`, `rt.pool`, importers apx/tgf/preflib/jagg | I3 |
| 15 | **V5 Cursor, compare, export, lecture** | `js/cursor.js`, `js/export.js`, `test/cursor.test.mjs` | V2–V4 |
| 16 | **L1 Values** (G1 clauses as signed-atom sets, G2 lists/named atoms, G3 model reads) | compiler + runtime | L0 |
| 17 | **L2 Control** (G4 inner/assumed searches, G5 partial checks, G8 `optimal`) | compiler + runtime | L1 |
| 18 | **L3 Dynamics** (G6 ground_part/extend/guard/externals) | compiler + runtime | L1 |
| 19 | **L4 Structure** (G7 `def`/`return`, solver families) + 18-family coverage tests | compiler + runtime | L1–L3 |
| 20 | **Final review**: independent review agent over the whole diff, manual/llms.txt/tutorial cross-links, chat package rebuild, Firefox browser run, screenshots at 1400/700 px | – | all |

Language phases come last: the direction plans are written against today's runtime, and L1 changes the clause representation; keeping today's literal-array fast path (as the generality doc requires) lets `R`/`K` events and certificates keep working, and L1 then extends `R` for cross-solver clauses.

## Adjustments to the documents (decided now, record in PROGRESS)

- **Shared groundwork contracts** (implementation.md "Shared groundwork") are built by their owner phase exactly as specified: `applyVariant/applyInstance` (I1), `assemble` `opts.mode/opts.modules` (S1 builds the mode mechanism, since it now comes first), compact events (V1), pool (built minimally in I3 but I4 depends on it), ground capture (S2).
- **S1 before I1**: the audit takes `--instance` only once I1 exists; S1 audits the project as is, I1 then adds `--instance` to `tools/audit.mjs`.
- **Fate numbers (V4)** depend on search order; test them from stored recordings committed under `test/fixtures/recordings/` (as the doc says), produced once by V1's `--record`.
- **Row 27 (≤10% overhead)** and the V2 50 ms / V4 one-frame budgets are measured; if missed, record and relax to a logged measurement.
- **Tab ids**: Instances `tab9` (between Programs and Loop), Campaign `tab10`, Observatory `tab11`; `?tab=` accepts 9–11.
- **Format v2**: saved only when a new key (`instances`, `generators`, `variants`, `suites`, `views`, `pools`) is used; otherwise `version: 1` (answers open question 3).
- **Loop over instances**: not added (open question 2: the plan says no).
- **Slow checks** (row 19, fuzz on `graph-coloring-original` n = 3..6, 1,000-cell suite if > 60 s) go behind `SLOW=1`.
- **certcheck level 2**: Python twin of the well-founded evaluator written from `spike2/lift/lift.py`; shares no code with `lua/`.
- **Language keywords** `def return keep partial every minimal`: check no library script uses them as names before adding (doc says none does; the library test will confirm).

## Reuse (existing code to build on)

- `js/driver.js` `assemble`/`validate`/`parseEvent`; `lua/runtime.lua` `Solver:models`, `snapshot`, `Link:of`, `Link:clause`, `trace`, `literal_texts`, `timer_start/stop`, `emit_solution`, `tick`.
- `tools/run.mjs` (`runProject`, worker-thread time limit) as the pattern for `audit.mjs`, `bench.mjs`; `test/helpers.mjs` (`run`, `runLua`, `runProject`).
- `js/stats.js` `svg` helper and `hashText`; `js/share.js` `CompressionStream` pipe for `.cprec`.
- `tools/cegarcheck.py` (`join`, `Checker`) for `certcheck.py` and `--instance`.
- `tools/library.mjs` / `make-examples.mjs` / `loadContrib` for new instances, generators, views and examples.
- Prototypes in `spike2/`: `gen/draws.lua|py`, `audit/audit.py`, `audit/fate.py`, `audit/fuzz_shrink.py`, `lift/lift.lua`, `view/view_test.py`, `deep/deep.lua`, `three-level/*`.

## Verification

- Every checkpoint: full `npm test` (Node + Chromium), `guide-numbers.mjs --check`, golden-assembly test, rows 1–13 unchanged; each phase's "Done when" items become tests in its new test file (rows 14–30 as listed in implementation.md).
- Headless/page parity: each feature has a `tools/*.mjs` entry and a browser test that runs the same module.
- End of session: `npm run test:slow`, `BROWSER=firefox npm test`, serve with `python3 test/serve.py 8811` and click through the new tabs (Instances, Campaign, Observatory, Audit button, replay link) via the browser harness with screenshots; final summary of deviations and open items in `PROGRESS.md`.
