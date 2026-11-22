import { compile } from './compiler.js';

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
//   opts.modules: Lua texts appended after the runtime (lua/audit.lua, ...), each without its
//             final `return X`; opts.body: Lua that replaces the loop (a mode such as audit).
//   With neither, the program text is the same as before modes existed.
export function assemble(project, compiled, runtimeLua, { poll = false, plain = false, modules = [], body = null } = {}) {
  const st = { ...DEFAULT_SETTINGS, ...(project.settings || {}) };
  let loop, map = null;
  if (body != null) loop = body;
  else if (typeof compiled === 'string') loop = compiled;
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
  for (const m of modules) lines.push(...m.replace(/\n?return [A-Za-z_][A-Za-z0-9_]*\s*$/, '').split('\n'));
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

const luaQ = (s) => JSON.stringify(String(s));

// The declarations of a compiled loop script, without its statements (for modes that replace
// the loop body): one rt.solver / rt.link line per declaration, in script order.
export function declarationLines(compiled) {
  const out = [];
  const list = (a) => `{${a.map(luaQ).join(', ')}}`;
  // the compiler keeps solvers and links apart; the order of declarations matters (a link
  // must come before its target is grounded), and every solver comes before every link that
  // uses it, so solvers first, then links in order, is a valid order.
  for (const s of compiled.solvers) out.push(`local ${s.name} = rt.solver(${luaQ(s.name)}, ${list(s.fragments)}, ${list(s.options)})`);
  for (const L of compiled.links) {
    const o = [L.legacy && 'legacy = true', L.compat && 'compat = true', L.lift && 'lift = true'].filter(Boolean).join(', ');
    out.push(`local ${L.name} = rt.link(${luaQ(L.name)}, ${L.from}, ${L.to}, ${list(L.fragments)}, {${o}})`);
  }
  return out;
}

// Which link an audit looks at, and what it audits. Returns { link, clause, expand } or
// { error }. expand lists the parts the abstraction is expanded with from counterexamples.
export function auditPlan(compiled, linkName) {
  if (!compiled || !compiled.ok) return { error: 'the audit needs a loop script without errors' };
  const incoming = new Set(compiled.links.map((L) => L.to));
  let cands = compiled.links.filter((L) => !incoming.has(L.from));
  if (linkName) {
    const L = compiled.links.find((x) => x.name === linkName);
    if (!L) return { error: `no link named ${linkName}` };
    if (incoming.has(L.from)) return { error: `link ${linkName} does not leave a top solver (${L.from} has incoming links)` };
    cands = [L];
  }
  if (cands.length === 0) return { error: 'the script declares no link that leaves a top solver' };
  const what = (L) => {
    const uses = (compiled.linkUses && compiled.linkUses[L.name]) || [];
    const expand = (compiled.parts || [])
      .filter((p) => p.solver === L.from && p.facts && p.facts.length && p.facts.every((f) => f.receiver !== 'abstraction'))
      .map((p) => ({ part: p.part, facts: p.facts.map(({ name, pred, arity }) => ({ name, pred, arity })) }));
    const seen = new Set();
    const parts = expand.filter((p) => { const k = JSON.stringify(p); if (seen.has(k)) return false; seen.add(k); return true; });
    return { link: L.name, clause: uses.includes('clause'), expand: parts, L };
  };
  let plans = cands.map(what);
  if (plans.length > 1) {
    const useful = plans.filter((p) => p.clause || p.expand.length);
    if (useful.length !== 1) return { error: `several links leave a top solver (${cands.map((L) => L.name).join(', ')}); name one with --link` };
    plans = useful;
  }
  const plan = plans[0];
  if (compiled.links.some((x) => x.from === plan.L.to)) {
    return { error: `solver ${plan.L.to} passes models on to another solver (a chain); the audit covers a top solver and a check` };
  }
  if (!plan.clause && plan.expand.length === 0) return { error: `the script refines link ${plan.link} with neither ${plan.link}.clause nor an expand from a counterexample: nothing to audit` };
  return { link: plan.link, clause: plan.clause, expand: plan.expand };
}

// The Lua body of the audit mode.
export function auditBody(compiled, plan, { limit = 200000 } = {}) {
  const lua = (v) => Array.isArray(v) ? `{ ${v.map(lua).join(', ')} }`
    : typeof v === 'object' && v ? `{ ${Object.entries(v).map(([k, x]) => `${k} = ${lua(x)}`).join(', ')} }`
    : typeof v === 'string' ? luaQ(v) : String(v);
  const lines = declarationLines(compiled);
  lines.push(`rt.audit{ link = ${plan.link}, limit = ${Number(limit) | 0}, clause = ${plan.clause ? 'true' : 'false'}, expand = ${lua(plan.expand)} }`);
  return lines.map((l) => '    ' + l).join('\n') + '\n';
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

// ---------------------------------------------------------------------------
// Validation (spec-app.md section 3)
// ---------------------------------------------------------------------------
const CONST_NAME = /^[a-z][A-Za-z0-9_]*$/;
const PART_HEADER = '#program validate__.';

// Join fragments as the runtime does, with the validation header; record where each starts.
export function joinForValidation(project, names) {
  const lines = [], starts = [];
  for (const n of names) {
    const f = project.fragments.find((x) => x.name === n);
    lines.push(PART_HEADER);
    starts.push({ name: n, first: lines.length + 1 });
    lines.push(...(f ? f.text : '').split('\n'));
  }
  return { text: lines.join('\n'), starts };
}

function locate(starts, line) {
  let hit = null;
  for (const s of starts) if (line >= s.first) hit = s;
  return hit ? { name: hit.name, line: line - hit.first + 1 } : { name: starts[0] && starts[0].name, line };
}

// clingo writes the rules of a non-base part with an internal body literal for the part,
// '[#inc_name(...)]': drop it, so 'bar(Y):-[#inc_validate__].' reads 'bar(Y).'.
export function cleanClingoMessage(msg) {
  return String(msg)
    .replace(/:-\[#inc_[^\]]*\]\./g, '.')
    .replace(/\[#inc_[^\]]*\];/g, '')
    .replace(/;\[#inc_[^\]]*\]/g, '');
}

// One line for a (possibly multi-line) problem message, for the run bar:
// 'unsafe variables in:\nbar(Y).\n'Y' is unsafe' -> 'unsafe variable 'Y' in bar(Y).'
export function oneLineMessage(msg) {
  const lines = String(msg).split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 2 && /^unsafe variables in:$/.test(lines[0])) {
    const vars = lines.slice(2).map((l) => /^(.*) is unsafe$/.exec(l)).filter(Boolean).map((m) => m[1]);
    if (vars.length) return `unsafe variable${vars.length > 1 ? 's' : ''} ${vars.join(', ')} in ${lines[1]}`;
  }
  if (lines.length > 1 && lines[0].endsWith(':')) return `${lines[0]} ${lines.slice(1).join('; ')}`;
  return lines.join('; ');
}

// Parse clingo's stderr: '-:L:C1-C2: error: message' (end may be 'L2:C2'), notes and indented
// continuation lines belong to the previous problem.
export function parseClingoErrors(err) {
  const out = [];
  const lines = (Array.isArray(err) ? err : String(err).split('\n'));
  for (const l of lines) {
    const m = /^-:(\d+):(\d+)(?:-(?:\d+:)?\d+)?: (error|warning|info|note): (.*)$/.exec(l);
    if (m && m[3] !== 'note') { out.push({ line: Number(m[1]), col: Number(m[2]), severity: m[3] === 'error' ? 'error' : 'warning', message: m[4] }); continue; }
    if (out.length && (m || /^\s/.test(l)) && l.trim()) {
      const extra = m ? `${m[4]}` : l.trim();
      out.at(-1).message += '\n' + extra;
    }
  }
  for (const e of out) e.message = cleanClingoMessage(e.message);
  return out;
}

export function settingsProblems(settings) {
  const out = [];
  for (const [k, v] of Object.entries((settings && settings.constants) || {})) {
    if (!CONST_NAME.test(k)) out.push({ where: { kind: 'settings', name: k }, severity: 'error', message: `constant name '${k}' must start with a lower case letter and contain only letters, digits and _` });
    const s = String(v ?? '');
    if (!s || /[\s"']/.test(s)) out.push({ where: { kind: 'settings', name: k }, severity: 'error', message: `constant ${k}: the value must be non-empty and contain no spaces or quotes` });
  }
  return out;
}

// Returns a list of problems { where: {kind, name, line, col}, severity, message }.
// The list carries the compiler result as `problems.compiled`.
export async function validate(project, engineRun) {
  const problems = [];
  problems.compiled = null;
  const names = project.fragments.map((f) => f.name);
  problems.push(...settingsProblems(project.settings));
  let groups;
  let compiled = null;
  if (project.loop.language === 'loop') {
    compiled = compile(project.loop.text, { fragments: names });
    if (!compiled.ok) {
      for (const e of compiled.errors) problems.push({ where: { kind: 'loop', name: 'loop', line: e.line, col: e.col }, severity: 'error', message: e.message });
      return problems;
    }
    problems.compiled = compiled;
    groups = [...compiled.solvers.map((s) => s.fragments), ...compiled.links.map((l) => l.fragments)];
  } else {
    groups = names.map((n) => [n]);       // raw Lua: check every fragment on its own
  }
  if (problems.length) return problems;
  const consts = constantList(project.settings).flatMap((c) => ['-c', c]).join(' ');
  const seenGroups = new Set(), seen = new Set();
  for (const g of groups) {
    const key = g.join('+');
    if (seenGroups.has(key)) continue;
    seenGroups.add(key);
    const { text, starts } = joinForValidation(project, g);
    const r = await engineRun(text + '\n', `--mode=gringo -Wnone ${consts}`.trim());
    if (r.status === 0) continue;
    const errs = parseClingoErrors(r.err || []);
    if (!errs.length) {
      const msg = (r.err || []).join('\n').trim() || `clingo exited with status ${r.status}`;
      const k = `${g[0]}|${msg}`;
      if (!seen.has(k)) { seen.add(k); problems.push({ where: { kind: 'fragment', name: g[0], line: 1, col: 1 }, severity: 'error', message: msg }); }
      continue;
    }
    for (const e of errs) {
      const at = locate(starts, e.line);
      const k = `${at.name}|${at.line}|${e.col}|${e.message}`;
      if (seen.has(k)) continue;
      seen.add(k);
      problems.push({ where: { kind: 'fragment', name: at.name, line: at.line, col: e.col }, severity: e.severity, message: e.message });
    }
  }
  if (compiled) {
    for (const p of compiled.parts) {
      const s = compiled.solvers.find((x) => x.name === p.solver);
      const re = new RegExp(`#program\\s+${p.part.replace(/[^A-Za-z0-9_]/g, '')}\\s*\\(`);
      const has = s && s.fragments.some((n) => {
        const f = project.fragments.find((x) => x.name === n);
        return f && re.test(stripAspComments(f.text));
      });
      if (!has) problems.push({ where: { kind: 'loop', name: 'loop', line: p.line, col: p.col }, severity: 'error', message: `no fragment of solver ${p.solver} contains '#program ${p.part}(k).'` });
    }
  }
  return problems;
}

// ASP comments blanked out (strings kept).
export function stripAspComments(text) {
  let out = '', i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '%') {
      let e;
      if (text[i + 1] === '*') { e = text.indexOf('*%', i + 2); e = e < 0 ? n : e + 2; } else { e = text.indexOf('\n', i); e = e < 0 ? n : e; }
      for (let k = i; k < e; k++) out += text[k] === '\n' ? '\n' : ' ';
      i = e; continue;
    }
    if (c === '"') {
      let e = i + 1;
      while (e < n && text[e] !== '"') { if (text[e] === '\\') e++; e++; }
      e = Math.min(e + 1, n);
      out += text.slice(i, e); i = e; continue;
    }
    out += c; i++;
  }
  return out;
}
