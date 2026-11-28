import { compile } from './compiler.js';

// Validation of a project and assembly of the single program that one run executes.
// No DOM, no Node APIs: used by the page and by the tests.

export const DEFAULT_SETTINGS = { constants: {}, solutions: 1, seconds: 60, candidates: 0, trace: 200, seed: 0 };

// A Lua long string whose closing bracket does not occur in the text.
// The program's Lua lives in one #script (lua) ... #end. block, and clingo's scanner ends that block
// at the first "#end" it meets, also inside a Lua string. So a text with "#end" (a fragment with its
// own #script part, such as a view's Lua helpers) is cut there into two long strings joined by "..".
export function luaLongString(text) {
  let n = 2;
  while (text.includes(']' + '='.repeat(n) + ']')) n++;
  const e = '='.repeat(n);
  return `[${e}[\n${text.split('#end').join(`#e]${e}] .. [${e}[nd`)}]${e}]`;
}

const luaStr = (s) => JSON.stringify(String(s));
const int = (v, d) => { const x = Number(v); return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : d; };

export function constantList(settings) {
  return Object.entries((settings && settings.constants) || {}).map(([k, v]) => `${k}=${v}`);
}

// settings.record: { steps, n, calls, proof }, or null when nothing is
// recorded (then the program text is the same as without the key).
export const RECORD_STEPS = ['off', 'first', 'every', 'last', 'sample', 'all'];
export function recordSetting(r) {
  if (!r || typeof r !== 'object') return null;
  const steps = RECORD_STEPS.includes(r.steps) ? r.steps : 'off';
  const calls = !!r.calls, proof = !!r.proof;
  if (steps === 'off' && !calls && !proof) return null;
  const n = Number.isInteger(Number(r.n)) && Number(r.n) >= 0 ? Number(r.n) : 0;
  return { steps, n, calls, proof };
}

// settings.certify: off (default), report, exact (phase S4).
export const CERTIFY = ['off', 'report', 'exact'];

// Whether a loop uses `lift` on a link (then lua/ground.lua is needed): the compiler's result,
// or for raw Lua the text (`lift = true` in an rt.link call).
export function usesLift(compiled, loop) {
  if (compiled && Array.isArray(compiled.links)) {
    return compiled.links.some((L) => L.lift) || Object.values(compiled.linkUses || {}).some((u) => u.includes('lift'));
  }
  return !!(loop && loop.language === 'lua' && /\blift\s*=\s*true\b/.test(loop.text || ''));
}

