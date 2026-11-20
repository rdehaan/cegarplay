# CegarPlay

A browser playground for CEGAR loops (counterexample-guided abstraction
refinement) written in answer set programming. clingo runs in your browser,
compiled to WebAssembly; nothing is installed and nothing leaves the page.

You write ASP fragments (an abstraction that proposes candidates, a check that
looks for counterexamples, a glue fragment naming the atoms they share) and a
short loop script that declares the solvers and how they call each other. Press
Run to see solutions, live statistics and a step-by-step trace.

CegarPlay is a browser version of the Python prototype
[declarative-cegar](https://github.com/rdehaan/declarative-cegar), laid out
like [logic-game](https://github.com/rdehaan/logic-game).

## Serving it locally

The site is static files with native ES modules and no build step. Serve the
repository root with any static server, for example

    python3 -m http.server 8000

and open <http://localhost:8000/>. (Opening `index.html` as a file does not
work: workers and modules need http.) URL parameters: `?file=nash` loads
`examples/nash.json`, `?tab=4` opens the fourth tab, `?internals=true` shows
the Internals tab.

## Tests

    cd test && npm install && npm test       # Node tests and Chromium browser tests
    npm run test:slow                        # adds the slow reference rows

The browser tests use Playwright (`npx playwright install chromium` once).
`test/serve.py <port> [coi]` serves the site, optionally with the two
cross-origin isolation headers.

## Engine and vendored files

The engine is the npm package `clingo-wasm@0.6.0` (clingo 5.8.1 with Lua
5.4.6). `node tools/vendor.mjs` copies its build into `vendor/clingo-wasm/`
(with sha256 sums in `VERSION`) and the fonts into `vendor/fonts/`.
`node tools/make-examples.mjs` rebuilds `examples/*.json` from the files of
declarative-cegar (cloned into `reference/`).

## Licences

- CegarPlay: MIT, see `LICENSE`.
- clingo-wasm: Apache-2.0 (Dominik Moritz). clingo: MIT (Potassco). Lua: MIT.
- From [logic-game](https://github.com/rdehaan/logic-game) (MIT, Copyright (c)
  2024 Ronald de Haan): the page layout and `css/main.css`, `js/ace.js` (ACE,
  BSD), `js/mode-gringo.js` (taken in modified form from potassco.github.io,
  MIT) and `js/modal.js`.
- Examples: built from [declarative-cegar](https://github.com/rdehaan/declarative-cegar) (MIT).
- Open Sans: SIL Open Font License 1.1. Font Awesome Free: fonts SIL OFL 1.1,
  icons CC BY 4.0. Licence texts in `vendor/fonts/`.
