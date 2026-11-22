// Instances: importers and checks (docs/spec-instances.md). No DOM, no Node APIs.
//
// An importer is (text, names) -> { facts, constants }, where names renames the canonical
// predicates (for instance { node: 'vertex' }). Facts are one ground fact per line.
import { INSTANCE_FRAGMENT, INSTANCE_ID } from './project.js';
import { parseClingoErrors } from './driver.js';

export class ImportError extends Error {}

const rename = (names, p) => (names && names[p]) || p;
const term = (s) => (/^-?\d+$/.test(s) ? String(Number(s)) : /^[a-z][A-Za-z0-9_]*$/.test(s) ? s : JSON.stringify(s));

// Plain .lp facts: kept as they are (the caller validates them with clingo).
export function fromFacts(text) {
  return { facts: String(text).replace(/\r\n?/g, '\n').replace(/\s*$/, '\n'), constants: {} };
}

// DIMACS graph (.col): "p edge N M", "e U V"; comments "c". -> node/1, edge/2.
export function fromDimacsGraph(text, names = {}) {
  let n = null;
  const edges = [];
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const l = raw.trim();
    if (!l || l[0] === 'c') continue;
    const t = l.split(/\s+/);
    if (t[0] === 'p') {
      if (t.length < 3 || !/^\d+$/.test(t[2])) throw new ImportError(`line ${i + 1}: expected "p edge N M"`);
      n = Number(t[2]);
    } else if (t[0] === 'e') {
      if (n === null) throw new ImportError(`line ${i + 1}: an edge before the "p" line`);
      const [u, v] = [Number(t[1]), Number(t[2])];
      if (!Number.isInteger(u) || !Number.isInteger(v) || u < 1 || v < 1 || u > n || v > n) throw new ImportError(`line ${i + 1}: bad edge`);
      edges.push([u, v]);
    } else throw new ImportError(`line ${i + 1}: unknown line type '${t[0]}'`);
  }
  if (n === null) throw new ImportError('no "p edge N M" line');
  const node = rename(names, 'node'), edge = rename(names, 'edge');
  const lines = [`${node}(1..${n}).`];
  for (const [u, v] of edges) lines.push(`${edge}(${u},${v}).`);
  return { facts: lines.join('\n') + '\n', constants: {} };
}

// QDIMACS: "p cnf V C", quantifier lines "e ... 0" / "a ... 0", clauses "l1 l2 ... 0".
// -> qvar(V, B) (B = 1 for the outermost block, with qblock(B, e|a)), clause(C), qlit(C, V, S)
// with S = 1 for a positive literal and 0 for a negative one.
export function fromQdimacs(text, names = {}) {
  let header = null, block = 0, c = 0;
  const lines = [];
  const qvar = rename(names, 'qvar'), qblock = rename(names, 'qblock'), clause = rename(names, 'clause'), qlit = rename(names, 'qlit');
  let pending = [];
  const tokens = [];
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const l = raw.trim();
    if (!l || l[0] === 'c') continue;
    const t = l.split(/\s+/);
    if (t[0] === 'p') {
      if (t[1] !== 'cnf' || !/^\d+$/.test(t[2]) || !/^\d+$/.test(t[3])) throw new ImportError(`line ${i + 1}: expected "p cnf V C"`);
      header = { v: Number(t[2]), c: Number(t[3]) };
      continue;
    }
    if (!header) throw new ImportError(`line ${i + 1}: a line before "p cnf V C"`);
    if (t[0] === 'e' || t[0] === 'a') {
      if (c > 0) throw new ImportError(`line ${i + 1}: a quantifier line after the first clause`);
      block++;
      lines.push(`${qblock}(${block},${t[0]}).`);
      for (const x of t.slice(1)) {
        if (x === '0') break;
        const v = Number(x);
        if (!Number.isInteger(v) || v < 1 || v > header.v) throw new ImportError(`line ${i + 1}: bad variable ${x}`);
        lines.push(`${qvar}(${v},${block}).`);
      }
      continue;
    }
    for (const x of t) tokens.push([x, i + 1]);
  }
  for (const [x, line] of tokens) {
    const v = Number(x);
    if (!Number.isInteger(v) || Math.abs(v) > (header ? header.v : 0)) throw new ImportError(`line ${line}: bad literal ${x}`);
    if (v === 0) {
      c++;
      lines.push(`${clause}(${c}).`);
      for (const l of pending) lines.push(`${qlit}(${c},${Math.abs(l)},${l > 0 ? 1 : 0}).`);
      pending = [];
    } else pending.push(v);
  }
  if (!header) throw new ImportError('no "p cnf V C" line');
  if (pending.length) throw new ImportError('the last clause does not end with 0');
  return { facts: lines.join('\n') + '\n', constants: {} };
}

