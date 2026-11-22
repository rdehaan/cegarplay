// Run a clingo program with the vendored engine: node engine.mjs file.lp [clingo options...]
import fs from 'node:fs';
import factory from '../../cegarplay/vendor/clingo-wasm/clingo.js';
const [file, ...opts] = process.argv.slice(2);
const out = [], err = [];
const m = await factory({ print: (l) => out.push(l), printErr: (l) => err.push(l) });
let status;
try { status = m.ccall('run', 'number', ['string', 'string'], [fs.readFileSync(file, 'utf8'), opts.join(' ')]); }
catch (e) { status = 'trap'; err.push(String(e)); }
console.log(out.join('\n'));
if (err.length) console.error(err.join('\n'));
