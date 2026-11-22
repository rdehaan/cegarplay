// Project model, load/save, import of cegar.py files, standalone export. No DOM, no Node APIs.
import { compile } from './compiler.js';
import { assemble, DEFAULT_SETTINGS, stripAspComments } from './driver.js';

export const FORMAT = 'cegarplay';
export const VERSION = 2;
// Keys of format version 2 (docs/spec-instances.md). A project that uses none saves as version 1.
export const V2_KEYS = ['instances', 'generators', 'variants', 'suites', 'views', 'pools'];
export const INSTANCE_ID = /^[A-Za-z0-9_-]+$/;
// The fragment a run gets from its instance; no user fragment may have this name.
export const INSTANCE_FRAGMENT = 'instance';
export const DEFAULT_FRAGMENTS = ['shared', 'abstraction', 'glue', 'check'];
export const FRAGMENT_NAME = /^[a-z][a-z0-9_]*$/;

const DECL = (legacy = '') => `solver A = shared + abstraction
solver C = shared + check          options "--heuristic=Domain"
link   G = A -> C via shared + glue${legacy}
`;

export const TEMPLATES = {
  shape1: {
    label: 'Shape 1: check inside the search',
    text: (l) => DECL(l) + `
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
`,
  },
  shape2: {
    label: 'Shape 2: solve, check, refine, solve again',
    text: (l) => DECL(l) + `
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        A.add(G.block(M))
`,
  },
  shape3: {
    label: 'Shape 3: ground rules per counterexample',
    text: (l) => DECL(l) + `
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.expand(refine, cex = X.atoms(color/2))
    else:
        accept M
        A.add(G.block(M))
`,
  },
  shape4: {
    label: 'Shape 4: search, collect, ground in batches',
    text: (l) => DECL(l) + `
pending = []
repeat:
    search A:
        on candidate M:
            X = C.solve(assume G(M))
            if X:
                pending.push(X)
                reject M with G.block(M)
                if pending.size >= 20: restart
    grounded = pending.size
    for X in pending:
        A.expand(refine, cex = X.atoms(color/2))
    pending.clear()
until A.exhausted and grounded == 0
`,
  },
  reference: {
    label: 'Reference run (block only)',
    text: (l) => DECL(l) + `
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.block(M)
`,
  },
};
export const template = (key, { legacy = false } = {}) => TEMPLATES[key].text(legacy ? ' legacy' : '');

export function newProject(title = 'Untitled') {
  return {
    format: FORMAT,
    version: 1,
    title,
    description: '',
    fragments: DEFAULT_FRAGMENTS.map((name) => ({ name, text: '' })),
    loop: { language: 'loop', text: template('shape1') },
    settings: { ...DEFAULT_SETTINGS, constants: {} },
    runs: [],
  };
}

// A small project that runs as it is, with comments that say what goes where.
export const STARTER = {
  shared: `% Rules every solver needs: domains, constants, common definitions.
item(1..n).
`,
  abstraction: `% Proposes candidates. Every solution must be a candidate; the check removes the rest.
% Here: any non-empty set of items.
1 { pick(I) : item(I) }.
#show pick/1.
`,
  glue: `% The atoms the abstraction and the check share: glue(T) makes T an interface atom.
glue(pick(I)) :- item(I).
`,
  check: `% Looks for a counterexample to the candidate; the interface atoms (pick/1) are fixed.
% Here: a candidate is wrong if it picks an item but not a smaller one.
{ gap(I,J) : item(I), item(J), I < J } = 1.
:- gap(I,J), pick(I).
:- gap(I,J), not pick(J).
% relevant(T): the interface atoms the counterexample depends on. The refinement says
% that one of them must change.
relevant(pick(I)) :- gap(I,J).
relevant(pick(J)) :- gap(I,J).
`,
};

export function starterProject() {
  const p = newProject('New project');
  p.description = 'A small starting point: sets of items that contain every item below a picked one (n solutions). Replace the fragments with your own problem.';
  for (const f of p.fragments) f.text = STARTER[f.name] || '';
  p.settings.constants = { n: '4' };
  p.settings.solutions = 0;
  return p;
}

export class ProjectError extends Error {}