// ASPARTIX (.apx): already arg/1 and att/2 facts (other predicates are kept).
export function fromApx(text, names = {}) {
  const out = [];
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const l = raw.replace(/%.*$/, '').trim();
    if (!l) continue;
    const m = /^(arg|att)\((.*)\)\s*\.$/.exec(l);
    if (!m) throw new ImportError(`line ${i + 1}: expected arg(a). or att(a,b).`);
    out.push(`${rename(names, m[1])}(${m[2]}).`);
  }
  return { facts: out.join('\n') + '\n', constants: {} };
}

// Trivial Graph Format: node lines "id [label]", "#", then edge lines "a b". -> arg/1, att/2.
export function fromTgf(text, names = {}) {
  const out = [];
  let edges = false;
  const ids = new Set();
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const l = raw.trim();
    if (!l) continue;
    if (l === '#') { edges = true; continue; }
    const t = l.split(/\s+/);
    if (!edges) { ids.add(t[0]); out.push(`${rename(names, 'arg')}(${term(t[0])}).`); }
    else {
      if (t.length < 2 || !ids.has(t[0]) || !ids.has(t[1])) throw new ImportError(`line ${i + 1}: an edge between unknown nodes`);
      out.push(`${rename(names, 'att')}(${term(t[0])},${term(t[1])}).`);
    }
  }
  return { facts: out.join('\n') + '\n', constants: {} };
}

// PrefLib orders (.soc / .soi): metadata lines "# ...", then "count: a,b,c,d" (strict orders).
// -> one ballot(V,(A,B,...)) per voter (as kemeny-control writes ballots), candidates c1, c2, ...
export function fromPreflib(text, names = {}) {
  const out = [];
  let v = 0, width = null;
  const ballot = rename(names, 'ballot');
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const l = raw.trim();
    if (!l || l[0] === '#') continue;
    const m = /^(\d+)\s*:\s*(.+)$/.exec(l);
    if (!m) throw new ImportError(`line ${i + 1}: expected "count: a,b,..."`);
    const order = m[2].split(',').map((x) => x.trim());
    if (order.some((x) => !/^\d+$/.test(x))) throw new ImportError(`line ${i + 1}: only strict orders of numbered alternatives are supported`);
    if (width === null) width = order.length;
    if (order.length !== width) throw new ImportError(`line ${i + 1}: every order must rank all ${width} alternatives`);
    for (let k = 0; k < Number(m[1]); k++) {
      v++;
      out.push(`${ballot}(${v},(${order.map((x) => 'c' + x).join(',')})).`);
    }
  }
  return { facts: out.join('\n') + '\n', constants: {} };
}

// jaggpy scenario (.jagg): "[...]" sections; formulas in CNF-like syntax are not parsed here:
// variables are read from a "[variables]" section and clauses from "[clauses]" lines of
// literals separated by spaces ("x1 -x2 x3"). -> var/1, cl/2 (clause, index), pos/2, neg/2.
export function fromJagg(text, names = {}) {
  const out = [];
  let section = '', c = 0;
  const vars = new Set();
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const l = raw.replace(/#.*$/, '').trim();
    if (!l) continue;
    const s = /^\[(\w+)\]$/.exec(l);
    if (s) { section = s[1].toLowerCase(); continue; }
    if (section === 'variables') {
      for (const x of l.split(/[\s,]+/)) { if (!/^[a-z][A-Za-z0-9_]*$/.test(x)) throw new ImportError(`line ${i + 1}: bad variable ${x}`); vars.add(x); out.push(`${rename(names, 'var')}(${x}).`); }
    } else if (section === 'clauses') {
      c++;
      out.push(`${rename(names, 'cl')}(${c}).`);
      for (const x of l.split(/[\s,]+/)) {
        const neg = x.startsWith('-') || x.startsWith('~');
        const v = neg ? x.slice(1) : x;
        if (!vars.has(v)) throw new ImportError(`line ${i + 1}: unknown variable ${v}`);
        out.push(`${rename(names, neg ? 'neg' : 'pos')}(${c},${v}).`);
      }
    }
  }
  if (!c) throw new ImportError('no [clauses] section');
  return { facts: out.join('\n') + '\n', constants: {} };
}

