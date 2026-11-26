// What the editors offer while one types (ACE autocompletion; js/init.js wires it): for the loop
// script, the members that fit the name before the dot, the fragments in a declaration, the
// script's own names and the keywords; for a fragment, the predicates with a special meaning,
// the project's predicates (name/arity, where defined), the directives and the constants.
// No DOM: the tests run it in Node. Items: { value, caption, meta, doc, score }.
import { KEYWORDS, SOLVER, LINK, VALUE, scriptNames } from './loop-help.js';
import { projectModel } from './asp-scan.js';

const item = (value, meta, doc, score = 100, caption = value) => ({ value, caption, meta, doc, score });

// loopCompletions(text, row, col, fragments): row and col from 0, the cursor after the typed prefix
export function loopCompletions(text, row, col, fragments = []) {
  const line = String(text || '').split('\n')[row] || '';
  const before = line.slice(0, col).replace(/[A-Za-z_]\w*$/, '');     // without the prefix being typed
  const names = scriptNames(text);
  // a member: the name before the dot decides which
  const m = /([A-Za-z_]\w*)(?:\[[^\]]*\])?\s*\.\s*$/.exec(before);
  if (m) {
    const recv = m[1];
    const table = names.solvers.has(recv) ? SOLVER : names.links.has(recv) ? LINK : VALUE;
    const kind = table === SOLVER ? `solver ${recv}` : table === LINK ? `link ${recv}` : 'model or list';
    return Object.entries(table).map(([k, [syntax, doc]]) => item(k, kind, `${syntax}: ${doc}`, 300));
  }
  // fragment names in a declaration
  if (/^\s*solver\s+\w+(\s*\[[^\]]*\])?\s*=\s*([\w\s+]*)$/.test(before) || /^\s*link\b.*\bvia\s+[\w\s+]*$/.test(before)) {
    const used = new Set((before.split('=').pop().split('via').pop().match(/\w+/g)) || []);
    return fragments.filter((f) => !used.has(f.name)).map((f) => item(f.name, 'fragment', f.description || `The fragment ${f.name} (Programs tab).`, 300));
  }
  const out = [];
  for (const [s, x] of names.solvers) out.push(item(s, 'solver', `Solver ${s}: grounds ${x.frags.join(' + ')}.`, 250));
  for (const [g, l] of names.links) out.push(item(g, 'link', `Link ${g}: ${l.from} → ${l.to} via ${l.frags.join(' + ')}. ${g}(M): the values of its interface atoms in M.`, 250));
  for (const [p, x] of names.procs) out.push(item(p, 'procedure', `def ${p}(${x.args.join(', ')})`, 240));
  for (const [v, x] of names.vars) if (x.row !== row) out.push(item(v, 'variable', x.expr ? `${v} = ${x.expr}` : x.kind, 230));
  for (const [k, [syntax, doc]] of Object.entries(KEYWORDS)) out.push(item(k, 'keyword', `${syntax}: ${doc}`, 100));
  return out;
}

const SPECIAL = [
  ['glue', 1, 'glue(T): makes T an interface atom of the links whose glue (via) names this fragment.', ['link']],
  ['relevant', 1, 'relevant(T): in a counterexample, the interface atoms the refinement depends on (G.clause(M, X)).', ['target']],
  ['clause', 3, 'clause(Id, T, true|false): a refinement written in ASP, read by G.clauses(X).', ['target']],
  ['draw', 1, 'draw(M): a mark of the domain view (node/1, edge/2, cell/2, attr/3, emph/1, note/1, layout/1, ...).', ['view']],
];
const DIRS = {
  '#show': '#show p/n.', '#program': '#program refine(k).', '#const': '#const n = 4.', '#external': '#external a.',
  '#minimize': '#minimize { 1,T : relevant(T) }.', '#maximize': '#maximize { W,X : value(X,W) }.', '#count': '#count { X : p(X) }',
  '#sum': '#sum { W,X : w(X,W) }', '#min': '#min { X : p(X) }', '#max': '#max { X : p(X) }', '#heuristic': '#heuristic a. [1, true]', '#defined': '#defined p/n.',
};

// aspCompletions(project, fragName, row, col [, model]): row and col from 0
export function aspCompletions(project, fragName, row, col, model = projectModel(project)) {
  const M = model;
  const f = M.byName.get(fragName);
  const line = ((f && f.text) || '').split('\n')[row] || '';
  const typed = (/#?[A-Za-z_]\w*$/.exec(line.slice(0, col)) || [''])[0];
  if (typed.startsWith('#')) return Object.entries(DIRS).map(([k, ex]) => item(k, 'directive', `${ex}`, 200));
  const r = M.roles.get(fragName) || { solvers: [], links: [], view: false };
  const isTarget = r.solvers.some((s) => [...M.links.values()].some((l) => l.to === s));
  const out = [];
  const seen = new Set();
  for (const [name, arity, doc, where] of SPECIAL) {
    const fits = where.includes('link') ? r.links.length > 0 : where.includes('target') ? isTarget : r.view;
    if (!fits) continue;
    seen.add(`${name}/${arity}`);
    out.push(item(`${name}(`, 'special', doc, 400, `${name}/${arity}`));
  }
  // the predicates this fragment's solvers know, then all others of the project
  const known = new Map();
  const note = (k, text) => { if (!known.has(k)) known.set(k, text); };
  for (const s of r.solvers) for (const [k, ds] of M.solverDefs.get(s)) note(k, describe(ds, `solver ${s}`));
  for (const g of r.links) for (const [k, ds] of M.linkDefs.get(g)) note(k, describe(ds, `link ${g}`));
  const special = new Set(SPECIAL.map(([n, a]) => `${n}/${a}`));
  for (const x of M.frags) for (const a of x.scan.atoms) if (a.role === 'head' && !special.has(`${a.name}/${a.arity}`)) note(`${a.name}/${a.arity}`, `Defined in fragment ${x.name}.`);
  for (const [k, text] of known) {
    if (seen.has(k) || (special.has(k) && !r.solvers.some((s) => M.solverDefs.get(s).has(k)))) continue;
    const [name, arity] = k.split('/');
    out.push(item(Number(arity) ? `${name}(` : name, 'predicate', `${k}: ${text}`, 300, k));
  }
  for (const [c, v] of Object.entries((project.settings && project.settings.constants) || {})) out.push(item(c, 'constant', `The constant ${c} = ${v} (Loop tab, Constants).`, 150));
  return out;
}

function describe(defs, of) {
  const where = [...new Set(defs.map((d) => (d.frag ? (d.frag === 'instance' ? 'the instance' : `fragment ${d.frag}`) : d.link ? `link ${d.link}` : `${d.expand}(k)`)))];
  return `For ${of}, defined in ${where.join(', ')}.`;
}
