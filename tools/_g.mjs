import fs from 'node:fs';
import { generate } from '../js/generate.js';
import factory from '../vendor/clingo-wasm/clingo.js';
const lua = (n) => fs.readFileSync(`lua/${n}`, 'utf8');
async function engineRun(program, options) { const out = [], err = []; const m = await factory({ print: (l) => out.push(l), printErr: (l) => err.push(l) });
  let status; try { status = m.ccall('run', 'number', ['string', 'string'], [program, options]); } catch (e) { status = 'trap'; } return { status, out, err }; }
const p = JSON.parse(fs.readFileSync(`examples/${process.argv[2]}.json`, 'utf8'));
const g = p.generators.find((x) => x.name === process.argv[3]);
const r = await generate(g, JSON.parse(process.argv[4]), [Number(process.argv[5] || 1)], { draw: lua('draw.lua'), generate: lua('generate.lua') }, engineRun);
console.log(r.results[0].facts);
