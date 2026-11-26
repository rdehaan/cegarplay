// A light reading of the ASP fragments, for the editors' help: which predicates each fragment
// defines (rule heads, choice elements, #external) and uses (bodies, conditions, #show), in
// which #program part; then, together with the loop script's declarations, what each fragment
// is for (the solvers that ground it, the links whose glue it is), the warnings worth showing
// while one types (lintProject), and the tooltip of a word of a fragment (aspWordHelp).
// It is a scanner, not a parser: clingo checks the syntax. No DOM: the tests run it in Node.
import { scriptNames } from './loop-help.js';

// ---- tokens ------------------------------------------------------------------------------
const OPS = [':-', ':~', '..', '!=', '<=', '>=', '==', '**', '@', '.', ',', ';', ':', '(', ')', '{', '}', '[', ']', '|', '=', '<', '>', '+', '-', '*', '/', '\\', '^', '&', '?', '~'];

export function tokenize(text) {
  const toks = [];
  const s = String(text || '');
  let i = 0, row = 0, col = 0;
  const adv = (n) => { for (let k = 0; k < n; k++) { if (s[i] === '\n') { row++; col = 0; } else col++; i++; } };
  while (i < s.length) {
    const c = s[i];
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r') { adv(1); continue; }
    if (c === '%') {
      if (s[i + 1] === '*') { const e = s.indexOf('*%', i + 2); adv((e < 0 ? s.length : e + 2) - i); }
      else { const e = s.indexOf('\n', i); adv((e < 0 ? s.length : e) - i); }
      continue;
    }
    const at = { row, col, i };
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"' && s[j] !== '\n') { if (s[j] === '\\') j++; j++; }
      adv(Math.min(j + 1, s.length) - i);
      toks.push({ t: 'str', v: s.slice(at.i, i), ...at, end: i });
      continue;
    }
    if (c === '#') {
      const m = /^#[a-z_]+\+?/.exec(s.slice(i, i + 40));
      if (m) { adv(m[0].length); toks.push({ t: 'dir', v: m[0], ...at, end: i }); continue; }
    }
    let m = /^[a-z_'][A-Za-z0-9_']*/.exec(s.slice(i, i + 200));
    if (m && !/^_[A-Z0-9_]/.test(m[0]) && m[0] !== '_') { adv(m[0].length); toks.push({ t: 'id', v: m[0], ...at, end: i }); continue; }
    m = /^_*[A-Z][A-Za-z0-9_']*|^_/.exec(s.slice(i, i + 200));
    if (m) { adv(m[0].length); toks.push({ t: 'var', v: m[0], ...at, end: i }); continue; }
    m = /^\d+/.exec(s.slice(i, i + 40));
    if (m) { adv(m[0].length); toks.push({ t: 'num', v: m[0], ...at, end: i }); continue; }
    const op = OPS.find((o) => s.startsWith(o, i));
    adv(op ? op.length : 1);
    toks.push({ t: 'op', v: op || c, ...at, end: i });
  }
  return toks;
}

const AGG = new Set(['#count', '#sum', '#sum+', '#min', '#max', '#minimize', '#maximize', '#minimise', '#maximise']);
const STARTERS = new Set([',', ';', ':', ':-', ':~', '{', '|', 'not', 'START']);
const TERM_OPS = new Set(['=', '!=', '<', '<=', '>', '>=', '==', '+', '-', '*', '/', '\\', '**', '..', '^', '&', '?', '~', '@']);