// The Lua modules (lua/<name>.lua) a project's settings need after the runtime, in order.
// compiled / loop: the loop (for `lift` links).
export function modulesFor(settings = {}, { mode = 'run', compiled = null, loop = null } = {}) {
  const out = [];
  const proof = !!(settings.record && settings.record.proof);
  if ((CERTIFY.includes(settings.certify) && settings.certify !== 'off') || usesLift(compiled, loop) || proof) out.push('ground');
  if (mode === 'audit') out.push('audit');
  if (mode === 'bounded') { if (!out.includes('ground')) out.push('ground'); out.push('bounded'); }
  return out;
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
    `${st.randomize === true ? 'randomize = true, ' : ''}poll = ${poll ? 'true' : 'false'}, plain = ${plain ? 'true' : 'false'} }`);
  if (CERTIFY.includes(st.certify) && st.certify !== 'off') lines.push(`SETTINGS.certify = ${luaStr(st.certify)}`);
  if (st.certify === 'exact' && Number(st.exact_seconds) > 0) lines.push(`SETTINGS.exact_seconds = ${Number(st.exact_seconds)}`);
  const rec = recordSetting(st.record);
  if (rec) {
    lines.push(`SETTINGS.record = { steps = ${luaStr(rec.steps)}, n = ${rec.n}, calls = ${rec.calls ? 'true' : 'false'}` +
      `${rec.proof ? ', proof = true' : ''} }`);
  }
  // pools: only with the key, so other programs are unchanged
  if (Array.isArray(project.pools) && project.pools.length) {
    lines.push('POOLS = {}');
    for (const p of project.pools) {
      const items = (p.items || []).map((it) => `{ ${it.map(luaStr).join(', ')} }`).join(', ');
      lines.push(`POOLS[${luaStr(p.name)}] = { domain = ${luaStr(p.domain || '')}, items = { ${items} } }`);
    }
    if (st.pools === 'any') lines.push('SETTINGS.pools = "any"');
  }
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
export function declarationLines(compiled, extraOpts = null) {
  const out = [];
  const list = (a) => `{${a.map(luaQ).join(', ')}}`;
  // the compiler keeps solvers and links apart; the order of declarations matters (a link
  // must come before its target is grounded), and every solver comes before every link that
  // uses it, so solvers first, then links in order, is a valid order.
  for (const s of compiled.solvers) out.push(`local ${s.name} = rt.solver(${luaQ(s.name)}, ${list(s.fragments)}, ${list(s.options)})`);
  for (const L of compiled.links) {
    const o = [L.legacy && 'legacy = true', L.compat && 'compat = true', L.lift && 'lift = true', extraOpts && extraOpts[L.name]].filter(Boolean).join(', ');
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
    return { link: L.name, clause: uses.includes('clause'), clauses: uses.includes('clauses'), core: uses.includes('core'), lift: uses.includes('lift'), expand: parts, L };
  };
  let plans = cands.map(what);
  if (plans.length > 1) {
    const useful = plans.filter((p) => p.clause || p.clauses || p.core || p.expand.length);
    if (useful.length !== 1) return { error: `several links leave a top solver (${cands.map((L) => L.name).join(', ')}); name one with --link` };
    plans = useful;
  }
  const plan = plans[0];
  if (compiled.links.some((x) => x.from === plan.L.to)) {
    return { error: `solver ${plan.L.to} passes models on to another solver (a chain); the audit covers a top solver and a check` };
  }
  // lifted clauses (the keyword lift with G.clause, or G.lift) are computed from the ground
  // programs and certified one by one; the audit builds clauses from relevant/1, so it would
  // judge clauses the loop never adds (with no relevant/1: every pair unsound). It declines.
  if ((plan.L.lift && plan.clause) || plan.lift) {
    return { error: `link ${plan.link} is refined by lifted clauses (${plan.lift ? `${plan.link}.lift` : 'the keyword lift'}): they are computed from the ground programs and certified one by one, not read from relevant/1, so the audit does not check them` };
  }
  // a loop refined only by cores (a witness check): the core audit (lua/audit.lua audit_cores)
  if (plan.core && !plan.clause && !plan.clauses && plan.expand.length === 0) return { link: plan.link, clause: false, expand: [], core: compiled.minimalCore ? 'minimal' : 'plain' };
  if (!plan.clause && !plan.clauses && plan.expand.length === 0) return { error: `the script refines link ${plan.link} with neither ${plan.link}.clause nor a core nor an expand from a counterexample: nothing to audit` };
  // clauses (G.clauses, PLAN3 phase S6): the key only when used, so other plans are unchanged
  return { link: plan.link, clause: plan.clause, ...(plan.clauses ? { clauses: true } : {}), expand: plan.expand };
}

// The Lua body of the audit mode.
export function auditBody(compiled, plan, { limit = 200000, vectors = false } = {}) {
  const lua = (v) => Array.isArray(v) ? `{ ${v.map(lua).join(', ')} }`
    : typeof v === 'object' && v ? `{ ${Object.entries(v).map(([k, x]) => `${k} = ${lua(x)}`).join(', ')} }`
    : typeof v === 'string' ? luaQ(v) : String(v);
  const lines = declarationLines(compiled);
  lines.push(`rt.audit{ link = ${plan.link}, limit = ${Number(limit) | 0}, clause = ${plan.clause ? 'true' : 'false'}, ${plan.clauses ? 'clauses = true, ' : ''}` +
    `expand = ${lua(plan.expand)}${plan.core ? `, core = ${luaQ(plan.core)}` : ''}${vectors ? ', vectors = true' : ''} }`);
  return lines.map((l) => '    ' + l).join('\n') + '\n';
}

// Which link the symbolic audit (lua/bounded.lua) looks at, and what it verifies.
// Returns { link, clause, clauses, kinds } or { error } (no plan) or { unsupported }
// (a plan the verifier does not cover: the verdict is 'unsupported' with that reason).
export function boundedPlan(compiled, linkName) {
  if (!compiled || !compiled.ok) return { error: 'the symbolic audit needs a loop script without errors' };
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
    const expand = (compiled.parts || []).some((p) => p.solver === L.from && p.facts && p.facts.length && p.facts.every((f) => f.receiver !== 'abstraction'));
    return { L, uses, expand };
  };
  let plans = cands.map(what);
  if (plans.length > 1) {
    const useful = plans.filter((p) => p.uses.some((u) => ['clause', 'clauses', 'core', 'block', 'lift'].includes(u)) || p.expand);
    if (useful.length !== 1) return { error: `several links leave a top solver (${cands.map((L) => L.name).join(', ')}); name one with --link` };
    plans = useful;
  }
  const { L, uses, expand } = plans[0];
  const base = { link: L.name };
  if (compiled.links.some((x) => x.from === L.to)) return { ...base, unsupported: `solver ${L.to} passes models on to another solver (a chain)` };
  if (L.lift || uses.includes('lift')) return { ...base, unsupported: 'lift link: certified per clause' };
  if (expand) return { ...base, unsupported: 'the script expands the abstraction with rules (expand)' };
  const kinds = ['clause', 'clauses', 'block', 'core'].filter((k) => uses.includes(k));
  if (!kinds.length) return { error: `the script refines link ${L.name} with neither ${L.name}.clause, ${L.name}.clauses, a block nor a core: nothing to verify` };
  return { ...base, clause: uses.includes('clause'), clauses: uses.includes('clauses'), kinds };
}