// Validate and fill defaults. Unknown keys are kept.
export function load(json) {
  let p = json;
  if (typeof json === 'string') {
    try { p = JSON.parse(json); } catch (e) { throw new ProjectError(`not a JSON file: ${e.message}`); }
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new ProjectError('not a CegarPlay project: expected a JSON object');
  if (p.format !== FORMAT) {
    if (!('format' in p) && ['aux_program', 'level_gen_program', 'goal_program', 'level_state', 'level_settings'].some((k) => k in p)) {
      throw new ProjectError('this is a logic-game file, not a CegarPlay project');
    }
    throw new ProjectError(`not a CegarPlay project (format is ${JSON.stringify(p.format)}, expected "${FORMAT}")`);
  }
  if (typeof p.version === 'number' && p.version > VERSION) throw new ProjectError(`project version ${p.version} is newer than this CegarPlay (${VERSION})`);
  const out = { ...p };
  out.version = VERSION;
  out.title = typeof p.title === 'string' ? p.title : 'Untitled';
  out.description = typeof p.description === 'string' ? p.description : '';
  if (!Array.isArray(p.fragments)) throw new ProjectError('fragments must be a list');
  const names = new Set();
  out.fragments = p.fragments.map((f, i) => {
    if (!f || typeof f !== 'object') throw new ProjectError(`fragment ${i + 1} is not an object`);
    if (typeof f.name !== 'string' || !FRAGMENT_NAME.test(f.name)) throw new ProjectError(`fragment ${i + 1}: invalid name ${JSON.stringify(f.name)} (use lower case letters, digits and _)`);
    if (names.has(f.name)) throw new ProjectError(`duplicate fragment name '${f.name}'`);

    names.add(f.name);
    return { ...f, text: typeof f.text === 'string' ? f.text : '' };
  });
  let loop = p.loop && typeof p.loop === 'object' ? p.loop : {};
  // The name "instance" is reserved for the facts of an instance. A fragment of an older project
  // with that name is renamed, and so are its uses in the declarations of a loop script.
  if (names.has(INSTANCE_FRAGMENT)) {
    let alt = 'instance_facts';
    for (let i = 2; names.has(alt); i++) alt = `instance_facts${i}`;
    out.fragments = out.fragments.map((f) => (f.name === INSTANCE_FRAGMENT ? { ...f, name: alt } : f));
    names.delete(INSTANCE_FRAGMENT); names.add(alt);
    if (typeof loop.text === 'string' && loop.language !== 'lua') {
      loop = { ...loop, text: loop.text.replace(/^(\s*(?:solver|link)\b.*)$/gm, (l) => l.replace(/\binstance\b/g, alt)) };
    }
  }
  const language = loop.language === 'lua' ? 'lua' : 'loop';
  if (loop.language !== undefined && loop.language !== 'lua' && loop.language !== 'loop') throw new ProjectError(`loop.language must be "loop" or "lua"`);
  out.loop = { ...loop, language, text: typeof loop.text === 'string' ? loop.text : template('shape1') };
  const st = p.settings && typeof p.settings === 'object' ? p.settings : {};
  out.settings = { ...DEFAULT_SETTINGS, ...st };
  const consts = st.constants && typeof st.constants === 'object' && !Array.isArray(st.constants) ? st.constants : {};
  out.settings.constants = Object.fromEntries(Object.entries(consts).map(([k, v]) => [k, String(v)]));
  for (const k of ['solutions', 'seconds', 'candidates', 'trace', 'seed']) {
    const v = Number(out.settings[k]);
    out.settings[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_SETTINGS[k];
  }
  out.runs = Array.isArray(p.runs) ? p.runs : [];
  if ('instances' in p) out.instances = loadInstances(p.instances);
  if ('variants' in p) out.variants = loadVariants(p.variants, names);
  if ('instance' in st && st.instance !== null && st.instance !== '' && typeof st.instance !== 'string') throw new ProjectError('settings.instance must be an instance id or ""');
  out.version = usesV2(out) ? 2 : 1;
  return out;
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const strMap = (x, what) => {
  if (x === undefined) return {};
  if (!isObj(x)) throw new ProjectError(`${what} must be an object`);
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, String(v)]));
};