// args text of a term in parentheses starting at token index i ('(' ), and the index after ')'
function argsAt(toks, i, src) {
  let d = 0, j = i;
  for (; j < toks.length; j++) {
    if (toks[j].v === '(' && toks[j].t === 'op') d++;
    else if (toks[j].v === ')' && toks[j].t === 'op' && --d === 0) break;
  }
  const close = Math.min(j, toks.length - 1);
  return { text: src.slice(toks[i].end, toks[close].i), next: close + 1 };
}
// the number of arguments of an argument text (pools: the first alternative)
export function arityOf(args) {
  if (!args.trim()) return 0;
  let d = 0, n = 1, inStr = false;
  for (let k = 0; k < args.length; k++) {
    const c = args[k];
    if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '(') d++;
    else if (c === ')') d--;
    else if (d === 0 && c === ',') n++;
    else if (d === 0 && c === ';') break;
  }
  return n;
}
// "pick(X+1)" -> { name: 'pick', arity: 1 }; a variable or a number -> null
export function termPred(term) {
  const m = /^\s*-?([a-z_][A-Za-z0-9_']*)\s*(\(([\s\S]*)\))?\s*$/.exec(term || '');
  return m ? { name: m[1], arity: m[2] ? arityOf(m[3]) : 0 } : null;
}

// scanAsp(text) -> { atoms: [{ name, arity, args, role, row, col, end, part, neg }], parts: [{ name, params, row, col }],
//                    consts: [{ name, value, row }] }   roles: head, body, show, external, defined, heuristic
export function scanAsp(text) {
  const src = String(text || '');
  const toks = tokenize(src);
  const atoms = [], parts = [], consts = [];
  let part = { name: 'base', params: [] };
  let i = 0;
  while (i < toks.length) {
    // one statement: tokens up to '.' at depth 0
    let j = i, d = 0;
    for (; j < toks.length; j++) {
      const v = toks[j].t === 'op' ? toks[j].v : '';
      if (v === '(' || v === '{' || v === '[') d++;
      else if (v === ')' || v === '}' || v === ']') d = Math.max(0, d - 1);
      else if (v === '.' && d === 0) break;
    }
    const st = toks.slice(i, j);
    i = j + 1;
    // "[w@p, T]" after a weak constraint or "[v, m]" after #heuristic belongs to that statement
    if (toks[i] && toks[i].t === 'op' && toks[i].v === '[') {
      let d2 = 0;
      for (; i < toks.length; i++) { if (toks[i].v === '[') d2++; else if (toks[i].v === ']' && --d2 === 0) { i++; break; } }
    }
    if (!st.length) continue;
    const first = st[0];
    if (first.t === 'dir') {
      const dv = first.v;
      if (dv === '#script') {                 // skip to #end.
        let k = i - 1;
        while (k < toks.length && !(toks[k].t === 'dir' && toks[k].v === '#end')) k++;
        i = k + 2;
        continue;
      }
      if (dv === '#program') {
        const name = st[1] && st[1].t === 'id' ? st[1].v : 'base';
        const params = st.slice(2).filter((t) => t.t === 'id' || t.t === 'var').map((t) => t.v);
        part = { name, params };
        parts.push({ name, params, row: first.row, col: first.col, nameCol: st[1] ? st[1].col : first.col });
        continue;
      }
      if (dv === '#const') {
        if (st[1] && st[1].t === 'id') consts.push({ name: st[1].v, value: src.slice(st[2] ? st[2].end : st[1].end, toks[i - 1] ? toks[i - 1].i : src.length).trim(), row: first.row, col: st[1].col });
        continue;
      }
      if (dv === '#show' || dv === '#defined') {
        // #show p/n. #defined p/n. or #show t : body.
        const k = st[1] && st[1].v === '-' ? 2 : 1;
        if (st[k] && st[k].t === 'id' && st[k + 1] && st[k + 1].v === '/' && st[k + 2] && st[k + 2].t === 'num') {
          atoms.push({ name: st[k].v, arity: Number(st[k + 2].v), args: null, role: dv === '#show' ? 'show' : 'defined', row: st[k].row, col: st[k].col, end: st[k].col + st[k].v.length, part: part.name, neg: k === 2 });
          continue;
        }
        const colon = st.findIndex((t) => t.t === 'op' && t.v === ':');
        if (colon > 0) walk(st.slice(colon), 'body');
        continue;
      }
      if (dv === '#external') { walk(st.slice(1), 'external'); continue; }
      if (dv === '#heuristic') { walk(st.slice(1), 'heuristic'); continue; }
      if (dv === '#minimize' || dv === '#maximize' || dv === '#minimise' || dv === '#maximise') { walk(st, 'body'); continue; }
      if (dv === '#include' || dv === '#project' || dv === '#edge' || dv === '#theory') continue;
    }
    walk(st, 'head');
  }
  return { atoms, parts, consts };

  // walk the tokens of a statement; section: head | body | external | heuristic
  function walk(st, section) {
    const stack = [];        // { kind: paren | bracket | choice | agg, post }
    let headCond = false;
    let prev = 'START', prev2 = 'START';
    for (let k = 0; k < st.length; k++) {
      const tk = st[k];
      const v = tk.t === 'op' ? tk.v : tk.t === 'id' && tk.v === 'not' ? 'not' : null;
      if (tk.t === 'op') {
        if (v === '(') stack.push({ kind: 'paren' });
        else if (v === '[') stack.push({ kind: 'bracket' });
        else if (v === '{') stack.push({ kind: st[k - 1] && st[k - 1].t === 'dir' && AGG.has(st[k - 1].v) ? 'agg' : 'choice', post: false });
        else if (v === ')' || v === ']' || v === '}') stack.pop();
        else if (v === ':-' || v === ':~') { if (!stack.length) { section = section === 'head' ? 'body' : section; headCond = false; } }
        else if (v === ':') {
          const top = stack[stack.length - 1];
          if (top && (top.kind === 'choice' || top.kind === 'agg')) top.post = true;
          else if (!top && (section === 'head' || section === 'external' || section === 'heuristic')) headCond = true;
        } else if (v === ';' || v === '|') {
          const top = stack[stack.length - 1];
          if (top && (top.kind === 'choice' || top.kind === 'agg')) top.post = false;
          else if (!top) headCond = false;
        }
        prev2 = prev; prev = v;
        continue;
      }
      if (tk.t === 'id' && tk.v !== 'not') {
        // an atom: no parenthesis or bracket between it and the nearest brace (or the statement)
        let inTerm = false, brace = null;
        for (let s2 = stack.length - 1; s2 >= 0; s2--) {
          if (stack[s2].kind === 'paren' || stack[s2].kind === 'bracket') { inTerm = true; break; }
          brace = stack[s2]; break;
        }
        const neg = prev === '-' && STARTERS.has(prev2);
        const startOk = STARTERS.has(prev) || neg;
        let args = null, next = k + 1;
        if (st[k + 1] && st[k + 1].t === 'op' && st[k + 1].v === '(') { const a = argsAt(st, k + 1, src); args = a.text; next = a.next; }
        const after = st[next] && st[next].t === 'op' ? st[next].v : null;
        if (!inTerm && startOk && !(after && TERM_OPS.has(after)) && !(brace && brace.kind === 'agg' && !brace.post)) {
          let role;
          if (brace) role = brace.kind === 'choice' && !brace.post ? (section === 'body' ? 'body' : 'head') : 'body';
          else if (section === 'head') role = headCond ? 'body' : 'head';
          else if (section === 'external') role = headCond ? 'body' : 'external';
          else if (section === 'heuristic') role = headCond ? 'body' : 'heuristic';
          else role = 'body';
          atoms.push({ name: tk.v, arity: args === null ? 0 : arityOf(args), args, role, row: tk.row, col: tk.col, end: tk.col + tk.v.length, part: part.name, params: part.params, neg });
        }
        // the argument tokens are terms: skip them
        if (args !== null) { k = next - 1; prev2 = prev; prev = ')'; continue; }
      }
      prev2 = prev; prev = tk.t === 'id' ? (tk.v === 'not' ? 'not' : 'ID') : tk.t;
    }
  }
}

// ---- the project ---------------------------------------------------------------------------
// the arguments of a call whose "(" ends just before `from`, split at top-level commas
function splitArgs(text, from) {
  const out = [];
  let d = 0, cur = '', inStr = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inStr) { cur += c; if (c === '\\') cur += text[++i] || ''; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === '(' || c === '[') d++;
    else if (c === ')' || c === ']') { if (d === 0) { out.push(cur); return out; } d--; }
    else if (c === ',' && d === 0) { out.push(cur); cur = ''; continue; }
    else if (c === '\n' && d === 0 && !cur.trim()) continue;
    cur += c;
  }
  out.push(cur);
  return out;
}
// fragments with a meaning of their own, used without a declaration
export const SPECIAL_FRAGMENTS = { schema: 'Constraints that every instance must satisfy (the instance checks, Fuzz and the bounded audit add it); not part of a solver.', instance: 'The facts of the instance.' };
const sig = (a) => `${a.name}/${a.arity}`;
const DEFINES = new Set(['head', 'external', 'defined']);
const FRAME = { 'cand/1': 'cand(A): A is an interface atom that is true in the step\'s candidate (frame part).', 'cex/1': 'cex(A): A is true in the step\'s counterexample (frame part).', 'lit/2': 'lit(A, V): A is in the step\'s refinement, with the value V it must take or leave (frame part).', 'kind/1': 'kind(K): what happened at the step: reject, partial, add, expand, accept, or solution (frame part).', 'step/1': 'step(N): the number of the step (frame part).' };

