// Copies the engine files next to the page and writes the two programs the page runs.
import fs from 'node:fs';
import { splitParts, buildProgram } from '../js/port.mjs';
const here = new URL('.', import.meta.url);
const dist = new URL('../node_modules/clingo-wasm/dist/', import.meta.url);
fs.mkdirSync(new URL('./vendor/', here), { recursive: true });
for (const f of ['clingo.js', 'clingo.wasm', 'clingo-mt.js', 'clingo-mt.wasm']) fs.copyFileSync(new URL(f, dist), new URL('./vendor/' + f, here));
const src = fs.readFileSync(new URL('../examples/graph-coloring-n6.lp', import.meta.url), 'utf8');
fs.writeFileSync(new URL('./gc6_standalone.lp', here), buildProgram(splitParts(src), { glueWrapped: false }));
fs.writeFileSync(new URL('./gc7_standalone.lp', here), buildProgram(splitParts(src.replace('#const n=6.', '#const n=7.')), { glueWrapped: false }));
console.log('web/ is ready: start "python3 web/serve.py 8811" (plain) or "python3 web/serve.py 8812 coi" (isolated) from inside web/');
