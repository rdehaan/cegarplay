# CegarPlay spike

Throwaway code that backs the implementation plan. It shows that the stock
`clingo-wasm` build can run a whole CEGAR loop, with several clingo instances,
inside one `run()` call, driven by a Lua script.

Nothing here is production code. The runtime has no JSON events, no limits and
no guards yet; the plan says what the real one needs.

## Run it

    npm install            # fetches clingo-wasm 0.6.0 (clingo 5.8.1, Lua 5.4.6)
    npm test               # 9 checks, about 10 s
    npm run test:slow      # adds shapes 2 and 3, about 50 s more

Browser test (needs Python 3 with Playwright and a Chromium):

    npm run web:prepare
    cd web
    python3 serve.py 8811 &          # plain static hosting
    python3 serve.py 8812 coi &      # with the two cross-origin isolation headers
    python3 drive.py http://127.0.0.1:8812/index.html

## What is where

| File | What it shows |
| --- | --- |
| `js/port.mjs` | A line-by-line port of `cegar.py` to a Lua propagator. Same models, checks, refinements, choices and conflicts as native Python. |
| `lua/runtime.lua` | Prototype of the runtime library: solvers, links, snapshots, clause injection, `expand`, `search`, `restart`. |
| `js/shapes.mjs` | The four loop shapes as hand-written Lua, and the `#program refine(k).` part for graph colouring. |
| `js/assemble.mjs` | Splits a file written for `cegar.py` and assembles the single program for one run. |
| `test/run.mjs` | The reference numbers as assertions. |
| `test/brute.py` | Ground truth with native Python clingo: every candidate checked on its own (10,698 of 102,508 at n=6). |
| `web/worker.js` | Module worker: line streaming in batches, and the `stdin` poll for pause and soft stop. |
| `web/main.js` | Page side: run, abort and respawn, pause/resume/stop, threaded build. |

## Things that bite

- `control:add_clause{ lits }` takes a table that wraps the literal list. `init:add_clause(lits)` takes the list itself.
- A propagator table must have `init`, and clingo reads the hooks when the table is registered.
- After a conflicting clause in `check`, return. A second `add_clause` is an error.
- An error raised by clingo inside a Lua call traps the WASM instance, even inside `pcall`.
- `statistics.accu` exists only with `--stats`. Do not read statistics of a solver that is solving.
- Cores come from `handle:core()` on a solve with `yield = true`.
- The `stdin` function must return `null` after the newline.
- The low-level `dist/clingo.js` is not in the package's `exports` map. Import it by path, or vendor it.