export const IMPORTERS = {
  lp: { label: 'Facts (.lp)', fn: fromFacts, ext: ['.lp', '.txt'] },
  col: { label: 'DIMACS graph (.col)', fn: fromDimacsGraph, ext: ['.col', '.dimacs'] },
  qdimacs: { label: 'QDIMACS (.qdimacs)', fn: fromQdimacs, ext: ['.qdimacs', '.cnf'] },
  apx: { label: 'ASPARTIX (.apx)', fn: fromApx, ext: ['.apx'] },
  tgf: { label: 'Trivial Graph Format (.tgf)', fn: fromTgf, ext: ['.tgf'] },
  preflib: { label: 'PrefLib orders (.soc, .soi)', fn: fromPreflib, ext: ['.soc', '.soi'] },
  jagg: { label: 'jaggpy scenario (.jagg)', fn: fromJagg, ext: ['.jagg'] },
};

export function importerFor(filename) {
  const f = String(filename).toLowerCase();
  for (const [k, v] of Object.entries(IMPORTERS)) if (v.ext.some((e) => f.endsWith(e))) return k;
  return 'lp';
}

// A fresh instance id that is not used yet, from a file name or a stem.
export function freshId(project, stem = 'instance') {
  const base = String(stem).replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'instance';
  const used = new Set((project.instances || []).map((x) => x.id));
  if (!used.has(base) && INSTANCE_ID.test(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

// clingo --mode=gringo on the facts alone: problems as [{ line, col, message }].
export async function checkFacts(facts, engineRun, constants = {}) {
  const c = Object.entries(constants).flatMap(([k, v]) => ['-c', `${k}=${v}`]).join(' ');
  const r = await engineRun(facts + '\n', `--mode=gringo -Wnone ${c}`.trim());
  if (r.status === 0) return [];
  const out = parseClingoErrors(r.err || []).filter((e) => e.severity === 'error').map(({ line, col, message }) => ({ line, col, message }));
  if (!out.length) out.push({ line: 1, col: 1, message: (r.err || []).join(' ').trim() || `clingo exited with status ${r.status}` });
  return out;
}

// The schema check: the instance facts and its constants together with the fragment `schema`
// (constraints every instance must satisfy). Returns { ok, reason }. Without a schema fragment
// it is ok. Uses the exit status of a plain run (30 satisfiable, 20 unsatisfiable).
export async function checkSchema(project, id, engineRun) {
  const schema = project.fragments.find((f) => f.name === 'schema');
  if (!schema) return { ok: true, reason: 'no schema fragment' };
  const x = (project.instances || []).find((i) => i.id === id);
  if (!x) return { ok: false, reason: `no instance named ${id}` };
  const consts = { ...project.settings.constants, ...(x.constants || {}) };
  const problems = await checkFacts(`${x.facts || ''}\n${schema.text}`, engineRun, consts);
  if (problems.length) return { ok: false, reason: problems[0].message };
  const c = Object.entries(consts).map(([k, v]) => `-c ${k}=${v}`).join(' ');
  const r = await engineRun(`${x.facts || ''}\n${schema.text}\n`, `--outf=3 ${c}`.trim());
  if (r.status === 20) return { ok: false, reason: 'the facts violate the schema' };
  if (r.status !== 30 && r.status !== 10) return { ok: false, reason: `clingo exited with status ${r.status}` };
  return { ok: true, reason: '' };
}

export { INSTANCE_FRAGMENT };