function loadInstances(list) {
  if (!Array.isArray(list)) throw new ProjectError('instances must be a list');
  const ids = new Set();
  return list.map((x, i) => {
    const where = `instance ${i + 1}`;
    if (!isObj(x)) throw new ProjectError(`${where} is not an object`);
    if (typeof x.id !== 'string' || !INSTANCE_ID.test(x.id)) throw new ProjectError(`${where}: id must match [A-Za-z0-9_-]+`);
    if (ids.has(x.id)) throw new ProjectError(`duplicate instance id '${x.id}'`);
    ids.add(x.id);
    const out = { ...x, id: x.id, facts: typeof x.facts === 'string' ? x.facts : x.recipe ? undefined : '' };
    if (out.facts === undefined) delete out.facts;
    if (x.facts !== undefined && typeof x.facts !== 'string') throw new ProjectError(`instance ${x.id}: facts must be a string`);
    out.constants = strMap(x.constants, `instance ${x.id}: constants`);
    if (x.expected !== undefined) {
      if (!isObj(x.expected)) throw new ProjectError(`instance ${x.id}: expected must be an object`);
      const n = x.expected.solutions;
      if (!(n === null || n === undefined || (Number.isInteger(n) && n >= 0))) throw new ProjectError(`instance ${x.id}: expected.solutions must be a whole number or null`);
    }
    if (x.tags !== undefined && !(Array.isArray(x.tags) && x.tags.every((t) => typeof t === 'string'))) throw new ProjectError(`instance ${x.id}: tags must be a list of strings`);
    out.tags = x.tags || [];
    if (x.recipe !== undefined && !isObj(x.recipe)) throw new ProjectError(`instance ${x.id}: recipe must be an object`);
    return out;
  });
}

function loadVariants(list, fragmentNames) {
  if (!Array.isArray(list)) throw new ProjectError('variants must be a list');
  const seen = new Set();
  return list.map((v, i) => {
    if (!isObj(v)) throw new ProjectError(`variant ${i + 1} is not an object`);
    if (typeof v.name !== 'string' || !INSTANCE_ID.test(v.name)) throw new ProjectError(`variant ${i + 1}: name must match [A-Za-z0-9_-]+`);
    if (seen.has(v.name) || v.name === 'default') throw new ProjectError(`variant name '${v.name}' is used twice or reserved`);
    seen.add(v.name);
    const out = { ...v };
    if (v.loop !== undefined) {
      if (typeof v.loop === 'string') out.loop = { language: 'loop', text: v.loop };
      else if (isObj(v.loop) && typeof v.loop.text === 'string') out.loop = { language: v.loop.language === 'lua' ? 'lua' : 'loop', text: v.loop.text };
      else throw new ProjectError(`variant ${v.name}: loop must be a string or { language, text }`);
    }
    out.swap = strMap(v.swap, `variant ${v.name}: swap`);
    for (const [a, b] of Object.entries(out.swap)) {
      if (!fragmentNames.has(a) || !fragmentNames.has(b)) throw new ProjectError(`variant ${v.name}: swap names an unknown fragment (${a} -> ${b})`);
    }
    out.constants = strMap(v.constants, `variant ${v.name}: constants`);
    if (v.settings !== undefined && !isObj(v.settings)) throw new ProjectError(`variant ${v.name}: settings must be an object`);
    return out;
  });
}

// Whether a project needs format version 2 (a key of V2_KEYS that is not empty).
export function usesV2(project) {
  return V2_KEYS.some((k) => Array.isArray(project[k]) && project[k].length > 0) ||
    !!(project.settings && project.settings.instance);
}

export function save(project, { runs = true } = {}) {
  const p = { ...project };
  if (!runs) p.runs = [];
  p.version = usesV2(project) ? 2 : 1;
  for (const k of V2_KEYS) if (Array.isArray(p[k]) && p[k].length === 0) delete p[k];
  if (p.settings && 'instance' in p.settings && !usesV2(project)) { p.settings = { ...p.settings }; delete p.settings.instance; }
  return JSON.stringify(p, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Derived projects: a variant and an instance applied (implementation.md, groundwork 1).
// Both return a new plain project; the stored one is not touched.
// ---------------------------------------------------------------------------

export function applyVariant(project, name) {
  if (!name || name === 'default') return project;
  const v = (project.variants || []).find((x) => x.name === name);
  if (!v) throw new ProjectError(`no variant named '${name}'`);
  const p = structuredClone(project);
  const text = Object.fromEntries(project.fragments.map((f) => [f.name, f.text]));
  for (const [a, b] of Object.entries(v.swap || {})) {
    const f = p.fragments.find((x) => x.name === a);
    if (f) f.text = text[b];
  }
  if (v.loop) p.loop = { ...p.loop, ...v.loop };
  p.settings = { ...p.settings, ...(v.settings || {}), constants: { ...p.settings.constants, ...(v.constants || {}) } };
  p.variant = name;
  return p;
}

// The instance a run uses: the id given, else settings.instance, else the first instance.
// settings.instance = "" means "the project as written" (only for constants-only instances).
export function selectedInstance(project, id) {
  const list = project.instances || [];
  if (!list.length) {
    if (id) throw new ProjectError(`no instance named '${id}' (the project has no instances)`);
    return null;
  }
  const want = id !== undefined && id !== null ? id : project.settings && project.settings.instance;
  if (want === '') return null;
  if (want === undefined || want === null) return list[0];
  const x = list.find((i) => i.id === want);
  if (x) return x;
  // an id given explicitly must exist; a stale settings.instance falls back to the first
  if (id !== undefined && id !== null) throw new ProjectError(`no instance named '${want}'`);
  return list[0];
}

export function applyInstance(project, id) {
  const x = typeof id === 'object' && id ? id : selectedInstance(project, id);
  if (!x) return project;
  if (x.facts === undefined && x.recipe) throw new ProjectError(`instance ${x.id}: its facts are not generated yet`);
  const p = structuredClone(project);
  p.fragments = [{ name: INSTANCE_FRAGMENT, text: x.facts || '' }, ...p.fragments.filter((f) => f.name !== INSTANCE_FRAGMENT)];
  p.settings = { ...p.settings, constants: { ...p.settings.constants, ...(x.constants || {}) } };
  p.instance = x.id;
  return p;
}

// The plain project of one run: variant first, then instance.
export function derive(project, { instance, variant } = {}) {
  return applyInstance(applyVariant(project, variant), instance);
}

// ---------------------------------------------------------------------------
// ASP text scanning (comments and strings)
// ---------------------------------------------------------------------------

// Calls visit(i) for every index in normal text (not in a comment or string); visit may return
// a number of characters to skip.
function scanCode(text, visit) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '%') {
      if (text[i + 1] === '*') {
        const e = text.indexOf('*%', i + 2);
        i = e < 0 ? n : e + 2;
      } else {
        const e = text.indexOf('\n', i);
        i = e < 0 ? n : e;
      }
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    const skip = visit(i);
    i += skip || 1;
  }
}

