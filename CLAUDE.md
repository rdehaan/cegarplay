# CegarPlay

A static, build-free browser playground for CEGAR loops written in answer set
programming, solved with clingo compiled to WebAssembly.

## Where things are

- Both implementation plans (PLAN.md, PLAN2.md) are done and were removed; they are in
  the git history. `docs/directions/*.md` holds the design behind PLAN2's features.
- `PROGRESS.md`: what is done and what is next. **Read it first after any
  context clear. Update it at every checkpoint.**
- `docs/spec-*.md`: specifications. Read only the ones the current phase names.
- `docs/reference-numbers.md`: numbers the implementation must reproduce.
- `spike/`: verified prototype code. Read-only; copy from it.
- `spike2/`: prototypes behind `docs/directions/` (audit, lift, draws, views, deep loops). Read-only.
- `reference/`: clones of logic-game and declarative-cegar. Read-only, git-ignored.
- `guide/`: the design guide (static pages, `chapters.js`, `numbers.json`).
  Its examples are built by `tools/guide.mjs`; `tools/guide-numbers.mjs`
  measures them (`--check` after any change to an example or a page).

## Rules that are easy to forget

1. An error raised by clingo inside a Lua call kills the WASM instance, even
   inside `pcall`, with no message. Validate ASP text before a run; wrap every
   callback body in its own `xpcall`; never let a Lua error cross a clingo
   frame; check preconditions in Lua before calling clingo.
2. Propagator tables need `init` and all hooks at registration time.
3. After `control:add_clause` returns false, return from `check`.
4. Never read `ctl.statistics` of a control that is solving.
5. Read models from a solve handle only with `h:iter()`.
6. Clause forms: `control:add_clause{ lits }` in `check`; `init:add_clause(lits)` in `init`.
7. No build step, no framework, no request to another origin.
8. `js/compiler.js`, `js/driver.js`, `js/project.js` must not use the DOM or Node APIs.
9. Trust tests over the plan; record deviations in `PROGRESS.md`. Do not change
   reference numbers without finding the cause.

## Commands

```
cd spike && npm install && npm test          # sanity check of the environment (9 checks)
cd test && npm install && npm test           # the project's tests (node --test)
node tools/vendor.mjs                        # copy the engine into vendor/
node tools/make-examples.mjs                 # rebuild examples/*.json (+ examples/contrib/*.json)
node tools/make-replays.mjs                  # rebuild examples/replays/*.cprec (after a runtime or example change)
node tools/audit.mjs <id> [--json]           # audit a project (exit 0 sound, 1 unsound)
node tools/make-chat-package.mjs             # dist/chat-package/: docs for writing examples in web chat
node tools/guide-numbers.mjs [--check]       # measure the guide's examples into guide/numbers.json
python3 tools/cegarcheck.py <project.json>   # check a project with Python clingo
python3 test/serve.py 8811                   # serve the site; add "coi" for isolation headers
```

## Working style

- One phase at a time. Commit at each checkpoint: `Phase N: <title>`.
- Keep output short: pipe long test output through `tail`; never print
  `js/ace.js`, `vendor/clingo-wasm/*.js` or the `.wasm` files.
