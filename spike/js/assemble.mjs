// Assemble the single program that one clingo run executes:
//   #script (lua)  FRAGMENTS + CONSTS + flags + runtime.lua + loop (inside main/xpcall)  #end.
import fs from 'node:fs';

// Split a file written for cegar.py into its four parts (textual; does not skip comments).
export function splitParts(text) {
  const parts = { shared: '', guess: '', glue: '', check: '' };
  const re = /#program\s+([a-z_]+)\s*\.\s*/g;
  let cur = 'guess', last = 0, m;
  while ((m = re.exec(text))) {
    if (!(m[1] in parts) && m[1] !== 'base') continue;      // e.g. "#program refine(k)." stays where it is
    parts[cur] += text.slice(last, m.index);
    cur = m[1] === 'base' ? 'guess' : m[1];
    last = re.lastIndex;
  }
  parts[cur] += text.slice(last);
  return { shared: parts.shared, abstraction: parts.guess, glue: parts.glue, check: parts.check };
}
export const fragmentsFrom = (file) => splitParts(fs.readFileSync(file, 'utf8'));

// A Lua long string whose closing bracket does not occur in the text.
const lstr = (s) => { let n = 2; while (s.includes(']' + '='.repeat(n) + ']')) n++; const e = '='.repeat(n); return `[${e}[\n${s}]${e}]`; };

export function assemble({ fragments, consts = [], flags = {}, loop }) {
  const rt = fs.readFileSync(new URL('../lua/runtime.lua', import.meta.url), 'utf8').replace(/\nreturn rt\s*$/, '\n');
  const frag = Object.entries(fragments).map(([k, v]) => `FRAGMENTS[${JSON.stringify(k)}] = ${lstr(v)}`).join('\n');
  return `#script (lua)
FRAGMENTS = {}
${frag}
CONSTS = { ${consts.map((c) => JSON.stringify(c)).join(', ')} }
${Object.entries(flags).map(([k, v]) => `${k} = ${v}`).join('\n')}
${rt}
function main(prg)
  local ok, err = xpcall(function()
${loop}
    rt.report()
  end, debug.traceback)
  if not ok then rt.emit("E", (tostring(err):gsub("\\n", " // "))) end
end
#end.
`;
}