// projectModel(project) -> what each fragment is for, in the loop script's terms
export function projectModel(project) {
  const frags = (project.fragments || []).map((f) => ({ name: f.name, description: f.description || '', text: f.text || '', scan: scanAsp(f.text || '') }));
  const byName = new Map(frags.map((f) => [f.name, f]));
  const loopText = project.loop && project.loop.language !== 'lua' ? project.loop.text || '' : '';
  const names = loopText ? scriptNames(loopText) : null;
  const solvers = names ? names.solvers : new Map(), links = names ? names.links : new Map();
  const instanceScans = [...(project.instances || []).map((x) => scanAsp(x.facts || '')), ...(project.generators || []).map((g) => scanAsp(g.text || ''))];
  const viewFrags = new Set();
  for (const v of project.views || []) for (const n of v.fragments || []) if (n !== 'shared' && !new RegExp(`\\b${n}\\b`).test(loopText)) viewFrags.add(n);
  // expand calls: solver -> [{ part, facts: [name] }]
  const expands = new Map();
  for (const m of loopText.matchAll(/\b([A-Za-z_]\w*)(?:\[[^\]]*\])?\.expand\(/g)) {
    const args = splitArgs(loopText, m.index + m[0].length);
    const part = (/^\s*([A-Za-z_]\w*)/.exec(args[0] || '') || [])[1];
    if (!part) continue;
    const facts = args.slice(1).map((a) => (/^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(a) || [])[1]).filter(Boolean);
    if (!expands.has(m[1])) expands.set(m[1], []);
    expands.get(m[1]).push({ part, facts, row: loopText.slice(0, m.index).split('\n').length - 1, col: m.index - loopText.lastIndexOf('\n', m.index - 1) - 1 });
  }
  const glueTerms = (f) => f.scan.atoms.filter((a) => a.name === 'glue' && a.arity === 1 && a.role === 'head').map((a) => termPred(a.args)).filter(Boolean);
  // a link's interface predicates (from its glue fragments)
  const linkInfo = new Map();
  for (const [g, l] of links) {
    const ifc = new Map();
    for (const n of l.frags) { const f = byName.get(n); if (f) for (const t of glueTerms(f)) ifc.set(`${t.name}/${t.arity}`, t); }
    linkInfo.set(g, { ...l, name: g, ifc, legacy: l.flags.includes('legacy'), lift: l.flags.includes('lift'), compat: l.flags.includes('compat'), clauseUsed: new RegExp(`\\b${g}(?:\\[[^\\]]*\\])?\\.clause\\(`).test(loopText) });
  }
  // per fragment: the solvers that ground it, the links whose glue it is
  const roles = new Map(frags.map((f) => [f.name, { solvers: [], links: [], view: viewFrags.has(f.name) }]));
  for (const [s, x] of solvers) for (const n of x.frags) if (roles.has(n)) roles.get(n).solvers.push(s);
  for (const [g, l] of links) for (const n of l.frags) if (roles.has(n)) roles.get(n).links.push(g);
  // what a solver (or a glue control) knows: defined predicates, with where
  const defsOf = (fragNames, solver) => {
    const defs = new Map();
    const add = (k, where) => { if (!defs.has(k)) defs.set(k, []); defs.get(k).push(where); };
    for (const n of fragNames) { const f = byName.get(n); if (f) for (const a of f.scan.atoms) if (DEFINES.has(a.role)) add(sig(a), { frag: n, row: a.row }); }
    for (const sc of instanceScans) for (const a of sc.atoms) if (DEFINES.has(a.role)) add(sig(a), { frag: 'instance' });
    if (solver) {
      for (const [g, l] of linkInfo) if (l.to === solver) {
        for (const k of l.ifc.keys()) add(k, { link: g });
        if (l.legacy) for (const n of (solvers.get(l.from) || { frags: [] }).frags) { const f = byName.get(n); if (f) for (const a of f.scan.atoms) if (DEFINES.has(a.role)) add(sig(a), { link: g }); }
        if (!l.legacy || l.ifc.size) add('relevant/1', { link: g, relevant: true });
      }
      for (const e of expands.get(solver) || []) for (const fct of e.facts) add(`${fct}/2`, { expand: e.part });
    }
    return defs;
  };
  const solverDefs = new Map([...solvers].map(([s, x]) => [s, defsOf(x.frags, s)]));
  const linkDefs = new Map([...links].map(([g, l]) => [g, defsOf(l.frags, null)]));
  return { project, frags, byName, names, solvers, links: linkInfo, roles, expands, solverDefs, linkDefs, viewFrags, instanceScans, loopText };
}