// The Lua body of the bounded mode (symbolic audit; with a space, one bound k).
export function boundedBody(compiled, plan, { seconds = 60, fewest = true, space = null } = {}) {
  const lines = declarationLines(compiled, space ? { [plan.link]: 'extra = true' } : null);
  if (plan.unsupported) {
    lines.push(`rt.bounded{ link = ${plan.link}, unsupported = ${luaQ(plan.unsupported)}${space ? ', space = true' : ''} }`);
  } else {
    lines.push(`rt.bounded{ link = ${plan.link}, clause = ${plan.clause ? 'true' : 'false'}, clauses = ${plan.clauses ? 'true' : 'false'}, ` +
      `kinds = { ${plan.kinds.map(luaQ).join(', ')} }, seconds = ${Number(seconds) > 0 ? Number(seconds) : 60}, fewest = ${fewest ? 'true' : 'false'}` +
      `${space ? ', space = true' : ''} }`);
  }
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
    const own = (f ? f.text : '').split('\n');
    // count: up to the last line with text (an error past it is put there; see locate)
    let count = own.length;
    while (count > 1 && !own[count - 1].trim()) count--;
    starts.push({ name: n, first: lines.length + 1, count });
    lines.push(...own);
  }
  return { text: lines.join('\n'), starts };
}

function locate(starts, line) {
  let hit = null;
  for (const s of starts) if (line >= s.first) hit = s;
  if (!hit) return { name: starts[0] && starts[0].name, line };
  // past the fragment's last line with text ("unexpected EOF": an unfinished rule at the end):
  // that line, so the mark lands where the rule is
  const own = line - hit.first + 1;
  return { name: hit.name, line: hit.count ? Math.min(own, hit.count) : own };
}

