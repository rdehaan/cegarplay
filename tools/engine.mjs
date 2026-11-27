// The engine for the Node tools: one clingo-wasm run on a fresh module instance, so a trap
// (CLAUDE.md rule 1) leaves no state behind, and the Lua files of lua/. The page's workers
// (js/worker.js, js/lab/worker.js) keep one instance per worker instead and stream the output.
import fs from 'node:fs';
import factory from '../vendor/clingo-wasm/clingo.js';
import { parseEvent } from '../js/driver.js';

const root = new URL('..', import.meta.url);

// The text of lua/<name> (name with or without .lua).
export const lua = (name) => fs.readFileSync(new URL(`lua/${name.endsWith('.lua') ? name : name + '.lua'}`, root), 'utf8');

// { status, out, err, events }; status 'trap' when the instance died. onLine sees each output line.
export async function engineRun(program, options = '--outf=3', onLine = null) {
  const out = [], err = [];
  const m = await factory({ print: (l) => { out.push(l); if (onLine) onLine(l); }, printErr: (l) => err.push(l) });
  let status;
  try { status = m.ccall('run', 'number', ['string', 'string'], [program, options]); }
  catch (e) { status = 'trap'; err.push(String(e)); }
  return { status, out, err, events: out.map(parseEvent).filter(Boolean) };
}