// ---- warnings ----------------------------------------------------------------------------
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
// a defined predicate that the undefined `want` is probably a typo of
function suggestion(want, defs) {
  const [name, ar] = want.split('/');
  let best = null;
  for (const k of defs.keys()) {
    const [n2, a2] = k.split('/');
    if (n2 === name && a2 !== ar) return k;                     // the same name, another arity
    const dist = editDistance(name, n2);
    if (a2 === ar && dist <= (name.length >= 6 ? 2 : 1) && (!best || dist < best.dist)) best = { k, dist };
  }
  return best ? best.k : null;
}
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// lintProject(project [, model]) -> [{ where: { kind: 'fragment'|'loop', name, line, col }, severity, message }]
// (lines and columns from 1). Not for raw Lua (nothing is known about the solvers then).
export function lintProject(project, model = projectModel(project)) {
  const out = [];
  const M = model;
  if (!M.names) return out;
  const at = (frag, row, col, message, severity = 'warning') => out.push({ where: { kind: 'fragment', name: frag, line: row + 1, col: col + 1 }, severity, message });
  const atLoop = (row, col, message, severity = 'warning') => out.push({ where: { kind: 'loop', line: row + 1, col: col + 1 }, severity, message });
  const variantsText = JSON.stringify(project.variants || []);
  const consts = Object.keys((project.settings && project.settings.constants) || {});
  for (const f of M.frags) {
    const r = M.roles.get(f.name);
    if (r.view) continue;
    // a fragment no solver and no link grounds
    if (!r.solvers.length && !r.links.length) {
      if (SPECIAL_FRAGMENTS[f.name]) continue;
      if (f.scan.atoms.length && !new RegExp(`\\b${f.name}\\b`).test(variantsText)) at(f.name, 0, 0, `No solver or link of the loop script uses the fragment ${f.name}, so it has no effect. Name it in a declaration (solver S = ... + ${f.name}).`, 'info');
      continue;
    }
    // predicates used but defined nowhere the fragment is grounded
    const seen = new Set();
    for (const a of f.scan.atoms) {
      if (a.role !== 'body' && a.role !== 'heuristic') continue;
      // a part with parameters that no expand of these solvers grounds is never grounded
      if (a.params && a.params.length && !r.solvers.some((s) => (M.expands.get(s) || []).some((e) => e.part === a.part))) continue;
      const k = sig(a);
      const key = `${k}@${a.part}`;
      if (seen.has(key)) continue;
      // in a part, its parameters' facts come from expand (cex(k, T)): known per solver below
      const missing = [];
      for (const s of r.solvers) if (!M.solverDefs.get(s).has(k)) missing.push({ s, defs: M.solverDefs.get(s) });
      for (const g of r.links) if (!M.linkDefs.get(g).has(k) && !r.solvers.length) missing.push({ g, defs: M.linkDefs.get(g) });
      if (!missing.length) continue;
      seen.add(key);
      const first = missing[0];
      const where = first.s ? `solver ${first.s} (${M.solvers.get(first.s).frags.join(' + ')})` : `the glue of link ${first.g}`;
      const sug = suggestion(k, first.defs);
      const others = missing.length > 1 ? ` (nor in ${list(missing.slice(1).map((x) => (x.s ? `solver ${x.s}` : `link ${x.g}`)))})` : '';
      at(f.name, a.row, a.col, `${k} is used here, but no rule of ${where}${others} and no instance defines it${sug ? `: did you mean ${sug}?` : ', so it is false (unless an instance is meant to give it).'}`, sug ? 'warning' : 'info');
    }
    // relevant(T) for a T that is no interface atom
    const targetOf = r.solvers.flatMap((s) => [...M.links.values()].filter((l) => l.to === s));
    for (const a of f.scan.atoms) {
      if (a.name !== 'relevant' || a.arity !== 1 || a.role !== 'head') continue;
      if (!targetOf.length) {
        if (r.solvers.length) at(f.name, a.row, a.col, `relevant/1 matters only in the target of a link (the check), but no link goes to solver ${r.solvers[0]}.`, 'info');
        continue;
      }
      const t = termPred(a.args);
      if (!t) continue;
      const k = `${t.name}/${t.arity}`;
      const ok = targetOf.some((l) => l.ifc.has(k) || (l.legacy && !l.ifc.size));
      if (!ok) {
        const ifc = [...new Set(targetOf.flatMap((l) => [...l.ifc.keys()]))];
        at(f.name, a.row, a.col, `relevant(${a.args.trim()}): ${k} is not an interface atom of ${list(targetOf.map((l) => `link ${l.name}`))}${ifc.length ? ` (its glue gives ${list(ifc)})` : ''}, so this relevant/1 atom is ignored.`);
      }
    }
    // a part's heads must contain its parameter
    for (const a of f.scan.atoms) {
      if (a.role !== 'head' || !a.params || !a.params.length) continue;
      const missing = a.params.filter((p) => !new RegExp(`(^|[^A-Za-z0-9_'])${p}([^A-Za-z0-9_']|$)`).test(a.args || ''));
      if (missing.length === a.params.length) at(f.name, a.row, a.col, `In #program ${a.part}(${a.params.join(', ')}) every head should contain ${a.params.join(' or ')}: ${sig(a)} without it is defined again at each step, and clingo ignores the later rules (the refinement then has no effect).`);
    }
    // a constant named like a part's parameter
    for (const p of f.scan.parts) for (const par of p.params) if (consts.includes(par)) at(f.name, p.row, p.col, `The constant ${par} (Loop tab, Constants) replaces the parameter ${par} of #program ${p.name}: every step defines the same atoms. Rename the constant or the parameter.`);
  }
  // the loop script's side
  for (const [g, l] of M.links) {
    const decl = l.row;
    const gluePresent = l.frags.some((n) => M.byName.has(n) && M.byName.get(n).scan.atoms.some((a) => a.name === 'glue' && a.arity === 1 && a.role === 'head'));
    const missingFrag = l.frags.filter((n) => !M.byName.has(n));
    if (!gluePresent && !l.legacy && !missingFrag.length) atLoop(decl, 0, `Link ${g}: no rule in ${list(l.frags)} derives glue/1, so the link has no interface atoms and the run stops ("the glue fragments derive no glue/1 atom"). Add rules such as glue(p(X)) :- ... to one of them.`);
    const target = M.solvers.get(l.to);
    if (target && l.clauseUsed && !l.lift && !l.compat) {
      const derives = target.frags.some((n) => M.byName.has(n) && M.byName.get(n).scan.atoms.some((a) => a.name === 'relevant' && a.arity === 1 && a.role === 'head'));
      if (!derives) atLoop(decl, 0, `${g}.clause(M, X) reads relevant/1 from the counterexample, but no fragment of solver ${l.to} (${list(target.frags)}) derives relevant/1: every clause would be empty and end the search. Derive relevant(T) in the check, or use ${g}.block(M), or the keyword lift.`);
    }
  }
  for (const [s, es] of M.expands) {
    const x = M.solvers.get(s);
    if (!x) continue;
    for (const e of es) {
      const has = x.frags.some((n) => M.byName.has(n) && M.byName.get(n).scan.parts.some((p) => p.name === e.part));
      if (!has) atLoop(e.row, e.col, `${s}.expand(${e.part}, ...) grounds #program ${e.part}(k), but no fragment of solver ${s} (${list(x.frags)}) has that part. Add "#program ${e.part}(k)." and its rules to one of them.`);
    }
  }
  return out;
}

