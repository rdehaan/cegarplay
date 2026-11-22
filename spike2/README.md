# CegarPlay prototypes

Scripts behind the two planning documents. Each was run against the CegarPlay repository at commit
e287c65 with its vendored engine (clingo 5.8.1 with Lua, WebAssembly) under Node 22 and Python 3.12.

Layout: put this folder next to a clone of the repository, so that `../../cegarplay` exists as seen
from each subfolder, and run every script from its own subfolder.

| Folder | File | What it does | Result when run |
| --- | --- | --- | --- |
| gen | `draws.lua` | The generator's draw functions: `@flip`, `@int`, `@weighted`, `@perm`, `@subset`, `@mallows`. Stateless and seeded, with the mixer of the earlier spike (spike2/probe3.lua). | |
| gen | `draws.py` | The Python twin of `draws.lua`. | |
| gen | `generate.py` | Runs a generator with the engine and retries rejected draws. | |
| gen | `test_draws.py` | Engine against twin. | Identical facts for 30 of 30 seeds of a connected G(n,p); 30 accepted of 80 attempts; all six functions identical; rule order irrelevant; reproduces reference row 26 of the Implementation tab |
| audit | `audit.py` | Audit: every candidate and counterexample of an instance against the solution set. | 31 library examples audited: 30 sound, `tutorial-weak-relevant` unsound; `guide-04-one-node` unsound |
| audit | `fate.py` | What each recorded refinement removes from the candidate space. | `tutorial-weak-relevant`: first unsound step is 6 |
| audit | `fuzz_shrink.py` | Generate, compare with the reference run, shrink by delta debugging, diagnose. | 8 facts shrunk to 6 (one triangle) in 31 engine runs, 14 s |
| lift | `lift.lua`, `lift.py` | Lifting: refinements from the check's ground program, certified by a well-founded model, without relevant/1. | 27 examples: every count equals the audit |
| lift | `lift_cone.lua` | The coarser certificate tried first. | Sound, but certifies the hand-written sets of only 8 of 23 examples |
| deep | `deep.lua`, `deep.py`, `deep2.py` | The recursive loop for any number of quantifier blocks, raw Lua on the runtime. | 180 formulas at depths 2 to 5, no mismatch with brute force |
| view | `view_test.py` | A view fragment on a recorded step; size of a recording. | 38 marks for a step of `guide-03-hit-clique` |
| three-level | `utik.py`, `fuzz2.py`, `qbf3.py` | The two three-level loops against brute force. | 540 and 80 runs, no mismatch |
| three-level | `probes.py`, `probe_block.py`, `spikes.py`, `spikes2.py` | Language limits, the blocking defect, engine prerequisites. | As quoted in the second document |

## Names used in docs/directions/ (added in this repository)

The planning documents cite spike files that were not delivered. Use these instead:

| Cited | Use |
| --- | --- |
| `spike2/probe3.lua`, `probe3b.lua` (mixer, draws) | `gen/draws.lua` (mixer unchanged), `gen/draws.py` |
| `spike2/audit-loop.lua`, `sweep.mjs` | `audit/audit.py` |
| `spike2/lift.lua`, `lift-loop.lua` | `lift/lift.lua`, `lift/lift.py` |
| `spike2/product-loop.lua` | not delivered; build level 3 from soundness.md, "The level-3 query" |

Paths inside these scripts assume `../../cegarplay`; they are reference code, not run by tests.
