// Validation of a project and assembly of the single program that one run executes.
// No DOM, no Node APIs: used by the page and by the tests.

export const DEFAULT_SETTINGS = { constants: {}, solutions: 1, seconds: 60, candidates: 0, trace: 200, seed: 0 };

// A Lua long string whose closing bracket does not occur in the text.
export function luaLongString(text) {
  let n = 2;
  while (text.includes(']' + '='.repeat(n) + ']')) n++;
  const e = '='.repeat(n);
  return `[${e}[\n${text}]${e}]`;
}

const luaStr = (s) => JSON.stringify(String(s));
const int = (v, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : d; };

export function constantList(settings) {
  return Object.entries((settings && settings.constants) || {}).map(([k, v]) => `${k}=${v}`);
}

// Build the program (spec-runtime.md section 2).
//   compiled: the compiler's result ({ lua, map }), or null/undefined for a raw Lua project,
//             or a string of Lua.
export function assemble(project, compiled, runtimeLua, { poll = false, plain = false } = {}) {
  const st = { ...DEFAULT_SETTINGS, ...(project.settings || {}) };
  let loop, map = null;
  if (typeof compiled === 'string') loop = compiled;
  else if (compiled && typeof compiled.lua === 'string') { loop = compiled.lua; map = compiled.map || null; }
  else loop = (project.loop && project.loop.text) || '';
  const lines = [];
  lines.push('#script (lua)');
  lines.push('FRAGMENTS = {}');
  for (const f of project.fragments || []) {
    lines.push(...`FRAGMENTS[${luaStr(f.name)}] = ${luaLongString(f.text || '')}`.split('\n'));
  }
  lines.push(`CONSTS = { ${constantList(st).map(luaStr).join(', ')} }`);
  lines.push(`SETTINGS = { solutions = ${int(st.solutions, 1)}, seconds = ${Number(st.seconds) > 0 ? Number(st.seconds) : 0}, ` +
    `candidates = ${int(st.candidates, 0)}, trace = ${int(st.trace, 0)}, seed = ${int(st.seed, 0)}, ` +
    `poll = ${poll ? 'true' : 'false'}, plain = ${plain ? 'true' : 'false'} }`);
  lines.push(...runtimeLua.replace(/\n?return rt\s*$/, '').split('\n'));
  lines.push('function main(prg)');
  lines.push('  rt.run(function()');
  const loopStartLine = lines.length + 1;
  const loopLines = loop.replace(/\n$/, '').split('\n');
  lines.push(...loopLines);
  const loopEndLine = lines.length;
  lines.push('  end)');
  lines.push('end');
  lines.push(`LOOP_LINES = { ${loopStartLine}, ${loopEndLine} }`);
  lines.push('#end.');
  return { program: lines.join('\n') + '\n', loopStartLine, loopEndLine, map };
}

// Map a line of the assembled program to a line of the loop script (1-based), or null.
export function mapLine(assembled, programLine) {
  if (!programLine) return null;
  const { loopStartLine, loopEndLine, map } = assembled;
  if (programLine < loopStartLine || programLine > loopEndLine) return null;
  const i = programLine - loopStartLine + 1;
  if (!map) return i;
  return map[i] ?? null;
}

// Parse the event lines of a run: '@@K {json}'.
export function parseEvent(line) {
  if (!line.startsWith('@@') || line[3] !== ' ') return null;
  try { return { kind: line[2], data: JSON.parse(line.slice(4)) }; } catch { return null; }
}