// ---- tooltips ----------------------------------------------------------------------------
const DIRECTIVES = {
  '#program': 'Starts a program part. "#program base." is the part grounded at once; a part with a parameter, such as "#program refine(k).", is grounded by S.expand(refine, ...) once per step, with k = 1, 2, ...',
  '#show': 'Which atoms a model shows: the solutions print the shown atoms of the abstraction; the trace the shown atoms of the check. Without any #show every atom is shown.',
  '#const': 'A default value for a constant; the Constants table of the Loop tab overrides it.',
  '#external': 'An atom that no rule defines and the loop script sets: S.set(S.atom(...), true) or S.release(...). Until it is set it is false.',
  '#minimize': 'Minimises the sum of the weights of the true elements; S.solve(..., optimal) finds an optimal model. In a check, "#minimize { 1,T : relevant(T) }" gives counterexamples with the fewest relevant atoms (shorter clauses).',
  '#maximize': 'Maximises the sum of the weights of the true elements; S.solve(..., optimal) finds an optimal model.',
  '#count': 'The number of distinct element tuples whose conditions hold.',
  '#sum': 'The sum of the first terms of the element tuples whose conditions hold.',
  '#min': 'The smallest first term of the element tuples whose conditions hold.',
  '#max': 'The largest first term of the element tuples whose conditions hold.',
  '#include': 'Includes a file: not available in the browser.',
  '#heuristic': 'A domain heuristic for the solver (needs the solver option "--heuristic=Domain").',
  '#defined': 'Declares a predicate as defined, so clingo does not warn when no rule derives it.',
};