// clingo writes the rules of a non-base part with an internal body literal for the part,
// '[#inc_name(...)]': drop it, so 'bar(Y):-[#inc_validate__].' reads 'bar(Y).'.
export function cleanClingoMessage(msg) {
  return String(msg)
    .replace(/:-\[#inc_[^\]]*\]\./g, '.')
    .replace(/\[#inc_[^\]]*\];/g, '')
    .replace(/;\[#inc_[^\]]*\]/g, '');
}

// One line for a (possibly multi-line) problem message, for the top bar:
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
  // every pool item must be facts (a list of ground terms): checked here, so that parse_term in
  // the runtime never sees bad text
  for (const pl of project.pools || []) {
    for (const [i, it] of (pl.items || []).entries()) {
      const text = it.map((a) => `${a}.`).join('\n') + '\n';
      const bad = it.find((a) => !groundTerm(a));
      const r = bad === undefined ? await engineRun(text, '--mode=gringo -Wnone') : { status: 65 };
      if (r.status !== 0) problems.push({ where: { kind: 'settings', name: `pool ${pl.name}` }, severity: 'error', message: `pool ${pl.name}, item ${i + 1}: not a list of atoms (${bad !== undefined ? bad : (r.err || []).join(' ').trim()})` });
    }
  }
  if (problems.length) return problems;
  // the facts of an instance reach every solver and every glue control (lua/runtime.lua)
  if (names.includes('instance')) groups = groups.map((g) => (g.includes('instance') ? g : ['instance', ...g]));
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

// A ground term as clingo prints one (pool items): constants, numbers, strings, functions and
// tuples; no variables, intervals, pools, aggregates, directives or comments. parse_term in the
// runtime only ever sees text that passes (a clingo error there traps the engine).
export function groundTerm(text) {
  const s = String(text).trim();
  let i = 0;
  const ws = () => { while (i < s.length && s[i] === ' ') i++; };
  function term() {
    ws();
    if (s[i] === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; i++; } if (s[i] !== '"') return false; i++; return true; }
    if (s[i] === '-') { i++; ws(); }
    let m = /^[0-9]+/.exec(s.slice(i));
    if (m) { i += m[0].length; return true; }
    if (s[i] === '(') { i++; if (!list(')')) return false; return true; }
    m = /^[a-z][A-Za-z0-9_']*/.exec(s.slice(i));
    if (!m) return false;
    i += m[0].length;
    if (s[i] === '(') { i++; return list(')'); }
    return true;
  }
  function list(close) {
    ws();
    if (s[i] === close) { i++; return true; }
    for (;;) {
      if (!term()) return false;
      ws();
      if (s[i] === ',') { i++; ws(); if (s[i] === close) { i++; return true; } continue; }
      if (s[i] === close) { i++; return true; }
      return false;
    }
  }
  if (!s || !term()) return false;
  ws();
  return i === s.length;
}

// A generator checked by clingo --mode=gringo behind a
// one-line stub script that defines every draw function (returning 0), so syntax errors and
// unsafe variables are reported with their line and never reach ctl:add. params: ["n=7", ...].
export const GENERATOR_STUB = '#script (lua) local clingo = require("clingo"); local function z() return clingo.Number(0) end; ' +
  'flip, int, weighted, perm, subset, mallows = z, z, z, z, z, z #end.';
export async function validateGenerator(generator, engineRun, params = []) {
  const text = `${GENERATOR_STUB}\n${generator.text || ''}\n`;
  const consts = params.flatMap((c) => ['-c', c]).join(' ');
  const r = await engineRun(text, `--mode=gringo -Wnone ${consts}`.trim());
  if (r.status === 0) return [];
  const errs = parseClingoErrors(r.err || []).filter((e) => e.severity === 'error')
    .map((e) => ({ line: e.line - 1, col: e.col, message: e.message }));
  if (!errs.length) errs.push({ line: 1, col: 1, message: (r.err || []).join('\n').trim() || `clingo exited with status ${r.status}` });
  return errs;
}

// A space checked by clingo --mode=gringo with its parameters
// as constants (and the project's schema text, when given), so syntax errors and unsafe
// variables are reported with their line and never reach ctl:add. params: ["k=3", ...].
export async function validateSpace(space, engineRun, params = [], schema = '') {
  const text = `${space.text || ''}\n${schema || ''}\n`;
  const consts = params.flatMap((c) => ['-c', c]).join(' ');
  const r = await engineRun(text, `--mode=gringo -Wnone ${consts}`.trim());
  if (r.status === 0) return [];
  const lines = (space.text || '').split('\n').length;
  const errs = parseClingoErrors(r.err || []).filter((e) => e.severity === 'error')
    .map((e) => (e.line > lines ? { line: e.line - lines, col: e.col, message: e.message, where: 'schema' } : { line: e.line, col: e.col, message: e.message }));
  if (!errs.length) errs.push({ line: 1, col: 1, message: (r.err || []).join('\n').trim() || `clingo exited with status ${r.status}` });
  return errs;
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

// The counts of a run (S event; manual: Counting). A counterexample is a model that refuted a
// candidate: the runtime counts a model the first time a refinement is built from it, so a loop
// that refines by cores (a witness check) shows its refutations under cores, not counterexamples.
// Refinements by source: from_models (clauses and expansions from a counterexample), from_cores
// (G.core, C.core.on(G), .minimal), blocks (G.block, G.above, G.below, and the automatic blocks
// of accepted solutions) and other (clauses the script builds itself, expansions from neither).
// An S event of an older recording has none of these: its refinements are its clauses and
// expansions.
export const COUNT_TIP = 'A counterexample is a model that refuted a candidate (a refinement was built from it). ' +
  'Refinements by source: from counterexamples (clauses and expansions built from one), from cores (G.core, C.core.on(G), .minimal) and blocks ' +
  '(G.block, G.above, G.below and the automatic blocks of accepted solutions). A witness-check loop refines by cores, so its refutations are counted under cores.';
export function refinementCounts(S) {
  if (!S) return null;
  if (S.from_models === undefined) {
    const total = (S.clauses ?? 0) + (S.expansions ?? 0);
    return { total, from_models: null, from_cores: null, blocks: null, other: null, split: false };
  }
  const other = S.other ?? 0;
  return { total: S.from_models + S.from_cores + S.blocks + other, from_models: S.from_models, from_cores: S.from_cores, blocks: S.blocks, other, split: true };
}
// "12 from counterexamples, 3 from cores, 2 blocks" (zeros left out; "none" when all are zero)
export function refinementSplitText(r) {
  if (!r || !r.split) return '';
  const parts = [];
  if (r.from_models) parts.push(`${r.from_models.toLocaleString('en-US')} from counterexamples`);
  if (r.from_cores) parts.push(`${r.from_cores.toLocaleString('en-US')} from cores`);
  if (r.blocks) parts.push(`${r.blocks.toLocaleString('en-US')} ${r.blocks === 1 ? 'block' : 'blocks'}`);
  if (r.other) parts.push(`${r.other.toLocaleString('en-US')} other`);
  return parts.length ? parts.join(', ') : 'none';
}