export { stripAspComments as stripComments };
const stripComments = stripAspComments;

// All #program directives outside comments and strings: [{ index, end, name, params }]
export function programDirectives(text) {
  const out = [];
  const re = /#program\s+([a-z_][A-Za-z0-9_']*)\s*(\(([^)]*)\))?\s*\./y;
  scanCode(text, (i) => {
    if (text[i] !== '#') return 1;
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) return 1;
    out.push({ index: i, end: re.lastIndex, name: m[1], params: m[3] !== undefined ? m[3].split(',').map((s) => s.trim()).filter(Boolean) : [] });
    return m[0].length;
  });
  return out;
}

const SPLIT = { shared: 'shared', guess: 'abstraction', base: 'abstraction', glue: 'glue', check: 'check' };

export function splitLp(text) {
  const parts = { shared: [], abstraction: [], glue: [], check: [] };
  let cur = 'abstraction', last = 0;
  for (const d of programDirectives(text)) {
    if (d.params.length || !(d.name in SPLIT)) continue;      // e.g. #program refine(k). stays in place
    parts[cur].push(text.slice(last, d.index));
    cur = SPLIT[d.name];
    last = d.end;
  }
  parts[cur].push(text.slice(last));
  const out = {};
  for (const [k, v] of Object.entries(parts)) out[k] = v.join('\n').replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
  for (const k of Object.keys(out)) if (out[k] === '\n') out[k] = '';
  return out;
}

export function usesGlueAtoms(text) { return /\bglue\s*\(/.test(stripComments(text)); }

export function importLp(text, title = 'Imported') {
  const parts = splitLp(text);
  const p = newProject(title);
  p.fragments = DEFAULT_FRAGMENTS.map((name) => ({ name, text: parts[name] }));
  const legacy = parts.glue.trim() !== '' && !usesGlueAtoms(parts.glue);
  p.loop = { language: 'loop', text: template('shape1', { legacy }) };
  return p;
}

export function exportStandalone(project, runtimeLua) {
  project = derive(project);                // the instance the run bar picks
  let compiled = null;
  if (project.loop.language === 'loop') {
    const c = compile(project.loop.text, { fragments: project.fragments.map((f) => f.name) });
    if (!c.ok) throw new ProjectError('the loop script has errors: ' + c.errors.map((e) => `line ${e.line}: ${e.message}`).join('; '));
    compiled = c;
  }
  const { program } = assemble(project, compiled, runtimeLua, { plain: true });
  const header = [
    `% ${project.title || 'CegarPlay project'}: standalone program exported from CegarPlay.`,
    '%',
    '% Run it with:  clingo file.lp --outf=3',
    '%',
    '% clingo must be built with Lua. The PyPI clingo package is not; the Ubuntu',
    '% gringo package and conda-forge builds are (check: clingo --version says "with Lua").',
    '% Settings and constants are fixed in the SETTINGS and CONSTS lines below.',
    '',
  ].join('\n');
  return header + program;
}