function whereText(defs) {
  const by = new Map();
  for (const d of defs) {
    const key = d.frag ? (d.frag === 'instance' ? 'the instance' : `fragment ${d.frag}`) : d.link ? (d.relevant ? `link ${d.link} (relevant)` : `link ${d.link} (an interface atom)`) : `${d.expand}(k) (expand)`;
    if (!by.has(key)) by.set(key, []);
    if (d.row !== undefined) by.get(key).push(d.row + 1);
  }
  return list([...by].map(([k, rows]) => (rows.length ? `${k} (line ${[...new Set(rows)].slice(0, 3).join(', ')})` : k)));
}

// aspWordHelp(project, fragName, row, col [, model]) -> { title, text } | null   (row, col from 0)
export function aspWordHelp(project, fragName, row, col, model = projectModel(project)) {
  const M = model;
  const f = M.byName.get(fragName);
  if (!f) return null;
  const toks = tokenize(f.text);
  const tk = toks.find((t) => t.row === row && col >= t.col && col < t.col + t.v.length && t.end - t.i === t.v.length);
  if (!tk) return null;
  const r = M.roles.get(fragName) || { solvers: [], links: [] };
  if (tk.t === 'dir') {
    if (tk.v === '#program') {
      const p = f.scan.parts.find((x) => x.row === tk.row);
      if (p && p.params.length) {
        const callers = [...M.expands].flatMap(([s, es]) => es.filter((e) => e.part === p.name).map((e) => `${s}.expand(${e.part}${e.facts.map((x) => `, ${x} = ...`).join('')})`));
        return { title: `#program ${p.name}(${p.params.join(', ')})`, text: `A part grounded once per step, with ${p.params[0]} = 1, 2, ...${callers.length ? `, by ${list(callers)} in the loop script` : '; no expand of the loop script grounds it yet'}. Every head in it should contain ${p.params[0]}.` };
      }
    }
    return DIRECTIVES[tk.v] ? { title: tk.v, text: DIRECTIVES[tk.v] } : null;
  }
  if (tk.t !== 'id') return null;
  const a = f.scan.atoms.find((x) => x.row === tk.row && x.col === tk.col);
  if (!a) {
    // a constant, or a part's name
    const p = f.scan.parts.find((x) => x.row === tk.row && x.nameCol === tk.col);
    if (p) return aspWordHelp(project, fragName, p.row, p.col, M);
    const c = (project.settings && project.settings.constants) || {};
    if (Object.prototype.hasOwnProperty.call(c, tk.v)) return { title: tk.v, text: `The constant ${tk.v} = ${c[tk.v]} (Loop tab, Constants).` };
    const own = f.scan.consts.find((x) => x.name === tk.v);
    if (own) return { title: tk.v, text: `The constant ${tk.v}, by default ${own.value} (#const); the Constants table of the Loop tab can override it.` };
    return null;
  }
  const k = sig(a);
  const lines = [];
  let title = `${a.name}/${a.arity}`;
  const links = [...M.links.values()];
  if (a.name === 'glue' && a.arity === 1) {
    const t = termPred(a.args);
    const mine = r.links.map((g) => M.links.get(g));
    title = `glue(${a.args.trim()})`;
    lines.push(mine.length
      ? `Makes ${t ? `${t.name}/${t.arity}` : 'T'} an interface atom of ${list(mine.map((l) => `link ${l.name} (${l.from} → ${l.to})`))}: its value in ${mine[0].from}'s candidate is fixed when ${mine[0].to} runs (an assumption, or a fact when it is a fact in ${mine[0].from}).`
      : 'glue(T) makes T an interface atom of a link whose glue (via) names this fragment; no link of the loop script names it.');
  } else if (a.name === 'relevant' && a.arity === 1) {
    const into = r.solvers.flatMap((s) => links.filter((l) => l.to === s));
    title = `relevant(${(a.args || '').trim()})`;
    lines.push(`In a counterexample, the interface atoms the refinement depends on: ${into.length ? `${into[0].name}.clause(M, X)` : 'G.clause(M, X)'} says one of them must change its value. The fewer, the stronger the clause; marking none gives the empty clause.`);
    const t = termPred(a.args);
    if (t && into.length && !into.some((l) => l.ifc.has(`${t.name}/${t.arity}`))) lines.push(`${t.name}/${t.arity} is not an interface atom of ${list(into.map((l) => `link ${l.name}`))}.`);
  } else if (a.name === 'clause' && a.arity === 3) {
    lines.push('clause(Id, T, true) or clause(Id, T, false): a refinement written in ASP, read by G.clauses(X): one clause per Id, with the literal T (true) or not T (false); T must be an interface atom of G.');
  } else if (r.view && a.name === 'draw' && a.arity === 1) {
    lines.push('A mark of the domain view: node/1, edge/2, cell/2, item/2, rank/3, attr/3, emph/1, ghost/1, note/1, layout/1, pos/3.');
  } else if (r.view && FRAME[k]) {
    lines.push(FRAME[k]);
  }
  // expand facts
  for (const s of r.solvers) for (const e of M.expands.get(s) || []) if (e.facts.includes(a.name) && a.arity === 2) lines.push(`${a.name}(k, T): facts added by ${s}.expand(${e.part}, ${a.name} = L) for each atom T in L, with k the step.`);
  // the interface
  const ifcOf = links.filter((l) => l.ifc.has(k));
  if (ifcOf.length && a.name !== 'glue') lines.push(`An interface atom of ${list(ifcOf.map((l) => `link ${l.name} (${l.from} → ${l.to})`))}.`);
  // where it is defined, for the solvers that ground this fragment
  if (!['glue', 'relevant'].includes(a.name) || a.arity !== 1) {
    const defs = r.solvers.length ? M.solverDefs.get(r.solvers[0]) : r.links.length ? M.linkDefs.get(r.links[0]) : null;
    const ds = defs && defs.get(k);
    const role = a.role === 'head' ? 'Defined here' : a.role === 'show' ? 'Shown' : a.role === 'external' ? 'An #external atom' : 'Used here';
    if (ds && ds.length) lines.push(`${role}; ${r.solvers.length ? `for solver ${r.solvers[0]}` : `for link ${r.links[0]}`} it is defined in ${whereText(ds)}.`);
    else if (defs && a.role !== 'head') lines.push(`${role}, but nothing ${r.solvers.length ? `in solver ${r.solvers[0]}` : `in link ${r.links[0]}`} defines it.`);
    else if (a.role === 'head') lines.push('Defined here.');
  }
  if (r.solvers.length || r.links.length) lines.push(`This fragment is grounded by ${list([...r.solvers.map((s) => `solver ${s}`), ...r.links.map((g) => `link ${g}'s glue`)])}.`);
  return { title, text: lines.join(' ') };
}
